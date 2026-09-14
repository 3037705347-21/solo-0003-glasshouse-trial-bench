import type { WorkspaceState } from "../domain/types";
import { isWorkspaceState } from "./types";
import { createSampleWorkspaceState } from "./sampleData";

export const WORKSPACE_STORAGE_KEY = "glasshouse-trial-bench:workspace:v1";

export interface StoredWorkspace {
  version: 1;
  savedAt: string;
  state: WorkspaceState;
}

export function loadWorkspaceState(): WorkspaceState {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) {
      return createSampleWorkspaceState();
    }
    const parsed = JSON.parse(raw) as Partial<StoredWorkspace>;
    if (!parsed || !isWorkspaceState(parsed.state)) {
      return createSampleWorkspaceState();
    }
    return normalizeWorkspaceState(parsed.state);
  } catch {
    return createSampleWorkspaceState();
  }
}

export function saveWorkspaceState(state: WorkspaceState): void {
  const stored: StoredWorkspace = {
    version: 1,
    savedAt: new Date().toISOString(),
    state,
  };
  window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(stored));
}

export function clearWorkspaceStorage(): void {
  window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
}

/**
 * 观测计划模块晚于其他模块上线；旧版本保存的工作区没有 observationPlans。
 * 计划数据与观测记录分开存放，这里只补齐缺失的计划数组，绝不改动历史观测。
 */
export function normalizeWorkspaceState(
  state: WorkspaceState,
): WorkspaceState {
  return {
    ...state,
    observationPlans: Array.isArray(state.observationPlans)
      ? state.observationPlans
      : [],
  };
}
