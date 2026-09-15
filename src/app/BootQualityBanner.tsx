import { useMemo, useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "../components/Button";
import { scanWorkspace } from "../domain/quality";
import { useWorkspace } from "../state/store";

export function BootQualityBanner() {
  const { state, bootFindings, activeRepair } = useWorkspace();
  const [dismissed, setDismissed] = useState(false);

  const blocking = useMemo(() => {
    const report = scanWorkspace(state, { persistenceFindings: bootFindings });
    return report.blocking;
  }, [state, bootFindings]);

  if (dismissed || (blocking.length === 0 && !activeRepair)) {
    return null;
  }

  if (activeRepair) {
    const conflicted = activeRepair.status === "conflicted";
    return (
      <div
        className={`boot-banner boot-banner-recovery${conflicted ? " boot-banner-conflict" : ""}`}
        role="status"
        data-testid="boot-recovery-banner"
      >
        <AlertTriangle size={18} aria-hidden="true" />
        <div className="boot-banner-copy">
          <strong>
            {conflicted ? "修复会话与当前工作区冲突" : "存在需要处理的修复会话"}
          </strong>
          <span>
            {conflicted
              ? "工作区相对修复前快照发生了计划外变化，自动流程已停止以避免只应用部分修复。可在数据质量中心整批回滚或放弃会话。"
              : "未完成的整批修复可在数据质量中心继续执行、整批回滚或放弃，审计记录不会丢失。"}
          </span>
        </div>
        <Link className="button button-primary button-sm" to="/quality">
          查看恢复选项
        </Link>
        <Button tone="ghost" size="sm" className="icon-button" onClick={() => setDismissed(true)} aria-label="关闭提示">
          <X size={16} />
        </Button>
      </div>
    );
  }

  return (
    <div className="boot-banner" role="alert" data-testid="boot-quality-banner">
      <AlertTriangle size={18} aria-hidden="true" />
      <div className="boot-banner-copy">
        <strong>启动检查发现 {blocking.length} 个阻断级数据质量问题</strong>
        <span>
          跨对象引用或持久化数据存在断裂，继续工作流可能扩散错误。问题不会被静默修复或用示例数据替换。
        </span>
      </div>
      <Link className="button button-primary button-sm" to="/quality" data-testid="boot-banner-open">
        打开数据质量中心
      </Link>
      <Button tone="ghost" size="sm" className="icon-button" onClick={() => setDismissed(true)} aria-label="关闭提示">
        <X size={16} />
      </Button>
    </div>
  );
}
