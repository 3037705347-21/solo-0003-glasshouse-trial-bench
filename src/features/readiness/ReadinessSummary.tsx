import { StatusBadge } from "../../components/StatusBadge";
import {
  READINESS_ACTION_LABELS,
  summarizeReadiness,
  type AccessionReadiness,
  type ReadinessAction,
} from "../../domain/readiness";

interface ReadinessSummaryProps {
  action: ReadinessAction;
  items: AccessionReadiness[];
  testId?: string;
}

/** 试验级单动作准备度汇总：可推进 / 受阻 / 不适用，并列出受阻依据。 */
export function ReadinessSummary({ action, items, testId }: ReadinessSummaryProps) {
  const summary = summarizeReadiness(items);
  const attention = items.filter((item) => item.verdict.status !== "ready");
  return (
    <section
      className="readiness-summary"
      data-testid={testId ?? `readiness-summary-${action}`}
    >
      <div className="readiness-summary-head">
        <span className="readiness-summary-title">
          {READINESS_ACTION_LABELS[action]}准备度
        </span>
        <StatusBadge tone="positive">{`可推进 ${summary.ready}`}</StatusBadge>
        <StatusBadge tone={summary.blocked > 0 ? "critical" : "neutral"}>
          {`受阻 ${summary.blocked}`}
        </StatusBadge>
        <StatusBadge tone="neutral">{`不适用 ${summary.excluded}`}</StatusBadge>
      </div>
      {attention.length > 0 ? (
        <ul className="readiness-summary-list">
          {attention.map((item) => (
            <li key={item.accession.id}>
              <strong>{item.accession.accessionNo}</strong>
              <span>
                {item.verdict.reasons[0]?.message ?? "当前不适用该动作"}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="readiness-summary-clear">
          全部材料都可以推进{READINESS_ACTION_LABELS[action]}。
        </p>
      )}
    </section>
  );
}
