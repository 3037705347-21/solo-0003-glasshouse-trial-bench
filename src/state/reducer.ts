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
    case "plan/generated":
      return {
        ...state,
        allocationPlans: [...state.allocationPlans, action.plan],
      };
    case "plan/updated": {
      // 已应用/已废弃是终态，拒绝人工改派覆盖。
      const existing = state.allocationPlans.find(
        (plan) => plan.id === action.plan.id,
      );
      if (existing && existing.lifecycle !== "draft") {
        return state;
      }
      return {
        ...state,
        allocationPlans: state.allocationPlans.map((plan) =>
          plan.id === action.plan.id ? action.plan : plan,
        ),
      };
    }
    case "plan/discarded":
      return {
        ...state,
        allocationPlans: state.allocationPlans.map((plan) =>
          plan.id === action.planId && plan.lifecycle === "draft"
            ? { ...plan, lifecycle: "discarded" }
            : plan,
        ),
      };
    case "plan/applied": {
      const target = state.allocationPlans.find(
        (plan) => plan.id === action.plan.id,
      );
      if (target && target.lifecycle !== "draft") {
        return state;
      }
      return {
        ...state,
        benches: action.benches,
        allocationPlans: state.allocationPlans.map((plan) =>
          plan.id === action.plan.id ? action.plan : plan,
        ),
      };
    }
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
