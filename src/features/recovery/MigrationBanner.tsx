import { AlertTriangle, CheckCircle2, ShieldCheck, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { useWorkspace } from "../../state/store";
import { relinkCandidates } from "../../state/migration/resolution";
import type {
  DanglingReferenceIssue,
  MigrationIssue,
  UnknownEnumValueIssue,
} from "../../state/migration/types";
import { isDanglingReferenceIssue } from "../../state/migration/types";

const SEVERITY_LABEL = { critical: "需处理", warning: "提示" } as const;

function IssueCard({ issue, index }: { issue: MigrationIssue; index: number }) {
  const { state, resolveIssue, resolutionError, isSampleWorkspace } =
    useWorkspace();
  const [newRef, setNewRef] = useState("");
  const [newEnum, setNewEnum] = useState("");
  const [keepNote, setKeepNote] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  const error = localError ?? resolutionError;
  const resolved = issue.status !== "open";

  const dangling = isDanglingReferenceIssue(issue) ? issue : null;
  const candidates = useMemo(
    () => (dangling ? relinkCandidates(state, dangling) : []),
    [state, dangling],
  );

  const run = (attempt: () => boolean) => {
    setLocalError(null);
    const success = attempt();
    if (success) {
      setNewRef("");
      setNewEnum("");
      setKeepNote("");
    }
  };

  // 示例工作区没有真实历史，不允许在这里凭空制造“修复”；问题面板只对升级数据出现。
  void isSampleWorkspace;

  return (
    <article
      className={`issue-card issue-${issue.severity} ${resolved ? "issue-resolved" : ""}`}
      data-testid={`issue-card-${index}`}
    >
      <header className="issue-card-head">
        <span className={`issue-badge issue-badge-${issue.severity}`}>
          {issue.severity === "critical" ? (
            <AlertTriangle size={13} />
          ) : (
            <ShieldCheck size={13} />
          )}
          {SEVERITY_LABEL[issue.severity]}
        </span>
        <code className="issue-code">{issue.code}</code>
        {resolved ? (
          <span className="issue-status">
            <CheckCircle2 size={13} />
            {issue.status === "ignored" ? "已知悉保留" : "已处理"}
          </span>
        ) : null}
      </header>
      <p className="issue-message">{issue.message}</p>

      {error ? (
        <p className="issue-domain-error" data-testid={`issue-error-${index}`}>
          <XCircle size={14} /> {error}
        </p>
      ) : null}

      {!resolved && dangling ? (
        <div className="issue-actions">
          <select
            aria-label="选择重新关联的目标"
            data-testid={`issue-relink-select-${index}`}
            value={newRef}
            onChange={(event) => setNewRef(event.target.value)}
          >
            <option value="">选择现存目标重新关联…</option>
            {candidates.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.label}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            tone="primary"
            disabled={!newRef}
            data-testid={`issue-relink-button-${index}`}
            onClick={() =>
              run(() => resolveIssue.relink(issue.id, newRef))
            }
          >
            重新关联
          </Button>
          {dangling.clearable ? (
            <Button
              size="sm"
              tone="secondary"
              data-testid={`issue-clear-button-${index}`}
              onClick={() => run(() => resolveIssue.clear(issue.id))}
            >
              清空该引用
            </Button>
          ) : null}
          <div className="issue-keep">
            <input
              type="text"
              data-testid={`issue-keep-note-${index}`}
              placeholder="备注后保留此悬空事实（可选）"
              value={keepNote}
              onChange={(event) => setKeepNote(event.target.value)}
            />
            <Button
              size="sm"
              tone="ghost"
              data-testid={`issue-keep-button-${index}`}
              onClick={() =>
                run(() =>
                  resolveIssue.keep(
                    issue.id,
                    keepNote || "保留悬空引用，已知悉",
                  ),
                )
              }
            >
              保留并知悉
            </Button>
          </div>
        </div>
      ) : null}

      {!resolved && issue.code === "unknown_enum_value" ? (
        <div className="issue-actions">
          <select
            aria-label="选择受支持的取值"
            data-testid={`issue-enum-select-${index}`}
            value={newEnum}
            onChange={(event) => setNewEnum(event.target.value)}
          >
            <option value="">
              {(issue as UnknownEnumValueIssue).unknownValue} → 改为…
            </option>
            {(issue as UnknownEnumValueIssue).supportedValues.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            tone="primary"
            disabled={!newEnum}
            data-testid={`issue-enum-button-${index}`}
            onClick={() => run(() => resolveIssue.fixEnum(issue.id, newEnum))}
          >
            修正取值
          </Button>
        </div>
      ) : null}

      {!resolved && issue.code === "unknown_field" ? (
        <div className="issue-actions">
          <span className="issue-hint">字段值已原样保留，不会被删除。</span>
          <Button
            size="sm"
            tone="ghost"
            data-testid={`issue-ack-button-${index}`}
            onClick={() => run(() => resolveIssue.acknowledgeField(issue.id))}
          >
            已知悉
          </Button>
        </div>
      ) : null}

      {resolved && issue.resolutionNote ? (
        <p className="issue-resolution-note">处理记录：{issue.resolutionNote}</p>
      ) : null}
    </article>
  );
}

/**
 * 升级人工处理横幅：升级无损完成但存在需要人工确认的引用/枚举/字段问题时出现。
 * 问题不阻止读取与常规操作，但必须在此可见、可裁决；被领域规则拒绝的修复会
 * 在卡片内显示原因且不改动数据。
 */
export function MigrationBanner() {
  const { issues, openIssues, upgradedFromVersion, saveError } = useWorkspace();
  const [open, setOpen] = useState(false);

  const criticalCount = openIssues.filter(
    (issue) => issue.severity === "critical",
  ).length;

  return (
    <>
      {saveError ? (
        <div className="migration-banner migration-banner-error" role="alert">
          <AlertTriangle size={16} />
          <span>保存失败：{saveError}。更改仍保留在本页面，但刷新后可能丢失，请导出数据或重试。</span>
        </div>
      ) : null}
      {upgradedFromVersion ? (
        <div className="migration-banner migration-banner-info" data-testid="upgrade-info-banner">
          <ShieldCheck size={16} />
          <span>工作区已自动完成无损升级，识别出的历史数据全部保留。</span>
        </div>
      ) : null}
      {openIssues.length > 0 ? (
        <div className="migration-banner migration-badge-warning" role="alert" data-testid="migration-issue-banner">
          <AlertTriangle size={16} />
          <span>
            升级后有 {openIssues.length} 项数据需要人工确认
            {criticalCount > 0 ? `（其中 ${criticalCount} 项涉及缺失关联）` : ""}
            ，相关记录均已保留。
          </span>
          <Button
            size="sm"
            tone="secondary"
            data-testid="open-issue-dialog"
            onClick={() => setOpen(true)}
          >
            查看并处理
          </Button>
        </div>
      ) : null}

      <Dialog
        open={open}
        title={`数据升级核对（${issues.length} 项）`}
        onClose={() => setOpen(false)}
        wide
        footer={
          <Button tone="primary" data-testid="close-issue-dialog" onClick={() => setOpen(false)}>
            完成
          </Button>
        }
      >
        <p className="issue-dialog-intro">
          升级不会删除任何历史记录。引用缺失的条目可重新关联（必须满足台架/替代/观测的领域规则）、清空可空引用，或原样保留并标记已知悉。
        </p>
        <div className="issue-list" data-testid="issue-list">
          {issues.map((issue, index) => (
            <IssueCard key={issue.id} issue={issue} index={index} />
          ))}
        </div>
      </Dialog>
    </>
  );
}
