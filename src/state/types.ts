import type {
  Accession,
  Bench,
  ClearanceSnapshot,
  Flag,
  ObservationPass,
  Trial,
  TrialState,
  WorkspaceState,
} from "../domain/types";
import type {
  AuditEntry,
  WorkspaceReplaceSource,
} from "../domain/audit";

export type WorkspaceAction =
  | { type: "hydrate"; state: WorkspaceState }
  | {
      type: "workspace/replaced";
      state: WorkspaceState;
      source: WorkspaceReplaceSource;
      sourceLabel?: string;
    }
  | { type: "trial/created"; trial: Trial }
  | { type: "trial/transitioned"; trialId: string; state: TrialState }
  | { type: "accession/created"; accession: Accession }
  | { type: "accession/updated"; accession: Accession }
  | { type: "bench/assigned"; bench: Bench }
  | { type: "bench/released"; bench: Bench }
  | {
      type: "bench/batch-released";
      benches: Bench[];
      accessionIds: string[];
      trialId: string;
    }
  | { type: "observation/recorded"; pass: ObservationPass; flags: Flag[] }
  | { type: "flag/transitioned"; flag: Flag }
  | {
      type: "clearance/generated";
      snapshot: ClearanceSnapshot;
      trials: Trial[];
    };

/** 日志动作只追加审计历史，不触碰工作区数据。 */
export type AuditAction =
  | { type: "audit/appended"; entry: AuditEntry }
  | { type: "audit/hydrated"; entries: AuditEntry[] };

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
    Array.isArray(candidate.clearanceSnapshots)
  );
}
