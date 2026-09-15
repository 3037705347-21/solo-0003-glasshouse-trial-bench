import { History, RotateCcw, Undo2 } from "lucide-react";
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

  return (
    <section className="recovery-banner" data-testid="repair-recovery-banner">
      <div className="recovery-banner-icon">
        <History size={20} />
      </div>
      <div className="recovery-banner-copy">
        <strong>检测到一次未完成的整批修复</strong>
        <p>
          修复会话开始于 {started.toLocaleString()}，共 {journal.items.length} 项：
          已处理 {completed.length} 项，待执行 {pending.length} 项。为避免重复执行，
          待执行项会先与当前数据对账，已不存在的问题会自动跳过。
        </p>
      </div>
      <div className="recovery-banner-actions">
        <Button size="sm" onClick={onResume} data-testid="resume-repair">
          <RotateCcw size={15} />
          继续执行
        </Button>
        <Button
          size="sm"
          tone="secondary"
          onClick={onRollback}
          data-testid="rollback-repair"
        >
          <Undo2 size={15} />
          整批回滚
        </Button>
        <Button size="sm" tone="ghost" onClick={onAbandon} data-testid="abandon-repair">
          放弃会话（保留当前数据）
        </Button>
      </div>
    </section>
  );
}
