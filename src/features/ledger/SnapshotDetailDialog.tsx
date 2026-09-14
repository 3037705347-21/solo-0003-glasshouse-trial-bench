import {
  AlertTriangle,
  ArrowRight,
  CircleCheck,
  History,
  Link2,
  Lock,
  Trash2,
} from "lucide-react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { MetricCard } from "../../components/MetricCard";
import { StatusBadge } from "../../components/StatusBadge";
import type { ClearanceSnapshot } from "../../domain/types";
import type {
  ReferenceRow,
  ReferenceStatus,
  SnapshotAnalysis,
  SnapshotReferences,
} from "../../domain/snapshotLedger";
import {
  formatSnapshotTime,
  trialStateLabel,
} from "../../domain/snapshotLedger";

interface SnapshotDetailDialogProps {
  snapshot: ClearanceSnapshot;
  analysis: SnapshotAnalysis;
  references: SnapshotReferences;
  onClose: () => void;
}

const statusMeta: Record<
  ReferenceStatus,
  { label: string; tone: "neutral" | "positive" | "warning" | "critical" | "info" }
> = {
  unchanged: { label: "与当前一致", tone: "positive" },
  changed: { label: "已变化", tone: "warning" },
  missing: { label: "已不存在", tone: "critical" },
  new: { label: "快照后新增", tone: "info" },
  legacy: { label: "无法核对", tone: "neutral" },
};

function ReferenceList({
  heading,
  rows,
  empty,
}: {
  heading: string;
  rows: ReferenceRow[];
  empty: string;
}) {
  return (
    <section className="ref-section">
      <h4>
        {heading}
        <span className="ref-count">{rows.length}</span>
      </h4>
      {rows.length === 0 ? (
        <p className="ref-empty">{empty}</p>
      ) : (
        <ul className="ref-list">
          {rows.map((row) => {
            const meta = statusMeta[row.status];
            const Icon =
              row.status === "missing"
                ? Trash2
                : row.status === "changed"
                  ? AlertTriangle
                  : row.status === "new"
                    ? ArrowRight
                    : row.status === "legacy"
                      ? History
                      : CircleCheck;
            return (
              <li
                key={row.id}
                className={`ref-row ref-row-${row.status}`}
                data-testid={`ref-${heading}-${row.id}`}
              >
                <div className="ref-row-head">
                  <Icon size={15} aria-hidden="true" />
                  <strong>{row.title}</strong>
                  <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                </div>
                {row.subtitle ? (
                  <p className="ref-subtitle">{row.subtitle}</p>
                ) : null}
                {row.frozenText || row.liveText ? (
                  <div className="ref-then-now">
                    {row.frozenText ? <span>{row.frozenText}</span> : null}
                    {row.driftDetail ? (
                      <span className="ref-drift">{row.driftDetail}</span>
                    ) : null}
                    {row.liveText ? <span>{row.liveText}</span> : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

export function SnapshotDetailDialog({
  snapshot,
  analysis,
  references,
  onClose,
}: SnapshotDetailDialogProps) {
  const freshness =
    analysis.freshness === "current"
      ? { label: "与当前状态一致", tone: "positive" as const }
      : analysis.freshness === "stale"
        ? { label: `已过期（${analysis.drifts.length} 处差异）`, tone: "warning" as const }
        : { label: "旧版快照，无法核对", tone: "neutral" as const };

  return (
    <Dialog
      open
      wide
      onClose={onClose}
      title={`快照详情 · ${formatSnapshotTime(snapshot.generatedOn)}`}
      footer={
        <>
          <span className="dialog-immutable-note">
            <Lock size={14} aria-hidden="true" />
            历史快照为只读记录，无法删除、改写或重新生成。
          </span>
          <Button onClick={onClose}>关闭</Button>
        </>
      }
    >
      <div className="snapshot-detail-meta">
        <StatusBadge tone={snapshot.status === "ready" ? "positive" : "critical"}>
          {snapshot.status === "ready" ? "就绪" : "阻止"}
        </StatusBadge>
        <StatusBadge tone={freshness.tone}>{freshness.label}</StatusBadge>
        <span className="snapshot-detail-id">
          <Link2 size={13} aria-hidden="true" />
          {snapshot.id}
        </span>
        {references.trialRow ? (
          <span className="snapshot-detail-trial">
            试验：{references.trialRow.title}
            {snapshot.capture
              ? `（当时：${trialStateLabel(snapshot.capture.trial.state)}）`
              : null}
          </span>
        ) : null}
      </div>

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

      <section className="ref-section">
        <h4>
          阻止项
          <span className="ref-count">{snapshot.blockers.length}</span>
        </h4>
        {snapshot.blockers.length === 0 ? (
          <p className="ref-empty">未发现阻止项，该试验可以放行。</p>
        ) : (
          <ul className="ref-blocker-list">
            {snapshot.blockers.map((blocker, index) => (
              <li key={`${blocker.code}-${index}`}>
                <code>{blocker.code}</code>
                <span>{blocker.message}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {analysis.freshness === "unverifiable" ? (
        <p className="legacy-banner">
          <History size={15} aria-hidden="true" />
          该快照在台账功能上线前生成，未冻结引用副本。下方仅能基于当前工作区
          解析阻止项引用，无法还原当时的材料、台架与标记内容；快照本身仍保持只读。
        </p>
      ) : null}

      {references.trialRow ? (
        <ReferenceList heading="试验" rows={[references.trialRow]} empty="" />
      ) : null}
      <ReferenceList
        heading="材料"
        rows={references.accessions}
        empty="该快照生成时试验没有材料。"
      />
      <ReferenceList
        heading="台架"
        rows={references.benches}
        empty="该快照未引用任何相关台架。"
      />
      <ReferenceList
        heading="标记"
        rows={references.flags}
        empty="该快照生成时试验没有标记。"
      />
      <ReferenceList
        heading="观测"
        rows={references.passes}
        empty="该快照生成时没有观测记录。"
      />
    </Dialog>
  );
}
