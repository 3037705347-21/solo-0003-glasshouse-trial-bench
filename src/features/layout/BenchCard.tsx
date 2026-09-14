import { Check, X } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "../../components/Button";
import { ProgressBar } from "../../components/ProgressBar";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import type { Accession, Bench } from "../../domain/types";
import {
  benchOccupancy,
  benchOperationalStatus,
  benchStatusNote,
  canAssignAccession,
} from "../../domain/bench";

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
  const occupancy = benchOccupancy(bench);
  const freeSlots = Math.max(0, bench.capacity - occupancy);
  const compatible = Boolean(
    selectedAccession && canAssignAccession(selectedAccession, bench),
  );
  const operational = benchOperationalStatus(bench);
  const statusLabel =
    operational === "available"
      ? occupancy > 0
        ? "已占用"
        : "可用"
      : operational === "blocked"
        ? "受限"
        : "隔离";
  const note = benchStatusNote(bench);

  return (
    <article
      className={`bench-card ${compatible ? "bench-card-compatible" : ""}`}
      data-testid={`bench-card-${bench.id}`}
    >
      <header className="bench-card-header">
        <div>
          <span className="bench-code">{bench.code}</span>
          <h3>{bench.sector}</h3>
        </div>
        <StatusBadge tone={statusTone(statusLabel)}>{statusLabel}</StatusBadge>
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
        value={occupancy}
        max={bench.capacity}
        tone={freeSlots === 0 ? "critical" : freeSlots === 1 ? "warning" : "positive"}
      />
      <div className="bench-assignments">
        {occupancy === 0 ? (
          <p className="muted-copy">暂无分配材料。</p>
        ) : (
          bench.assignedIds.map((accessionId) => {
            const accession = accessions.find((item) => item.id === accessionId);
            if (!accession) {
              return (
                <div className="bench-accession-row" key={accessionId}>
                  <div>
                    <strong>缺失材料</strong>
                    <span>{accessionId}</span>
                  </div>
                </div>
              );
            }
            return (
              <div className="bench-accession-row" key={accession.id}>
                <div>
                  <strong>{accession.cultivar}</strong>
                  <span>{accession.accessionNo}</span>
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
        {operational !== "available" && note ? (
          <p className="bench-reason">
            {operational === "quarantine" ? "隔离原因：" : "受限原因："}
            {note}
          </p>
        ) : null}
        {operational === "available" ? (
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
        ) : (
          <Link className="bench-ledger-link" to="/benches">
            在台账中{operational === "quarantine" ? "处理隔离" : "解除受限"}
          </Link>
        )}
      </footer>
    </article>
  );
}
