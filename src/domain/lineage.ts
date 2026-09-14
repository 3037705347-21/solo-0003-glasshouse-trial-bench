import type {
  Accession,
  LineageRelation,
  LineageRelationType,
  WorkspaceState,
} from "./types";
import { createId } from "./id";
import { fail, fieldError, ok, type Result } from "./result";

export interface LineageDraft {
  trialId: string;
  type: LineageRelationType;
  endpointAId: string;
  endpointBId: string;
  note?: string;
}

/** Canonical identity of an undirected pair, so A-B and B-A never duplicate. */
function relationPairKey(
  type: LineageRelationType,
  endpointAId: string,
  endpointBId: string,
): string {
  const [left, right] = [endpointAId, endpointBId].sort();
  return `${type}:${left}->${right}`;
}

export function findRelation(
  relations: LineageRelation[],
  type: LineageRelationType,
  endpointAId: string,
  endpointBId: string,
): LineageRelation | undefined {
  const key = relationPairKey(type, endpointAId, endpointBId);
  return relations.find(
    (relation) =>
      relationPairKey(
        relation.type,
        relation.endpointAId,
        relation.endpointBId,
      ) === key,
  );
}

function otherEndpoint(relation: LineageRelation, accessionId: string): string {
  return relation.endpointAId === accessionId
    ? relation.endpointBId
    : relation.endpointAId;
}

/**
 * Parent edges only point from a parent (endpointA) to a child (endpointB).
 * Cohort links are undirected and never participate in generational walks.
 */
function parentChildPairs(relations: LineageRelation[]): Array<[string, string]> {
  return relations
    .filter((relation) => relation.type === "parent")
    .map((relation) => [relation.endpointAId, relation.endpointBId]);
}

/** True when `childId` is already an ancestor of `parentId`. */
export function wouldCreateParentCycle(
  relations: LineageRelation[],
  parentId: string,
  childId: string,
): boolean {
  const parentsOf = new Map<string, string[]>();
  parentChildPairs(relations).forEach(([parent, child]) => {
    parentsOf.set(child, [...(parentsOf.get(child) ?? []), parent]);
  });
  const stack = [...(parentsOf.get(parentId) ?? [])];
  const seen = new Set<string>();
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === childId) {
      return true;
    }
    if (seen.has(current)) {
      continue;
    }
    seen.add(current);
    stack.push(...(parentsOf.get(current) ?? []));
  }
  return false;
}

export function validateLineageDraft(
  draft: LineageDraft,
  state: WorkspaceState,
): Result<LineageDraft> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  const parent = state.accessions.find(
    (accession) => accession.id === draft.endpointAId,
  );
  const child = state.accessions.find(
    (accession) => accession.id === draft.endpointBId,
  );
  if (draft.type !== "parent" && draft.type !== "cohort") {
    errors.push(fieldError("type", "invalid", "请选择谱系关系类型"));
  }
  if (!parent) {
    errors.push(
      fieldError("endpointAId", "unknown", "请选择谱系关系的一端材料"),
    );
  }
  if (!child) {
    errors.push(
      fieldError("endpointBId", "unknown", "请选择谱系关系的另一端材料"),
    );
  }
  if (parent && child) {
    if (parent.id === child.id) {
      errors.push(
        fieldError("endpointBId", "self_reference", "不能把材料与自身建立谱系关系"),
      );
    }
    if (parent.trialId !== draft.trialId || child.trialId !== draft.trialId) {
      errors.push(
        fieldError("trialId", "cross_trial", "谱系关系只能连接同一试验内的材料"),
      );
    }
    if (parent.mergedIntoId || child.mergedIntoId) {
      errors.push(
        fieldError(
          "endpointAId",
          "merged",
          "已合并归档的材料不能再新增谱系关系",
        ),
      );
    }
    if (
      parent.id !== child.id &&
      findRelation(
        state.lineageRelations,
        draft.type,
        parent.id,
        child.id,
      )
    ) {
      errors.push(
        fieldError(
          "endpointBId",
          "duplicate",
          "这两个材料之间已经存在相同类型的谱系关系",
        ),
      );
    }
    if (
      draft.type === "parent" &&
      parent.id !== child.id &&
      wouldCreateParentCycle(state.lineageRelations, parent.id, child.id)
    ) {
      errors.push(
        fieldError(
          "endpointAId",
          "cycle",
          "该关系会形成谱系环：子代当前已是父代的祖先",
        ),
      );
    }
  }
  if (errors.length > 0) {
    return fail(errors);
  }
  const note = draft.note?.trim();
  return ok({
    ...draft,
    endpointAId: draft.endpointAId,
    endpointBId: draft.endpointBId,
    note: note ? note : undefined,
  });
}

export function createLineageRelation(
  draft: LineageDraft,
  state: WorkspaceState,
): Result<LineageRelation> {
  const validated = validateLineageDraft(draft, state);
  if (!validated.ok) {
    return validated;
  }
  const value = validated.value;
  return ok({
    id: createId("lin"),
    trialId: value.trialId,
    type: value.type,
    endpointAId: value.endpointAId,
    endpointBId: value.endpointBId,
    note: value.note,
    createdOn: new Date().toISOString(),
  });
}

export function directParents(
  state: WorkspaceState,
  accessionId: string,
): Accession[] {
  const ids = state.lineageRelations
    .filter(
      (relation) =>
        relation.type === "parent" && relation.endpointBId === accessionId,
    )
    .map((relation) => relation.endpointAId);
  return resolveAccessions(state, ids);
}

export function directChildren(
  state: WorkspaceState,
  accessionId: string,
): Accession[] {
  const ids = state.lineageRelations
    .filter(
      (relation) =>
        relation.type === "parent" && relation.endpointAId === accessionId,
    )
    .map((relation) => relation.endpointBId);
  return resolveAccessions(state, ids);
}

export function cohortSiblings(
  state: WorkspaceState,
  accessionId: string,
): Accession[] {
  const ids = state.lineageRelations
    .filter(
      (relation) =>
        relation.type === "cohort" &&
        (relation.endpointAId === accessionId ||
          relation.endpointBId === accessionId),
    )
    .map((relation) => otherEndpoint(relation, accessionId));
  return resolveAccessions(state, ids);
}

function resolveAccessions(state: WorkspaceState, ids: string[]): Accession[] {
  const unique = Array.from(new Set(ids));
  return unique
    .map((id) => state.accessions.find((accession) => accession.id === id))
    .filter((accession): accession is Accession => Boolean(accession));
}

export interface LineageLevel {
  depth: number;
  accessions: Accession[];
}

export interface LineageView {
  focus: Accession;
  /** Nearest parents first, furthest ancestors last. */
  ancestorLevels: LineageLevel[];
  /** Immediate children first, furthest descendants last. */
  descendantLevels: LineageLevel[];
  cohorts: Accession[];
  /** Accession ids that have no recorded parent and therefore dead-end. */
  untracedRootIds: string[];
}

function walkLevels(
  state: WorkspaceState,
  startIds: string[],
  nextIds: (id: string) => string[],
): LineageLevel[] {
  const levels: LineageLevel[] = [];
  const visited = new Set<string>(startIds);
  let frontier = startIds;
  let depth = 1;
  while (frontier.length > 0) {
    const levelIds = Array.from(
      new Set(frontier.flatMap((id) => nextIds(id))),
    ).filter((id) => !visited.has(id));
    if (levelIds.length === 0) {
      break;
    }
    levelIds.forEach((id) => visited.add(id));
    const accessions = resolveAccessions(state, levelIds);
    if (accessions.length > 0) {
      levels.push({ depth, accessions });
    }
    frontier = levelIds;
    depth += 1;
  }
  return levels;
}

export function buildLineageView(
  state: WorkspaceState,
  focusId: string,
): LineageView | undefined {
  const focus = state.accessions.find((accession) => accession.id === focusId);
  if (!focus) {
    return undefined;
  }
  const ancestorLevels = walkLevels(state, [focusId], (id) =>
    directParents(state, id).map((accession) => accession.id),
  );
  const descendantLevels = walkLevels(state, [focusId], (id) =>
    directChildren(state, id).map((accession) => accession.id),
  );
  const cohorts = cohortSiblings(state, focusId);

  const untracedRootIds = [
    focus,
    ...ancestorLevels.flatMap((level) => level.accessions),
  ]
    .filter((accession) => directParents(state, accession.id).length === 0)
    .map((accession) => accession.id);

  return {
    focus,
    ancestorLevels,
    descendantLevels,
    cohorts,
    untracedRootIds: Array.from(new Set(untracedRootIds)),
  };
}

export function lineageRelationLabel(type: LineageRelationType): string {
  return type === "parent" ? "父代 / 子代" : "同批衍生";
}

/* ------------------------------------------------------------------ */
/* Merge and delete                                                    */
/* ------------------------------------------------------------------ */

export interface MergePlan {
  sourceId: string;
  targetId: string;
  mergedOn: string;
  relationIdsRemoved: string[];
  relations: LineageRelation[];
  benchReleaseIds: string[];
}

export function planAccessionMerge(
  state: WorkspaceState,
  sourceId: string,
  targetId: string,
): Result<MergePlan> {
  const source = state.accessions.find((item) => item.id === sourceId);
  const target = state.accessions.find((item) => item.id === targetId);
  if (!source || !target) {
    return fail([fieldError("targetId", "unknown", "请选择有效的材料")]);
  }
  if (source.id === target.id) {
    return fail([
      fieldError("targetId", "self_reference", "不能把材料合并到自身"),
    ]);
  }
  if (source.trialId !== target.trialId) {
    return fail([
      fieldError("targetId", "cross_trial", "只能合并同一试验内的材料"),
    ]);
  }
  if (source.mergedIntoId) {
    return fail([
      fieldError("sourceId", "already_merged", "该材料已经被合并归档"),
    ]);
  }
  if (target.mergedIntoId) {
    return fail([
      fieldError("targetId", "target_merged", "不能合并到已经归档的材料"),
    ]);
  }

  const mergedOn = new Date().toISOString();
  const relationIdsRemoved: string[] = [];
  const incoming = state.lineageRelations
    .filter(
      (relation) =>
        relation.endpointAId === sourceId || relation.endpointBId === sourceId,
    )
    .map((relation) => ({
      relation,
      next: {
        ...relation,
        endpointAId:
          relation.endpointAId === sourceId
            ? targetId
            : relation.endpointAId,
        endpointBId:
          relation.endpointBId === sourceId
            ? targetId
            : relation.endpointBId,
      } as LineageRelation,
    }));
  const untouched = state.lineageRelations.filter(
    (relation) =>
      relation.endpointAId !== sourceId && relation.endpointBId !== sourceId,
  );

  const repointed: LineageRelation[] = [];
  incoming.forEach(({ relation, next }) => {
    // Self links after repointing, duplicates, and edges that would close a
    // generational loop are dropped rather than silently corrupting the graph.
    if (next.endpointAId === next.endpointBId) {
      relationIdsRemoved.push(relation.id);
      return;
    }
    if (
      findRelation(
        [...untouched, ...repointed],
        next.type,
        next.endpointAId,
        next.endpointBId,
      )
    ) {
      relationIdsRemoved.push(relation.id);
      return;
    }
    if (
      next.type === "parent" &&
      wouldCreateParentCycle(
        [...untouched, ...repointed],
        next.endpointAId,
        next.endpointBId,
      )
    ) {
      relationIdsRemoved.push(relation.id);
      return;
    }
    repointed.push(next);
  });

  const benchReleaseIds = state.benches
    .filter((bench) => bench.assignedIds.includes(sourceId))
    .map((bench) => bench.id);

  return ok({
    sourceId,
    targetId,
    mergedOn,
    relationIdsRemoved,
    relations: [...untouched, ...repointed],
    benchReleaseIds,
  });
}

export interface DeletePlan {
  accessionId: string;
  relationIdsRemoved: string[];
  benchReleaseIds: string[];
}

export function planAccessionDelete(
  state: WorkspaceState,
  accessionId: string,
): Result<DeletePlan> {
  const accession = state.accessions.find((item) => item.id === accessionId);
  if (!accession) {
    return fail([fieldError("accessionId", "unknown", "材料不存在")]);
  }
  const historicalPasses = state.observationPasses.filter((pass) =>
    pass.entries.some((entry) => entry.accessionId === accessionId),
  );
  const historicalFlags = state.flags.filter(
    (flag) => flag.accessionId === accessionId,
  );
  const snapshotReferences = state.clearanceSnapshots.filter((snapshot) =>
    snapshot.blockers.some((blocker) => blocker.accessionId === accessionId),
  );
  const mergeDependents = state.accessions.filter(
    (item) => item.mergedIntoId === accessionId,
  );
  const blockers: string[] = [];
  if (historicalPasses.length > 0) {
    blockers.push("存在引用该材料的历史观测记录");
  }
  if (historicalFlags.length > 0) {
    blockers.push("存在派生自该材料的生长标记");
  }
  if (snapshotReferences.length > 0) {
    blockers.push("存在引用该材料的不可变放行快照");
  }
  if (mergeDependents.length > 0) {
    blockers.push("已有归档材料合并到该材料");
  }
  if (blockers.length > 0) {
    return fail([
      fieldError(
        "accessionId",
        "history_referenced",
        `无法删除：${blockers.join("；")}。请改用合并，历史观测与标记会保留其发生时的材料身份。`,
      ),
    ]);
  }
  const relationIdsRemoved = state.lineageRelations
    .filter(
      (relation) =>
        relation.endpointAId === accessionId ||
        relation.endpointBId === accessionId,
    )
    .map((relation) => relation.id);
  const benchReleaseIds = state.benches
    .filter((bench) => bench.assignedIds.includes(accessionId))
    .map((bench) => bench.id);
  return ok({ accessionId, relationIdsRemoved, benchReleaseIds });
}

export function accessionDisplayName(accession: Accession): string {
  return `${accession.accessionNo} · ${accession.cultivar}`;
}
