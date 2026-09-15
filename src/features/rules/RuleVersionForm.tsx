import { useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "../../components/Button";
import { SelectField, TextAreaField, TextField } from "../../components/fields";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import type {
  FlagCondition,
  FlagSeverity,
  MeasurementRanges,
  RuleComparator,
  RuleMetric,
  RuleVersion,
} from "../../domain/types";
import type { FieldError } from "../../domain/result";
import {
  createRuleVersion,
  legacyRanges,
  RULE_COMPARATOR_LABELS,
  RULE_METRIC_LABELS,
  RULE_METRICS,
} from "../../domain/ruleVersion";
import { useWorkspace } from "../../state/store";

interface RuleVersionFormProps {
  prefill?: RuleVersion;
  onSaved: () => void;
  onCancel: () => void;
}

const DEFAULT_CONDITIONS: FlagCondition[] = [
  {
    code: "HT_UNDER",
    metric: "heightMm",
    comparator: "lt",
    threshold: 60,
    severity: "warning",
    messageTemplate: "{cultivar} 株高低于 {threshold} 毫米生长阈值",
  },
  {
    code: "EC_HIGH",
    metric: "ecMs",
    comparator: "gte",
    threshold: 3.5,
    severity: "critical",
    messageTemplate: "{cultivar} 的基质电导率达到 {threshold} mS/cm",
  },
];

function emptyCondition(): FlagCondition {
  return {
    code: "",
    metric: "heightMm",
    comparator: "lt",
    threshold: 0,
    severity: "warning",
    messageTemplate: "",
  };
}

export function RuleVersionForm({
  prefill,
  onSaved,
  onCancel,
}: RuleVersionFormProps) {
  const { state, dispatch } = useWorkspace();
  const [scopeKind, setScopeKind] = useState<"cropFamily" | "trial">(
    prefill?.scope.kind ?? "cropFamily",
  );
  const [cropFamily, setCropFamily] = useState(
    prefill?.scope.kind === "cropFamily" ? prefill.scope.cropFamily : "",
  );
  const [scopeTrialId, setScopeTrialId] = useState(
    prefill?.scope.kind === "trial"
      ? prefill.scope.trialId
      : (state.trials[0]?.id ?? ""),
  );
  const [ranges, setRanges] = useState<MeasurementRanges>(() =>
    prefill
      ? {
          heightMm: { ...prefill.ranges.heightMm },
          leafCount: { ...prefill.ranges.leafCount },
          ecMs: { ...prefill.ranges.ecMs },
        }
      : legacyRanges(),
  );
  const [conditions, setConditions] = useState<FlagCondition[]>(() =>
    prefill
      ? prefill.flagConditions.map((condition) => ({ ...condition }))
      : DEFAULT_CONDITIONS.map((condition) => ({ ...condition })),
  );
  const [changeReason, setChangeReason] = useState("");
  const [errors, setErrors] = useState<FieldError[]>([]);

  const errorFor = (field: string): string | undefined => {
    return errors.find((error) => error.field === field)?.message;
  };

  const knownFamilies = Array.from(
    new Set(state.trials.map((trial) => trial.cropFamily)),
  );

  const updateRange = (metric: RuleMetric, key: "min" | "max", value: string) => {
    setRanges((current) => ({
      ...current,
      [metric]: { ...current[metric], [key]: Number(value) },
    }));
  };

  const updateCondition = (
    index: number,
    key: keyof FlagCondition,
    value: string,
  ) => {
    setConditions((current) =>
      current.map((condition, conditionIndex) => {
        if (conditionIndex !== index) {
          return condition;
        }
        if (key === "threshold") {
          return { ...condition, threshold: Number(value) };
        }
        if (key === "code") {
          return { ...condition, code: value.toUpperCase() };
        }
        return { ...condition, [key]: value };
      }),
    );
  };

  const handleSubmit = () => {
    const result = createRuleVersion(
      {
        scope:
          scopeKind === "trial"
            ? { kind: "trial", trialId: scopeTrialId }
            : { kind: "cropFamily", cropFamily },
        ranges,
        flagConditions: conditions,
        changeReason,
      },
      state,
    );
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    dispatch({ type: "ruleVersion/created", version: result.value });
    onSaved();
  };

  return (
    <form
      className="editor-form"
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
      data-testid="rule-version-form"
    >
      <div className="form-grid">
        <div className="field">
          <span className="field-label">作用域类型</span>
          <SegmentedTabs
            label="作用域类型"
            value={scopeKind}
            options={[
              { value: "cropFamily", label: "科属规则" },
              { value: "trial", label: "试验规则" },
            ]}
            onChange={setScopeKind}
          />
        </div>
        {scopeKind === "cropFamily" ? (
          <TextField
            label="作物科属"
            value={cropFamily}
            onChange={(event) => setCropFamily(event.target.value)}
            error={errorFor("scope")}
            list="crop-family-options"
            hint="可输入新科属，或选择已有科属"
            data-testid="rule-scope-family"
          />
        ) : (
          <SelectField
            label="试验"
            value={scopeTrialId}
            onChange={(event) => setScopeTrialId(event.target.value)}
            error={errorFor("scope")}
            data-testid="rule-scope-trial"
          >
            {state.trials.map((trial) => (
              <option value={trial.id} key={trial.id}>
                {trial.code} - {trial.cropFamily}
              </option>
            ))}
          </SelectField>
        )}
        <datalist id="crop-family-options">
          {knownFamilies.map((family) => (
            <option value={family} key={family} />
          ))}
        </datalist>
      </div>
      <div className="entry-editor">
        <div className="entry-editor-heading">
          <h3>测量范围</h3>
          <span className="field-hint">超出范围的测量值会在入库前被拒绝</span>
        </div>
        {RULE_METRICS.map((metric) => (
          <div className="range-row" key={metric}>
            <span className="range-row-label">{RULE_METRIC_LABELS[metric]}</span>
            <TextField
              label="下限"
              type="number"
              step="0.1"
              value={ranges[metric].min}
              onChange={(event) => updateRange(metric, "min", event.target.value)}
            />
            <TextField
              label="上限"
              type="number"
              step="0.1"
              value={ranges[metric].max}
              onChange={(event) => updateRange(metric, "max", event.target.value)}
            />
            {errorFor(`ranges.${metric}`) ? (
              <span className="field-error">{errorFor(`ranges.${metric}`)}</span>
            ) : null}
          </div>
        ))}
      </div>
      <div className="entry-editor">
        <div className="entry-editor-heading">
          <h3>标记条件</h3>
          <Button
            tone="secondary"
            size="sm"
            onClick={() =>
              setConditions((current) => [...current, emptyCondition()])
            }
            type="button"
          >
            <Plus size={15} />
            添加条件
          </Button>
        </div>
        {conditions.map((condition, index) => (
          <div className="condition-row" key={index}>
            <TextField
              label="标记代码"
              value={condition.code}
              onChange={(event) =>
                updateCondition(index, "code", event.target.value)
              }
              error={errorFor(`conditions.${index}.code`)}
              placeholder="HT_UNDER"
            />
            <SelectField
              label="测量项"
              value={condition.metric}
              onChange={(event) =>
                updateCondition(index, "metric", event.target.value)
              }
            >
              {RULE_METRICS.map((metric) => (
                <option value={metric} key={metric}>
                  {RULE_METRIC_LABELS[metric]}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="触发方式"
              value={condition.comparator}
              onChange={(event) =>
                updateCondition(index, "comparator", event.target.value)
              }
            >
              {(Object.keys(RULE_COMPARATOR_LABELS) as RuleComparator[]).map(
                (comparator) => (
                  <option value={comparator} key={comparator}>
                    {RULE_COMPARATOR_LABELS[comparator]}
                  </option>
                ),
              )}
            </SelectField>
            <TextField
              label="阈值"
              type="number"
              step="0.1"
              value={condition.threshold}
              onChange={(event) =>
                updateCondition(index, "threshold", event.target.value)
              }
              error={errorFor(`conditions.${index}.threshold`)}
            />
            <SelectField
              label="严重程度"
              value={condition.severity}
              onChange={(event) =>
                updateCondition(index, "severity", event.target.value)
              }
            >
              {(["info", "warning", "critical"] as FlagSeverity[]).map(
                (severity) => (
                  <option value={severity} key={severity}>
                    {severity === "critical"
                      ? "严重"
                      : severity === "warning"
                        ? "警告"
                        : "提示"}
                  </option>
                ),
              )}
            </SelectField>
            <TextField
              label="标记说明"
              value={condition.messageTemplate}
              onChange={(event) =>
                updateCondition(index, "messageTemplate", event.target.value)
              }
              error={errorFor(`conditions.${index}.messageTemplate`)}
              hint="可使用 {cultivar}、{threshold}、{value} 占位符"
            />
            <Button
              tone="ghost"
              size="sm"
              className="icon-button entry-remove"
              onClick={() =>
                setConditions((current) =>
                  current.filter((_, conditionIndex) => conditionIndex !== index),
                )
              }
              aria-label={`移除第 ${index + 1} 条条件`}
              type="button"
            >
              <Trash2 size={16} />
            </Button>
          </div>
        ))}
        {conditions.length === 0 ? (
          <p className="field-hint">没有标记条件时，观测只会校验测量范围。</p>
        ) : null}
      </div>
      <TextAreaField
        label="变更原因"
        rows={2}
        value={changeReason}
        onChange={(event) => setChangeReason(event.target.value)}
        error={errorFor("changeReason")}
        hint="保存后版本不可修改，变更原因会随版本一起保留"
        data-testid="rule-change-reason"
      />
      <div className="editor-actions">
        <Button tone="secondary" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" data-testid="save-rule-version-button">
          保存新版本
        </Button>
      </div>
    </form>
  );
}
