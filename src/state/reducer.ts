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
      // 真正的幂等：同一计划一旦完成（或已关联观测、已不存在），后续重复提交
      // 整条忽略。不能只按观测编号去重——重复提交每次都会生成新编号，那样仍会
      // 追加第二份孤立观测和标记。
      const currentPlan = state.observationPlans.find(
        (plan) => plan.id === action.plan.id,
      );
      if (
        !currentPlan ||
        currentPlan.status === "completed" ||
        currentPlan.linkedObservationPassId
      ) {
        return state;
      }
      // 同一观测动作被重复派发时也不重复入库（编号相同的情形）。
      const passAlreadySaved = state.observationPasses.some(
        (pass) => pass.id === action.pass.id,
      );
      if (passAlreadySaved) {
        return state;
      }
      return {
        ...state,
        observationPasses: [...state.observationPasses, action.pass],
        flags: [...state.flags, ...action.flags],
        observationPlans: state.observationPlans.map((plan) =>
          plan.id === action.plan.id ? action.plan : plan,
        ),
      };
    }
    default:
      return state;
  }
}
