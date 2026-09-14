import { useMemo, useState } from "react";
import { ClipboardList, TrendingUp, X } from "lucide-react";
import { Button } from "../../components/Button";
import { DataTable, type DataColumn } from "../../components/DataTable";
import { EmptyState } from "../../components/EmptyState";
import { MetricCard } from "../../components/MetricCard";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import type { Accession, FlagState } from "../../domain/types";
import {
  TREND_METRICS,
  buildGrowthTrend,
  trendPointKey,
  type TrendPoint,
} from "../../domain/trend";
import { accessionsForTrial } from "../../state/selectors";
import { useWorkspace } from "../../state/store";
import { SEVERITY_COLORS, TrendChart } from "./TrendChart";

const SERIES_COLORS = [
  "#2f6d43",
  "#3f5f78",
  "#9b4d31",
  "#9a6a16",
  "#5f4b8b",
  "#0f766e",
  "#b53a32",
  "#65705f",
];

const FLAG_STATE_LABELS: Record<FlagState, string> = {
  open: "未处理",
  resolved: "已解决",
  waived: "已豁免",
};

export function TrendsPage() {
  const { state } = useWorkspace();
  const [trialId, setTrialId] = useState(() => state.trials[0]?.id ?? "");
  const [selectedIds, setSelectedIds] = useState<string[] | null>(null);
  const [selectedPointKey, setSelectedPointKey] = useState<string | null>(null);

  const accessions = accessionsForTrial(state, trialId);
  const accessionById = useMemo(
    () => new Map(state.accessions.map((item) => [item.id, item])),
    [state.accessions],
  );

  // 趋势完全由当前观测记录和历史标记确定性计算，每次渲染都基于最新状态。
  const effectiveSelection = selectedIds ?? accessions.map((item) => item.id);
  const orderedIds = accessions
    .map((item) => item.id)
    .filter((id) => effectiveSelection.includes(id));
  const trend = buildGrowthTrend(state, trialId, orderedIds);

  const chartSeries = trend.series.map((series, index) => {
    const accession = accessionById.get(series.accessionId);
    return {
      accessionId: series.accessionId,
      label: accession
        ? `${accession.accessionNo} · ${accession.cultivar}`
        : series.accessionId,
      color: SERIES_COLORS[index % SERIES_COLORS.length],
      points: series.points,
    };
  });

  const allPoints = trend.series
    .flatMap((series) => series.points)
    .sort(
      (left, right) =>
        left.observedOn.localeCompare(right.observedOn) ||
        (accessionById.get(left.accessionId)?.accessionNo ?? "").localeCompare(
          accessionById.get(right.accessionId)?.accessionNo ?? "",
        ),
    );

  const selectedPoint =
    allPoints.find((point) => trendPointKey(point) === selectedPointKey) ?? null;
  const hasSparseSeries = trend.series.some(
    (series) => series.points.length === 1,
  );

  const selectTrial = (nextTrialId: string) => {
    setTrialId(nextTrialId);
    setSelectedIds(null);
    setSelectedPointKey(null);
  };

  const toggleAccession = (accessionId: string) => {
    const current = selectedIds ?? accessions.map((item) => item.id);
    setSelectedIds(
      current.includes(accessionId)
        ? current.filter((id) => id !== accessionId)
        : [...current, accessionId],
    );
  };

  const renderBody = () => {
    if (state.trials.length === 0) {
      return (
        <EmptyState
          icon={TrendingUp}
          title="还没有试验"
          description="当前工作区没有任何试验，无法计算生长趋势。"
        />
      );
    }
    if (accessions.length === 0) {
      return (
        <EmptyState
          icon={TrendingUp}
          title="该试验还没有材料"
          description="请先在材料登记中为该试验添加材料，再查看生长趋势。"
        />
      );
    }
    if (effectiveSelection.length === 0) {
      return (
        <EmptyState
          icon={TrendingUp}
          title="请至少选择一个材料"
          description="在上方勾选一个或多个材料后，将按统一观测日期轴展示趋势。"
        />
      );
    }
    if (allPoints.length === 0) {
      return (
        <EmptyState
          icon={TrendingUp}
          title="当前材料组合还没有观测记录"
          description="趋势完全由观测记录确定性计算。前往生长观测页记录观测后，这里会自动刷新。"
        />
      );
    }
    return (
      <>
        <div className="trend-legend" data-testid="trend-legend">
          {chartSeries.map((series) => (
            <span className="trend-legend-item" key={series.accessionId}>
              <i
                className="trend-legend-swatch"
                style={{ background: series.color }}
              />
              {series.label}
            </span>
          ))}
          <span className="trend-legend-item">
            <svg width="14" height="14" aria-hidden="true">
              <path
                d="M 7 1.5 L 12.5 7 L 7 12.5 L 1.5 7 Z"
                fill={SEVERITY_COLORS.warning}
              />
            </svg>
            触发阈值（黄=警告，红=严重）
          </span>
          <span className="trend-legend-item">
            <svg width="16" height="16" aria-hidden="true">
              <circle
                cx="8"
                cy="8"
                r="6"
                fill="none"
                stroke={SEVERITY_COLORS.critical}
                strokeWidth="2"
              />
            </svg>
            有标记的观测（实线圈=未处理，虚线圈=已处理）
          </span>
        </div>
        <div className="trend-charts">
          {TREND_METRICS.map((metric) => (
            <TrendChart
              key={metric.key}
              title={metric.label}
              unit={metric.unit}
              metric={metric.key}
              dates={trend.dates}
              series={chartSeries}
              selectedKey={selectedPointKey}
              onSelect={(point) => setSelectedPointKey(trendPointKey(point))}
            />
          ))}
        </div>
        {hasSparseSeries ? (
          <p className="trend-hint">
            部分材料只有 1 个观测点，图中仅呈现原始数据点，不连线、不外推。
          </p>
        ) : null}
        {selectedPoint ? (
          <TrendPointDetail
            point={selectedPoint}
            accession={accessionById.get(selectedPoint.accessionId)}
            onClose={() => setSelectedPointKey(null)}
          />
        ) : null}
        <section className="content-panel" data-testid="trend-table">
          <div className="panel-heading">
            <div>
              <span className="panel-title">观测点溯源</span>
              <span className="panel-subtitle">
                图中每个点都对应一条真实观测记录，可回到观测日期和材料。
              </span>
            </div>
            <ClipboardList size={20} className="panel-icon" aria-hidden="true" />
          </div>
          <DataTable
            columns={traceColumns(
              accessionById,
              (point) => setSelectedPointKey(trendPointKey(point)),
            )}
            rows={allPoints}
            rowKey={(point) => trendPointKey(point)}
            rowTestId={(point) =>
              `trend-row-${point.passId}-${point.accessionId}`
            }
            emptyMessage="当前材料组合还没有观测记录。"
          />
        </section>
      </>
    );
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="生长趋势"
        title="趋势分析"
        description="选择试验和材料组合，以统一观测日期轴比较株高、叶片数和电导率，并识别有标记和触发阈值的观测点。"
      />
      {state.trials.length > 0 ? (
        <section className="control-strip">
          <select
            className="compact-select"
            value={trialId}
            onChange={(event) => selectTrial(event.target.value)}
            aria-label="选择试验"
            data-testid="trend-trial-select"
          >
            {state.trials.map((trial) => (
              <option value={trial.id} key={trial.id}>
                {trial.code} - {trial.cropFamily}
              </option>
            ))}
          </select>
          <div className="trend-picker" role="group" aria-label="选择材料">
            {accessions.map((accession) => {
              const active = effectiveSelection.includes(accession.id);
              return (
                <button
                  type="button"
                  key={accession.id}
                  className={`accession-chip ${active ? "accession-chip-active" : ""}`}
                  aria-pressed={active}
                  onClick={() => toggleAccession(accession.id)}
                  data-testid={`trend-accession-${accession.id}`}
                >
                  {accession.accessionNo} · {accession.cultivar}
                </button>
              );
            })}
          </div>
          {accessions.length > 0 ? (
            <div className="trend-picker-actions">
              <Button
                tone="ghost"
                size="sm"
                onClick={() => setSelectedIds(null)}
                data-testid="trend-select-all"
              >
                全选
              </Button>
              <Button
                tone="ghost"
                size="sm"
                onClick={() => setSelectedIds([])}
                data-testid="trend-select-none"
              >
                清空
              </Button>
            </div>
          ) : null}
        </section>
      ) : null}
      {renderBody()}
    </div>
  );
}

function TrendPointDetail({
  point,
  accession,
  onClose,
}: {
  point: TrendPoint;
  accession: Accession | undefined;
  onClose: () => void;
}) {
  const breachFor = (metric: TrendPoint["breaches"][number]["metric"]) =>
    point.breaches.find((breach) => breach.metric === metric);
  const accentFor = (metric: TrendPoint["breaches"][number]["metric"]) => {
    const breach = breachFor(metric);
    if (!breach) {
      return "neutral" as const;
    }
    return breach.severity === "critical" ? ("critical" as const) : ("warning" as const);
  };
  return (
    <section className="trend-detail" data-testid="trend-point-detail">
      <div className="trend-detail-heading">
        <h2>
          {point.observedOn} ·{" "}
          {accession
            ? `${accession.accessionNo} ${accession.cultivar}`
            : point.accessionId}
        </h2>
        <Button
          tone="ghost"
          size="sm"
          className="icon-button"
          onClick={onClose}
          aria-label="关闭观测点详情"
        >
          <X size={16} />
        </Button>
      </div>
      <p className="trend-detail-meta">
        观测批次 {point.passId} · 观测人 {point.observer}
      </p>
      <div className="trend-detail-metrics">
        <MetricCard
          label="株高"
          value={`${point.heightMm} mm`}
          accent={accentFor("heightMm")}
        />
        <MetricCard
          label="叶片数"
          value={`${point.leafCount} 片`}
          accent={accentFor("leafCount")}
        />
        <MetricCard
          label="电导率"
          value={`${point.ecMs} mS/cm`}
          accent={accentFor("ecMs")}
        />
      </div>
      <div className="trend-detail-section">
        <h4>阈值触发</h4>
        {point.breaches.length === 0 ? (
          <p className="muted-copy">该观测点未触发任何生长阈值。</p>
        ) : (
          <div className="trend-badge-row">
            {point.breaches.map((breach) => (
              <StatusBadge
                key={breach.code}
                tone={breach.severity === "critical" ? "critical" : "warning"}
              >
                {`${breach.code} · ${breach.message}`}
              </StatusBadge>
            ))}
          </div>
        )}
      </div>
      <div className="trend-detail-section">
        <h4>关联标记</h4>
        {point.flags.length === 0 ? (
          <p className="muted-copy">该观测点没有关联的生长标记。</p>
        ) : (
          point.flags.map((flag) => (
            <div className="trend-flag-row" key={flag.id}>
              <StatusBadge tone={statusTone(flag.state)}>
                {FLAG_STATE_LABELS[flag.state]}
              </StatusBadge>
              <strong>{flag.code}</strong>
              <span>{flag.message}</span>
              {flag.resolutionNote ? (
                <span className="trend-detail-meta">
                  处理说明：{flag.resolutionNote}
                </span>
              ) : null}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

function traceColumns(
  accessionById: Map<string, Accession>,
  onLocate: (point: TrendPoint) => void,
): Array<DataColumn<TrendPoint>> {
  return [
    {
      key: "observedOn",
      header: "观测日期",
      render: (point) => point.observedOn,
    },
    {
      key: "accession",
      header: "材料",
      render: (point) => {
        const accession = accessionById.get(point.accessionId);
        return accession ? (
          <>
            <span className="table-primary">{accession.accessionNo}</span>
            {` · ${accession.cultivar}`}
          </>
        ) : (
          point.accessionId
        );
      },
    },
    {
      key: "heightMm",
      header: "株高 (mm)",
      render: (point) => point.heightMm,
    },
    {
      key: "leafCount",
      header: "叶片数",
      render: (point) => point.leafCount,
    },
    {
      key: "ecMs",
      header: "电导率 (mS/cm)",
      render: (point) => point.ecMs,
    },
    {
      key: "breaches",
      header: "阈值触发",
      render: (point) =>
        point.breaches.length === 0 ? (
          "—"
        ) : (
          <span className="trend-badge-row">
            {point.breaches.map((breach) => (
              <StatusBadge
                key={breach.code}
                tone={breach.severity === "critical" ? "critical" : "warning"}
              >
                {breach.code}
              </StatusBadge>
            ))}
          </span>
        ),
    },
    {
      key: "flags",
      header: "标记",
      render: (point) =>
        point.flags.length === 0 ? (
          "—"
        ) : (
          <span className="trend-badge-row">
            {point.flags.map((flag) => (
              <StatusBadge key={flag.id} tone={statusTone(flag.state)}>
                {`${flag.code} · ${FLAG_STATE_LABELS[flag.state]}`}
              </StatusBadge>
            ))}
          </span>
        ),
    },
    {
      key: "locate",
      header: "操作",
      render: (point) => (
        <Button
          tone="ghost"
          size="sm"
          onClick={() => onLocate(point)}
          data-testid={`trend-locate-${point.passId}-${point.accessionId}`}
        >
          查看
        </Button>
      ),
    },
  ];
}
