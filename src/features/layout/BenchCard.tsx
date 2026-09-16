import { useNavigate } from "react-router-dom";
import { Check, ClipboardPenLine, TriangleAlert, X } from "lucide-react";
import { Button } from "../../components/Button";
import { ProgressBar } from "../../components/ProgressBar";
import { StatusBadge } from "../../components/StatusBadge";
import type { Accession, Bench, BenchInspection } from "../../domain/types";
import { canAssignAccession } from "../../domain/bench";
import {
  BENCH_IMPACT_LABELS,
  benchInspectionCategoryLabel,
  isBlockingBenchInspection,
} from "../../domain/benchInspection";
import { isAccessionRetired } from "../../domain/accession";

interface BenchCardProps {
  bench: Bench;
  accessions: Accession[];
  selectedAccession?: Accession;
  openInspections: BenchInspection[];
  onAssign: (accessionId: string, benchId: string) => void;
  onRelease: (accessionId: string, benchId: string) => void;
}

function benchStatusLabel(status: Bench["status"]): string {
  return status === "assigned"
    ? "已分配"
    : status === "blocked"
      ? "受限"
      : status === "quarantine"
        ? "隔离"
        : "可用";
}

function benchStatusTone(
  status: Bench["status"],
): "positive" | "critical" | "warning" | "neutral" {
  if (status === "blocked" || status === "quarantine") {
    return "critical";
  }
  if (status === "assigned") {
    return "positive";
  }
  return "neutral";
}

export function BenchCard({
  bench,
  accessions,
  selectedAccession,
  openInspections,
  onAssign,
  onRelease,
}: BenchCardProps) {
  const navigate = useNavigate();
  const assigned = accessions.filter((accession) =>
    bench.assignedIds.includes(accession.id),
  );
  const freeSlots = Math.max(0, bench.capacity - assigned.length);
  const blocking = openInspections.some(isBlockingBenchInspection);
  const compatible = Boolean(
    selectedAccession &&
      canAssignAccession(selectedAccession, bench, openInspections.length ? openInspections : []),
  );

  return (
    <article
      className={`bench-card ${compatible ? "bench-card-compatible" : ""} ${
        blocking ? "bench-card-inspection-blocking" : openInspections.length > 0 ? "bench-card-inspection-caution" : ""
      }`}
      data-testid={`bench-card-${bench.id}`}
    >
      <header className="bench-card-header">
        <div>
          <span className="bench-code">{bench.code}</span>
          <h3>{bench.sector}</h3>
        </div>
        <StatusBadge tone={benchStatusTone(bench.status)}>
          {benchStatusLabel(bench.status)}
        </StatusBadge>
      </header>
      {openInspections.length > 0 ? (
        <button
          type="button"
          className={`inspection-chip inspection-chip-${
            blocking ? "blocking" : "caution"
          }`}
          onClick={() => navigate(`/benches/${bench.id}/inspections`)}
          data-testid={`bench-inspection-chip-${bench.id}`}
        >
          <TriangleAlert size={14} aria-hidden="true" />
          <span>
            {blocking ? "影响使用 · 暂停分配" : "需留意"} ·{" "}
            {openInspections.length} 项未解除
          </span>
        </button>
      ) : null}
      <dl className="bench-meta">
        <div>
          <dt>光照</dt>
          <dd>
            {bench.lightProfile === "full-sun"
              ? "全日照"
              : bench.lightProfile === "partial-shade"
                ? "半阴"
                : "遮阴"}
          </dd>
        </div>
        <div>
          <dt>管路</dt>
          <dd>{bench.irrigationLine}</dd>
        </div>
        <div>
          <dt>空位</dt>
          <dd>{freeSlots}</dd>
        </div>
      </dl>
      <ProgressBar
        value={assigned.length}
        max={bench.capacity}
        tone={freeSlots === 0 ? "critical" : freeSlots === 1 ? "warning" : "positive"}
      />
      {openInspections.length > 0 ? (
        <ul className="bench-inspection-lines" data-testid={`bench-inspection-lines-${bench.id}`}>
          {openInspections.map((inspection) => (
            <li
              key={inspection.id}
              className={
                isBlockingBenchInspection(inspection)
                  ? "bench-inspection-line-blocking"
                  : "bench-inspection-line-caution"
              }
            >
              <strong>
                {benchInspectionCategoryLabel(inspection.category)} ·{" "}
                {BENCH_IMPACT_LABELS[inspection.impact]}
              </strong>
              <span>{inspection.anomalyDescription}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="bench-assignments">
        {assigned.length === 0 ? (
          <p className="muted-copy">暂无分配材料。</p>
        ) : (
          assigned.map((accession) => (
            <div className="bench-accession-row" key={accession.id}>
              <div>
                <strong>{accession.cultivar}</strong>
                <span>
                  {accession.accessionNo}
                  {isAccessionRetired(accession) ? " · 已停用" : ""}
                </span>
              </div>
              <Button
                tone="ghost"
                size="sm"
                className="icon-button"
                onClick={() => onRelease(accession.id, bench.id)}
                aria-label={`将 ${accession.cultivar} 从台架 ${bench.code} 移出`}
              >
                <X size={16} />
              </Button>
            </div>
          ))
        )}
      </div>
      <footer className="bench-card-footer">
        {bench.status === "blocked" ? (
          <p className="bench-reason">{bench.blockedReason}</p>
        ) : null}
        <div className="bench-footer-actions">
          <Button
            tone="ghost"
            size="sm"
            onClick={() => navigate(`/benches/${bench.id}/inspections`)}
            data-testid={`bench-inspections-${bench.id}`}
          >
            <ClipboardPenLine size={15} />
            巡检
          </Button>
          <Button
            tone="secondary"
            size="sm"
            disabled={!selectedAccession || !compatible}
            onClick={() => selectedAccession && onAssign(selectedAccession.id, bench.id)}
            data-testid={`assign-bench-${bench.id}`}
          >
            <Check size={15} />
            分配
          </Button>
        </div>
      </footer>
    </article>
  );
}
