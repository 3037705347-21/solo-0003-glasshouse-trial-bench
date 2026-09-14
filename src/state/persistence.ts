import type { WorkspaceState } from "../domain/types";
import { isWorkspaceState } from "./types";
import { createSampleWorkspaceState } from "./sampleData";

export const WORKSPACE_STORAGE_KEY = "glasshouse-trial-bench:workspace:v1";
export const PRE_IMPORT_STORAGE_KEY =
  "glasshouse-trial-bench:workspace:pre-import:v1";

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
    return parsed.state;
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

export function savePreImportSnapshot(state: WorkspaceState): string {
  const stored: StoredWorkspace = {
    version: 1,
    savedAt: new Date().toISOString(),
    state,
  };
  window.localStorage.setItem(PRE_IMPORT_STORAGE_KEY, JSON.stringify(stored));
  return stored.savedAt;
}

export function loadPreImportSnapshot(): StoredWorkspace | null {
  try {
    const raw = window.localStorage.getItem(PRE_IMPORT_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<StoredWorkspace>;
    if (!parsed || typeof parsed.savedAt !== "string" || !isWorkspaceState(parsed.state)) {
      return null;
    }
    return { version: 1, savedAt: parsed.savedAt, state: parsed.state };
  } catch {
    return null;
  }
}

export function clearPreImportSnapshot(): void {
  window.localStorage.removeItem(PRE_IMPORT_STORAGE_KEY);
}
