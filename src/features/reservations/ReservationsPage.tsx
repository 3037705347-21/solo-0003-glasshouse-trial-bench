import { useMemo, useState } from "react";
import { CalendarClock, ChevronDown, PencilRuler, Plus } from "lucide-react";
import { Button } from "../../components/Button";
import { DataTable, type DataColumn } from "../../components/DataTable";
import { Dialog } from "../../components/Dialog";
import { PageHeader } from "../../components/PageHeader";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { StatusBadge } from "../../components/StatusBadge";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import {
  cancelReservation,
  overallPlanningWindow,
  planBenchCapacity,
  RESERVATION_INVALID_REASONS,
  type ReservationEvaluation,
} from "../../domain/reservation";
import type { BenchReservation } from "../../domain/types";
import {
  reservationEvaluations,
  reservationStatusCounts,
  trialById,
} from "../../state/selectors";
import { useWorkspace } from "../../state/store";
import { BenchCapacityCard } from "./BenchCapacityCard";
import { BenchForm } from "./BenchForm";
import { ReservationForm } from "./ReservationForm";

type ReservationSegment =
  | "all"
  | "valid"
  | "conflict"
  | "invalid"
  | "cancelled";

const VERDICT_LABEL: Record<ReservationEvaluation["verdict"], string> = {
  valid: "有效",
  conflict: "冲突",
  invalid: "失效",
  cancelled: "已取消",
};

const VERDICT_TONE: Record<
  ReservationEvaluation["verdict"],
  "positive" | "critical" | "warning" | "neutral"
> = {
  valid: "positive",
  conflict: "critical",
  invalid: "warning",
  cancelled: "neutral",
};

export function ReservationsPage() {
  const { state, dispatch } = useWorkspace();
  const [segment, setSegment] = useState<ReservationSegment>("all");
  const [trialFilter, setTrialFilter] = useState("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [maintainBenchId, setMaintainBenchId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 5200);
  };

  const evaluations = useMemo(
    () => reservationEvaluations(state),
    [state],
  );
  const counts = useMemo(
    () => reservationStatusCounts(evaluations),
    [evaluations],
  );

  const planningWindow = useMemo(
    () => overallPlanningWindow(state),
    [state],
  );

  const capacityPlans = useMemo(
    () =>
      new Map(
        state.benches.map((bench) => [
          bench.id,
          planBenchCapacity(state, planningWindow, bench),
        ]),
      ),
    [state, planningWindow],
  );

  const toggleExpanded = (id: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleCancel = (reservationId: string) => {
    const result = cancelReservation(state, reservationId);
    if (!result.ok) {
      pushToast({
        tone: "error",
        title: "取消预留失败",
        message: result.errors[0]?.message,
      });
      return;
    }
    dispatch({
      type: "reservation/cancelled",
      reservation: result.value,
    });
    pushToast({
      tone: "success",
      title: "预留已取消",
      message:
        "未履约槽位已释放；已实际分配的材料仍保留在台架上，未受影响。",
    });
  };

  const rows = useMemo(() => {
    return state.reservations
      .map((reservation) => evaluations.get(reservation.id))
      .filter(
        (evaluation): evaluation is ReservationEvaluation =>
          Boolean(evaluation),
      )
      .filter((evaluation) =>
        segment === "all" ? true : evaluation.verdict === segment,
      )
      .filter((evaluation) =>
        trialFilter === "all"
          ? true
          : evaluation.reservation.trialId === trialFilter,
      )
      .sort((left, right) =>
        right.reservation.bookedOn.localeCompare(left.reservation.bookedOn),
      );
  }, [state.reservations, evaluations, segment, trialFilter]);

  const columns: Array<DataColumn<ReservationEvaluation>> = [
    {
      key: "code",
      header: "预留",
      render: (evaluation) => (
        <button
          type="button"
          className="reservation-expand"
          onClick={() => toggleExpanded(evaluation.reservation.id)}
          data-testid={`expand-reservation-${evaluation.reservation.id}`}
        >
          <ChevronDown
            size={14}
            className={
              expanded.has(evaluation.reservation.id)
                ? "reservation-chevron-open"
                : "reservation-chevron"
            }
          />
          <span className="table-primary">{evaluation.reservation.code}</span>
        </button>
      ),
    },
    {
      key: "trial",
      header: "试验",
      render: (evaluation) => {
        const trial = trialById(state, evaluation.reservation.trialId);
        return trial ? `${trial.code} · ${trial.cropFamily}` : "未知试验";
      },
    },
    {
      key: "bench",
      header: "台架 / 区域",
      render: (evaluation) => {
        const bench = state.benches.find(
          (item) => item.id === evaluation.reservation.benchId,
        );
        return bench
          ? `${bench.code} · ${bench.sector}`
          : `${evaluation.reservation.benchCode}（已删除）`;
      },
    },
    {
      key: "window",
      header: "时间段",
      render: (evaluation) =>
        `${evaluation.reservation.startDate} ~ ${evaluation.reservation.endDate}`,
    },
    {
      key: "slots",
      header: "槽位（已履约）",
      render: (evaluation) =>
        `${evaluation.reservation.slots}（${evaluation.consumedSlots}）`,
    },
    {
      key: "status",
      header: "判定",
      render: (evaluation) => (
        <StatusBadge tone={VERDICT_TONE[evaluation.verdict]}>
          {VERDICT_LABEL[evaluation.verdict]}
        </StatusBadge>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (evaluation) =>
        evaluation.verdict === "cancelled" ? (
          <span className="muted-copy">—</span>
        ) : (
          <Button
            tone="danger"
            size="sm"
            onClick={() => handleCancel(evaluation.reservation.id)}
            data-testid={`cancel-reservation-${evaluation.reservation.id}`}
          >
            取消预留
          </Button>
        ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="台架产能"
        title="台架容量预留"
        description="按试验、时间段、区域、光照和台架维护状态预留产能；实际分配会消耗预留且不会把预留伪装成真实占用。"
        actions={
          <Button
            onClick={() => setCreateOpen(true)}
            data-testid="open-create-reservation"
          >
            <Plus size={16} />
            登记预留
          </Button>
        }
      />

      <section className="content-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-title">
              计划期 {planningWindow.startDate} ~ {planningWindow.endDate}
            </span>
            <span className="panel-subtitle">
              每个台架在计划期间的峰值占用与最少可分配空间（深色=真实材料，浅色=未履约预留）
            </span>
          </div>
          <PencilRuler size={20} className="panel-icon" aria-hidden="true" />
        </div>
        <div className="capacity-grid">
          {[...state.benches]
            .sort((left, right) => left.code.localeCompare(right.code))
            .map((bench) => (
              <BenchCapacityCard
                key={bench.id}
                bench={bench}
                plan={capacityPlans.get(bench.id)!}
                onMaintain={setMaintainBenchId}
              />
            ))}
        </div>
      </section>

      <section className="control-strip">
        <select
          className="compact-select"
          value={trialFilter}
          onChange={(event) => setTrialFilter(event.target.value)}
          aria-label="按试验筛选预留"
          data-testid="reservation-trial-filter"
        >
          <option value="all">全部试验</option>
          {state.trials.map((trial) => (
            <option value={trial.id} key={trial.id}>
              {trial.code} - {trial.cropFamily}
            </option>
          ))}
        </select>
        <SegmentedTabs
          label="按判定状态筛选预留"
          value={segment}
          onChange={setSegment}
          options={[
            { value: "all", label: `全部 ${state.reservations.length}` },
            { value: "valid", label: `有效 ${counts.valid}` },
            { value: "conflict", label: `冲突 ${counts.conflict}` },
            { value: "invalid", label: `失效 ${counts.invalid}` },
            { value: "cancelled", label: `已取消 ${counts.cancelled}` },
          ]}
        />
      </section>

      <section className="content-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-title">预留登记</span>
            <span className="panel-subtitle">
              台架容量、区域、光照或维护状态变化后，旧预留会在此自动重新判定。
            </span>
          </div>
          <CalendarClock size={20} className="panel-icon" aria-hidden="true" />
        </div>
        <DataTable
          columns={columns}
          rows={rows}
          rowKey={(evaluation) => evaluation.reservation.id}
          emptyMessage="当前筛选下没有预留记录。"
        />
        <div className="reservation-detail-list">
          {rows
            .filter((evaluation) => expanded.has(evaluation.reservation.id))
            .map((evaluation) => (
              <ReservationDetail
                key={evaluation.reservation.id}
                evaluation={evaluation}
              />
            ))}
        </div>
      </section>

      <Dialog
        open={createOpen}
        title="登记台架容量预留"
        onClose={() => setCreateOpen(false)}
        wide
      >
        <ReservationForm
          trialId={state.trials[0]?.id ?? ""}
          onCancel={() => setCreateOpen(false)}
          onSaved={({ duplicate, verdict, code }) => {
            setCreateOpen(false);
            if (duplicate) {
              pushToast({
                tone: "info",
                title: "请求已存在",
                message: `同一请求已登记为 ${code}，未重复占用容量。`,
              });
              return;
            }
            if (verdict === "conflict") {
              pushToast({
                tone: "warning",
                title: "预留已登记，但存在冲突",
                message: `${code} 与其他预留或试验占用重叠，请展开记录查看冲突方。`,
              });
            } else if (verdict === "invalid") {
              pushToast({
                tone: "warning",
                title: "预留已登记，但当前失效",
                message: `${code} 因台架状态或属性变化失效，调整台架后会重新判定。`,
              });
            } else {
              pushToast({
                tone: "success",
                title: "预留已登记",
                message: `${code} 当前有效，实际分配材料时会优先消耗该预留。`,
              });
            }
          }}
        />
      </Dialog>

      <Dialog
        open={Boolean(maintainBenchId)}
        title="维护台架（容量 / 状态 / 区域 / 光照）"
        onClose={() => setMaintainBenchId(null)}
      >
        {maintainBenchId ? (
          <BenchForm
            benchId={maintainBenchId}
            onCancel={() => setMaintainBenchId(null)}
            onSaved={(changed) => {
              setMaintainBenchId(null);
              pushToast(
                changed
                  ? {
                      tone: "success",
                      title: "台架已更新",
                      message: "相关旧预留已重新判定为有效、冲突或失效。",
                    }
                  : {
                      tone: "info",
                      title: "台架无变化",
                      message: "未检测到容量或状态变更，预留判定保持不变。",
                    },
              );
            }}
          />
        ) : null}
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

function ReservationDetail({
  evaluation,
}: {
  evaluation: ReservationEvaluation;
}) {
  const { state } = useWorkspace();
  const reservation: BenchReservation = evaluation.reservation;
  const bench = state.benches.find((item) => item.id === reservation.benchId);

  return (
    <article className="reservation-detail" data-testid={`detail-${reservation.id}`}>
      <header>
        <strong>{reservation.code}</strong>
        <StatusBadge tone={VERDICT_TONE[evaluation.verdict]}>
          {VERDICT_LABEL[evaluation.verdict]}
        </StatusBadge>
      </header>
      {reservation.note ? <p>{reservation.note}</p> : null}
      <dl className="reservation-meta">
        <div>
          <dt>登记光照快照</dt>
          <dd>
            {reservation.lightProfileSnapshot === "full-sun"
              ? "全日照"
              : reservation.lightProfileSnapshot === "partial-shade"
                ? "半阴"
                : "遮阴"}
          </dd>
        </div>
        <div>
          <dt>登记维护状态</dt>
          <dd>
            {reservation.benchStatusSnapshot === "blocked"
              ? "停用维护"
              : reservation.benchStatusSnapshot === "quarantine"
                ? "隔离"
                : reservation.benchStatusSnapshot === "assigned"
                  ? "已分配运行"
                  : "可用"}
          </dd>
        </div>
        <div>
          <dt>当前台架</dt>
          <dd>{bench ? `${bench.code} · ${bench.sector}` : "已删除"}</dd>
        </div>
      </dl>
      {evaluation.verdict === "invalid" ? (
        <ul className="reservation-issue-list" data-testid="reservation-invalid-reasons">
          {evaluation.reasons.map((reason) => (
            <li key={reason}>{RESERVATION_INVALID_REASONS[reason]}</li>
          ))}
        </ul>
      ) : null}
      {evaluation.verdict === "conflict" ? (
        <div className="reservation-conflicts" data-testid="reservation-conflicts">
          <p>计划期内与以下预留或试验占用重叠，合计突破台架总容量：</p>
          <ul className="reservation-issue-list">
            {evaluation.conflicts.map((conflict, index) => (
              <li key={`${conflict.kind}-${index}`}>{conflict.label}</li>
            ))}
          </ul>
        </div>
      ) : null}
      {reservation.consumedAccessionIds.length > 0 ? (
        <p className="muted-copy">
          已履约材料：
          {reservation.consumedAccessionIds
            .map((accessionId) => {
              const accession = state.accessions.find(
                (item) => item.id === accessionId,
              );
              const stillOnBench = bench?.assignedIds.includes(accessionId);
              return accession
                ? `${accession.accessionNo} ${accession.cultivar}${stillOnBench ? "" : "（已移出）"}`
                : accessionId;
            })
            .join("、")}
        </p>
      ) : null}
    </article>
  );
}
