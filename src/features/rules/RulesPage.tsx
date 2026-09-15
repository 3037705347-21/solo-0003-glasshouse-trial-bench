import { useState } from "react";
import { Copy, Play, Plus, ScrollText } from "lucide-react";
import { Button } from "../../components/Button";
import { DataTable, type DataColumn } from "../../components/DataTable";
import { Dialog } from "../../components/Dialog";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import type { RuleVersion } from "../../domain/types";
import {
  activateRuleVersion,
  hasScopeConflict,
  ruleVersionLabel,
  scopeLabel,
} from "../../domain/ruleVersion";
import { useWorkspace } from "../../state/store";
import { RuleSourceLine } from "./RuleSourceLine";
import { RuleVersionForm } from "./RuleVersionForm";

const STATUS_LABELS: Record<RuleVersion["status"], string> = {
  active: "启用中",
  inactive: "未启用",
  archived: "已归档",
};

const STATUS_TONES: Record<
  RuleVersion["status"],
  "positive" | "neutral" | "info"
> = {
  active: "positive",
  inactive: "neutral",
  archived: "info",
};

export function RulesPage() {
  const { state, dispatch } = useWorkspace();
  const [trialId, setTrialId] = useState(() => state.trials[0]?.id ?? "");
  const [editorOpen, setEditorOpen] = useState(false);
  const [prefill, setPrefill] = useState<RuleVersion | undefined>();
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  };

  const handleActivate = (version: RuleVersion) => {
    const conflict = hasScopeConflict(state, version);
    const result = activateRuleVersion(state, version.id);
    if (!result.ok) {
      pushToast({
        tone: "error",
        title: "启用失败",
        message: result.errors[0]?.message ?? "无法启用该版本",
      });
      return;
    }
    dispatch({ type: "ruleVersion/activated", versions: result.value });
    pushToast({
      tone: conflict ? "warning" : "success",
      title: "规则版本已启用",
      message: conflict
        ? `${ruleVersionLabel(version, state.trials)} 已启用。注意：存在作用域冲突，试验级规则优先于科属规则。`
        : `${ruleVersionLabel(version, state.trials)} 已启用，观测、标记和放行视图将统一使用该版本。`,
    });
  };

  const openCreate = (base?: RuleVersion) => {
    setPrefill(base);
    setEditorOpen(true);
  };

  const sortedVersions = [...state.ruleVersions].sort((left, right) =>
    right.createdAt.localeCompare(left.createdAt),
  );

  const columns: Array<DataColumn<RuleVersion>> = [
    {
      key: "scope",
      header: "作用域",
      render: (version) => (
        <span className="table-primary">
          {scopeLabel(version.scope, state.trials)}
        </span>
      ),
    },
    {
      key: "version",
      header: "版本",
      render: (version) => `v${version.version}`,
    },
    {
      key: "status",
      header: "状态",
      render: (version) => (
        <StatusBadge tone={STATUS_TONES[version.status]}>
          {STATUS_LABELS[version.status]}
        </StatusBadge>
      ),
    },
    {
      key: "ranges",
      header: "测量范围",
      render: (version) =>
        `株高 ${version.ranges.heightMm.min}-${version.ranges.heightMm.max} · 叶片 ${version.ranges.leafCount.min}-${version.ranges.leafCount.max} · EC ${version.ranges.ecMs.min}-${version.ranges.ecMs.max}`,
    },
    {
      key: "conditions",
      header: "标记条件",
      render: (version) => `${version.flagConditions.length} 条`,
    },
    {
      key: "changeReason",
      header: "变更原因",
      render: (version) => version.changeReason,
    },
    {
      key: "createdAt",
      header: "创建时间",
      render: (version) => new Date(version.createdAt).toLocaleString(),
    },
    {
      key: "actions",
      header: "",
      render: (version) => (
        <div className="table-actions">
          {version.status !== "active" ? (
            <Button
              tone="secondary"
              size="sm"
              onClick={() => handleActivate(version)}
              data-testid={`activate-rule-${version.id}`}
            >
              <Play size={14} />
              启用
            </Button>
          ) : null}
          <Button
            tone="ghost"
            size="sm"
            onClick={() => openCreate(version)}
            data-testid={`copy-rule-${version.id}`}
          >
            <Copy size={14} />
            以此为基础新建
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="试验规则"
        title="规则版本"
        description="为试验或作物科属维护测量范围与标记条件，每次保存都会形成不可变版本。"
        actions={
          <Button onClick={() => openCreate()} data-testid="open-create-rule-version">
            <Plus size={16} />
            新建规则版本
          </Button>
        }
      />
      <section className="content-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-title">试验规则来源</span>
            <span className="panel-subtitle">
              查看每个试验当前生效的规则版本；试验级规则优先于科属规则
            </span>
          </div>
          <ScrollText size={20} className="panel-icon" aria-hidden="true" />
        </div>
        <div className="rule-source-panel">
          <select
            className="compact-select"
            value={trialId}
            onChange={(event) => setTrialId(event.target.value)}
            aria-label="选择试验"
            data-testid="rules-trial-select"
          >
            {state.trials.map((trial) => (
              <option value={trial.id} key={trial.id}>
                {trial.code} - {trial.cropFamily}
              </option>
            ))}
          </select>
          {trialId ? <RuleSourceLine trialId={trialId} /> : null}
        </div>
      </section>
      <section className="content-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-title">版本列表</span>
            <span className="panel-subtitle">
              共 {state.ruleVersions.length} 个不可变版本
            </span>
          </div>
        </div>
        <DataTable
          columns={columns}
          rows={sortedVersions}
          rowKey={(version) => version.id}
          emptyMessage="还没有规则版本，请先新建。"
        />
      </section>
      <Dialog
        open={editorOpen}
        title={prefill ? "以此为基础新建规则版本" : "新建规则版本"}
        onClose={() => setEditorOpen(false)}
        wide
      >
        <RuleVersionForm
          prefill={prefill}
          onCancel={() => setEditorOpen(false)}
          onSaved={() => {
            setEditorOpen(false);
            pushToast({
              tone: "success",
              title: "规则版本已保存",
              message: "新版本当前为未启用状态，启用后才会作用于观测与放行。",
            });
          }}
        />
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
