import { useMemo, useState } from "react";
import { Archive, Copy, Plus, ScrollText } from "lucide-react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { PageHeader } from "../../components/PageHeader";
import { SelectField, TextAreaField, TextField } from "../../components/fields";
import { StatusBadge } from "../../components/StatusBadge";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import type {
  FlagMetric,
  FlagSeverity,
  FlagThreshold,
  RuleSet,
  RuleSetScope,
} from "../../domain/types";
import type { FieldError } from "../../domain/result";
import { TRIAL_SEASONS } from "../../domain/rules";
import {
  describeRuleSetScope,
  publishRuleSet,
  retireRuleSet,
  type RuleSetDraft,
} from "../../domain/ruleset";
import { useWorkspace } from "../../state/store";

const METRIC_LABELS: Record<FlagMetric, string> = {
  heightMm: "株高",
  leafCount: "叶片数",
  ecMs: "电导率",
};

const SEVERITY_LABELS: Record<FlagSeverity, string> = {
  info: "提示",
  warning: "警告",
  critical: "严重",
};

interface ThresholdRow extends FlagThreshold {
  key: string;
}

let thresholdRowSeq = 0;
function nextRowKey(): string {
  thresholdRowSeq += 1;
  return `row-${thresholdRowSeq}`;
}

function toRows(thresholds: FlagThreshold[]): ThresholdRow[] {
  return thresholds.map((threshold) => ({ ...threshold, key: nextRowKey() }));
}

function scopeKindLabel(scope: RuleSetScope): string {
  if (scope.kind === "trial") {
    return "单试验";
  }
  if (scope.kind === "season") {
    return "季节";
  }
  return "默认";
}

export function RuleSetsPage() {
  const { state, dispatch } = useWorkspace();
  const [editorOpen, setEditorOpen] = useState(false);
  const [retiring, setRetiring] = useState<RuleSet | undefined>();
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  };

  const ordered = useMemo(
    () => [...state.ruleSets].sort((left, right) => right.version - left.version),
    [state.ruleSets],
  );

  return (
    <div className="page">
      <PageHeader
        eyebrow="判定标准"
        title="规则版本"
        description="观测边界、标记阈值和放行阻止策略的版本化演进；发布后不可变，更正通过新版本或退役完成。"
        actions={
          <Button onClick={() => setEditorOpen(true)} data-testid="open-publish-ruleset">
            <Plus size={16} />
            发布新版本
          </Button>
        }
      />
      <section className="content-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-title">已发布规则</span>
            <span className="panel-subtitle">
              {state.ruleSets.length} 个版本，按版本号倒序
            </span>
          </div>
          <ScrollText size={20} className="panel-icon" aria-hidden="true" />
        </div>
        <div className="ruleset-list">
          {ordered.map((ruleSet) => (
            <article
              className={`ruleset-card ${ruleSet.status === "retired" ? "ruleset-card-retired" : ""}`}
              key={ruleSet.id}
              data-testid={`ruleset-${ruleSet.id}`}
            >
              <header className="ruleset-card-header">
                <strong>
                  {ruleSet.name} v{ruleSet.version}
                </strong>
                <StatusBadge tone={ruleSet.status === "published" ? "positive" : "neutral"}>
                  {ruleSet.status === "published" ? "已发布" : "已退役"}
                </StatusBadge>
                <StatusBadge tone="info">
                  {scopeKindLabel(ruleSet.scope)}
                </StatusBadge>
              </header>
              <dl className="ruleset-card-meta">
                <div>
                  <dt>适用范围</dt>
                  <dd>{describeRuleSetScope(ruleSet.scope, state.trials)}</dd>
                </div>
                <div>
                  <dt>生效日期</dt>
                  <dd>{ruleSet.effectiveFrom}</dd>
                </div>
                <div>
                  <dt>测量边界</dt>
                  <dd>
                    株高 {ruleSet.growthBounds.heightMm.min}-{ruleSet.growthBounds.heightMm.max} ·
                    叶片 {ruleSet.growthBounds.leafCount.min}-{ruleSet.growthBounds.leafCount.max} ·
                    EC {ruleSet.growthBounds.ecMs.min}-{ruleSet.growthBounds.ecMs.max}
                  </dd>
                </div>
                <div>
                  <dt>标记阈值</dt>
                  <dd>
                    {ruleSet.flagThresholds.length === 0
                      ? "不自动派生标记"
                      : ruleSet.flagThresholds
                          .map(
                            (threshold) =>
                              `${threshold.code} ${METRIC_LABELS[threshold.metric]}${threshold.comparator === "lt" ? "<" : "≥"}${threshold.value}`,
                          )
                          .join(" · ")}
                  </dd>
                </div>
                <div>
                  <dt>阻止放行</dt>
                  <dd>
                    {ruleSet.clearance.blockingSeverities
                      .map((severity) => SEVERITY_LABELS[severity])
                      .join("、")}
                    级标记
                  </dd>
                </div>
              </dl>
              <p className="ruleset-card-note">{ruleSet.note}</p>
              {ruleSet.status === "retired" && ruleSet.retireNote ? (
                <p className="ruleset-card-retire">
                  退役于 {ruleSet.retiredOn?.slice(0, 10)}：{ruleSet.retireNote}
                </p>
              ) : null}
              {ruleSet.status === "published" ? (
                <div className="ruleset-card-actions">
                  <Button
                    tone="ghost"
                    size="sm"
                    onClick={() => setRetiring(ruleSet)}
                    data-testid={`retire-ruleset-${ruleSet.id}`}
                  >
                    <Archive size={14} />
                    退役
                  </Button>
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </section>
      <Dialog
        open={editorOpen}
        title="发布新规则版本"
        onClose={() => setEditorOpen(false)}
        wide
      >
        <RuleSetEditor
          onCancel={() => setEditorOpen(false)}
          onSaved={(ruleSet) => {
            setEditorOpen(false);
            pushToast({
              tone: "success",
              title: "规则版本已发布",
              message: `${ruleSet.name} v${ruleSet.version} 将自 ${ruleSet.effectiveFrom} 起生效。`,
            });
          }}
        />
      </Dialog>
      <Dialog
        open={Boolean(retiring)}
        title="退役规则版本"
        onClose={() => setRetiring(undefined)}
      >
        {retiring ? (
          <RetireRuleSetForm
            ruleSet={retiring}
            onCancel={() => setRetiring(undefined)}
            onSaved={(ruleSet) => {
              setRetiring(undefined);
              pushToast({
                tone: "warning",
                title: "规则版本已退役",
                message: `${ruleSet.name} v${ruleSet.version} 不再参与新判定，历史结论仍可追溯。`,
              });
            }}
          />
        ) : null}
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

interface RuleSetEditorProps {
  onCancel: () => void;
  onSaved: (ruleSet: RuleSet) => void;
}

function RuleSetEditor({ onCancel, onSaved }: RuleSetEditorProps) {
  const { state, dispatch } = useWorkspace();
  const baseRuleSet =
    [...state.ruleSets]
      .filter((ruleSet) => ruleSet.status === "published")
      .sort((left, right) => right.version - left.version)[0] ??
    state.ruleSets[0];

  const [baseId, setBaseId] = useState(baseRuleSet?.id ?? "");
  const base =
    state.ruleSets.find((ruleSet) => ruleSet.id === baseId) ?? baseRuleSet;

  const [name, setName] = useState("");
  const [scopeKind, setScopeKind] = useState<"workspace" | "season" | "trial">(
    "workspace",
  );
  const [scopeSeason, setScopeSeason] = useState(TRIAL_SEASONS[0]);
  const [scopeTrialId, setScopeTrialId] = useState(state.trials[0]?.id ?? "");
  const [effectiveFrom, setEffectiveFrom] = useState("");
  const [note, setNote] = useState("");
  const [bounds, setBounds] = useState(() => ({ ...structuredClone(base.growthBounds) }));
  const [thresholds, setThresholds] = useState<ThresholdRow[]>(() =>
    toRows(base.flagThresholds),
  );
  const [blocking, setBlocking] = useState<FlagSeverity[]>([
    ...base.clearance.blockingSeverities,
  ]);
  const [errors, setErrors] = useState<FieldError[]>([]);

  const errorFor = (field: string): string | undefined =>
    errors.find((error) => error.field === field)?.message;

  const copyFromBase = (sourceId: string) => {
    const source = state.ruleSets.find((ruleSet) => ruleSet.id === sourceId);
    if (!source) {
      return;
    }
    setBaseId(sourceId);
    setBounds(structuredClone(source.growthBounds));
    setThresholds(toRows(source.flagThresholds));
    setBlocking([...source.clearance.blockingSeverities]);
  };

  const updateThreshold = (
    key: string,
    patch: Partial<FlagThreshold>,
  ) => {
    setThresholds((current) =>
      current.map((row) => (row.key === key ? { ...row, ...patch } : row)),
    );
  };

  const toggleBlocking = (severity: FlagSeverity) => {
    setBlocking((current) =>
      current.includes(severity)
        ? current.filter((item) => item !== severity)
        : [...current, severity],
    );
  };

  const handleSubmit = () => {
    const scope: RuleSetScope =
      scopeKind === "trial"
        ? { kind: "trial", trialId: scopeTrialId }
        : scopeKind === "season"
          ? { kind: "season", season: scopeSeason }
          : { kind: "workspace" };
    const draft: RuleSetDraft = {
      name,
      scope,
      effectiveFrom,
      note,
      growthBounds: {
        heightMm: { min: Number(bounds.heightMm.min), max: Number(bounds.heightMm.max) },
        leafCount: { min: Number(bounds.leafCount.min), max: Number(bounds.leafCount.max) },
        ecMs: { min: Number(bounds.ecMs.min), max: Number(bounds.ecMs.max) },
      },
      flagThresholds: thresholds.map(({ key: _key, ...threshold }) => ({
        ...threshold,
        value: Number(threshold.value),
      })),
      blockingSeverities: blocking,
    };
    const result = publishRuleSet(draft, state);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    dispatch({ type: "ruleset/published", ruleSet: result.value });
    onSaved(result.value);
  };

  return (
    <form
      className="editor-form"
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
      data-testid="ruleset-form"
    >
      <div className="form-grid">
        <SelectField
          label="基于版本"
          value={baseId}
          onChange={(event) => copyFromBase(event.target.value)}
          hint="新版本的边界、阈值和阻止策略从所选版本复制"
        >
          {state.ruleSets.map((ruleSet) => (
            <option value={ruleSet.id} key={ruleSet.id}>
              {ruleSet.name} v{ruleSet.version}
              {ruleSet.status === "retired" ? "（已退役）" : ""}
            </option>
          ))}
        </SelectField>
        <TextField
          label="版本名称"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={errorFor("name")}
          placeholder="例如：夏季加严判定"
          data-testid="ruleset-name"
        />
        <TextField
          label="生效日期"
          type="date"
          value={effectiveFrom}
          onChange={(event) => setEffectiveFrom(event.target.value)}
          error={errorFor("effectiveFrom")}
          hint="可以晚于今天，规则会在试验中途按观测日生效"
          data-testid="ruleset-effective-from"
        />
        <SelectField
          label="适用范围"
          value={scopeKind}
          onChange={(event) =>
            setScopeKind(event.target.value as "workspace" | "season" | "trial")
          }
          error={errorFor("scope")}
          data-testid="ruleset-scope-kind"
        >
          <option value="workspace">全部试验（默认）</option>
          <option value="season">按季节</option>
          <option value="trial">按试验</option>
        </SelectField>
        {scopeKind === "season" ? (
          <SelectField
            label="季节"
            value={scopeSeason}
            onChange={(event) => setScopeSeason(event.target.value)}
          >
            {TRIAL_SEASONS.map((season) => (
              <option value={season} key={season}>
                {season}
              </option>
            ))}
          </SelectField>
        ) : null}
        {scopeKind === "trial" ? (
          <SelectField
            label="试验"
            value={scopeTrialId}
            onChange={(event) => setScopeTrialId(event.target.value)}
          >
            {state.trials.map((trial) => (
              <option value={trial.id} key={trial.id}>
                {trial.code} - {trial.cropFamily}
              </option>
            ))}
          </SelectField>
        ) : null}
      </div>
      <TextAreaField
        label="调整原因"
        rows={2}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        error={errorFor("note")}
        hint="会随版本永久保存，用于解释后续结论的判定依据"
        data-testid="ruleset-note"
      />
      <fieldset className="ruleset-fieldset">
        <legend>测量边界</legend>
        <div className="bounds-grid">
          <TextField
            label="株高下限"
            type="number"
            value={bounds.heightMm.min}
            onChange={(event) =>
              setBounds((current) => ({
                ...current,
                heightMm: { ...current.heightMm, min: Number(event.target.value) },
              }))
            }
            error={errorFor("bounds.heightMm")}
          />
          <TextField
            label="株高上限"
            type="number"
            value={bounds.heightMm.max}
            onChange={(event) =>
              setBounds((current) => ({
                ...current,
                heightMm: { ...current.heightMm, max: Number(event.target.value) },
              }))
            }
          />
          <TextField
            label="叶片数下限"
            type="number"
            value={bounds.leafCount.min}
            onChange={(event) =>
              setBounds((current) => ({
                ...current,
                leafCount: { ...current.leafCount, min: Number(event.target.value) },
              }))
            }
            error={errorFor("bounds.leafCount")}
          />
          <TextField
            label="叶片数上限"
            type="number"
            value={bounds.leafCount.max}
            onChange={(event) =>
              setBounds((current) => ({
                ...current,
                leafCount: { ...current.leafCount, max: Number(event.target.value) },
              }))
            }
          />
          <TextField
            label="电导率下限"
            type="number"
            step="0.1"
            value={bounds.ecMs.min}
            onChange={(event) =>
              setBounds((current) => ({
                ...current,
                ecMs: { ...current.ecMs, min: Number(event.target.value) },
              }))
            }
            error={errorFor("bounds.ecMs")}
          />
          <TextField
            label="电导率上限"
            type="number"
            step="0.1"
            value={bounds.ecMs.max}
            onChange={(event) =>
              setBounds((current) => ({
                ...current,
                ecMs: { ...current.ecMs, max: Number(event.target.value) },
              }))
            }
          />
        </div>
      </fieldset>
      <fieldset className="ruleset-fieldset">
        <legend>标记阈值</legend>
        {thresholds.map((row, index) => (
          <div className="threshold-row" key={row.key}>
            <TextField
              label="代码"
              value={row.code}
              onChange={(event) =>
                updateThreshold(row.key, { code: event.target.value.toUpperCase() })
              }
              error={errorFor(`thresholds.${index}.code`)}
            />
            <SelectField
              label="指标"
              value={row.metric}
              onChange={(event) =>
                updateThreshold(row.key, {
                  metric: event.target.value as FlagMetric,
                })
              }
            >
              <option value="heightMm">株高</option>
              <option value="leafCount">叶片数</option>
              <option value="ecMs">电导率</option>
            </SelectField>
            <SelectField
              label="比较"
              value={row.comparator}
              onChange={(event) =>
                updateThreshold(row.key, {
                  comparator: event.target.value as "lt" | "gte",
                })
              }
            >
              <option value="lt">低于</option>
              <option value="gte">达到或超过</option>
            </SelectField>
            <TextField
              label="阈值"
              type="number"
              step="0.1"
              value={row.value}
              onChange={(event) =>
                updateThreshold(row.key, { value: Number(event.target.value) })
              }
              error={errorFor(`thresholds.${index}.value`)}
              data-testid={index === 0 ? "threshold-value-0" : undefined}
            />
            <SelectField
              label="级别"
              value={row.severity}
              onChange={(event) =>
                updateThreshold(row.key, {
                  severity: event.target.value as FlagSeverity,
                })
              }
            >
              <option value="info">提示</option>
              <option value="warning">警告</option>
              <option value="critical">严重</option>
            </SelectField>
            <TextField
              label="说明模板"
              value={row.messageTemplate}
              onChange={(event) =>
                updateThreshold(row.key, { messageTemplate: event.target.value })
              }
              error={errorFor(`thresholds.${index}.messageTemplate`)}
              hint="可用 {cultivar} 和 {value} 占位符"
            />
            <Button
              tone="ghost"
              size="sm"
              className="icon-button threshold-remove"
              onClick={() =>
                setThresholds((current) =>
                  current.filter((item) => item.key !== row.key),
                )
              }
              aria-label={`移除阈值 ${row.code}`}
              type="button"
            >
              ×
            </Button>
          </div>
        ))}
        <Button
          tone="secondary"
          size="sm"
          type="button"
          onClick={() =>
            setThresholds((current) => [
              ...current,
              {
                key: nextRowKey(),
                code: "",
                metric: "heightMm",
                comparator: "lt",
                value: 0,
                severity: "warning",
                messageTemplate: "{cultivar} 触发 {value} 阈值",
              },
            ])
          }
        >
          <Plus size={14} />
          添加阈值
        </Button>
      </fieldset>
      <fieldset className="ruleset-fieldset">
        <legend>放行阻止级别</legend>
        <div className="blocking-options">
          {(Object.keys(SEVERITY_LABELS) as FlagSeverity[]).map((severity) => (
            <label className="blocking-option" key={severity}>
              <input
                type="checkbox"
                checked={blocking.includes(severity)}
                onChange={() => toggleBlocking(severity)}
              />
              {SEVERITY_LABELS[severity]}级标记阻止放行
            </label>
          ))}
        </div>
        {errorFor("blockingSeverities") ? (
          <p className="form-level-error">{errorFor("blockingSeverities")}</p>
        ) : null}
      </fieldset>
      <div className="editor-actions">
        <Button tone="secondary" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" data-testid="publish-ruleset-button">
          <Copy size={15} />
          发布版本
        </Button>
      </div>
    </form>
  );
}

interface RetireRuleSetFormProps {
  ruleSet: RuleSet;
  onCancel: () => void;
  onSaved: (ruleSet: RuleSet) => void;
}

function RetireRuleSetForm({ ruleSet, onCancel, onSaved }: RetireRuleSetFormProps) {
  const { state, dispatch } = useWorkspace();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>();

  const handleRetire = () => {
    const result = retireRuleSet(ruleSet, state, note);
    if (!result.ok) {
      setError(result.errors[0]?.message);
      return;
    }
    dispatch({ type: "ruleset/updated", ruleSet: result.value });
    onSaved(result.value);
  };

  return (
    <div className="editor-form">
      <p className="muted-copy">
        退役 {ruleSet.name} v{ruleSet.version}
        后，它不再参与新观测和放行的判定；已按它得出的历史结论仍然保留并可追溯。
      </p>
      <TextAreaField
        label="退役原因"
        rows={3}
        value={note}
        onChange={(event) => setNote(event.target.value)}
        error={error}
        data-testid="retire-ruleset-note"
      />
      <div className="editor-actions">
        <Button tone="secondary" onClick={onCancel}>
          取消
        </Button>
        <Button onClick={handleRetire} data-testid="confirm-retire-ruleset">
          确认退役
        </Button>
      </div>
    </div>
  );
}
