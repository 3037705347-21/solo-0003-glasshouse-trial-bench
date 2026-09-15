import { AlertTriangle, Download, RotateCcw, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { useWorkspace } from "../../state/store";

const REASON_TEXT: Record<string, string> = {
  invalid_json: "数据不是有效的 JSON",
  invalid_envelope: "数据结构无法识别",
  unsupported_future_version: "数据来自更新版本的应用",
  corrupt_collections: "集合结构已损坏",
  migration_threw: "升级步骤执行失败",
  write_failed: "升级结果无法安全写入",
};

/**
 * 恢复模式：升级无法安全完成时的全屏锁定页。
 * 不加载业务工作区、不提供任何写入路径；旧数据保留在浏览器存储中，
 * 用户只能：导出原始数据抢救、回滚升级前备份、或在知情下重置。
 */
export function RecoveryScreen() {
  const { recovery, exportRaw, rollbackBackup, confirmResetAfterRecovery } =
    useWorkspace();
  const [confirmReset, setConfirmReset] = useState(false);

  if (!recovery) {
    return null;
  }

  return (
    <div className="recovery-screen" role="alert">
      <section className="recovery-panel" data-testid="recovery-screen">
        <header className="recovery-header">
          <AlertTriangle size={28} aria-hidden />
          <div>
            <h1>工作区需要人工恢复</h1>
            <p className="recovery-subtitle">
              系统没有改动或删除你的旧数据，也没有用示例数据替换它。请先导出原始数据留底，再选择处理方式。
            </p>
          </div>
        </header>

        <div className="recovery-detail">
          <p className="recovery-reason">
            <strong>原因：</strong>
            {REASON_TEXT[recovery.reasonCode] ?? recovery.reasonCode}
          </p>
          <p>{recovery.message}</p>
          <pre className="recovery-raw">
            {typeof recovery.raw === "string"
              ? recovery.raw.slice(0, 4000)
              : JSON.stringify(recovery.raw, null, 2)?.slice(0, 4000)}
          </pre>
        </div>

        <div className="recovery-actions">
          <Button tone="primary" onClick={exportRaw} data-testid="recovery-export">
            <Download size={16} /> 导出原始数据
          </Button>
          <Button
            tone="secondary"
            onClick={rollbackBackup}
            disabled={!recovery.hasBackup}
            data-testid="recovery-rollback"
            title={recovery.hasBackup ? "" : "没有可回滚的升级前备份"}
          >
            <RotateCcw size={16} /> 回滚到升级前备份并重试
          </Button>
          <Button
            tone="danger"
            onClick={() => setConfirmReset(true)}
            data-testid="recovery-reset"
          >
            <Trash2 size={16} /> 放弃旧数据并重置
          </Button>
        </div>
        <p className="recovery-footnote">
          重置会永久删除当前浏览器中的旧工作区。请务必先导出原始数据。
        </p>
      </section>

      <Dialog
        open={confirmReset}
        title="确认放弃旧工作区？"
        onClose={() => setConfirmReset(false)}
        footer={
          <>
            <Button tone="secondary" onClick={() => setConfirmReset(false)}>
              取消
            </Button>
            <Button
              tone="danger"
              data-testid="recovery-confirm-reset"
              onClick={() => {
                setConfirmReset(false);
                confirmResetAfterRecovery();
              }}
            >
              我已导出数据，确认重置
            </Button>
          </>
        }
      >
        <p>
          此操作会删除无法升级的旧工作区并以示例数据重新开始。该操作不可撤销。
        </p>
      </Dialog>
    </div>
  );
}
