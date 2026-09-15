import type { Bench, WorkspaceState } from "../types";
import { scanWorkspace } from "./checks";
import type {
  FixOutcome,
  FixSpec,
  QualityFinding,
  QualityReport,
  RepairItemRecord,
} from "./types";

function cloneState(state: WorkspaceState): WorkspaceState {
  return structuredClone(state);
}

function updateBench(
  state: WorkspaceState,
  benchId: string,
  mutate: (bench: Bench) => Bench,
): WorkspaceState {
  return {
    ...state,
    benches: state.benches.map((bench) =>
      bench && typeof bench === "object" && bench.id === benchId
        ? mutate(bench)
        : bench,
    ),
  };
}

/** 按占用列表派生台架状态；停用/隔离状态不被自动改写。 */
export function reconcileBenchStatus(bench: Bench): Bench {
  if (bench.status === "blocked" || bench.status === "quarantine") {
    return bench;
  }
  const occupied = new Set(bench.assignedIds).size > 0;
  const next = occupied ? "assigned" : "available";
  return bench.status === next ? bench : { ...bench, status: next };
}

/**
 * 应用单条修复。所有修复都是幂等的：
 * 重复执行同一修复时返回 already-fixed，状态不再发生变化。
 * 这保证“避免重复执行”，也让中断后的继续执行可以安全重放。
 */
export function applyFix(state: WorkspaceState, fix: FixSpec): FixOutcome {
  switch (fix.kind) {
    case "bench.unassign": {
      const benchId = String(fix.context.benchId);
      const accessionId = String(fix.context.accessionId);
      const reason = String(fix.context.reason ?? "");
      const bench = state.benches.find((item) => item.id === benchId);
      if (!bench) {
        return {
          status: "already-fixed",
          state,
          changes: [],
          conflictReason: `台架 ${benchId} 已不存在`,
        };
      }
      if (!bench.assignedIds.includes(accessionId)) {
        return { status: "already-fixed", state, changes: [] };
      }
      const reasonLabel =
        reason === "light-mismatch"
          ? "光照不兼容"
          : reason === "detangle"
            ? "同一材料跨多个台架"
            : "引用已消失材料";
      const next = reconcileBenchStatus({
        ...bench,
        assignedIds: bench.assignedIds.filter((id) => id !== accessionId),
      });
      return {
        status: "applied",
        state: updateBench(state, benchId, () => next),
        changes: [`从台架 ${bench.code} 移除 ${accessionId}（${reasonLabel}）`],
      };
    }

    case "bench.dedupe": {
      const benchId = String(fix.context.benchId);
      const accessionId = String(fix.context.accessionId);
      const bench = state.benches.find((item) => item.id === benchId);
      if (!bench || bench.assignedIds.filter((id) => id === accessionId).length <= 1) {
        return { status: "already-fixed", state, changes: [] };
      }
      const seen = new Set<string>();
      const deduped: string[] = [];
      bench.assignedIds.forEach((id) => {
        if (id === accessionId) {
          if (!seen.has(id)) {
            seen.add(id);
            deduped.push(id);
          }
          return;
        }
        deduped.push(id);
      });
      return {
        status: "applied",
        state: updateBench(state, benchId, (item) =>
          reconcileBenchStatus({ ...item, assignedIds: deduped }),
        ),
        changes: [`台架 ${bench.code} 内的 ${accessionId} 折叠为单次占用`],
      };
    }

    case "bench.reconcile-status": {
      const benchId = String(fix.context.benchId);
      const bench = state.benches.find((item) => item.id === benchId);
      if (!bench) {
        return { status: "already-fixed", state, changes: [] };
      }
      const reconciled = reconcileBenchStatus(bench);
      if (reconciled.status === bench.status) {
        return { status: "already-fixed", state, changes: [] };
      }
      return {
        status: "applied",
        state: updateBench(state, benchId, () => reconciled),
        changes: [`台架 ${bench.code} 状态校正为 ${reconciled.status}`],
      };
    }

    case "bench.release-all": {
      const benchId = String(fix.context.benchId);
      const bench = state.benches.find((item) => item.id === benchId);
      if (!bench || bench.assignedIds.length === 0) {
        return { status: "already-fixed", state, changes: [] };
      }
      const plannedIds = Array.isArray(fix.context.accessionIds)
        ? fix.context.accessionIds.map(String)
        : [];
      // 若台架在预演后出现了计划之外的占用变化，不能静默扩大或缩小修复范围。
      const currentUnique = Array.from(new Set(bench.assignedIds));
      const allPlanned = currentUnique.every((id) => plannedIds.includes(id));
      if (!allPlanned) {
        return {
          status: "conflict",
          state,
          changes: [],
          conflictReason: `台架 ${bench.code} 的占用列表在预演后发生变化，请重新扫描后再执行。`,
        };
      }
      const next: Bench = { ...bench, assignedIds: [] };
      return {
        status: "applied",
        state: updateBench(state, benchId, () => next),
        changes: [
          `台架 ${bench.code}（${bench.status === "blocked" ? "停用" : "隔离"}）移出全部 ${currentUnique.length} 个材料，材料记录全部保留`,
        ],
      };
    }

    case "accession.detangle-benches": {
      const accessionId = String(fix.context.accessionId);
      const keepBenchId = String(fix.context.keepBenchId);
      const removeBenchIds = Array.isArray(fix.context.removeBenchIds)
        ? fix.context.removeBenchIds.map(String)
        : [];
      let working = state;
      const changes: string[] = [];
      let appliedAny = false;
      for (const benchId of removeBenchIds) {
        const bench = working.benches.find((item) => item.id === benchId);
        if (!bench || !bench.assignedIds.includes(accessionId)) {
          continue;
        }
        const result = applyFix(working, {
          kind: "bench.unassign",
          action: "",
          rationale: "",
          context: { benchId, accessionId, reason: "detangle" },
        });
        working = result.state;
        if (result.status === "applied") {
          appliedAny = true;
          changes.push(...result.changes.map((line) => `${line}，保留台架 ${keepBenchId}`));
        }
      }
      return {
        status: appliedAny ? "applied" : "already-fixed",
        state: working,
        changes,
      };
    }

    case "flag.correct-trial": {
      const flagId = String(fix.context.flagId);
      const targetTrialId = String(fix.context.targetTrialId);
      const flag = state.flags.find((item) => item.id === flagId);
      if (!flag) {
        return { status: "already-fixed", state, changes: [] };
      }
      if (flag.trialId === targetTrialId) {
        return { status: "already-fixed", state, changes: [] };
      }
      return {
        status: "applied",
        state: {
          ...state,
          flags: state.flags.map((item) =>
            item.id === flagId ? { ...item, trialId: targetTrialId } : item,
          ),
        },
        changes: [`标记 ${flag.code} 的试验引用校正为 ${targetTrialId}`],
      };
    }

    default:
      return {
        status: "conflict",
        state,
        changes: [],
        conflictReason: "未知修复类型",
      };
  }
}

export interface PlannedFix {
  finding: QualityFinding;
  fix: FixSpec;
}

export function selectFixable(findings: QualityFinding[]): PlannedFix[] {
  return findings
    .filter((finding) => finding.fix !== undefined)
    .map((finding) => ({ finding, fix: finding.fix as FixSpec }));
}

export interface DryRunItemResult {
  findingId: string;
  ruleCode: string;
  title: string;
  action: string;
  status: "applied" | "already-fixed" | "conflict";
  changes: string[];
  conflictReason?: string;
}

export interface DryRunResult {
  results: DryRunItemResult[];
  projectedState: WorkspaceState;
  conflicts: DryRunItemResult[];
  appliedCount: number;
  alreadyFixedCount: number;
}

/**
 * 整批预演：在工作区副本上按顺序执行所有选中的修复，
 * 返回每一项的结果、预计终态和冲突列表。不产生任何写入。
 */
export function previewFixes(state: WorkspaceState, plans: PlannedFix[]): DryRunResult {
  let working = cloneState(state);
  const results: DryRunItemResult[] = [];
  for (const plan of plans) {
    const outcome = applyFix(working, plan.fix);
    working = outcome.state;
    results.push({
      findingId: plan.finding.id,
      ruleCode: plan.finding.ruleCode,
      title: plan.finding.title,
      action: plan.fix.action,
      status: outcome.status,
      changes: outcome.changes,
      conflictReason: outcome.conflictReason,
    });
  }
  return {
    results,
    projectedState: working,
    conflicts: results.filter((item) => item.status === "conflict"),
    appliedCount: results.filter((item) => item.status === "applied").length,
    alreadyFixedCount: results.filter((item) => item.status === "already-fixed").length,
  };
}

export interface BatchFixResult {
  state: WorkspaceState;
  records: RepairItemRecord[];
  conflicts: RepairItemRecord[];
  appliedCount: number;
}

/**
 * 整批执行（修复中心实际调用）：逐项应用并返回审计记录。
 * 调用方必须先通过 previewFixes 让用户逐项确认。
 */
export function applyFixPlan(state: WorkspaceState, plans: PlannedFix[]): BatchFixResult {
  let working = state;
  const records: RepairItemRecord[] = [];
  for (const plan of plans) {
    const outcome = applyFix(working, plan.fix);
    working = outcome.state;
    records.push({
      findingId: plan.finding.id,
      ruleCode: plan.finding.ruleCode,
      severity: plan.finding.severity,
      title: plan.finding.title,
      action: plan.fix.action,
      fix: plan.finding.fix,
      status: outcome.status,
      changes: outcome.changes,
      conflictReason: outcome.conflictReason,
      appliedAt: outcome.status === "applied" ? new Date().toISOString() : undefined,
    });
  }
  return {
    state: working,
    records,
    conflicts: records.filter((item) => item.status === "conflict"),
    appliedCount: records.filter((item) => item.status === "applied").length,
  };
}

export interface ProjectionCheck {
  safe: boolean;
  introduced: QualityFinding[];
  remaining: QualityFinding[];
}

/**
 * 预演后重新扫描预计终态，确保整批修复真正消解目标问题，
 * 且没有引入新的阻断级问题。
 */
export function verifyProjectedState(
  before: WorkspaceState,
  plans: PlannedFix[],
): ProjectionCheck {
  const targetIds = new Set(plans.map((plan) => plan.finding.id));
  const projected = previewFixes(before, plans).projectedState;
  const beforeReport = scanWorkspace(before);
  const afterReport = scanWorkspace(projected);
  const beforeIds = new Set(beforeReport.findings.map((item) => item.id));
  const introduced = afterReport.blocking.filter((item) => !beforeIds.has(item.id));
  const remaining = afterReport.blocking.filter((item) => targetIds.has(item.id));
  return { safe: introduced.length === 0, introduced, remaining };
}

/** 针对一份报告核对预计终态（用于持久化问题也参与扫描时复用）。 */
export function verifyProjectionReport(
  report: QualityReport,
  projected: WorkspaceState,
  targetIds: Set<string>,
): ProjectionCheck {
  const beforeIds = new Set(report.findings.map((item) => item.id));
  const afterReport = scanWorkspace(projected, {
    persistenceFindings: report.byDomain.persistence,
  });
  const introduced = afterReport.blocking.filter((item) => !beforeIds.has(item.id));
  const remaining = afterReport.blocking.filter((item) => targetIds.has(item.id));
  return { safe: introduced.length === 0, introduced, remaining };
}
