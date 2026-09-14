import type {
  Accession,
  Bench,
  ClearanceSnapshot,
  Flag,
  LineageRelation,
  ObservationPass,
  Trial,
  TrialState,
  WorkspaceState,
} from "../domain/types";

export type WorkspaceAction =
  | { type: "hydrate"; state: WorkspaceState }
  | { type: "reset"; state: WorkspaceState }
  | { type: "trial/created"; trial: Trial }
  | { type: "trial/transitioned"; trialId: string; state: TrialState }
  | { type: "accession/created"; accession: Accession }
  | { type: "accession/updated"; accession: Accession }
  | {
      type: "accession/merge-requested";
      sourceId: string;
      targetId: string;
      mergedOn: string;
      relations: LineageRelation[];
      benchReleaseIds: string[];
    }
  | {
      type: "accession/delete-requested";
      accessionId: string;
      relationIds: string[];
      benchReleaseIds: string[];
    }
  | { type: "lineage/created"; relation: LineageRelation }
  | { type: "lineage/deleted"; relationId: string }
  | { type: "bench/assigned"; bench: Bench }
  | { type: "bench/released"; bench: Bench }
  | { type: "observation/recorded"; pass: ObservationPass; flags: Flag[] }
  | { type: "flag/transitioned"; flag: Flag }
  | {
      type: "clearance/generated";
      snapshot: ClearanceSnapshot;
      trials: Trial[];
    };

export function isWorkspaceState(value: unknown): value is WorkspaceState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<WorkspaceState>;
  return (
    Array.isArray(candidate.trials) &&
    Array.isArray(candidate.accessions) &&
    Array.isArray(candidate.benches) &&
    Array.isArray(candidate.observationPasses) &&
    Array.isArray(candidate.flags) &&
    Array.isArray(candidate.clearanceSnapshots) &&
    (candidate.lineageRelations === undefined ||
      Array.isArray(candidate.lineageRelations))
  );
}
