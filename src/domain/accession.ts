import type {
  Accession,
  AccessionRetirementRecord,
  PreferredLight,
  WorkspaceState,
} from "./types";
import { createAccessionNumber, createId } from "./id";
import {
  GROWTH_BOUNDS,
  BENCH_LIGHT_COMPATIBILITY,
  normalizeLabels,
  parseDateOnly,
  todayDateOnly,
} from "./rules";
import { fail, fieldError, ok, type Result } from "./result";

export interface AccessionDraft {
  trialId: string;
  accessionNo: string;
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

export function isAccessionMerged(accession: Accession): boolean {
  return accession.lifecycleStatus === "merged";
}

/** 可进入新分配、新观测、新编辑的唯一在用状态。 */
export function isAccessionOperational(accession: Accession): boolean {
  return accession.lifecycleStatus === "active";
}

/** 沿 mergedIntoId 解析到当前唯一归属；非墓碑原样返回。 */
export function resolveAccessionId(
  state: WorkspaceState,
  accessionId: string,
): string {
  const byId = new Map(state.accessions.map((item) => [item.id, item]));
  let cursor = accessionId;
  const guard = new Set<string>([cursor]);
  for (;;) {
    const current = byId.get(cursor);
    const next = current?.mergedIntoId;
    if (!next || guard.has(next)) {
      return cursor;
    }
    guard.add(next);
    cursor = next;
  }
}

export function resolveAccession(
  state: WorkspaceState,
  accessionId: string,
): Accession | undefined {
  return state.accessions.find(
    (item) => item.id === resolveAccessionId(state, accessionId),
  );
}

/** 直接或经身份别名指向某存活者的全部材料（含存活者自身）。 */
export function accessionsResolvingTo(
  state: WorkspaceState,
  accessionId: string,
): Accession[] {
  const survivorId = resolveAccessionId(state, accessionId);
  return state.accessions.filter(
    (item) => resolveAccessionId(state, item.id) === survivorId,
  );
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
): Result<AccessionDraft> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  if (!state.trials.some((trial) => trial.id === draft.trialId)) {
    errors.push(fieldError("trialId", "unknown", "请选择有效试验"));
  }
  if (!/^ACC-\d{4,}$/.test(draft.accessionNo.trim())) {
    errors.push(
      fieldError(
        "accessionNo",
        "invalid_format",
        "请使用类似 ACC-0001 的材料编号",
      ),
    );
  }
  const duplicate = state.accessions.find(
    (item) =>
      item.accessionNo === draft.accessionNo.trim() && item.id !== currentId,
  );
  if (duplicate) {
    errors.push(
      fieldError(
        "accessionNo",
        "duplicate",
        "该材料编号已被使用",
      ),
    );
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
  if (isAccessionMerged(current)) {
    return fail([
      fieldError(
        "lifecycleStatus",
        "merged",
        "该批次已合并入其他材料，不能再编辑；请在存活材料上修改",
      ),
    ]);
  }
  const validated = validateAccessionDraft(draft, state, current.id);
  if (!validated.ok) {
    return validated;
  }
  const value = validated.value;
  return ok({
    ...current,
    trialId: value.trialId,
    accessionNo: value.accessionNo,
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
      isAccessionOperational(candidate) &&
      !replacementWouldCycle(state, accession.id, candidate.id),
  );
}

export function retireAccession(
  accession: Accession,
  draft: AccessionRetirementDraft,
  state: WorkspaceState,
): Result<Accession> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  if (isAccessionMerged(accession)) {
    errors.push(
      fieldError(
        "lifecycleStatus",
        "merged",
        "该批次已合并入其他材料，不能再停用",
      ),
    );
  } else if (isAccessionRetired(accession)) {
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
  if (isAccessionMerged(accession)) {
    errors.push(
      fieldError(
        "lifecycleStatus",
        "merged",
        "该批次已合并，合并不可逆，不能恢复",
      ),
    );
  } else if (!isAccessionRetired(accession)) {
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

export function nextAccessionNumber(state: WorkspaceState): string {
  const largest = state.accessions.reduce((max, item) => {
    const match = /^ACC-(\d+)$/.exec(item.accessionNo);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return createAccessionNumber(largest + 1);
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
