import type { WorkspaceState } from "../domain/types";
import { isWorkspaceState } from "./types";
import { createSampleWorkspaceState } from "./sampleData";

export const WORKSPACE_STORAGE_KEY = "glasshouse-trial-bench:workspace:v1";

export interface StoredWorkspace {
  version: 1;
  savedAt: string;
  state: WorkspaceState;
}

function normalizeWorkspaceState(state: WorkspaceState): WorkspaceState {
  return {
    ...state,
    importBatches: Array.isArray(state.importBatches)
      ? state.importBatches
      : [],
  };
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

export function trySaveWorkspaceState(state: WorkspaceState): boolean {
  try {
    const stored: StoredWorkspace = {
      version: 1,
      savedAt: new Date().toISOString(),
      state,
    };
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}

export function saveWorkspaceState(state: WorkspaceState): void {
  trySaveWorkspaceState(state);
}

export function clearWorkspaceStorage(): void {
  window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
}
