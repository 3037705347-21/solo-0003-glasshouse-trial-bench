import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Flag, RotateCcw, ShieldCheck } from "lucide-react";
import { Button } from "../../components/Button";
import { DataTable, type DataColumn } from "../../components/DataTable";
import { MetricCard } from "../../components/MetricCard";
import { PageHeader } from "../../components/PageHeader";
import { SearchInput } from "../../components/SearchInput";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { EmptyState } from "../../components/EmptyState";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import type { FlagState } from "../../domain/types";
import {
  EMPTY_FLAG_FILTERS,
  FLAG_SEVERITY_LABELS,
  FLAG_STATE_LABELS,
  filterFlagTraces,
  flagCodeLabel,
  flagTraces,
  formatTimestamp,
  type FlagFilters,
  type FlagTrace,
} from "../../domain/flagTrace";
import { useWorkspace } from "../../state/store";
import { FlagDetailDialog } from "./FlagDetailDialog";

type StateSegment = "" | FlagState;

function accessionDisplay(trace: FlagTrace): string {
  return trace.accession
    ? `${trace.accession.accessionNo} · ${trace.accession.cultivar}`
    : trace.flag.accessionId;
}

export function FlagWorkbenchPage() {
  const { state } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const [filters, setFilters] = useState<FlagFilters>(() => ({
    ...EMPTY_FLAG_FILTERS,
    // 从观测/放行页跳转过来时预选试验与状态。
    trialId: searchParams.get("trial") ?? "",
    state: (searchParams.get("state") ?? "") as FlagFilters["state"],
  }));
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | undefined>(
    searchParams.get("flag") ?? undefined,
  );
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  };

  const traces = useMemo(() => flagTraces(state), [state]);
  const codes = useMemo(
    () => Array.from(new Set(state.flags.map((flag) => flag.code))).sort(),
    [state.flags],
  );
  const accessionsForTrial = useMemo(() => {
    const ids = new Set(
      traces
        .filter((trace) =>
          filters.trialId ? trace.flag.trialId === filters.trialId : true,
        )
        .map((trace) => trace.flag.accessionId),
    );
    return state.accessions.filter((accession) => ids.has(accession.id));
  }, [traces, filters.trialId, state.accessions]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return filterFlagTraces(traces, filters).filter((trace) => {
      if (!normalized) {
        return true;
      }
      const haystack = [
        trace.flag.code,
        trace.flag.message,
        trace.flag.resolutionNote ?? "",
        accessionDisplay(trace),
        trace.trial?.code ?? "",
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(normalized);
    });
  }, [traces, filters, query]);

  const counts = useMemo(
    () => ({
      total: filtered.length,
      open: filtered.filter((trace) => trace.flag.state === "open").length,
      resolved: filtered.filter(
        (trace) => trace.flag.state === "resolved",
      ).length,
      waived: filtered.filter((trace) => trace.flag.state === "waived").length,
      blocking: filtered.filter((trace) => trace.blockingClearance).length,
    }),
    [filtered],
  );

  const selectedTrace = traces.find(
    (trace) => trace.flag.id === selectedId,
  );

  const updateFilter = <K extends keyof FlagFilters>(
    key: K,
    value: FlagFilters[K],
  ) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const resetFilters = () => {
    setFilters(EMPTY_FLAG_FILTERS);
    setQuery("");
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  const hasActiveFilters =
    query.trim() !== "" ||
    Object.entries(filters).some(([, value]) => value !== "");

  const columns: Array<DataColumn<FlagTrace>> = [
    {
      key: "createdOn",
      header: "创建时间",
      render: (trace) => (
        <span className="flag-cell-time">
          {formatTimestamp(trace.flag.createdOn)}
        </span>
      ),
    },
    {
      key: "trial",
      header: "来源试验",
      render: (trace) =>
        trace.trial ? (
          <span className="table-primary">{trace.trial.code}</span>
        ) : (
          <span className="flag-missing">未知试验</span>
        ),
    },
    {
      key: "accession",
      header: "材料",
      render: (trace) => (
        <span className="flag-cell-accession">
          {accessionDisplay(trace)}
          {trace.crossTrial ? (
            <StatusBadge tone="info">跨试验引用</StatusBadge>
          ) : null}
        </span>
      ),
    },
    {
      key: "severity",
      header: "严重程度",
      render: (trace) => (
        <StatusBadge tone={statusTone(trace.flag.severity)}>
          {FLAG_SEVERITY_LABELS[trace.flag.severity]}
        </StatusBadge>
      ),
    },
    {
      key: "code",
      header: "代码",
      render: (trace) => (
        <span className="flag-cell-code">
          <code>{trace.flag.code}</code>
          <small>{flagCodeLabel(trace.flag.code)}</small>
        </span>
      ),
    },
    {
      key: "state",
      header: "状态",
      render: (trace) => (
        <StatusBadge tone={statusTone(trace.flag.state)}>
          {FLAG_STATE_LABELS[trace.flag.state]}
        </StatusBadge>
      ),
    },
    {
      key: "clearance",
      header: "放行",
      render: (trace) =>
        trace.flag.state !== "open" ? (
          <span className="muted-copy">不阻挡</span>
        ) : trace.blockingClearance ? (
          <StatusBadge tone="critical">阻挡中</StatusBadge>
        ) : (
          <StatusBadge tone="positive">不阻挡</StatusBadge>
        ),
    },
    {
      key: "resolvedOn",
      header: "处理时间 / 说明",
      render: (trace) =>
        trace.flag.state === "open" ? (
          <span className="muted-copy">待处理</span>
        ) : (
          <span
            className="flag-cell-resolution"
            title={trace.flag.resolutionNote}
          >
            <small>{formatTimestamp(trace.flag.resolvedOn)}</small>
            <span className="flag-cell-note">
              {trace.flag.resolutionNote}
            </span>
          </span>
        ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="标记治理"
        title="标记工作台"
        description="跨全部试验追溯开放、已解决和已豁免的生长标记。这里的处理直接更新同一份工作区状态，观测页与放行结果会立即同步。"
      />

      <section className="metric-grid flag-summary-grid">
        <MetricCard
          label="筛选结果"
          value={counts.total}
          detail="当前筛选下的标记总数"
          accent="neutral"
        />
        <MetricCard
          label="未处理"
          value={counts.open}
          detail="仍可在此处理"
          accent={counts.open > 0 ? "critical" : "positive"}
        />
        <MetricCard
          label="阻挡放行"
          value={counts.blocking}
          detail="未处理且试验未放行"
          accent={counts.blocking > 0 ? "critical" : "positive"}
        />
        <MetricCard
          label="已解决 / 已豁免"
          value={`${counts.resolved} / ${counts.waived}`}
          detail="历史处理说明只读保留"
          accent="neutral"
        />
      </section>

      <section className="control-strip flag-filter-bar">
        <SearchInput
          placeholder="搜索代码、说明、材料或处理记录"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          data-testid="flag-search"
        />
        <select
          className="compact-select"
          aria-label="按试验筛选"
          value={filters.trialId}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              trialId: event.target.value,
              // 切换试验后清空已不适用的材料筛选。
              accessionId: "",
            }))
          }
          data-testid="flag-trial-filter"
        >
          <option value="">全部试验</option>
          {state.trials.map((trial) => (
            <option key={trial.id} value={trial.id}>
              {trial.code} - {trial.cropFamily}
            </option>
          ))}
        </select>
        <select
          className="compact-select"
          aria-label="按材料筛选"
          value={filters.accessionId}
          onChange={(event) => updateFilter("accessionId", event.target.value)}
          data-testid="flag-accession-filter"
        >
          <option value="">全部材料</option>
          {accessionsForTrial.map((accession) => (
            <option key={accession.id} value={accession.id}>
              {accession.accessionNo} - {accession.cultivar}
            </option>
          ))}
        </select>
        <select
          className="compact-select"
          aria-label="按严重程度筛选"
          value={filters.severity}
          onChange={(event) =>
            updateFilter(
              "severity",
              event.target.value as FlagFilters["severity"],
            )
          }
          data-testid="flag-severity-filter"
        >
          <option value="">全部严重程度</option>
          <option value="critical">严重</option>
          <option value="warning">警告</option>
          <option value="info">提示</option>
        </select>
        <select
          className="compact-select"
          aria-label="按代码筛选"
          value={filters.code}
          onChange={(event) => updateFilter("code", event.target.value)}
          data-testid="flag-code-filter"
        >
          <option value="">全部代码</option>
          {codes.map((code) => (
            <option key={code} value={code}>
              {code} - {flagCodeLabel(code)}
            </option>
          ))}
        </select>
        <div className="flag-date-filter">
          <label>
            <span>起</span>
            <input
              type="date"
              className="compact-date"
              aria-label="创建时间起"
              value={filters.from}
              max={filters.to || undefined}
              onChange={(event) => updateFilter("from", event.target.value)}
              data-testid="flag-date-from"
            />
          </label>
          <label>
            <span>止</span>
            <input
              type="date"
              className="compact-date"
              aria-label="创建时间止"
              value={filters.to}
              min={filters.from || undefined}
              onChange={(event) => updateFilter("to", event.target.value)}
              data-testid="flag-date-to"
            />
          </label>
        </div>
        <SegmentedTabs
          label="按状态筛选"
          value={filters.state as StateSegment}
          onChange={(value) => updateFilter("state", value as FlagState | "")}
          options={[
            { value: "", label: "全部" },
            { value: "open", label: "未处理" },
            { value: "resolved", label: "已解决" },
            { value: "waived", label: "已豁免" },
          ]}
        />
        <Button
          tone="ghost"
          size="sm"
          onClick={resetFilters}
          disabled={!hasActiveFilters}
          data-testid="flag-reset-filters"
        >
          <RotateCcw size={14} />
          重置
        </Button>
      </section>

      <section className="content-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-title">标记台账</span>
            <span className="panel-subtitle">
              {traces.length} 条标记中显示 {filtered.length} 条 · 点击任意行查看
              来源观测、受影响材料与放行影响
            </span>
          </div>
          <Flag size={20} className="panel-icon" aria-hidden="true" />
        </div>
        {filtered.length === 0 ? (
          <EmptyState
            icon={ShieldCheck}
            title={hasActiveFilters ? "没有匹配的标记" : "还没有标记"}
            description={
              hasActiveFilters
                ? "请调整试验、材料、严重程度、代码、状态或时间筛选条件。"
                : "记录生长观测后，系统会根据测量边界自动派生标记。"
            }
            action={
              hasActiveFilters ? (
                <Button tone="secondary" size="sm" onClick={resetFilters}>
                  清除筛选
                </Button>
              ) : (
                <Link to="/observations" className="trace-link">
                  前往记录观测
                </Link>
              )
            }
          />
        ) : (
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(trace) => trace.flag.id}
            emptyMessage="当前筛选下没有标记。"
            onRowClick={(trace) => setSelectedId(trace.flag.id)}
            rowTestId={(trace) => `flag-row-${trace.flag.id}`}
          />
        )}
      </section>

      <FlagDetailDialog
        trace={selectedTrace}
        onClose={() => setSelectedId(undefined)}
        onTransited={(message) =>
          pushToast({ tone: "success", title: "标记已处理", message })
        }
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
