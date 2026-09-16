import type {
  Accession,
  AccessionRetirementRecord,
  PreferredLight,
  WorkspaceState,
} from "./types";
import { createId } from "./id";
import {
  GROWTH_BOUNDS,
  BENCH_LIGHT_COMPATIBILITY,
  MAX_ACCESSION_NO_LENGTH,
  normalizeLabels,
  parseDateOnly,
  todayDateOnly,
} from "./rules";
import { fail, fieldError, ok, type Result } from "./result";

export interface AccessionDraft {
  trialId: string;
  accessionNo: string;
  numberRuleId?: string;
  cultivar: string;
  source: string;
  propagatedOn: string;
  quantity: number;
  trayCells: number;
  preferredLight: PreferredLight;
  genotypeNote: string;
  labels: string[];
}

export interface AccessionRetirementDraft {
  retiredAt: string;
  reason: string;
  replacementId: string;
}

export function isAccessionRetired(accession: Accession): boolean {
  return accession.lifecycleStatus === "retired";
}

export function latestRetirementRecord(
  accession: Accession,
): AccessionRetirementRecord | undefined {
  return accession.retirementHistory[accession.retirementHistory.length - 1];
}

export function validateAccessionDraft(
  draft: AccessionDraft,
  state: WorkspaceState,
  currentId?: string,
  options: { accessionNoLocked?: boolean } = {},
): Result<AccessionDraft> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  if (!state.trials.some((trial) => trial.id === draft.trialId)) {
    errors.push(fieldError("trialId", "unknown", "请选择有效试验"));
  }
  const accessionNo = draft.accessionNo.trim();
  if (options.accessionNoLocked && accessionNo !== draft.accessionNo) {
    errors.push(
      fieldError(
        "accessionNo",
        "immutable",
        "已有材料编号不能修改；规则变更只影响新生成的编号",
      ),
    );
  }
  if (
    !/^[A-Za-z0-9][A-Za-z0-9-]{1,}$/.test(accessionNo) ||
    accessionNo.includes("--")
  ) {
    errors.push(
      fieldError(
        "accessionNo",
        "invalid_format",
        "材料编号需为字母、数字和连字符，例如 ACC-0001 或 SOL-20260916-001",
      ),
    );
  }
  if (accessionNo.length > MAX_ACCESSION_NO_LENGTH) {
    errors.push(
      fieldError(
        "accessionNo",
        "too_long",
        `材料编号不能超过 ${MAX_ACCESSION_NO_LENGTH} 个字符`,
      ),
    );
  }
  const duplicate = state.accessions.find((item) => {
    if (item.id === currentId) {
      return false;
    }
    return item.accessionNo.trim().toLowerCase() === accessionNo.toLowerCase();
  });
  if (duplicate) {
    errors.push(
      fieldError(
        "accessionNo",
        "duplicate",
        `该材料编号已被 ${duplicate.cultivar} 使用`,
      ),
    );
  }
  if (draft.numberRuleId) {
    const rule = state.numberRules.find(
      (item) => item.id === draft.numberRuleId,
    );
    if (!rule) {
      errors.push(
        fieldError("numberRuleId", "unknown", "编号规则不存在，请重新生成或手工指定编号"),
      );
    } else if (rule.status === "inactive") {
      errors.push(
        fieldError(
          "numberRuleId",
          "rule_inactive",
          "编号规则已停用，不能继续按它生成新编号，请选择其他规则或手工指定编号",
        ),
      );
    }
  }
  if (draft.cultivar.trim().length < 2) {
    errors.push(fieldError("cultivar", "required", "请填写品种名称"));
  }
  if (draft.source.trim().length < 3) {
    errors.push(fieldError("source", "required", "请填写来源"));
  }
  if (!parseDateOnly(draft.propagatedOn)) {
    errors.push(
      fieldError("propagatedOn", "invalid_date", "繁殖日期无效"),
    );
  }
  if (Number.isNaN(draft.quantity) || draft.quantity < 1 || draft.quantity > 500) {
    errors.push(
      fieldError(
        "quantity",
        "range",
        "数量必须在 1 到 500 之间",
      ),
    );
  }
  if (![32, 50, 72, 104, 128, 200, 288].includes(draft.trayCells)) {
    errors.push(
      fieldError("trayCells", "invalid", "请选择支持的穴盘规格"),
    );
  }
  if (!["full-sun", "partial-shade", "shade"].includes(draft.preferredLight)) {
    errors.push(
      fieldError(
        "preferredLight",
        "invalid",
        "请选择支持的光照类型",
      ),
    );
  }
  if (draft.genotypeNote.trim().length < 10) {
    errors.push(
      fieldError(
        "genotypeNote",
        "too_short",
        "请用至少 10 个字符描述基因型或批次",
      ),
    );
  }
  if (errors.length > 0) {
    return fail(errors);
  }
  return ok({
    ...draft,
    accessionNo: draft.accessionNo.trim(),
    cultivar: draft.cultivar.trim(),
    source: draft.source.trim(),
    genotypeNote: draft.genotypeNote.trim(),
    labels: normalizeLabels(draft.labels),
  });
}

export function createAccession(
  draft: AccessionDraft,
  state: WorkspaceState,
): Result<Accession> {
  const validated = validateAccessionDraft(draft, state);
  if (!validated.ok) {
    return validated;
  }
  const value = validated.value;
  return ok({
    id: createId("acc"),
    trialId: value.trialId,
    accessionNo: value.accessionNo,
    numberRuleId: value.numberRuleId,
    cultivar: value.cultivar,
    source: value.source,
    propagatedOn: value.propagatedOn,
    quantity: value.quantity,
    trayCells: value.trayCells,
    preferredLight: value.preferredLight,
    genotypeNote: value.genotypeNote,
    labels: value.labels,
    lifecycleStatus: "active",
    retirementHistory: [],
  });
}

export function updateAccession(
  current: Accession,
  draft: AccessionDraft,
  state: WorkspaceState,
): Result<Accession> {
  if (draft.accessionNo.trim() !== current.accessionNo) {
    return fail([
      fieldError(
        "accessionNo",
        "immutable",
        "已有材料编号不能修改；编号规则的调整只影响新生成的编号",
      ),
    ]);
  }
  if (draft.numberRuleId !== current.numberRuleId && draft.numberRuleId) {
    return fail([
      fieldError(
        "numberRuleId",
        "immutable",
        "历史材料的编号来源不能被改写",
      ),
    ]);
  }
  const validated = validateAccessionDraft(draft, state, current.id, {
    accessionNoLocked: true,
  });
  if (!validated.ok) {
    return validated;
  }
  const value = validated.value;
  return ok({
    ...current,
    trialId: value.trialId,
    accessionNo: current.accessionNo,
    numberRuleId: current.numberRuleId,
    cultivar: value.cultivar,
    source: value.source,
    propagatedOn: value.propagatedOn,
    quantity: value.quantity,
    trayCells: value.trayCells,
    preferredLight: value.preferredLight,
    genotypeNote: value.genotypeNote,
    labels: value.labels,
    lifecycleStatus: current.lifecycleStatus,
    retiredAt: current.retiredAt,
    retirementReason: current.retirementReason,
    replacementId: current.replacementId,
    retirementHistory: current.retirementHistory,
  });
}

export function bumpRulesForAccessions(
  state: WorkspaceState,
  accessions: Accession[],
): WorkspaceState["numberRules"] {
  const maxSequenceByRule = new Map<string, number>();
  for (const accession of accessions) {
    if (!accession.numberRuleId) {
      continue;
    }
    const rule = state.numberRules.find(
      (item) => item.id === accession.numberRuleId,
    );
    if (!rule) {
      continue;
    }
    const dateToken =
      rule.datePart === "none"
        ? ""
        : accession.propagatedOn.replace(/-/g, "").slice(
            0,
            rule.datePart === "year" ? 4 : rule.datePart === "yearMonth" ? 6 : 8,
          );
    const prefixParts = [rule.prefix, dateToken].filter(Boolean).join("-");
    const matcher = new RegExp(
      `^${prefixParts.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`,
    );
    const match = matcher.exec(accession.accessionNo);
    if (match) {
      maxSequenceByRule.set(
        rule.id,
        Math.max(maxSequenceByRule.get(rule.id) ?? 0, Number(match[1])),
      );
    }
  }
  const timestamp = new Date().toISOString();
  return state.numberRules.map((rule) => {
    const max = maxSequenceByRule.get(rule.id);
    if (max === undefined || max + 1 <= rule.nextSequence) {
      return rule;
    }
    return { ...rule, nextSequence: max + 1, updatedAt: timestamp };
  });
}

export function replacementTargetFor(
  accession: Accession,
): string | undefined {
  if (accession.replacementId) {
    return accession.replacementId;
  }
  return latestRetirementRecord(accession)?.replacementId;
}

export function replacementCandidatesForAccession(
  state: WorkspaceState,
  accession: Accession,
): Accession[] {
  return state.accessions.filter(
    (candidate) =>
      candidate.id !== accession.id &&
      candidate.trialId === accession.trialId &&
      !isAccessionRetired(candidate) &&
      !replacementWouldCycle(state, accession.id, candidate.id),
  );
}

export function retireAccession(
  accession: Accession,
  draft: AccessionRetirementDraft,
  state: WorkspaceState,
): Result<Accession> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  if (isAccessionRetired(accession)) {
    errors.push(
      fieldError("lifecycleStatus", "already_retired", "该材料已经停用"),
    );
  }
  if (draft.reason.trim().length < 4) {
    errors.push(
      fieldError("reason", "too_short", "请填写至少四个字符的停用原因"),
    );
  }
  const retiredAt = normalizeTimestamp(draft.retiredAt);
  if (!retiredAt) {
    errors.push(fieldError("retiredAt", "invalid_date", "停用时间无效"));
  }

  const replacement = state.accessions.find(
    (candidate) => candidate.id === draft.replacementId,
  );
  if (!replacement) {
    errors.push(
      fieldError("replacementId", "unknown", "请选择有效替代材料"),
    );
  } else if (replacement.id === accession.id) {
    errors.push(
      fieldError("replacementId", "self", "替代材料不能是当前材料"),
    );
  } else if (replacement.trialId !== accession.trialId) {
    errors.push(
      fieldError(
        "replacementId",
        "cross_trial",
        "替代材料必须属于同一试验",
      ),
    );
  } else if (isAccessionRetired(replacement)) {
    errors.push(
      fieldError(
        "replacementId",
        "retired",
        "替代材料必须处于在用状态",
      ),
    );
  } else if (replacementWouldCycle(state, accession.id, replacement.id)) {
    errors.push(
      fieldError(
        "replacementId",
        "cycle",
        "替代关系不能形成循环",
      ),
    );
  }

  if (errors.length > 0 || !retiredAt) {
    return fail(errors);
  }

  const record: AccessionRetirementRecord = {
    id: createId("retire"),
    retiredAt,
    reason: draft.reason.trim(),
    replacementId: replacement?.id,
  };
  return ok({
    ...accession,
    lifecycleStatus: "retired",
    retiredAt,
    retirementReason: record.reason,
    replacementId: replacement?.id,
    retirementHistory: [...accession.retirementHistory, record],
  });
}

export function restoreAccession(
  accession: Accession,
  state: WorkspaceState,
  benchConditionsConfirmed: boolean,
): Result<Accession> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  if (!isAccessionRetired(accession)) {
    errors.push(
      fieldError("lifecycleStatus", "already_active", "该材料当前不是停用状态"),
    );
  }
  if (!benchConditionsConfirmed) {
    errors.push(
      fieldError(
        "benchConditionsConfirmed",
        "confirmation_required",
        "请先确认已重新检查台架和光照条件",
      ),
    );
  }

  const bench = state.benches.find((item) =>
    item.assignedIds.includes(accession.id),
  );
  if (bench) {
    if (bench.status === "blocked" || bench.status === "quarantine") {
      errors.push(
        fieldError(
          "benchId",
          "unavailable",
          `台架 ${bench.code} 当前不可用，请先移出或恢复台架`,
        ),
      );
    } else if (
      !BENCH_LIGHT_COMPATIBILITY[accession.preferredLight].includes(
        bench.lightProfile,
      )
    ) {
      errors.push(
        fieldError(
          "preferredLight",
          "light_mismatch",
          `材料所需光照与台架 ${bench.code} 不兼容，请先调整分配`,
        ),
      );
    }
  }

  if (errors.length > 0) {
    return fail(errors);
  }

  const restoredAt = new Date().toISOString();
  return ok({
    ...accession,
    lifecycleStatus: "active",
    retiredAt: undefined,
    retirementReason: undefined,
    replacementId: undefined,
    retirementHistory: accession.retirementHistory.map((record, index) =>
      index === accession.retirementHistory.length - 1 && !record.restoredAt
        ? { ...record, restoredAt }
        : record,
    ),
  });
}

export function replacementWouldCycle(
  state: WorkspaceState,
  accessionId: string,
  replacementId: string,
): boolean {
  const byId = new Map(state.accessions.map((item) => [item.id, item]));
  const visited = new Set<string>();
  let cursor: string | undefined = replacementId;
  while (cursor) {
    if (cursor === accessionId) {
      return true;
    }
    if (visited.has(cursor)) {
      return true;
    }
    visited.add(cursor);
    const current = byId.get(cursor);
    cursor = current ? replacementTargetFor(current) : undefined;
  }
  return false;
}

function normalizeTimestamp(value: string): string | undefined {
  if (!value.trim()) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

export function accessionMatchesQuery(
  accession: Accession,
  query: string,
  trialFilter: string,
): boolean {
  const haystack = [
    accession.accessionNo,
    accession.cultivar,
    accession.source,
    accession.genotypeNote,
    ...accession.labels,
  ]
    .join(" ")
    .toLowerCase();
  const matchesQuery = !query.trim() || haystack.includes(query.toLowerCase());
  const matchesTrial = !trialFilter || accession.trialId === trialFilter;
  return matchesQuery && matchesTrial;
}

export function accessionAgeDays(accession: Accession): number {
  const propagated = parseDateOnly(accession.propagatedOn);
  const today = parseDateOnly(todayDateOnly());
  if (!propagated || !today) {
    return 0;
  }
  return Math.max(0, Math.floor((today.getTime() - propagated.getTime()) / 86400000));
}

export function accessionIsWithinGrowthBounds(
  heightMm: number,
  leafCount: number,
  ecMs: number,
): boolean {
  return (
    heightMm >= GROWTH_BOUNDS.heightMm.min &&
    heightMm <= GROWTH_BOUNDS.heightMm.max &&
    leafCount >= GROWTH_BOUNDS.leafCount.min &&
    leafCount <= GROWTH_BOUNDS.leafCount.max &&
    ecMs >= GROWTH_BOUNDS.ecMs.min &&
    ecMs <= GROWTH_BOUNDS.ecMs.max
  );
}
