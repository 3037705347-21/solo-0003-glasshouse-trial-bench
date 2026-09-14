import type {
  ObservationPass,
  ObservationPlan,
  PlanAccessionSnapshot,
  PlanDrift,
  PlanFollowUpStatus,
  PlanScheduleStatus,
  WorkspaceState,
} from "./types";
import { createId } from "./id";
import { parseDateOnly, todayDateOnly } from "./rules";
import { fail, fieldError, ok, type Result } from "./result";

/** 到期前多少天开始提示“临近到期”。 */
export const DUE_SOON_WINDOW_DAYS = 3;

export interface ObservationPlanDraft {
  trialId: string;
  scheduledOn: string;
  assignee: string;
  note: string;
  accessionIds: string[];
}

/**
 * 为计划范围内的材料建立快照。计划与真实观测记录分开保存；快照只记录建立
 * 计划那一刻的材料编号、台架和试验状态，用于日后检测变化，不会回写其他模块。
 */
export function buildPlanSnapshots(
  state: WorkspaceState,
  trialId: string,
  accessionIds: string[],
): PlanAccessionSnapshot[] {
  return accessionIds.map((accessionId) => {
    const accession = state.accessions.find(
      (item) => item.id === accessionId && item.trialId === trialId,
    );
    const bench = state.benches.find((item) =>
      item.assignedIds.includes(accessionId),
    );
    const trialState =
      state.trials.find((trial) => trial.id === trialId)?.state ?? "draft";
    return {
      accessionId,
      accessionNo: accession?.accessionNo ?? "已删除",
      cultivar: accession?.cultivar ?? "未知材料",
      benchId: bench?.id ?? null,
      benchCode: bench?.code ?? null,
      trialState,
    };
  });
}

export function validatePlanDraft(
  draft: ObservationPlanDraft,
  state: WorkspaceState,
): Result<ObservationPlanDraft> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  const trial = state.trials.find((item) => item.id === draft.trialId);
  if (!trial) {
    errors.push(fieldError("trialId", "unknown", "请选择有效试验"));
  }
  if (!parseDateOnly(draft.scheduledOn)) {
    errors.push(fieldError("scheduledOn", "invalid_date", "计划日期无效"));
  }
  if (draft.assignee.trim().length < 2) {
    errors.push(fieldError("assignee", "required", "请填写负责人"));
  }
  if (draft.accessionIds.length === 0) {
    errors.push(
      fieldError("accessionIds", "empty", "请至少选择一种计划观测材料"),
    );
  }
  const trialAccessionIds = new Set(
    state.accessions
      .filter((accession) => accession.trialId === draft.trialId)
      .map((accession) => accession.id),
  );
  const seen = new Set<string>();
  draft.accessionIds.forEach((accessionId) => {
    if (!trialAccessionIds.has(accessionId)) {
      errors.push(
        fieldError("accessionIds", "unknown", "选择的材料不属于该试验"),
      );
    }
    if (seen.has(accessionId)) {
      errors.push(
        fieldError("accessionIds", "duplicate", "同一材料在计划中只能选择一次"),
      );
    }
    seen.add(accessionId);
  });
  if (errors.length > 0) {
    return fail(errors);
  }
  return ok({
    ...draft,
    assignee: draft.assignee.trim(),
    note: draft.note.trim(),
  });
}

export function createObservationPlan(
  draft: ObservationPlanDraft,
  state: WorkspaceState,
): Result<ObservationPlan> {
  const validated = validatePlanDraft(draft, state);
  if (!validated.ok) {
    return validated;
  }
  const value = validated.value;
  const snapshots = buildPlanSnapshots(state, value.trialId, value.accessionIds);
  const createdAt = new Date().toISOString();
  return ok({
    id: createId("pln"),
    trialId: value.trialId,
    scheduledOn: value.scheduledOn,
    assignee: value.assignee,
    note: value.note,
    accessionIds: [...value.accessionIds],
    accessionSnapshots: snapshots,
    status: "pending",
    createdAt,
    createdOn: todayDateOnly(),
  });
}

/**
 * 用计划当前选定的材料范围重新建立快照。重新确认后漂移提示清零，计划重新
 * 可以完成；历史快照中记录的差异仍然保留在旧快照里。
 */
export function refreshPlanBaseline(
  plan: ObservationPlan,
  state: WorkspaceState,
): ObservationPlan {
  const currentTrial = state.trials.find((trial) => trial.id === plan.trialId);
  const snapshots = plan.accessionIds.map((accessionId) => {
    const previous = plan.accessionSnapshots.find(
      (snapshot) => snapshot.accessionId === accessionId,
    );
    const accession = state.accessions.find((item) => item.id === accessionId);
    const bench = state.benches.find((item) =>
      item.assignedIds.includes(accessionId),
    );
    return {
      accessionId,
      accessionNo: accession?.accessionNo ?? previous?.accessionNo ?? "已删除",
      cultivar: accession?.cultivar ?? previous?.cultivar ?? "未知材料",
      benchId: bench?.id ?? null,
      benchCode: bench?.code ?? null,
      trialState: currentTrial?.state ?? previous?.trialState ?? "draft",
    };
  });
  return {
    ...plan,
    accessionSnapshots: snapshots,
    confirmedOn: new Date().toISOString(),
  };
}

/**
 * 重新确认计划：基于当前登记数据重建快照，清除漂移状态。
 */
export function reconfirmObservationPlan(
  plan: ObservationPlan,
  state: WorkspaceState,
): Result<ObservationPlan> {
  if (plan.status === "completed" || plan.linkedObservationPassId) {
    return fail([
      fieldError("status", "completed", "已完成的计划不能重新确认"),
    ]);
  }
  const refreshed = refreshPlanBaseline(plan, state);
  return ok({ ...refreshed, status: "pending" });
}

/**
 * 比较计划快照与当前登记数据，列出需要工作人员重新确认的变化：
 * 材料移到其他台架、试验暂停（或状态变化）、材料编号改变、材料缺失。
 */
export function detectPlanDrift(
  plan: ObservationPlan,
  state: WorkspaceState,
): PlanDrift[] {
  const drifts: PlanDrift[] = [];
  const trial = state.trials.find((item) => item.id === plan.trialId);
  if (trial) {
    if (trial.state === "paused") {
      drifts.push({
        code: "TRIAL_PAUSED",
        message: `试验 ${trial.code} 已暂停，观测安排需要重新确认`,
      });
    } else if (
      plan.accessionSnapshots.some(
        (snapshot) => snapshot.trialState !== trial.state,
      )
    ) {
      drifts.push({
        code: "TRIAL_STATE_CHANGED",
        message: `试验 ${trial.code} 状态已从建立计划时发生变化`,
      });
    }
  }
  plan.accessionSnapshots.forEach((snapshot) => {
    const accession = state.accessions.find(
      (item) => item.id === snapshot.accessionId,
    );
    if (!accession) {
      drifts.push({
        code: "ACCESSIONS_MISSING",
        accessionId: snapshot.accessionId,
        message: `材料 ${snapshot.accessionNo} 已不在登记清单中，需要重新确认范围`,
      });
      return;
    }
    if (accession.accessionNo !== snapshot.accessionNo) {
      drifts.push({
        code: "ACCESSION_NO_CHANGED",
        accessionId: accession.id,
        message: `${snapshot.cultivar} 的材料编号已由 ${snapshot.accessionNo} 变为 ${accession.accessionNo}`,
      });
    }
    const bench = state.benches.find((item) =>
      item.assignedIds.includes(accession.id),
    );
    const currentBenchId = bench?.id ?? null;
    if (snapshot.benchId !== null && currentBenchId !== snapshot.benchId) {
      drifts.push({
        code: "BENCH_MOVED",
        accessionId: accession.id,
        message: `${accession.accessionNo} 已从台架 ${snapshot.benchCode ?? "未知"} 移到 ${
          bench?.code ?? "其他位置"
        }`,
      });
    } else if (snapshot.benchId === null && currentBenchId !== null) {
      drifts.push({
        code: "BENCH_MOVED",
        accessionId: accession.id,
        message: `${accession.accessionNo} 已从计划时的未分配状态移到台架 ${bench?.code ?? ""}`,
      });
    }
  });
  return drifts;
}

export function isPlanStale(plan: ObservationPlan, state: WorkspaceState): boolean {
  if (plan.status === "completed" || plan.linkedObservationPassId) {
    return false;
  }
  return detectPlanDrift(plan, state).length > 0;
}

/**
 * 到期状态：到期前（临近 / 未到期）、到期当天、逾期、已完成。
 */
export function planScheduleStatus(
  plan: ObservationPlan,
  today: string = todayDateOnly(),
): PlanScheduleStatus {
  if (plan.status === "completed" || plan.linkedObservationPassId) {
    return "completed";
  }
  const scheduled = parseDateOnly(plan.scheduledOn);
  const todayDate = parseDateOnly(today);
  if (!scheduled || !todayDate) {
    return "upcoming";
  }
  const dayMs = 86_400_000;
  const diffDays = Math.round(
    (scheduled.getTime() - todayDate.getTime()) / dayMs,
  );
  if (diffDays < 0) {
    return "overdue";
  }
  if (diffDays === 0) {
    return "due-today";
  }
  if (diffDays <= DUE_SOON_WINDOW_DAYS) {
    return "due-soon";
  }
  return "upcoming";
}

export const PLAN_SCHEDULE_LABELS: Record<PlanScheduleStatus, string> = {
  upcoming: "未到期",
  "due-soon": "临近到期",
  "due-today": "今天到期",
  overdue: "已逾期",
  completed: "已完成",
};

export function planFollowUpStatus(
  plan: ObservationPlan,
  state: WorkspaceState,
): PlanFollowUpStatus {
  if (plan.status === "completed" || plan.linkedObservationPassId) {
    return "completed";
  }
  return isPlanStale(plan, state) ? "stale" : "pending";
}

/** 计划能否进入完成流程：未完成且没有未处理的漂移。 */
export function canCompletePlan(
  plan: ObservationPlan,
  state: WorkspaceState,
): boolean {
  if (plan.status === "completed" || plan.linkedObservationPassId) {
    return false;
  }
  return detectPlanDrift(plan, state).length === 0;
}

/**
 * 用一条真实观测记录完成计划。校验通过后只在计划侧写入关联，不会修改已经
 * 保存的观测记录。重复完成同一计划不会产生第二份关联或观测。
 */
export function completePlanWithPass(
  plan: ObservationPlan,
  pass: ObservationPass,
  state: WorkspaceState,
): Result<ObservationPlan> {
  if (plan.status === "completed" || plan.linkedObservationPassId) {
    return fail([
      fieldError("status", "already_completed", "该计划已经完成，不能重复完成"),
    ]);
  }
  if (pass.trialId !== plan.trialId) {
    return fail([
      fieldError("passId", "trial_mismatch", "观测记录不属于计划所在的试验"),
    ]);
  }
  const scopedIds = new Set(plan.accessionIds);
  const coversScope = pass.entries.some((entry) =>
    scopedIds.has(entry.accessionId),
  );
  if (!coversScope) {
    return fail([
      fieldError(
        "passId",
        "out_of_scope",
        "观测记录没有覆盖计划范围内的任何材料",
      ),
    ]);
  }
  if (detectPlanDrift(plan, state).length > 0) {
    return fail([
      fieldError(
        "status",
        "stale",
        "计划材料或试验已发生变化，请先重新确认再完成",
      ),
    ]);
  }
  return ok({
    ...plan,
    status: "completed",
    linkedObservationPassId: pass.id,
    completedOn: new Date().toISOString(),
    completedBy: pass.observer,
  });
}

/**
 * 把一条已经存在的观测记录补关联到计划（历史跟进）。同样只写计划侧，
 * 且关联过的计划不能重复关联。
 */
export function linkPlanToPass(
  plan: ObservationPlan,
  pass: ObservationPass,
): Result<ObservationPlan> {
  if (plan.status === "completed" || plan.linkedObservationPassId) {
    return fail([
      fieldError("status", "already_completed", "该计划已经关联观测记录"),
    ]);
  }
  if (pass.trialId !== plan.trialId) {
    return fail([
      fieldError("passId", "trial_mismatch", "观测记录不属于计划所在的试验"),
    ]);
  }
  const scopedIds = new Set(plan.accessionIds);
  if (!pass.entries.some((entry) => scopedIds.has(entry.accessionId))) {
    return fail([
      fieldError(
        "passId",
        "out_of_scope",
        "观测记录没有覆盖计划范围内的任何材料",
      ),
    ]);
  }
  return ok({
    ...plan,
    status: "completed",
    linkedObservationPassId: pass.id,
    completedOn: new Date().toISOString(),
    completedBy: pass.observer,
  });
}
