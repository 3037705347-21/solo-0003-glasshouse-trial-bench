/**
 * 待人工处理项的裁决动作。这些动作是工作区在“带问题可用”状态下唯一的修复路径，
 * 都是纯函数：接收当前状态与问题，返回带校验的 Result，然后重新扫描复检。
 *
 * 关键约束：人工修复不能制造新的领域冲突。因此这里不是“盲写引用”，而是复用与
 * 正常工作流完全相同的领域规则：
 * - 台架槽位重关联走 validateBenchAssignment（停用、隔离、重复、跨台架、容量、光照）；
 * - 替代材料重关联走 replacementWouldCycle 及同试验/在用/非自身规则；
 * - 观测条目重关联要求目标材料属于同一试验且在用。
 * 任何冲突都返回领域错误、原状态原样返回，绝不落盘一个非法状态。
 *
 * 三种裁决：
 * - relink：把悬空引用改指到一个人工选择的、且通过领域校验的目标；
 * - keep：保留悬空事实不动，仅把问题标记为已知悉（ignored）——事实不丢；
 * - clear：对可空字段清空引用（不可空字段不允许，调用方按 issue.clearable 控制）。
 */
import type { WorkspaceState } from "../../domain/types";
import { reconcileIssues, scanIntegrity } from "./integrity";
import { validateBenchAssignment } from "../../domain/bench";
import { replacementWouldCycle } from "../../domain/accession";
import { BENCH_LIGHT_COMPATIBILITY } from "../../domain/rules";
import type {
  DanglingReferenceIssue,
  MigrationIssue,
  UnknownEnumValueIssue,
} from "./types";
import { fail, fieldError, ok, type Result } from "../../domain/result";

export interface IssueResolutionResult {
  state: WorkspaceState;
  issues: MigrationIssue[];
}

export type ResolutionOutcome = Result<IssueResolutionResult>;

type StateBag = Record<string, unknown>;

function asBag(value: unknown): StateBag {
  return value as StateBag;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * 按槽位占用重算台架运行状态（仅对 assigned/available 两种由占用决定的状态生效）：
 * 清空最后一个槽位后应变为 available，仍有占用则为 assigned。
 * blocked / quarantine 是人为/运维状态，与占用无关，绝不被覆盖。
 */
function recomputeBenchStatus(record: StateBag): void {
  if (record.status === "blocked" || record.status === "quarantine") {
    return;
  }
  const assigned = Array.isArray(record.assignedIds) ? record.assignedIds : [];
  record.status = assigned.length > 0 ? "assigned" : "available";
}

function updateOwner(
  state: WorkspaceState,
  issue: { ownerCollection: string; ownerId: string },
  mutate: (record: StateBag) => void,
): WorkspaceState {
  const collectionKey = issue.ownerCollection as keyof WorkspaceState;
  const collection = state[collectionKey] as Array<{ id: string }>;
  const next = collection.map((record) => {
    if (record.id !== issue.ownerId) {
      return record;
    }
    const copy: StateBag = { ...asBag(record) };
    mutate(copy);
    return copy;
  });
  return { ...state, [collectionKey]: next };
}

function markIssue(
  issues: MigrationIssue[],
  issueId: string,
  status: "ignored" | "resolved",
  note: string,
): MigrationIssue[] {
  const at = nowIso();
  return issues.map((issue) =>
    issue.id === issueId
      ? { ...issue, status, resolvedAt: at, resolutionNote: note }
      : issue,
  );
}

/**
 * 在写入前校验重关联不会制造领域冲突。通过则返回需要执行的写入描述，
 * 否则返回领域错误（原状态不会被改动）。
 */
function validateRelink(
  state: WorkspaceState,
  issue: DanglingReferenceIssue,
  newRef: string,
): Result<true> {
  if (!newRef) {
    return fail([
      fieldError("newRef", "required", "请选择要重新关联的目标"),
    ]);
  }

  const target = state.accessions.find((item) => item.id === newRef);

  // 观测条目重关联：材料必须属于同一试验、在用，且同一次观测中不能已经有
  // 同一材料（与新建观测的 duplicate 规则一致）。
  if (issue.ownerCollection === "observationPasses") {
    const pass = state.observationPasses.find(
      (item) => item.id === issue.ownerId,
    );
    if (!target) {
      return fail([fieldError("newRef", "unknown", "目标材料不存在")]);
    }
    if (pass && target.trialId !== pass.trialId) {
      return fail([
        fieldError("newRef", "cross_trial", "观测材料必须属于同一试验"),
      ]);
    }
    if (target.lifecycleStatus === "retired") {
      return fail([
        fieldError("newRef", "retired", "不能把测量记录关联到已停用材料"),
      ]);
    }
    const alreadyObserved = (pass?.entries ?? []).some(
      (entry) => entry.accessionId === newRef,
    );
    if (alreadyObserved) {
      return fail([
        fieldError(
          "newRef",
          "duplicate",
          "同一材料在单次观测中只能出现一次",
        ),
      ]);
    }
    return ok(true);
  }

  // 台架槽位重关联：这是“替换一个悬空槽位”，而不是新增占用——槽位总数不变。
  // 因此先把待修复的悬空引用从占用列表移除，再在腾出的槽位上复用正常分配规则
  // （重复、容量、光照、台架状态）。容量已满但其中一个槽位悬空时替换是合法的；
  // 真正满位（移除悬空后仍满）才拒绝。
  if (issue.ownerCollection === "benches") {
    const bench = state.benches.find((item) => item.id === issue.ownerId);
    if (!bench) {
      return fail([fieldError("bench", "unknown", "目标台架不存在")]);
    }
    if (!target) {
      return fail([fieldError("newRef", "unknown", "目标材料不存在")]);
    }
    // 历史数据可能缺少有效光照字段；不能让领域规则在 undefined 上崩溃，
    // 而是明确拒绝并要求先修正材料。
    if (!(target.preferredLight in BENCH_LIGHT_COMPATIBILITY)) {
      return fail([
        fieldError(
          "newRef",
          "invalid_light",
          "该材料缺少有效的光照类型，无法校验台架兼容性，请先修正材料",
        ),
      ]);
    }
    const benchWithFreedSlot: typeof bench = {
      ...bench,
      assignedIds: bench.assignedIds.filter((id) => id !== issue.missingRef),
    };
    const assignment = validateBenchAssignment(target, benchWithFreedSlot);
    if (!assignment.ok) {
      return assignment;
    }
    return ok(true);
  }

  // 材料替代重关联（顶层 replacementId 或停用历史中的 replacementId）：
  // 非自身、在用、同试验、不形成循环——与 retireAccession 的规则一致。
  if (
    issue.ownerCollection === "accessions" &&
    issue.field === "replacementId"
  ) {
    const owner = state.accessions.find((item) => item.id === issue.ownerId);
    if (!owner) {
      return fail([fieldError("owner", "unknown", "被替代材料不存在")]);
    }
    if (!target) {
      return fail([fieldError("newRef", "unknown", "替代材料不存在")]);
    }
    if (target.id === owner.id) {
      return fail([
        fieldError("newRef", "self", "替代材料不能是当前材料"),
      ]);
    }
    if (target.trialId !== owner.trialId) {
      return fail([
        fieldError("newRef", "cross_trial", "替代材料必须属于同一试验"),
      ]);
    }
    if (target.lifecycleStatus === "retired") {
      return fail([
        fieldError("newRef", "retired", "替代材料必须处于在用状态"),
      ]);
    }
    if (replacementWouldCycle(state, owner.id, target.id)) {
      return fail([
        fieldError("newRef", "cycle", "替代关系不能形成循环"),
      ]);
    }
    return ok(true);
  }

  // 停用历史中的替代引用：同样校验自身/在用/同试验/循环，避免修复历史时
  // 引入与顶层关系矛盾的指向。
  if (
    issue.ownerCollection === "accessions" &&
    issue.field.startsWith("retirementHistory.")
  ) {
    const owner = state.accessions.find((item) => item.id === issue.ownerId);
    if (!owner || !target) {
      return fail([fieldError("newRef", "unknown", "目标材料不存在")]);
    }
    if (target.id === owner.id) {
      return fail([
        fieldError("newRef", "self", "替代材料不能是当前材料"),
      ]);
    }
    if (target.trialId !== owner.trialId) {
      return fail([
        fieldError("newRef", "cross_trial", "替代材料必须属于同一试验"),
      ]);
    }
    if (target.lifecycleStatus === "retired") {
      return fail([
        fieldError("newRef", "retired", "替代材料必须处于在用状态"),
      ]);
    }
    if (replacementWouldCycle(state, owner.id, target.id)) {
      return fail([
        fieldError("newRef", "cycle", "替代关系不能形成循环"),
      ]);
    }
    return ok(true);
  }

  // 其它直接外键（flags/trials 等）：只要求目标存在。
  const targetCollection = state[
    issue.targetCollection as keyof WorkspaceState
  ] as Array<{ id: string }> | undefined;
  if (!targetCollection?.some((item) => item.id === newRef)) {
    return fail([fieldError("newRef", "unknown", "目标记录不存在")]);
  }
  return ok(true);
}

/** 把一个悬空引用重新关联到现存且通过领域校验的目标。 */
export function resolveDanglingByRelink(
  state: WorkspaceState,
  issues: MigrationIssue[],
  issue: DanglingReferenceIssue,
  newRef: string,
): ResolutionOutcome {
  const validation = validateRelink(state, issue, newRef);
  if (!validation.ok) {
    return validation;
  }

  const nextState = updateOwner(state, issue, (record) => {
    if (issue.field === "assignedIds") {
      record.assignedIds = (Array.isArray(record.assignedIds)
        ? record.assignedIds
        : []
      ).map((id) => (id === issue.missingRef ? newRef : id));
      // 替换不改变占用数，但仍按占用重算状态（覆盖旧数据里自相矛盾的状态）。
      recomputeBenchStatus(record);
      return;
    }
    if (issue.field.startsWith("retirementHistory.")) {
      const index = Number(issue.field.split(".")[1]);
      const history = Array.isArray(record.retirementHistory)
        ? [...record.retirementHistory]
        : [];
      if (history[index] && typeof history[index] === "object") {
        history[index] = {
          ...asBag(history[index]),
          replacementId: newRef,
        };
      }
      record.retirementHistory = history;
      return;
    }
    if (issue.field.startsWith("entries.")) {
      const index = Number(issue.field.split(".")[1]);
      const entries = Array.isArray(record.entries) ? [...record.entries] : [];
      if (entries[index] && typeof entries[index] === "object") {
        entries[index] = { ...asBag(entries[index]), accessionId: newRef };
      }
      record.entries = entries;
      return;
    }
    record[issue.field] = newRef;
  });

  const marked = markIssue(
    issues,
    issue.id,
    "resolved",
    `已重新关联到 ${newRef}`,
  );
  return ok({
    state: nextState,
    issues: reconcileIssues(marked, scanIntegrity(nextState, nowIso())),
  });
}

/** 清空一个可空的悬空引用（不可空字段返回原状，UI 不应暴露此动作）。 */
export function resolveDanglingByClear(
  state: WorkspaceState,
  issues: MigrationIssue[],
  issue: DanglingReferenceIssue,
): ResolutionOutcome {
  if (!issue.clearable) {
    return fail([
      fieldError(issue.field, "not_clearable", "该引用不允许清空，只能重新关联或保留"),
    ]);
  }
  const nextState = updateOwner(state, issue, (record) => {
    if (issue.field === "assignedIds") {
      record.assignedIds = (Array.isArray(record.assignedIds)
        ? record.assignedIds
        : []
      ).filter((id) => id !== issue.missingRef);
      // 清空悬空槽位后按剩余占用重算：清空最后一个槽位即变为 available。
      recomputeBenchStatus(record);
      return;
    }
    if (issue.field.startsWith("retirementHistory.")) {
      const index = Number(issue.field.split(".")[1]);
      const history = Array.isArray(record.retirementHistory)
        ? [...record.retirementHistory]
        : [];
      if (history[index] && typeof history[index] === "object") {
        const copy = { ...asBag(history[index]) };
        delete copy.replacementId;
        history[index] = copy;
      }
      record.retirementHistory = history;
      return;
    }
    record[issue.field] = undefined;
  });

  const marked = markIssue(issues, issue.id, "resolved", "已清空悬空引用");
  return ok({
    state: nextState,
    issues: reconcileIssues(marked, scanIntegrity(nextState, nowIso())),
  });
}

/** 保留悬空事实不动，仅确认知悉。历史事实完整保留，问题不再提示。 */
export function keepDanglingAsIs(
  state: WorkspaceState,
  issues: MigrationIssue[],
  issue: DanglingReferenceIssue,
  note: string,
): ResolutionOutcome {
  return ok({
    state,
    issues: markIssue(issues, issue.id, "ignored", note),
  });
}

/** 把未知枚举值人工修正为一个受支持取值。 */
export function resolveUnknownEnum(
  state: WorkspaceState,
  issues: MigrationIssue[],
  issue: UnknownEnumValueIssue,
  newValue: string,
): ResolutionOutcome {
  if (!issue.supportedValues.includes(newValue)) {
    return fail([
      fieldError(issue.field, "invalid", `「${newValue}」不是受支持的取值`),
    ]);
  }
  const nextState = updateOwner(state, issue, (record) => {
    record[issue.field] = newValue;
  });
  const marked = markIssue(
    issues,
    issue.id,
    "resolved",
    `已将「${issue.unknownValue}」修正为「${newValue}」`,
  );
  return ok({
    state: nextState,
    issues: reconcileIssues(marked, scanIntegrity(nextState, nowIso())),
  });
}

/** 知悉一个未知字段：值继续原样保留，仅关闭提示。 */
export function acknowledgeUnknownField(
  state: WorkspaceState,
  issues: MigrationIssue[],
  issue: Extract<MigrationIssue, { code: "unknown_field" }>,
): ResolutionOutcome {
  return ok({
    state,
    issues: markIssue(issues, issue.id, "ignored", "已知悉，字段继续保留"),
  });
}

/** 可作为某问题重新关联目标的现存实体候选（id + 展示标签）。 */
export function relinkCandidates(
  state: WorkspaceState,
  issue: DanglingReferenceIssue,
): Array<{ id: string; label: string }> {
  const bag = state as unknown as Record<string, Array<StateBag>>;
  const collection = bag[issue.targetCollection] ?? [];
  return collection.map((record) => ({
    id: String(record.id),
    label:
      typeof record.code === "string"
        ? record.code
        : typeof record.accessionNo === "string"
          ? record.accessionNo
          : String(record.id),
  }));
}
