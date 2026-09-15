import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Check, Columns3, MinusCircle } from "lucide-react";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import { compareTrials, type TrialComparison } from "../../domain/compare";
import type { TrialState } from "../../domain/types";
import { useWorkspace } from "../../state/store";

const TRIAL_STATE_LABELS: Record<TrialState, string> = {
  draft: "草稿",
  active: "进行中",
  paused: "已暂停",
  cleared: "已放行",
};

interface MetricRow {
  key: string;
  label: string;
  scope: string;
  linkLabel: string;
  linkTo: (trialId: string) => string;
  render: (comparison: TrialComparison) => ReactNode;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function GapNote({ children }: { children: string }) {
  return (
    <span className="compare-gap">
      <MinusCircle size={13} aria-hidden="true" />
      {children}
    </span>
  );
}

function LiveMeta() {
  return <span className="compare-cell-meta">随工作区实时更新</span>;
}

const METRIC_ROWS: MetricRow[] = [
  {
    key: "schedule",
    label: "时间跨度",
    scope: "试验登记的开始与结束日期",
    linkLabel: "放行页",
    linkTo: (trialId) => `/clearance?trial=${trialId}`,
    render: ({ schedule }) => (
      <>
        {schedule.spanDays === null ? (
          <GapNote>起止日期无效</GapNote>
        ) : (
          <>
            <div className="compare-cell-main">
              {schedule.startDate} → {schedule.endDate}
            </div>
            <div className="compare-cell-sub">
              跨度 {schedule.spanDays} 天
              {schedule.daysRemaining !== null
                ? schedule.ended
                  ? " · 已结束"
                  : ` · 剩余 ${schedule.daysRemaining} 天`
                : ""}
            </div>
          </>
        )}
        <LiveMeta />
      </>
    ),
  },
  {
    key: "materials",
    label: "材料与分配",
    scope: "本试验登记的材料及其台架分配状态",
    linkLabel: "登记页",
    linkTo: (trialId) => `/roster?trial=${trialId}`,
    render: ({ materials }) => (
      <>
        {materials.total === 0 ? (
          <GapNote>尚未登记材料</GapNote>
        ) : (
          <>
            <div className="compare-cell-main">{materials.total} 份材料</div>
            <div className="compare-cell-sub">
              已分配 {materials.assigned} · 未分配 {materials.unassigned}
              {materials.blockedPlacement > 0
                ? ` · 受限台架 ${materials.blockedPlacement}`
                : ""}
            </div>
            <div className="compare-cell-sub">
              总株数 {materials.totalQuantity}
            </div>
          </>
        )}
        <LiveMeta />
      </>
    ),
  },
  {
    key: "observations",
    label: "近期观测",
    scope: "本试验全部观测记录",
    linkLabel: "观测页",
    linkTo: (trialId) => `/observations?trial=${trialId}`,
    render: ({ observations }) => (
      <>
        {observations.latestPass ? (
          <>
            <div className="compare-cell-main">
              {observations.passCount} 次观测 · {observations.entryCount} 条记录
            </div>
            <div className="compare-cell-sub">
              最近 {observations.latestPass.observedOn}
              {observations.daysSinceLatest !== null
                ? `（${observations.daysSinceLatest} 天前）`
                : ""}
              {" · "}
              {observations.latestPass.observer}
            </div>
          </>
        ) : (
          <GapNote>尚无观测记录</GapNote>
        )}
        <span className="compare-cell-meta">
          {observations.latestPass
            ? `数据截至 ${observations.latestPass.observedOn}`
            : "等待首次观测"}
        </span>
      </>
    ),
  },
  {
    key: "flags",
    label: "开放标记",
    scope: "本试验观测派生的标记",
    linkLabel: "观测页",
    linkTo: (trialId) => `/observations?trial=${trialId}`,
    render: ({ flags }) => (
      <>
        {flags.evaluated ? (
          <>
            <div className="compare-cell-main">{flags.open} 个未处理</div>
            <div className="compare-cell-sub">
              严重 {flags.openBySeverity.critical} · 警告{" "}
              {flags.openBySeverity.warning} · 提示 {flags.openBySeverity.info}
            </div>
            <div className="compare-cell-sub">标记总数 {flags.total}</div>
          </>
        ) : (
          <GapNote>尚无观测，标记未评估</GapNote>
        )}
        <span className="compare-cell-meta">
          {flags.lastActivityOn
            ? `最近标记活动 ${formatDateTime(flags.lastActivityOn)}`
            : "暂无标记活动"}
        </span>
      </>
    ),
  },
  {
    key: "benches",
    label: "台架占用",
    scope: "承载本试验材料的台架槽位",
    linkLabel: "布局页",
    linkTo: (trialId) => `/layout?trial=${trialId}`,
    render: ({ benches }) => (
      <>
        {benches.benchCount === 0 ? (
          <GapNote>未占用台架</GapNote>
        ) : (
          <>
            <div className="compare-cell-main">
              {benches.benchCount} 个台架 · {benches.usedSlots}/
              {benches.capacitySlots} 槽位
            </div>
            <div className="compare-cell-sub">
              {benches.benchCodes.join("、")}
            </div>
            {benches.unavailable > 0 ? (
              <div className="compare-cell-warn">
                {benches.unavailable} 个台架不可用
              </div>
            ) : null}
          </>
        )}
        <LiveMeta />
      </>
    ),
  },
  {
    key: "clearance",
    label: "最近放行",
    scope: "本试验最近生成的放行快照",
    linkLabel: "放行页",
    linkTo: (trialId) => `/clearance?trial=${trialId}`,
    render: ({ clearance }) => (
      <>
        {clearance.latest ? (
          <>
            <div className="compare-cell-main">
              <StatusBadge tone={statusTone(clearance.latest.status)}>
                {clearance.latest.status === "ready" ? "就绪" : "阻止"}
              </StatusBadge>
            </div>
            <div className="compare-cell-sub">
              {clearance.latest.status === "ready"
                ? "无阻止项"
                : `${clearance.latest.blockers.length} 个阻止项`}
              {" · 历史快照 "}
              {clearance.snapshotCount} 份
            </div>
          </>
        ) : (
          <GapNote>尚未生成放行快照</GapNote>
        )}
        <span className="compare-cell-meta">
          {clearance.latest
            ? `生成于 ${formatDateTime(clearance.latest.generatedOn)}`
            : "等待首次放行检查"}
        </span>
      </>
    ),
  },
];

export function ComparePage() {
  const { state } = useWorkspace();
  const [selectedIds, setSelectedIds] = useState<string[]>(() =>
    state.trials.slice(0, 2).map((trial) => trial.id),
  );

  const comparisons = useMemo(
    () => compareTrials(state, selectedIds),
    [state, selectedIds],
  );
  // 从工作区状态实时派生：任何数据或状态变化都会触发重算，结果确定更新
  const computedAt = useMemo(() => new Date(), [state, selectedIds]);

  const toggleTrial = (trialId: string) => {
    setSelectedIds((current) =>
      current.includes(trialId)
        ? current.filter((id) => id !== trialId)
        : [...current, trialId],
    );
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="多试验对比"
        title="试验对比"
        description="按同一口径并列比较多个试验的时间跨度、材料规模、观测节奏、标记负担、台架占用和放行准备度。"
      />
      <section
        className="control-strip compare-picker"
        aria-label="选择要对比的试验"
      >
        <span className="compare-picker-label">
          已选 {selectedIds.length} 个试验（至少 2 个）
        </span>
        {state.trials.map((trial) => {
          const active = selectedIds.includes(trial.id);
          return (
            <button
              key={trial.id}
              type="button"
              className={`compare-chip${active ? " compare-chip-active" : ""}`}
              aria-pressed={active}
              onClick={() => toggleTrial(trial.id)}
              data-testid={`compare-trial-toggle-${trial.id}`}
            >
              {active ? <Check size={13} aria-hidden="true" /> : null}
              {trial.code}
            </button>
          );
        })}
      </section>
      {comparisons.length < 2 ? (
        <section className="content-panel">
          <EmptyState
            icon={Columns3}
            title="选择至少两个试验"
            description="在上方勾选两个或更多试验后，这里会按同一口径并列展示各项指标，缺少数据的试验会显示缺口而不是零值。"
          />
        </section>
      ) : (
        <section className="content-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-title">并列对比</span>
              <span className="panel-subtitle">
                同一口径 · 按各试验引用闭包统计 · 计算于{" "}
                {computedAt.toLocaleString()}
              </span>
            </div>
            <Columns3 size={20} className="panel-icon" aria-hidden="true" />
          </div>
          <div className="data-table-wrap">
            <table
              className="data-table compare-table"
              data-testid="compare-table"
            >
              <thead>
                <tr>
                  <th>指标 / 统计范围</th>
                  {comparisons.map((comparison) => (
                    <th key={comparison.trial.id}>
                      <div className="compare-trial-head">
                        <strong>{comparison.trial.code}</strong>
                        <span>
                          {comparison.trial.cropFamily} ·{" "}
                          {comparison.trial.season}
                        </span>
                        <StatusBadge
                          tone={statusTone(
                            TRIAL_STATE_LABELS[comparison.trial.state],
                          )}
                        >
                          {TRIAL_STATE_LABELS[comparison.trial.state]}
                        </StatusBadge>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {METRIC_ROWS.map((row) => (
                  <tr key={row.key}>
                    <td>
                      <span className="compare-metric-label">{row.label}</span>
                      <span className="compare-scope">范围：{row.scope}</span>
                    </td>
                    {comparisons.map((comparison) => (
                      <td
                        key={comparison.trial.id}
                        data-testid={`compare-cell-${row.key}-${comparison.trial.id}`}
                      >
                        {row.render(comparison)}
                        <Link
                          className="compare-link"
                          to={row.linkTo(comparison.trial.id)}
                          data-testid={`compare-link-${row.key}-${comparison.trial.id}`}
                        >
                          {row.linkLabel}
                          <ArrowUpRight size={12} aria-hidden="true" />
                        </Link>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
