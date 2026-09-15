import type {
  Accession,
  Flag,
  ObservationPass,
  ClearanceSnapshot,
  WorkspaceState,
} from "../domain/types";
import { BASELINE_RULESET_ID, createBaselineRuleSet } from "../domain/ruleset";
import { isWorkspaceState } from "./types";
import { createSampleWorkspaceState } from "./sampleData";

export const WORKSPACE_STORAGE_KEY = "glasshouse-trial-bench:workspace:v1";

function normalizeAccession(accession: Accession): Accession {
  return {
    ...accession,
    lifecycleStatus:
      accession.lifecycleStatus ??
      (accession.retiredAt ? "retired" : "active"),
    retirementHistory: Array.isArray(accession.retirementHistory)
      ? accession.retirementHistory
      : [],
  };
}

function normalizePass(pass: ObservationPass): ObservationPass {
  return {
    ...pass,
    ruleSetId: pass.ruleSetId ?? BASELINE_RULESET_ID,
  };
}

function normalizeFlag(flag: Flag): Flag {
  return {
    ...flag,
    ruleSetId: flag.ruleSetId ?? BASELINE_RULESET_ID,
    revisionHistory: Array.isArray(flag.revisionHistory)
      ? flag.revisionHistory
      : [],
  };
}

function normalizeSnapshot(snapshot: ClearanceSnapshot): ClearanceSnapshot {
  return {
    ...snapshot,
    ruleSetId: snapshot.ruleSetId ?? BASELINE_RULESET_ID,
  };
}

/**
 * 把旧版本工作区迁移到当前结构。
 * v1 数据没有规则版本概念：回填一份与原始内置阈值一致的基线规则，
 * 并给历史观测、标记和放行快照盖上基线溯源，行为保持不变。
 */
export function normalizeWorkspaceState(
  state: WorkspaceState,
): WorkspaceState {
  const ruleSets =
    Array.isArray(state.ruleSets) && state.ruleSets.length > 0
      ? state.ruleSets
      : [createBaselineRuleSet()];
  return {
    ...state,
    accessions: state.accessions.map(normalizeAccession),
    observationPasses: state.observationPasses.map(normalizePass),
    flags: state.flags.map(normalizeFlag),
    clearanceSnapshots: state.clearanceSnapshots.map(normalizeSnapshot),
    ruleSets,
    reinterpretations: Array.isArray(state.reinterpretations)
      ? state.reinterpretations
      : [],
  };
}

export interface StoredWorkspace {
  version: 2;
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
    version: 2,
    savedAt: new Date().toISOString(),
    state,
  };
  window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(stored));
}

export function clearWorkspaceStorage(): void {
  window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
}
