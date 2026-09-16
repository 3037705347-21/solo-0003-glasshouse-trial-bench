import type {
  Bench,
  BenchInspection,
  BenchInspectionCategory,
  BenchInspectionImpact,
  BenchMaintenanceAction,
  BenchStatus,
  PreferredLight,
} from "./types";
import { createId } from "./id";
import { parseDateOnly, todayDateOnly } from "./rules";
import { fail, fieldError, ok, type Result } from "./result";

export interface BenchInspectionDraft {
  benchId: string;
  inspectedOn: string;
  inspector: string;
  category: BenchInspectionCategory;
  result: "normal" | "issue";
  anomalyDescription: string;
  impact: BenchInspectionImpact;
  handlingSuggestion: string;
  maintenanceAction: BenchMaintenanceAction;
}

export const BENCH_INSPECTION_CATEGORIES: Array<{
  value: BenchInspectionCategory;
  label: string;
}> = [
  { value: "cleanliness", label: "清洁状况" },
  { value: "equipment", label: "设备异常" },
  { value: "lighting", label: "光照偏差" },
  { value: "environment", label: "环境问题" },
];

export const BENCH_MAINTENANCE_ACTIONS: Array<{
  value: BenchMaintenanceAction;
  label: string;
}> = [
  { value: "cleaning", label: "安排清洁" },
  { value: "repair", label: "设备维修" },
  { value: "replacement", label: "部件更换" },
  { value: "relocation", label: "材料移位" },
  { value: "recalibration", label: "重新校准" },
  { value: "other", label: "其他处置" },
];

export const BENCH_IMPACT_LABELS: Record<BenchInspectionImpact, string> = {
  none: "不影响使用",
  caution: "需留意",
  blocking: "影响使用",
};

export const BENCH_STATUS_LABELS: Record<BenchStatus, string> = {
  available: "可用",
  assigned: "已分配",
  blocked: "受限",
  quarantine: "隔离",
};

export const BENCH_LIGHT_LABELS: Record<PreferredLight, string> = {
  "full-sun": "全日照",
  "partial-shade": "半阴",
  shade: "遮阴",
};

export function benchInspectionCategoryLabel(
  category: BenchInspectionCategory,
): string {
  return (
    BENCH_INSPECTION_CATEGORIES.find((item) => item.value === category)?.label ??
    category
  );
}

export function benchMaintenanceActionLabel(
  action: BenchMaintenanceAction,
): string {
  return (
    BENCH_MAINTENANCE_ACTIONS.find((item) => item.value === action)?.label ??
    action
  );
}

export function isOpenBenchInspection(inspection: BenchInspection): boolean {
  return inspection.state === "open";
}

export function isBlockingBenchInspection(
  inspection: BenchInspection,
): boolean {
  return inspection.state === "open" && inspection.impact === "blocking";
}

export function isCautionBenchInspection(
  inspection: BenchInspection,
): boolean {
  return (
    inspection.state === "open" &&
    (inspection.impact === "blocking" || inspection.impact === "caution")
  );
}

export function benchStatusChangedSinceInspection(
  inspection: BenchInspection,
  bench: Bench,
): boolean {
  return (
    bench.status !== inspection.benchStatusAtInspection ||
    bench.lightProfile !== inspection.lightProfileAtInspection ||
    (bench.blockedReason ?? "") !==
      (inspection.blockedReasonAtInspection ?? "")
  );
}

export function validateBenchInspectionDraft(
  draft: BenchInspectionDraft,
  bench: Bench | undefined,
): Result<BenchInspectionDraft> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  if (!bench) {
    errors.push(fieldError("benchId", "unknown", "请选择需要巡检的台架"));
  }
  if (!parseDateOnly(draft.inspectedOn)) {
    errors.push(
      fieldError("inspectedOn", "invalid_date", "巡检日期无效"),
    );
  } else if (
    parseDateOnly(draft.inspectedOn)!.getTime() >
    parseDateOnly(todayDateOnly())!.getTime()
  ) {
    errors.push(
      fieldError(
        "inspectedOn",
        "future",
        "巡检日期不能晚于今天",
      ),
    );
  }
  if (draft.inspector.trim().length < 2) {
    errors.push(fieldError("inspector", "required", "请填写巡检人"));
  }
  if (
    !BENCH_INSPECTION_CATEGORIES.some(
      (item) => item.value === draft.category,
    )
  ) {
    errors.push(fieldError("category", "invalid", "请选择巡检项目"));
  }
  if (draft.result !== "normal" && draft.result !== "issue") {
    errors.push(fieldError("result", "invalid", "请选择巡检结果"));
  }
  if (draft.result === "issue") {
    if (draft.anomalyDescription.trim().length < 5) {
      errors.push(
        fieldError(
          "anomalyDescription",
          "too_short",
          "请用至少 5 个字符描述异常情况",
        ),
      );
    }
    if (!["none", "caution", "blocking"].includes(draft.impact)) {
      errors.push(
        fieldError("impact", "invalid", "请选择异常对使用的影响"),
      );
    }
    if (draft.handlingSuggestion.trim().length < 5) {
      errors.push(
        fieldError(
          "handlingSuggestion",
          "too_short",
          "请用至少 5 个字符填写处置建议",
        ),
      );
    }
  }
  if (
    !BENCH_MAINTENANCE_ACTIONS.some(
      (item) => item.value === draft.maintenanceAction,
    )
  ) {
    errors.push(
      fieldError("maintenanceAction", "invalid", "请选择后续维护动作"),
    );
  }
  if (errors.length > 0) {
    return fail(errors);
  }
  return ok({
    ...draft,
    inspector: draft.inspector.trim(),
    anomalyDescription: draft.anomalyDescription.trim(),
    handlingSuggestion: draft.handlingSuggestion.trim(),
  });
}

export function createBenchInspection(
  draft: BenchInspectionDraft,
  bench: Bench | undefined,
): Result<BenchInspection> {
  const validated = validateBenchInspectionDraft(draft, bench);
  if (!validated.ok || !bench) {
    return fail(validated.ok ? [] : validated.errors);
  }
  const value = validated.value;
  const isIssue = value.result === "issue";
  const createdAt = new Date().toISOString();
  return ok({
    id: createId("insp"),
    benchId: bench.id,
    inspectedOn: value.inspectedOn,
    inspector: value.inspector,
    category: value.category,
    result: value.result,
    anomalyDescription: isIssue ? value.anomalyDescription : "",
    impact: isIssue ? value.impact : "none",
    handlingSuggestion: isIssue ? value.handlingSuggestion : "",
    maintenanceAction: value.maintenanceAction,
    state: isIssue ? "open" : "resolved",
    createdAt,
    benchStatusAtInspection: bench.status,
    blockedReasonAtInspection: bench.blockedReason,
    occupiedCountAtInspection: bench.assignedIds.length,
    lightProfileAtInspection: bench.lightProfile,
    resolutionNote: isIssue ? undefined : "本次巡检正常，无需处置。",
    resolvedAt: isIssue ? undefined : createdAt,
  });
}

export function resolveBenchInspection(
  inspection: BenchInspection,
  bench: Bench | undefined,
  note: string,
  statusRechecked: boolean,
): Result<BenchInspection> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  if (inspection.state !== "open") {
    errors.push(
      fieldError("state", "already_resolved", "该异常已经解除"),
    );
  }
  if (note.trim().length < 5) {
    errors.push(
      fieldError(
        "resolutionNote",
        "too_short",
        "请用至少 5 个字符记录解除说明",
      ),
    );
  }
  const statusChanged =
    bench !== undefined &&
    benchStatusChangedSinceInspection(inspection, bench);
  if (statusChanged && !statusRechecked) {
    errors.push(
      fieldError(
        "statusRechecked",
        "recheck_required",
        "巡检后台架状态已经变化，请先核对当前台架情况再确认解除",
      ),
    );
  }
  if (errors.length > 0) {
    return fail(errors);
  }
  return ok({
    ...inspection,
    state: "resolved",
    resolutionNote: note.trim(),
    resolvedAt: new Date().toISOString(),
    statusRecheckedAtResolution: statusChanged ? true : undefined,
  });
}

export function completeBenchInspectionFollowUp(
  inspection: BenchInspection,
): Result<BenchInspection> {
  if (inspection.followUpCompletedAt) {
    return fail([
      fieldError(
        "followUp",
        "already_completed",
        "该巡检的后续维护动作已经登记完成",
      ),
    ]);
  }
  return ok({
    ...inspection,
    followUpCompletedAt: new Date().toISOString(),
  });
}

export function inspectionsForBench(
  inspections: BenchInspection[],
  benchId: string,
): BenchInspection[] {
  return inspections
    .filter((inspection) => inspection.benchId === benchId)
    .sort(compareInspections);
}

export function openInspectionsForBench(
  inspections: BenchInspection[],
  benchId: string,
): BenchInspection[] {
  return inspectionsForBench(inspections, benchId).filter(isOpenBenchInspection);
}

export function blockingInspectionsForBench(
  inspections: BenchInspection[],
  benchId: string,
): BenchInspection[] {
  return openInspectionsForBench(inspections, benchId).filter(
    isBlockingBenchInspection,
  );
}

export function latestBenchInspection(
  inspections: BenchInspection[],
  benchId: string,
): BenchInspection | undefined {
  return inspectionsForBench(inspections, benchId)[0];
}

export function compareInspections(
  left: BenchInspection,
  right: BenchInspection,
): number {
  const dateComparison = right.inspectedOn.localeCompare(left.inspectedOn);
  if (dateComparison !== 0) {
    return dateComparison;
  }
  return right.createdAt.localeCompare(left.createdAt);
}
