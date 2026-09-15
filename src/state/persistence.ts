/**
 * 浏览器持久化网关。
 *
 * 与旧实现的根本区别：
 * - 存储缺失（首次使用）才返回示例工作区；损坏或升级失败绝不回退示例数据，
 *   因为那会让一次失败的升级在下一次保存时被示例数据静默覆盖。
 * - 升级采用“备份 → 迁移 → 原子提交”：
 *   1. 升级前把旧载荷逐字复制到备份键；
 *   2. 在内存里完成迁移与校验；
 *   3. 写回主键并立即读回校验往返一致，才算成功。
 *   任一步失败都返回失败结果，主键上的原始旧数据保持不动。
 * - 无法自动升级的原始载荷写入隔离键，供导出/人工修复/重试。
 */
import type { WorkspaceState } from "../domain/types";
import { migrateWorkspace } from "./migration/runner";
import { reconcileIssues } from "./migration/integrity";
import {
  CURRENT_SCHEMA_VERSION,
  ENVELOPE_VERSION,
  type MigrationIssue,
  type MigrationResult,
  type MigrationStepRecord,
  type StoredEnvelope,
} from "./migration/types";

export const WORKSPACE_STORAGE_KEY = "glasshouse-trial-bench:workspace:v1";
const BACKUP_KEY = "glasshouse-trial-bench:workspace:backup";
const QUARANTINE_KEY = "glasshouse-trial-bench:workspace:quarantine";

export interface StorageBackend {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultBackend(): StorageBackend | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// 加载结果
// ---------------------------------------------------------------------------

export type WorkspaceLoadOutcome =
  | {
      kind: "empty";
      state: WorkspaceState;
      issues: MigrationIssue[];
      isSample: true;
    }
  | {
      kind: "ready";
      state: WorkspaceState;
      issues: MigrationIssue[];
      history: MigrationStepRecord[];
      schemaVersion: number;
      isSample: false;
      /** 本次加载是否触发了版本升级（用于提示用户已自动完成无损升级）。 */
      upgraded: boolean;
    }
  | {
      kind: "recovery";
      reasonCode: string;
      message: string;
      /** 可导出的原始内容（损坏 JSON 时是原始字符串）。 */
      raw: unknown;
      /** 是否存在可回滚的升级前备份。 */
      hasBackup: boolean;
    };

export interface LoadWorkspaceOptions {
  storage?: StorageBackend;
  now?: string;
  /** 存储为空时提供的首启示例状态（仅此一处允许使用示例数据）。 */
  createSample: () => WorkspaceState;
}

export function loadWorkspace(options: LoadWorkspaceOptions): WorkspaceLoadOutcome {
  const storage = options.storage ?? defaultBackend();
  const now = options.now ?? new Date().toISOString();
  if (!storage) {
    // localStorage 不可用（隐私模式等）：等同首次使用，内存态运行，不持久化。
    return {
      kind: "empty",
      state: options.createSample(),
      issues: [],
      isSample: true,
    };
  }

  let raw: string | null;
  try {
    raw = storage.getItem(WORKSPACE_STORAGE_KEY);
  } catch {
    raw = null;
  }
  if (raw === null || raw === "") {
    return {
      kind: "empty",
      state: options.createSample(),
      issues: [],
      isSample: true,
    };
  }

  const result: MigrationResult = migrateWorkspace(raw, now);
  if (!result.ok) {
    // 隔离原始载荷，绝不覆盖、绝不用示例顶替。
    try {
      storage.setItem(
        QUARANTINE_KEY,
        JSON.stringify({ quarantinedAt: now, cause: result.code, raw: result.raw }),
      );
    } catch {
      // 隔离写入失败也不改变结论：原始主键仍在，恢复模式依旧可导出内存中的 raw。
    }
    let hasBackup = false;
    try {
      hasBackup = storage.getItem(BACKUP_KEY) !== null;
    } catch {
      hasBackup = false;
    }
    return {
      kind: "recovery",
      reasonCode: result.code,
      message: result.message,
      raw: result.raw,
      hasBackup,
    };
  }

  // 是否真的发生升级，以实际执行的迁移步骤为准（而非再次解析版本号，
  // 避免非整数/异常版本被误判）。
  const upgraded = result.ok && result.history.length > 0;

  // 发生升级时：先备份旧载荷，再原子提交新信封。
  if (upgraded) {
    const committed = commitUpgrade(storage, raw, result, now);
    if (!committed.ok) {
      return {
        kind: "recovery",
        reasonCode: "write_failed",
        message: committed.message ?? "升级结果无法安全写入，已保留旧数据。",
        raw,
        hasBackup: true,
      };
    }
  }

  // 未触发版本升级时，沿用信封中已保存的迁移历史；升级时由各步骤产生新历史。
  let history = result.history;
  let issues = result.issues;
  if (!upgraded) {
    try {
      const envelope = JSON.parse(raw) as Partial<StoredEnvelope>;
      if (Array.isArray(envelope.migrationHistory)) {
        history = envelope.migrationHistory;
      }
      if (Array.isArray(envelope.issues)) {
        // 与本次扫描对账：保留用户此前对同一问题的处理状态/备注，
        // 已消失的问题不再出现，新出现的问题以 open 加入。
        issues = reconcileIssues(envelope.issues, result.issues);
      }
    } catch {
      // 旧信封没有 issues/history（v1 应用写的）时，直接使用本次扫描结果。
    }
  }

  return {
    kind: "ready",
    state: result.state,
    issues,
    history,
    schemaVersion: result.schemaVersion,
    isSample: false,
    upgraded,
  };
}

// ---------------------------------------------------------------------------
// 保存
// ---------------------------------------------------------------------------

export interface SaveWorkspaceOptions {
  storage?: StorageBackend;
  now?: string;
}

export interface SaveResult {
  ok: boolean;
  message?: string;
}

function buildEnvelope(
  state: WorkspaceState,
  issues: MigrationIssue[],
  history: MigrationStepRecord[],
  savedAt: string,
  preMigrationSnapshot?: unknown,
): StoredEnvelope {
  return {
    envelopeVersion: ENVELOPE_VERSION,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    savedAt,
    state,
    issues,
    migrationHistory: history,
    ...(preMigrationSnapshot === undefined ? {} : { preMigrationSnapshot }),
  };
}

/** 日常保存。返回显式结果，绝不静默吞错（调用方需提示，且不得谎报已保存）。 */
export function saveWorkspace(
  state: WorkspaceState,
  issues: MigrationIssue[],
  history: MigrationStepRecord[],
  options: SaveWorkspaceOptions = {},
): SaveResult {
  const storage = options.storage ?? defaultBackend();
  if (!storage) {
    return { ok: false, message: "浏览器存储不可用，本次更改未能持久化。" };
  }
  const now = options.now ?? new Date().toISOString();

  // 保留既有升级前快照（若存在），它是上一次升级的后悔药。
  let snapshot: unknown;
  try {
    const existing = storage.getItem(WORKSPACE_STORAGE_KEY);
    if (existing) {
      const envelope = JSON.parse(existing) as Partial<StoredEnvelope>;
      if (envelope.preMigrationSnapshot !== undefined) {
        snapshot = envelope.preMigrationSnapshot;
      }
    }
  } catch {
    // 读旧信封失败不阻止保存（新数据来自已校验内存）。
  }

  const envelope = buildEnvelope(state, issues, history, now, snapshot);
  const serialized = JSON.stringify(envelope);
  return atomicWrite(storage, WORKSPACE_STORAGE_KEY, serialized);
}

/**
 * 升级提交流程：备份旧载荷 → 写新信封 → 读回校验。
 * 主键只在新信封完整写入且往返一致后才被替换。
 */
function commitUpgrade(
  storage: StorageBackend,
  previousRaw: string,
  migrated: {
    state: WorkspaceState;
    issues: MigrationIssue[];
    history: MigrationStepRecord[];
  },
  now: string,
): SaveResult {
  // 1. 逐字备份升级前载荷。
  try {
    storage.setItem(
      BACKUP_KEY,
      JSON.stringify({ backedUpAt: now, source: previousRaw }),
    );
  } catch (error) {
    return {
      ok: false,
      message: `无法在升级前备份工作区，已中止升级以保护旧数据：${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  // 2. 信封内保存升级前快照（逐字旧信封），作为第二份后悔药。
  let previousEnvelope: unknown = previousRaw;
  try {
    previousEnvelope = JSON.parse(previousRaw);
  } catch {
    previousEnvelope = previousRaw;
  }
  const envelope = buildEnvelope(
    migrated.state,
    migrated.issues,
    migrated.history,
    now,
    previousEnvelope,
  );

  // 3. 原子写入 + 读回校验。
  const write = atomicWrite(storage, WORKSPACE_STORAGE_KEY, JSON.stringify(envelope));
  if (!write.ok) {
    // 写入或读回校验失败：尽力把主键恢复成升级前的逐字旧载荷，
    // 保证“主键上的旧数据是权威版本”这一不变量。回滚结果无论成败都返回失败，
    // 绝不让一次不可信的写入被当作升级成功。
    const rollback = atomicWrite(storage, WORKSPACE_STORAGE_KEY, previousRaw);
    return {
      ok: false,
      message:
        write.message +
        (rollback.ok
          ? " 已回滚到升级前数据。"
          : " 且回滚失败，请立即导出数据，勿继续写入。"),
    };
  }
  return { ok: true };
}

/** 写入并立即读回校验往返一致；localStorage 一般为同步全量写，读回可捕获配额等问题。 */
function atomicWrite(storage: StorageBackend, key: string, value: string): SaveResult {
  try {
    storage.setItem(key, value);
  } catch (error) {
    return {
      ok: false,
      message: `写入工作区失败（可能是存储空间不足）：${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }
  let readBack: string | null = null;
  try {
    readBack = storage.getItem(key);
  } catch {
    readBack = null;
  }
  if (readBack !== value) {
    return {
      ok: false,
      message: "写入后读回校验不一致，本次保存不可信，请导出数据后重试。",
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// 恢复与维护
// ---------------------------------------------------------------------------

/** 导出主键当前内容（恢复模式下用于抢救原始数据）。 */
export function exportRawWorkspace(storage?: StorageBackend): string | null {
  const backend = storage ?? defaultBackend();
  if (!backend) {
    return null;
  }
  try {
    return backend.getItem(WORKSPACE_STORAGE_KEY);
  } catch {
    return null;
  }
}

/** 读取升级前备份的原始载荷。 */
export function readBackup(storage?: StorageBackend): unknown | undefined {
  const backend = storage ?? defaultBackend();
  if (!backend) {
    return undefined;
  }
  try {
    const raw = backend.getItem(BACKUP_KEY);
    return raw ? (JSON.parse(raw) as unknown) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * 用备份回滚主键（恢复模式人工操作）。回滚后下次加载会重新尝试升级。
 * 不删除隔离键，便于事后排查。
 */
export function restoreFromBackup(storage?: StorageBackend): SaveResult {
  const backend = storage ?? defaultBackend();
  if (!backend) {
    return { ok: false, message: "浏览器存储不可用。" };
  }
  let backup: { source?: string } | null = null;
  try {
    const raw = backend.getItem(BACKUP_KEY);
    backup = raw ? (JSON.parse(raw) as { source?: string }) : null;
  } catch {
    backup = null;
  }
  if (!backup || typeof backup.source !== "string") {
    return { ok: false, message: "没有可用的升级前备份。" };
  }
  return atomicWrite(backend, WORKSPACE_STORAGE_KEY, backup.source);
}

/** 用户显式重置：清空工作区并写入全新示例状态。必须在 UI 上二次确认。 */
export function resetToSample(
  createSample: () => WorkspaceState,
  storage?: StorageBackend,
): WorkspaceState {
  const backend = storage ?? defaultBackend();
  const state = createSample();
  if (backend) {
    const envelope = buildEnvelope(state, [], [], new Date().toISOString());
    // 重置是用户显式动作，尽力写入；即使失败也返回内存示例态（首启路径相同）。
    try {
      backend.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(envelope));
      backend.removeItem(QUARANTINE_KEY);
    } catch {
      // 见上：内存态仍可运行。
    }
  }
  return state;
}

export function clearWorkspaceStorage(storage?: StorageBackend): void {
  const backend = storage ?? defaultBackend();
  if (!backend) {
    return;
  }
  try {
    backend.removeItem(WORKSPACE_STORAGE_KEY);
  } catch {
    // 与旧行为一致：尽力清除。
  }
}
