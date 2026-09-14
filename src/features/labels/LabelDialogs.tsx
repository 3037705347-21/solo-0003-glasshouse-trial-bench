import { useMemo, useState } from "react";
import { Button } from "../../components/Button";
import {
  buildAddLabelPlan,
  buildMergeLabelPlan,
  buildRemoveLabelPlan,
  buildRenameLabelPlan,
  type LabelChangePlan,
  type LabelSummary,
} from "../../domain/labels";
import type { Accession, WorkspaceState } from "../../domain/types";
import type { FieldError } from "../../domain/result";
import { useWorkspace } from "../../state/store";
import { ImpactPreview } from "./ImpactPreview";

type PlanBuilder = (state: WorkspaceState) =>
  | { ok: true; value: LabelChangePlan }
  | { ok: false; errors: FieldError[] };

interface OperationDialogProps {
  title: string;
  submitLabel: string;
  description: string;
  planBuilder: PlanBuilder;
  /** 输入变化时调用，用于根据选择实时重算影响预览。 */
  revisionKey: string;
  onClose: () => void;
  onApplied: (plan: LabelChangePlan) => void;
  children: React.ReactNode;
}

/** 共享的“预览 -> 执行”对话框骨架：先算影响，确认后才落库。 */
function OperationDialog({
  title,
  submitLabel,
  description,
  planBuilder,
  revisionKey,
  onClose,
  onApplied,
  children,
}: OperationDialogProps) {
  const { state, dispatch } = useWorkspace();
  const plan = useMemo(() => planBuilder(state), [state, planBuilder, revisionKey]);

  const handleApply = () => {
    if (!plan.ok) {
      return;
    }
    dispatch({
      type: "accession/labels-applied",
      accessions: plan.value.updatedAccessions,
    });
    onApplied(plan.value);
  };

  return (
    <div className="operation-dialog-copy">
      <p className="muted-copy">{description}</p>
      {children}
      <div className="impact-section">
        <div className="impact-section-head">
          <h3>影响预览</h3>
          <span data-testid="impact-count">
            {plan.ok
              ? `将影响 ${plan.value.affected.length} 个材料`
              : "暂无可执行的变更"}
          </span>
        </div>
        {plan.ok ? (
          <ImpactPreview affected={plan.value.affected} />
        ) : (
          <ul className="form-error-list">
            {plan.errors.map((error) => (
              <li key={`${error.field}-${error.code}`}>{error.message}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="editor-actions">
        <Button tone="secondary" onClick={onClose}>
          取消
        </Button>
        <Button
          onClick={handleApply}
          disabled={!plan.ok}
          data-testid="apply-label-operation"
        >
          {submitLabel}
        </Button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// 批量添加
// ---------------------------------------------------------------------------

interface AddDialogProps {
  trialId: string;
  trialAccessions: Accession[];
  onClose: () => void;
  onApplied: (plan: LabelChangePlan) => void;
}

export function AddLabelsDialog({
  trialId,
  trialAccessions,
  onClose,
  onApplied,
}: AddDialogProps) {
  const [labelText, setLabelText] = useState("");
  const [scope, setScope] = useState<"all" | "selected">("all");
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const labels = useMemo(
    () =>
      labelText
        .split(/[,，]/)
        .map((label) => label.trim())
        .filter(Boolean),
    [labelText],
  );
  const targetIds = scope === "all" ? trialAccessions.map((item) => item.id) : selectedIds;

  const toggle = (id: string) => {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  };

  return (
    <OperationDialog
      title="批量添加标签"
      submitLabel={`添加到 ${targetIds.length} 个材料`}
      description="标签会按材料编辑相同的规则标准化（去首尾空格、转小写、去重、丢弃空值），已携带该标签的材料保持不变。"
      revisionKey={`${labelText}|${scope}|${selectedIds.join(",")}`}
      planBuilder={(current) =>
        buildAddLabelPlan(current, trialId, labels, targetIds)
      }
      onClose={onClose}
      onApplied={onApplied}
    >
      <label className="field">
        <span className="field-label">要添加的标签</span>
        <input
          className="field-input"
          value={labelText}
          onChange={(event) => setLabelText(event.target.value)}
          placeholder="例如：抗病, 复测"
          data-testid="add-labels-input"
        />
        <span className="field-hint">多个标签用逗号分隔</span>
      </label>
      <fieldset className="scope-fieldset">
        <legend className="field-label">应用范围</legend>
        <label className="scope-option">
          <input
            type="radio"
            name="add-scope"
            checked={scope === "all"}
            onChange={() => setScope("all")}
            data-testid="add-scope-all"
          />
          试验内全部 {trialAccessions.length} 个材料
        </label>
        <label className="scope-option">
          <input
            type="radio"
            name="add-scope"
            checked={scope === "selected"}
            onChange={() => setScope("selected")}
            data-testid="add-scope-selected"
          />
          仅勾选的材料
        </label>
        {scope === "selected" ? (
          <div className="scope-pick-list" data-testid="add-scope-list">
            {trialAccessions.map((accession) => (
              <label className="scope-pick-item" key={accession.id}>
                <input
                  type="checkbox"
                  checked={selectedIds.includes(accession.id)}
                  onChange={() => toggle(accession.id)}
                />
                <span>
                  <strong>{accession.accessionNo}</strong> {accession.cultivar}
                </span>
              </label>
            ))}
          </div>
        ) : null}
      </fieldset>
    </OperationDialog>
  );
}

// ---------------------------------------------------------------------------
// 批量移除
// ---------------------------------------------------------------------------

interface RemoveDialogProps {
  trialId: string;
  summaries: LabelSummary[];
  initialLabels: string[];
  onClose: () => void;
  onApplied: (plan: LabelChangePlan) => void;
}

export function RemoveLabelsDialog({
  trialId,
  summaries,
  initialLabels,
  onClose,
  onApplied,
}: RemoveDialogProps) {
  const [selected, setSelected] = useState<string[]>(
    () => Array.from(new Set(initialLabels)),
  );

  const toggle = (label: string) => {
    setSelected((current) =>
      current.includes(label)
        ? current.filter((item) => item !== label)
        : [...current, label],
    );
  };

  return (
    <OperationDialog
      title="批量移除标签"
      submitLabel={`移除 ${selected.length} 个标签`}
      description="按规范化名称匹配，同一标签的大小写或空格混用拼写会一并移除；仅标签字段变化。"
      revisionKey={selected.join(",")}
      planBuilder={(state) => buildRemoveLabelPlan(state, trialId, selected)}
      onClose={onClose}
      onApplied={onApplied}
    >
      <div className="label-pick-list" data-testid="remove-label-list">
        {summaries.map((summary) => (
          <label className="label-pick-item" key={summary.label}>
            <input
              type="checkbox"
              checked={selected.includes(summary.label)}
              onChange={() => toggle(summary.label)}
            />
            <span className="label-chip label-chip-strong">{summary.label}</span>
            <span className="muted-copy">{summary.materials} 个材料</span>
          </label>
        ))}
      </div>
    </OperationDialog>
  );
}

// ---------------------------------------------------------------------------
// 重命名
// ---------------------------------------------------------------------------

interface RenameDialogProps {
  trialId: string;
  summary: LabelSummary;
  onClose: () => void;
  onApplied: (plan: LabelChangePlan) => void;
}

export function RenameLabelDialog({
  trialId,
  summary,
  onClose,
  onApplied,
}: RenameDialogProps) {
  const [newName, setNewName] = useState("");

  return (
    <OperationDialog
      title="重命名标签"
      submitLabel="重命名"
      description={
        summary.isCaseMixed
          ? `“${summary.label}”存在大小写或空格混用，重命名后所有拼写都会统一为新名称。`
          : `重命名后，携带“${summary.label}”的材料标签会替换为新名称，其他字段不变。`
      }
      revisionKey={newName}
      planBuilder={(state) =>
        buildRenameLabelPlan(state, trialId, summary.label, newName)
      }
      onClose={onClose}
      onApplied={onApplied}
    >
      <div className="rename-current">
        <span className="field-label">当前标签</span>
        <span className="label-chip label-chip-strong">{summary.label}</span>
        {summary.isCaseMixed ? (
          <span className="variant-note">
            混用拼写：{summary.variants.map((variant) => variant.value).join(" / ")}
          </span>
        ) : null}
      </div>
      <label className="field">
        <span className="field-label">新名称</span>
        <input
          className="field-input"
          value={newName}
          onChange={(event) => setNewName(event.target.value)}
          placeholder="输入统一后的新名称"
          data-testid="rename-label-input"
        />
        <span className="field-hint">
      若新名称已存在，请改用“合并标签”收拢新旧名称
        </span>
      </label>
    </OperationDialog>
  );
}

// ---------------------------------------------------------------------------
// 合并
// ---------------------------------------------------------------------------

interface MergeDialogProps {
  trialId: string;
  summaries: LabelSummary[];
  initialLabels: string[];
  onClose: () => void;
  onApplied: (plan: LabelChangePlan) => void;
}

export function MergeLabelsDialog({
  trialId,
  summaries,
  initialLabels,
  onClose,
  onApplied,
}: MergeDialogProps) {
  const [selected, setSelected] = useState<string[]>(
    () => Array.from(new Set(initialLabels)),
  );
  const [target, setTarget] = useState("");

  const toggle = (label: string) => {
    setSelected((current) =>
      current.includes(label)
        ? current.filter((item) => item !== label)
        : [...current, label],
    );
  };

  return (
    <OperationDialog
      title="合并标签"
      submitLabel="合并标签"
      description="选中的两个及以上标签会统一成目标名称；同一材料同时携带多个源标签时自动去重，其余字段和台架、观测、标记关系不变。"
      revisionKey={`${selected.join(",")}|${target}`}
      planBuilder={(state) =>
        buildMergeLabelPlan(state, trialId, selected, target)
      }
      onClose={onClose}
      onApplied={onApplied}
    >
      <div className="label-pick-list" data-testid="merge-label-list">
        {summaries.map((summary) => (
          <label className="label-pick-item" key={summary.label}>
            <input
              type="checkbox"
              checked={selected.includes(summary.label)}
              onChange={() => toggle(summary.label)}
            />
            <span className="label-chip label-chip-strong">{summary.label}</span>
            <span className="muted-copy">{summary.materials} 个材料</span>
            {summary.isCaseMixed ? (
              <span className="variant-note">含大小写混用</span>
            ) : null}
          </label>
        ))}
      </div>
      <label className="field">
        <span className="field-label">合并后的目标名称</span>
        <input
          className="field-input"
          value={target}
          onChange={(event) => setTarget(event.target.value)}
          placeholder="输入新名称，或填写上方某个已有标签名"
          data-testid="merge-target-input"
        />
      </label>
    </OperationDialog>
  );
}
