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
        duplicateReviews: action.review
          ? [...state.duplicateReviews, action.review]
          : state.duplicateReviews,
        dedupAudits: action.audit
          ? [...state.dedupAudits, action.audit]
          : state.dedupAudits,
      };
    case "flag/transitioned":
      return {
        ...state,
        flags: state.flags.map((flag) =>
          flag.id === action.flag.id ? action.flag : flag,
        ),
      };
    case "duplicate/resolved": {
      const updatedById = new Map(
        action.updatedPasses.map((pass) => [pass.id, pass]),
      );
      const withdrawnById = new Map(
        action.withdrawnFlags.map((flag) => [flag.id, flag]),
      );
      return {
        ...state,
        observationPasses: state.observationPasses.map((pass) =>
          updatedById.get(pass.id) ?? pass,
        ),
        flags: state.flags.map((flag) => withdrawnById.get(flag.id) ?? flag),
        duplicateReviews: state.duplicateReviews.map((review) =>
          review.id === action.review.id ? action.review : review,
        ),
        dedupAudits: [...state.dedupAudits, action.audit],
      };
    }
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
