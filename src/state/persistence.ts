import type { Accession, WorkspaceState } from "../domain/types";
import { isWorkspaceState } from "./types";
import { emptyHistory, isValidHistory, type HistoryState } from "./history";
import { createSampleWorkspaceState } from "./sampleData";

export const WORKSPACE_STORAGE_KEY = "glasshouse-trial-bench:workspace:v1";
export const HISTORY_STORAGE_KEY = "glasshouse-trial-bench:history:v1";

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

export function normalizeWorkspaceState(
  state: WorkspaceState,
): WorkspaceState {
  return {
    ...state,
    accessions: state.accessions.map(normalizeAccession),
  };
}

export interface StoredWorkspace {
  version: 1;
  savedAt: string;
  state: WorkspaceState;
}

export interface StoredHistory {
  version: 1;
  savedAt: string;
  history: HistoryState;
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

export function loadHistoryState(): HistoryState {
  try {
    const raw = window.localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) {
      return emptyHistory;
    }
    const parsed = JSON.parse(raw) as Partial<StoredHistory>;
    if (!parsed || !isValidHistory(parsed.history)) {
      return emptyHistory;
    }
    return parsed.history;
  } catch {
    return emptyHistory;
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

export function saveHistoryState(history: HistoryState): void {
  const stored: StoredHistory = {
    version: 1,
    savedAt: new Date().toISOString(),
    history,
  };
  window.localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(stored));
}

export function clearWorkspaceStorage(): void {
  window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
  window.localStorage.removeItem(HISTORY_STORAGE_KEY);
}
