import type { Bench, WorkspaceState } from "../domain/types";
import type { WorkspaceAction } from "./types";

function releaseIdsFromBench(bench: Bench, ids: ReadonlySet<string>): Bench {
  if (!bench.assignedIds.some((id) => ids.has(id))) {
    return bench;
  }
  const assignedIds = bench.assignedIds.filter((id) => !ids.has(id));
  // Only an occupied bench falls back to available; blocked/quarantine
  // benches keep the operational state recorded for them.
  const status =
    bench.status === "assigned"
      ? assignedIds.length === 0
        ? "available"
        : "assigned"
      : bench.status;
  return { ...bench, assignedIds, status };
}

function applyAccessionRemoval(
  state: WorkspaceState,
  accessionIds: string[],
  relationIds: string[],
  benchReleaseIds: string[],
): WorkspaceState {
  const relationIdSet = new Set(relationIds);
  const benchIdSet = new Set(benchReleaseIds);
  const accessionIdSet = new Set(accessionIds);
  return {
    ...state,
    accessions: state.accessions.filter(
      (accession) => !accessionIdSet.has(accession.id),
    ),
    lineageRelations: state.lineageRelations.filter(
      (relation) => !relationIdSet.has(relation.id),
    ),
    benches: state.benches.map((bench) =>
      benchIdSet.has(bench.id)
        ? releaseIdsFromBench(bench, accessionIdSet)
        : bench,
    ),
  };
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
    case "accession/merge-requested": {
      const removedIds = new Set([action.sourceId]);
      const next: WorkspaceState = {
        ...state,
        accessions: state.accessions.map((accession) =>
          accession.id === action.sourceId
            ? {
                ...accession,
                mergedIntoId: action.targetId,
                mergedOn: action.mergedOn,
              }
            : accession,
        ),
        lineageRelations: action.relations,
        benches: state.benches.map((bench) =>
          action.benchReleaseIds.includes(bench.id)
            ? releaseIdsFromBench(bench, removedIds)
            : bench,
        ),
      };
      return next;
    }
    case "accession/delete-requested":
      return applyAccessionRemoval(
        state,
        [action.accessionId],
        action.relationIds,
        action.benchReleaseIds,
      );
    case "lineage/created":
      return {
        ...state,
        lineageRelations: [...state.lineageRelations, action.relation],
      };
    case "lineage/deleted":
      return {
        ...state,
        lineageRelations: state.lineageRelations.filter(
          (relation) => relation.id !== action.relationId,
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
