import type {
  Accession,
  ConsumptionDestination,
  ConsumptionEvent,
  ConsumptionRef,
  WorkspaceState,
} from "./types";
import { createId } from "./id";
import { parseDateOnly, todayDateOnly } from "./rules";
import { isAccessionRetired } from "./accession";
import { fail, fieldError, ok, type Result } from "./result";

export interface ConsumptionDraft {
  accessionId: string;
  quantity: number;
  usedOn: string;
  recordedBy: string;
  destination: ConsumptionDestination;
  /** 自由填写的活动/去向名称；destination 为 trial 时可为空（自动取试验名）。 */
  refLabel: string;
  note: string;
}

export interface CorrectionDraft {
  recordedBy: string;
  /** 更正后该次耗用应当记录的正确数量（非负）。 */
  correctedQuantity: number;
  note: string;
}

export interface MergeDraft {
  /** 被合并（停用）的源批次。 */
  sourceId: string;
  /** 接收余量的目标批次。 */
  targetId: string;
  recordedBy: string;
  usedOn: string;
  note: string;
}

export interface CopyAccessionDraft {
  accession: Accession;
  targetTrialId: string;
  /** 新批次在目标试验下使用的材料编号（可重新编号）。 */
  accessionNo: string;
  quantity: number;
  recordedBy: string;
  note: string;
}

export const CONSUMPTION_DESTINATIONS: ConsumptionDestination[] = [
  "trial",
  "activity",
  "waste",
  "merge",
];

export function destinationLabel(destination: ConsumptionDestination): string {
  switch (destination) {
    case "trial":
      return "试验使用";
    case "activity":
      return "现场活动";
    case "waste":
      return "损耗";
    case "merge":
      return "批次合并";
  }
}

/** 单个批次的当前余量 = 登记数量 + 全部带符号流水。 */
export function remainingQuantity(
  accession: Accession,
  events: ConsumptionEvent[],
): number {
  return events
    .filter((event) => event.accessionId === accession.id)
    .reduce((total, event) => total + event.delta, accession.quantity);
}

export function consumedQuantity(events: ConsumptionEvent[]): number {
  // 净耗用（含更正冲销）只统计 use/correction；批次间转移不属于耗用。
  return -events
    .filter((event) => event.kind !== "transfer")
    .reduce((sum, event) => sum + event.delta, 0);
}

export function transferredInQuantity(events: ConsumptionEvent[]): number {
  return events
    .filter((event) => event.kind === "transfer" && event.delta > 0)
    .reduce((sum, event) => sum + event.delta, 0);
}

export function transferredOutQuantity(events: ConsumptionEvent[]): number {
  return -events
    .filter((event) => event.kind === "transfer" && event.delta < 0)
    .reduce((sum, event) => sum + event.delta, 0);
}

export type StockLevel = "in-stock" | "low" | "empty" | "negative";

export function stockLevel(remaining: number): StockLevel {
  if (remaining < 0) {
    return "negative";
  }
  if (remaining === 0) {
    return "empty";
  }
  if (remaining <= 10) {
    return "low";
  }
  return "in-stock";
}

export function stockLevelLabel(level: StockLevel): string {
  switch (level) {
    case "in-stock":
      return "余量充足";
    case "low":
      return "余量偏低";
    case "empty":
      return "余量为零";
    case "negative":
      return "账面负数";
  }
}

export function eventsForAccession(
  events: ConsumptionEvent[],
  accessionId: string,
): ConsumptionEvent[] {
  return events
    .filter((event) => event.accessionId === accessionId)
    .sort(compareEvents);
}

function compareEvents(left: ConsumptionEvent, right: ConsumptionEvent): number {
  const byDate = right.usedOn.localeCompare(left.usedOn);
  if (byDate !== 0) {
    return byDate;
  }
  return right.recordedAt.localeCompare(left.recordedAt);
}

/** 一次 use 事件经过全部 correction 后的当前有效耗用数量。 */
export function effectiveUsedQuantity(
  event: ConsumptionEvent,
  allEvents: ConsumptionEvent[],
): number {
  const corrections = allEvents.filter(
    (item) => item.supersedesId === event.id,
  );
  return corrections.length === 0
    ? -event.delta
    : -event.delta - corrections.reduce((sum, item) => item.delta, 0);
}

function isDateOnOrBeforeToday(value: string): boolean {
  const date = parseDateOnly(value);
  const today = parseDateOnly(todayDateOnly());
  return Boolean(date && today && date.getTime() <= today.getTime());
}

function buildRef(
  draft: ConsumptionDraft,
  state: WorkspaceState,
): ConsumptionRef | undefined {
  const accession = state.accessions.find((item) => item.id === draft.accessionId);
  if (draft.destination === "trial") {
    const trial = accession
      ? state.trials.find((item) => item.id === accession.trialId)
      : undefined;
    return {
      id: trial?.id,
      label: trial ? `${trial.code} · ${trial.objective}` : "本试验使用",
    };
  }
  const label = draft.refLabel.trim();
  if (!label) {
    return undefined;
  }
  return { label };
}

export function validateConsumptionDraft(
  draft: ConsumptionDraft,
  state: WorkspaceState,
): Result<ConsumptionDraft> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  const accession = state.accessions.find(
    (item) => item.id === draft.accessionId,
  );
  if (!accession) {
    errors.push(fieldError("accessionId", "unknown", "请选择有效材料批次"));
  } else if (isAccessionRetired(accession)) {
    errors.push(
      fieldError(
        "accessionId",
        "retired",
        `${accession.accessionNo} 已停用，不能新增耗用，请先恢复或使用替代批次`,
      ),
    );
  }
  if (
    Number.isNaN(draft.quantity) ||
    !Number.isInteger(draft.quantity) ||
    draft.quantity < 1 ||
    draft.quantity > 500
  ) {
    errors.push(
      fieldError("quantity", "range", "耗用数量必须是 1 到 500 的整数"),
    );
  }
  if (!parseDateOnly(draft.usedOn)) {
    errors.push(fieldError("usedOn", "invalid_date", "使用日期无效"));
  } else if (!isDateOnOrBeforeToday(draft.usedOn)) {
    errors.push(fieldError("usedOn", "future", "使用日期不能晚于今天"));
  }
  if (draft.recordedBy.trim().length < 2) {
    errors.push(fieldError("recordedBy", "required", "请填写登记人"));
  }
  if (!CONSUMPTION_DESTINATIONS.includes(draft.destination)) {
    errors.push(fieldError("destination", "invalid", "请选择耗用去向"));
  }
  if (
    draft.destination !== "trial" &&
    draft.refLabel.trim().length < 2
  ) {
    errors.push(
      fieldError(
        "refLabel",
        "required",
        "请填写去向（试验活动、损耗原因或合并说明）",
      ),
    );
  }
  if (draft.note.trim().length < 4) {
    errors.push(
      fieldError("note", "too_short", "请用至少四个字符说明本次耗用"),
    );
  }
  if (accession && Number.isInteger(draft.quantity) && draft.quantity >= 1) {
    const remaining = remainingQuantity(accession, state.consumptionEvents);
    if (draft.quantity > remaining) {
      errors.push(
        fieldError(
          "quantity",
          "insufficient_stock",
          `${accession.accessionNo} 当前余量 ${remaining}，本次耗用 ${draft.quantity} 会造成负数余量`,
        ),
      );
    }
  }
  if (errors.length > 0) {
    return fail(errors);
  }
  return ok({
    ...draft,
    recordedBy: draft.recordedBy.trim(),
    refLabel: draft.refLabel.trim(),
    note: draft.note.trim(),
  });
}

export function recordConsumption(
  draft: ConsumptionDraft,
  state: WorkspaceState,
): Result<ConsumptionEvent> {
  const validated = validateConsumptionDraft(draft, state);
  if (!validated.ok) {
    return validated;
  }
  const value = validated.value;
  const ref = buildRef(value, state);
  if (!ref) {
    return fail([
      fieldError("refLabel", "required", "请填写本次耗用的去向"),
    ]);
  }
  return ok({
    id: createId("use"),
    accessionId: value.accessionId,
    delta: -value.quantity,
    kind: "use",
    usedOn: value.usedOn,
    recordedAt: new Date().toISOString(),
    recordedBy: value.recordedBy,
    destination: value.destination,
    ref,
    note: value.note,
  });
}

export function validateCorrectionDraft(
  event: ConsumptionEvent,
  draft: CorrectionDraft,
  state: WorkspaceState,
): Result<CorrectionDraft> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  if (event.kind !== "use") {
    errors.push(
      fieldError("event", "not_correctable", "只有耗用记录可以更正"),
    );
  }
  if (event.supersedesId) {
    errors.push(
      fieldError("event", "already_correction", "更正记录不能再次更正"),
    );
  }
  if (
    Number.isNaN(draft.correctedQuantity) ||
    !Number.isInteger(draft.correctedQuantity) ||
    draft.correctedQuantity < 0 ||
    draft.correctedQuantity > 500
  ) {
    errors.push(
      fieldError(
        "correctedQuantity",
        "range",
        "更正后的数量必须是 0 到 500 的整数",
      ),
    );
  }
  if (draft.recordedBy.trim().length < 2) {
    errors.push(fieldError("recordedBy", "required", "请填写更正人"));
  }
  if (draft.note.trim().length < 8) {
    errors.push(
      fieldError(
        "note",
        "too_short",
        "请用至少八个字符说明更正原因，原记录会保留留痕",
      ),
    );
  }
  const accession = state.accessions.find(
    (item) => item.id === event.accessionId,
  );
  if (accession && Number.isInteger(draft.correctedQuantity)) {
    // 基于当前有效耗用（原始数量减去既有更正）计算本次冲销，避免重复更正时重复冲减。
    const currentEffective = effectiveUsedQuantity(
      event,
      state.consumptionEvents,
    );
    const adjustmentDelta = currentEffective - draft.correctedQuantity;
    const remaining = remainingQuantity(accession, state.consumptionEvents);
    if (remaining + adjustmentDelta < 0) {
      errors.push(
        fieldError(
          "correctedQuantity",
          "insufficient_stock",
          `更正后 ${accession.accessionNo} 余量为 ${remaining + adjustmentDelta}，不能形成负数余量`,
        ),
      );
    }
  }
  if (errors.length > 0) {
    return fail(errors);
  }
  return ok({
    ...draft,
    recordedBy: draft.recordedBy.trim(),
    note: draft.note.trim(),
  });
}

export function correctConsumption(
  event: ConsumptionEvent,
  draft: CorrectionDraft,
  state: WorkspaceState,
): Result<ConsumptionEvent> {
  const validated = validateCorrectionDraft(event, draft, state);
  if (!validated.ok) {
    return validated;
  }
  const value = validated.value;
  const currentEffective = effectiveUsedQuantity(event, state.consumptionEvents);
  return ok({
    id: createId("cor"),
    accessionId: event.accessionId,
    delta: currentEffective - value.correctedQuantity,
    kind: "correction",
    usedOn: event.usedOn,
    recordedAt: new Date().toISOString(),
    recordedBy: value.recordedBy,
    destination: event.destination,
    ref: { ...event.ref },
    note: value.note,
    supersedesId: event.id,
  });
}

export function validateMergeDraft(
  draft: MergeDraft,
  state: WorkspaceState,
): Result<MergeDraft> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  const source = state.accessions.find((item) => item.id === draft.sourceId);
  const target = state.accessions.find((item) => item.id === draft.targetId);
  if (!source) {
    errors.push(fieldError("sourceId", "unknown", "请选择要合并的源批次"));
  }
  if (!target) {
    errors.push(fieldError("targetId", "unknown", "请选择接收余量的目标批次"));
  }
  if (source && target && source.id === target.id) {
    errors.push(
      fieldError("targetId", "self", "目标批次不能与源批次相同"),
    );
  }
  if (source && target && source.trialId !== target.trialId) {
    errors.push(
      fieldError(
        "targetId",
        "cross_trial",
        "合并只能在同一试验的批次之间进行，跨试验请使用复制",
      ),
    );
  }
  if (source && isAccessionRetired(source)) {
    errors.push(fieldError("sourceId", "retired", "源批次已停用，不能再次合并"));
  }
  if (target && isAccessionRetired(target)) {
    errors.push(fieldError("targetId", "retired", "目标批次已停用，不能接收余量"));
  }
  if (source && target && source.id !== target.id) {
    const sourceRemaining = remainingQuantity(source, state.consumptionEvents);
    const targetRemaining = remainingQuantity(target, state.consumptionEvents);
    if (sourceRemaining <= 0) {
      errors.push(
        fieldError(
          "sourceId",
          "empty",
          `源批次 ${source.accessionNo} 余量为 ${sourceRemaining}，没有可合并的数量`,
        ),
      );
    }
    if (targetRemaining + sourceRemaining > 500) {
      errors.push(
        fieldError(
          "targetId",
          "range",
          `合并后目标批次余量将为 ${targetRemaining + sourceRemaining}，超过 500 上限，请先盘点目标批次`,
        ),
      );
    }
  }
  if (draft.recordedBy.trim().length < 2) {
    errors.push(fieldError("recordedBy", "required", "请填写操作人"));
  }
  if (!parseDateOnly(draft.usedOn)) {
    errors.push(fieldError("usedOn", "invalid_date", "合并日期无效"));
  } else {
    const date = parseDateOnly(draft.usedOn);
    const today = parseDateOnly(todayDateOnly());
    if (date && today && date.getTime() > today.getTime()) {
      errors.push(fieldError("usedOn", "future", "合并日期不能晚于今天"));
    }
  }
  if (draft.note.trim().length < 4) {
    errors.push(
      fieldError("note", "too_short", "请用至少四个字符说明合并原因"),
    );
  }
  if (errors.length > 0) {
    return fail(errors);
  }
  return ok({
    ...draft,
    recordedBy: draft.recordedBy.trim(),
    note: draft.note.trim(),
  });
}

/**
 * 合并两个批次：源批次余量转出并停用；目标批次登记数量上调以承接转入。
 * 两条 transfer 事件互相配对，历史耗用留在源批次，归属不被改写。
 */
export function mergeAccessions(
  draft: MergeDraft,
  state: WorkspaceState,
): Result<{
  source: Accession;
  target: Accession;
  events: ConsumptionEvent[];
}> {
  const validated = validateMergeDraft(draft, state);
  if (!validated.ok) {
    return validated;
  }
  const value = validated.value;
  const source = state.accessions.find((item) => item.id === value.sourceId)!;
  const target = state.accessions.find((item) => item.id === value.targetId)!;
  const sourceRemaining = remainingQuantity(source, state.consumptionEvents);
  const recordedAt = new Date().toISOString();
  const sourceEventId = createId("trf");
  const targetEventId = createId("trf");
  const sourceEvent: ConsumptionEvent = {
    id: sourceEventId,
    accessionId: source.id,
    delta: -sourceRemaining,
    kind: "transfer",
    usedOn: value.usedOn,
    recordedAt,
    recordedBy: value.recordedBy,
    destination: "merge",
    ref: {
      id: target.id,
      label: `合并至 ${target.accessionNo} · ${target.cultivar}`,
    },
    note: value.note,
    transferPairId: targetEventId,
    transferPairAccessionNo: target.accessionNo,
  };
  const targetEvent: ConsumptionEvent = {
    id: targetEventId,
    accessionId: target.id,
    delta: sourceRemaining,
    kind: "transfer",
    usedOn: value.usedOn,
    recordedAt,
    recordedBy: value.recordedBy,
    destination: "merge",
    ref: {
      id: source.id,
      label: `接收自 ${source.accessionNo} · ${source.cultivar}`,
    },
    note: value.note,
    transferPairId: sourceEventId,
    transferPairAccessionNo: source.accessionNo,
  };
  const retiredSource: Accession = {
    ...source,
    lifecycleStatus: "retired",
    retiredAt: recordedAt,
    retirementReason: `批次合并：${value.note}`,
    replacementId: target.id,
    retirementHistory: [
      ...source.retirementHistory,
      {
        id: createId("retire"),
        retiredAt: recordedAt,
        reason: `批次合并至 ${target.accessionNo}：${value.note}`,
        replacementId: target.id,
      },
    ],
  };
  // 目标批次通过 transfer 入帐增加可用库存，登记数量保持不变以维持账本可核对。
  return ok({
    source: retiredSource,
    target,
    events: [sourceEvent, targetEvent],
  });
}

/**
 * 跨试验复制材料档案：在目标试验下建立新批次，带复制来源标注，
 * 不复制原批次的耗用流水；复制数量从源批次以 transfer 形式转出。
 */
export function copyAccessionAcrossTrials(
  draft: CopyAccessionDraft,
  state: WorkspaceState,
): Result<{ accession: Accession; sourceEvent: ConsumptionEvent }> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  const targetTrial = state.trials.find(
    (item) => item.id === draft.targetTrialId,
  );
  if (!targetTrial) {
    errors.push(fieldError("targetTrialId", "unknown", "请选择目标试验"));
  }
  if (targetTrial && targetTrial.id === draft.accession.trialId) {
    errors.push(
      fieldError(
        "targetTrialId",
        "same_trial",
        "目标试验与原试验相同，无需跨试验复制",
      ),
    );
  }
  if (isAccessionRetired(draft.accession)) {
    errors.push(
      fieldError("accessionId", "retired", "已停用批次不能复制到其他试验"),
    );
  }
  if (
    Number.isNaN(draft.quantity) ||
    !Number.isInteger(draft.quantity) ||
    draft.quantity < 1 ||
    draft.quantity > 500
  ) {
    errors.push(
      fieldError("quantity", "range", "复制数量必须是 1 到 500 的整数"),
    );
  }
  const remaining = remainingQuantity(
    draft.accession,
    state.consumptionEvents,
  );
  if (Number.isInteger(draft.quantity) && draft.quantity > remaining) {
    errors.push(
      fieldError(
        "quantity",
        "insufficient_stock",
        `${draft.accession.accessionNo} 当前余量 ${remaining}，复制数量不能超过余量`,
      ),
    );
  }
  if (draft.recordedBy.trim().length < 2) {
    errors.push(fieldError("recordedBy", "required", "请填写操作人"));
  }
  if (draft.note.trim().length < 4) {
    errors.push(
      fieldError("note", "too_short", "请用至少四个字符说明复制原因"),
    );
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
  const duplicate = state.accessions.some(
    (item) =>
      item.accessionNo === draft.accessionNo.trim() &&
      item.trialId === draft.targetTrialId,
  );
  if (duplicate) {
    errors.push(
      fieldError(
        "accessionNo",
        "duplicate",
        `目标试验中已存在编号 ${draft.accessionNo.trim()} 的批次，请重新编号`,
      ),
    );
  }
  if (errors.length > 0) {
    return fail(errors);
  }
  const sourceTrial = state.trials.find(
    (item) => item.id === draft.accession.trialId,
  );
  const accession: Accession = {
    ...draft.accession,
    id: createId("acc"),
    accessionNo: draft.accessionNo.trim(),
    trialId: draft.targetTrialId,
    quantity: draft.quantity,
    lifecycleStatus: "active",
    retiredAt: undefined,
    retirementReason: undefined,
    replacementId: undefined,
    retirementHistory: [],
    labels: [...draft.accession.labels],
    copiedFromAccessionNo: draft.accession.accessionNo,
    copiedFromTrialCode: sourceTrial?.code,
  };
  const sourceEvent: ConsumptionEvent = {
    id: createId("trf"),
    accessionId: draft.accession.id,
    delta: -draft.quantity,
    kind: "transfer",
    usedOn: todayDateOnly(),
    recordedAt: new Date().toISOString(),
    recordedBy: draft.recordedBy.trim(),
    destination: "merge",
    ref: {
      id: draft.targetTrialId,
      label: `跨试验复制至 ${targetTrial?.code ?? "目标试验"}`,
      trialCode: targetTrial?.code,
    },
    note: draft.note.trim(),
    transferPairAccessionNo: draft.accession.accessionNo,
  };
  return ok({ accession, sourceEvent });
}

export function suggestedCopyAccessionNumber(state: WorkspaceState): string {
  const largest = state.accessions.reduce((max, item) => {
    const match = /^ACC-(\d+)$/.exec(item.accessionNo);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `ACC-${String(largest + 1).padStart(4, "0")}`;
}
