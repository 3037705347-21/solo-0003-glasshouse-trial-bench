import { Dialog } from "../../components/Dialog";
import { Button } from "../../components/Button";
import { MetricCard } from "../../components/MetricCard";
import { StatusBadge } from "../../components/StatusBadge";
import type { WorkspaceBackup } from "../../domain/backup";
import { summarizeWorkspace } from "../../domain/backup";
import type { WorkspaceState } from "../../domain/types";
import { formatBackupTimestamp } from "./backupFile";

interface ImportPreviewDialogProps {
  open: boolean;
  fileName: string;
  backup: WorkspaceBackup | null;
  current: WorkspaceState;
  onCancel: () => void;
  onConfirm: () => void;
}

const COLLECTION_ROWS: Array<{
  key: "trials" | "accessions" | "benches" | "observationPasses" | "flags" | "clearanceSnapshots";
  label: string;
}> = [
  { key: "trials", label: "试验" },
  { key: "accessions", label: "材料" },
  { key: "benches", label: "台架" },
  { key: "observationPasses", label: "观测记录" },
  { key: "flags", label: "生长标记" },
  { key: "clearanceSnapshots", label: "放行快照" },
];

export function ImportPreviewDialog({
  open,
  fileName,
  backup,
  current,
  onCancel,
  onConfirm,
}: ImportPreviewDialogProps) {
  if (!backup) {
    return null;
  }
  const currentSummary = summarizeWorkspace(current);
  const { summary } = backup;
  return (
    <Dialog
      open={open}
      title="导入预览"
      onClose={onCancel}
      wide
      footer={
        <>
          <Button tone="ghost" onClick={onCancel}>
            取消
          </Button>
          <Button
            tone="danger"
            onClick={onConfirm}
            data-testid="confirm-import-button"
          >
            确认导入并替换
          </Button>
        </>
      }
    >
      <div className="backup-preview">
        <dl className="backup-meta">
          <div>
            <dt>备份文件</dt>
            <dd>{fileName}</dd>
          </div>
          <div>
            <dt>导出时间</dt>
            <dd>{formatBackupTimestamp(backup.exportedAt)}</dd>
          </div>
          <div>
            <dt>格式版本</dt>
            <dd>v{backup.version}</dd>
          </div>
          <div>
            <dt>涉及试验</dt>
            <dd>
              {summary.trialCodes.length > 0 ? (
                <span className="backup-trial-codes">
                  {summary.trialCodes.map((code) => (
                    <StatusBadge tone="neutral" key={code}>
                      {code}
                    </StatusBadge>
                  ))}
                </span>
              ) : (
                "无（空工作区）"
              )}
            </dd>
          </div>
        </dl>
        <div className="metric-grid">
          <MetricCard label="试验" value={summary.trials} />
          <MetricCard label="材料" value={summary.accessions} />
          <MetricCard label="台架" value={summary.benches} />
          <MetricCard label="观测记录" value={summary.observationPasses} />
          <MetricCard label="生长标记" value={summary.flags} />
          <MetricCard label="放行快照" value={summary.clearanceSnapshots} />
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>集合</th>
                <th>当前工作区</th>
                <th>备份文件</th>
              </tr>
            </thead>
            <tbody>
              {COLLECTION_ROWS.map(({ key, label }) => (
                <tr key={key}>
                  <td>{label}</td>
                  <td>{currentSummary[key]}</td>
                  <td>
                    <span className="table-primary">{summary[key]}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="backup-warning">
          确认后将整批替换当前工作区，且不会出现部分写入。当前数据会先保存为恢复点，原始备份文件不会被修改。
        </p>
      </div>
    </Dialog>
  );
}
