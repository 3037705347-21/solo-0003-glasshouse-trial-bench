import type { Accession, ObservationPass, WorkspaceState } from "../domain/types";
import { isWorkspaceState } from "./types";
import { createSampleWorkspaceState } from "./sampleData";
import {
  fingerprintObservationPass,
  mintIdempotencyToken,
} from "../domain/dedup";

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

/**
 * 为去重机制上线前保存的观测补齐身份三元组：
 * 指纹可从内容确定性地补算；幂等令牌补唯一值（保证旧数据不会误命中重试）；
 * 入库时刻未知，用观测日期近似（自动收敛窗口在时刻缺失时采取保守策略）。
 */
function normalizeObservationPass(pass: ObservationPass): ObservationPass {
  const entries = Array.isArray(pass.entries) ? pass.entries : [];
  const base: ObservationPass = {
    ...pass,
    entries,
    idempotencyToken: pass.idempotencyToken ?? `legacy_${mintIdempotencyToken()}`,
    contentFingerprint:
      pass.contentFingerprint ?? fingerprintObservationPass(pass),
    recordedAt: pass.recordedAt ?? `${pass.observedOn}T00:00:00.000Z`,
    dedupStatus: pass.dedupStatus ?? "canonical",
    convergedAccessionIds: Array.isArray(pass.convergedAccessionIds)
      ? pass.convergedAccessionIds
      : [],
  };
  if (!base.contentFingerprint) {
    base.contentFingerprint = fingerprintObservationPass(base);
  }
  return base;
}

export function normalizeWorkspaceState(
  state: WorkspaceState,
): WorkspaceState {
  return {
    ...state,
    accessions: state.accessions.map(normalizeAccession),
    observationPasses: state.observationPasses.map(normalizeObservationPass),
    duplicateReviews: Array.isArray(state.duplicateReviews)
      ? state.duplicateReviews
      : [],
    dedupAudits: Array.isArray(state.dedupAudits) ? state.dedupAudits : [],
  };
}

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
