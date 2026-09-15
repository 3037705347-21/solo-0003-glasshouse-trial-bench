import type { WorkspaceState } from "../domain/types";
import {
  applyWorkspaceCommand,
  emptyHistory,
  executeCommand,
  invertWorkspaceCommand,
  undoCommand,
  type HistoryEnvelope,
  type HistoryState,
} from "./history";
import type { RootAction } from "./types";

export interface RootState {
  workspace: WorkspaceState;
  history: HistoryState;
  lastError?: string;
}

export function createRootState(workspace: WorkspaceState): RootState {
  return { workspace, history: emptyHistory };
}

const ACTIVE_STATUS: HistoryEnvelope["status"] = "active";
const UNDONE_STATUS: HistoryEnvelope["status"] = "undone";
const DISCARDED_STATUS: HistoryEnvelope["status"] = "discarded";

function setEnvelopeStatus(
  entries: HistoryEnvelope[],
  ids: string[],
  status: HistoryEnvelope["status"],
): HistoryEnvelope[] {
  if (ids.length === 0) {
    return entries;
  }
  const idSet = new Set(ids);
  return entries.map((entry) =>
    idSet.has(entry.id) ? { ...entry, status } : entry,
  );
}

function rejected(state: RootState, error: string): RootState {
  return state.lastError === error
    ? state
    : { ...state, history: state.history, lastError: error };
}

export function rootReducer(state: RootState, action: RootAction): RootState {
  switch (action.type) {
    case "workspace/hydrate":
      return {
        workspace: action.workspace,
        history: state.history,
        lastError: undefined,
      };
    case "workspace/reset":
      return {
        workspace: action.workspace,
        history: emptyHistory,
        lastError: undefined,
      };
    case "workspace/command": {
      const envelope: HistoryEnvelope = {
        id: action.envelopeId,
        at: action.at,
        label: action.label,
        reversible: action.reversible,
        command: action.command,
        status: ACTIVE_STATUS,
      };
      const workspace = executeCommand(state.workspace, action.command);
      const discardedIds = state.history.redoStack;
      const entries: HistoryEnvelope[] = [
        ...setEnvelopeStatus(
          state.history.entries,
          discardedIds,
          DISCARDED_STATUS,
        ),
        envelope,
      ];
      const history: HistoryState = {
        entries,
        undoStack: action.reversible
          ? [...state.history.undoStack, envelope.id]
          : state.history.undoStack,
        redoStack: [],
      };
      return { workspace, history, lastError: undefined };
    }
    case "history/undo": {
      const envelope = state.history.entries.find(
        (item) => item.id === action.envelopeId,
      );
      if (
        !envelope ||
        state.history.undoStack[state.history.undoStack.length - 1] !==
          action.envelopeId
      ) {
        return rejected(state, "只能按顺序撤销最近一步可撤销操作");
      }
      const check = invertWorkspaceCommand(
        state.workspace,
        state.history,
        envelope,
      );
      if (!check.ok && check.error) {
        return rejected(state, check.error);
      }
      return {
        workspace: undoCommand(state.workspace, envelope),
        history: {
          ...state.history,
          entries: setEnvelopeStatus(
            state.history.entries,
            [envelope.id],
            UNDONE_STATUS,
          ),
          undoStack: state.history.undoStack.slice(0, -1),
          redoStack: [...state.history.redoStack, envelope.id],
        },
        lastError: undefined,
      };
    }
    case "history/redo": {
      const envelope = state.history.entries.find(
        (item) => item.id === action.envelopeId,
      );
      if (
        !envelope ||
        state.history.redoStack[state.history.redoStack.length - 1] !==
          action.envelopeId
      ) {
        return rejected(state, "只能按顺序重做最近一步操作");
      }
      const check = applyWorkspaceCommand(
        state.workspace,
        envelope.command,
      );
      if (!check.ok && check.error) {
        return rejected(state, check.error);
      }
      return {
        workspace: executeCommand(state.workspace, envelope.command),
        history: {
          ...state.history,
          entries: setEnvelopeStatus(
            state.history.entries,
            [envelope.id],
            ACTIVE_STATUS,
          ),
          undoStack: [...state.history.undoStack, envelope.id],
          redoStack: state.history.redoStack.slice(0, -1),
        },
        lastError: undefined,
      };
    }
    case "history/clear-error":
      return state.lastError ? { ...state, lastError: undefined } : state;
  }
}
