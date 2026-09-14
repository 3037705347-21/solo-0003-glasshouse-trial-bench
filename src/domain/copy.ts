import type {
  Accession,
  PreferredLight,
  Trial,
  TrialCopyRecord,
  WorkspaceState,
} from "./types";
import { createAccessionNumber, createId } from "./id";
import { normalizeLabels, parseDateOnly } from "./rules";
import { validateAccessionDraft } from "./accession";
import { fail, fieldError, ok, type FieldError, type Result } from "./result";

/**
 * 试验复制与模板滚动
 *
 * 复制结果是全新的试验和材料身份：观测、标记和放行快照不会跟随复制，
 * 台架分配也不会被复用。材料间的亲缘关系只能由谱系能力单独建立。
 */

export const COPYABLE_ACCESSION_FIELDS = [
  "cultivar",
  "source",
  "propagatedOn",
  "quantity",
  "trayCells",
  "preferredLight",
  "genotypeNote",
  "labels",
] as const;

export type CopyableAccessionField =
  (typeof COPYABLE_ACCESSION_FIELDS)[number];

export const COPYABLE_FIELD_LABELS: Record<CopyableAccessionField, string> = {
  cultivar: "品种",
  source: "来源",
  propagatedOn: "繁殖日期",
  quantity: "数量",
  trayCells: "穴盘规格",
  preferredLight: "适宜光照",
  genotypeNote: "基因型 / 批次说明",
  labels: "标签",
};

/**
 * 未勾选复制的字段使用登记默认值，创建后需在材料登记中补全。
 * 繁殖日期未勾选时不使用该空串，而是回退为新试验开始日。
 */
export const COPY_FIELD_DEFAULTS: Pick<
  Accession,
  | "cultivar"
  | "source"
  | "propagatedOn"
  | "quantity"
  | "trayCells"
  | "preferredLight"
  | "genotypeNote"
  | "labels"
> = {
  cultivar: "待补全",
  source: "待补全来源",
  propagatedOn: "",
  quantity: 72,
  trayCells: 104,
  preferredLight: "full-sun",
  genotypeNote: "由试验复制创建，基因型与批次信息待补全。",
  labels: ["复制待补全"],
};

export interface TrialCopyRequest {
  /** 客户端生成的幂等键，同一请求重试不得产生多套试验。 */
  idempotencyKey: string;
  sourceTrialId: string;
  newCode: string;
  season: string;
  startDate: string;
  endDate: string;
  /** 目标与科属沿用模板，但允许协调人员改写目标。 */
  objective: string;
  includeFields: CopyableAccessionField[];
  /** 显式跳过的源材料 id。 */
  skippedAccessionIds: string[];
  /** 源材料繁殖日期落在新窗口外时，平移到新试验开始日。 */
  shiftPropagation: boolean;
  /** 生成预览时记录的模板修订号；提交时必须仍与当前模板一致。 */
  expectedRevision: string;
}

export interface CopyConflict {
  code:
    | "PROPAGATION_OUT_OF_RANGE"
    | "DATE_OVERLAP"
    | "SOURCE_ASSIGNED";
  message: string;
  accessionId?: string;
  accessionNo?: string;
  blocking: boolean;
}

export interface CopyPreviewItem {
  sourceAccessionId: string;
  sourceAccessionNo: string;
  cultivar: string;
  newAccessionNo: string;
  assignedBenchCode?: string;
  propagationEffective: string;
  /** 实际重置为默认值的字段（预览中提示创建后补全）。 */
  resetFields: CopyableAccessionField[];
  warnings: CopyConflict[];
}

export interface TrialCopyPlan {
  request: TrialCopyRequest;
  revision: string;
  trialDraft: {
    code: string;
    cropFamily: string;
    objective: string;
    season: string;
    startDate: string;
    endDate: string;
  };
  items: CopyPreviewItem[];
  skipped: Array<{
    sourceAccessionId: string;
    sourceAccessionNo: string;
    cultivar: string;
    reason: string;
    assignedBenchCode?: string;
  }>;
  conflicts: CopyConflict[];
  copiedCount: number;
  skippedCount: number;
}

export interface TrialCopyOutcome {
  created: boolean;
  trial: Trial;
  accessions: Accession[];
  record: TrialCopyRecord;
}

// ---------------------------------------------------------------------------
// 模板修订号：只覆盖会被复制读取的内容（试验本体与其材料），
// 观测、标记和放行快照的变化不影响修订号，因为它们本就不会被复制。
// ---------------------------------------------------------------------------

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}

function fnvHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function computeCopySourceRevision(
  trial: Trial,
  accessions: Accession[],
): string {
  const payload = {
    // 只纳入复制实际读取的试验字段；生命周期状态变化（如源试验被放行）
    // 不影响复制内容，不应让已生成的预览过期。
    trial: {
      code: trial.code,
      cropFamily: trial.cropFamily,
      objective: trial.objective,
    },
    accessions: accessions
      .filter((accession) => accession.trialId === trial.id)
      .map((accession) => {
        // 只纳入可复制字段；台架身份不属于材料本体，分配信息单独警告。
        const { id, trialId, accessionNo, ...copyable } = accession;
        void id;
        void trialId;
        void accessionNo;
        return copyable;
      }),
  };
  return fnvHash(stableStringify(payload));
}

export function copySourceRevisionForTrial(
  state: WorkspaceState,
  trialId: string,
): string | undefined {
  const trial = state.trials.find((item) => item.id === trialId);
  if (!trial) {
    return undefined;
  }
  return computeCopySourceRevision(
    trial,
    state.accessions.filter((accession) => accession.trialId === trialId),
  );
}

// ---------------------------------------------------------------------------
// 预览规划
// ---------------------------------------------------------------------------

function benchmarkState(state: WorkspaceState): WorkspaceState {
  return {
    ...state,
    trials: [...state.trials],
    accessions: [...state.accessions],
    benches: [...state.benches],
    observationPasses: [...state.observationPasses],
    flags: [...state.flags],
    clearanceSnapshots: [...state.clearanceSnapshots],
    accessionLineage: [...state.accessionLineage],
    trialCopyRecords: [...state.trialCopyRecords],
  };
}

function nextGlobalAccessionNumber(state: WorkspaceState): number {
  const largest = state.accessions.reduce((max, item) => {
    const match = /^ACC-(\d+)$/.exec(item.accessionNo);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return largest + 1;
}

function benchmarkTrial(
  state: WorkspaceState,
  request: TrialCopyRequest,
): Result<Trial> {
  const source = state.trials.find((item) => item.id === request.sourceTrialId);
  if (!source) {
    return fail([
      fieldError("sourceTrialId", "unknown", "模板试验不存在，请重新选择"),
    ]);
  }
  // 科属直接继承自已注册模板，不再走新建时的最小长度规则；
  // 其余字段仍按试验草稿校验。
  const trialErrors: FieldError[] = [];
  const code = request.newCode.trim().toUpperCase();
  if (!/^[A-Z]{2,4}-\d{2,4}$/.test(code)) {
    trialErrors.push(
      fieldError("newCode", "invalid_code", "请使用类似 AUR-04 或 TM-12 的编号"),
    );
  }
  if (!request.season) {
    trialErrors.push(fieldError("season", "required", "请选择季节"));
  }
  const start = parseDateOnly(request.startDate);
  const end = parseDateOnly(request.endDate);
  if (!start) {
    trialErrors.push(fieldError("startDate", "invalid_date", "开始日期无效"));
  }
  if (!end) {
    trialErrors.push(fieldError("endDate", "invalid_date", "结束日期无效"));
  }
  if (start && end && start.getTime() > end.getTime()) {
    trialErrors.push(
      fieldError("endDate", "date_sequence", "结束日期不能早于开始日期"),
    );
  }
  if (request.objective.trim().length < 12) {
    trialErrors.push(
      fieldError(
        "objective",
        "too_short",
        "请用至少 12 个字符描述试验目标",
      ),
    );
  }
  if (trialErrors.length > 0) {
    return fail(trialErrors);
  }
  // 模板自身的编号也算重号：复制结果必须是独立编号的新试验。
  if (source.code.toUpperCase() === code) {
    return fail([
      fieldError(
        "newCode",
        "duplicate_source",
        `新试验不能沿用模板自身的编号 ${source.code}，请为下一轮试验另取编号`,
      ),
    ]);
  }
  const codeTaken = state.trials.some(
    (trial) => trial.code.toUpperCase() === code,
  );
  if (codeTaken) {
    return fail([
      fieldError("newCode", "duplicate", "该试验编号已被其它试验使用"),
    ]);
  }
  return ok({
    id: "preview-trial",
    code,
    cropFamily: source.cropFamily,
    objective: request.objective.trim(),
    season: request.season,
    startDate: request.startDate,
    endDate: request.endDate,
    state: "draft",
  });
}

function effectivePropagation(
  sourceValue: string,
  request: TrialCopyRequest,
): { value: string; moved: boolean; outOfRange: boolean } {
  const start = parseDateOnly(request.startDate);
  const end = parseDateOnly(request.endDate);
  const current = parseDateOnly(sourceValue);
  if (!current || !start || !end) {
    return { value: sourceValue, moved: false, outOfRange: false };
  }
  if (current.getTime() >= start.getTime() && current.getTime() <= end.getTime()) {
    return { value: sourceValue, moved: false, outOfRange: false };
  }
  if (request.shiftPropagation) {
    return { value: request.startDate, moved: true, outOfRange: true };
  }
  return { value: sourceValue, moved: false, outOfRange: true };
}

export function planTrialCopy(
  state: WorkspaceState,
  request: TrialCopyRequest,
): Result<TrialCopyPlan> {
  const source = state.trials.find((item) => item.id === request.sourceTrialId);
  if (!source) {
    return fail([
      fieldError("sourceTrialId", "unknown", "模板试验不存在，请重新选择"),
    ]);
  }
  const unknownSkipped = request.skippedAccessionIds.filter(
    (id) =>
      !state.accessions.some(
        (accession) => accession.id === id && accession.trialId === source.id,
      ),
  );
  if (unknownSkipped.length > 0) {
    return fail([
      fieldError(
        "skippedAccessionIds",
        "stale",
        "模板材料列表已变化，请刷新预览后再试",
      ),
    ]);
  }

  const trialResult = benchmarkTrial(state, request);
  if (!trialResult.ok) {
    return fail(trialResult.errors);
  }

  const sourceAccessions = state.accessions.filter(
    (accession) => accession.trialId === source.id,
  );
  const skippedIds = new Set(request.skippedAccessionIds);
  const toCopy = sourceAccessions.filter(
    (accession) => !skippedIds.has(accession.id),
  );
  if (toCopy.length === 0) {
    return fail([
      fieldError(
        "skippedAccessionIds",
        "all_skipped",
        "请至少保留一个材料用于复制",
      ),
    ]);
  }

  const includeSet = new Set<CopyableAccessionField>(request.includeFields);
  const plan = benchmarkState(state);
  // 预览校验时把目标试验临时放进工作区，提交时会替换为真实 id。
  plan.trials = [...plan.trials, { ...trialResult.value }];

  const assignedBenchByAccession = new Map<string, string>();
  state.benches.forEach((bench) => {
    bench.assignedIds.forEach((accessionId) => {
      assignedBenchByAccession.set(accessionId, bench.code);
    });
  });

  const conflicts: CopyConflict[] = [];
  if (parseDateOnly(request.startDate) && parseDateOnly(request.endDate)) {
    const nextStart = parseDateOnly(request.startDate);
    const nextEnd = parseDateOnly(request.endDate);
    const overlaps = state.trials.filter((trial) => {
      const start = parseDateOnly(trial.startDate);
      const end = parseDateOnly(trial.endDate);
      return Boolean(
        start && end && nextStart && nextEnd &&
          nextStart.getTime() <= end.getTime() &&
          nextEnd.getTime() >= start.getTime(),
      );
    });
    // 模板自身也参与冲突检查：下一轮试验不应与模板档期重叠。
    if (overlaps.some((trial) => trial.id === source.id)) {
      conflicts.push({
        code: "DATE_OVERLAP",
        message: `新试验日期与模板 ${source.code} 的档期重叠，请确认季节节奏`,
        blocking: false,
      });
    }
    if (overlaps.some((trial) => trial.id !== source.id)) {
      conflicts.push({
        code: "DATE_OVERLAP",
        message: "新试验日期与其它试验存在重叠，请确认季节安排",
        blocking: false,
      });
    }
  }

  let sequence = nextGlobalAccessionNumber(state);
  const items: CopyPreviewItem[] = [];
  const validationErrors: FieldError[] = [];

  toCopy.forEach((sourceAccession) => {
    const newAccessionNo = createAccessionNumber(sequence);
    sequence += 1;
    const resetFields = COPYABLE_ACCESSION_FIELDS.filter(
      (field) => !includeSet.has(field),
    );

    const propagationSource = includeSet.has("propagatedOn")
      ? sourceAccession.propagatedOn
      : request.startDate;
    const propagation = effectivePropagation(propagationSource, request);

    const draftAccession = {
      id: `preview-${sourceAccession.id}`,
      trialId: "preview-trial",
      accessionNo: newAccessionNo,
      cultivar: includeSet.has("cultivar")
        ? sourceAccession.cultivar
        : COPY_FIELD_DEFAULTS.cultivar,
      source: includeSet.has("source")
        ? sourceAccession.source
        : COPY_FIELD_DEFAULTS.source,
      propagatedOn: propagation.value,
      quantity: includeSet.has("quantity")
        ? sourceAccession.quantity
        : COPY_FIELD_DEFAULTS.quantity,
      trayCells: includeSet.has("trayCells")
        ? sourceAccession.trayCells
        : COPY_FIELD_DEFAULTS.trayCells,
      preferredLight: includeSet.has("preferredLight")
        ? sourceAccession.preferredLight
        : COPY_FIELD_DEFAULTS.preferredLight as PreferredLight,
      genotypeNote: includeSet.has("genotypeNote")
        ? sourceAccession.genotypeNote
        : COPY_FIELD_DEFAULTS.genotypeNote,
      labels: includeSet.has("labels")
        ? normalizeLabels(sourceAccession.labels)
        : normalizeLabels(COPY_FIELD_DEFAULTS.labels),
    };

    const check = validateAccessionDraft(draftAccession, plan);
    if (!check.ok) {
      check.errors.forEach((error) => {
        validationErrors.push(
          fieldError(
            `accessions.${sourceAccession.id}.${error.field}`,
            error.code,
            `${sourceAccession.accessionNo}：${error.message}`,
          ),
        );
      });
    }
    plan.accessions = [...plan.accessions, draftAccession as Accession];

    const warnings: CopyConflict[] = [];
    const assignedBenchCode = assignedBenchByAccession.get(sourceAccession.id);
    if (assignedBenchCode) {
      warnings.push({
        code: "SOURCE_ASSIGNED",
        message: `源材料当前分配在台架 ${assignedBenchCode}，复制后不会保留台架分配`,
        accessionId: sourceAccession.id,
        accessionNo: sourceAccession.accessionNo,
        blocking: false,
      });
      conflicts.push({
        code: "SOURCE_ASSIGNED",
        message: `${sourceAccession.accessionNo}（${sourceAccession.cultivar}）当前在台架 ${assignedBenchCode}，新材料需要重新分配`,
        accessionId: sourceAccession.id,
        accessionNo: sourceAccession.accessionNo,
        blocking: false,
      });
    }
    if (
      includeSet.has("propagatedOn") &&
      parseDateOnly(sourceAccession.propagatedOn) &&
      propagation.outOfRange
    ) {
      warnings.push({
        code: "PROPAGATION_OUT_OF_RANGE",
        message: request.shiftPropagation
          ? `源繁殖日期 ${sourceAccession.propagatedOn} 不在新日期窗口内，将平移到 ${request.startDate}`
          : `源繁殖日期 ${sourceAccession.propagatedOn} 不在新日期窗口内，请确认是否需要平移`,
        accessionId: sourceAccession.id,
        accessionNo: sourceAccession.accessionNo,
        blocking: false,
      });
      conflicts.push({
        code: "PROPAGATION_OUT_OF_RANGE",
        message: `${sourceAccession.accessionNo}（${sourceAccession.cultivar}）的繁殖日期不在新窗口内${
          request.shiftPropagation ? "，将平移到开始日" : "，未平移请确认"
        }`,
        accessionId: sourceAccession.id,
        accessionNo: sourceAccession.accessionNo,
        blocking: false,
      });
    }

    items.push({
      sourceAccessionId: sourceAccession.id,
      sourceAccessionNo: sourceAccession.accessionNo,
      cultivar: draftAccession.cultivar,
      newAccessionNo,
      assignedBenchCode,
      propagationEffective: propagation.value,
      resetFields,
      warnings,
    });
  });

  if (validationErrors.length > 0) {
    return fail(validationErrors);
  }

  const skipped = sourceAccessions
    .filter((accession) => skippedIds.has(accession.id))
    .map((accession) => ({
      sourceAccessionId: accession.id,
      sourceAccessionNo: accession.accessionNo,
      cultivar: accession.cultivar,
      reason: "用户在复制时显式跳过",
      assignedBenchCode: assignedBenchByAccession.get(accession.id),
    }));

  const revision = computeCopySourceRevision(source, sourceAccessions);

  return ok({
    request,
    revision,
    trialDraft: {
      code: trialResult.value.code,
      cropFamily: trialResult.value.cropFamily,
      objective: trialResult.value.objective,
      season: trialResult.value.season,
      startDate: trialResult.value.startDate,
      endDate: trialResult.value.endDate,
    },
    items,
    skipped,
    conflicts,
    copiedCount: items.length,
    skippedCount: skipped.length,
  });
}

// ---------------------------------------------------------------------------
// 原子提交：调用方用一次 reducer 动作落库；本函数要么给出完整产物，要么失败。
// ---------------------------------------------------------------------------

export function commitTrialCopy(
  state: WorkspaceState,
  request: TrialCopyRequest,
): Result<TrialCopyOutcome> {
  // 1. 幂等：同一请求键已处理过，直接返回既有结果，绝不重复创建。
  const existing = state.trialCopyRecords.find(
    (record) => record.idempotencyKey === request.idempotencyKey,
  );
  if (existing) {
    const trial = state.trials.find((item) => item.id === existing.newTrialId);
    if (trial) {
      const accessions = state.accessions.filter(
        (accession) => accession.trialId === existing.newTrialId,
      );
      return ok({ created: false, trial, accessions, record: existing });
    }
    // 复制记录还在但目标试验丢失（存储损坏）：禁止再创建，避免脱离记录的重复试验。
    return fail([
      fieldError(
        "idempotency",
        "orphan_record",
        "该复制请求已有记录但目标试验缺失，请核对本地工作区后重试",
      ),
    ]);
  }

  const source = state.trials.find((item) => item.id === request.sourceTrialId);
  if (!source) {
    return fail([
      fieldError("sourceTrialId", "unknown", "模板试验不存在，请重新选择"),
    ]);
  }

  // 2. 模板更新防护：预览后模板内容发生变化必须重新预览。
  const currentRevision = computeCopySourceRevision(
    source,
    state.accessions.filter((accession) => accession.trialId === source.id),
  );
  if (request.expectedRevision !== currentRevision) {
    return fail([
      fieldError(
        "template",
        "template_changed",
        "模板自预览后已更新，请刷新预览后再提交",
      ),
    ]);
  }

  // 3. 重新完整规划（编号冲突、日期、字段校验都以最新状态重算）。
  const planResult = planTrialCopy(state, request);
  if (!planResult.ok) {
    return fail(planResult.errors);
  }
  const plan = planResult.value;

  // 4. 生成全部新身份；任何异常前都不会触碰既有状态。
  const trial: Trial = {
    id: createId("trl"),
    code: plan.trialDraft.code,
    cropFamily: plan.trialDraft.cropFamily,
    objective: plan.trialDraft.objective,
    season: plan.trialDraft.season,
    startDate: plan.trialDraft.startDate,
    endDate: plan.trialDraft.endDate,
    state: "draft",
  };

  const nextState: WorkspaceState = {
    ...state,
    trials: [...state.trials, trial],
  };

  const sourceById = new Map(
    state.accessions
      .filter((accession) => accession.trialId === source.id)
      .map((accession) => [accession.id, accession]),
  );
  const includeSet = new Set<CopyableAccessionField>(request.includeFields);

  let sequence = nextGlobalAccessionNumber(state);
  const accessions: Accession[] = [];
  for (const item of plan.items) {
    const sourceAccession = sourceById.get(item.sourceAccessionId);
    if (!sourceAccession) {
      return fail([
        fieldError(
          "template",
          "template_changed",
          "模板材料已变化，请刷新预览后再提交",
        ),
      ]);
    }
    const propagationSource = includeSet.has("propagatedOn")
      ? sourceAccession.propagatedOn
      : request.startDate;
    const propagation = effectivePropagation(propagationSource, request);
    const draft = {
      trialId: trial.id,
      accessionNo: createAccessionNumber(sequence),
      cultivar: includeSet.has("cultivar")
        ? sourceAccession.cultivar
        : COPY_FIELD_DEFAULTS.cultivar,
      source: includeSet.has("source")
        ? sourceAccession.source
        : COPY_FIELD_DEFAULTS.source,
      propagatedOn: propagation.value,
      quantity: includeSet.has("quantity")
        ? sourceAccession.quantity
        : COPY_FIELD_DEFAULTS.quantity,
      trayCells: includeSet.has("trayCells")
        ? sourceAccession.trayCells
        : COPY_FIELD_DEFAULTS.trayCells,
      preferredLight: (includeSet.has("preferredLight")
        ? sourceAccession.preferredLight
        : COPY_FIELD_DEFAULTS.preferredLight) as PreferredLight,
      genotypeNote: includeSet.has("genotypeNote")
        ? sourceAccession.genotypeNote
        : COPY_FIELD_DEFAULTS.genotypeNote,
      labels: includeSet.has("labels")
        ? normalizeLabels(sourceAccession.labels)
        : normalizeLabels(COPY_FIELD_DEFAULTS.labels),
    };
    const validated = validateAccessionDraft(draft, nextState);
    if (!validated.ok) {
      return fail(validated.errors);
    }
    const created: Accession = { id: createId("acc"), ...validated.value };
    accessions.push(created);
    nextState.accessions = [...nextState.accessions, created];
    sequence += 1;
  }

  const record: TrialCopyRecord = {
    id: createId("tcr"),
    idempotencyKey: request.idempotencyKey,
    sourceTrialId: source.id,
    sourceTrialCode: source.code,
    newTrialId: trial.id,
    newTrialCode: trial.code,
    copiedAccessionCount: accessions.length,
    skippedAccessionCount: request.skippedAccessionIds.length,
    fieldSelection: [...request.includeFields],
    templateRevision: currentRevision,
    createdOn: new Date().toISOString(),
  };

  return ok({ created: true, trial, accessions, record });
}

/** 模板自上次预览后是否发生变化（供 UI 在重试时判断）。 */
export function isTemplateStale(
  state: WorkspaceState,
  request: TrialCopyRequest,
): boolean {
  const current = copySourceRevisionForTrial(state, request.sourceTrialId);
  return current !== undefined && current !== request.expectedRevision;
}
