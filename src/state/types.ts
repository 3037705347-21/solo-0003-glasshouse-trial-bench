import type {
  Accession,
  Bench,
  ClearanceSnapshot,
  Flag,
  NumberRule,
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
  | { type: "trial/copied"; trial: Trial; accessions: Accession[]; numberRules: NumberRule[] }
  | { type: "accession/created"; accession: Accession; numberRules?: NumberRule[] }
  | { type: "accession/updated"; accession: Accession }
  | { type: "accessions/imported"; accessions: Accession[]; numberRules: NumberRule[] }
  | { type: "numberRule/created"; rule: NumberRule }
  | { type: "numberRule/updated"; rule: NumberRule }
  | { type: "numberRule/removed"; ruleId: string }
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
    // numberRules was added later; missing arrays are filled by normalization.
    (!candidate.numberRules || Array.isArray(candidate.numberRules)) &&
    Array.isArray(candidate.benches) &&
    Array.isArray(candidate.observationPasses) &&
    Array.isArray(candidate.flags) &&
    Array.isArray(candidate.clearanceSnapshots)
  );
}
