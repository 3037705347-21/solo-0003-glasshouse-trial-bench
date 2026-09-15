import type { Flag, WorkspaceState } from "../domain/types";
import type { WorkspaceAction } from "./types";

function mergeFlags(
  current: Flag[],
  created: Flag[],
  updated: Flag[],
): Flag[] {
  const updatesById = new Map(updated.map((flag) => [flag.id, flag]));
  return [
    ...current.map((flag) => updatesById.get(flag.id) ?? flag),
    ...created,
  ];
}

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
        flags: mergeFlags(state.flags, action.flags, action.updatedFlags),
      };
    case "flag/transitioned":
      return {
        ...state,
        flags: state.flags.map((flag) =>
          flag.id === action.flag.id ? action.flag : flag,
        ),
      };
    case "flag/escalated":
      return {
        ...state,
        flags: [
          ...state.flags.map((flag) =>
            flag.id === action.superseded.id ? action.superseded : flag,
          ),
          action.followUp,
        ],
      };
    case "clearance/generated":
      return {
        ...state,
        clearanceSnapshots: [...state.clearanceSnapshots, action.snapshot],
        trials: action.trials,
      };
    default:
      return state;
  }
}
