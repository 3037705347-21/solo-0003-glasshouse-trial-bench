import { CalendarDays, CircleCheck, CircleX } from "lucide-react";
import { MetricCard } from "../../components/MetricCard";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import {
  clearanceCheckDefinition,
  describeCheckStatus,
  summarizeChecks,
} from "../../domain/clearance";
import type { ClearanceSnapshot } from "../../domain/types";

interface SnapshotCardProps {
  snapshot: ClearanceSnapshot;
}

function displayDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function SnapshotCard({ snapshot }: SnapshotCardProps) {
  const dateLabel = displayDateTime(snapshot.generatedOn);
  const Icon = snapshot.status === "ready" ? CircleCheck : CircleX;
  const checkSummary = summarizeChecks(snapshot.checks);
  const unconfirmedTitles = snapshot.checks
    .filter((check) => check.status === "unconfirmed")
    .map((check) => clearanceCheckDefinition(check.key).title);

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
      <section className="check-section">
        <h3>人工确认清单</h3>
        {snapshot.checks.length === 0 ? (
          <p className="check-legacy">
            该快照生成时尚未启用人工确认清单，未记录确认结论。
          </p>
        ) : (
          <>
            <p className="check-summary">
              已确认 {checkSummary.confirmed} 项 · 不适用{" "}
              {checkSummary.notApplicable} 项 · 未确认{" "}
              {checkSummary.unconfirmed} 项
            </p>
            {unconfirmedTitles.length > 0 ? (
              <p
                className="check-unconfirmed"
                data-testid="snapshot-unconfirmed-note"
              >
                未确认事项：{unconfirmedTitles.join("、")}
                。未确认项不会计入自动阻止项，但已随快照留痕。
              </p>
            ) : null}
            <ul className="snapshot-check-list">
              {snapshot.checks.map((check) => {
                const definition = clearanceCheckDefinition(check.key);
                return (
                  <li
                    className="snapshot-check-row"
                    key={check.key}
                    data-testid={`snapshot-check-${check.key}`}
                  >
                    <div className="snapshot-check-copy">
                      <strong>{definition.title}</strong>
                      {check.status !== "unconfirmed" ? (
                        <small>
                          由 {check.confirmedBy || "未署名"} 于{" "}
                          {displayDateTime(check.confirmedAt)} 记录
                        </small>
                      ) : null}
                      {check.note ? <span>备注：{check.note}</span> : null}
                      {check.stale ? (
                        <span className="snapshot-check-stale">
                          确认后现场信息已变化，以上结论保留为确认时的状态。
                        </span>
                      ) : null}
                    </div>
                    <StatusBadge
                      tone={
                        check.status === "confirmed"
                          ? "positive"
                          : check.status === "not-applicable"
                            ? "info"
                            : "warning"
                      }
                    >
                      {describeCheckStatus(check.status)}
                    </StatusBadge>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>
    </article>
  );
}
