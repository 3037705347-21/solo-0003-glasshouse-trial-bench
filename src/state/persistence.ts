import type { AuditEntry } from "../domain/audit";
import { isAuditEntry } from "../domain/audit";
import type { WorkspaceState } from "../domain/types";
import { isWorkspaceState } from "./types";
import { createSampleWorkspaceState } from "./sampleData";

export const WORKSPACE_STORAGE_KEY = "glasshouse-trial-bench:workspace:v1";
export const AUDIT_STORAGE_KEY = "glasshouse-trial-bench:audit:v1";

export interface StoredWorkspace {
  version: 1;
  savedAt: string;
  state: WorkspaceState;
}

export interface StoredAuditLog {
  version: 1;
  savedAt: string;
  entries: AuditEntry[];
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
    return parsed.state;
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

/**
 * 审计日志是只追加的：读取时逐条校验，丢弃损坏或无法识别的条目，
 * 其余条目按 seq 排序保留。缺失时返回空日志（示例数据不补造历史）。
 */
export function loadAuditLog(): AuditEntry[] {
  try {
    const raw = window.localStorage.getItem(AUDIT_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as Partial<StoredAuditLog>;
    if (!parsed || !Array.isArray(parsed.entries)) {
      return [];
    }
    return parsed.entries
      .filter(isAuditEntry)
      .sort((left, right) => left.seq - right.seq);
  } catch {
    return [];
  }
}

export function saveAuditLog(entries: AuditEntry[]): void {
  const stored: StoredAuditLog = {
    version: 1,
    savedAt: new Date().toISOString(),
    entries,
  };
  window.localStorage.setItem(AUDIT_STORAGE_KEY, JSON.stringify(stored));
}
