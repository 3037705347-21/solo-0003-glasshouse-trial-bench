import type { RuleVersion, WorkspaceState } from "../domain/types";
import {
  LEGACY_FLAG_CONDITIONS,
  legacyRanges,
} from "../domain/ruleVersion";
import {
  isLegacyWorkspaceState,
  isWorkspaceState,
  type LegacyWorkspaceState,
} from "./types";
import { createSampleWorkspaceState } from "./sampleData";

export const WORKSPACE_STORAGE_KEY = "glasshouse-trial-bench:workspace:v1";

export interface StoredWorkspace {
  version: 1;
  savedAt: string;
  state: WorkspaceState;
}

function migrateLegacyState(state: LegacyWorkspaceState): WorkspaceState {
  const families = Array.from(
    new Set(state.trials.map((trial) => trial.cropFamily)),
  );
  const migratedAt = new Date().toISOString();
  const ruleVersions: RuleVersion[] = families.map((cropFamily, index) => ({
    id: `rule-legacy-${index + 1}`,
    scope: { kind: "cropFamily", cropFamily },
    version: 1,
    ranges: legacyRanges(),
    flagConditions: LEGACY_FLAG_CONDITIONS.map((condition) => ({
      ...condition,
    })),
    changeReason: "系统迁移：继承旧版内置测量边界与标记条件",
    createdAt: migratedAt,
    status: "active",
  }));
  return { ...state, ruleVersions };
}

export function loadWorkspaceState(): WorkspaceState {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) {
      return createSampleWorkspaceState();
    }
    const parsed = JSON.parse(raw) as Partial<StoredWorkspace>;
    if (parsed && isWorkspaceState(parsed.state)) {
      return parsed.state;
    }
    if (parsed && isLegacyWorkspaceState(parsed.state)) {
      return migrateLegacyState(parsed.state);
    }
    return createSampleWorkspaceState();
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
