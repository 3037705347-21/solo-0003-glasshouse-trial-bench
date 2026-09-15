import { Check, History, Wrench, X } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "../../components/Button";
import { ProgressBar } from "../../components/ProgressBar";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import type { Accession, Bench } from "../../domain/types";
import { canAssignAccession } from "../../domain/bench";
import { isAccessionRetired } from "../../domain/accession";
import { isBenchInMaintenanceFlow } from "../../domain/benchMaintenance";

interface BenchCardProps {
  bench: Bench;
  accessions: Accession[];
  selectedAccession?: Accession;
  onAssign: (accessionId: string, benchId: string) => void;
  onRelease: (accessionId: string, benchId: string) => void;
  onManageMaintenance: (bench: Bench) => void;
  onRequestMaintenance: (bench: Bench) => void;
}

function benchStatusLabel(bench: Bench): string {
  switch (bench.status) {
    case "assigned":
      return "已分配";
    case "blocked":
      return "受限";
    case "quarantine":
      return "隔离";
    case "maintenance-pending":
      return "待疏散";
    case "maintenance":
      return "维护中";
    default:
      return "可用";
  }
}

export function BenchCard({
  bench,
  accessions,
  selectedAccession,
  onAssign,
  onRelease,
  onManageMaintenance,
  onRequestMaintenance,
}: BenchCardProps) {
  const assigned = accessions.filter((accession) =>
    bench.assignedIds.includes(accession.id),
  );
  const freeSlots = Math.max(0, bench.capacity - assigned.length);
  const compatible = Boolean(
    selectedAccession && canAssignAccession(selectedAccession, bench),
  );
  const inMaintenanceFlow = isBenchInMaintenanceFlow(bench);

  return (
    <article
      className={`bench-card ${compatible ? "bench-card-compatible" : ""} ${
        inMaintenanceFlow ? "bench-card-maintenance" : ""
      }`}
      data-testid={`bench-card-${bench.id}`}
    >
      <header className="bench-card-header">
        <div>
          <Link
            className="bench-code bench-code-link"
            to={`/benches/${bench.id}/history`}
            data-testid={`bench-history-link-${bench.id}`}
          >
            {bench.code}
          </Link>
          <h3>{bench.sector}</h3>
        </div>
        <StatusBadge tone={statusTone(bench.status)}>
          {benchStatusLabel(bench)}
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
          <p className="muted-copy">
            {inMaintenanceFlow ? "台架已清空。" : "暂无分配材料。"}
          </p>
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
              {inMaintenanceFlow ? null : (
                <Button
                  tone="ghost"
                  size="sm"
                  className="icon-button"
                  onClick={() => onRelease(accession.id, bench.id)}
                  aria-label={`将 ${accession.cultivar} 从台架 ${bench.code} 移出`}
                >
                  <X size={16} />
                </Button>
              )}
            </div>
          ))
        )}
      </div>
      <footer className="bench-card-footer">
        {bench.status === "blocked" ? (
          <p className="bench-reason">{bench.blockedReason}</p>
        ) : null}
        {bench.status === "maintenance-pending" ? (
          <p className="bench-reason">
            维护申请中：请先将 {assigned.length} 个材料疏散到其他台架
          </p>
        ) : null}
        {inMaintenanceFlow ? (
          <Button
            tone={bench.status === "maintenance" ? "secondary" : "danger"}
            size="sm"
            onClick={() => onManageMaintenance(bench)}
            data-testid={`manage-maintenance-${bench.id}`}
          >
            <Wrench size={15} />
            {bench.status === "maintenance" ? "结束维护" : "疏散与维护"}
          </Button>
        ) : (
          <>
            <Button
              tone="ghost"
              size="sm"
              onClick={() => onRequestMaintenance(bench)}
              disabled={bench.status === "blocked" || bench.status === "quarantine"}
              data-testid={`request-maintenance-${bench.id}`}
            >
              <Wrench size={15} />
              维护
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
          </>
        )}
      </footer>
    </article>
  );
}
