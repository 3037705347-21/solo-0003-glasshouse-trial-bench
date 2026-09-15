import { StatusBadge } from "../../components/StatusBadge";
import {
  READINESS_ACTION_LABELS,
  READINESS_STATUS_LABELS,
  type ReadinessReason,
  type ReadinessStatus,
  type ReadinessVerdict,
} from "../../domain/readiness";

interface ReadinessVerdictListProps {
  verdicts: ReadinessVerdict[];
}

const STATUS_TONES: Record<ReadinessStatus, "positive" | "critical" | "neutral"> = {
  ready: "positive",
  blocked: "critical",
  excluded: "neutral",
};

function ReasonList({
  reasons,
  className,
}: {
  reasons: ReadinessReason[];
  className: string;
}) {
  if (reasons.length === 0) {
    return null;
  }
  return (
    <ul className={className}>
      {reasons.map((reason, index) => (
        <li key={`${reason.code}-${index}`}>
          <span
            className={`reason-dot reason-dot-${reason.tone}`}
            aria-hidden="true"
          />
          <span>{reason.message}</span>
        </li>
      ))}
    </ul>
  );
}

/** 逐动作的准备度判定清单：状态 + 判定依据 + 跨动作提示。 */
export function ReadinessVerdictList({ verdicts }: ReadinessVerdictListProps) {
  return (
    <ul className="readiness-verdict-list">
      {verdicts.map((verdict) => (
        <li
          className="readiness-verdict-item"
          key={verdict.action}
          data-testid={`readiness-item-${verdict.action}`}
        >
          <div className="readiness-verdict-head">
            <strong>{READINESS_ACTION_LABELS[verdict.action]}</strong>
            <StatusBadge tone={STATUS_TONES[verdict.status]}>
              {READINESS_STATUS_LABELS[verdict.status]}
            </StatusBadge>
          </div>
          {verdict.status === "ready" && verdict.reasons.length === 0 ? (
            <p className="readiness-ready-note">当前没有阻止该动作的条件。</p>
          ) : null}
          <ReasonList reasons={verdict.reasons} className="readiness-reasons" />
          <ReasonList
            reasons={verdict.advisories}
            className="readiness-reasons readiness-advisories"
          />
        </li>
      ))}
    </ul>
  );
}
