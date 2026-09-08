import type { Trial, TrialState } from "./types";
import { createId } from "./id";
import { parseDateOnly, todayDateOnly } from "./rules";
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

export function validateTrialDraft(draft: TrialDraft): Result<TrialDraft> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  if (!draft.code.trim() || !/^[A-Z]{2,4}-\d{2,4}$/.test(draft.code.trim())) {
    errors.push(
      fieldError("code", "invalid_code", "请使用类似 AUR-04 或 TM-12 的编号"),
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
  if (!draft.season) {
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
    code: draft.code.trim().toUpperCase(),
    cropFamily: draft.cropFamily.trim(),
    objective: draft.objective.trim(),
  });
}

export function createTrial(draft: TrialDraft): Result<Trial> {
  const validated = validateTrialDraft(draft);
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

export function getTrialTransition(trial: Trial): TrialTransition[] {
  const allowed = transitionMap[trial.state] ?? [];
  return allowed.map((to) => ({ from: trial.state, to, allowed: true }));
}
