import type {
  Flag,
  FlagCondition,
  FlagSeverity,
  MeasurementRanges,
  RuleComparator,
  RuleMetric,
  RuleScope,
  RuleVersion,
  Trial,
  WorkspaceState,
} from "./types";
import { createId } from "./id";
import { GROWTH_BOUNDS } from "./rules";
import { fail, fieldError, ok, type Result } from "./result";

export interface RuleVersionDraft {
  scope: RuleScope;
  ranges: MeasurementRanges;
  flagConditions: FlagCondition[];
  changeReason: string;
}

export const RULE_METRICS: RuleMetric[] = ["heightMm", "leafCount", "ecMs"];

export const RULE_METRIC_LABELS: Record<RuleMetric, string> = {
  heightMm: "株高（毫米）",
  leafCount: "叶片数",
  ecMs: "电导率 mS/cm",
};

export const RULE_COMPARATOR_LABELS: Record<RuleComparator, string> = {
  lt: "低于",
  gte: "达到或超过",
};

export const LEGACY_FLAG_CONDITIONS: FlagCondition[] = [
  {
    code: "HT_UNDER",
    metric: "heightMm",
    comparator: "lt",
    threshold: 60,
    severity: "warning",
    messageTemplate: "{cultivar} 株高低于 {threshold} 毫米生长阈值",
  },
  {
    code: "HT_OVER",
    metric: "heightMm",
    comparator: "gte",
    threshold: 420,
    severity: "critical",
    messageTemplate: "{cultivar} 株高高于 {threshold} 毫米生长阈值",
  },
  {
    code: "LEAF_LOW",
    metric: "leafCount",
    comparator: "lt",
    threshold: 5,
    severity: "warning",
    messageTemplate: "{cultivar} 的真叶数少于 {threshold} 片",
  },
  {
    code: "EC_HIGH",
    metric: "ecMs",
    comparator: "gte",
    threshold: 3.5,
    severity: "critical",
    messageTemplate: "{cultivar} 的基质电导率达到 {threshold} mS/cm",
  },
];

export function legacyRanges(): MeasurementRanges {
  return {
    heightMm: { ...GROWTH_BOUNDS.heightMm },
    leafCount: { ...GROWTH_BOUNDS.leafCount },
    ecMs: { ...GROWTH_BOUNDS.ecMs },
  };
}

export function scopeKey(scope: RuleScope): string {
  return scope.kind === "trial"
    ? `trial:${scope.trialId}`
    : `cropFamily:${scope.cropFamily}`;
}

export function scopeLabel(scope: RuleScope, trials: Trial[]): string {
  if (scope.kind === "trial") {
    const trial = trials.find((item) => item.id === scope.trialId);
    return trial ? `试验 ${trial.code}` : "未知试验";
  }
  return `科属 ${scope.cropFamily}`;
}

export function ruleVersionLabel(
  version: RuleVersion,
  trials: Trial[],
): string {
  return `${scopeLabel(version.scope, trials)} · v${version.version}`;
}

export function validateRuleVersionDraft(
  draft: RuleVersionDraft,
  state: WorkspaceState,
): Result<RuleVersionDraft> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  const scope = draft.scope;
  if (scope.kind === "trial") {
    if (!state.trials.some((trial) => trial.id === scope.trialId)) {
      errors.push(fieldError("scope", "unknown_trial", "请选择有效试验"));
    }
  } else if (scope.cropFamily.trim().length < 2) {
    errors.push(fieldError("scope", "required", "请填写作物科属"));
  }
  RULE_METRICS.forEach((metric) => {
    const range = draft.ranges[metric];
    if (!range || Number.isNaN(range.min) || Number.isNaN(range.max)) {
      errors.push(
        fieldError(
          `ranges.${metric}`,
          "required",
          `请填写${RULE_METRIC_LABELS[metric]}的测量范围`,
        ),
      );
      return;
    }
    if (range.min < 0) {
      errors.push(
        fieldError(
          `ranges.${metric}`,
          "negative",
          `${RULE_METRIC_LABELS[metric]}下限不能为负数`,
        ),
      );
    }
    if (range.min >= range.max) {
      errors.push(
        fieldError(
          `ranges.${metric}`,
          "inverted",
          `${RULE_METRIC_LABELS[metric]}下限必须小于上限`,
        ),
      );
    }
  });
  const seenCodes = new Set<string>();
  draft.flagConditions.forEach((condition, index) => {
    const code = condition.code.trim();
    if (!/^[A-Z][A-Z0-9_]{1,23}$/.test(code)) {
      errors.push(
        fieldError(
          `conditions.${index}.code`,
          "invalid_code",
          "标记代码需为 2-24 位大写字母、数字或下划线",
        ),
      );
    } else if (seenCodes.has(code)) {
      errors.push(
        fieldError(
          `conditions.${index}.code`,
          "duplicate",
          "同一版本内标记代码不能重复",
        ),
      );
    }
    seenCodes.add(code);
    if (Number.isNaN(condition.threshold)) {
      errors.push(
        fieldError(
          `conditions.${index}.threshold`,
          "required",
          "请填写触发阈值",
        ),
      );
    }
    if (condition.messageTemplate.trim().length < 6) {
      errors.push(
        fieldError(
          `conditions.${index}.messageTemplate`,
          "too_short",
          "请填写至少 6 个字符的标记说明",
        ),
      );
    }
  });
  if (draft.changeReason.trim().length < 8) {
    errors.push(
      fieldError(
        "changeReason",
        "too_short",
        "请填写至少 8 个字符的变更原因",
      ),
    );
  }
  if (errors.length > 0) {
    return fail(errors);
  }
  const cleanScope: RuleScope =
    scope.kind === "trial"
      ? scope
      : { kind: "cropFamily", cropFamily: scope.cropFamily.trim() };
  return ok({
    ...draft,
    scope: cleanScope,
    flagConditions: draft.flagConditions.map((condition) => ({
      ...condition,
      code: condition.code.trim(),
      messageTemplate: condition.messageTemplate.trim(),
    })),
    changeReason: draft.changeReason.trim(),
  });
}

export function createRuleVersion(
  draft: RuleVersionDraft,
  state: WorkspaceState,
): Result<RuleVersion> {
  const validated = validateRuleVersionDraft(draft, state);
  if (!validated.ok) {
    return validated;
  }
  const value = validated.value;
  const key = scopeKey(value.scope);
  const nextVersion =
    Math.max(
      0,
      ...state.ruleVersions
        .filter((version) => scopeKey(version.scope) === key)
        .map((version) => version.version),
    ) + 1;
  return ok({
    id: createId("rule"),
    scope: value.scope,
    version: nextVersion,
    ranges: {
      heightMm: { ...value.ranges.heightMm },
      leafCount: { ...value.ranges.leafCount },
      ecMs: { ...value.ranges.ecMs },
    },
    flagConditions: value.flagConditions.map((condition) => ({
      ...condition,
    })),
    changeReason: value.changeReason,
    createdAt: new Date().toISOString(),
    status: "inactive",
  });
}

export function activateRuleVersion(
  state: WorkspaceState,
  versionId: string,
): Result<RuleVersion[]> {
  const target = state.ruleVersions.find((version) => version.id === versionId);
  if (!target) {
    return fail([fieldError("version", "unknown", "规则版本不存在")]);
  }
  if (target.status === "active") {
    return fail([
      fieldError(
        "status",
        "already_active",
        "该版本已处于启用状态，不能重复启用",
      ),
    ]);
  }
  const key = scopeKey(target.scope);
  const next = state.ruleVersions.map((version) => {
    if (version.id === target.id) {
      return { ...version, status: "active" as const };
    }
    if (version.status === "active" && scopeKey(version.scope) === key) {
      return { ...version, status: "archived" as const };
    }
    return version;
  });
  return ok(next);
}

export type RuleResolution =
  | { kind: "none" }
  | {
      kind: "resolved";
      version: RuleVersion;
      source: "trial" | "cropFamily";
      shadowed?: RuleVersion;
    };

export function resolveRuleVersion(
  state: WorkspaceState,
  trialId: string,
): RuleResolution {
  const trial = state.trials.find((item) => item.id === trialId);
  if (!trial) {
    return { kind: "none" };
  }
  const trialVersion = state.ruleVersions.find(
    (version) =>
      version.status === "active" &&
      version.scope.kind === "trial" &&
      version.scope.trialId === trialId,
  );
  const familyVersion = state.ruleVersions.find(
    (version) =>
      version.status === "active" &&
      version.scope.kind === "cropFamily" &&
      version.scope.cropFamily === trial.cropFamily,
  );
  if (trialVersion) {
    return {
      kind: "resolved",
      version: trialVersion,
      source: "trial",
      shadowed: familyVersion,
    };
  }
  if (familyVersion) {
    return { kind: "resolved", version: familyVersion, source: "cropFamily" };
  }
  return { kind: "none" };
}

export function hasScopeConflict(
  state: WorkspaceState,
  version: RuleVersion,
): boolean {
  const scope = version.scope;
  if (scope.kind === "trial") {
    const trial = state.trials.find((item) => item.id === scope.trialId);
    return Boolean(
      trial &&
        state.ruleVersions.some(
          (other) =>
            other.status === "active" &&
            other.scope.kind === "cropFamily" &&
            other.scope.cropFamily === trial.cropFamily,
        ),
    );
  }
  const cropFamily = scope.cropFamily;
  return state.ruleVersions.some(
    (other) =>
      other.status === "active" &&
      other.scope.kind === "trial" &&
      state.trials.some(
        (trial) =>
          other.scope.kind === "trial" &&
          trial.id === other.scope.trialId &&
          trial.cropFamily === cropFamily,
      ),
  );
}

export interface FlagDiffEntry {
  accessionId: string;
  code: string;
  message: string;
  severity: FlagSeverity;
}

export interface FlagSeverityChange {
  accessionId: string;
  code: string;
  from: FlagSeverity;
  to: FlagSeverity;
}

export interface FlagDiff {
  added: FlagDiffEntry[];
  removed: FlagDiffEntry[];
  severityChanged: FlagSeverityChange[];
  unchanged: number;
}

function flagDiffKey(flag: { accessionId: string; code: string }): string {
  return `${flag.accessionId}::${flag.code}`;
}

export function diffFlags(existing: Flag[], recomputed: Flag[]): FlagDiff {
  const existingByKey = new Map(
    existing.map((flag) => [flagDiffKey(flag), flag]),
  );
  const recomputedByKey = new Map(
    recomputed.map((flag) => [flagDiffKey(flag), flag]),
  );
  const added = recomputed
    .filter((flag) => !existingByKey.has(flagDiffKey(flag)))
    .map((flag) => ({
      accessionId: flag.accessionId,
      code: flag.code,
      message: flag.message,
      severity: flag.severity,
    }));
  const removed = existing
    .filter((flag) => !recomputedByKey.has(flagDiffKey(flag)))
    .map((flag) => ({
      accessionId: flag.accessionId,
      code: flag.code,
      message: flag.message,
      severity: flag.severity,
    }));
  const severityChanged: FlagSeverityChange[] = [];
  let unchanged = 0;
  recomputed.forEach((flag) => {
    const previous = existingByKey.get(flagDiffKey(flag));
    if (!previous) {
      return;
    }
    if (previous.severity === flag.severity) {
      unchanged += 1;
    } else {
      severityChanged.push({
        accessionId: flag.accessionId,
        code: flag.code,
        from: previous.severity,
        to: flag.severity,
      });
    }
  });
  return { added, removed, severityChanged, unchanged };
}
