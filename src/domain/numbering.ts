import type {
  Accession,
  NumberRule,
  NumberRuleDatePart,
  NumberRuleScopeType,
  NumberRuleStatus,
  NumberSequenceScope,
  Trial,
  WorkspaceState,
} from "./types";
import { createId } from "./id";
import { parseDateOnly } from "./rules";
import { fail, fieldError, ok, type Result } from "./result";

export const MAX_ACCESSION_NO_LENGTH = 24;
export const MIN_PREFIX_LENGTH = 2;
export const MAX_PREFIX_LENGTH = 8;
export const MIN_PADDING = 3;
export const MAX_PADDING = 6;
export const MIN_SEQUENCE = 1;
export const MAX_SEQUENCE = 999999;

export interface NumberRuleDraft {
  name: string;
  scopeType: NumberRuleScopeType;
  scopeValue: string;
  prefix: string;
  datePart: NumberRuleDatePart;
  sequencePadding: number;
  sequenceScope: NumberSequenceScope;
  nextSequence: number;
  status: NumberRuleStatus;
}

export interface NumberGenerationContext {
  trialId: string;
  source: string;
  propagatedOn: string;
  generatedOn?: string;
  /**
   * When set (e.g. trial copy following a material's provenance), the plan
   * must use this exact rule instead of re-running scope matching. A missing
   * or stopped rule produces a skipped entry.
   */
  ruleId?: string;
}

export interface GeneratedNumber {
  accessionNo: string;
  ruleId: string | undefined;
  ruleName: string;
  dateKey: string;
}

export function normalizeRulePrefix(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "");
}

export function datePartToken(
  datePart: NumberRuleDatePart,
  dateKey: string,
): string {
  if (datePart === "none") {
    return "";
  }
  const digits = dateKey.replace(/-/g, "");
  if (datePart === "year") {
    return digits.slice(0, 4);
  }
  if (datePart === "yearMonth") {
    return digits.slice(0, 6);
  }
  return digits.slice(0, 8);
}

export function resolveDateKey(
  context: Pick<NumberGenerationContext, "propagatedOn" | "generatedOn">,
): string {
  const explicit = context.generatedOn ?? context.propagatedOn;
  if (parseDateOnly(explicit)) {
    return explicit;
  }
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function composeAccessionNumber(
  prefix: string,
  dateToken: string,
  sequence: number,
  padding: number,
): string {
  const parts = [prefix, dateToken, String(sequence).padStart(padding, "0")].filter(
    Boolean,
  );
  return parts.join("-");
}

export function numberRuleSignature(rule: {
  prefix: string;
  datePart: NumberRuleDatePart;
  sequenceScope: NumberSequenceScope;
  sequencePadding: number;
}): string {
  return [
    normalizeRulePrefix(rule.prefix),
    rule.datePart,
    rule.sequenceScope,
    rule.sequencePadding,
  ].join("|");
}

export function validateNumberRuleDraft(
  draft: NumberRuleDraft,
  state: WorkspaceState,
  currentRuleId?: string,
): Result<NumberRuleDraft> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  const name = draft.name.trim();
  if (name.length < 2) {
    errors.push(fieldError("name", "required", "请填写规则名称"));
  }
  const scopeType = draft.scopeType;
  const scopeValue = draft.scopeValue.trim();
  if (!["trial", "cropFamily", "source"].includes(scopeType)) {
    errors.push(fieldError("scopeType", "invalid", "请选择规则适用范围"));
  } else if (!scopeValue) {
    errors.push(
      fieldError(
        "scopeValue",
        "required",
        scopeType === "trial"
          ? "请选择适用试验"
          : scopeType === "cropFamily"
            ? "请填写作物科属"
            : "请填写来源名称",
      ),
    );
  } else if (scopeType === "trial") {
    const trial = state.trials.find((trial) => trial.id === scopeValue);
    if (!trial) {
      errors.push(fieldError("scopeValue", "unknown", "请选择有效试验"));
    }
  }

  const prefix = normalizeRulePrefix(draft.prefix);
  if (prefix.length < MIN_PREFIX_LENGTH || prefix.length > MAX_PREFIX_LENGTH) {
    errors.push(
      fieldError(
        "prefix",
        "invalid",
        `前缀需为 ${MIN_PREFIX_LENGTH} 到 ${MAX_PREFIX_LENGTH} 位字母或数字`,
      ),
    );
  }
  if (!["none", "year", "yearMonth", "yearMonthDay"].includes(draft.datePart)) {
    errors.push(fieldError("datePart", "invalid", "请选择日期格式"));
  }
  if (
    !Number.isInteger(draft.sequencePadding) ||
    draft.sequencePadding < MIN_PADDING ||
    draft.sequencePadding > MAX_PADDING
  ) {
    errors.push(
      fieldError(
        "sequencePadding",
        "range",
        `序号位数必须在 ${MIN_PADDING} 到 ${MAX_PADDING} 之间`,
      ),
    );
  }
  if (!["global", "perDate"].includes(draft.sequenceScope)) {
    errors.push(fieldError("sequenceScope", "invalid", "请选择序号方式"));
  }
  if (
    draft.sequenceScope === "perDate" &&
    draft.datePart === "none"
  ) {
    errors.push(
      fieldError(
        "sequenceScope",
        "requires_date",
        "按日期重新计数时必须启用日期段",
      ),
    );
  }
  if (
    !Number.isInteger(draft.nextSequence) ||
    draft.nextSequence < MIN_SEQUENCE ||
    draft.nextSequence > MAX_SEQUENCE
  ) {
    errors.push(
      fieldError(
        "nextSequence",
        "range",
        `起始序号必须在 ${MIN_SEQUENCE} 到 ${MAX_SEQUENCE} 之间`,
      ),
    );
  }

  if (
    prefix &&
    Number.isInteger(draft.sequencePadding) &&
    draft.sequencePadding >= MIN_PADDING &&
    draft.sequencePadding <= MAX_PADDING
  ) {
    const maxDateToken =
      draft.datePart === "none"
        ? ""
        : draft.datePart === "year"
          ? "0000"
          : draft.datePart === "yearMonth"
            ? "000000"
            : "00000000";
    const preview = composeAccessionNumber(
      prefix,
      maxDateToken,
      9,
      draft.sequencePadding,
    );
    if (preview.length > MAX_ACCESSION_NO_LENGTH) {
      errors.push(
        fieldError(
          "sequencePadding",
          "too_long",
          `按该组合生成的编号最长 ${preview.length} 位，超过 ${MAX_ACCESSION_NO_LENGTH} 位上限，请缩短前缀或日期`,
        ),
      );
    }
  }

  const duplicate = state.numberRules.find(
    (rule) =>
      rule.id !== currentRuleId &&
      rule.status === "active" &&
      draft.status === "active" &&
      numberRuleSignature(rule) ===
        numberRuleSignature({
          prefix,
          datePart: draft.datePart,
          sequenceScope: draft.sequenceScope,
          sequencePadding: draft.sequencePadding,
        }),
  );
  if (duplicate) {
    errors.push(
      fieldError(
        "prefix",
        "conflicting_rule",
        `启用中的规则「${duplicate.name}」已使用相同的前缀、日期和序号组合，不同来源也会产生重号`,
      ),
    );
  }

  if (errors.length > 0) {
    return fail(errors);
  }
  return ok({
    ...draft,
    name,
    scopeValue:
      draft.scopeType === "trial"
        ? scopeValue
        : draft.scopeType === "cropFamily"
          ? scopeValue
          : scopeValue,
    prefix,
  });
}

export function createNumberRule(
  draft: NumberRuleDraft,
  state: WorkspaceState,
): Result<NumberRule> {
  const validated = validateNumberRuleDraft(draft, state);
  if (!validated.ok) {
    return validated;
  }
  const value = validated.value;
  const timestamp = new Date().toISOString();
  return ok({
    id: createId("rule"),
    name: value.name,
    scopeType: value.scopeType,
    scopeValue: value.scopeValue,
    prefix: value.prefix,
    datePart: value.datePart,
    sequencePadding: value.sequencePadding,
    sequenceScope: value.sequenceScope,
    nextSequence: value.nextSequence,
    status: value.status,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function updateNumberRule(
  current: NumberRule,
  draft: NumberRuleDraft,
  state: WorkspaceState,
): Result<NumberRule> {
  const validated = validateNumberRuleDraft(draft, state, current.id);
  if (!validated.ok) {
    return validated;
  }
  const value = validated.value;
  return ok({
    ...current,
    name: value.name,
    scopeType: value.scopeType,
    scopeValue: value.scopeValue,
    prefix: value.prefix,
    datePart: value.datePart,
    sequencePadding: value.sequencePadding,
    sequenceScope: value.sequenceScope,
    nextSequence: value.nextSequence,
    status: value.status,
    updatedAt: new Date().toISOString(),
  });
}

export function ruleMatchesContext(
  rule: NumberRule,
  state: WorkspaceState,
  context: NumberGenerationContext,
): boolean {
  if (rule.status !== "active") {
    return false;
  }
  if (rule.scopeType === "trial") {
    return rule.scopeValue === context.trialId;
  }
  if (rule.scopeType === "source") {
    return rule.scopeValue.trim() === context.source.trim();
  }
  const trial = state.trials.find((item) => item.id === context.trialId);
  return Boolean(trial && trial.cropFamily.trim() === rule.scopeValue.trim());
}

export function selectNumberRule(
  state: WorkspaceState,
  context: NumberGenerationContext,
): NumberRule | undefined {
  const priority: NumberRuleScopeType[] = ["trial", "source", "cropFamily"];
  for (const scopeType of priority) {
    const matches = state.numberRules
      .filter(
        (rule) =>
          rule.scopeType === scopeType &&
          ruleMatchesContext(rule, state, context),
      )
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
    if (matches.length > 0) {
      return matches[0];
    }
  }
  return undefined;
}

export function countRuleUsage(
  state: WorkspaceState,
  ruleId: string,
): number {
  return state.accessions.filter(
    (accession) => accession.numberRuleId === ruleId,
  ).length;
}

export function ruleCanDelete(
  state: WorkspaceState,
  rule: NumberRule,
): boolean {
  return countRuleUsage(state, rule.id) === 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sequenceFromExisting(
  accessions: Accession[],
  rule: NumberRule,
  dateKey: string,
): number {
  const dateToken = datePartToken(rule.datePart, dateKey);
  const datePattern = rule.datePart === "none" ? "" : `${escapeRegExp(dateToken)}-`;
  const matcher = new RegExp(
    `^${escapeRegExp(rule.prefix)}-${datePattern}(\\d{${rule.sequencePadding},})$`,
  );
  return accessions.reduce((max, accession) => {
    const match = matcher.exec(accession.accessionNo);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
}

interface AllocationState {
  ruleCounters: Map<string, number>;
  dateCounters: Map<string, number>;
}

function counterKey(ruleId: string, dateKey: string): string {
  return `${ruleId}@${dateKey}`;
}

function nextSequenceForRule(
  state: WorkspaceState,
  allocation: AllocationState,
  rule: NumberRule,
  dateKey: string,
): number {
  if (rule.sequenceScope === "perDate") {
    const key = counterKey(rule.id, dateKey);
    const fromBatch = allocation.dateCounters.get(key);
    if (fromBatch !== undefined) {
      return fromBatch;
    }
    const seeded = Math.max(
      rule.nextSequence - 1,
      sequenceFromExisting(state.accessions, rule, dateKey),
    );
    return seeded;
  }
  const fromBatch = allocation.ruleCounters.get(rule.id);
  if (fromBatch !== undefined) {
    return fromBatch;
  }
  const seeded = Math.max(
    rule.nextSequence - 1,
    sequenceFromExisting(state.accessions, rule, dateKey),
  );
  return seeded;
}

export interface NumberPlanIssue {
  field: string;
  code: string;
  message: string;
}

export interface NumberPlanEntry extends GeneratedNumber {
  sequence: number;
  conflicts: string[];
  truncated: boolean;
  skipped: boolean;
}

export interface NumberPlan {
  entries: NumberPlanEntry[];
  issues: NumberPlanIssue[];
  bumpedRules: Array<{ ruleId: string; rule: NumberRule; nextSequence: number }>;
}

/**
 * Plans one or more consecutive numbers. Entries with no matching active rule
 * are returned as `skipped` with an issue instead of failing the whole batch,
 * so callers (import preview, trial copy) can still preview the remaining
 * rows. Issues whose code starts with `blocked_` prevent committing the plan.
 */
export function planGeneratedNumbers(
  state: WorkspaceState,
  contexts: NumberGenerationContext[],
): NumberPlan {
  const issues: NumberPlanIssue[] = [];
  const entries: NumberPlanEntry[] = [];
  const working = new Set(
    state.accessions.map((item) => item.accessionNo.toLowerCase()),
  );
  const workingRules = new Map(state.numberRules.map((rule) => [rule.id, rule]));
  const allocation: AllocationState = {
    ruleCounters: new Map(),
    dateCounters: new Map(),
  };
  const maxByRule = new Map<string, number>();

  contexts.forEach((context, index) => {
    let rule: NumberRule | undefined;
    if (context.ruleId) {
      const explicit = state.numberRules.find(
        (item) => item.id === context.ruleId,
      );
      if (!explicit || explicit.status !== "active") {
        issues.push({
          field: `rows.${index}.accessionNo`,
          code: "blocked_rule_inactive",
          message: `第 ${index + 1} 行原编号规则${explicit ? "已停用" : "已被删除"}，无法按同一规则重新编号`,
        });
        entries.push({
          accessionNo: "",
          ruleId: undefined,
          ruleName: explicit ? explicit.name : "已删除规则",
          dateKey: resolveDateKey(context),
          sequence: 0,
          conflicts: [],
          truncated: false,
          skipped: true,
        });
        return;
      }
      rule = explicit;
    } else {
      rule = selectNumberRule(state, context);
    }
    const dateKey = resolveDateKey(context);

    if (!rule) {
      issues.push({
        field: `rows.${index}.accessionNo`,
        code: "blocked_no_rule",
        message: `第 ${index + 1} 行没有匹配的启用编号规则，请先配置规则或手工指定编号`,
      });
      entries.push({
        accessionNo: "",
        ruleId: undefined,
        ruleName: "未匹配到启用规则",
        dateKey,
        sequence: 0,
        conflicts: [],
        truncated: false,
        skipped: true,
      });
      return;
    }

    const dateToken = datePartToken(rule.datePart, dateKey);
    let sequence = nextSequenceForRule(state, allocation, rule, dateKey) + 1;
    let accessionNo = composeAccessionNumber(
      rule.prefix,
      dateToken,
      sequence,
      rule.sequencePadding,
    );

    while (working.has(accessionNo.toLowerCase())) {
      sequence += 1;
      accessionNo = composeAccessionNumber(
        rule.prefix,
        dateToken,
        sequence,
        rule.sequencePadding,
      );
    }
    working.add(accessionNo.toLowerCase());

    if (rule.sequenceScope === "perDate") {
      allocation.dateCounters.set(counterKey(rule.id, dateKey), sequence);
    } else {
      allocation.ruleCounters.set(rule.id, sequence);
    }
    maxByRule.set(rule.id, Math.max(maxByRule.get(rule.id) ?? 0, sequence));

    const truncated = accessionNo.length > MAX_ACCESSION_NO_LENGTH;
    if (truncated) {
      issues.push({
        field: `rows.${index}.accessionNo`,
        code: "blocked_too_long",
        message: `第 ${index + 1} 行生成的编号 ${accessionNo} 超过 ${MAX_ACCESSION_NO_LENGTH} 位上限，请调整规则`,
      });
    }
    if (String(sequence).length > rule.sequencePadding) {
      issues.push({
        field: `rows.${index}.accessionNo`,
        code: "sequence_overflow",
        message: `第 ${index + 1} 行序号 ${sequence} 已超出规则位数（${rule.sequencePadding} 位），生成编号仍唯一，但建议加宽序号位`,
      });
    }

    entries.push({
      accessionNo,
      ruleId: rule.id,
      ruleName: rule.name,
      dateKey,
      sequence,
      conflicts: [],
      truncated,
      skipped: false,
    });
  });

  const bumpedRules = Array.from(maxByRule.entries()).map(([ruleId, max]) => {
    const rule = workingRules.get(ruleId)!;
    return { ruleId, rule, nextSequence: max + 1 };
  });

  return { entries, issues, bumpedRules };
}

export interface NumberPreviewItem extends GeneratedNumber {
  sequence: number;
  truncated: boolean;
}

export function previewNextNumbers(
  state: WorkspaceState,
  context: NumberGenerationContext,
  count: number,
): { items: NumberPreviewItem[]; issues: NumberPlanIssue[] } {
  const plan = planGeneratedNumbers(
    state,
    Array.from({ length: count }, () => context),
  );
  return {
    items: plan.entries
      .filter((entry) => !entry.skipped)
      .map((entry) => ({
        accessionNo: entry.accessionNo,
        ruleId: entry.ruleId,
        ruleName: entry.ruleName,
        dateKey: entry.dateKey,
        sequence: entry.sequence,
        truncated: entry.truncated,
      })),
    issues: plan.issues,
  };
}

export function applyBumpedRules(
  rules: NumberRule[],
  bumped: NumberPlan["bumpedRules"],
): NumberRule[] {
  const bumpedById = new Map(bumped.map((item) => [item.ruleId, item.nextSequence]));
  const timestamp = new Date().toISOString();
  return rules.map((rule) =>
    bumpedById.has(rule.id)
      ? {
          ...rule,
          nextSequence: bumpedById.get(rule.id)!,
          updatedAt: timestamp,
        }
      : rule,
  );
}

export function describeRuleScope(rule: NumberRule, trials: Trial[]): string {
  if (rule.scopeType === "trial") {
    const trial = trials.find((item) => item.id === rule.scopeValue);
    return trial ? `试验 ${trial.code}` : "未知试验";
  }
  if (rule.scopeType === "cropFamily") {
    return `科属 ${rule.scopeValue}`;
  }
  return `来源 ${rule.scopeValue}`;
}

export function describeRulePattern(rule: NumberRule): string {
  const dateLabel =
    rule.datePart === "none"
      ? ""
      : rule.datePart === "year"
        ? "YYYY"
        : rule.datePart === "yearMonth"
          ? "YYYYMM"
          : "YYYYMMDD";
  return composeAccessionNumber(
    rule.prefix,
    dateLabel,
    1,
    rule.sequencePadding,
  );
}

export function accessionNumberRuleFor(
  state: WorkspaceState,
  accession: Accession,
): NumberRule | undefined {
  if (!accession.numberRuleId) {
    return undefined;
  }
  return state.numberRules.find((rule) => rule.id === accession.numberRuleId);
}
