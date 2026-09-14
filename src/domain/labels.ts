import type { Accession, WorkspaceState } from "./types";
import { normalizeLabels } from "./rules";
import { fail, fieldError, ok, type Result } from "./result";

export interface LabelVariant {
  /** 存储在材料记录中的原始拼写。 */
  value: string;
  /** 携带该精确拼写的材料数。 */
  count: number;
}

export interface LabelSummary {
  /** 规范化后的标签（去空格、小写、去重）。 */
  label: string;
  /** 同一规范标签下出现过的所有拼写，规范拼写排在最前。 */
  variants: LabelVariant[];
  /** 关联材料数（跨拼写去重）。 */
  materials: number;
  /** 是否存在大小写或首尾空格混用。 */
  isCaseMixed: boolean;
  /** 关联材料编号，用于页面预览与跳转核对。 */
  accessionIds: string[];
}

export interface AccessionLabelImpact {
  accession: Accession;
  before: string[];
  after: string[];
  /** 标签集合未变，仅做了大小写、空白或去重的标准化。 */
  cosmeticOnly: boolean;
}

export interface LabelChangePlan {
  affected: AccessionLabelImpact[];
  updatedAccessions: Accession[];
}

/** 历史数据可能含非字符串或缺失值，与编辑保存时的空值处理保持一致：直接丢弃。 */
export function coerceLabels(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((value): value is string => typeof value === "string");
}

/**
 * 判断存储的标签数组是否与编辑保存后的标准形态不一致。
 * 仅比较语义集合（大小写、空白、空值、重复、非字符串），不因排序不同而判脏：
 * 标签顺序对用户没有含义，历史数据可能未按标准排序保存。
 */
export function hasDirtyLabels(raw: unknown): boolean {
  if (!Array.isArray(raw)) {
    return raw !== undefined && raw !== null;
  }
  const strings = coerceLabels(raw);
  if (strings.length !== raw.length) {
    return true;
  }
  const normalized = new Set(normalizeLabels(strings));
  const current = new Set(strings);
  if (normalized.size !== current.size) {
    return true;
  }
  for (const label of current) {
    if (!normalized.has(label)) {
      return true;
    }
  }
  return false;
}

export function canonicalLabel(value: string): string {
  return value.trim().toLowerCase();
}

export function labelSummaries(
  state: WorkspaceState,
  trialId: string,
): LabelSummary[] {
  const groups = new Map<
    string,
    { variants: Map<string, Set<string>>; materials: Set<string> }
  >();
  for (const accession of state.accessions) {
    if (accession.trialId !== trialId) {
      continue;
    }
    for (const spelling of coerceLabels(accession.labels)) {
      const canonical = canonicalLabel(spelling);
      if (!canonical) {
        continue;
      }
      let group = groups.get(canonical);
      if (!group) {
        group = { variants: new Map(), materials: new Set() };
        groups.set(canonical, group);
      }
      const variantMaterials =
        group.variants.get(spelling) ?? new Set<string>();
      variantMaterials.add(accession.id);
      group.variants.set(spelling, variantMaterials);
      group.materials.add(accession.id);
    }
  }
  return Array.from(groups.entries())
    .map(([label, group]) => {
      const variants = Array.from(group.variants.entries())
        .map(([value, materials]) => ({ value, count: materials.size }))
        .sort((left, right) => {
          if (left.value === label) {
            return -1;
          }
          if (right.value === label) {
            return 1;
          }
          return right.count - left.count || left.value.localeCompare(right.value);
        });
      return {
        label,
        variants,
        materials: group.materials.size,
        isCaseMixed: variants.some((variant) => variant.value !== label),
        accessionIds: Array.from(group.materials),
      };
    })
    .sort(
      (left, right) =>
        right.materials - left.materials || left.label.localeCompare(right.label),
    );
}

/** 找出标签未按标准形态存储的材料，用于治理页提示与执行前预览。 */
export function dirtyAccessions(
  state: WorkspaceState,
  trialId: string,
): Accession[] {
  return state.accessions.filter(
    (accession) =>
      accession.trialId === trialId && hasDirtyLabels(accession.labels),
  );
}

function parseSingleLabelName(
  field: string,
  input: string,
): Result<string> {
  if (input.includes(",") || input.includes("，")) {
    return fail([
      fieldError(field, "invalid", "名称中不能包含逗号；如需多个标签请使用批量添加"),
    ]);
  }
  const normalized = normalizeLabels([input]);
  if (normalized.length === 0) {
    return fail([fieldError(field, "required", "请填写标签名称")]);
  }
  return ok(normalized[0]);
}

function buildPlan(
  accessions: Accession[],
  transform: (labels: string[], accession: Accession) => string[],
): LabelChangePlan {
  const affected: AccessionLabelImpact[] = [];
  for (const accession of accessions) {
    const before = coerceLabels(accession.labels);
    const after = transform(before, accession);
    if (JSON.stringify(before) === JSON.stringify(after)) {
      continue;
    }
    const semanticBefore = normalizeLabels(before);
    affected.push({
      accession,
      before,
      after,
      cosmeticOnly: JSON.stringify(semanticBefore) === JSON.stringify(after),
    });
  }
  return {
    affected,
    updatedAccessions: affected.map((impact) => ({
      ...impact.accession,
      labels: impact.after,
    })),
  };
}

/** 批量添加标签：目标范围由调用方给出，重复标签幂等，脏数据顺带标准化。 */
export function buildAddLabelPlan(
  state: WorkspaceState,
  trialId: string,
  rawLabels: string[],
  targetAccessionIds: string[],
): Result<LabelChangePlan> {
  if (!state.trials.some((trial) => trial.id === trialId)) {
    return fail([fieldError("trialId", "unknown", "请选择有效试验")]);
  }
  const additions = normalizeLabels(rawLabels);
  if (additions.length === 0) {
    return fail([fieldError("labels", "required", "请填写至少一个要添加的标签")]);
  }
  const targets = state.accessions.filter(
    (accession) =>
      accession.trialId === trialId && targetAccessionIds.includes(accession.id),
  );
  if (targets.length === 0) {
    return fail([
      fieldError("accessionIds", "empty", "请选择至少一个目标材料"),
    ]);
  }
  const plan = buildPlan(targets, (labels) =>
    normalizeLabels([...labels, ...additions]),
  );
  if (plan.affected.length === 0) {
    return fail([
      fieldError(
        "accessionIds",
        "no_change",
        "所选材料均已包含这些标签，没有需要变更的内容",
      ),
    ]);
  }
  return ok(plan);
}

/** 标准化标签：仅收拢大小写、空白、空值和重复，不改变语义标签集合。 */
export function buildNormalizeLabelsPlan(
  state: WorkspaceState,
  trialId: string,
): Result<LabelChangePlan> {
  const dirty = dirtyAccessions(state, trialId);
  if (dirty.length === 0) {
    return fail([fieldError("labels", "clean", "该试验的标签已全部符合标准")]);
  }
  return ok(buildPlan(dirty, (labels) => normalizeLabels(labels)));
}

/** 批量移除标签：按规范名匹配，因此大小写混用的拼写会被一并移除。 */export function buildRemoveLabelPlan(
  state: WorkspaceState,
  trialId: string,
  labels: string[],
): Result<LabelChangePlan> {
  const removals = new Set(normalizeLabels(labels));
  if (removals.size === 0) {
    return fail([fieldError("labels", "required", "请选择至少一个要移除的标签")]);
  }
  const trialAccessions = state.accessions.filter(
    (accession) => accession.trialId === trialId,
  );
  const plan = buildPlan(trialAccessions, (labelsOnAccession) =>
    normalizeLabels(
      labelsOnAccession.filter(
        (label) => !removals.has(canonicalLabel(label)),
      ),
    ),
  );
  if (plan.affected.length === 0) {
    return fail([
      fieldError("labels", "unused", "没有材料携带所选标签"),
    ]);
  }
  return ok(plan);
}

/** 重命名单个标签：目标名与已有标签冲突时拒绝，引导用户改用合并。 */
export function buildRenameLabelPlan(
  state: WorkspaceState,
  trialId: string,
  currentLabel: string,
  rawNewName: string,
): Result<LabelChangePlan> {
  const current = canonicalLabel(currentLabel);
  const parsed = parseSingleLabelName("newName", rawNewName);
  if (!parsed.ok) {
    return parsed;
  }
  const next = parsed.value;
  const summaries = labelSummaries(state, trialId);
  if (!summaries.some((summary) => summary.label === current)) {
    return fail([fieldError("label", "unknown", "该标签已不存在，请刷新列表")]);
  }
  if (next === current) {
    return fail([
      fieldError("newName", "same", "新名称与当前标签相同，无需重命名"),
    ]);
  }
  if (summaries.some((summary) => summary.label === next)) {
    return fail([
      fieldError(
        "newName",
        "exists",
        "试验中已存在同名标签，请改用“合并标签”收拢新旧名称",
      ),
    ]);
  }
  const carriers = state.accessions.filter(
    (accession) =>
      accession.trialId === trialId &&
      coerceLabels(accession.labels).some(
        (label) => canonicalLabel(label) === current,
      ),
  );
  const plan = buildPlan(carriers, (labels) =>
    normalizeLabels(
      labels.map((label) =>
        canonicalLabel(label) === current ? next : label,
      ),
    ),
  );
  return ok(plan);
}

/**
 * 合并标签：两个及以上已有标签统一为目标名。
 * 目标名可以是其中一个源标签（保留它），也可以是全新名称。
 */
export function buildMergeLabelPlan(
  state: WorkspaceState,
  trialId: string,
  sourceLabels: string[],
  rawTargetName: string,
): Result<LabelChangePlan> {
  const sources = Array.from(
    new Set(sourceLabels.map(canonicalLabel).filter(Boolean)),
  );
  if (sources.length < 2) {
    return fail([
      fieldError("sources", "required", "请至少选择两个要合并的标签"),
    ]);
  }
  const parsed = parseSingleLabelName("targetName", rawTargetName);
  if (!parsed.ok) {
    return parsed;
  }
  const target = parsed.value;
  const summaries = labelSummaries(state, trialId);
  const known = new Set(summaries.map((summary) => summary.label));
  const unknown = sources.filter((label) => !known.has(label));
  if (unknown.length > 0) {
    return fail([fieldError("sources", "unknown", "部分标签已不存在，请刷新列表")]);
  }
  const sourceSet = new Set(sources);
  const carriers = state.accessions.filter(
    (accession) =>
      accession.trialId === trialId &&
      coerceLabels(accession.labels).some((label) =>
        sourceSet.has(canonicalLabel(label)),
      ),
  );
  const plan = buildPlan(carriers, (labels) =>
    normalizeLabels(
      labels.map((label) =>
        sourceSet.has(canonicalLabel(label)) ? target : label,
      ),
    ),
  );
  return ok(plan);
}
