import type {
  Accession,
  Flag,
  FlagHistoryEntry,
  WorkspaceState,
} from "../domain/types";
import { isWorkspaceState } from "./types";
import { createSampleWorkspaceState } from "./sampleData";

export const WORKSPACE_STORAGE_KEY = "glasshouse-trial-bench:workspace:v1";

function normalizeAccession(accession: Accession): Accession {
  return {
    ...accession,
    lifecycleStatus:
      accession.lifecycleStatus ??
      (accession.retiredAt ? "retired" : "active"),
    retirementHistory: Array.isArray(accession.retirementHistory)
      ? accession.retirementHistory
      : [],
  };
}

/**
 * 兼容旧版标记：补齐范围、流水和跟进字段。
 * 旧标记没有 history，就从 createdOn 与处理结论合成只追加流水，
 * 保证升级后的“旧处理结论不消失”。
 */
export function normalizeFlag(flag: Flag): Flag {
  const history: FlagHistoryEntry[] = Array.isArray(flag.history)
    ? flag.history
    : [];
  if (history.length === 0) {
    history.push({
      id: `${flag.id}-created`,
      at: flag.createdOn,
      action: "created",
      note: "标记由观测数据派生。",
    });
    if (
      (flag.state === "resolved" || flag.state === "waived") &&
      flag.resolvedOn &&
      flag.resolutionNote
    ) {
      history.push({
        id: `${flag.id}-closed`,
        at: flag.resolvedOn,
        action: flag.state,
        note: flag.resolutionNote,
      });
    }
  }
  return {
    ...flag,
    scope: flag.scope ?? "accession",
    history,
  };
}

export function normalizeWorkspaceState(
  state: WorkspaceState,
): WorkspaceState {
  return {
    ...state,
    accessions: state.accessions.map(normalizeAccession),
    flags: state.flags.map(normalizeFlag),
  };
}

export interface StoredWorkspace {
  version: 1;
  savedAt: string;
  state: WorkspaceState;
}

export function loadWorkspaceState(): WorkspaceState {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) {
      return createSampleWorkspaceState();
    }
    const parsed = JSON.parse(raw) as Partial<StoredWorkspace>;
    if (!parsed || !isWorkspaceState(parsed.state)) {
      return createSampleWorkspaceState();
    }
    return normalizeWorkspaceState(parsed.state);
  } catch {
    return createSampleWorkspaceState();
  }
}

export function saveWorkspaceState(state: WorkspaceState): void {
  const stored: StoredWorkspace = {
    version: 1,
    savedAt: new Date().toISOString(),
    state,
  };
  window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(stored));
}

export function clearWorkspaceStorage(): void {
  window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
}
