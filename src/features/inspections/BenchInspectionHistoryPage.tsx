import { useMemo, useState } from "react";
import { ArrowLeft, ClipboardPenLine, TriangleAlert } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { ProgressBar } from "../../components/ProgressBar";
import { StatusBadge } from "../../components/StatusBadge";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import {
  BENCH_LIGHT_LABELS,
  BENCH_STATUS_LABELS,
  benchStatusChangedSinceInspection,
  compareInspections,
} from "../../domain/benchInspection";
import {
  blockingInspectionsForBenchState,
  inspectionsForBenchState,
} from "../../state/selectors";
import { useWorkspace } from "../../state/store";
import { InspectionForm } from "./InspectionForm";
import { InspectionList } from "./InspectionList";

export function BenchInspectionHistoryPage() {
  const { benchId = "" } = useParams();
  const navigate = useNavigate();
  const { state } = useWorkspace();
  const [formOpen, setFormOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  };

  const bench = state.benches.find((item) => item.id === benchId);
  const inspections = useMemo(
    () =>
      inspectionsForBenchState(state, benchId)
        .slice()
        .sort(compareInspections),
    [state, benchId],
  );
  const blocking = blockingInspectionsForBenchState(state, benchId);
  const openIssues = inspections.filter(
    (inspection) => inspection.state === "open",
  );
  const benchesById = useMemo(
    () => new Map(state.benches.map((item) => [item.id, item])),
    [state.benches],
  );

  if (!bench) {
    return (
      <div className="page">
        <EmptyState
          icon={TriangleAlert}
          title="台架不存在"
          description="该台架可能已被移除，无法显示巡检历史。"
        />
        <Button tone="secondary" onClick={() => navigate("/inspections")}>
          <ArrowLeft size={16} />
          返回台架巡检
        </Button>
      </div>
    );
  }

  const occupiedAccessions = state.accessions.filter((accession) =>
    bench.assignedIds.includes(accession.id),
  );
  const driftedOpen = openIssues.filter((inspection) =>
    benchStatusChangedSinceInspection(inspection, bench),
  );

  return (
    <div className="page" data-testid="bench-inspection-page">
      <PageHeader
        eyebrow="台架巡检历史"
        title={`${bench.code} · ${bench.sector}`}
        description="该台架的全部巡检记录按时间保留；解除异常不会删除或改写任何历史条目。"
        actions={
          <>
            <Button tone="secondary" onClick={() => navigate("/inspections")}>
              <ArrowLeft size={16} />
              返回巡检
            </Button>
            <Button
              onClick={() => setFormOpen(true)}
              data-testid="open-bench-inspection-form"
            >
              <ClipboardPenLine size={16} />
              新增巡检
            </Button>
          </>
        }
      />

      <section className="history-summary-grid">
        <article className="history-summary-card">
          <span>当前运行状态</span>
          <strong>{BENCH_STATUS_LABELS[bench.status]}</strong>
          <StatusBadge
            tone={
              bench.status === "blocked" || bench.status === "quarantine"
                ? "critical"
                : "positive"
            }
          >
            {`${BENCH_LIGHT_LABELS[bench.lightProfile]} · 管路 ${bench.irrigationLine}`}
          </StatusBadge>
          {bench.blockedReason ? <small>{bench.blockedReason}</small> : null}
        </article>
        <article className="history-summary-card">
          <span>容量占用</span>
          <strong>
            {bench.assignedIds.length}/{bench.capacity}
          </strong>
          <ProgressBar
            value={bench.assignedIds.length}
            max={bench.capacity}
            tone={
              bench.assignedIds.length >= bench.capacity
                ? "critical"
                : "positive"
            }
          />
        </article>
        <article className="history-summary-card">
          <span>未解除异常</span>
          <strong>{openIssues.length}</strong>
          <small>
            {blocking.length > 0
              ? `${blocking.length} 项影响使用，新材料无法分配到该台架`
              : openIssues.length > 0
                ? "均为需留意级别，分配时请查看提示"
                : "当前没有未解除异常"}
          </small>
        </article>
        <article className="history-summary-card">
          <span>巡检次数</span>
          <strong>{inspections.length}</strong>
          <small>记录只追加，解除后仍可完整回看</small>
        </article>
      </section>

      {openIssues.length > 0 ? (
        <section
          className={`inspection-banner ${
            blocking.length > 0
              ? "inspection-banner-blocking"
              : "inspection-banner-caution"
          }`}
          data-testid="bench-inspection-banner"
        >
          <TriangleAlert size={18} aria-hidden="true" />
          <div>
            <strong>
              {blocking.length > 0
                ? `${blocking.length} 项影响使用的异常尚未解除，已暂停该台架的新材料分配`
                : `${openIssues.length} 项需留意的异常尚未解除`}
            </strong>
            {driftedOpen.length > 0 ? (
              <p>
                {driftedOpen.length} 条巡检记录后台架状态已经变化，解除时需要重新核对。
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="content-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-title">在架材料</span>
            <span className="panel-subtitle">
              巡检异常不会自动移出或改写这些历史分配
            </span>
          </div>
        </div>
        {occupiedAccessions.length === 0 ? (
          <p className="history-empty">该台架当前没有在架材料。</p>
        ) : (
          <div className="history-list">
            {occupiedAccessions.map((accession) => {
              const trial = state.trials.find(
                (item) => item.id === accession.trialId,
              );
              return (
                <div className="history-list-row" key={accession.id}>
                  <div>
                    <strong>{accession.cultivar}</strong>
                    <span>{accession.accessionNo}</span>
                  </div>
                  <div>
                    <span>{trial ? trial.code : accession.trialId}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="content-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-title">巡检记录</span>
            <span className="panel-subtitle">
              {inspections.length} 条记录，最新在前
            </span>
          </div>
          <ClipboardPenLine size={20} className="panel-icon" aria-hidden="true" />
        </div>
        <InspectionList
          inspections={inspections}
          benchesById={benchesById}
          showBench={false}
          emptyMessage="该台架还没有巡检记录。"
        />
      </section>

      <Dialog
        open={formOpen}
        title={`新增巡检 · ${bench.code}`}
        onClose={() => setFormOpen(false)}
        wide
      >
        <InspectionForm
          bench={bench}
          onCancel={() => setFormOpen(false)}
          onSaved={() => {
            setFormOpen(false);
            pushToast({
              tone: "success",
              title: "巡检已记录",
              message: `${bench.code} 的巡检记录已追加到历史。`,
            });
          }}
        />
      </Dialog>
      <ToastRegion
        messages={toasts}
        onDismiss={(id) =>
          setToasts((current) => current.filter((item) => item.id !== id))
        }
      />
    </div>
  );
}
