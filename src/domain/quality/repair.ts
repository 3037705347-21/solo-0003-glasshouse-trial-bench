import { createId } from "../id";
import type { WorkspaceState } from "../types";
import { applyFix } from "./fixes";
import type {
  PlannedFix,
} from "./fixes";
import type {
  FixSpec,
  QualityFinding,
  RepairArchive,
  RepairItemRecord,
  RepairJournal,
} from "./types";

export interface CreateJournalInput {
  stateBefore: WorkspaceState;
  plans: PlannedFix[];
  now?: string;
}

function toPendingRecord(plan: PlannedFix): RepairItemRecord {
  return {
    findingId: plan.finding.id,
    ruleCode: plan.finding.ruleCode,
    severity: plan.finding.severity,
    title: plan.finding.title,
    action: plan.finding.fix?.action ?? plan.finding.title,
    fix: plan.finding.fix,
    status: "pending",
    changes: [],
  };
}

/**
 * 创建修复会话：冻结修复前快照，把用户勾选的每一项登记为 pending。
 * 之后无论执行中断在何处，都可以从这份日志继续或整批回滚。
 */
export function createRepairJournal(input: CreateJournalInput): RepairJournal {
  const now = input.now ?? new Date().toISOString();
  return {
    id: createId("rpr"),
    startedAt: now,
    updatedAt: now,
    status: "in_progress",
    stateBefore: input.stateBefore,
    items: input.plans.map(toPendingRecord),
  };
}

export interface AdvanceResult {
  journal: RepairJournal;
  state: WorkspaceState;
  applied: number;
  skipped: number;
}

/**
 * 在给定状态上推进一个修复会话：所有 pending 项幂等重放。
 * - 问题已不存在（用户手工处理或上一轮已执行）→ already-fixed，不报错
 * - 预演后状态发生计划外变化 → conflict，保留给用户重新扫描
 * 每执行一项就更新对应审计记录，因此中断后日志与状态始终可对账。
 */
export function advanceRepair(
  journal: RepairJournal,
  state: WorkspaceState,
  now: string = new Date().toISOString(),
): AdvanceResult {
  let working = state;
  let applied = 0;
  let skipped = 0;
  const items = journal.items.map((item) => ({ ...item, changes: [...item.changes] }));

  items.forEach((item) => {
    if (item.status !== "pending") {
      return;
    }
    if (!item.fix) {
      skipped += 1;
      return;
    }
    const outcome = applyFix(working, item.fix as FixSpec);
    working = outcome.state;
    item.status = outcome.status;
    item.changes = [...item.changes, ...outcome.changes];
    item.conflictReason = outcome.conflictReason;
    if (outcome.status === "applied") {
      item.appliedAt = now;
      applied += 1;
    } else {
      skipped += 1;
    }
  });

  const next: RepairJournal = { ...journal, items, updatedAt: now };
  const pendingLeft = next.items.some((item) => item.status === "pending");
  if (!pendingLeft) {
    next.status = "completed";
    next.stateAfter = working;
    next.completedAt = now;
    next.outcome = next.items.some((item) => item.status === "conflict")
      ? undefined
      : "applied";
  }
  return { journal: next, state: working, applied, skipped };
}

/**
 * 中断恢复时，先按当前状态重新对账：修复项对应的问题是否仍存在。
 * 返回仍需要执行的计划，保证不会对已经消失的问题重复执行。
 */
export function reconcilePendingPlans(
  journal: RepairJournal,
  findings: QualityFinding[],
): PlannedFix[] {
  const liveById = new Map(findings.map((finding) => [finding.id, finding]));
  return journal.items
    .filter((item) => item.status === "pending" && item.fix)
    .map((item) => {
      const finding = liveById.get(item.findingId);
      if (!finding || !finding.fix) {
        return null;
      }
      return { finding, fix: finding.fix };
    })
    .filter((item): item is PlannedFix => item !== null);
}

/** 整批回滚：恢复修复前冻结的状态快照（审计日志保留为 rolled-back）。 */
export function rollbackRepair(
  journal: RepairJournal,
  now: string = new Date().toISOString(),
): { journal: RepairJournal; state: WorkspaceState } {
  return {
    journal: {
      ...journal,
      status: "completed",
      outcome: "rolled-back",
      completedAt: now,
      updatedAt: now,
    },
    state: journal.stateBefore,
  };
}

/** 放弃恢复：保留当前状态，仅关闭会话（审计日志保留为 abandoned）。 */
export function abandonRepair(
  journal: RepairJournal,
  now: string = new Date().toISOString(),
): RepairJournal {
  return {
    ...journal,
    status: "completed",
    outcome: "abandoned",
    completedAt: now,
    updatedAt: now,
  };
}

export function pendingItems(journal: RepairJournal): RepairItemRecord[] {
  return journal.items.filter((item) => item.status === "pending");
}

/** 把完成的会话归入历史；同一 id 的旧记录被新结果替换。 */
export function archiveJournal(archive: RepairArchive, journal: RepairJournal): RepairArchive {
  const history = [journal, ...archive.history.filter((item) => item.id !== journal.id)];
  return { active: null, history: history.slice(0, 20) };
}
