import type { Accession, WorkspaceState } from "../domain/types";
import { isWorkspaceState } from "./types";
import { createSampleWorkspaceState } from "./sampleData";

export const WORKSPACE_STORAGE_KEY = "glasshouse-trial-bench:workspace:v1";

function normalizeAccession(accession: Accession): Accession {
  const lifecycleStatus =
    accession.lifecycleStatus ??
    (accession.mergedIntoId
      ? "merged"
      : accession.retiredAt
        ? "retired"
        : "active");
  return {
    ...accession,
    lifecycleStatus,
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
    mergeRecords: Array.isArray(state.mergeRecords) ? state.mergeRecords : [],
    duplicateReviews: Array.isArray(state.duplicateReviews)
      ? state.duplicateReviews
      : [],
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
