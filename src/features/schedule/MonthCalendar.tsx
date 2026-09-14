import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type {
  ScheduleItem,
  TrialSchedule,
} from "../../domain/schedule";
import { compareDate } from "../../domain/schedule";
import { itemWorkflowPath } from "./workflowLink";

interface MonthCalendarProps {
  schedules: TrialSchedule[];
  items: ScheduleItem[];
  initialMonth: string;
  today: string;
}

const WEEKDAYS = ["一", "二", "三", "四", "五", "六", "日"];

function monthKeyOf(date: string): string {
  return date.slice(0, 7);
}

function shiftMonth(monthKey: string, delta: number): string {
  const [year, month] = monthKey.split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function MonthCalendar({
  schedules,
  items,
  initialMonth,
  today,
}: MonthCalendarProps) {
  const navigate = useNavigate();
  const [monthKey, setMonthKey] = useState(monthKeyOf(initialMonth));

  // 外部日期范围筛选变化时，跟随到筛选窗口起始月（用户手动翻月不被覆盖）
  useEffect(() => {
    const next = monthKeyOf(initialMonth);
    setMonthKey((current) => (current === next ? current : next));
  }, [initialMonth]);

  const weeks = useMemo(() => buildWeeks(monthKey), [monthKey]);

  const itemsByDate = useMemo(() => {
    const map = new Map<string, ScheduleItem[]>();
    items
      .filter((item) => monthKeyOf(item.date) === monthKey)
      .forEach((item) => {
        const list = map.get(item.date) ?? [];
        list.push(item);
        map.set(item.date, list);
      });
    return map;
  }, [items, monthKey]);

  const activeTrials = useMemo(
    () =>
      schedules.filter((schedule) =>
        monthOverlapsTrial(monthKey, schedule.startDate, schedule.endDate),
      ),
    [schedules, monthKey],
  );

  if (schedules.length === 0) {
    return (
      <p className="muted-copy schedule-empty-copy">
        当前筛选条件下没有可显示的试验区间。
      </p>
    );
  }

  return (
    <div className="month-calendar" data-testid="schedule-month-calendar">
      <div className="month-calendar-header">
        <button
          type="button"
          className="month-nav-button"
          onClick={() => setMonthKey(shiftMonth(monthKey, -1))}
          aria-label="上个月"
          data-testid="month-prev"
        >
          <ChevronLeft size={17} />
        </button>
        <strong data-testid="month-title">
          {monthKey.replace("-", " 年 ")} 月
        </strong>
        <button
          type="button"
          className="month-nav-button"
          onClick={() => setMonthKey(shiftMonth(monthKey, 1))}
          aria-label="下个月"
          data-testid="month-next"
        >
          <ChevronRight size={17} />
        </button>
        <button
          type="button"
          className="month-today-button"
          onClick={() => setMonthKey(monthKeyOf(today))}
        >
          回到今天
        </button>
      </div>
      <div className="month-weekday-row">
        {WEEKDAYS.map((day) => (
          <span key={day} className="month-weekday">
            {day}
          </span>
        ))}
      </div>
      <div className="month-grid">
        {weeks.map((week, weekIndex) => (
          <div className="month-week" key={weekIndex}>
            {week.map((date) => {
              const inMonth = monthKeyOf(date) === monthKey;
              const dayItems = itemsByDate.get(date) ?? [];
              const isToday = date === today;
              const dayTrials = activeTrials.filter((schedule) =>
                withinTrial(date, schedule),
              );
              return (
                <div
                  key={date}
                  className={`month-day ${inMonth ? "" : "month-day-out"} ${
                    isToday ? "month-day-today" : ""
                  }`}
                  data-testid={`month-day-${date}`}
                >
                  <span className="month-day-number">
                    {Number(date.slice(8))}
                  </span>
                  <div className="month-day-bars">
                    {dayTrials.map((schedule) => (
                      <span
                        key={schedule.trial.id}
                        className={`month-trial-bar month-trial-bar-${schedule.trial.state}`}
                        title={`${schedule.trial.code} · ${schedule.startDate} 至 ${schedule.endDate}`}
                      />
                    ))}
                  </div>
                  <div className="month-day-events">
                    {dayItems.slice(0, 3).map((item) => (
                      <button
                        type="button"
                        key={`${item.kind}-${item.trialId}`}
                        className={`month-event month-event-${item.kind} month-event-${item.status}`}
                        onClick={() =>
                          navigate(
                            itemWorkflowPath(item.kind, item.trialId),
                          )
                        }
                        title={`${item.label} · ${item.detail}`}
                        data-testid={`month-event-${item.trialId}-${item.kind}`}
                      >
                        {shortLabel(item.label)}
                      </button>
                    ))}
                    {dayItems.length > 3 ? (
                      <span className="month-event-more">
                        +{dayItems.length - 3}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

function shortLabel(label: string): string {
  return label.replace(/^(SOL|AMA|BRA|[A-Z]{2,4})-\d+\s*/, "").trim() || label;
}

function withinTrial(date: string, schedule: TrialSchedule): boolean {
  return (
    compareDate(date, schedule.startDate) >= 0 &&
    compareDate(date, schedule.endDate) <= 0
  );
}

function monthOverlapsTrial(
  monthKey: string,
  startDate: string,
  endDate: string,
): boolean {
  return monthKeyOf(startDate) <= monthKey && monthKeyOf(endDate) >= monthKey;
}

function buildWeeks(monthKey: string): string[][] {
  const [year, month] = monthKey.split("-").map(Number);
  const first = new Date(year, month - 1, 1);
  // getDay: 0=周日 … 6=周六；周一为一周起点
  const leadingBlanks = (first.getDay() + 6) % 7;
  const gridStart = new Date(year, month - 1, 1 - leadingBlanks);
  const weeks: string[][] = [];
  for (let week = 0; week < 6; week += 1) {
    const row: string[] = [];
    for (let day = 0; day < 7; day += 1) {
      const date = new Date(
        gridStart.getFullYear(),
        gridStart.getMonth(),
        gridStart.getDate() + week * 7 + day,
      );
      const m = String(date.getMonth() + 1).padStart(2, "0");
      const d = String(date.getDate()).padStart(2, "0");
      row.push(`${date.getFullYear()}-${m}-${d}`);
    }
    weeks.push(row);
  }
  // 若最后一周完全落在下个月，则裁掉
  if (weeks[5] && weeks[5].every((date) => monthKeyOf(date) !== monthKey)) {
    weeks.pop();
  }
  return weeks;
}
