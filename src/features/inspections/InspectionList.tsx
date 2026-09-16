import { useState } from "react";
import { CheckCheck, History, Wrench } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/Button";
import { StatusBadge } from "../../components/StatusBadge";
import {
  BENCH_IMPACT_LABELS,
  benchInspectionCategoryLabel,
  benchMaintenanceActionLabel,
} from "../../domain/benchInspection";
import type { Bench, BenchInspection } from "../../domain/types";
import {
  FollowUpInspectionDialog,
  ResolveInspectionDialog,
} from "./InspectionDialogs";

interface InspectionListProps {
  inspections: BenchInspection[];
  benchesById: Map<string, Bench>;
  showBench?: boolean;
  emptyMessage?: string;
}

function formatDateTime(value?: string): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function impactTone(
  inspection: BenchInspection,
): "positive" | "warning" | "critical" | "neutral" {
  if (inspection.state === "resolved") {
    return inspection.result === "normal" ? "positive" : "neutral";
  }
  if (inspection.impact === "blocking") {
    return "critical";
  }
  if (inspection.impact === "caution") {
    return "warning";
  }
  return "neutral";
}

function impactLabel(inspection: BenchInspection): string {
  if (inspection.state === "resolved") {
    return inspection.result === "normal" ? "巡检正常" : "已解除";
  }
  return BENCH_IMPACT_LABELS[inspection.impact];
}

export function InspectionList({
  inspections,
  benchesById,
  showBench = true,
  emptyMessage = "暂无巡检记录。",
}: InspectionListProps) {
  const navigate = useNavigate();
  const [resolving, setResolving] = useState<BenchInspection | undefined>();
  const [followingUp, setFollowingUp] = useState<
    BenchInspection | undefined
  >();

  if (inspections.length === 0) {
    return <p className="history-empty">{emptyMessage}</p>;
  }

  return (
    <>
      <div className="inspection-list">
        {inspections.map((inspection) => {
          const bench = benchesById.get(inspection.benchId);
          return (
            <article
              className={`inspection-entry inspection-entry-${
                inspection.state === "open" ? "open" : "resolved"
              }${
                inspection.state === "open" &&
                inspection.impact === "blocking"
                  ? " inspection-entry-blocking"
                  : ""
              }`}
              key={inspection.id}
              data-testid={`inspection-${inspection.id}`}
            >
              <header className="inspection-entry-head">
                <div>
                  <strong>
                    {benchInspectionCategoryLabel(inspection.category)}
                  </strong>
                  {showBench ? (
                    <button
                      type="button"
                      className="inspection-bench-link"
                      onClick={() =>
                        navigate(`/benches/${inspection.benchId}/inspections`)
                      }
                      data-testid={`inspection-bench-link-${inspection.id}`}
                    >
                      <History size={13} aria-hidden="true" />
                      {bench ? `${bench.code} · ${bench.sector}` : "未知台架"}
                    </button>
                  ) : (
                    <span className="muted-copy">
                      {bench ? bench.sector : "未知台架"}
                    </span>
                  )}
                </div>
                <StatusBadge tone={impactTone(inspection)}>
                  {impactLabel(inspection)}
                </StatusBadge>
              </header>
              <dl className="inspection-entry-meta">
                <div>
                  <dt>巡检日期</dt>
                  <dd>{inspection.inspectedOn}</dd>
                </div>
                <div>
                  <dt>巡检人</dt>
                  <dd>{inspection.inspector}</dd>
                </div>
                <div>
                  <dt>维护动作</dt>
                  <dd>
                    {benchMaintenanceActionLabel(inspection.maintenanceAction)}
                    {inspection.followUpCompletedAt ? " · 已完成" : " · 待处理"}
                  </dd>
                </div>
              </dl>
              {inspection.result === "issue" ? (
                <div className="inspection-entry-body">
                  <p>
                    <span>异常描述</span>
                    {inspection.anomalyDescription}
                  </p>
                  <p>
                    <span>处置建议</span>
                    {inspection.handlingSuggestion}
                  </p>
                </div>
              ) : (
                <p className="muted-copy">本次巡检一切正常。</p>
              )}
              {inspection.state === "resolved" ? (
                <div className="inspection-entry-resolution">
                  <p>
                    <span>解除说明</span>
                    {inspection.resolutionNote ?? "—"}
                  </p>
                  <p>
                    <span>解除时间</span>
                    {formatDateTime(inspection.resolvedAt)}
                    {inspection.statusRecheckedAtResolution
                      ? " · 解除时已重新核对台架状态"
                      : ""}
                  </p>
                  <p>
                    <span>维护完成</span>
                    {formatDateTime(inspection.followUpCompletedAt)}
                  </p>
                </div>
              ) : (
                <footer className="inspection-entry-actions">
                  <Button
                    tone="secondary"
                    size="sm"
                    disabled={Boolean(inspection.followUpCompletedAt)}
                    onClick={() => setFollowingUp(inspection)}
                    data-testid={`followup-inspection-${inspection.id}`}
                  >
                    <Wrench size={15} />
                    {inspection.followUpCompletedAt
                      ? "维护已登记"
                      : "登记维护完成"}
                  </Button>
                  {inspection.result === "issue" ? (
                    <Button
                      size="sm"
                      onClick={() => setResolving(inspection)}
                      data-testid={`resolve-inspection-${inspection.id}`}
                    >
                      <CheckCheck size={15} />
                      解除异常
                    </Button>
                  ) : null}
                </footer>
              )}
            </article>
          );
        })}
      </div>
      {resolving ? (
        <ResolveInspectionDialog
          inspection={resolving}
          bench={benchesById.get(resolving.benchId)}
          onCancel={() => setResolving(undefined)}
          onSaved={() => setResolving(undefined)}
        />
      ) : null}
      {followingUp ? (
        <FollowUpInspectionDialog
          inspection={followingUp}
          bench={benchesById.get(followingUp.benchId)}
          onCancel={() => setFollowingUp(undefined)}
          onSaved={() => setFollowingUp(undefined)}
        />
      ) : null}
    </>
  );
}
