import type {
  Accession,
  Bench,
  ClearanceSnapshot,
  Flag,
  ObservationPass,
  ObservationPlan,
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
  | { type: "observation/recorded"; pass: ObservationPass; flags: Flag[] }
  | { type: "flag/transitioned"; flag: Flag }
  | {
      type: "clearance/generated";
      snapshot: ClearanceSnapshot;
      trials: Trial[];
    }
  | { type: "plan/created"; plan: ObservationPlan }
  | { type: "plan/updated"; plan: ObservationPlan }
  | { type: "plan/reconfirmed"; plan: ObservationPlan }
  | { type: "plan/linked"; plan: ObservationPlan }
  // 原子动作：保存真实观测并把计划标记完成，保证重复点击只产生一份观测。
  | {
      type: "plan/observation-recorded";
      pass: ObservationPass;
      flags: Flag[];
      plan: ObservationPlan;
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
    Array.isArray(candidate.clearanceSnapshots)
  );
}
