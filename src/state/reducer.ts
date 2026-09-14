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
    case "plan/created":
      return {
        ...state,
        observationPlans: [...state.observationPlans, action.plan],
      };
    case "plan/updated":
    case "plan/reconfirmed":
    case "plan/linked":
      return {
        ...state,
        observationPlans: state.observationPlans.map((plan) =>
          plan.id === action.plan.id ? action.plan : plan,
        ),
      };
    case "plan/observation-recorded": {
      // 重复保存或重复点击完成不能生成多份观测，也不能把已完成的计划再完成一次。
      const passAlreadySaved = state.observationPasses.some(
        (pass) => pass.id === action.pass.id,
      );
      const currentPlan = state.observationPlans.find(
        (plan) => plan.id === action.plan.id,
      );
      const planStillOpen =
        currentPlan &&
        currentPlan.status !== "completed" &&
        !currentPlan.linkedObservationPassId;
      return {
        ...state,
        observationPasses: passAlreadySaved
          ? state.observationPasses
          : [...state.observationPasses, action.pass],
        flags: passAlreadySaved ? state.flags : [...state.flags, ...action.flags],
        observationPlans: planStillOpen
          ? state.observationPlans.map((plan) =>
              plan.id === action.plan.id ? action.plan : plan,
            )
          : state.observationPlans,
      };
    }
    default:
      return state;
  }
}
