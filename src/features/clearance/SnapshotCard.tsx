import { CalendarDays, CircleCheck, CircleX } from "lucide-react";
import { MetricCard } from "../../components/MetricCard";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import type { ClearanceSnapshot } from "../../domain/types";

interface SnapshotCardProps {
  snapshot: ClearanceSnapshot;
}

export function SnapshotCard({ snapshot }: SnapshotCardProps) {
  const date = new Date(snapshot.generatedOn);
  const dateLabel = Number.isNaN(date.getTime())
    ? snapshot.generatedOn
    : date.toLocaleString();
  const Icon = snapshot.status === "ready" ? CircleCheck : CircleX;

  return (
    <article className="snapshot-card" data-testid="clearance-snapshot">
      <header className="snapshot-header">
        <Icon
          size={24}
          className={`snapshot-icon snapshot-icon-${snapshot.status}`}
          aria-hidden="true"
        />
        <div>
          <h2>最新放行快照</h2>
          <span>
            <CalendarDays size={14} aria-hidden="true" />
            {dateLabel}
          </span>
        </div>
        <StatusBadge tone={statusTone(snapshot.status)}>
          {snapshot.status === "ready" ? "就绪" : "阻止"}
        </StatusBadge>
      </header>
      <div className="metric-grid">
        {snapshot.metrics.map((metric) => (
          <MetricCard
            key={metric.label}
            label={metric.label}
            value={metric.value}
            detail={metric.detail}
            accent={
              metric.label === "未处理标记" && metric.value > 0
                ? "critical"
                : metric.label === "已分配" && metric.value > 0
                  ? "positive"
                  : "neutral"
            }
          />
        ))}
      </div>
      <section className="blocker-section">
        <h3>阻止项</h3>
        {snapshot.blockers.length === 0 ? (
          <p className="clearance-ready">未发现阻止项，该试验可以放行。</p>
        ) : (
          <ul className="blocker-list">
            {snapshot.blockers.map((blocker, index) => (
              <li key={`${blocker.code}-${index}`}>
                <code>{blocker.code}</code>
                <span>{blocker.message}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </article>
  );
}
