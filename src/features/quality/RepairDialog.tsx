import { useEffect, useState } from "react";
import { AlertTriangle, ListChecks, ShieldCheck } from "lucide-react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { StatusBadge } from "../../components/StatusBadge";
import type { DryRunSelection } from "./useQualityCenter";

interface RepairDialogProps {
  open: boolean;
  dryRun: DryRunSelection | null;
  onClose: () => void;
  onConfirm: () => void;
}

const statusLabel: Record<string, { label: string; tone: "positive" | "warning" | "critical" }> = {
  applied: { label: "将执行", tone: "positive" },
  "already-fixed": { label: "已修复/无需改动", tone: "warning" },
  conflict: { label: "冲突", tone: "critical" },
};

export function RepairDialog({ open, dryRun, onClose, onConfirm }: RepairDialogProps) {
  const [acknowledged, setAcknowledged] = useState(false);

  useEffect(() => {
    if (open) {
      setAcknowledged(false);
    }
  }, [open, dryRun]);

  if (!dryRun) {
    return null;
  }

  const canConfirm = dryRun.safe && dryRun.appliedCount > 0 && acknowledged;

  return (
    <Dialog
      open={open}
      title="整批修复预演"
      onClose={onClose}
      wide
      footer={
        <>
          <Button tone="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            tone="primary"
            disabled={!canConfirm}
            onClick={onConfirm}
            data-testid="confirm-repair-batch"
          >
            <ShieldCheck size={16} />
            确认应用 {dryRun.appliedCount} 项修复
          </Button>
        </>
      }
    >
      <div className="repair-preview">
        <div className="repair-summary">
          <div>
            <strong>{dryRun.results.length}</strong>
            <span>勾选项</span>
          </div>
          <div>
            <strong className="repair-summary-positive">{dryRun.appliedCount}</strong>
            <span>将实际执行</span>
          </div>
          <div>
            <strong className="repair-summary-muted">{dryRun.alreadyFixedCount}</strong>
            <span>已是目标状态（不重复执行）</span>
          </div>
        </div>

        <p className="repair-principle">
          所有修复只解除错误引用或校正派生状态，不会删除任何观测、标记或快照历史；
          被解除的引用会逐项记录在审计日志中。
        </p>

        {!dryRun.safe ? (
          <div className="repair-warning" role="alert" data-testid="repair-blocked-warning">
            <AlertTriangle size={18} />
            <div>
              <strong>预演未通过，无法确认执行</strong>
              {dryRun.conflicts.map((item) => (
                <p key={`conflict-${item.findingId}`}>
                  {item.title}：{item.conflictReason}
                </p>
              ))}
              {dryRun.introduced.map((item) => (
                <p key={`introduced-${item.id}`}>
                  预计会引入新的阻断问题：{item.title}
                </p>
              ))}
              {dryRun.remaining.map((item) => (
                <p key={`remaining-${item.id}`}>
                  修复后问题仍然存在：{item.title}
                </p>
              ))}
            </div>
          </div>
        ) : null}

        <ul className="repair-item-list" data-testid="repair-preview-list">
          {dryRun.results.map((item) => {
            const meta = statusLabel[item.status] ?? statusLabel.conflict;
            return (
              <li
                key={item.findingId}
                className={`repair-item repair-item-${item.status}`}
                data-testid={`preview-item-${item.findingId}`}
              >
                <div className="repair-item-head">
                  <ListChecks size={15} aria-hidden="true" />
                  <strong>{item.title}</strong>
                  <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                </div>
                <code>{item.ruleCode}</code>
                <p>{item.action}</p>
                {item.changes.length > 0 ? (
                  <ul className="repair-change-list">
                    {item.changes.map((change, index) => (
                      <li key={index}>{change}</li>
                    ))}
                  </ul>
                ) : null}
                {item.conflictReason ? (
                  <p className="repair-conflict-reason">{item.conflictReason}</p>
                ) : null}
              </li>
            );
          })}
        </ul>

        <label className="repair-acknowledge">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(event) => setAcknowledged(event.target.checked)}
            data-testid="repair-acknowledge"
            disabled={!dryRun.safe || dryRun.appliedCount === 0}
          />
          <span>
            我已逐项核对以上修复动作，确认不会丢弃历史记录、不会用示例数据替换现有数据。
          </span>
        </label>
      </div>
    </Dialog>
  );
}
