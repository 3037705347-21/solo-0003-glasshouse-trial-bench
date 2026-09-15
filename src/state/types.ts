import type {
  Accession,
  Bench,
  ClearanceSnapshot,
  DedupAudit,
  DuplicateReview,
  Flag,
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
  | { type: "bench/assigned"; bench: Bench }
  | { type: "bench/released"; bench: Bench }
  | {
      type: "observation/recorded";
      pass: ObservationPass;
      flags: Flag[];
      review?: DuplicateReview;
      audit?: DedupAudit;
    }
  | { type: "flag/transitioned"; flag: Flag }
  | {
      type: "duplicate/resolved";
      review: DuplicateReview;
      audit: DedupAudit;
      updatedPasses: ObservationPass[];
      withdrawnFlags: Flag[];
    }
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
  // duplicateReviews / dedupAudits 是后加字段：缺失时由 normalizeWorkspaceState 补齐，
  // 不能因此判定旧版本存储损坏而回退示例工作区。
  return (
    Array.isArray(candidate.trials) &&
    Array.isArray(candidate.accessions) &&
    Array.isArray(candidate.benches) &&
    Array.isArray(candidate.observationPasses) &&
    Array.isArray(candidate.flags) &&
    Array.isArray(candidate.clearanceSnapshots)
  );
}
