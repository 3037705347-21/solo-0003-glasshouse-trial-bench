import { useEffect, useMemo, useState } from "react";
import { Sparkles, PencilLine } from "lucide-react";
import type { Accession, PreferredLight } from "../../domain/types";
import type { AccessionDraft } from "../../domain/accession";
import {
  createAccession,
  updateAccession,
} from "../../domain/accession";
import {
  planGeneratedNumbers,
  previewNextNumbers,
  selectNumberRule,
} from "../../domain/numbering";
import { Button } from "../../components/Button";
import {
  SelectField,
  TextAreaField,
  TextField,
} from "../../components/fields";
import { LIGHT_PROFILES, TRAY_CELL_OPTIONS } from "../../domain/rules";
import type { FieldError } from "../../domain/result";
import { useWorkspace } from "../../state/store";

interface RosterFormProps {
  trialId: string;
  accession?: Accession;
  onSaved: () => void;
  onCancel: () => void;
}

function blankDraft(trialId: string): AccessionDraft {
  return {
    trialId,
    accessionNo: "",
    numberRuleId: undefined,
    cultivar: "",
    source: "",
    propagatedOn: "",
    quantity: 72,
    trayCells: 104,
    preferredLight: "full-sun",
    genotypeNote: "",
    labels: [],
  };
}

function draftFromAccession(accession: Accession): AccessionDraft {
  return {
    trialId: accession.trialId,
    accessionNo: accession.accessionNo,
    numberRuleId: accession.numberRuleId,
    cultivar: accession.cultivar,
    source: accession.source,
    propagatedOn: accession.propagatedOn,
    quantity: accession.quantity,
    trayCells: accession.trayCells,
    preferredLight: accession.preferredLight,
    genotypeNote: accession.genotypeNote,
    labels: accession.labels,
  };
}

export function RosterForm({
  trialId,
  accession,
  onSaved,
  onCancel,
}: RosterFormProps) {
  const { state, dispatch } = useWorkspace();
  const [draft, setDraft] = useState<AccessionDraft>(() =>
    accession
      ? draftFromAccession(accession)
      : blankDraft(trialId),
  );
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [labelText, setLabelText] = useState(() =>
    accession ? accession.labels.join(", ") : "",
  );
  // New materials default to rule-generated numbers; an existing accession
  // opens in manual mode only when its number was entered by hand.
  const [manualNumber, setManualNumber] = useState(() =>
    Boolean(accession && !accession.numberRuleId),
  );

  const isEdit = Boolean(accession);

  const numberContext = useMemo(
    () => ({
      trialId: draft.trialId,
      source: draft.source,
      propagatedOn: draft.propagatedOn,
    }),
    [draft.trialId, draft.source, draft.propagatedOn],
  );

  const matchedRule = useMemo(
    () => selectNumberRule(state, numberContext),
    [state, numberContext],
  );

  const preview = useMemo(() => {
    if (isEdit || manualNumber) {
      return { items: [], issues: [] };
    }
    return previewNextNumbers(state, numberContext, 3);
  }, [state, numberContext, isEdit, manualNumber]);

  // Keep the form's generated number in sync with the first preview candidate
  // until the user explicitly switches to manual entry.
  useEffect(() => {
    if (isEdit || manualNumber) {
      return;
    }
    const first = preview.items[0];
    setDraft((current) => ({
      ...current,
      accessionNo: first?.accessionNo ?? "",
      numberRuleId: first?.ruleId,
    }));
  }, [preview, isEdit, manualNumber]);

  const errorFor = (field: string): string | undefined => {
    return errors.find((error) => error.field === field)?.message;
  };

  const previewIssue = preview.issues[0]?.message;

  const update = <K extends keyof AccessionDraft>(
    key: K,
    value: AccessionDraft[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleGenerate = () => {
    setManualNumber(false);
    const plan = planGeneratedNumbers(state, [
      {
        trialId,
        source: draft.source,
        propagatedOn: draft.propagatedOn,
      },
    ]);
    const entry = plan.entries[0];
    if (entry && !entry.skipped) {
      setDraft((current) => ({
        ...current,
        accessionNo: entry.accessionNo,
        numberRuleId: entry.ruleId,
      }));
    }
  };

  const handleSubmit = () => {
    const labels = labelText
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean);
    const candidate: AccessionDraft = { ...draft, labels };

    if (!isEdit && !manualNumber && matchedRule) {
      // Generate against the current state at submit time so the previewed
      // number and the advanced counter come from the same allocation.
      const plan = planGeneratedNumbers(state, [
        {
          trialId: candidate.trialId,
          source: candidate.source,
          propagatedOn: candidate.propagatedOn,
        },
      ]);
      const entry = plan.entries[0];
      if (!entry || entry.skipped) {
        setErrors([
          {
            field: "accessionNo",
            code: "no_rule",
            message:
              plan.issues[0]?.message ??
              "没有匹配的启用编号规则，请改用手工指定或先配置规则",
          },
        ]);
        return;
      }
      candidate.accessionNo = entry.accessionNo;
      candidate.numberRuleId = entry.ruleId;
      const created = createAccession(candidate, state);
      if (!created.ok) {
        setErrors(created.errors);
        return;
      }
      dispatch({
        type: "accession/created",
        accession: created.value,
        numberRules: state.numberRules.map((rule) => {
          const bump = plan.bumpedRules.find(
            (item) => item.ruleId === rule.id,
          );
          return bump ? { ...rule, nextSequence: bump.nextSequence } : rule;
        }),
      });
      onSaved();
      return;
    }

    if (!isEdit && manualNumber) {
      candidate.numberRuleId = undefined;
    }

    const result = accession
      ? updateAccession(accession, candidate, state)
      : createAccession(candidate, state);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    dispatch({
      type: accession ? "accession/updated" : "accession/created",
      accession: result.value,
    });
    onSaved();
  };

  const trialLabel = useMemo(
    () =>
      state.trials.find((trial) => trial.id === trialId)?.code ?? "当前试验",
    [state.trials, trialId],
  );

  return (
    <form
      className="editor-form"
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
      data-testid="accession-form"
    >
      <div className="form-grid">
        <TextField label="试验" value={trialLabel} readOnly hint="由当前选中的试验确定" />
        <div className="field">
          <span className="field-label">材料编号</span>
          {isEdit ? (
            <>
              <input
                className="field-input"
                value={draft.accessionNo}
                readOnly
                data-testid="accession-number-input"
              />
              <span className="field-hint">
                已有材料编号不能修改；编号规则调整只影响之后新生成的编号
              </span>
            </>
          ) : manualNumber ? (
            <>
              <input
                className={`field-input ${errorFor("accessionNo") ? "field-input-error" : ""}`}
                value={draft.accessionNo}
                onChange={(event) => update("accessionNo", event.target.value)}
                data-testid="accession-number-input"
              />
              {errorFor("accessionNo") ? (
                <span className="field-error">{errorFor("accessionNo")}</span>
              ) : (
                <span className="field-hint">
                  手工指定编号仍会校验格式、长度和重复
                </span>
              )}
            </>
          ) : (
            <>
              <input
                className={`field-input ${errorFor("accessionNo") ? "field-input-error" : ""}`}
                value={draft.accessionNo}
                readOnly
                data-testid="accession-number-input"
              />
              {errorFor("accessionNo") ? (
                <span className="field-error">{errorFor("accessionNo")}</span>
              ) : previewIssue ? (
                <span className="field-error">{previewIssue}</span>
              ) : (
                <span className="field-hint" data-testid="number-rule-hint">
                  {matchedRule
                    ? `由规则「${matchedRule.name}」自动生成`
                    : "暂无匹配的启用规则"}
                </span>
              )}
            </>
          )}
        </div>
        {!isEdit ? (
          <div className="field">
            <span className="field-label">编号方式</span>
            <div className="number-mode-row">
              <Button
                type="button"
                tone={manualNumber ? "secondary" : "primary"}
                size="sm"
                onClick={handleGenerate}
                data-testid="use-generated-number"
              >
                <Sparkles size={14} />
                规则生成
              </Button>
              <Button
                type="button"
                tone={manualNumber ? "primary" : "secondary"}
                size="sm"
                onClick={() => {
                  setManualNumber(true);
                  setDraft((current) => {
                    const wasAutoFilled =
                      Boolean(current.numberRuleId) ||
                      preview.items.some(
                        (item) => item.accessionNo === current.accessionNo,
                      );
                    return {
                      ...current,
                      accessionNo: wasAutoFilled ? "" : current.accessionNo,
                      numberRuleId: undefined,
                    };
                  });
                  setErrors([]);
                }}
                data-testid="use-manual-number"
              >
                <PencilLine size={14} />
                手工指定
              </Button>
            </div>
            {!manualNumber && preview.items.length > 1 ? (
              <span className="field-hint" data-testid="number-preview">
                接下来：{preview.items.slice(0, 3).map((item) => item.accessionNo).join("、")}
              </span>
            ) : null}
          </div>
        ) : null}
        <TextField
          label="品种"
          value={draft.cultivar}
          onChange={(event) => update("cultivar", event.target.value)}
          error={errorFor("cultivar")}
          data-testid="cultivar-input"
        />
        <TextField
          label="来源"
          value={draft.source}
          onChange={(event) => update("source", event.target.value)}
          error={errorFor("source")}
        />
        <TextField
          label="繁殖日期"
          type="date"
          value={draft.propagatedOn}
          onChange={(event) => update("propagatedOn", event.target.value)}
          error={errorFor("propagatedOn")}
        />
        <TextField
          label="数量"
          type="number"
          min={1}
          max={500}
          value={draft.quantity}
          onChange={(event) => update("quantity", Number(event.target.value))}
          error={errorFor("quantity")}
        />
        <SelectField
          label="穴盘规格"
          value={draft.trayCells}
          onChange={(event) => update("trayCells", Number(event.target.value))}
        >
          {TRAY_CELL_OPTIONS.map((option) => (
            <option value={option} key={option}>
              {option} 孔
            </option>
          ))}
        </SelectField>
        <SelectField
          label="适宜光照"
          value={draft.preferredLight}
          onChange={(event) =>
            update("preferredLight", event.target.value as PreferredLight)
          }
          error={errorFor("preferredLight")}
        >
          {LIGHT_PROFILES.map((profile) => (
            <option value={profile} key={profile}>
              {profile === "full-sun"
                ? "全日照"
                : profile === "partial-shade"
                  ? "半阴"
                  : "遮阴"}
            </option>
          ))}
        </SelectField>
        <TextField
          label="标签"
          value={labelText}
          onChange={(event) => setLabelText(event.target.value)}
          hint="多个标签用逗号分隔"
          className="field-span-2"
        />
        <TextAreaField
          label="基因型 / 批次说明"
          value={draft.genotypeNote}
          onChange={(event) => update("genotypeNote", event.target.value)}
          error={errorFor("genotypeNote")}
          className="field-span-2"
          rows={4}
        />
      </div>
      <div className="editor-actions">
        <Button tone="secondary" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" data-testid="save-accession-button">
          {accession ? "保存材料" : "创建材料"}
        </Button>
      </div>
    </form>
  );
}
