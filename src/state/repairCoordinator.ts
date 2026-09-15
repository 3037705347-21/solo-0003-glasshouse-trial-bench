import type { WorkspaceState } from "../domain/types";
import { fingerprintState } from "../domain/quality/fingerprint";
import { applyFix } from "../domain/quality/fixes";
import type { PlannedFix } from "../domain/quality/fixes";
import {
  createRepairJournal,
  resolveRepairRecovery,
  rollbackRepair,
  abandonRepair,
  type RecoveryPhase,
} from "../domain/quality/repair";
import type { RepairArchive, RepairJournal } from "../domain/quality/types";
import type { StorageLike } from "./persistence";
import {
  loadRepairArchive,
  loadWorkspaceEnvelope,
  saveRepairArchive,
  saveWorkspaceState,
  emptyWorkspaceState,
} from "./persistence";

export interface CrashInjection {
  /** 在第 afterWriteCount 次成功持久化之后立即抛出（模拟进程中断）。从 1 开始。 */
  afterWriteCount?: number;
  /** 让某次写入本身抛错（存储满/隐私模式）。从 1 开始。 */
  failWriteCount?: number;
}

export class InjectedCrash extends Error {
  constructor(public boundary: string, public writeCount: number) {
    super(`模拟崩溃：${boundary} 第 ${writeCount} 次写入后`);
    this.name = "InjectedCrash";
  }
}

class WriteCounter {
  count = 0;
}

/**
 * 包装一次修复流程中的所有持久化写入，按顺序计数，便于故障注入测试
 * 精确命中“任意一次写入后中断”的边界。
 */
function crashablePersist(
  storage: StorageLike,
  injection: CrashInjection | undefined,
  counter: WriteCounter,
  boundary: string,
  write: () => void,
): void {
  counter.count += 1;
  const ordinal = counter.count;
  if (injection?.failWriteCount === ordinal) {
    throw new InjectedCrash(`${boundary}（写入失败）`, ordinal);
  }
  write();
  if (injection?.afterWriteCount === ordinal) {
    throw new InjectedCrash(boundary, ordinal);
  }
}

export interface StartRepairResult {
  journal: RepairJournal;
  state: WorkspaceState;
  writes: number;
  crashed: boolean;
}

/**
 * 启动并执行一整批可恢复修复。
 *
 * 写入边界（每次都会先持久化工作区，再持久化会话，保证两边可对账）：
 *   1. 创建会话（stateBefore == 当前状态）
 *   2. 每个修复项执行后：落盘累计工作区，再落盘会话（item 状态与 stateAfter）
 *   3. 全部完成：最终工作区 + completed 会话归档
 *
 * 预演后若工作区指纹已变化（其他页面/窗口/外部写入），直接判冲突，
 * 不写入任何部分结果。
 */
export function startRepairBatch(
  storage: StorageLike,
  plans: PlannedFix[],
  options: {
    now?: string;
    injection?: CrashInjection;
    /** 调用方预演时的工作区指纹；省略时从存储重新读取计算。 */
    expectedFingerprint?: string;
  } = {},
): StartRepairResult {
  const now = options.now ?? new Date().toISOString();
  const counter = new WriteCounter();
  const envelope = loadWorkspaceEnvelope(storage);
  const current = envelope?.state ?? emptyWorkspaceState();
  const currentFingerprint = fingerprintState(current);
  const expected = options.expectedFingerprint ?? currentFingerprint;

  if (currentFingerprint !== expected) {
    throw new ConcurrentModificationError(
      "工作区在预演后被其他页面、窗口或外部写入改变，整批修复未启动。",
    );
  }

  const journal = createRepairJournal({ stateBefore: current, plans, now });
  const archive = loadRepairArchive(storage);

  let working = current;

  try {
    // 边界 1：会话先落盘（此时工作区已在存储中，指纹一致）。
    crashablePersist(storage, options.injection, counter, "创建会话", () => {
      saveRepairArchive(storage, { ...archive, active: journal });
    });

    // 边界 2..n+1：逐项执行；每项先写工作区，再写会话。
    journal.items.forEach((item, index) => {
      if (!item.fix) {
        item.status = "already-fixed";
        return;
      }
      const outcome = applyFix(working, item.fix);
      working = outcome.state;
      item.changes = [...item.changes, ...outcome.changes];
      if (outcome.status === "conflict") {
        item.status = "conflict";
        item.conflictReason = outcome.conflictReason;
        const conflictedJournal: RepairJournal = {
          ...journal,
          items: [...journal.items],
          status: "conflicted",
          updatedAt: now,
          conflictReason: outcome.conflictReason,
          recoveryLog: [
            ...journal.recoveryLog,
            { at: now, event: "conflict", detail: `第 ${index + 1} 项冲突：${outcome.conflictReason}` },
          ],
        };
        saveRepairArchive(storage, { ...loadRepairArchive(storage), active: conflictedJournal });
        throw new ItemConflictError(outcome.conflictReason ?? "修复项冲突");
      }
      item.status = outcome.status;
      item.conflictReason = undefined;
      item.appliedAt = outcome.status === "applied" ? now : item.appliedAt;

      const stepJournal: RepairJournal = {
        ...journal,
        items: [...journal.items],
        updatedAt: now,
        stateAfter: working,
        recoveryLog: [
          ...journal.recoveryLog,
          {
            at: now,
            event: outcome.status === "applied" ? "item-applied" : "item-already-fixed",
            detail: item.ruleCode,
          },
        ],
      };

      crashablePersist(storage, options.injection, counter, `修复项 ${item.ruleCode}：工作区`, () => {
        saveWorkspaceState(working, storage);
      });
      crashablePersist(storage, options.injection, counter, `修复项 ${item.ruleCode}：会话`, () => {
        saveRepairArchive(storage, { ...loadRepairArchive(storage), active: stepJournal });
      });
    });

    // 全部成功：把工作区终态和 completed 会话写入。
    const finished: RepairJournal = {
      ...journal,
      status: "completed",
      outcome: "applied",
      stateAfter: working,
      completedAt: now,
      updatedAt: now,
    };
    crashablePersist(storage, options.injection, counter, "完成：工作区", () => {
      saveWorkspaceState(working, storage);
    });
    crashablePersist(storage, options.injection, counter, "完成：会话归档", () => {
      const currentArchive = loadRepairArchive(storage);
      const history = [finished, ...currentArchive.history.filter((h) => h.id !== finished.id)].slice(0, 20);
      saveRepairArchive(storage, { active: null, history });
    });

    return { journal: finished, state: working, writes: counter.count, crashed: false };
  } catch (error) {
    if (error instanceof InjectedCrash) {
      // 模拟进程中断：写入已落盘到崩溃前一刻，异常向上传播，
      // 由测试（或真实环境的下次启动）通过 resumeRepairBatch 恢复。
      throw error;
    }
    if (error instanceof ItemConflictError) {
      return {
        journal: loadRepairArchive(storage).active ?? journal,
        state: loadWorkspaceEnvelope(storage)?.state ?? working,
        writes: counter.count,
        crashed: false,
      };
    }
    throw error;
  }
}

export class ConcurrentModificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConcurrentModificationError";
  }
}

export class ItemConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ItemConflictError";
  }
}

export interface ResumeResult {
  phase: RecoveryPhase;
  journal: RepairJournal;
  state: WorkspaceState;
  applied: number;
  alreadyFixed: number;
  detail: string;
  writes: number;
}

/**
 * 启动时恢复：重新读取工作区和活动会话，凭指纹对账实际进度。
 * - 会话完成但工作区未保存：幂等补放；
 * - 工作区已保存但会话未完成：只补写会话；
 * - 部分执行：从前缀继续；
 * - 并发偏离：标记 conflicted 且保持当前工作区不变。
 */
export function resumeRepairBatch(
  storage: StorageLike,
  options: { now?: string; injection?: CrashInjection } = {},
): ResumeResult | null {
  const archive = loadRepairArchive(storage);
  const journal = archive.active;
  if (!journal) {
    return null;
  }
  const now = options.now ?? new Date().toISOString();
  const current = loadWorkspaceEnvelope(storage)?.state ?? emptyWorkspaceState();
  const recovery = resolveRepairRecovery(journal, current, now);

  const counter = new WriteCounter();

  if (recovery.phase === "completed" || recovery.phase === "nothing-to-do") {
    return {
      phase: recovery.phase,
      journal: recovery.journal,
      state: current,
      applied: 0,
      alreadyFixed: 0,
      detail: recovery.detail,
      writes: 0,
    };
  }

  if (recovery.phase === "conflict") {
    crashablePersist(storage, options.injection, counter, "冲突会话落盘", () => {
      const latest = loadRepairArchive(storage);
      saveRepairArchive(storage, { ...latest, active: recovery.journal });
    });
    return {
      phase: "conflict",
      journal: recovery.journal,
      state: recovery.state,
      applied: 0,
      alreadyFixed: 0,
      detail: recovery.detail,
      writes: counter.count,
    };
  }

  // resumed / already-applied：把对账后的工作区和会话写回（幂等）。
  if (fingerprintState(current) !== fingerprintState(recovery.state)) {
    crashablePersist(storage, options.injection, counter, "恢复：工作区补写", () => {
      saveWorkspaceState(recovery.state, storage);
    });
  }

  let activeAfter: RepairJournal;
  if (recovery.journal.status === "completed") {
    crashablePersist(storage, options.injection, counter, "恢复：会话归档", () => {
      const latest = loadRepairArchive(storage);
      const history = [
        recovery.journal,
        ...latest.history.filter((h) => h.id !== recovery.journal.id),
      ].slice(0, 20);
      saveRepairArchive(storage, { active: null, history });
    });
    activeAfter = recovery.journal;
  } else {
    crashablePersist(storage, options.injection, counter, "恢复：会话补写", () => {
      const latest = loadRepairArchive(storage);
      saveRepairArchive(storage, { ...latest, active: recovery.journal });
    });
    activeAfter = recovery.journal;
  }

  return {
    phase: recovery.phase,
    journal: activeAfter,
    state: recovery.state,
    applied: recovery.applied,
    alreadyFixed: recovery.alreadyFixed,
    detail: recovery.detail,
    writes: counter.count,
  };
}

/** 人工整批回滚：恢复修复前快照并归档会话。 */
export function rollbackRepairBatch(
  storage: StorageLike,
  options: { now?: string; injection?: CrashInjection } = {},
): RepairJournal | null {
  const archive = loadRepairArchive(storage);
  const journal = archive.active;
  if (!journal) {
    return null;
  }
  const now = options.now ?? new Date().toISOString();
  const counter = new WriteCounter();
  const result = rollbackRepair(journal, now);

  crashablePersist(storage, options.injection, counter, "回滚：工作区", () => {
    saveWorkspaceState(result.state, storage);
  });
  crashablePersist(storage, options.injection, counter, "回滚：会话归档", () => {
    const latest = loadRepairArchive(storage);
    const history = [
      result.journal,
      ...latest.history.filter((h) => h.id !== result.journal.id),
    ].slice(0, 20);
    saveRepairArchive(storage, { active: null, history });
  });
  return result.journal;
}

/** 放弃会话：工作区保持不变，仅归档为 abandoned。 */
export function abandonRepairBatch(
  storage: StorageLike,
  options: { now?: string } = {},
): RepairJournal | null {
  const archive = loadRepairArchive(storage);
  const journal = archive.active;
  if (!journal) {
    return null;
  }
  const finished = abandonRepair(journal, options.now ?? new Date().toISOString());
  const history = [finished, ...archive.history.filter((h) => h.id !== finished.id)].slice(0, 20);
  saveRepairArchive(storage, { active: null, history });
  return finished;
}
