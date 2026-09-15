/**
 * 待人工处理项的裁决动作。这些动作是工作区在“带问题可用”状态下唯一的修复路径，
 * 都是纯函数：接收当前状态与问题，返回新状态与更新后的问题集合，然后重新扫描复检。
 *
 * 三种裁决：
 * - relink：把悬空引用改指到一个人工选择的、真实存在的目标；
 * - keep：保留悬空事实不动，仅把问题标记为已知悉（ignored）——事实不丢；
 * - clear：对可空字段清空引用（不可空字段不允许，调用方按 issue.clearable 控制）。
 */
import type { WorkspaceState } from "../../domain/types";
import { reconcileIssues, scanIntegrity } from "./integrity";
import type {
  DanglingReferenceIssue,
  MigrationIssue,
  UnknownEnumValueIssue,
} from "./types";

export interface IssueResolutionResult {
  state: WorkspaceState;
  issues: MigrationIssue[];
}

type StateBag = Record<string, unknown>;

function asBag(value: unknown): StateBag {
  return value as StateBag;
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

function nowIso(): string {
  return new Date().toISOString();
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

/** 把一个悬空引用重新关联到现存目标。目标存在性由调用方用候选列表保证。 */
export function resolveDanglingByRelink(
  state: WorkspaceState,
  issues: MigrationIssue[],
  issue: DanglingReferenceIssue,
  newRef: string,
): IssueResolutionResult {
  if (!newRef) {
    return { state, issues };
  }
  const nextState = updateOwner(state, issue, (record) => {
    if (issue.field === "assignedIds") {
      record.assignedIds = (Array.isArray(record.assignedIds)
        ? record.assignedIds
        : []
      ).map((id) => (id === issue.missingRef ? newRef : id));
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
    record[issue.field] = newRef;
  });

  const marked = markIssue(
    issues,
    issue.id,
    "resolved",
    `已重新关联到 ${newRef}`,
  );
  return {
    state: nextState,
    issues: reconcileIssues(marked, scanIntegrity(nextState, nowIso())),
  };
}

/** 清空一个可空的悬空引用（不可空字段返回原状，UI 不应暴露此动作）。 */
export function resolveDanglingByClear(
  state: WorkspaceState,
  issues: MigrationIssue[],
  issue: DanglingReferenceIssue,
): IssueResolutionResult {
  if (!issue.clearable) {
    return { state, issues };
  }
  const nextState = updateOwner(state, issue, (record) => {
    if (issue.field === "assignedIds") {
      record.assignedIds = (Array.isArray(record.assignedIds)
        ? record.assignedIds
        : []
      ).filter((id) => id !== issue.missingRef);
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
  return {
    state: nextState,
    issues: reconcileIssues(marked, scanIntegrity(nextState, nowIso())),
  };
}

/** 保留悬空事实不动，仅确认知悉。历史事实完整保留，问题不再提示。 */
export function keepDanglingAsIs(
  state: WorkspaceState,
  issues: MigrationIssue[],
  issue: DanglingReferenceIssue,
  note: string,
): IssueResolutionResult {
  return { state, issues: markIssue(issues, issue.id, "ignored", note) };
}

/** 把未知枚举值人工修正为一个受支持取值。 */
export function resolveUnknownEnum(
  state: WorkspaceState,
  issues: MigrationIssue[],
  issue: UnknownEnumValueIssue,
  newValue: string,
): IssueResolutionResult {
  if (!issue.supportedValues.includes(newValue)) {
    return { state, issues };
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
  return {
    state: nextState,
    issues: reconcileIssues(marked, scanIntegrity(nextState, nowIso())),
  };
}

/** 知悉一个未知字段：值继续原样保留，仅关闭提示。 */
export function acknowledgeUnknownField(
  state: WorkspaceState,
  issues: MigrationIssue[],
  issue: Extract<MigrationIssue, { code: "unknown_field" }>,
): IssueResolutionResult {
  return { state, issues: markIssue(issues, issue.id, "ignored", "已知悉，字段继续保留") };
}

/** 可作为某问题重新关联目标的现存实体候选。 */
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
