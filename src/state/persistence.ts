import type {
  Accession,
  ObservationPass,
  WorkspaceState,
} from "../domain/types";
import { ok, type Result } from "../domain/result";
import { isWorkspaceState } from "./types";
import { createSampleWorkspaceState } from "./sampleData";

export const WORKSPACE_STORAGE_KEY = "glasshouse-trial-bench:workspace:v1";
export const WORKSPACE_LOCK_NAME = "glasshouse-trial-bench:workspace-lock";

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

function normalizeObservationPass(pass: ObservationPass): ObservationPass {
  return {
    ...pass,
    seriesId: pass.seriesId ?? pass.id,
  };
}

export function normalizeWorkspaceState(
  state: WorkspaceState,
): WorkspaceState {
  return {
    ...state,
    accessions: state.accessions.map(normalizeAccession),
    observationPasses: state.observationPasses.map(normalizeObservationPass),
  };
}

export interface StoredWorkspace {
  version: 1;
  /** 共享状态的单调递增修订号，每次成功写入 +1，用于检测跨页面并发写入 */
  revision: number;
  savedAt: string;
  state: WorkspaceState;
}

function emptyEnvelope(): StoredWorkspace {
  return {
    version: 1,
    revision: 0,
    savedAt: "",
    state: createSampleWorkspaceState(),
  };
}

/**
 * 读取共享工作区信封（含修订号）。存储缺失或损坏时回退到示例工作区，
 * 与既有行为一致；旧版存储缺少 revision 字段时按 0 处理。
 */
export function readWorkspaceEnvelope(): StoredWorkspace {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) {
      return emptyEnvelope();
    }
    const parsed = JSON.parse(raw) as Partial<StoredWorkspace>;
    if (!parsed || !isWorkspaceState(parsed.state)) {
      return emptyEnvelope();
    }
    return {
      version: 1,
      revision:
        typeof parsed.revision === "number" && parsed.revision >= 0
          ? parsed.revision
          : 0,
      savedAt: typeof parsed.savedAt === "string" ? parsed.savedAt : "",
      state: normalizeWorkspaceState(parsed.state),
    };
  } catch {
    return emptyEnvelope();
  }
}

export function writeWorkspaceEnvelope(
  state: WorkspaceState,
  revision: number,
): StoredWorkspace {
  const envelope: StoredWorkspace = {
    version: 1,
    revision,
    savedAt: new Date().toISOString(),
    state,
  };
  window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(envelope));
  return envelope;
}

export function sameWorkspaceState(
  left: WorkspaceState,
  right: WorkspaceState,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

// ---------------------------------------------------------------------------
// 跨页面互斥
//
// 同一浏览器打开多个页面时，localStorage 是共享状态。所有"读-改-写"序列
// 都通过 runWorkspaceTask 排队：标签页内用 Promise 链保证先进先出，标签页
// 之间用 Web Locks 互斥；不支持 Web Locks 时退化为标签页内串行。
// ---------------------------------------------------------------------------

let taskQueue: Promise<unknown> = Promise.resolve();

export function runWorkspaceTask<T>(task: () => T): Promise<T> {
  const run = taskQueue.then(() => {
    const locks =
      typeof navigator !== "undefined" && navigator.locks
        ? navigator.locks
        : undefined;
    return locks ? locks.request(WORKSPACE_LOCK_NAME, task) : task();
  });
  taskQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

/**
 * 工作区事务：在互斥锁内读取最新共享状态、执行变更（含校验）、写回。
 * 校验失败时不写入任何内容，已提交的共享状态保持不变。
 */
export async function commitWorkspaceTransaction<T>(
  transact: (
    state: WorkspaceState,
  ) => Result<{ state: WorkspaceState; value: T }>,
): Promise<Result<{ value: T; envelope: StoredWorkspace }>> {
  return runWorkspaceTask(() => {
    const envelope = readWorkspaceEnvelope();
    const outcome = transact(envelope.state);
    if (!outcome.ok) {
      return outcome;
    }
    const next = writeWorkspaceEnvelope(
      outcome.value.state,
      envelope.revision + 1,
    );
    return ok({ value: outcome.value.value, envelope: next });
  });
}

export function clearWorkspaceStorage(): void {
  window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
}
