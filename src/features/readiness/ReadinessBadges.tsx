import { Check, Minus, OctagonX } from "lucide-react";
import {
  READINESS_ACTION_SHORT_LABELS,
  READINESS_STATUS_LABELS,
  type ReadinessVerdict,
} from "../../domain/readiness";

interface ReadinessBadgesProps {
  accessionId: string;
  verdicts: ReadinessVerdict[];
  onOpen?: () => void;
}

const STATUS_ICONS = {
  ready: Check,
  blocked: OctagonX,
  excluded: Minus,
} as const;

function badgeTitle(verdict: ReadinessVerdict): string {
  const basis =
    verdict.reasons[0]?.message ?? verdict.advisories[0]?.message ?? "";
  const status = READINESS_STATUS_LABELS[verdict.status];
  return basis ? `${status}：${basis}` : status;
}

/** 行内紧凑准备度徽章：颜色表达状态，点击打开完整依据。 */
export function ReadinessBadges({
  accessionId,
  verdicts,
  onOpen,
}: ReadinessBadgesProps) {
  return (
    <div className="readiness-badges">
      {verdicts.map((verdict) => {
        const Icon = STATUS_ICONS[verdict.status];
        return (
          <button
            type="button"
            key={verdict.action}
            className={`readiness-badge readiness-badge-${verdict.status}`}
            title={badgeTitle(verdict)}
            onClick={onOpen}
            data-testid={`readiness-badge-${verdict.action}-${accessionId}`}
          >
            <Icon size={12} aria-hidden="true" />
            {READINESS_ACTION_SHORT_LABELS[verdict.action]}
          </button>
        );
      })}
    </div>
  );
}
