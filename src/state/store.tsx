import {
  createContext,
  type Dispatch,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import type { WorkspaceState } from "../domain/types";
import { createSampleWorkspaceState } from "./sampleData";
import {
  clearWorkspaceStorage,
  loadHistoryState,
  loadWorkspaceState,
  saveHistoryState,
  saveWorkspaceState,
} from "./persistence";
import { createEnvelope } from "./history";
import { rootReducer, type RootState } from "./rootReducer";
import {
  historyCommandFromAction,
  type RootAction,
  type WorkspaceAction,
  type WorkspaceMutationAction,
} from "./types";

interface WorkspaceContextValue {
  state: WorkspaceState;
  dispatch: Dispatch<WorkspaceAction>;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  undoLabel?: string;
  redoLabel?: string;
  historyError?: string;
  clearHistoryError: () => void;
  resetWorkspace: () => void;
  clearWorkspace: () => void;
  persistenceReady: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

function isMutationAction(
  action: WorkspaceAction,
): action is WorkspaceMutationAction {
  return action.type !== "hydrate" && action.type !== "reset";
}

export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [root, dispatchRoot] = useReducer(
    rootReducer,
    null,
    (): RootState => ({
      workspace: loadWorkspaceState(),
      history: loadHistoryState(),
    }),
  );
  const stateRef = useRef(root.workspace);
  stateRef.current = root.workspace;
  const [persistenceReady, setPersistenceReady] = useState(false);

  useEffect(() => {
    saveWorkspaceState(root.workspace);
    saveHistoryState(root.history);
    setPersistenceReady(true);
  }, [root.workspace, root.history]);

  const dispatch: Dispatch<WorkspaceAction> = (action) => {
    if (action.type === "hydrate") {
      dispatchRoot({ type: "workspace/hydrate", workspace: action.state });
      return;
    }
    if (action.type === "reset") {
      dispatchRoot({ type: "workspace/reset", workspace: action.state });
      return;
    }
    if (!isMutationAction(action)) {
      return;
    }
    const command = historyCommandFromAction(action, stateRef.current);
    const envelope = createEnvelope(command, stateRef.current);
    const rootAction: RootAction = {
      type: "workspace/command",
      envelopeId: envelope.id,
      at: envelope.at,
      label: envelope.label,
      reversible: envelope.reversible,
      command,
    };
    dispatchRoot(rootAction);
  };

  const value = useMemo<WorkspaceContextValue>(() => {
    const undoEnvelopeId =
      root.history.undoStack[root.history.undoStack.length - 1];
    const redoEnvelopeId =
      root.history.redoStack[root.history.redoStack.length - 1];
    const undoEnvelope = root.history.entries.find(
      (item) => item.id === undoEnvelopeId,
    );
    const redoEnvelope = root.history.entries.find(
      (item) => item.id === redoEnvelopeId,
    );
    return {
      state: root.workspace,
      dispatch,
      undo: () =>
        undoEnvelopeId &&
        dispatchRoot({ type: "history/undo", envelopeId: undoEnvelopeId }),
      redo: () =>
        redoEnvelopeId &&
        dispatchRoot({ type: "history/redo", envelopeId: redoEnvelopeId }),
      canUndo: Boolean(undoEnvelope),
      canRedo: Boolean(redoEnvelope),
      undoLabel: undoEnvelope?.label,
      redoLabel: redoEnvelope?.label,
      historyError: root.lastError,
      clearHistoryError: () =>
        dispatchRoot({ type: "history/clear-error" }),
      persistenceReady,
      resetWorkspace: () =>
        dispatchRoot({
          type: "workspace/reset",
          workspace: createSampleWorkspaceState(),
        }),
      clearWorkspace: () => {
        clearWorkspaceStorage();
        dispatchRoot({
          type: "workspace/reset",
          workspace: createSampleWorkspaceState(),
        });
      },
    };
  }, [root, persistenceReady]);

  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used inside WorkspaceProvider");
  }
  return context;
}
