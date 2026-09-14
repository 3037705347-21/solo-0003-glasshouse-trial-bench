import type { Accession, AccessionLineage, LineageRelation, WorkspaceState } from "./types";
import { createId } from "./id";
import { fail, fieldError, ok, type Result } from "./result";

export interface LineageDraft {
  childAccessionId: string;
  parentAccessionId: string;
  relation: LineageRelation;
  note: string;
}

export const LINEAGE_RELATIONS: LineageRelation[] = [
  "selfed",
  "cross",
  "selected-from",
];

export function describeLineageRelation(relation: LineageRelation): string {
  if (relation === "selfed") {
    return "自交后代";
  }
  if (relation === "cross") {
    return "杂交后代";
  }
  return "选择后代";
}

function accessionExists(accessions: Accession[], id: string): boolean {
  return accessions.some((accession) => accession.id === id);
}

function reaches(
  links: AccessionLineage[],
  startId: string,
  targetId: string,
): boolean {
  const visited = new Set<string>();
  const stack = [startId];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    if (current === targetId) {
      return true;
    }
    if (visited.has(current)) {
      continue;
    }
    visited.add(current);
    links
      .filter((link) => link.childAccessionId === current)
      .forEach((link) => stack.push(link.parentAccessionId));
  }
  return false;
}

export function validateLineageDraft(
  draft: LineageDraft,
  state: WorkspaceState,
): Result<LineageDraft> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  if (!accessionExists(state.accessions, draft.childAccessionId)) {
    errors.push(fieldError("childAccessionId", "unknown", "请选择后代材料"));
  }
  if (!accessionExists(state.accessions, draft.parentAccessionId)) {
    errors.push(fieldError("parentAccessionId", "unknown", "请选择亲本材料"));
  }
  if (!LINEAGE_RELATIONS.includes(draft.relation)) {
    errors.push(fieldError("relation", "invalid", "请选择亲缘关系"));
  }
  if (
    draft.childAccessionId &&
    draft.childAccessionId === draft.parentAccessionId
  ) {
    errors.push(
      fieldError("parentAccessionId", "self_link", "亲本和后代不能是同一材料"),
    );
  }
  if (draft.note.trim().length < 8) {
    errors.push(
      fieldError(
        "note",
        "too_short",
        "请用至少 8 个字符说明该亲缘关系的依据",
      ),
    );
  }
  if (errors.length > 0) {
    return fail(errors);
  }
  const duplicate = state.accessionLineage.some(
    (link) =>
      link.childAccessionId === draft.childAccessionId &&
      link.parentAccessionId === draft.parentAccessionId &&
      link.relation === draft.relation,
  );
  if (duplicate) {
    return fail([
      fieldError("relation", "duplicate", "该亲缘关系已经登记过"),
    ]);
  }
  // 亲子方向成环会让谱系无法追踪，拒绝新增。
  if (reaches(state.accessionLineage, draft.parentAccessionId, draft.childAccessionId)) {
    return fail([
      fieldError(
        "parentAccessionId",
        "cycle",
        "该亲本已经是后代材料的子代，不能建立反向亲缘",
      ),
    ]);
  }
  return ok({ ...draft, note: draft.note.trim() });
}

export function createLineageLink(
  draft: LineageDraft,
  state: WorkspaceState,
): Result<AccessionLineage> {
  const validated = validateLineageDraft(draft, state);
  if (!validated.ok) {
    return validated;
  }
  const value = validated.value;
  return ok({
    id: createId("lin"),
    childAccessionId: value.childAccessionId,
    parentAccessionId: value.parentAccessionId,
    relation: value.relation,
    note: value.note,
    createdOn: new Date().toISOString(),
  });
}

export function lineageLinksForAccession(
  state: WorkspaceState,
  accessionId: string,
): { parents: AccessionLineage[]; children: AccessionLineage[] } {
  return {
    parents: state.accessionLineage.filter(
      (link) => link.childAccessionId === accessionId,
    ),
    children: state.accessionLineage.filter(
      (link) => link.parentAccessionId === accessionId,
    ),
  };
}
