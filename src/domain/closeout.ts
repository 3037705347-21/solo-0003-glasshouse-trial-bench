import type {
  CloseoutFacts,
  CloseoutReview,
  CloseoutStatus,
  WorkspaceState,
} from "./types";
import { createId } from "./id";
import { fail, fieldError, ok, type Result } from "./result";

export interface CloseoutDraft {
  trialId: string;
  createdBy: string;
  conclusion: string;
  outstandingIssues: string;
  nextSeasonAdvice: string;
  actionItems: string[];
}

const closeoutTransitions: Record<CloseoutStatus, CloseoutStatus[]> = {
  completed: ["follow-up", "closed"],
  "follow-up": ["completed", "closed"],
  closed: [],
};

export function buildCloseoutFacts(
  state: WorkspaceState,
  trialId: string,
): CloseoutFacts {
  const trial = state.trials.find((item) => item.id === trialId);
  const accessions = state.accessions.filter(
    (accession) => accession.trialId === trialId,
  );
  const passes = state.observationPasses
    .filter((pass) => pass.trialId === trialId)
    .sort((left, right) => left.observedOn.localeCompare(right.observedOn));
  const flags = state.flags.filter((flag) => flag.trialId === trialId);
  const accessionIds = new Set(accessions.map((accession) => accession.id));
  const benches = state.benches
    .map((bench) => ({
      bench,
      usedSlots: bench.assignedIds.filter((id) => accessionIds.has(id)).length,
    }))
    .filter((entry) => entry.usedSlots > 0)
    .sort((left, right) => left.bench.code.localeCompare(right.bench.code));
  const snapshot = [...state.clearanceSnapshots]
    .filter((item) => item.trialId === trialId)
    .sort((left, right) => right.generatedOn.localeCompare(left.generatedOn))[0];
  return {
    capturedOn: new Date().toISOString(),
    trialCode: trial?.code ?? "未知试验",
    trialState: trial?.state ?? "draft",
    accessions: accessions.map((accession) => {
      const bench = state.benches.find((item) =>
        item.assignedIds.includes(accession.id),
      );
      return {
        accessionNo: accession.accessionNo,
        cultivar: accession.cultivar,
        ...(bench ? { benchCode: bench.code } : {}),
      };
    }),
    observationPasses: passes.map((pass) => ({
      observedOn: pass.observedOn,
      observer: pass.observer,
      entryCount: pass.entries.length,
    })),
    flags: flags.map((flag) => ({
      code: flag.code,
      severity: flag.severity,
      state: flag.state,
      message: flag.message,
    })),
    benches: benches.map((entry) => ({
      code: entry.bench.code,
      sector: entry.bench.sector,
      usedSlots: entry.usedSlots,
      capacity: entry.bench.capacity,
    })),
    ...(snapshot
      ? {
          clearance: {
            snapshotId: snapshot.id,
            generatedOn: snapshot.generatedOn,
            status: snapshot.status,
            blockerCount: snapshot.blockers.length,
          },
        }
      : {}),
  };
}

export function validateCloseoutDraft(
  draft: CloseoutDraft,
  state: WorkspaceState,
): Result<CloseoutDraft> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  const trial = state.trials.find((item) => item.id === draft.trialId);
  if (!trial) {
    errors.push(fieldError("trialId", "unknown", "请选择有效试验"));
  } else if (trial.state === "draft") {
    errors.push(
      fieldError(
        "trialId",
        "trial_state",
        "草稿试验尚未开始，不能进行关闭复盘",
      ),
    );
  }
  if (draft.createdBy.trim().length < 2) {
    errors.push(fieldError("createdBy", "required", "请填写复盘负责人"));
  }
  if (draft.conclusion.trim().length < 10) {
    errors.push(
      fieldError(
        "conclusion",
        "too_short",
        "请用至少 10 个字符记录复盘结论",
      ),
    );
  }
  if (draft.nextSeasonAdvice.trim().length < 10) {
    errors.push(
      fieldError(
        "nextSeasonAdvice",
        "too_short",
        "请用至少 10 个字符记录下季建议",
      ),
    );
  }
  const actionItems = draft.actionItems
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (errors.length > 0) {
    return fail(errors);
  }
  return ok({
    ...draft,
    createdBy: draft.createdBy.trim(),
    conclusion: draft.conclusion.trim(),
    outstandingIssues: draft.outstandingIssues.trim(),
    nextSeasonAdvice: draft.nextSeasonAdvice.trim(),
    actionItems,
  });
}

export function createCloseoutReview(
  draft: CloseoutDraft,
  state: WorkspaceState,
): Result<CloseoutReview> {
  const validated = validateCloseoutDraft(draft, state);
  if (!validated.ok) {
    return validated;
  }
  const value = validated.value;
  const now = new Date().toISOString();
  const round =
    state.closeoutReviews
      .filter((review) => review.trialId === value.trialId)
      .reduce((max, review) => Math.max(max, review.round), 0) + 1;
  const actionItems = value.actionItems.map((text) => ({
    id: createId("act"),
    text,
    createdOn: now,
  }));
  return ok({
    id: createId("rev"),
    trialId: value.trialId,
    round,
    createdOn: now,
    createdBy: value.createdBy,
    conclusion: value.conclusion,
    outstandingIssues: value.outstandingIssues,
    nextSeasonAdvice: value.nextSeasonAdvice,
    status: actionItems.length > 0 ? "follow-up" : "completed",
    statusChangedOn: now,
    facts: buildCloseoutFacts(state, value.trialId),
    actionItems,
  });
}

export function transitionCloseout(
  review: CloseoutReview,
  next: CloseoutStatus,
): Result<CloseoutReview> {
  if (review.status === "closed") {
    return fail([
      fieldError("status", "already_closed", "复盘已关闭，不能重复关闭或变更"),
    ]);
  }
  if (review.status === next) {
    return fail([
      fieldError("status", "unchanged", "复盘已经处于该状态"),
    ]);
  }
  if (!closeoutTransitions[review.status].includes(next)) {
    return fail([
      fieldError(
        "status",
        "invalid_transition",
        `复盘不能从 ${describeCloseoutStatus(review.status)} 变更到 ${describeCloseoutStatus(next)}`,
      ),
    ]);
  }
  if (next === "closed") {
    const openActions = review.actionItems.filter(
      (item) => !item.completedOn,
    ).length;
    if (openActions > 0) {
      return fail([
        fieldError(
          "status",
          "open_actions",
          `仍有 ${openActions} 项后续行动未完成，完成后再关闭复盘`,
        ),
      ]);
    }
  }
  const now = new Date().toISOString();
  return ok({
    ...review,
    status: next,
    statusChangedOn: now,
    closedOn: next === "closed" ? now : review.closedOn,
  });
}

export function completeCloseoutAction(
  review: CloseoutReview,
  actionId: string,
): Result<CloseoutReview> {
  if (review.status === "closed") {
    return fail([
      fieldError("status", "already_closed", "复盘已关闭，不能再变更行动项"),
    ]);
  }
  const target = review.actionItems.find((item) => item.id === actionId);
  if (!target) {
    return fail([
      fieldError("actionId", "unknown", "未找到对应的后续行动"),
    ]);
  }
  if (target.completedOn) {
    return fail([
      fieldError("actionId", "already_done", "该后续行动已完成"),
    ]);
  }
  const completedOn = new Date().toISOString();
  return ok({
    ...review,
    actionItems: review.actionItems.map((item) =>
      item.id === actionId ? { ...item, completedOn } : item,
    ),
  });
}

export function describeCloseoutStatus(status: CloseoutStatus): string {
  if (status === "completed") {
    return "已完成";
  }
  if (status === "follow-up") {
    return "待跟进";
  }
  return "已关闭";
}
