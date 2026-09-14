import { Check, TriangleAlert, X } from "lucide-react";
import { Button } from "../../components/Button";
import { ProgressBar } from "../../components/ProgressBar";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import type { Accession, Bench } from "../../domain/types";
import { canAssignAccession } from "../../domain/bench";
import { isBenchCompatible, lightProfileLabel } from "../../domain/rules";

interface BenchCardProps {
  bench: Bench;
  accessions: Accession[];
  selectedAccession?: Accession;
  onAssign: (accessionId: string, benchId: string) => void;
  onRelease: (accessionId: string, benchId: string) => void;
}

export function BenchCard({
  bench,
  accessions,
  selectedAccession,
  onAssign,
  onRelease,
}: BenchCardProps) {
  const assigned = accessions.filter((accession) =>
    bench.assignedIds.includes(accession.id),
  );
  const freeSlots = Math.max(0, bench.capacity - assigned.length);
  const compatible = Boolean(
    selectedAccession && canAssignAccession(selectedAccession, bench),
  );
  const conflicting = assigned.filter(
    (accession) => !isBenchCompatible(accession, bench),
  );
  const hasConflict = conflicting.length > 0;

  return (
    <article
      className={`bench-card ${compatible ? "bench-card-compatible" : ""} ${
        hasConflict ? "bench-card-conflict" : ""
      }`}
      data-testid={`bench-card-${bench.id}`}
    >
      <header className="bench-card-header">
        <div>
          <span className="bench-code">{bench.code}</span>
          <h3>{bench.sector}</h3>
        </div>
        <StatusBadge tone={statusTone(bench.status)}>
          {bench.status === "assigned"
            ? "已分配"
            : bench.status === "blocked"
              ? "受限"
              : bench.status === "quarantine"
                ? "隔离"
                : "可用"}
        </StatusBadge>
      </header>
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
      <div className="bench-assignments">
        {assigned.length === 0 ? (
          <p className="muted-copy">暂无分配材料。</p>
        ) : (
          assigned.map((accession) => {
            const rowConflict = !isBenchCompatible(accession, bench);
            return (
              <div
                className={`bench-accession-row ${
                  rowConflict ? "bench-accession-row-conflict" : ""
                }`}
                key={accession.id}
                data-testid={`bench-row-${accession.id}`}
              >
                <div>
                  <strong>{accession.cultivar}</strong>
                  <span>{accession.accessionNo}</span>
                  {rowConflict ? (
                    <span
                      className="bench-accession-conflict"
                      data-testid={`bench-light-conflict-${accession.id}`}
                    >
                      <TriangleAlert size={12} aria-hidden="true" />
                      材料需{lightProfileLabel(
                        accession.preferredLight,
                      )}，台架为{lightProfileLabel(
                        bench.lightProfile,
                      )}，光照冲突，请移出
                    </span>
                  ) : null}
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
            );
          })
        )}
      </div>
      <footer className="bench-card-footer">
        {bench.status === "blocked" ? (
          <p className="bench-reason">{bench.blockedReason}</p>
        ) : null}
        {hasConflict ? (
          <p className="bench-reason" data-testid={`bench-conflict-summary-${bench.id}`}>
            {conflicting.length} 个材料与台架光照不兼容，需移出后重新分配
          </p>
        ) : null}
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
      </footer>
    </article>
  );
}
