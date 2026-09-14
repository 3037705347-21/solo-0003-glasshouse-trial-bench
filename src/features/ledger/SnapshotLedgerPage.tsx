import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Archive,
  ArrowLeft,
  History,
  Link2,
  Lock,
  Search,
} from "lucide-react";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { SearchInput } from "../../components/SearchInput";
import { StatusBadge } from "../../components/StatusBadge";
import {
  analyzeSnapshot,
  formatSnapshotTime,
  resolveSnapshotReferences,
  sortSnapshotsNewestFirst,
  trialStateLabel,
  type SnapshotAnalysis,
} from "../../domain/snapshotLedger";
import { useWorkspace } from "../../state/store";
import { SnapshotDetailDialog } from "./SnapshotDetailDialog";

type ResultFilter = "all" | "ready" | "blocked";
type FreshnessFilter = "all" | "current" | "stale" | "unverifiable";

const freshnessMeta = {
  current: { label: "与当前一致", tone: "positive" as const },
  stale: { label: "已过期", tone: "warning" as const },
  unverifiable: { label: "无法核对", tone: "neutral" as const },
};

export function SnapshotLedgerPage() {
  const { state } = useWorkspace();
  const [trialFilter, setTrialFilter] = useState("all");
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [freshnessFilter, setFreshnessFilter] =
    useState<FreshnessFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const analyses = useMemo<SnapshotAnalysis[]>(() => {
    const sorted = sortSnapshotsNewestFirst(state.clearanceSnapshots);
    return sorted.map((snapshot) => analyzeSnapshot(state, snapshot));
  }, [state]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return analyses.filter((analysis) => {
      const { snapshot, trial } = analysis;
      if (trialFilter !== "all" && snapshot.trialId !== trialFilter) {
        return false;
      }
      if (resultFilter !== "all" && snapshot.status !== resultFilter) {
        return false;
      }
      if (
        freshnessFilter !== "all" &&
        analysis.freshness !== freshnessFilter
      ) {
        return false;
      }
      if (needle) {
        const haystack = [
          snapshot.id,
          trial?.code ?? "",
          trial?.cropFamily ?? "",
          ...snapshot.blockers.map((blocker) => blocker.code),
        ]
          .join(" ")
          .toLocaleLowerCase();
        if (!haystack.includes(needle)) {
          return false;
        }
      }
      return true;
    });
  }, [analyses, trialFilter, resultFilter, freshnessFilter, query]);

  const selected = selectedId
    ? analyses.find((analysis) => analysis.snapshot.id === selectedId)
    : undefined;

  const missingTrialOptions = useMemo(() => {
    const known = new Set(state.trials.map((trial) => trial.id));
    const options = analyses
      .filter((analysis) => !known.has(analysis.snapshot.trialId))
      .map((analysis) => {
        const capture = analysis.snapshot.capture;
        return {
          id: analysis.snapshot.trialId,
          label: capture
            ? `${capture.trial.code} · ${capture.trial.cropFamily}（试验已删除）`
            : `${analysis.snapshot.trialId}（试验已删除）`,
        };
      });
    // 同一已删除试验可能有多份快照，去重。
    return options.filter(
      (option, index) =>
        options.findIndex((item) => item.id === option.id) === index,
    );
  }, [state.trials, analyses]);

  return (
    <div className="page">
      <PageHeader
        eyebrow="试验放行"
        title="放行快照台账"
        description="按生成时间回看每次放行的试验状态、指标、阻止项与引用关系。记录只读，永不删除或重算。"
        actions={
          <Link className="button button-secondary button-md" to="/clearance">
            <ArrowLeft size={16} />
            返回放行检查
          </Link>
        }
      />

      <section className="ledger-toolbar content-panel">
        <select
          className="compact-select"
          aria-label="按试验筛选"
          value={trialFilter}
          onChange={(event) => setTrialFilter(event.target.value)}
          data-testid="ledger-trial-filter"
        >
          <option value="all">全部试验</option>
          {state.trials.map((trial) => (
            <option value={trial.id} key={trial.id}>
              {trial.code} · {trial.cropFamily}
            </option>
          ))}
          {missingTrialOptions.map((option) => (
            <option value={option.id} key={option.id}>
              {option.label}
            </option>
          ))}
        </select>

        <select
          className="compact-select"
          aria-label="按放行结果筛选"
          value={resultFilter}
          onChange={(event) =>
            setResultFilter(event.target.value as ResultFilter)
          }
          data-testid="ledger-result-filter"
        >
          <option value="all">全部结果</option>
          <option value="ready">仅就绪</option>
          <option value="blocked">仅阻止</option>
        </select>

        <select
          className="compact-select"
          aria-label="按新鲜度筛选"
          value={freshnessFilter}
          onChange={(event) =>
            setFreshnessFilter(event.target.value as FreshnessFilter)
          }
          data-testid="ledger-freshness-filter"
        >
          <option value="all">全部时效</option>
          <option value="current">与当前一致</option>
          <option value="stale">已过期</option>
          <option value="unverifiable">无法核对</option>
        </select>

        <SearchInput
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索快照编号、试验或阻止项编码"
          aria-label="搜索快照"
          data-testid="ledger-search"
        />

        <span className="ledger-count" data-testid="ledger-count">
          共 {filtered.length} / {analyses.length} 份快照
        </span>
      </section>

      {analyses.length === 0 ? (
        <EmptyState
          icon={Archive}
          title="还没有放行快照"
          description="每次在放行检查页生成快照后，都会在这里留下一条只读记录，可按时间回看当时的状态、指标和阻止项。"
          action={
            <Link className="button button-primary button-md" to="/clearance">
              <History size={16} />
              前往放行检查
            </Link>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Search}
          title="没有匹配的快照"
          description="当前筛选条件下没有快照，请调整试验、结果或时效筛选。"
        />
      ) : (
        <section className="content-panel">
          <div className="data-table-wrap">
            <table className="data-table ledger-table">
              <thead>
                <tr>
                  <th>生成时间</th>
                  <th>试验</th>
                  <th>结果</th>
                  <th>指标</th>
                  <th>阻止项</th>
                  <th>时效</th>
                  <th>引用</th>
                  <th aria-label="操作" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((analysis) => (
                  <LedgerRow
                    key={analysis.snapshot.id}
                    analysis={analysis}
                    onOpen={() => setSelectedId(analysis.snapshot.id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
          <p className="ledger-footnote">
            <Lock size={13} aria-hidden="true" />
            台账记录在生成时冻结，后续修改材料、台架或处理标记不会改写旧快照，
            只会改变其“时效”标记。
          </p>
        </section>
      )}

      {selected ? (
        <SnapshotDetailDialog
          snapshot={selected.snapshot}
          analysis={selected}
          references={resolveSnapshotReferences(
            state,
            selected.snapshot,
            selected,
          )}
          onClose={() => setSelectedId(null)}
        />
      ) : null}
    </div>
  );
}

function LedgerRow({
  analysis,
  onOpen,
}: {
  analysis: SnapshotAnalysis;
  onOpen: () => void;
}) {
  const { snapshot, trial, freshness, drifts } = analysis;
  const metricSummary = snapshot.metrics
    .map((metric) => `${metric.label} ${metric.value}`)
    .join(" · ");
  const capturedState = snapshot.capture?.trial.state;
  const freshnessInfo = freshnessMeta[freshness];
  const referenceCount = snapshot.capture
    ? snapshot.capture.accessions.length +
      snapshot.capture.benches.length +
      snapshot.capture.flags.length +
      snapshot.capture.observationPasses.length
    : snapshot.blockers.reduce(
        (count, blocker) =>
          count + (blocker.accessionId || blocker.benchId ? 1 : 0),
        0,
      );

  return (
    <tr data-testid={`ledger-row-${snapshot.id}`}>
      <td>
        <span className="ledger-time">
          {formatSnapshotTime(snapshot.generatedOn)}
        </span>
        <span className="ledger-id">{snapshot.id}</span>
      </td>
      <td>
        {trial ? (
          <>
            <strong>{trial.code}</strong>
            <span className="ledger-sub">
              {trial.cropFamily} · 当前{trialStateLabel(trial.state)}
            </span>
          </>
        ) : (
          <>
            <strong>{snapshot.trialId}</strong>
            <StatusBadge tone="critical">试验已不存在</StatusBadge>
          </>
        )}
        {capturedState ? (
          <span className="ledger-sub">
            当时{trialStateLabel(capturedState)}
          </span>
        ) : null}
      </td>
      <td>
        <StatusBadge tone={snapshot.status === "ready" ? "positive" : "critical"}>
          {snapshot.status === "ready" ? "就绪" : "阻止"}
        </StatusBadge>
      </td>
      <td>
        <span className="ledger-metrics">{metricSummary}</span>
      </td>
      <td>
        {snapshot.blockers.length === 0 ? (
          <span className="ledger-sub">无阻止项</span>
        ) : (
          <>
            <strong>{snapshot.blockers.length} 个</strong>
            <span className="ledger-sub">
              {snapshot.blockers
                .slice(0, 2)
                .map((blocker) => blocker.code)
                .join("、")}
              {snapshot.blockers.length > 2 ? " …" : ""}
            </span>
          </>
        )}
      </td>
      <td>
        <StatusBadge tone={freshnessInfo.tone}>
          {freshnessInfo.label}
        </StatusBadge>
        {freshness === "stale" ? (
          <span className="ledger-sub">{drifts[0]?.detail}</span>
        ) : null}
      </td>
      <td>
        <span className="ledger-refs">
          <Link2 size={13} aria-hidden="true" />
          {referenceCount} 个对象
        </span>
      </td>
      <td>
        <button
          type="button"
          className="ledger-open-button"
          onClick={onOpen}
          data-testid={`open-snapshot-${snapshot.id}`}
        >
          查看引用
        </button>
      </td>
    </tr>
  );
}
