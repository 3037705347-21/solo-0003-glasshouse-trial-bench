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
    case "trial/copied":
      return {
        ...state,
        trials: [...state.trials, action.trial],
        accessions: [...state.accessions, ...action.accessions],
        numberRules: action.numberRules,
      };
    case "accession/created":
      return {
        ...state,
        accessions: [...state.accessions, action.accession],
        numberRules: action.numberRules ?? state.numberRules,
      };
    case "accession/updated":
      return {
        ...state,
        accessions: state.accessions.map((accession) =>
          accession.id === action.accession.id ? action.accession : accession,
        ),
      };
    case "accessions/imported":
      return {
        ...state,
        accessions: [...state.accessions, ...action.accessions],
        numberRules: action.numberRules,
      };
    case "numberRule/created":
      return {
        ...state,
        numberRules: [...state.numberRules, action.rule],
      };
    case "numberRule/updated":
      return {
        ...state,
        numberRules: state.numberRules.map((rule) =>
          rule.id === action.rule.id ? action.rule : rule,
        ),
      };
    case "numberRule/removed":
      return {
        ...state,
        numberRules: state.numberRules.filter(
          (rule) => rule.id !== action.ruleId,
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
    default:
      return state;
  }
}
