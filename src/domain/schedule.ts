import type {
  ClearanceSnapshot,
  ObservationPass,
  Trial,
  TrialState,
  WorkspaceState,
} from "./types";
import { parseDateOnly, todayDateOnly } from "./rules";
import { latestSnapshotForTrial } from "../state/selectors";

/** 期望观测节奏：活跃试验每 14 天至少观测一次。 */
export const OBSERVATION_CADENCE_DAYS = 14;
/** 到期日前后多少天内算作“即将到期”。 */
export const OBSERVATION_DUE_WINDOW_DAYS = 3;

export const DAY_MS = 86_400_000;

export type ScheduleItemKind =
  | "trial-start"
  | "trial-end"
  | "observation"
  | "observation-due"
  | "observation-overdue"
  | "observation-gap"
  | "closure";

export type ScheduleStatus =
  | "on-track"
  | "upcoming"
  | "due-soon"
  | "overdue"
  | "gap"
  | "closed"
  | "idle";

export interface ScheduleItem {
  kind: ScheduleItemKind;
  trialId: string;
  date: string;
  endDate?: string;
  label: string;
  detail: string;
  status: ScheduleStatus;
  /** 观测项指向具体观测批次；冲突项指向放行快照。 */
  observationPassId?: string;
  snapshotId?: string;
}

export interface TrialSchedule {
  trial: Trial;
  startDate: string;
  endDate: string;
  sameDay: boolean;
  phase: "finished" | "active" | "upcoming";
  observationDates: string[];
  items: ScheduleItem[];
  conflicts: ScheduleConflict[];
  expectedNextDue?: string;
}

export interface ScheduleConflict {
  code: ScheduleConflictCode;
  message: string;
  date?: string;
  snapshotId?: string;
}

export type ScheduleConflictCode =
  | "CLEARED_BEFORE_END"
  | "CLEARED_WITH_OBSERVATION_AFTER"
  | "PAUSED_PAST_END"
  | "UNCLOSED_PAST_END"
  | "OBSERVATION_OUTSIDE_WINDOW";

export interface ScheduleFilters {
  season: string;
  state: TrialState | "all";
  from?: string;
  to?: string;
}

export interface ScheduleSummary {
  trials: number;
  observations: number;
  dueSoon: number;
  overdue: number;
  closures: number;
  conflicts: number;
}

// ---------------------------------------------------------------------------
// 日期工具（全部基于 YYYY-MM-DD，避免时区漂移，保证确定性）
// ---------------------------------------------------------------------------

export function addDays(value: string, days: number): string {
  const date = parseDateOnly(value);
  if (!date) {
    return value;
  }
  const next = new Date(date.getTime() + days * DAY_MS);
  return formatDate(next);
}

export function formatDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function compareDate(left: string, right: string): number {
  return left.localeCompare(right);
}

export function clampRange(rangeStart: string, rangeEnd: string, from?: string, to?: string) {
  return {
    start: from && compareDate(from, rangeStart) > 0 ? from : rangeStart,
    end: to && compareDate(to, rangeEnd) < 0 ? to : rangeEnd,
  };
}

export function rangeOverlaps(
  start: string,
  end: string,
  from?: string,
  to?: string,
): boolean {
  if (from && compareDate(end, from) < 0) {
    return false;
  }
  if (to && compareDate(start, to) > 0) {
    return false;
  }
  return true;
}

export function pointInRange(date: string, from?: string, to?: string): boolean {
  if (from && compareDate(date, from) < 0) {
    return false;
  }
  if (to && compareDate(date, to) > 0) {
    return false;
  }
  return true;
}

export function describeTrialStateLabel(state: TrialState): string {
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

// ---------------------------------------------------------------------------
// 单试验日程
// ---------------------------------------------------------------------------

interface TrialInputs {
  trial: Trial;
  passes: ObservationPass[];
  clearedSnapshot?: ClearanceSnapshot;
  today: string;
}

export function buildTrialSchedule({
  trial,
  passes,
  clearedSnapshot,
  today,
}: TrialInputs): TrialSchedule {
  const startDate = trial.startDate;
  const endDate = trial.endDate;
  const sameDay = startDate === endDate;

  const phase: TrialSchedule["phase"] =
    compareDate(endDate, today) < 0
      ? "finished"
      : compareDate(startDate, today) > 0
        ? "upcoming"
        : "active";

  const observationDates = Array.from(
    new Set(passes.map((pass) => pass.observedOn)),
  ).sort(compareDate);

  const items: ScheduleItem[] = [];
  const conflicts: ScheduleConflict[] = [];

  // 试验区间起止
  items.push({
    kind: "trial-start",
    trialId: trial.id,
    date: startDate,
    endDate,
    label: sameDay ? `${trial.code} 单日试验` : `${trial.code} 开始`,
    detail: sameDay
      ? `${trial.cropFamily} · ${trial.season} · 开始与结束同日`
      : `${trial.cropFamily} · ${trial.season} · 区间开始`,
    status: "upcoming",
  });

  if (!sameDay) {
    items.push({
      kind: "trial-end",
      trialId: trial.id,
      date: endDate,
      label: `${trial.code} 结束`,
      detail: `${trial.cropFamily} · 计划区间结束`,
      status: phase === "finished" ? "closed" : "upcoming",
    });
  }

  // 已有观测
  observationDates.forEach((date) => {
    const outside =
      compareDate(date, startDate) < 0 || compareDate(date, endDate) > 0;
    if (outside) {
      conflicts.push({
        code: "OBSERVATION_OUTSIDE_WINDOW",
        message: `观测日期 ${date} 落在试验区间 ${startDate} 至 ${endDate} 之外`,
        date,
      });
    }
    items.push({
      kind: "observation",
      trialId: trial.id,
      date,
      label: `${trial.code} 观测`,
      detail: outside
        ? "观测记录落在试验区间之外"
        : `${passes.filter((pass) => pass.observedOn === date).length} 个观测批次`,
      status: outside ? "gap" : "on-track",
      observationPassId: passes.find((pass) => pass.observedOn === date)?.id,
    });
  });

  // 观测节奏：从首个观测起按固定间隔推算期望节点
  const expectedNextDue = buildCadenceItems({
    trial,
    observationDates,
    today,
    items,
  });

  // 关闭节点（已放行试验）与状态排期冲突
  if (trial.state === "cleared") {
    buildClosureItems({
      trial,
      observationDates,
      clearedSnapshot,
      items,
      conflicts,
    });
  } else if (phase === "finished") {
    conflicts.push({
      code: trial.state === "paused" ? "PAUSED_PAST_END" : "UNCLOSED_PAST_END",
      message:
        trial.state === "paused"
          ? `试验已过结束日 ${endDate}，但仍处于已暂停状态，缺少关闭节点`
          : `试验已于 ${endDate} 结束，但尚未放行关闭`,
      date: endDate,
    });
  }

  items.sort((left, right) => {
    const byDate = compareDate(left.date, right.date);
    if (byDate !== 0) {
      return byDate;
    }
    return left.kind.localeCompare(right.kind);
  });

  return {
    trial,
    startDate,
    endDate,
    sameDay,
    phase,
    observationDates,
    items,
    conflicts,
    expectedNextDue,
  };
}

interface CadenceInputs {
  trial: Trial;
  observationDates: string[];
  today: string;
  items: ScheduleItem[];
}

/**
 * 根据已有观测按固定间隔推算节奏节点：
 * - 锚点为“最近一次观测”，新增观测会把节奏整体后移，因此不会再对已补齐的
 *   历史节奏点报逾期；
 * - 最近一次观测推算出的期望点已错过 → 逾期；落在窗口内 → 即将到期；
 *   仍在未来 → 计划点；
 * - 无观测：区间开始后超过一个宽限间隔仍无观测，标记节奏缺失。
 * 草稿/未开始试验不产生催办。返回下一个期望观测日（供卡片展示）。
 */
function buildCadenceItems({
  trial,
  observationDates,
  today,
  items,
}: CadenceInputs): string | undefined {
  if (trial.state === "draft") {
    return undefined;
  }

  // 尚未开始：仅给出第一个期望点，不产生催办
  if (compareDate(trial.startDate, today) > 0) {
    return addDays(trial.startDate, OBSERVATION_CADENCE_DAYS);
  }

  if (observationDates.length === 0) {
    const firstDue = addDays(trial.startDate, OBSERVATION_CADENCE_DAYS);
    if (compareDate(firstDue, today) <= 0) {
      items.push({
        kind: "observation-gap",
        trialId: trial.id,
        date: firstDue,
        label: `${trial.code} 缺少观测`,
        detail: `试验已开始，但区间内还没有任何观测记录（期望每 ${OBSERVATION_CADENCE_DAYS} 天一次）`,
        status: "gap",
      });
    }
    return firstDue;
  }

  // 以最近一次观测为锚点，顺序推算区间内剩余的期望点
  const latest = observationDates[observationDates.length - 1];
  let due = addDays(latest, OBSERVATION_CADENCE_DAYS);
  let nextDue: string | undefined;

  while (compareDate(due, trial.endDate) <= 0) {
    if (nextDue === undefined) {
      nextDue = due;
    }
    const daysUntilDue = daysBetween(today, due);
    if (daysUntilDue < -OBSERVATION_DUE_WINDOW_DAYS) {
      items.push({
        kind: "observation-overdue",
        trialId: trial.id,
        date: due,
        label: `${trial.code} 观测逾期`,
        detail: `距上次观测（${latest}）已超过 ${OBSERVATION_CADENCE_DAYS} 天，期望观测日 ${due}`,
        status: "overdue",
      });
    } else if (daysUntilDue <= OBSERVATION_DUE_WINDOW_DAYS) {
      items.push({
        kind: "observation-due",
        trialId: trial.id,
        date: due,
        label: `${trial.code} 观测到期`,
        detail: `期望观测日 ${due}，请安排观测节奏`,
        status: "due-soon",
      });
    } else {
      items.push({
        kind: "observation-due",
        trialId: trial.id,
        date: due,
        label: `${trial.code} 观测计划`,
        detail: `下一轮期望观测日 ${due}`,
        status: "upcoming",
      });
    }
    due = addDays(due, OBSERVATION_CADENCE_DAYS);
  }

  return nextDue;
}

interface ClosureInputs {
  trial: Trial;
  observationDates: string[];
  clearedSnapshot?: ClearanceSnapshot;
  items: ScheduleItem[];
  conflicts: ScheduleConflict[];
}

function buildClosureItems({
  trial,
  observationDates,
  clearedSnapshot,
  items,
  conflicts,
}: ClosureInputs): void {
  // 关闭节点取“放行快照生成日”和“区间结束日”中较早可确定的那一个：
  // 有快照用快照日（真实关闭动作），否则回退到区间结束日。
  const snapshotDate = clearedSnapshot
    ? clearedSnapshot.generatedOn.slice(0, 10)
    : undefined;
  const closureDate = snapshotDate ?? trial.endDate;

  items.push({
    kind: "closure",
    trialId: trial.id,
    date: closureDate,
    label: `${trial.code} 关闭`,
    detail: clearedSnapshot
      ? `已放行快照 ${clearedSnapshot.id.slice(0, 12)} · 试验关闭`
      : "区间结束，等待放行快照",
    status: "closed",
    snapshotId: clearedSnapshot?.id,
  });

  if (snapshotDate) {
    if (compareDate(snapshotDate, trial.endDate) < 0) {
      conflicts.push({
        code: "CLEARED_BEFORE_END",
        message: `试验在区间结束日 ${trial.endDate} 之前（${snapshotDate}）已放行关闭`,
        date: snapshotDate,
        snapshotId: clearedSnapshot?.id,
      });
    }
    const lateObservation = observationDates.find(
      (date) => compareDate(date, snapshotDate) > 0,
    );
    if (lateObservation) {
      conflicts.push({
        code: "CLEARED_WITH_OBSERVATION_AFTER",
        message: `关闭后（${snapshotDate}）仍出现 ${lateObservation} 的观测记录，关闭节点与观测排期冲突`,
        date: lateObservation,
        snapshotId: clearedSnapshot?.id,
      });
    }
  }
}

function daysBetween(from: string, to: string): number {
  const left = parseDateOnly(from);
  const right = parseDateOnly(to);
  if (!left || !right) {
    return 0;
  }
  return Math.round((right.getTime() - left.getTime()) / DAY_MS);
}

// ---------------------------------------------------------------------------
// 工作区聚合（纯函数，相同输入必得相同输出）
// ---------------------------------------------------------------------------

export interface WorkspaceSchedule {
  trials: TrialSchedule[];
  items: ScheduleItem[];
  summary: ScheduleSummary;
  rangeStart: string;
  rangeEnd: string;
}

export function buildWorkspaceSchedule(
  state: WorkspaceState,
  today: string = todayDateOnly(),
): WorkspaceSchedule {
  const trials = state.trials.map((trial) => {
    const passes = state.observationPasses.filter(
      (pass) => pass.trialId === trial.id,
    );
    const clearedSnapshot =
      trial.state === "cleared"
        ? latestReadySnapshot(state, trial.id)
        : undefined;
    return buildTrialSchedule({ trial, passes, clearedSnapshot, today });
  });

  trials.sort(
    (left, right) =>
      compareDate(left.startDate, right.startDate) ||
      left.trial.code.localeCompare(right.trial.code),
  );

  const items = trials.flatMap((schedule) => schedule.items);
  items.sort((left, right) => {
    const byDate = compareDate(left.date, right.date);
    if (byDate !== 0) {
      return byDate;
    }
    return left.kind.localeCompare(right.kind);
  });

  const summary: ScheduleSummary = {
    trials: trials.length,
    observations: items.filter((item) => item.kind === "observation").length,
    dueSoon: items.filter((item) => item.status === "due-soon").length,
    overdue: items.filter((item) => item.status === "overdue").length,
    closures: items.filter((item) => item.kind === "closure").length,
    conflicts: trials.reduce(
      (count, schedule) => count + schedule.conflicts.length,
      0,
    ),
  };

  const allDates = items.map((item) => item.date);
  const rangeStart = allDates.length
    ? allDates.reduce((min, date) => (compareDate(date, min) < 0 ? date : min))
    : today;
  const rangeEnd = allDates.length
    ? allDates.reduce((max, date) => (compareDate(date, max) > 0 ? date : max))
    : today;

  return { trials, items, summary, rangeStart, rangeEnd };
}

function latestReadySnapshot(
  state: WorkspaceState,
  trialId: string,
): ClearanceSnapshot | undefined {
  const latest = latestSnapshotForTrial(state, trialId);
  return latest?.status === "ready" ? latest : undefined;
}

// ---------------------------------------------------------------------------
// 筛选
// ---------------------------------------------------------------------------

export function filterTrialSchedules(
  schedules: TrialSchedule[],
  filters: ScheduleFilters,
): TrialSchedule[] {
  return schedules.filter((schedule) => {
    if (filters.season !== "all" && schedule.trial.season !== filters.season) {
      return false;
    }
    if (filters.state !== "all" && schedule.trial.state !== filters.state) {
      return false;
    }
    if (!rangeOverlaps(schedule.startDate, schedule.endDate, filters.from, filters.to)) {
      return false;
    }
    return true;
  });
}

export function filterScheduleItems(
  items: ScheduleItem[],
  filters: ScheduleFilters,
): ScheduleItem[] {
  return items.filter((item) => {
    if (filters.from && compareDate(item.date, filters.from) < 0) {
      return false;
    }
    if (filters.to && compareDate(item.date, filters.to) > 0) {
      return false;
    }
    return true;
  });
}

/** 冲突按试验聚合，供时间轴/月历高亮。 */
export function conflictDates(schedule: TrialSchedule): Set<string> {
  return new Set(
    schedule.conflicts
      .map((conflict) => conflict.date)
      .filter((date): date is string => Boolean(date)),
  );
}
