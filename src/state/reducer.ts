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
    case "consumption/recorded":
      return {
        ...state,
        consumptionEvents: [...state.consumptionEvents, action.event],
      };
    case "accessions/merged":
      return {
        ...state,
        accessions: state.accessions.map((accession) => {
          if (accession.id === action.source.id) {
            return action.source;
          }
          if (accession.id === action.target.id) {
            return action.target;
          }
          return accession;
        }),
        consumptionEvents: [...state.consumptionEvents, ...action.events],
      };
    case "accession/copied":
      return {
        ...state,
        accessions: [...state.accessions, action.accession],
        consumptionEvents: [...state.consumptionEvents, action.sourceEvent],
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
    default:
      return state;
  }
}
