import { AlertTriangle, History, RotateCcw, Undo2 } from "lucide-react";
import { Button } from "../../components/Button";
import { pendingItems } from "../../domain/quality";
import type { RepairJournal } from "../../domain/quality";

interface RepairRecoveryBannerProps {
  journal: RepairJournal;
  onResume: () => void;
  onRollback: () => void;
  onAbandon: () => void;
}

export function RepairRecoveryBanner({
  journal,
  onResume,
  onRollback,
  onAbandon,
}: RepairRecoveryBannerProps) {
  const pending = pendingItems(journal);
  const completed = journal.items.filter((item) => item.status !== "pending");
  const started = new Date(journal.startedAt);
  const conflicted = journal.status === "conflicted";
  const rollbackIntent = journal.intent === "rollback";

  return (
    <section
      className={`recovery-banner${conflicted ? " recovery-banner-conflict" : ""}${
        rollbackIntent ? " recovery-banner-rollback" : ""
      }`}
      data-testid="repair-recovery-banner"
    >
      <div className="recovery-banner-icon">
        {conflicted || rollbackIntent ? <AlertTriangle size={20} /> : <History size={20} />}
      </div>
      <div className="recovery-banner-copy">
        <strong>
          {conflicted
            ? "修复会话与当前工作区冲突"
            : rollbackIntent
              ? "检测到一次中断的整批回滚"
              : "检测到一次未完成的整批修复"}
        </strong>
        <p>
          修复会话开始于 {started.toLocaleString()}，共 {journal.items.length} 项：
          已处理 {completed.length} 项，待执行 {pending.length} 项。
          {conflicted
            ? ` ${journal.conflictReason ?? "工作区在预演后被改变，自动流程已停止。可整批回滚到修复前状态，或放弃会话保留当前数据。"}`
            : rollbackIntent
              ? " 回滚意图已持久化：恢复只会完成回滚到修复前状态，不会重新应用修复。"
              : " 系统会先按指纹对账实际进度，已生效的修复不会重复执行。"}
        </p>
      </div>
      <div className="recovery-banner-actions">
        {!conflicted ? (
          <Button size="sm" onClick={onResume} data-testid="resume-repair">
            <RotateCcw size={15} />
            {rollbackIntent ? "完成回滚" : "继续执行"}
          </Button>
        ) : null}
        <Button
          size="sm"
          tone={conflicted ? "danger" : "secondary"}
          onClick={onRollback}
          data-testid="rollback-repair"
        >
          <Undo2 size={15} />
          {rollbackIntent ? "重新完成回滚" : "整批回滚"}
        </Button>
        <Button size="sm" tone="ghost" onClick={onAbandon} data-testid="abandon-repair">
          放弃会话（保留当前数据）
        </Button>
      </div>
    </section>
  );
}
