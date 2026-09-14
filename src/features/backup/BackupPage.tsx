import { useRef, useState, type ChangeEvent } from "react";
import { Download, History, Upload } from "lucide-react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { MetricCard } from "../../components/MetricCard";
import { PageHeader } from "../../components/PageHeader";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import {
  createWorkspaceBackup,
  parseWorkspaceBackup,
  summarizeWorkspace,
  type WorkspaceBackup,
} from "../../domain/backup";
import { fieldError, type FieldError } from "../../domain/result";
import { useWorkspace } from "../../state/store";
import { downloadWorkspaceBackup, formatBackupTimestamp } from "./backupFile";
import { ImportPreviewDialog } from "./ImportPreviewDialog";

interface PendingImport {
  backup: WorkspaceBackup;
  fileName: string;
}

interface RejectedImport {
  fileName: string;
  errors: FieldError[];
}

export function BackupPage() {
  const {
    state,
    importWorkspace,
    restorePreImportSnapshot,
    preImportSavedAt,
  } = useWorkspace();
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);
  const [rejectedImport, setRejectedImport] = useState<RejectedImport | null>(null);
  const [restoreConfirmOpen, setRestoreConfirmOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const summary = summarizeWorkspace(state);

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  };

  const handleExport = () => {
    const backup = createWorkspaceBackup(state);
    const fileName = downloadWorkspaceBackup(backup);
    pushToast({
      tone: "success",
      title: "备份已导出",
      message: `已生成 ${fileName}，包含 ${backup.summary.trials} 个试验和 ${backup.summary.accessions} 个材料。`,
    });
  };

  const handleFileChosen = async (event: ChangeEvent<HTMLInputElement>) => {
    const input = event.target;
    const file = input.files?.[0];
    input.value = "";
    if (!file) {
      return;
    }
    let text: string;
    try {
      text = await file.text();
    } catch {
      setPendingImport(null);
      setRejectedImport({
        fileName: file.name,
        errors: [fieldError("file", "read_failed", "无法读取该文件")],
      });
      return;
    }
    const result = parseWorkspaceBackup(text);
    if (!result.ok) {
      setPendingImport(null);
      setRejectedImport({ fileName: file.name, errors: result.errors });
      pushToast({
        tone: "error",
        title: "导入已拒绝",
        message: "文件未通过校验，当前工作区未做任何修改。",
      });
      return;
    }
    setRejectedImport(null);
    setPendingImport({ backup: result.value, fileName: file.name });
  };

  const handleConfirmImport = () => {
    if (!pendingImport) {
      return;
    }
    importWorkspace(pendingImport.backup.state);
    pushToast({
      tone: "success",
      title: "工作区已恢复",
      message: `已导入 ${pendingImport.fileName}，所有页面已切换到新数据。`,
    });
    setPendingImport(null);
  };

  const handleRestore = () => {
    setRestoreConfirmOpen(false);
    if (restorePreImportSnapshot()) {
      pushToast({
        tone: "success",
        title: "已恢复导入前状态",
        message: "当前工作区已回滚到最近一次导入之前。",
      });
    } else {
      pushToast({
        tone: "error",
        title: "没有可用的恢复点",
        message: "最近一次导入前的状态不存在或已损坏。",
      });
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="工作区数据"
        title="备份与恢复"
        description="导出带版本和内容摘要的工作区备份，或在校验通过后整批恢复。任何校验失败都不会改动当前数据。"
      />
      <div className="backup-grid">
        <section className="content-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-title">导出当前工作区</span>
              <span className="panel-subtitle">
                生成带导出时间、格式版本和内容摘要的备份文件
              </span>
            </div>
            <Download size={20} className="panel-icon" aria-hidden="true" />
          </div>
          <div className="backup-panel-body">
            <div className="metric-grid" data-testid="current-workspace-summary">
              <MetricCard label="试验" value={summary.trials} />
              <MetricCard label="材料" value={summary.accessions} />
              <MetricCard label="台架" value={summary.benches} />
              <MetricCard label="观测记录" value={summary.observationPasses} />
              <MetricCard label="生长标记" value={summary.flags} />
              <MetricCard label="放行快照" value={summary.clearanceSnapshots} />
            </div>
            <p className="muted-copy">
              备份文件包含全部领域数据，可用于迁移到另一台机器或从误操作中恢复。
            </p>
            <div className="backup-actions">
              <Button onClick={handleExport} data-testid="export-backup-button">
                <Download size={16} />
                导出备份文件
              </Button>
            </div>
          </div>
        </section>
        <section className="content-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-title">从备份恢复</span>
              <span className="panel-subtitle">
                先校验版本、结构和引用，预览确认后整批替换
              </span>
            </div>
            <Upload size={20} className="panel-icon" aria-hidden="true" />
          </div>
          <div className="backup-panel-body">
            <p className="muted-copy">
              损坏、版本不匹配、引用断裂或存在冲突记录的文件会被整批拒绝，当前工作区保持不动。
            </p>
            <div className="backup-file-row">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json,.json"
                className="visually-hidden"
                onChange={handleFileChosen}
                data-testid="backup-file-input"
                aria-label="选择备份文件"
              />
              <Button
                tone="secondary"
                onClick={() => fileInputRef.current?.click()}
                data-testid="choose-backup-file"
              >
                <Upload size={16} />
                选择备份文件
              </Button>
            </div>
            {rejectedImport ? (
              <div className="backup-rejected">
                <p className="form-level-error">
                  文件 {rejectedImport.fileName} 未通过校验，当前工作区未做任何修改：
                </p>
                <ul className="backup-errors" data-testid="import-error-list">
                  {rejectedImport.errors.map((error, index) => (
                    <li key={`${error.field}-${index}`}>
                      <code>{error.code}</code>
                      <span>{error.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>
      </div>
      {preImportSavedAt ? (
        <section className="content-panel" data-testid="restore-point-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-title">恢复点</span>
              <span className="panel-subtitle">
                最近一次导入前的工作区状态，保存于{" "}
                {formatBackupTimestamp(preImportSavedAt)}
              </span>
            </div>
            <History size={20} className="panel-icon" aria-hidden="true" />
          </div>
          <div className="backup-panel-body">
            <p className="muted-copy">
              如果最近一次导入结果不符合预期，可以回滚到导入之前的状态。恢复点会在下一次成功导入时更新。
            </p>
            <div className="backup-actions">
              <Button
                tone="secondary"
                onClick={() => setRestoreConfirmOpen(true)}
                data-testid="restore-preimport-button"
              >
                <History size={16} />
                恢复导入前的工作区
              </Button>
            </div>
          </div>
        </section>
      ) : null}
      <ImportPreviewDialog
        open={pendingImport !== null}
        fileName={pendingImport?.fileName ?? ""}
        backup={pendingImport?.backup ?? null}
        current={state}
        onCancel={() => setPendingImport(null)}
        onConfirm={handleConfirmImport}
      />
      <Dialog
        open={restoreConfirmOpen}
        title="恢复导入前的工作区"
        onClose={() => setRestoreConfirmOpen(false)}
        footer={
          <>
            <Button tone="ghost" onClick={() => setRestoreConfirmOpen(false)}>
              取消
            </Button>
            <Button
              tone="danger"
              onClick={handleRestore}
              data-testid="confirm-restore-button"
            >
              确认恢复
            </Button>
          </>
        }
      >
        <p className="muted-copy">
          当前工作区将被整批替换为恢复点保存的状态，此操作不可撤销。
        </p>
      </Dialog>
      <ToastRegion
        messages={toasts}
        onDismiss={(id) =>
          setToasts((current) => current.filter((item) => item.id !== id))
        }
      />
    </div>
  );
}
