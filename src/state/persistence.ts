import type { Accession, Bench, WorkspaceState } from "../domain/types";
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

function normalizeBench(bench: Bench): Bench {
  return {
    ...bench,
    reservedSlots:
      typeof bench.reservedSlots === "number"
        ? Math.min(bench.reservedSlots, bench.capacity)
        : 0,
    maintenance: Array.isArray(bench.maintenance) ? bench.maintenance : [],
  };
}

export function normalizeWorkspaceState(
  state: WorkspaceState,
): WorkspaceState {
  const normalized: WorkspaceState = {
    ...state,
    accessions: state.accessions.map(normalizeAccession),
    benches: state.benches.map(normalizeBench),
  };
  if (!Array.isArray(normalized.allocationPlans)) {
    normalized.allocationPlans = [];
  }
  return normalized;
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
