import { AlertTriangle, ShieldCheck } from "lucide-react";
import type { SnapshotFreshness } from "../../domain/clearance";

interface SnapshotFreshnessBannerProps {
  freshness: SnapshotFreshness;
}

/** 已保存快照的时效横幅：仍然有效，或已过期并列出具体变化。 */
export function SnapshotFreshnessBanner({
  freshness,
}: SnapshotFreshnessBannerProps) {
  if (!freshness.stale) {
    return (
      <p
        className="freshness-banner freshness-banner-fresh"
        data-testid="snapshot-freshness"
        data-stale="false"
      >
        <ShieldCheck size={16} aria-hidden="true" />
        <span>
          快照仍然有效：生成后的相关数据未变化
          {freshness.verifiedBy === "diff" ? "（按结论一致性校验）" : ""}。
        </span>
      </p>
    );
  }
  return (
    <div
      className="freshness-banner freshness-banner-stale"
      data-testid="snapshot-freshness"
      data-stale="true"
    >
      <p className="freshness-banner-head">
        <AlertTriangle size={16} aria-hidden="true" />
        <strong>快照已过期：生成后的相关数据已变化，结论可能不再适用。</strong>
      </p>
      <ul className="freshness-drift-list">
        {freshness.drift.map((drift, index) => (
          <li key={`${drift.code}-${index}`} data-testid="freshness-drift-item">
            {drift.message}
          </li>
        ))}
      </ul>
      <p className="freshness-banner-foot">请重新生成快照，以获取当前结论。</p>
    </div>
  );
}
