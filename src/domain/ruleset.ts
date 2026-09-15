import type {
  FlagThreshold,
  RuleSet,
  RuleSetScope,
  Trial,
  WorkspaceState,
} from "./types";
import { createId } from "./id";
import { GROWTH_BOUNDS, TRIAL_SEASONS, parseDateOnly } from "./rules";
import { fail, fieldError, ok, type Result } from "./result";

export const BASELINE_RULESET_ID = "ruleset-baseline-v1";

/**
 * 基线规则与系统最初内置的硬编码常量一一对应。
 * 迁移旧工作区时用它给历史观测、标记和放行快照盖上溯源，
 * 保证旧数据在规则版本化之后行为完全不变。
 */
export function createBaselineRuleSet(): RuleSet {
  return {
    id: BASELINE_RULESET_ID,
    version: 1,
    name: "基线规则",
    scope: { kind: "workspace" },
    effectiveFrom: "2026-01-01",
    status: "published",
    note: "系统迁移生成的基线规则，对应原内置阈值。",
    createdOn: "2026-01-01T00:00:00.000Z",
    growthBounds: {
      heightMm: { ...GROWTH_BOUNDS.heightMm },
      leafCount: { ...GROWTH_BOUNDS.leafCount },
      ecMs: { ...GROWTH_BOUNDS.ecMs },
    },
    flagThresholds: [
      {
        code: "HT_UNDER",
        metric: "heightMm",
        comparator: "lt",
        value: 60,
        severity: "warning",
        messageTemplate: "{cultivar} 低于 {value} 毫米生长阈值",
      },
      {
        code: "HT_OVER",
        metric: "heightMm",
        comparator: "gte",
        value: 420,
        severity: "critical",
        messageTemplate: "{cultivar} 高于 {value} 毫米生长阈值",
      },
      {
        code: "LEAF_LOW",
        metric: "leafCount",
        comparator: "lt",
        value: 5,
        severity: "warning",
        messageTemplate: "{cultivar} 的真叶数少于 {value} 片",
      },
      {
        code: "EC_HIGH",
        metric: "ecMs",
        comparator: "gte",
        value: 3.5,
        severity: "critical",
        messageTemplate: "{cultivar} 的基质电导率偏高",
      },
    ],
    clearance: {
      blockingSeverities: ["info", "warning", "critical"],
    },
  };
}

export interface RuleSetDraft {
  name: string;
  scope: RuleSetScope;
  effectiveFrom: string;
  note: string;
  growthBounds: RuleSet["growthBounds"];
  flagThresholds: FlagThreshold[];
  blockingSeverities: ClearancePolicyDraft;
}

export type ClearancePolicyDraft = RuleSet["clearance"]["blockingSeverities"];

export function sameRuleSetScope(left: RuleSetScope, right: RuleSetScope): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  if (left.kind === "trial" && right.kind === "trial") {
    return left.trialId === right.trialId;
  }
  if (left.kind === "season" && right.kind === "season") {
    return left.season === right.season;
  }
  return true;
}

export function describeRuleSetScope(
  scope: RuleSetScope,
  trials: Trial[],
): string {
  if (scope.kind === "trial") {
    const trial = trials.find((item) => item.id === scope.trialId);
    return trial ? `试验 ${trial.code}` : "未知试验";
  }
  if (scope.kind === "season") {
    return `${scope.season}试验`;
  }
  return "全部试验（默认）";
}

function validateBound(
  field: string,
  label: string,
  bound: { min: number; max: number },
  errors: Array<ReturnType<typeof fieldError>>,
): void {
  if (Number.isNaN(bound.min) || Number.isNaN(bound.max)) {
    errors.push(fieldError(field, "invalid", `请填写完整的${label}边界`));
    return;
  }
  if (bound.min < 0 || bound.max <= bound.min) {
    errors.push(
      fieldError(field, "range", `${label}边界必须满足 0 ≤ 下限 < 上限`),
    );
  }
}

export function validateRuleSetDraft(
  draft: RuleSetDraft,
  state: WorkspaceState,
): Result<RuleSetDraft> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  if (draft.name.trim().length < 2) {
    errors.push(fieldError("name", "required", "请填写规则版本名称"));
  }
  if (!parseDateOnly(draft.effectiveFrom)) {
    errors.push(
      fieldError("effectiveFrom", "invalid_date", "生效日期无效"),
    );
  }
  if (draft.note.trim().length < 8) {
    errors.push(
      fieldError(
        "note",
        "too_short",
        "请用至少 8 个字符说明本次规则调整的原因",
      ),
    );
  }
  const scope = draft.scope;
  if (scope.kind === "trial") {
    if (!state.trials.some((trial) => trial.id === scope.trialId)) {
      errors.push(fieldError("scope", "unknown", "请选择有效试验"));
    }
  }
  if (scope.kind === "season" && !TRIAL_SEASONS.includes(scope.season)) {
    errors.push(fieldError("scope", "unknown", "请选择有效季节"));
  }
  validateBound("bounds.heightMm", "株高", draft.growthBounds.heightMm, errors);
  validateBound("bounds.leafCount", "叶片数", draft.growthBounds.leafCount, errors);
  validateBound("bounds.ecMs", "电导率", draft.growthBounds.ecMs, errors);
  const seenCodes = new Set<string>();
  draft.flagThresholds.forEach((threshold, index) => {
    if (!/^[A-Z][A-Z0-9_]{1,15}$/.test(threshold.code)) {
      errors.push(
        fieldError(
          `thresholds.${index}.code`,
          "invalid",
          "标记代码需为 2-16 位大写字母、数字或下划线",
        ),
      );
    } else if (seenCodes.has(threshold.code)) {
      errors.push(
        fieldError(`thresholds.${index}.code`, "duplicate", "标记代码不能重复"),
      );
    }
    seenCodes.add(threshold.code);
    const bound = draft.growthBounds[threshold.metric];
    if (
      Number.isNaN(threshold.value) ||
      threshold.value < bound.min ||
      threshold.value > bound.max
    ) {
      errors.push(
        fieldError(
          `thresholds.${index}.value`,
          "range",
          `${threshold.code} 的阈值必须在对应测量边界内`,
        ),
      );
    }
    if (threshold.messageTemplate.trim().length < 4) {
      errors.push(
        fieldError(
          `thresholds.${index}.messageTemplate`,
          "too_short",
          "请填写标记说明模板",
        ),
      );
    }
  });
  if (draft.blockingSeverities.length === 0) {
    errors.push(
      fieldError(
        "blockingSeverities",
        "empty",
        "请至少选择一种会阻止放行的标记级别",
      ),
    );
  }
  if (errors.length > 0) {
    return fail(errors);
  }
  return ok({
    ...draft,
    name: draft.name.trim(),
    note: draft.note.trim(),
  });
}

export function publishRuleSet(
  draft: RuleSetDraft,
  state: WorkspaceState,
): Result<RuleSet> {
  const validated = validateRuleSetDraft(draft, state);
  if (!validated.ok) {
    return validated;
  }
  const value = validated.value;
  const version = state.ruleSets.reduce((max, ruleSet) => Math.max(max, ruleSet.version), 0) + 1;
  return ok({
    id: createId("ruleset"),
    version,
    name: value.name,
    scope: value.scope,
    effectiveFrom: value.effectiveFrom,
    status: "published",
    note: value.note,
    createdOn: new Date().toISOString(),
    growthBounds: value.growthBounds,
    flagThresholds: value.flagThresholds.map((threshold) => ({ ...threshold })),
    clearance: { blockingSeverities: [...value.blockingSeverities] },
  });
}

export function retireRuleSet(
  ruleSet: RuleSet,
  state: WorkspaceState,
  note: string,
): Result<RuleSet> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  if (ruleSet.status !== "published") {
    errors.push(
      fieldError("status", "not_published", "该规则版本已经退役"),
    );
  }
  if (note.trim().length < 8) {
    errors.push(
      fieldError("note", "too_short", "请用至少 8 个字符说明退役原因"),
    );
  }
  if (ruleSet.scope.kind === "workspace") {
    const remainingDefaults = state.ruleSets.filter(
      (candidate) =>
        candidate.id !== ruleSet.id &&
        candidate.status === "published" &&
        candidate.scope.kind === "workspace",
    );
    if (remainingDefaults.length === 0) {
      errors.push(
        fieldError(
          "scope",
          "last_default",
          "不能退役最后一个默认规则，请先发布新的默认版本",
        ),
      );
    }
  }
  if (errors.length > 0) {
    return fail(errors);
  }
  return ok({
    ...ruleSet,
    status: "retired",
    retiredOn: new Date().toISOString(),
    retireNote: note.trim(),
  });
}

/**
 * 解析某个试验在某个日期适用的规则版本。
 * 试验级作用域优先于季节级，季节级优先于工作区默认；
 * 同一作用域内取生效日期不晚于事件日的最新版本，
 * 生效日期相同时由更高的版本号决胜（用于同日更正重发），保证结果确定。
 * 规则按事件日期（观测日、放行日）解析，因此可以在试验中途生效，
 * 而早于生效日的历史结论仍然归属旧版本。
 */
export function resolveRuleSet(
  ruleSets: RuleSet[],
  trial: Trial | undefined,
  onDate: string,
): RuleSet {
  const candidates = ruleSets.filter(
    (ruleSet) =>
      ruleSet.status === "published" && ruleSet.effectiveFrom <= onDate,
  );
  const pick = (list: RuleSet[]): RuleSet | undefined =>
    [...list].sort(
      (left, right) =>
        right.effectiveFrom.localeCompare(left.effectiveFrom) ||
        right.version - left.version,
    )[0];
  if (trial) {
    const trialScoped = candidates.filter(
      (ruleSet) =>
        ruleSet.scope.kind === "trial" && ruleSet.scope.trialId === trial.id,
    );
    const seasonScoped = candidates.filter(
      (ruleSet) =>
        ruleSet.scope.kind === "season" && ruleSet.scope.season === trial.season,
    );
    const resolved =
      pick(trialScoped) ??
      pick(seasonScoped) ??
      pick(candidates.filter((ruleSet) => ruleSet.scope.kind === "workspace"));
    if (resolved) {
      return resolved;
    }
  }
  const fallback = pick(
    candidates.filter((ruleSet) => ruleSet.scope.kind === "workspace"),
  );
  return fallback ?? createBaselineRuleSet();
}

export function ruleSetById(
  state: WorkspaceState,
  ruleSetId: string,
): RuleSet | undefined {
  return state.ruleSets.find((ruleSet) => ruleSet.id === ruleSetId);
}

export function renderFlagMessage(
  template: string,
  values: { cultivar: string; value: number },
): string {
  return template
    .split("{cultivar}")
    .join(values.cultivar)
    .split("{value}")
    .join(String(values.value));
}
