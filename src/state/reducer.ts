import type { Flag, WorkspaceState } from "../domain/types";
import type { WorkspaceAction } from "./types";

function flagKey(flag: Flag): string {
  return `${flag.observationPassId}:${flag.accessionId}:${flag.code}`;
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
    case "observation/recorded": {
      // 录入会话使用确定性观测编号作为幂等键：恢复后重试或重复提交
      // 同一编号时直接忽略，保证不会重复写入。
      if (
        state.observationPasses.some((pass) => pass.id === action.pass.id)
      ) {
        return state;
      }
      const existingFlags = new Set(state.flags.map(flagKey));
      return {
        ...state,
        observationPasses: [...state.observationPasses, action.pass],
        flags: [
          ...state.flags,
          ...action.flags.filter((flag) => !existingFlags.has(flagKey(flag))),
        ],
      };
    }
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
