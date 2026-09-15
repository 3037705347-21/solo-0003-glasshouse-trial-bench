import { useCallback, useEffect, useMemo, useState } from "react";
import {
  abandonRepair,
  type PlannedFix,
  type QualityFinding,
  type QualityReport,
  type RepairJournal,
  advanceRepair,
  createRepairJournal,
  previewFixes,
  rollbackRepair,
  scanWorkspace,
  selectFixable,
  verifyProjectionReport,
} from "../../domain/quality";
import { useWorkspace } from "../../state/store";

export interface DryRunSelection {
  plans: PlannedFix[];
  projectedState: import("../../domain/types").WorkspaceState;
  results: ReturnType<typeof previewFixes>["results"];
  conflicts: ReturnType<typeof previewFixes>["results"];
  appliedCount: number;
  alreadyFixedCount: number;
  introduced: QualityFinding[];
  remaining: QualityFinding[];
  safe: boolean;
}

export function useQualityCenter() {
  const {
    state,
    bootFindings,
    activeRepair,
    saveActiveRepair,
    finishRepair,
    applyRepairedState,
  } = useWorkspace();
  const [report, setReport] = useState<QualityReport>(() =>
    scanWorkspace(state, { persistenceFindings: bootFindings }),
  );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [dryRun, setDryRun] = useState<DryRunSelection | null>(null);

  const rescan = useCallback(() => {
    const next = scanWorkspace(state, { persistenceFindings: bootFindings });
    setReport(next);
    setSelected((current) => {
      const liveIds = new Set(next.findings.map((finding) => finding.id));
      return new Set([...current].filter((id) => liveIds.has(id)));
    });
    setDryRun(null);
    return next;
  }, [state, bootFindings]);

  // 修复应用、隔离记录增删或其他页面操作改变工作区后自动重新扫描，
  // 保证质量中心展示的始终是当前状态的检查结果。
  useEffect(() => {
    const next = scanWorkspace(state, { persistenceFindings: bootFindings });
    setReport(next);
    setSelected((current) => {
      const liveIds = new Set(next.findings.map((finding) => finding.id));
      return new Set([...current].filter((id) => liveIds.has(id)));
    });
    setDryRun((current) => {
      if (!current) {
        return current;
      }
      const liveIds = new Set(next.findings.map((finding) => finding.id));
      return current.plans.every((plan) => liveIds.has(plan.finding.id))
        ? current
        : null;
    });
  }, [state, bootFindings]);

  const fixableById = useMemo(() => {
    const map = new Map<string, PlannedFix>();
    selectFixable(report.findings).forEach((plan) => map.set(plan.finding.id, plan));
    return map;
  }, [report]);

  const toggleSelected = useCallback(
    (findingId: string) => {
      if (!fixableById.has(findingId)) {
        return;
      }
      setSelected((current) => {
        const next = new Set(current);
        if (next.has(findingId)) {
          next.delete(findingId);
        } else {
          next.add(findingId);
        }
        return next;
      });
    },
    [fixableById],
  );

  const selectAllFixable = useCallback(
    (findings: QualityFinding[]) => {
      setSelected(new Set(selectFixable(findings).map((plan) => plan.finding.id)));
    },
    [],
  );

  const clearSelection = useCallback(() => setSelected(new Set()), []);

  /** 整批预演：把勾选项在副本上全部跑一遍，生成逐项结果与终态校验。 */
  const preview = useCallback(() => {
    const plans = [...selected]
      .map((id) => fixableById.get(id))
      .filter((plan): plan is PlannedFix => plan !== undefined);
    if (plans.length === 0) {
      setDryRun(null);
      return null;
    }
    const result = previewFixes(state, plans);
    const targetIds = new Set(plans.map((plan) => plan.finding.id));
    const verification = verifyProjectionReport(
      report,
      result.projectedState,
      targetIds,
    );
    const selection: DryRunSelection = {
      plans,
      projectedState: result.projectedState,
      results: result.results,
      conflicts: result.conflicts,
      appliedCount: result.appliedCount,
      alreadyFixedCount: result.alreadyFixedCount,
      introduced: verification.introduced,
      remaining: verification.remaining,
      safe: verification.safe && result.conflicts.length === 0,
    };
    setDryRun(selection);
    return selection;
  }, [selected, fixableById, state, report]);

  /**
   * 执行已确认的整批修复：
   * 1. 冻结修复前状态，创建可恢复的修复会话；2. 在当前状态上推进；
   * 3. 一次性写入工作区；4. 会话归入历史。中断后 active 会话仍可继续或回滚。
   */
  const applyConfirmed = useCallback(
    (selection: DryRunSelection): RepairJournal => {
      const journal = createRepairJournal({
        stateBefore: state,
        plans: selection.plans,
      });
      saveActiveRepair(journal);
      const advanced = advanceRepair(journal, state);
      saveActiveRepair(advanced.journal);
      applyRepairedState(advanced.state);
      const finished: RepairJournal = {
        ...advanced.journal,
        stateAfter: advanced.state,
      };
      finishRepair(finished);
      return finished;
    },
    [state, saveActiveRepair, applyRepairedState, finishRepair],
  );

  /** 中断恢复：继续未完成会话。对账当前仍存在的问题后幂等重放。 */
  const resumeActiveRepair = useCallback(
    (journal: RepairJournal): RepairJournal => {
      const advanced = advanceRepair(journal, state);
      applyRepairedState(advanced.state);
      const finished = { ...advanced.journal, stateAfter: advanced.state };
      finishRepair(finished);
      return finished;
    },
    [state, applyRepairedState, finishRepair],
  );

  /** 整批回滚到修复前快照。 */
  const rollbackActiveRepair = useCallback(
    (journal: RepairJournal) => {
      const result = rollbackRepair(journal);
      applyRepairedState(result.state);
      finishRepair(result.journal);
    },
    [applyRepairedState, finishRepair],
  );

  const abandonActiveRepair = useCallback(
    (journal: RepairJournal) => {
      finishRepair(abandonRepair(journal));
    },
    [finishRepair],
  );

  return {
    report,
    rescan,
    selected,
    toggleSelected,
    selectAllFixable,
    clearSelection,
    fixableById,
    dryRun,
    setDryRun,
    preview,
    applyConfirmed,
    activeRepair,
    resumeActiveRepair,
    rollbackActiveRepair,
    abandonActiveRepair,
  };
}
