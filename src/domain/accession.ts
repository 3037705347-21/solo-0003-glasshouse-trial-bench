import type { Accession, PreferredLight, WorkspaceState } from "./types";
import { createAccessionNumber, createId } from "./id";
import {
  GROWTH_BOUNDS,
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
  });
}

export function updateAccession(
  current: Accession,
  draft: AccessionDraft,
  state: WorkspaceState,
): Result<Accession> {
  if (current.mergedIntoId) {
    return fail([
      fieldError(
        "trialId",
        "merged",
        "材料已合并归档，不能再编辑；如需调整请编辑合并目标材料",
      ),
    ]);
  }
  const validated = validateAccessionDraft(draft, state, current.id);
  if (!validated.ok) {
    return validated;
  }
  const value = validated.value;
  if (value.trialId !== current.trialId) {
    const hasLineage = state.lineageRelations.some(
      (relation) =>
        relation.endpointAId === current.id ||
        relation.endpointBId === current.id,
    );
    if (hasLineage) {
      return fail([
        fieldError(
          "trialId",
          "lineage_scoped",
          "该材料已存在谱系关系，不能移动到其他试验；如需归并请使用合并功能",
        ),
      ]);
    }
  }
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
  });
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
