import { createId } from "../id";
import type { WorkspaceState } from "../types";
import { fingerprintState } from "./fingerprint";
import { applyFix } from "./fixes";
import type { PlannedFix } from "./fixes";
import type {
  FixSpec,
  QualityFinding,
  RepairArchive,
  RepairItemRecord,
  RepairJournal,
  RepairPhase,
} from "./types";

export type RecoveryPhase = RepairPhase;

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
 * 创建修复会话：冻结修复前快照与指纹，把勾选的每一项登记为 pending。
 * 之后无论在哪个写入边界中断，都能凭指纹对账恢复。
 */
export function createRepairJournal(input: CreateJournalInput): RepairJournal {
  const now = input.now ?? new Date().toISOString();
  const fingerprint = fingerprintState(input.stateBefore);
  return {
    version: 2,
    id: createId("rpr"),
    startedAt: now,
    updatedAt: now,
    status: "in_progress",
    stateBefore: input.stateBefore,
    stateBeforeFingerprint: fingerprint,
    previewFingerprint: fingerprint,
    items: input.plans.map(toPendingRecord),
    recoveryLog: [{ at: now, event: "created", detail: `登记 ${input.plans.length} 个修复项` }],
  };
}

/** 在内存中按顺序应用全部修复，返回每一步的状态序列（第 0 项是修复前状态）。 */
function simulateSteps(journal: RepairJournal): WorkspaceState[] {
  const steps: WorkspaceState[] = [journal.stateBefore];
  let working = journal.stateBefore;
  journal.items.forEach((item) => {
    if (!item.fix) {
      steps.push(working);
      return;
    }
    const outcome = applyFix(working, item.fix as FixSpec);
    working = outcome.state;
    steps.push(working);
  });
  return steps;
}

export interface RecoveryResult {
  phase: RecoveryPhase;
  /** 对账后应当持久化的工作区状态；冲突时等于传入的 currentState（原状态）。 */
  state: WorkspaceState;
  journal: RepairJournal;
  applied: number;
  alreadyFixed: number;
  conflicts: RepairItemRecord[];
  /** 对账判定依据，写入 recoveryLog 供追溯。 */
  detail: string;
}

/**
 * 纯函数恢复状态机：根据会话与“当前实际工作区”判断进度。
 *
 * 回滚意图（intent === "rollback"）优先级最高：
 * 只要用户已经选择回滚，恢复时只把工作区写回修复前快照并归档，
 * 绝不重新应用修复——无论工作区当前停在修复前、某个中间前缀还是终态。
 *
 * 修复意图（intent === "apply" 或缺省）的可能组合：
 * - 会话待执行，工作区 == 修复前：从头幂等执行；
 * - 部分执行，工作区落在某一步的前缀状态：从该步继续，不重复已生效的修复；
 * - 会话已完成但工作区未保存（停在任一步前缀）：幂等补放到终态；
 * - 工作区已保存终态但会话仍 in_progress/completed active：只补写会话，绝不再动工作区；
 * - 工作区既非修复前也非任何前缀（其他页面/窗口/外部写入）：冲突，保持原状态。
 */
export function resolveRepairRecovery(
  journal: RepairJournal,
  currentState: WorkspaceState,
  now: string = new Date().toISOString(),
): RecoveryResult {
  // ---- 回滚意图：任何回滚写入边界中断后都收敛到修复前状态 ----
  if (journal.intent === "rollback") {
    return resolveRollbackRecovery(journal, currentState, now);
  }

  const steps = simulateSteps(journal);
  const finalState = steps[steps.length - 1];
  const currentFingerprint = fingerprintState(currentState);

  const log = (event: string, detail: string): RepairJournal => ({
    ...journal,
    updatedAt: now,
    recoveryLog: [...journal.recoveryLog, { at: now, event, detail }],
  });

  // 终态已在工作区：无论会话标记如何，都不再触碰工作区。
  if (currentFingerprint === fingerprintState(finalState)) {
    // completed active + 终态工作区：补写归档所需的完成信息（仍由协调器清除 active）。
    const finalized =
      journal.status === "completed"
        ? journal.outcome
          ? journal
          : finalizeJournal(
              log("complete-active-archive", "会话已完成且工作区为终态，补全会话归档"),
              currentState,
              now,
              "applied",
            )
        : finalizeJournal(
            log("already-applied", "工作区已是终态，补写会话完成状态，不重复执行修复"),
            currentState,
            now,
            "applied",
          );
    return {
      phase: journal.status === "completed" ? "completed" : "already-applied",
      state: currentState,
      journal: finalized,
      applied: 0,
      alreadyFixed: journal.status === "completed" ? 0 : countNotPending(journal),
      conflicts: [],
      detail:
        journal.status === "completed"
          ? "会话已完成，等待归档"
          : "工作区已保存终态，会话尚未标记完成：仅补写会话",
    };
  }

  // 找到当前状态对应的执行前缀（0 = 修复前，n = 终态，终态已在上面处理）。
  let prefixIndex = -1;
  for (let index = 0; index < steps.length - 1; index += 1) {
    if (fingerprintState(steps[index]) === currentFingerprint) {
      prefixIndex = index;
      break;
    }
  }

  if (prefixIndex === -1) {
    // 当前工作区不是修复前（指纹不匹配），也不是任何可识别的中间状态：
    // 预演后被其他页面、窗口或外部写入改变。保持原状态，停止自动流程。
    const conflicted: RepairJournal = {
      ...log("conflict", "工作区相对修复前快照和所有中间状态都不一致，疑似并发写入"),
      status: "conflicted",
      conflictReason:
        "工作区在预演后被其他页面、窗口或外部写入改变。为避免只应用部分修复，自动流程已停止，当前数据保持不变。",
    };
    return {
      phase: "conflict",
      state: currentState,
      journal: conflicted,
      applied: 0,
      alreadyFixed: 0,
      conflicts: [],
      detail: conflicted.conflictReason ?? "并发冲突",
    };
  }

  if (journal.items.length === 0) {
    return {
      phase: "nothing-to-do",
      state: currentState,
      journal: finalizeJournal(journal, currentState, now, "applied"),
      applied: 0,
      alreadyFixed: 0,
      conflicts: [],
      detail: "会话没有修复项",
    };
  }

  // 从前缀继续：对剩余项在“当前状态”上幂等重放；已生效项返回 already-fixed。
  let working = currentState;
  let applied = 0;
  let alreadyFixed = 0;
  const conflicts: RepairItemRecord[] = [];
  const items = journal.items.map((item) => ({ ...item, changes: [...item.changes] }));

  items.forEach((item, index) => {
    if (index < prefixIndex) {
      // 已经体现在当前状态中的步骤：不重跑；其效果计入“已修复/跳过”。
      if (item.status === "pending") {
        item.status = "already-fixed";
      }
      alreadyFixed += 1;
      return;
    }
    if (!item.fix) {
      item.status = "already-fixed";
      return;
    }
    const outcome = applyFix(working, item.fix as FixSpec);
    working = outcome.state;
    if (outcome.status === "conflict") {
      item.status = "conflict";
      item.conflictReason = outcome.conflictReason;
      conflicts.push(item);
      return;
    }
    item.changes = [...item.changes, ...outcome.changes];
    item.conflictReason = undefined;
    if (outcome.status === "applied") {
      item.status = "applied";
      item.appliedAt = item.appliedAt ?? now;
      applied += 1;
    } else {
      item.status = "already-fixed";
      alreadyFixed += 1;
    }
  });

  if (conflicts.length > 0) {
    const conflicted: RepairJournal = {
      ...journal,
      items,
      status: "conflicted",
      updatedAt: now,
      conflictReason: `续跑时有 ${conflicts.length} 项与当前数据冲突，工作区保持为最后一次成功步骤后的状态。`,
      recoveryLog: [
        ...journal.recoveryLog,
        { at: now, event: "conflict", detail: `前缀 ${prefixIndex} 后续跑出现冲突项` },
      ],
    };
    return {
      phase: "conflict",
      state: working,
      journal: conflicted,
      applied,
      alreadyFixed,
      conflicts,
      detail: conflicted.conflictReason ?? "续跑冲突",
    };
  }

  const resumed = log(
    journal.status === "completed" ? "reapply-after-unsaved" : "resumed",
    `识别到前缀步骤 ${prefixIndex}/${journal.items.length}，幂等续跑剩余修复`,
  );
  const completed = finalizeJournal(
    { ...resumed, items },
    working,
    now,
    "applied",
  );
  return {
    phase: journal.status === "completed" ? "resumed" : "resumed",
    state: working,
    journal: completed,
    applied,
    alreadyFixed,
    conflicts: [],
    detail: `从前缀步骤 ${prefixIndex} 继续，执行 ${applied} 项，跳过 ${alreadyFixed} 项`,
  };
}

function countNotPending(journal: RepairJournal): number {
  return journal.items.filter((item) => item.status !== "pending").length;
}

/**
 * 回滚恢复：用户已选择整批回滚（intent 已持久化）。
 * - 工作区已是修复前状态：只归档会话（rollback-completed）；
 * - 工作区停在修复终态或任一中间前缀：写回修复前状态（rollback-resumed）。
 * 任何情况下都不再执行修复项。
 */
function resolveRollbackRecovery(
  journal: RepairJournal,
  currentState: WorkspaceState,
  now: string,
): RecoveryResult {
  const beforeFingerprint =
    journal.stateBeforeFingerprint ?? fingerprintState(journal.stateBefore);
  const currentFingerprint = fingerprintState(currentState);
  const targetState = journal.stateBefore;

  if (currentFingerprint === beforeFingerprint) {
    // 工作区已写回修复前状态（或本来就停在那里）：只需归档会话。
    const archived: RepairJournal = {
      ...journal,
      status: "completed",
      outcome: "rolled-back",
      stateAfter: targetState,
      completedAt: journal.completedAt ?? now,
      updatedAt: now,
      recoveryLog: journal.completedAt
        ? journal.recoveryLog
        : [
            ...journal.recoveryLog,
            {
              at: now,
              event: "rollback-recovered-archive",
              detail: "回滚工作区已写入、归档中断：重启后只补归档，不重新应用修复",
            },
          ],
    };
    return {
      phase: "rollback-completed",
      state: currentState,
      journal: archived,
      applied: 0,
      alreadyFixed: 0,
      conflicts: [],
      detail: "工作区已是修复前状态，补写回滚归档",
    };
  }

  // 工作区不在修复前状态（终态/中间态/未知）：回滚意图优先，写回修复前快照。
  const archived: RepairJournal = {
    ...journal,
    status: "completed",
    outcome: "rolled-back",
    stateAfter: targetState,
    completedAt: journal.completedAt ?? now,
    updatedAt: now,
    recoveryLog: [
      ...journal.recoveryLog,
      {
        at: now,
        event: "rollback-recovered-write",
        detail: "回滚意图已持久化但工作区未写回：重启后恢复到修复前状态，不重新应用修复",
      },
    ],
  };
  return {
    phase: "rollback-resumed",
    state: targetState,
    journal: archived,
    applied: 0,
    alreadyFixed: 0,
    conflicts: [],
    detail: "按已确认的回滚意图恢复到修复前状态",
  };
}

function finalizeJournal(
  journal: RepairJournal,
  stateAfter: WorkspaceState,
  now: string,
  outcome: "applied",
): RepairJournal {
  return {
    ...journal,
    status: "completed",
    outcome,
    stateAfter,
    completedAt: journal.completedAt ?? now,
    updatedAt: now,
  };
}

/**
 * 标记会话为“回滚意图”。这个标记必须在回滚的任何工作区写入之前落盘：
 * 之后无论在哪个写入边界中断，重启都只完成回滚。
 */
export function markRollbackIntent(
  journal: RepairJournal,
  now: string = new Date().toISOString(),
): RepairJournal {
  if (journal.intent === "rollback") {
    return journal;
  }
  return {
    ...journal,
    intent: "rollback",
    updatedAt: now,
    recoveryLog: [
      ...journal.recoveryLog,
      { at: now, event: "rollback-intent", detail: "用户确认整批回滚，意图已持久化" },
    ],
  };
}

/** 整批回滚（内存）：标记回滚意图并返回修复前状态。持久化由协调器负责。 */
export function rollbackRepair(
  journal: RepairJournal,
  now: string = new Date().toISOString(),
): { journal: RepairJournal; state: WorkspaceState } {
  const marked = markRollbackIntent(journal, now);
  return {
    journal: {
      ...marked,
      status: "completed",
      outcome: "rolled-back",
      completedAt: now,
      updatedAt: now,
      stateAfter: journal.stateBefore,
      recoveryLog: [
        ...marked.recoveryLog,
        { at: now, event: "rolled-back", detail: "人工触发整批回滚" },
      ],
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
    recoveryLog: [...journal.recoveryLog, { at: now, event: "abandoned", detail: "人工放弃会话，当前数据保持不变" }],
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

/** 旧的内存式推进接口（供不经过持久化协调器的调用点使用）。 */
export interface AdvanceResult {
  journal: RepairJournal;
  state: WorkspaceState;
  applied: number;
  skipped: number;
}

export function advanceRepair(
  journal: RepairJournal,
  state: WorkspaceState,
  now: string = new Date().toISOString(),
): AdvanceResult {
  const result = resolveRepairRecovery(journal, state, now);
  return {
    journal: result.journal,
    state: result.state,
    applied: result.applied,
    skipped: result.alreadyFixed,
  };
}

/** 恢复时用最新扫描结果对账 pending 计划（UI 列表使用）。 */
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
