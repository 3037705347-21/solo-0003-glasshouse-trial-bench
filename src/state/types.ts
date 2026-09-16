import type {
  Accession,
  Bench,
  ClearanceSnapshot,
  ConsumptionEvent,
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
  | { type: "consumption/recorded"; event: ConsumptionEvent }
  | {
      type: "accessions/merged";
      source: Accession;
      target: Accession;
      events: ConsumptionEvent[];
    }
  | {
      type: "accession/copied";
      accession: Accession;
      sourceEvent: ConsumptionEvent;
    }
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
  // consumptionEvents 为后增字段：旧版本存储缺失时由归一化补空数组。
  return (
    Array.isArray(candidate.trials) &&
    Array.isArray(candidate.accessions) &&
    Array.isArray(candidate.benches) &&
    Array.isArray(candidate.observationPasses) &&
    Array.isArray(candidate.flags) &&
    Array.isArray(candidate.clearanceSnapshots)
  );
}
