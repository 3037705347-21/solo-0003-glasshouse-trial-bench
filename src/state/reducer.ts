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
    case "clearance-check/saved": {
      const drafts = [...state.clearanceCheckDrafts];
      const index = drafts.findIndex((draft) => draft.trialId === action.trialId);
      const existing = index >= 0 ? drafts[index] : undefined;
      const records = [
        ...(existing?.records ?? []).filter(
          (record) => record.key !== action.record.key,
        ),
        action.record,
      ];
      const nextDraft = { trialId: action.trialId, records };
      if (index >= 0) {
        drafts[index] = nextDraft;
      } else {
        drafts.push(nextDraft);
      }
      return { ...state, clearanceCheckDrafts: drafts };
    }
    case "clearance-check/cleared":
      return {
        ...state,
        clearanceCheckDrafts: state.clearanceCheckDrafts.map((draft) =>
          draft.trialId === action.trialId
            ? {
                ...draft,
                records: draft.records.filter(
                  (record) => record.key !== action.key,
                ),
              }
            : draft,
        ),
      };
    default:
      return state;
  }
}
