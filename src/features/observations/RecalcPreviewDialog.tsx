import { useMemo, useState } from "react";
import { GitCompareArrows } from "lucide-react";
import { Dialog } from "../../components/Dialog";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import type { FlagSeverity, ObservationPass } from "../../domain/types";
import { deriveFlags } from "../../domain/observation";
import {
  diffFlags,
  resolveRuleVersion,
  ruleVersionLabel,
} from "../../domain/ruleVersion";
import {
  flagsForPass,
  ruleVersionLabelFor,
} from "../../state/selectors";
import { useWorkspace } from "../../state/store";

interface RecalcPreviewDialogProps {
  pass: ObservationPass;
  onClose: () => void;
}

const SEVERITY_LABELS: Record<FlagSeverity, string> = {
  info: "提示",
  warning: "警告",
  critical: "严重",
};

export function RecalcPreviewDialog({ pass, onClose }: RecalcPreviewDialogProps) {
  const { state } = useWorkspace();
  const resolved = resolveRuleVersion(state, pass.trialId);
  const [targetVersionId, setTargetVersionId] = useState(
    resolved.kind === "resolved"
      ? resolved.version.id
      : (state.ruleVersions[0]?.id ?? ""),
  );

  const targetVersion = state.ruleVersions.find(
    (version) => version.id === targetVersionId,
  );

  const diff = useMemo(() => {
    if (!targetVersion) {
      return undefined;
    }
    const recomputed = deriveFlags(pass, state.accessions, targetVersion);
    return diffFlags(flagsForPass(state, pass.id), recomputed);
  }, [pass, state, targetVersion]);

  const accessionNo = (accessionId: string) =>
    state.accessions.find((item) => item.id === accessionId)?.accessionNo ??
    accessionId;

  return (
    <Dialog
      open
      title="按规则版本重算预览"
      onClose={onClose}
      wide
    >
      <div className="recalc-dialog" data-testid="recalc-preview">
        <p className="muted-copy">
          观测 {pass.observedOn}（{pass.entries.length} 条测量）产生时使用的规则：
          <strong>{ruleVersionLabelFor(state, pass.ruleVersionId)}</strong>
        </p>
        <label className="field" htmlFor="recalc-version-select">
          <span className="field-label">重算目标版本</span>
          <select
            id="recalc-version-select"
            className="field-input"
            value={targetVersionId}
            onChange={(event) => setTargetVersionId(event.target.value)}
            data-testid="recalc-version-select"
          >
            {state.ruleVersions.map((version) => (
              <option value={version.id} key={version.id}>
                {ruleVersionLabel(version, state.trials)}（
                {version.status === "active"
                  ? "启用中"
                  : version.status === "archived"
                    ? "已归档"
                    : "未启用"}
                ）
              </option>
            ))}
          </select>
        </label>
        {!targetVersion || !diff ? (
          <p className="muted-copy">还没有可用来重算的规则版本。</p>
        ) : (
          <div className="recalc-results">
            <section className="diff-section">
              <h3>新增标记（{diff.added.length}）</h3>
              {diff.added.length === 0 ? (
                <p className="muted-copy">按目标版本重算不会新增标记。</p>
              ) : (
                <ul className="diff-list diff-list-added">
                  {diff.added.map((entry) => (
                    <li key={`${entry.accessionId}-${entry.code}`}>
                      <StatusBadge tone={statusTone(SEVERITY_LABELS[entry.severity])}>
                        {SEVERITY_LABELS[entry.severity]}
                      </StatusBadge>
                      <code>{entry.code}</code>
                      <span>
                        {accessionNo(entry.accessionId)} · {entry.message}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="diff-section">
              <h3>消失的标记（{diff.removed.length}）</h3>
              {diff.removed.length === 0 ? (
                <p className="muted-copy">按目标版本重算不会有标记消失。</p>
              ) : (
                <ul className="diff-list diff-list-removed">
                  {diff.removed.map((entry) => (
                    <li key={`${entry.accessionId}-${entry.code}`}>
                      <StatusBadge tone={statusTone(SEVERITY_LABELS[entry.severity])}>
                        {SEVERITY_LABELS[entry.severity]}
                      </StatusBadge>
                      <code>{entry.code}</code>
                      <span>
                        {accessionNo(entry.accessionId)} · {entry.message}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="diff-section">
              <h3>严重程度变化（{diff.severityChanged.length}）</h3>
              {diff.severityChanged.length === 0 ? (
                <p className="muted-copy">没有标记的严重程度发生变化。</p>
              ) : (
                <ul className="diff-list diff-list-changed">
                  {diff.severityChanged.map((entry) => (
                    <li key={`${entry.accessionId}-${entry.code}`}>
                      <code>{entry.code}</code>
                      <span>
                        {accessionNo(entry.accessionId)} ·{" "}
                        {SEVERITY_LABELS[entry.from]} →{" "}
                        {SEVERITY_LABELS[entry.to]}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <p className="recalc-summary">
              <GitCompareArrows size={14} aria-hidden="true" />
              {diff.unchanged} 条标记保持不变。预览仅用于比较，不会改写原始测量和历史快照。
            </p>
          </div>
        )}
      </div>
    </Dialog>
  );
}
