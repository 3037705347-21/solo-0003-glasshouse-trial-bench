import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowRight,
  CalendarClock,
  CalendarX2,
  CircleAlert,
  ClipboardCheck,
  Hammer,
  NotebookPen,
  RefreshCw,
  Sun,
} from "lucide-react";
import { EmptyState } from "../../components/EmptyState";
import { MetricCard } from "../../components/MetricCard";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import type {
  WorkbenchCategory,
  WorkbenchDueStatus,
  WorkbenchItem,
  WorkbenchObjectType,
} from "../../domain/workbench";
import {
  buildWorkbench,
  CLEARANCE_LEAD_DAYS,
  summarizeWorkbench,
} from "../../domain/workbench";
import type { WorkspaceState } from "../../domain/types";
import { useToday } from "../../app/useToday";
import { useWorkspace } from "../../state/store";

const categoryLabels: Record<WorkbenchCategory, string> = {
  observation: "观测计划",
  flag: "开放标记",
  exception: "待处理异常",
  clearance: "临近放行",
  maintenance: "台架维护",
};

const statusLabels: Record<WorkbenchDueStatus, string> = {
  overdue: "已逾期",
  today: "今天到期",
  upcoming: "临近",
  standing: "待处理",
  paused: "已暂停",
};

const objectTypeLabels: Record<WorkbenchObjectType, string> = {
  trial: "试验",
  accession: "材料",
  bench: "台架",
};

const categoryIcons: Record<WorkbenchCategory, typeof NotebookPen> = {
  observation: NotebookPen,
  flag: CircleAlert,
  exception: ClipboardCheck,
  clearance: CalendarClock,
  maintenance: Hammer,
};

type TrialFilter = string; // "all" | "cross" | trial id
type ObjectTypeFilter = "all" | WorkbenchObjectType;
type StatusFilter = "all" | WorkbenchDueStatus;

export function WorkbenchPage() {
  const { state } = useWorkspace();
  const today = useToday();
  const [trialFilter, setTrialFilter] = useState<TrialFilter>("all");
  const [objectTypeFilter, setObjectTypeFilter] =
    useState<ObjectTypeFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [refreshedAt, setRefreshedAt] = useState(() => formatNow());

  const items = useMemo(() => buildWorkbench(state, today), [state, today]);
  const summary = useMemo(() => summarizeWorkbench(items), [items]);

  const filtered = useMemo(
    () =>
      items.filter((item) => {
        if (trialFilter === "cross") {
          if (item.trialId !== undefined) {
            return false;
          }
        } else if (trialFilter !== "all" && item.trialId !== trialFilter) {
          return false;
        }
        if (
          objectTypeFilter !== "all" &&
          item.objectType !== objectTypeFilter
        ) {
          return false;
        }
        if (statusFilter !== "all" && item.dueStatus !== statusFilter) {
          return false;
        }
        return true;
      }),
    [items, trialFilter, objectTypeFilter, statusFilter],
  );

  const groups = useMemo(() => groupItems(state, filtered), [state, filtered]);
  const trialCodeById = new Map(
    state.trials.map((trial) => [trial.id, trial.code]),
  );

  const filtersActive =
    trialFilter !== "all" ||
    objectTypeFilter !== "all" ||
    statusFilter !== "all";

  return (
    <div className="page">
      <PageHeader
        eyebrow="今日工作台"
        title={`今日待办 · ${today}`}
        description="实时汇总当天及已逾期的观测计划、开放标记、待处理异常、临近放行与台架维护事项；数据直接来自各工作流当前记录，不保存会过期的副本。"
        actions={
          <button
            type="button"
            className="button button-secondary button-md"
            onClick={() => setRefreshedAt(formatNow())}
            data-testid="workbench-refresh"
          >
            <RefreshCw size={16} />
            重新汇总
          </button>
        }
      />

      <section className="workbench-metrics" aria-label="事项概览">
        <MetricCard
          label="已逾期"
          value={summary.overdue}
          detail="超过截止节点仍未处理"
          accent={summary.overdue > 0 ? "critical" : "neutral"}
        />
        <MetricCard
          label="今天到期"
          value={summary.today}
          detail="今天需要完成的节点"
          accent={summary.today > 0 ? "warning" : "neutral"}
        />
        <MetricCard
          label="待处理"
          value={summary.standing}
          detail="开放标记、异常与维护"
          accent={summary.standing > 0 ? "warning" : "positive"}
        />
        <MetricCard
          label="临近放行"
          value={summary.upcoming}
          detail={`未来 ${CLEARANCE_LEAD_DAYS} 天内到达放行节点`}
          accent={summary.upcoming > 0 ? "warning" : "neutral"}
        />
        <MetricCard
          label="已暂停保留"
          value={summary.paused}
          detail="试验暂停后保留的旧提醒"
          accent={summary.paused > 0 ? "neutral" : "positive"}
        />
      </section>

      <section className="control-strip workbench-filters">
        <select
          className="compact-select"
          value={trialFilter}
          onChange={(event) => setTrialFilter(event.target.value)}
          aria-label="按试验筛选"
          data-testid="workbench-trial-filter"
        >
          <option value="all">全部试验</option>
          <option value="cross">跨试验 / 台架</option>
          {state.trials.map((trial) => (
            <option value={trial.id} key={trial.id}>
              {trial.code} - {trial.cropFamily}
            </option>
          ))}
        </select>
        <select
          className="compact-select"
          value={objectTypeFilter}
          onChange={(event) =>
            setObjectTypeFilter(event.target.value as ObjectTypeFilter)
          }
          aria-label="按对象类型筛选"
          data-testid="workbench-object-filter"
        >
          <option value="all">全部对象</option>
          <option value="trial">试验</option>
          <option value="accession">材料</option>
          <option value="bench">台架</option>
        </select>
        <select
          className="compact-select"
          value={statusFilter}
          onChange={(event) =>
            setStatusFilter(event.target.value as StatusFilter)
          }
          aria-label="按截止状态筛选"
          data-testid="workbench-status-filter"
        >
          <option value="all">全部状态</option>
          <option value="overdue">已逾期</option>
          <option value="today">今天到期</option>
          <option value="upcoming">临近</option>
          <option value="standing">待处理</option>
          <option value="paused">已暂停</option>
        </select>
        <span className="workbench-sync-hint" data-testid="workbench-sync-hint">
          实时汇总 · 最近同步 {refreshedAt}
        </span>
      </section>

      {items.length === 0 ? (
        <EmptyState
          icon={Sun}
          title="今天没有到期事项"
          description="当前没有今天到期、已逾期或等待处理的观测、标记、异常、放行与台架维护事项。各工作流出现新记录后会自动出现在这里。"
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={CalendarX2}
          title="当前筛选没有匹配事项"
          description={
            filtersActive
              ? "不是漏掉了事项，而是这组筛选条件下暂时没有记录。调整试验、对象类型或截止状态筛选再试。"
              : "当前没有匹配事项。"
          }
        />
      ) : (
        <section className="workbench-list" aria-label="今日待办事项">
          {groups.map((group) => (
            <div
              className="workbench-group"
              key={group.key}
              data-testid={`workbench-group-${group.key}`}
            >
              <div className="workbench-group-heading">
                <strong>{group.label}</strong>
                {group.items.length > 1 ? (
                  <span
                    className="workbench-group-count"
                    data-testid={`workbench-group-count-${group.key}`}
                  >
                    同一对象 {group.items.length} 条提醒
                  </span>
                ) : null}
                <span className="workbench-group-type">
                  {objectTypeLabels[group.items[0].objectType]}
                </span>
              </div>
              <div className="workbench-item-list">
                {group.items.map((item) => (
                  <WorkbenchRow
                    key={item.id}
                    item={item}
                    trialCode={
                      item.trialId
                        ? trialCodeById.get(item.trialId)
                        : "跨试验"
                    }
                  />
                ))}
              </div>
            </div>
          ))}
        </section>
      )}
    </div>
  );
}

interface WorkbenchGroup {
  key: string;
  label: string;
  items: WorkbenchItem[];
}

function groupItems(state: WorkspaceState, items: WorkbenchItem[]): WorkbenchGroup[] {
  const byKey = new Map<string, WorkbenchItem[]>();
  items.forEach((item) => {
    const key =
      item.objectType === "bench"
        ? `bench-${item.benchId ?? "unknown"}`
        : item.objectType === "accession"
          ? `accession-${item.accessionId ?? "unknown"}`
          : `trial-${item.trialId ?? "unknown"}`;
    const current = byKey.get(key);
    if (current) {
      current.push(item);
    } else {
      byKey.set(key, [item]);
    }
  });
  return Array.from(byKey.entries()).map(([key, grouped]) => ({
    key,
    label: groupLabel(state, grouped[0]),
    items: grouped,
  }));
}

function groupLabel(state: WorkspaceState, item: WorkbenchItem): string {
  if (item.objectType === "bench" && item.benchId) {
    const bench = state.benches.find((entry) => entry.id === item.benchId);
    return bench ? `台架 ${bench.code} · ${bench.sector}` : "台架";
  }
  if (item.objectType === "accession" && item.accessionId) {
    const accession = state.accessions.find(
      (entry) => entry.id === item.accessionId,
    );
    return accession
      ? `${accession.accessionNo} · ${accession.cultivar}`
      : "材料";
  }
  if (item.trialId) {
    const trial = state.trials.find((entry) => entry.id === item.trialId);
    return trial ? `${trial.code} · ${trial.cropFamily}` : "试验";
  }
  return "其他";
}

interface WorkbenchRowProps {
  item: WorkbenchItem;
  trialCode?: string;
}

function WorkbenchRow({ item, trialCode }: WorkbenchRowProps) {
  const Icon = categoryIcons[item.category];
  return (
    <Link
      to={item.route}
      className={`workbench-item workbench-item-${item.dueStatus}`}
      data-testid={`workbench-item-${item.id}`}
    >
      <span className={`workbench-item-icon workbench-item-icon-${item.severity}`}>
        <Icon size={17} aria-hidden="true" />
      </span>
      <span className="workbench-item-body">
        <span className="workbench-item-title">{item.title}</span>
        <span className="workbench-item-detail">{item.detail}</span>
        <span className="workbench-item-meta">
          <StatusBadge tone={categoryBadgeTone(item.category)}>
            {categoryLabels[item.category]}
          </StatusBadge>
          <span className="workbench-item-trial">{trialCode}</span>
          {item.dueOn ? (
            <span className="workbench-item-due">节点 {item.dueOn}</span>
          ) : null}
        </span>
      </span>
      <span className="workbench-item-status">
        <StatusBadge tone={statusBadgeTone(item.dueStatus)}>
          {statusLabels[item.dueStatus]}
        </StatusBadge>
        <ArrowRight size={15} className="workbench-item-arrow" aria-hidden="true" />
      </span>
    </Link>
  );
}

function categoryBadgeTone(category: WorkbenchCategory) {
  if (category === "observation") {
    return "info" as const;
  }
  if (category === "maintenance" || category === "flag" || category === "exception") {
    return "warning" as const;
  }
  return "neutral" as const;
}

function statusBadgeTone(status: WorkbenchDueStatus) {
  if (status === "overdue") {
    return "critical" as const;
  }
  if (status === "today") {
    return "warning" as const;
  }
  if (status === "upcoming" || status === "paused") {
    return "info" as const;
  }
  return "neutral" as const;
}

function formatNow(): string {
  const now = new Date();
  return [
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join(":");
}
