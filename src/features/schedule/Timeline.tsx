import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  CircleDot,
  Flag,
  PlayCircle,
  Sprout,
} from "lucide-react";
import type {
  ScheduleItem,
  TrialSchedule,
} from "../../domain/schedule";
import {
  addDays,
  clampRange,
  compareDate,
  DAY_MS,
} from "../../domain/schedule";
import { parseDateOnly } from "../../domain/rules";
import { itemWorkflowPath, trialWorkflowPath } from "./workflowLink";

interface TimelineProps {
  schedules: TrialSchedule[];
  rangeStart: string;
  rangeEnd: string;
  today: string;
  from?: string;
  to?: string;
}

const ITEM_ICON: Record<ScheduleItem["kind"], typeof CircleDot> = {
  "trial-start": PlayCircle,
  "trial-end": CalendarClock,
  observation: CircleDot,
  "observation-due": CalendarClock,
  "observation-overdue": AlertTriangle,
  "observation-gap": AlertTriangle,
  closure: Flag,
};

function dayIndex(base: string, date: string): number {
  const baseDate = parseDateOnly(base);
  const current = parseDateOnly(date);
  if (!baseDate || !current) {
    return 0;
  }
  return Math.round((current.getTime() - baseDate.getTime()) / DAY_MS);
}

export function Timeline({
  schedules,
  rangeStart,
  rangeEnd,
  today,
  from,
  to,
}: TimelineProps) {
  const navigate = useNavigate();
  // 时间轴必须覆盖“筛选窗口”和“可见试验区间”的并集，否则区间条会超出坐标
  const span = clampRange(rangeStart, rangeEnd, from, to);
  const visibleBounds = schedules.reduce(
    (bounds, schedule) => ({
      start:
        compareDate(schedule.startDate, bounds.start) < 0
          ? schedule.startDate
          : bounds.start,
      end:
        compareDate(schedule.endDate, bounds.end) > 0
          ? schedule.endDate
          : bounds.end,
    }),
    { start: span.start, end: span.end },
  );
  const axisStart =
    from && compareDate(from, visibleBounds.start) < 0 ? from : visibleBounds.start;
  const axisEnd =
    to && compareDate(to, visibleBounds.end) > 0 ? to : visibleBounds.end;
  const totalDays = Math.max(
    1,
    dayIndex(axisStart, axisEnd) + 1,
  );

  // 月度刻度（跨月区间也能定位边界）
  const monthMarks = buildMonthMarks(axisStart, totalDays);

  const todayOffset = dayIndex(axisStart, today);
  const showToday = todayOffset >= 0 && todayOffset <= totalDays;

  const goToWorkflow = (trialId: string) => {
    navigate(trialWorkflowPath(schedules, trialId));
  };

  if (schedules.length === 0) {
    return (
      <p className="muted-copy schedule-empty-copy">
        当前筛选条件下没有可显示的试验区间。
      </p>
    );
  }

  return (
    <div className="timeline" data-testid="schedule-timeline">
      <div className="timeline-months" aria-hidden="true">
        {monthMarks.map((mark) => (
          <span
            key={mark.label}
            className="timeline-month-mark"
            style={{ left: `${(mark.offset / totalDays) * 100}%` }}
          >
            {mark.label}
          </span>
        ))}
      </div>
      {schedules.map((schedule) => {
        const barStart = dayIndex(axisStart, schedule.startDate);
        const barEnd = dayIndex(axisStart, schedule.endDate);
        // 裁剪到当前时间轴窗口（日期范围筛选可能只切到区间的一段）
        const clipStart = Math.max(0, barStart);
        const clipEnd = Math.min(totalDays - 1, barEnd);
        const left = (clipStart / totalDays) * 100;
        const width = Math.max(
          1.2,
          ((clipEnd - clipStart + 1) / totalDays) * 100,
        );
        return (
          <div className="timeline-row" key={schedule.trial.id}>
            <button
              type="button"
              className="timeline-row-label"
              onClick={() => goToWorkflow(schedule.trial.id)}
              title="跳转到对应工作流"
              data-testid={`timeline-label-${schedule.trial.id}`}
            >
              <strong>{schedule.trial.code}</strong>
              <span>{schedule.trial.cropFamily}</span>
            </button>
            <div className="timeline-track">
              {monthMarks.map((mark) => (
                <span
                  key={`${schedule.trial.id}-${mark.label}`}
                  className="timeline-gridline"
                  style={{ left: `${(mark.offset / totalDays) * 100}%` }}
                />
              ))}
              <button
                type="button"
                className={`timeline-bar timeline-bar-${schedule.trial.state} ${
                  schedule.phase === "finished" ? "timeline-bar-finished" : ""
                } ${schedule.sameDay ? "timeline-bar-same-day" : ""}`}
                style={{ left: `${left}%`, width: `${Math.max(width, 1.2)}%` }}
                onClick={() => goToWorkflow(schedule.trial.id)}
                title={`${schedule.trial.code} · ${schedule.startDate} 至 ${schedule.endDate}`}
                data-testid={`timeline-bar-${schedule.trial.id}`}
              >
                <span className="timeline-bar-text">
                  {schedule.sameDay
                    ? `${schedule.startDate}（单日）`
                    : `${schedule.startDate} → ${schedule.endDate}`}
                </span>
              </button>
              {schedule.items
                .filter((item) => markerKinds.has(item.kind))
                .map((item) => {
                  // 标记按整条时间轴定位：结束后关闭等节点可落在区间条之外
                  const axisOffset = dayIndex(axisStart, item.date);
                  const markerLeft = Math.min(
                    99.4,
                    Math.max(0.3, (axisOffset / totalDays) * 100),
                  );
                  const inWindow = axisOffset >= barStart && axisOffset <= barEnd;
                  const Icon = ITEM_ICON[item.kind];
                  return (
                    <button
                      type="button"
                      key={`${item.kind}-${item.date}`}
                      className={`timeline-marker timeline-marker-${item.kind} timeline-marker-${item.status} ${
                        inWindow ? "" : "timeline-marker-outside"
                      }`}
                      style={{ left: `${markerLeft}%` }}
                      title={`${item.label} · ${item.date} · ${item.detail}`}
                      onClick={() =>
                        navigate(itemWorkflowPath(item.kind, item.trialId))
                      }
                      aria-label={`${item.label} ${item.date}`}
                      data-testid={`timeline-marker-${schedule.trial.id}-${item.kind}-${item.date}`}
                    >
                      <Icon size={12} aria-hidden="true" />
                    </button>
                  );
                })}
            </div>
          </div>
        );
      })}
      {showToday ? (
        <div
          className="timeline-today"
          style={{
            left: `calc(182px + ${(todayOffset / totalDays) * 100}%)`,
          }}
          aria-label={`今天 ${today}`}
        >
          <span>今天</span>
        </div>
      ) : null}
      <div className="timeline-legend">
        <span className="timeline-legend-item">
          <Sprout size={13} /> 开始
        </span>
        <span className="timeline-legend-item">
          <CircleDot size={13} /> 观测
        </span>
        <span className="timeline-legend-item">
          <CalendarClock size={13} /> 到期
        </span>
        <span className="timeline-legend-item">
          <AlertTriangle size={13} /> 逾期/缺失
        </span>
        <span className="timeline-legend-item">
          <CheckCircle2 size={13} /> 关闭
        </span>
      </div>
      <p className="timeline-hint">
        点击试验条可跳回对应工作流；时间轴始终依据当前试验日期、状态与观测实时重算，不保存副本。
      </p>
    </div>
  );
}

const markerKinds = new Set<ScheduleItem["kind"]>([
  "observation",
  "observation-due",
  "observation-overdue",
  "observation-gap",
  "closure",
]);

function buildMonthMarks(axisStart: string, totalDays: number) {
  const marks: Array<{ label: string; offset: number }> = [];
  const start = parseDateOnly(axisStart);
  if (!start) {
    return marks;
  }
  let cursor = axisStart;
  for (let offset = 0; offset <= totalDays; offset += 1) {
    const date = parseDateOnly(cursor);
    if (date && date.getDate() === 1) {
      marks.push({
        label: `${date.getFullYear()}年${date.getMonth() + 1}月`,
        offset,
      });
    }
    cursor = addDays(cursor, 1);
  }
  if (marks.length === 0) {
    marks.push({ label: `${start.getFullYear()}年${start.getMonth() + 1}月`, offset: 0 });
  }
  return marks;
}
