import type {
  Accession,
  Bench,
  BenchReservation,
  ClearanceSnapshot,
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
  | { type: "bench/assigned"; bench: Bench; reservation?: BenchReservation }
  | { type: "bench/released"; bench: Bench }
  | { type: "bench/updated"; bench: Bench }
  | { type: "reservation/created"; reservation: BenchReservation }
  | { type: "reservation/cancelled"; reservation: BenchReservation }
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
    Array.isArray(candidate.clearanceSnapshots)
  );
}

/** 兼容旧版存储：补齐预留数组并过滤结构不完整的预留记录。 */
export function normalizeWorkspaceState(
  state: WorkspaceState,
): WorkspaceState {
  const reservations = Array.isArray(state.reservations)
    ? state.reservations.filter(
        (reservation) =>
          reservation &&
          typeof reservation.id === "string" &&
          typeof reservation.trialId === "string" &&
          typeof reservation.benchId === "string",
      )
    : [];
  return { ...state, reservations };
}
