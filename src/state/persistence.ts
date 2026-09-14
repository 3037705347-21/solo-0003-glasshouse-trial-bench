import type { WorkspaceState } from "../domain/types";
import { isWorkspaceState } from "./types";
import { createSampleWorkspaceState } from "./sampleData";

export const WORKSPACE_STORAGE_KEY = "glasshouse-trial-bench:workspace:v1";

export interface StoredWorkspace {
  version: 1;
  savedAt: string;
  state: WorkspaceState;
}

/**
 * Workspaces saved before the lineage module shipped have no
 * `lineageRelations` collection. Backfill it and prune any links that point
 * at accessions missing from the roster so a corrupted record cannot leave
 * dangling references in the graph.
 */
export function migrateWorkspaceState(value: unknown): WorkspaceState | undefined {
  if (!isWorkspaceState(value)) {
    return undefined;
  }
  const accessionIds = new Set(value.accessions.map((accession) => accession.id));
  const lineageRelations = (value.lineageRelations ?? []).filter(
    (relation) =>
      accessionIds.has(relation.endpointAId) &&
      accessionIds.has(relation.endpointBId),
  );
  const benches = value.benches.map((bench) => {
    const assignedIds = bench.assignedIds.filter((id) => accessionIds.has(id));
    if (assignedIds.length === bench.assignedIds.length) {
      return bench;
    }
    return {
      ...bench,
      assignedIds,
      status:
        bench.status === "assigned"
          ? assignedIds.length === 0
            ? ("available" as const)
            : ("assigned" as const)
          : bench.status,
    };
  });
  return { ...value, lineageRelations, benches };
}

export function loadWorkspaceState(): WorkspaceState {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) {
      return createSampleWorkspaceState();
    }
    const parsed = JSON.parse(raw) as Partial<StoredWorkspace>;
    if (!parsed || !parsed.state) {
      return createSampleWorkspaceState();
    }
    return migrateWorkspaceState(parsed.state) ?? createSampleWorkspaceState();
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
