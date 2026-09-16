import { useEffect, useMemo, useState } from "react";
import { PencilLine, Plus, Power, Trash2 } from "lucide-react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { SelectField, TextField } from "../../components/fields";
import type { FieldError } from "../../domain/result";
import {
  composeAccessionNumber,
  countRuleUsage,
  createNumberRule,
  describeRulePattern,
  describeRuleScope,
  ruleCanDelete,
  updateNumberRule,
  type NumberRuleDraft,
} from "../../domain/numbering";
import type {
  NumberRule,
  NumberRuleDatePart,
  NumberRuleScopeType,
  NumberSequenceScope,
} from "../../domain/types";
import { useWorkspace } from "../../state/store";

interface NumberRulesDialogProps {
  open: boolean;
  trialId: string;
  onClose: () => void;
}

function blankDraft(trialId: string): NumberRuleDraft {
  return {
    name: "",
    scopeType: "trial",
    scopeValue: trialId,
    prefix: "SOL",
    datePart: "yearMonthDay",
    sequencePadding: 3,
    sequenceScope: "global",
    nextSequence: 1,
    status: "active",
  };
}

function draftFromRule(rule: NumberRule): NumberRuleDraft {
  return {
    name: rule.name,
    scopeType: rule.scopeType,
    scopeValue: rule.scopeValue,
    prefix: rule.prefix,
    datePart: rule.datePart,
    sequencePadding: rule.sequencePadding,
    sequenceScope: rule.sequenceScope,
    nextSequence: rule.nextSequence,
    status: rule.status,
  };
}

function dateExample(datePart: NumberRuleDatePart): string {
  if (datePart === "none") {
    return "";
  }
  if (datePart === "year") {
    return "2026";
  }
  if (datePart === "yearMonth") {
    return "202609";
  }
  return "20260916";
}

export function NumberRulesDialog({
  open,
  trialId,
  onClose,
}: NumberRulesDialogProps) {
  const { state, dispatch } = useWorkspace();
  const [editing, setEditing] = useState<NumberRule | undefined>();
  const [creating, setCreating] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [draft, setDraft] = useState<NumberRuleDraft>(() => blankDraft(trialId));

  useEffect(() => {
    if (open) {
      setCreating(false);
      setEditing(undefined);
      setErrors([]);
    }
  }, [open]);

  const formOpen = creating || Boolean(editing);

  const startCreate = () => {
    setDraft(blankDraft(trialId));
    setErrors([]);
    setCreating(true);
    setEditing(undefined);
  };

  const startEdit = (rule: NumberRule) => {
    setDraft(draftFromRule(rule));
    setErrors([]);
    setEditing(rule);
    setCreating(false);
  };

  const update = <K extends keyof NumberRuleDraft>(
    key: K,
    value: NumberRuleDraft[K],
  ) => {
    setDraft((current) => {
      const next = { ...current, [key]: value };
      if (key === "datePart" && value === "none") {
        next.sequenceScope = "global";
      }
      return next;
    });
  };

  const example = useMemo(
    () =>
      composeAccessionNumber(
        draft.prefix.toUpperCase().replace(/[^A-Z0-9]/g, ""),
        dateExample(draft.datePart),
        1,
        draft.sequencePadding,
      ),
    [draft.prefix, draft.datePart, draft.sequencePadding],
  );

  const handleSave = () => {
    const result = editing
      ? updateNumberRule(editing, draft, state)
      : createNumberRule(draft, state);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    dispatch({
      type: editing ? "numberRule/updated" : "numberRule/created",
      rule: result.value,
    });
    setEditing(undefined);
    setCreating(false);
    setErrors([]);
  };

  const handleToggleStatus = (rule: NumberRule) => {
    const next: NumberRule = {
      ...rule,
      status: rule.status === "active" ? "inactive" : "active",
      updatedAt: new Date().toISOString(),
    };
    const result = updateNumberRule(
      rule,
      draftFromRule(next),
      state,
    );
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    dispatch({ type: "numberRule/updated", rule: result.value });
  };

  const handleDelete = (rule: NumberRule) => {
    if (!ruleCanDelete(state, rule)) {
      return;
    }
    dispatch({ type: "numberRule/removed", ruleId: rule.id });
  };

  const errorFor = (field: string) =>
    errors.find((error) => error.field === field)?.message;

  const rules = [...state.numberRules].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  );

  return (
    <Dialog
      open={open}
      title="材料编号规则"
      onClose={onClose}
      wide
      footer={
        formOpen ? (
          <>
            <Button
              tone="secondary"
              onClick={() => {
                setCreating(false);
                setEditing(undefined);
                setErrors([]);
              }}
            >
              返回列表
            </Button>
            <Button onClick={handleSave} data-testid="save-number-rule">
              {editing ? "保存规则" : "创建规则"}
            </Button>
          </>
        ) : undefined
      }
    >
      {formOpen ? (
        <div className="editor-form">
          <div className="lifecycle-callout">
            <strong>{editing ? "修改规则" : "新建规则"}</strong>
            <span>
              规则保存后只影响之后新生成的编号；已有材料编号不会被改写。
              {editing
                ? " 停用规则后历史材料仍保留原编号来源。"
                : " 相同前缀、日期与序号组合的启用规则会互相冲突。"}
            </span>
          </div>
          <div className="form-grid">
            <TextField
              label="规则名称"
              value={draft.name}
              onChange={(event) => update("name", event.target.value)}
              error={errorFor("name")}
              data-testid="rule-name-input"
            />
            <SelectField
              label="适用范围"
              value={draft.scopeType}
              onChange={(event) =>
                update("scopeType", event.target.value as NumberRuleScopeType)
              }
              error={errorFor("scopeType")}
              data-testid="rule-scope-type"
            >
              <option value="trial">按试验</option>
              <option value="cropFamily">按作物科属</option>
              <option value="source">按来源</option>
            </SelectField>
            {draft.scopeType === "trial" ? (
              <SelectField
                label="适用试验"
                value={draft.scopeValue}
                onChange={(event) => update("scopeValue", event.target.value)}
                error={errorFor("scopeValue")}
                data-testid="rule-scope-value"
              >
                <option value="">请选择试验</option>
                {state.trials.map((item) => (
                  <option value={item.id} key={item.id}>
                    {item.code} - {item.cropFamily}
                  </option>
                ))}
              </SelectField>
            ) : (
              <TextField
                label={draft.scopeType === "cropFamily" ? "作物科属" : "来源名称"}
                value={draft.scopeValue}
                onChange={(event) => update("scopeValue", event.target.value)}
                error={errorFor("scopeValue")}
                hint={
                  draft.scopeType === "source"
                    ? "与材料登记中的来源完全一致时匹配"
                    : "与试验的作物科属完全一致时匹配"
                }
                data-testid="rule-scope-value"
              />
            )}
            <SelectField
              label="规则状态"
              value={draft.status}
              onChange={(event) =>
                update("status", event.target.value as NumberRule["status"])
              }
              data-testid="rule-status"
            >
              <option value="active">启用</option>
              <option value="inactive">停用（保留历史）</option>
            </SelectField>
            <TextField
              label="编号前缀"
              value={draft.prefix}
              onChange={(event) => update("prefix", event.target.value)}
              error={errorFor("prefix")}
              hint="2-8 位字母或数字，保存时自动大写"
              data-testid="rule-prefix"
            />
            <SelectField
              label="日期段"
              value={draft.datePart}
              onChange={(event) =>
                update("datePart", event.target.value as NumberRuleDatePart)
              }
              error={errorFor("datePart")}
              data-testid="rule-date-part"
            >
              <option value="none">不带日期</option>
              <option value="year">年（YYYY）</option>
              <option value="yearMonth">年月（YYYYMM）</option>
              <option value="yearMonthDay">年月日（YYYYMMDD）</option>
            </SelectField>
            <SelectField
              label="序号方式"
              value={draft.sequenceScope}
              onChange={(event) =>
                update(
                  "sequenceScope",
                  event.target.value as NumberSequenceScope,
                )
              }
              error={errorFor("sequenceScope")}
              data-testid="rule-sequence-scope"
              disabled={draft.datePart === "none"}
            >
              <option value="global">全局连续序号</option>
              <option value="perDate">按日期重新计数</option>
            </SelectField>
            <TextField
              label="序号位数"
              type="number"
              min={3}
              max={6}
              value={draft.sequencePadding}
              onChange={(event) =>
                update("sequencePadding", Number(event.target.value))
              }
              error={errorFor("sequencePadding")}
            />
            <TextField
              label="起始序号"
              type="number"
              min={1}
              max={999999}
              value={draft.nextSequence}
              onChange={(event) =>
                update("nextSequence", Number(event.target.value))
              }
              error={errorFor("nextSequence")}
              hint={
                editing
                  ? `当前已用至 ${editing.nextSequence - 1}；调低不会改写历史编号`
                  : "仅作为初始序号，系统会自动扫描已有编号取更大值"
              }
              data-testid="rule-next-sequence"
            />
          </div>
          <div className="number-preview-card" data-testid="rule-pattern-preview">
            <span>编号样式</span>
            <strong>{example || "—"}</strong>
            <small>
              最长 {example.length} 个字符（上限 24）；序号溢出位数时会自动进位但仍保持唯一。
            </small>
          </div>
        </div>
      ) : (
        <>
          <div className="rules-toolbar">
            <p className="muted-copy">
              规则按 试验 → 来源 → 作物科属 的优先级匹配；停用的规则不再生成新编号，但历史材料仍标注其来源规则。
            </p>
            <Button onClick={startCreate} data-testid="open-create-rule">
              <Plus size={15} />
              新建规则
            </Button>
          </div>
          {rules.length === 0 ? (
            <p className="muted-copy">
              还没有编号规则。未匹配规则时可以手工指定编号，或先创建一条规则后自动生成。
            </p>
          ) : (
            <div className="rules-list" data-testid="rules-list">
              {rules.map((rule) => {
                const usage = countRuleUsage(state, rule.id);
                const canDelete = ruleCanDelete(state, rule);
                return (
                  <div
                    className={`rule-row ${rule.status === "inactive" ? "rule-row-inactive" : ""}`}
                    key={rule.id}
                    data-testid={`rule-row-${rule.id}`}
                  >
                    <div className="rule-row-copy">
                      <strong>{rule.name}</strong>
                      <span>
                        {describeRuleScope(rule, state.trials)} ·{" "}
                        {describeRulePattern(rule)} ·{" "}
                        {rule.sequenceScope === "perDate"
                          ? "按日期计数"
                          : "全局连续"}{" "}
                        · 下一序号 {rule.nextSequence}
                      </span>
                      <small>
                        {rule.status === "active"
                          ? `已用于 ${usage} 个材料`
                          : `已停用 · 历史材料 ${usage} 个仍保留此规则`}
                      </small>
                    </div>
                    <div className="table-actions">
                      <Button
                        tone="ghost"
                        size="sm"
                        onClick={() => startEdit(rule)}
                        data-testid={`edit-rule-${rule.id}`}
                      >
                        <PencilLine size={14} />
                        编辑
                      </Button>
                      <Button
                        tone="ghost"
                        size="sm"
                        onClick={() => handleToggleStatus(rule)}
                        data-testid={`toggle-rule-${rule.id}`}
                      >
                        <Power size={14} />
                        {rule.status === "active" ? "停用" : "启用"}
                      </Button>
                      <Button
                        tone="ghost"
                        size="sm"
                        onClick={() => handleDelete(rule)}
                        disabled={!canDelete}
                        title={
                          canDelete
                            ? "删除规则"
                            : "已有材料使用该规则，只能停用不能删除"
                        }
                        data-testid={`delete-rule-${rule.id}`}
                      >
                        <Trash2 size={14} />
                        删除
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}
    </Dialog>
  );
}
