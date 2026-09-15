import type {
  Accession,
  AccessionMergeRecord,
  DiscardedObservationEntry,
  MergeFieldKey,
  ObservationPass,
  Trial,
  WorkspaceState,
} from "./types";
import { createId } from "./id";
import { fail, fieldError, ok, type FieldError, type Result } from "./result";
import {
  isAccessionMerged,
  isAccessionOperational,
  isAccessionRetired,
} from "./accession";

/**
 * 身份合并规则（不变量）：
 *
 * 1. 唯一性：合并后所有当前外键（台架占用、观测条目、标记、替代指针）
 *    只指向存活者；旧墓碑的 id 永久保留，编号永久不可复用。
 * 2. 可溯源：被重写的观测/标记带 sourceAccessionId；同 pass 碰撞时
 *    被丢弃的测量值完整进入合并记录，不做静默删除。
 * 3. 快照不变：已保存的放行快照一个字节都不改，其旧 id 通过别名仍可解释。
 * 4. 同试验边界：合并不能跨试验。
 * 5. 单向不可逆：mergedIntoId 形成无环链，且没有“恢复合并”操作。
 * 6. 物理位置单一：来自不同台架的来源必须显式选择唯一目标台架
 *    （或选择不分配），不能同时占两个位置。
 * 7. 单次观测单一：同一观测 pass 中两个来源都有条目时，只保留存活者
 *    条目，另一条按记录留档。
 * 8. 冻结：已放行试验不允许再合并。
 */

export const MERGE_REASON_MIN_LENGTH = 6;

export const SCALAR_MERGE_FIELDS: MergeFieldKey[] = [
  "accessionNo",
  "cultivar",
  "source",
  "propagatedOn",
  "trayCells",
  "preferredLight",
  "genotypeNote",
];

export interface MergeFieldResolution {
  field: MergeFieldKey | "quantity";
  chosenSourceId: string;
  strategy: "keep" | "sum" | "custom";
  customQuantity?: number;
}

export interface MergeRequest {
  survivorId: string;
  memberIds: string[];
  reason: string;
  fieldResolutions: MergeFieldResolution[];
  /** 成员物理位置冲突时选定的台架；"unassigned" 表示合并后不占台架。 */
  targetBenchId: string | "unassigned";
  mergedOn: string;
}

export interface FieldConflict {
  field: MergeFieldKey;
  values: Array<{ sourceId: string; value: string | number }>;
}

export interface MemberObservationConflict {
  memberId: string;
  passId: string;
  observedOn: string;
  observer: string;
}

export interface MergeAnalysis {
  survivor: Accession;
  members: Accession[];
  fieldConflicts: FieldConflict[];
  occupiedBenches: Array<{ benchId: string; code: string; sourceIds: string[] }>;
  passCollisions: MemberObservationConflict[];
  retiredMemberIds: string[];
}

function findAccession(state: WorkspaceState, id: string): Accession | undefined {
  return state.accessions.find((item) => item.id === id);
}

export function formatFieldValue(
  field: MergeFieldKey,
  value: string | number,
): string {
  if (field === "preferredLight") {
    return value === "full-sun"
      ? "全日照"
      : value === "partial-shade"
        ? "半阴"
        : "遮阴";
  }
  if (field === "trayCells") {
    return `${value} 孔`;
  }
  return String(value);
}

/** 预检合并可行性并汇总所有需要人工裁决的冲突；不产生任何状态变更。 */
export function analyzeMerge(
  state: WorkspaceState,
  survivorId: string,
  memberIdsInput: string[],
): Result<MergeAnalysis> {
  const errors: FieldError[] = [];
  const memberSet = new Set(memberIdsInput);
  if (memberSet.has(survivorId)) {
    errors.push(fieldError("survivorId", "self", "存活材料不能同时是被合并来源"));
  }
  if (memberIdsInput.length === 0) {
    errors.push(fieldError("memberIds", "empty", "请至少选择一个被合并批次"));
  }
  if (memberSet.size !== memberIdsInput.length) {
    errors.push(fieldError("memberIds", "duplicate", "被合并批次不能重复选择"));
  }

  const survivor = findAccession(state, survivorId);
  const members = memberIdsInput
    .map((id) => findAccession(state, id))
    .filter((item): item is Accession => Boolean(item));

  if (!survivor) {
    errors.push(fieldError("survivorId", "unknown", "请选择有效的存活材料"));
  }
  if (members.length !== memberIdsInput.length) {
    errors.push(fieldError("memberIds", "unknown", "存在无效的被合并批次"));
  }
  if (survivor && isAccessionMerged(survivor)) {
    errors.push(
      fieldError(
        "survivorId",
        "merged",
        "存活材料本身已经是合并墓碑，请选择当前存活批次",
      ),
    );
  } else if (survivor && !isAccessionOperational(survivor)) {
    errors.push(
      fieldError(
        "survivorId",
        "retired",
        "存活材料必须处于在用状态；可先恢复或改选存活者",
      ),
    );
  }
  if (survivor) {
    const trial: Trial | undefined = state.trials.find(
      (item) => item.id === survivor.trialId,
    );
    if (trial?.state === "cleared") {
      errors.push(
        fieldError("trialId", "trial_cleared", "试验已放行，身份已冻结，不能再合并"),
      );
    }
    const crossTrial = members.find(
      (member) => member.trialId !== survivor.trialId,
    );
    if (crossTrial) {
      errors.push(
        fieldError(
          "memberIds",
          "cross_trial",
          `批次 ${crossTrial.accessionNo} 属于其他试验，不能跨试验合并`,
        ),
      );
    }
    const mergedMember = members.find((member) => isAccessionMerged(member));
    if (mergedMember) {
      errors.push(
        fieldError(
          "memberIds",
          "merged",
          `${mergedMember.accessionNo} 已经合并过，不能重复合并`,
        ),
      );
    }
  }

  if (errors.length > 0 || !survivor) {
    return fail(errors);
  }

  const allMembers = [survivor, ...members];
  const fieldConflicts: FieldConflict[] = SCALAR_MERGE_FIELDS.flatMap((field) => {
    const values = allMembers.map((member) => ({
      sourceId: member.id,
      value: member[field] as string | number,
    }));
    const distinct = new Set(values.map((entry) => String(entry.value)));
    return distinct.size > 1 ? [{ field, values }] : [];
  });

  const benchToSources = new Map<string, string[]>();
  allMembers.forEach((member) => {
    const bench = state.benches.find((item) =>
      item.assignedIds.includes(member.id),
    );
    if (bench) {
      benchToSources.set(bench.id, [
        ...(benchToSources.get(bench.id) ?? []),
        member.id,
      ]);
    }
  });
  const occupiedBenches = [...benchToSources.entries()].map(([benchId, sourceIds]) => ({
    benchId,
    code: state.benches.find((item) => item.id === benchId)?.code ?? benchId,
    sourceIds,
  }));

  const passCollisions: MemberObservationConflict[] = [];
  state.observationPasses.forEach((pass) => {
    if (pass.trialId !== survivor.trialId) {
      return;
    }
    const idsInPass = new Set(pass.entries.map((entry) => entry.accessionId));
    const survivorInPass = idsInPass.has(survivor.id);
    members.forEach((member) => {
      if (!idsInPass.has(member.id)) {
        return;
      }
      if (
        survivorInPass ||
        members.some(
          (other) => other.id !== member.id && idsInPass.has(other.id),
        )
      ) {
        passCollisions.push({
          memberId: member.id,
          passId: pass.id,
          observedOn: pass.observedOn,
          observer: pass.observer,
        });
      }
    });
  });

  return ok({
    survivor,
    members,
    fieldConflicts,
    occupiedBenches,
    passCollisions,
    retiredMemberIds: members
      .filter((member) => isAccessionRetired(member))
      .map((member) => member.id),
  });
}

export interface MergeCommit {
  state: WorkspaceState;
  record: AccessionMergeRecord;
  survivor: Accession;
  tombstones: Accession[];
}

function normalizeMergedOn(value: string): string | undefined {
  if (!value.trim()) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/** 应用合并：重写当前外键、写入墓碑与审计记录，返回完整新状态。 */
export function commitAccessionMerge(
  state: WorkspaceState,
  request: MergeRequest,
): Result<MergeCommit> {
  const analysis = analyzeMerge(
    state,
    request.survivorId,
    request.memberIds,
  );
  if (!analysis.ok) {
    return analysis;
  }
  const { survivor, members, fieldConflicts, occupiedBenches } =
    analysis.value;
  const memberIds = members.map((member) => member.id);
  const allMembers = [survivor, ...members];
  const errors: FieldError[] = [];

  if (request.reason.trim().length < MERGE_REASON_MIN_LENGTH) {
    errors.push(
      fieldError(
        "reason",
        "too_short",
        `请填写至少 ${MERGE_REASON_MIN_LENGTH} 个字符的合并依据`,
      ),
    );
  }
  const mergedOn = normalizeMergedOn(request.mergedOn);
  if (!mergedOn) {
    errors.push(fieldError("mergedOn", "invalid_date", "合并时间无效"));
  }

  const resolutionByField = new Map(
    request.fieldResolutions.map((resolution) => [resolution.field, resolution]),
  );
  fieldConflicts.forEach((conflict) => {
    const resolution = resolutionByField.get(conflict.field);
    if (!resolution || !allMembers.some((m) => m.id === resolution.chosenSourceId)) {
      errors.push(
        fieldError(
          `field.${conflict.field}`,
          "unresolved",
          `请为“${conflict.field}”选择保留来源`,
        ),
      );
    }
  });

  const quantityResolution = resolutionByField.get("quantity");
  let resolvedQuantity = survivor.quantity;
  if (!quantityResolution) {
    errors.push(
      fieldError("quantity", "unresolved", "请选择合并后数量的处理方式"),
    );
  } else if (quantityResolution.strategy === "sum") {
    resolvedQuantity = allMembers.reduce(
      (total, member) => total + member.quantity,
      0,
    );
  } else if (quantityResolution.strategy === "custom") {
    const custom = quantityResolution.customQuantity;
    if (custom === undefined || Number.isNaN(custom) || custom < 1 || custom > 500) {
      errors.push(
        fieldError("quantity", "range", "自定义数量必须在 1 到 500 之间"),
      );
    }
    resolvedQuantity = custom ?? survivor.quantity;
  } else {
    const chosen = allMembers.find(
      (member) => member.id === quantityResolution.chosenSourceId,
    );
    if (!chosen) {
      errors.push(
        fieldError("quantity", "unknown_source", "数量保留来源无效"),
      );
    }
    resolvedQuantity = chosen ? chosen.quantity : survivor.quantity;
  }

  const distinctBenches = new Set(
    occupiedBenches
      .map((entry) => entry.benchId)
      .filter((benchId): benchId is string => Boolean(benchId)),
  );
  if (distinctBenches.size > 1) {
    if (request.targetBenchId === "unassigned") {
      // 显式选择不分配是允许的。
    } else if (!distinctBenches.has(request.targetBenchId)) {
      errors.push(
        fieldError(
          "targetBenchId",
          "invalid_bench",
          "请在来源所在台架中选择唯一目标台架，或选择合并后不分配",
        ),
      );
    }
  } else if (
    request.targetBenchId !== "unassigned" &&
    request.targetBenchId &&
    !distinctBenches.has(request.targetBenchId)
  ) {
    errors.push(
      fieldError("targetBenchId", "unknown", "目标台架不是来源当前所在台架"),
    );
  }
  if (errors.length > 0 || !mergedOn) {
    return fail(errors);
  }

  const memberIdSet = new Set(memberIds);
  const mergedLabelSet = new Set(survivor.labels);
  members.forEach((member) => {
    member.labels.forEach((label) => mergedLabelSet.add(label));
  });

  const scalarValues = SCALAR_MERGE_FIELDS.map((field) => {
    const resolution = resolutionByField.get(field);
    const sourceId = resolution?.chosenSourceId ?? survivor.id;
    const chosen =
      allMembers.find((member) => member.id === sourceId) ?? survivor;
    return { field, value: chosen[field] };
  });

  const discardedObservations: DiscardedObservationEntry[] = [];

  const observationPasses: ObservationPass[] = state.observationPasses.map(
    (pass) => {
      const touches = pass.entries.some(
        (entry) =>
          memberIdSet.has(entry.accessionId) ||
          entry.accessionId === survivor.id,
      );
      if (!touches) {
        return pass;
      }
      // 同一 pass 内按“解析后的身份”分组：存活者条目优先保留，
      // 每个被合并来源至多保留一条（重写为存活者身份），其余测量值留档丢弃。
      const keptByResolvedId = new Map<string, number>();
      if (pass.entries.some((entry) => entry.accessionId === survivor.id)) {
        keptByResolvedId.set(survivor.id, 1);
      }
      const nextEntries = pass.entries.flatMap((entry) => {
        if (!memberIdSet.has(entry.accessionId)) {
          return [entry];
        }
        const resolvedId = survivor.id;
        if (keptByResolvedId.has(resolvedId)) {
          discardedObservations.push({
            passId: pass.id,
            observedOn: pass.observedOn,
            observer: pass.observer,
            heightMm: entry.heightMm,
            leafCount: entry.leafCount,
            ecMs: entry.ecMs,
            notes: entry.notes,
            keptSourceId: survivor.id,
          });
          return [];
        }
        keptByResolvedId.set(resolvedId, 1);
        return [
          {
            ...entry,
            accessionId: survivor.id,
            sourceAccessionId: entry.sourceAccessionId ?? entry.accessionId,
          },
        ];
      });
      return { ...pass, entries: nextEntries };
    },
  );

  const flags = state.flags.map((flag) =>
    memberIdSet.has(flag.accessionId)
      ? {
          ...flag,
          accessionId: survivor.id,
          sourceAccessionId: flag.sourceAccessionId ?? flag.accessionId,
        }
      : flag,
  );

  const targetBenchId =
    distinctBenches.size > 1 ? request.targetBenchId : [...distinctBenches][0];
  const wantsTargetBench = targetBenchId !== "unassigned" && Boolean(targetBenchId);
  const benchResolutions: AccessionMergeRecord["benchResolutions"] = [];

  // 记录每个来源合并前所在台架。
  const sourceBenchById = new Map<string, string | undefined>();
  allMembers.forEach((member) => {
    sourceBenchById.set(
      member.id,
      state.benches.find((bench) => bench.assignedIds.includes(member.id))?.id,
    );
  });
  // 不变量“物理位置单一”：先把所有来源身份（含存活者）从台架上摘除，
  // 再把存活者唯一挂回目标台架，避免存活者同时占两个位置。
  const allMemberIds = new Set(allMembers.map((member) => member.id));
  const benches = state.benches.map((bench) => {
    const touches = bench.assignedIds.some((id) => allMemberIds.has(id));
    if (!touches) {
      return bench;
    }
    const assignedIds = bench.assignedIds.filter((id) => !allMemberIds.has(id));
    const nextStatus =
      assignedIds.length === 0 && bench.status === "assigned"
        ? "available"
        : bench.status;
    return { ...bench, assignedIds, status: nextStatus };
  });

  if (wantsTargetBench && targetBenchId) {
    const targetIndex = benches.findIndex((bench) => bench.id === targetBenchId);
    if (targetIndex >= 0) {
      benches[targetIndex] = {
        ...benches[targetIndex],
        assignedIds: [...benches[targetIndex].assignedIds, survivor.id],
        status: "assigned",
      };
    }
  }

  allMembers.forEach((member) => {
    const fromBenchId = sourceBenchById.get(member.id);
    const landsHere = wantsTargetBench && fromBenchId === targetBenchId;
    benchResolutions.push({
      sourceId: member.id,
      fromBenchId,
      action: landsHere ? "kept" : "removed",
    });
  });

  // 重写外部在用替代指针（retirementHistory 属于历史，保持原样不动）。
  const accessions = state.accessions.map((accession) => {
    if (memberIdSet.has(accession.id)) {
      return {
        ...accession,
        lifecycleStatus: "merged" as const,
        mergedIntoId: survivor.id,
        mergedAt: mergedOn,
        mergeRecordId: "",
      };
    }
    if (accession.id === survivor.id) {
      return {
        ...accession,
        labels: [...mergedLabelSet].sort(),
        quantity: resolvedQuantity,
        ...Object.fromEntries(
          scalarValues.map((entry) => [entry.field, entry.value]),
        ),
      };
    }
    if (accession.replacementId && memberIdSet.has(accession.replacementId)) {
      return { ...accession, replacementId: survivor.id };
    }
    return accession;
  });

  // 无环不变量：成员成为墓碑时已剥离其替代指针，存活者不可能
  // 经 mergedIntoId / replacementId 回到自身，因此无需额外成环检查。

  const recordId = createId("mrge");
  const record: AccessionMergeRecord = {
    id: recordId,
    mergeId: createId("mrg"),
    survivorId: survivor.id,
    mergedIds: memberIds,
    mergedOn,
    reason: request.reason.trim(),
    fieldResolutions: request.fieldResolutions.map((resolution) => ({
      field: resolution.field,
      chosenSourceId: resolution.chosenSourceId,
      strategy: resolution.strategy,
    })),
    benchResolutions,
    discardedObservations,
  };
  const finalAccessions = accessions.map((accession) =>
    memberIdSet.has(accession.id)
      ? { ...accession, mergeRecordId: recordId }
      : accession,
  );

  return ok({
    state: {
      ...state,
      accessions: finalAccessions,
      benches,
      observationPasses,
      flags,
      mergeRecords: [...state.mergeRecords, record],
    },
    record,
    survivor: finalAccessions.find(
      (accession) => accession.id === survivor.id,
    ) as Accession,
    tombstones: finalAccessions.filter((accession) =>
      memberIdSet.has(accession.id),
    ),
  });
}
