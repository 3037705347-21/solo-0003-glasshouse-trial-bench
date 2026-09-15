import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Info, ShieldQuestion } from "lucide-react";
import {
  DOMAIN_LABELS,
  OBJECT_KIND_LABELS,
} from "../../domain/quality";
import type { QualityFinding, QualitySeverity } from "../../domain/quality";
import { StatusBadge } from "../../components/StatusBadge";

const severityMeta: Record<
  QualitySeverity,
  { label: string; tone: "critical" | "warning" | "info"; icon: typeof Info }
> = {
  blocking: { label: "阻断", tone: "critical", icon: AlertTriangle },
  warning: { label: "警告", tone: "warning", icon: ShieldQuestion },
  info: { label: "提示", tone: "info", icon: Info },
};

interface FindingCardProps {
  finding: QualityFinding;
  selectable: boolean;
  selected: boolean;
  onToggle: (findingId: string) => void;
}

export function FindingCard({ finding, selectable, selected, onToggle }: FindingCardProps) {
  const meta = severityMeta[finding.severity];
  const Icon = meta.icon;

  return (
    <article
      className={`quality-finding quality-finding-${finding.severity}${
        selected ? " quality-finding-selected" : ""
      }`}
      data-testid={`finding-${finding.id}`}
    >
      <div className="quality-finding-main">
        <div className="quality-finding-head">
          {selectable ? (
            <label className="quality-finding-check">
              <input
                type="checkbox"
                checked={selected}
                onChange={() => onToggle(finding.id)}
                data-testid={`select-fix-${finding.id}`}
                aria-label={`选择修复：${finding.title}`}
              />
            </label>
          ) : (
            <span className="quality-finding-icon" aria-hidden="true">
              <Icon size={16} />
            </span>
          )}
          <div className="quality-finding-titles">
            <strong>{finding.title}</strong>
            <span className="quality-finding-sub">
              <code>{finding.ruleCode}</code> · {DOMAIN_LABELS[finding.domain]}
            </span>
          </div>
          <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
        </div>
        <p className="quality-finding-detail">{finding.detail}</p>

        {finding.objectRefs.length > 0 ? (
          <div className="quality-evidence-block">
            <span className="quality-evidence-caption">涉及对象</span>
            <ul className="quality-object-list">
              {finding.objectRefs.map((ref, index) => (
                <li key={`${ref.kind}-${ref.id}-${index}`}>
                  <span className="quality-object-kind">
                    {OBJECT_KIND_LABELS[ref.kind]}
                  </span>
                  <span>{ref.label}</span>
                  <code>{ref.id}</code>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {finding.evidence.length > 0 ? (
          <div className="quality-evidence-block">
            <span className="quality-evidence-caption">可追溯证据</span>
            <dl className="quality-evidence-grid">
              {finding.evidence.map((item) => (
                <div key={item.label}>
                  <dt>{item.label}</dt>
                  <dd>{item.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        ) : null}
      </div>

      <footer className="quality-finding-foot">
        {finding.fix ? (
          <div className="quality-fix-note">
            <CheckCircle2 size={14} aria-hidden="true" />
            <div>
              <strong>可安全自动修复</strong>
              <p>{finding.fix.action}</p>
              <span>{finding.fix.rationale}</span>
            </div>
          </div>
        ) : null}
        {finding.manual ? (
          <Link
            className="button button-secondary button-sm"
            to={finding.manual.path}
            data-testid={`manual-${finding.id}`}
          >
            {finding.manual.actionLabel}
          </Link>
        ) : null}
      </footer>
    </article>
  );
}
