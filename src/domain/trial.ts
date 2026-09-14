import type { Trial, TrialState, WorkspaceState } from "./types";
import { createId } from "./id";
import { parseDateOnly, todayDateOnly, TRIAL_SEASONS } from "./rules";
import { fail, fieldError, ok, type Result } from "./result";

export interface TrialDraft {
  code: string;
  cropFamily: string;
  objective: string;
  season: string;
  startDate: string;
  endDate: string;
}

export interface TrialTransition {
  from: TrialState;
  to: TrialState;
  allowed: boolean;
  message?: string;
}

const transitionMap: Record<TrialState, TrialState[]> = {
  draft: ["active"],
  active: ["paused", "cleared"],
  paused: ["active"],
  cleared: [],
};

export function canTransitionTrial(from: TrialState, to: TrialState): boolean {
  return transitionMap[from]?.includes(to) ?? false;
}

export function transitionTrial(
  trial: Trial,
  to: TrialState,
): Result<Trial> {
  if (trial.state === to) {
    return fail([
      fieldError("state", "unchanged", "试验已经处于该状态"),
    ]);
  }
  if (!canTransitionTrial(trial.state, to)) {
    return fail([
      fieldError(
        "state",
        "invalid_transition",
        `试验不能从 ${trial.state} 变更到 ${to}`,
      ),
    ]);
  }
  return ok({ ...trial, state: to });
}

export function validateTrialDraft(
  draft: TrialDraft,
  state?: WorkspaceState,
  currentId?: string,
): Result<TrialDraft> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  const code = draft.code.trim().toUpperCase();
  if (!/^[A-Z]{2,4}-\d{2,4}$/.test(code)) {
    errors.push(
      fieldError("code", "invalid_code", "请使用类似 AUR-04 或 TM-12 的编号"),
    );
  } else if (
    state?.trials.some((trial) => trial.code === code && trial.id !== currentId)
  ) {
    errors.push(
      fieldError("code", "duplicate", "该试验编号已被使用"),
    );
  }
  if (draft.cropFamily.trim().length < 3) {
    errors.push(
      fieldError("cropFamily", "required", "请填写作物科属"),
    );
  }
  if (draft.objective.trim().length < 12) {
    errors.push(
      fieldError(
        "objective",
        "too_short",
        "请用至少 12 个字符描述试验目标",
      ),
    );
  }
  if (!TRIAL_SEASONS.includes(draft.season)) {
    errors.push(fieldError("season", "required", "请选择季节"));
  }
  const start = parseDateOnly(draft.startDate);
  const end = parseDateOnly(draft.endDate);
  if (!start) {
    errors.push(
      fieldError("startDate", "invalid_date", "开始日期无效"),
    );
  }
  if (!end) {
    errors.push(fieldError("endDate", "invalid_date", "结束日期无效"));
  }
  if (start && end && start.getTime() > end.getTime()) {
    errors.push(
      fieldError(
        "endDate",
        "date_sequence",
        "结束日期不能早于开始日期",
      ),
    );
  }
  if (errors.length > 0) {
    return fail(errors);
  }
  return ok({
    ...draft,
    code,
    cropFamily: draft.cropFamily.trim(),
    objective: draft.objective.trim(),
  });
}

export function createTrial(
  draft: TrialDraft,
  state: WorkspaceState,
): Result<Trial> {
  const validated = validateTrialDraft(draft, state);
  if (!validated.ok) {
    return validated;
  }
  const value = validated.value;
  return ok({
    id: createId("trl"),
    code: value.code,
    cropFamily: value.cropFamily,
    objective: value.objective,
    season: value.season,
    startDate: value.startDate,
    endDate: value.endDate,
    state: "draft",
  });
}

export function updateTrial(
  current: Trial,
  draft: TrialDraft,
  state: WorkspaceState,
): Result<Trial> {
  if (current.state === "cleared") {
    return fail([
      fieldError("state", "sealed", "已放行的试验已封存，不能再编辑"),
    ]);
  }
  const validated = validateTrialDraft(draft, state, current.id);
  if (!validated.ok) {
    return validated;
  }
  const value = validated.value;
  return ok({
    ...current,
    code: value.code,
    cropFamily: value.cropFamily,
    objective: value.objective,
    season: value.season,
    startDate: value.startDate,
    endDate: value.endDate,
  });
}

export function trialMatchesQuery(trial: Trial, query: string): boolean {
  const haystack = [trial.code, trial.cropFamily, trial.objective, trial.season]
    .join(" ")
    .toLowerCase();
  return !query.trim() || haystack.includes(query.trim().toLowerCase());
}

export function trialDaysRemaining(trial: Trial): number {
  const end = parseDateOnly(trial.endDate);
  if (!end) {
    return 0;
  }
  const today = parseDateOnly(todayDateOnly());
  if (!today) {
    return 0;
  }
  return Math.max(0, Math.ceil((end.getTime() - today.getTime()) / 86400000));
}

export function describeTrialState(state: TrialState): string {
  return state.charAt(0).toUpperCase() + state.slice(1);
}

export function trialStateLabel(state: TrialState): string {
  switch (state) {
    case "draft":
      return "草稿";
    case "active":
      return "进行中";
    case "paused":
      return "已暂停";
    case "cleared":
      return "已放行";
  }
}

export function trialTransitionLabel(from: TrialState, to: TrialState): string {
  if (to === "active") {
    return from === "paused" ? "恢复" : "启动";
  }
  if (to === "paused") {
    return "暂停";
  }
  if (to === "cleared") {
    return "放行";
  }
  return describeTrialState(to);
}

export function getTrialTransition(trial: Trial): TrialTransition[] {
  const allowed = transitionMap[trial.state] ?? [];
  return allowed.map((to) => ({ from: trial.state, to, allowed: true }));
}

export function getLifecycleTransitions(trial: Trial): TrialTransition[] {
  // 放行只能由放行流程触发，试验管理只暴露启动、暂停和恢复。
  return getTrialTransition(trial).filter(
    (transition) => transition.to !== "cleared",
  );
}
