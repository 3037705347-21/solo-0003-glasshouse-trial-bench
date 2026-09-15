import { useCallback, useEffect, useMemo, useState } from "react";
import {
  type PlannedFix,
  type QualityFinding,
  type QualityReport,
  fingerprintState,
  previewFixes,
  scanWorkspace,
  selectFixable,
  verifyProjectionReport,
} from "../../domain/quality";
import { useWorkspace } from "../../state/store";
import type { WorkspaceState } from "../../domain/types";

export interface DryRunSelection {
  plans: PlannedFix[];
  projectedState: WorkspaceState;
  results: ReturnType<typeof previewFixes>["results"];
  conflicts: ReturnType<typeof previewFixes>["results"];
  appliedCount: number;
  alreadyFixedCount: number;
  introduced: QualityFinding[];
  remaining: QualityFinding[];
  safe: boolean;
  /** 预演时工作区指纹，执行时必须仍与之相等。 */
  fingerprint: string;
}

export function useQualityCenter() {
  const {
    state,
    bootFindings,
    activeRepair,
    runRepairBatch,
    resumeRepair,
    rollbackRepair,
    abandonRepair,
    recoveryNotice,
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

  // 工作区变化（修复应用、外部写入同步、隔离区变化）后自动重新扫描。
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
      // 预演后工作区指纹若已变化，作废预演，强制用户重新确认。
      return fingerprintState(state) === current.fingerprint ? current : null;
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

  /** 整批预演：在副本上跑全部勾选项，生成逐项结果与终态校验。 */
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
      fingerprint: fingerprintState(state),
    };
    setDryRun(selection);
    return selection;
  }, [selected, fixableById, state, report]);

  /**
   * 执行已确认的整批修复。协调器逐项落盘（工作区 + 会话），
   * 任意写入边界中断后都可凭指纹恢复；预演指纹失效时整体拒绝。
   */
  const applyConfirmed = useCallback(
    (selection: DryRunSelection): { ok: true } | { ok: false; reason: string } => {
      const result = runRepairBatch(selection.plans, selection.fingerprint);
      if (result.ok) {
        setDryRun(null);
        setSelected(new Set());
      }
      return result;
    },
    [runRepairBatch],
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
    resumeRepair,
    rollbackRepair,
    abandonRepair,
    recoveryNotice,
  };
}
