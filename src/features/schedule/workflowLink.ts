import type { ScheduleItemKind } from "../../domain/schedule";
import type { TrialSchedule } from "../../domain/schedule";
import type { TrialState } from "../../domain/types";

/** 节奏/观测类节点回到观测工作流，关闭节点回到放行工作流。 */
export function workflowPathForItemKind(kind: ScheduleItemKind): string {
  switch (kind) {
    case "observation":
    case "observation-due":
    case "observation-overdue":
    case "observation-gap":
      return "/observations";
    case "closure":
      return "/clearance";
    case "trial-start":
    case "trial-end":
      return "/clearance";
  }
}

/** 试验条按当前生命周期状态回到最相关的工作流。 */
export function workflowPathForTrialState(state: TrialState): string {
  switch (state) {
    case "draft":
    case "cleared":
      return "/clearance";
    case "active":
    case "paused":
      return "/observations";
  }
}

export function trialWorkflowPath(
  schedules: TrialSchedule[],
  trialId: string,
): string {
  const schedule = schedules.find((item) => item.trial.id === trialId);
  const base = schedule
    ? workflowPathForTrialState(schedule.trial.state)
    : "/clearance";
  return `${base}?trial=${encodeURIComponent(trialId)}`;
}

export function itemWorkflowPath(
  kind: ScheduleItemKind,
  trialId: string,
): string {
  return `${workflowPathForItemKind(kind)}?trial=${encodeURIComponent(trialId)}`;
}
