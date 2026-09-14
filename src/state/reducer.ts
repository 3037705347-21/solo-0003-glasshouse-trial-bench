import type { WorkspaceState } from "../domain/types";
import type { WorkspaceAction } from "./types";

export function workspaceReducer(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case "hydrate":
    case "reset":
      return action.state;
    case "trial/created":
      return { ...state, trials: [...state.trials, action.trial] };
    case "trial/transitioned":
      return {
        ...state,
        trials: state.trials.map((trial) =>
          trial.id === action.trialId
            ? { ...trial, state: action.state }
            : trial,
        ),
      };
    case "accession/created":
      return {
        ...state,
        accessions: [...state.accessions, action.accession],
      };
    case "accession/updated":
      return {
        ...state,
        accessions: state.accessions.map((accession) =>
          accession.id === action.accession.id ? action.accession : accession,
        ),
      };
    case "bench/assigned":
    case "bench/released":
      return {
        ...state,
        benches: state.benches.map((bench) =>
          bench.id === action.bench.id ? action.bench : bench,
        ),
      };
    case "observation/recorded":
      return {
        ...state,
        observationPasses: [...state.observationPasses, action.pass],
        flags: [...state.flags, ...action.flags],
      };
    case "flag/transitioned":
      return {
        ...state,
        flags: state.flags.map((flag) =>
          flag.id === action.flag.id ? action.flag : flag,
        ),
      };
    case "clearance/generated":
      return {
        ...state,
        clearanceSnapshots: [...state.clearanceSnapshots, action.snapshot],
        trials: action.trials,
      };
    case "trial/copied":
      // 同键重复派发直接忽略，保证重复提交不会产生多套试验。
      if (
        state.trialCopyRecords.some(
          (record) => record.idempotencyKey === action.record.idempotencyKey,
        )
      ) {
        return state;
      }
      return {
        ...state,
        trials: [...state.trials, action.trial],
        accessions: [...state.accessions, ...action.accessions],
        trialCopyRecords: [...state.trialCopyRecords, action.record],
      };
    case "lineage/created":
      if (
        state.accessionLineage.some(
          (link) =>
            link.childAccessionId === action.link.childAccessionId &&
            link.parentAccessionId === action.link.parentAccessionId &&
            link.relation === action.link.relation,
        )
      ) {
        return state;
      }
      return {
        ...state,
        accessionLineage: [...state.accessionLineage, action.link],
      };
    default:
      return state;
  }
}
