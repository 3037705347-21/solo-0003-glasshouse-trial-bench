import { useMemo, useState } from "react";
import { CalendarRange, Plus } from "lucide-react";
import { Button } from "../../components/Button";
import { MetricCard } from "../../components/MetricCard";
import { PageHeader } from "../../components/PageHeader";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import {
  buildWorkspaceSchedule,
  filterScheduleItems,
  filterTrialSchedules,
  OBSERVATION_DUE_WINDOW_DAYS,
  type ScheduleFilters,
} from "../../domain/schedule";
import { TRIAL_SEASONS, todayDateOnly } from "../../domain/rules";
import type { Trial, TrialState } from "../../domain/types";
import { useWorkspace } from "../../state/store";
import { MonthCalendar } from "./MonthCalendar";
import { Timeline } from "./Timeline";
import { TrialFormDialog } from "./TrialFormDialog";
import { TrialScheduleCard } from "./TrialScheduleCard";

type ViewMode = "timeline" | "calendar";

const STATE_OPTIONS: Array<{ value: ScheduleFilters["state"]; label: string }> = [
  { value: "all", label: "全部状态" },
  { value: "draft", label: "草稿" },
  { value: "active", label: "进行中" },
  { value: "paused", label: "已暂停" },
  { value: "cleared", label: "已放行" },
];

export function SchedulePage() {
  const { state } = useWorkspace();
  const today = useMemo(() => todayDateOnly(), []);

  const [view, setView] = useState<ViewMode>("timeline");
  const [season, setSeason] = useState("all");
  const [statusFilter, setStatusFilter] =
    useState<ScheduleFilters["state"]>("all");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTrial, setEditingTrial] = useState<Trial | undefined>();
  const [dialogSession, setDialogSession] = useState(0);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  };

  // 纯函数聚合：state 变化时确定性地重算，不保存任何日程副本
  const schedule = useMemo(
    () => buildWorkspaceSchedule(state, today),
    [state, today],
  );

  const filters: ScheduleFilters = useMemo(
    () => ({ season, state: statusFilter, from: from || undefined, to: to || undefined }),
    [season, statusFilter, from, to],
  );

  const visibleSchedules = useMemo(
    () => filterTrialSchedules(schedule.trials, filters),
    [schedule.trials, filters],
  );

  const visibleTrialIds = useMemo(
    () => new Set(visibleSchedules.map((item) => item.trial.id)),
    [visibleSchedules],
  );

  const visibleItems = useMemo(
    () =>
      filterScheduleItems(schedule.items, filters).filter((item) =>
        visibleTrialIds.has(item.trialId),
      ),
    [schedule.items, filters, visibleTrialIds],
  );

  const calendarItems = useMemo(
    () =>
      // 月历只展示观测/节奏/开始/关闭等事件点；区间本身用底色条表达
      visibleItems.filter((item) => item.kind !== "trial-end"),
    [visibleItems],
  );

  const initialMonth = useMemo(() => {
    if (from) {
      return from.slice(0, 7);
    }
    const upcoming = visibleSchedules.find(
      (item) => item.startDate >= today || item.endDate >= today,
    );
    return (upcoming?.startDate ?? schedule.rangeStart ?? today).slice(0, 7);
  }, [from, visibleSchedules, schedule.rangeStart, today]);

  const handleSaved = (trial: Trial) => {
    setDialogOpen(false);
    setEditingTrial(undefined);
    pushToast({
      tone: "success",
      title: editingTrial ? "试验已更新" : "试验已创建",
      message: editingTrial
        ? `${trial.code} 的日期已重新排期。`
        : `${trial.code} 已加入日程时间轴。`,
    });
  };

  const openCreate = () => {
    setEditingTrial(undefined);
    setDialogSession((value) => value + 1);
    setDialogOpen(true);
  };

  const openEdit = (trialId: string) => {
    setEditingTrial(state.trials.find((item) => item.id === trialId));
    setDialogSession((value) => value + 1);
    setDialogOpen(true);
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="温室日程"
        title="试验日程"
        description="在同一时间上下文中查看试验区间、状态、观测节奏与放行关闭节点；所有日程均由当前工作区实时计算。"
        actions={
          <Button
            onClick={openCreate}
            data-testid="open-create-trial"
          >
            <Plus size={16} />
            新建试验
          </Button>
        }
      />

      <section className="schedule-metrics">
        <MetricCard label="试验区间" value={schedule.summary.trials} detail="当前工作区全部试验" />
        <MetricCard
          label="观测记录"
          value={schedule.summary.observations}
          detail="已入库的观测日期"
          accent="positive"
        />
        <MetricCard
          label="即将到期"
          value={schedule.summary.dueSoon}
          detail={`未来 ${OBSERVATION_DUE_WINDOW_DAYS} 天内到期的观测节奏`}
          accent={schedule.summary.dueSoon > 0 ? "warning" : "neutral"}
        />
        <MetricCard
          label="已逾期/缺失"
          value={schedule.summary.overdue}
          detail="错过节奏或区间内无观测"
          accent={schedule.summary.overdue > 0 ? "critical" : "neutral"}
        />
        <MetricCard
          label="关闭节点"
          value={schedule.summary.closures}
          detail="已放行试验的关闭"
        />
        <MetricCard
          label="排期冲突"
          value={schedule.summary.conflicts}
          detail="状态与日期不一致"
          accent={schedule.summary.conflicts > 0 ? "critical" : "neutral"}
        />
      </section>

      <section className="control-strip schedule-filters">
        <select
          className="compact-select"
          value={season}
          onChange={(event) => setSeason(event.target.value)}
          aria-label="按季节筛选"
          data-testid="schedule-season-filter"
        >
          <option value="all">全部季节</option>
          {TRIAL_SEASONS.map((item) => (
            <option value={item} key={item}>
              {item}
            </option>
          ))}
        </select>
        <select
          className="compact-select"
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(event.target.value as TrialState | "all")
          }
          aria-label="按状态筛选"
          data-testid="schedule-state-filter"
        >
          {STATE_OPTIONS.map((option) => (
            <option value={option.value} key={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <label className="schedule-date-filter">
          <span className="field-label">起始</span>
          <input
            type="date"
            className="field-input"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            aria-label="日期范围起始"
            data-testid="schedule-from"
          />
        </label>
        <label className="schedule-date-filter">
          <span className="field-label">结束</span>
          <input
            type="date"
            className="field-input"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            aria-label="日期范围结束"
            data-testid="schedule-to"
          />
        </label>
        {(from || to) ? (
          <Button tone="ghost" size="sm" onClick={() => { setFrom(""); setTo(""); }}>
            清除日期
          </Button>
        ) : null}
        <SegmentedTabs
          label="视图切换"
          value={view}
          onChange={setView}
          options={[
            { value: "timeline", label: "时间轴" },
            { value: "calendar", label: "月历" },
          ]}
        />
      </section>

      <section className="content-panel schedule-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-title">
              {view === "timeline" ? "试验时间轴" : "试验月历"}
            </span>
            <span className="panel-subtitle">
              {visibleSchedules.length} 个试验 · {visibleItems.length} 个日程节点
            </span>
          </div>
          <CalendarRange size={20} className="panel-icon" aria-hidden="true" />
        </div>
        <div className="schedule-panel-body">
          {view === "timeline" ? (
            <Timeline
              schedules={visibleSchedules}
              rangeStart={schedule.rangeStart}
              rangeEnd={schedule.rangeEnd}
              today={today}
              from={from || undefined}
              to={to || undefined}
            />
          ) : (
            <MonthCalendar
              schedules={visibleSchedules}
              items={calendarItems}
              initialMonth={initialMonth}
              today={today}
            />
          )}
        </div>
      </section>

      <section className="schedule-cards">
        {visibleSchedules.length === 0 ? (
          <p className="muted-copy">没有符合季节、状态和日期范围的试验。</p>
        ) : (
          visibleSchedules.map((item) => (
            <TrialScheduleCard
              key={item.trial.id}
              schedule={item}
              onEdit={openEdit}
            />
          ))
        )}
      </section>

      <TrialFormDialog
        key={`${dialogSession}-${editingTrial?.id ?? "new"}`}
        open={dialogOpen}
        trial={editingTrial}
        onClose={() => {
          setDialogOpen(false);
          setEditingTrial(undefined);
        }}
        onSaved={handleSaved}
      />
      <ToastRegion
        messages={toasts}
        onDismiss={(id) =>
          setToasts((current) => current.filter((item) => item.id !== id))
        }
      />
    </div>
  );
}
