import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "../../components/Button";
import { SelectField, TextField } from "../../components/fields";
import type { ObservationEntry } from "../../domain/types";
import type { ObservationDraft } from "../../domain/observation";
import type { FieldError } from "../../domain/result";
import { createId } from "../../domain/id";
import {
  decideObservationRecording,
  mintIdempotencyToken,
} from "../../domain/dedup";
import { validateObservationDraft, deriveFlags } from "../../domain/observation";
import { todayDateOnly } from "../../domain/rules";
import { activeAccessionsForTrial } from "../../state/selectors";
import { useWorkspace } from "../../state/store";

export type ObservationSaveOutcome =
  | "recorded"
  | "duplicate_retry"
  | "auto_converged"
  | "review_opened";

interface PassFormProps {
  trialId: string;
  onSaved: (outcome: ObservationSaveOutcome) => void;
  onCancel: () => void;
}

function emptyEntry(accessionId = ""): ObservationEntry {
  return {
    accessionId,
    heightMm: 80,
    leafCount: 8,
    ecMs: 1.8,
    notes: "",
  };
}

export function PassForm({ trialId, onSaved, onCancel }: PassFormProps) {
  const { state, dispatch } = useWorkspace();
  const accessions = activeAccessionsForTrial(state, trialId);
  // 令牌与观测 id 在表单挂载时各生成一次：同一次录入的重试/重复点击复用二者，
  // 取消后重新打开会得到新令牌（新的录入意图）。
  const [submissionIdentity] = useState(() => ({
    idempotencyToken: mintIdempotencyToken(),
    passId: createId("obs"),
  }));
  const [draft, setDraft] = useState<ObservationDraft>({
    trialId,
    observedOn: todayDateOnly(),
    observer: "",
    entries: [emptyEntry(accessions[0]?.id ?? "")],
    idempotencyToken: submissionIdentity.idempotencyToken,
    passId: submissionIdentity.passId,
  });
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const errorFor = (field: string): string | undefined => {
    return errors.find((error) => error.field === field)?.message;
  };

  const updateEntry = (
    index: number,
    key: keyof ObservationEntry,
    value: string | number,
  ) => {
    setDraft((current) => ({
      ...current,
      entries: current.entries.map((entry, entryIndex) =>
        entryIndex === index
          ? { ...entry, [key]: key === "accessionId" || key === "notes" ? value : Number(value) }
          : entry,
      ),
    }));
  };

  const addEntry = () => {
    setDraft((current) => ({
      ...current,
      entries: [...current.entries, emptyEntry(accessions[0]?.id ?? "")],
    }));
  };

  const removeEntry = (index: number) => {
    setDraft((current) => ({
      ...current,
      entries: current.entries.filter((_, entryIndex) => entryIndex !== index),
    }));
  };

  const handleSubmit = () => {
    if (submitting) {
      return;
    }
    // 先跑既有校验；通过后再进入去重决策。
    const validated = validateObservationDraft(
      { ...draft, ...submissionIdentity },
      state,
    );
    if (!validated.ok) {
      setErrors(validated.errors);
      return;
    }
    setSubmitting(true);
    const decision = decideObservationRecording(validated.value, state);
    if (!decision.ok) {
      setErrors(decision.errors);
      setSubmitting(false);
      return;
    }
    const { outcome, pass, review, audit } = decision.value;
    if (outcome === "duplicate_retry") {
      // 同一次提交的重复送达：幂等 no-op，不派生标记、不写审计。
      onSaved("duplicate_retry");
      return;
    }
    // 自动收敛的重复观测不再派生标记，避免出现永远无法处理的悬挂标记；
    // review_opened 时新观测暂时有效，仍照常派生，裁决收敛后再按条目撤回。
    const flags =
      outcome === "auto_converged" ? [] : deriveFlags(pass, state.accessions);
    dispatch({
      type: "observation/recorded",
      pass,
      flags,
      review,
      audit,
    });
    onSaved(outcome);
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
      data-testid="observation-form"
    >
      <div className="form-grid">
        <TextField label="试验" value={trialLabel} readOnly />
        <TextField
          label="观测日期"
          type="date"
          value={draft.observedOn}
          onChange={(event) =>
            setDraft((current) => ({ ...current, observedOn: event.target.value }))
          }
          error={errorFor("observedOn")}
        />
        <TextField
          label="观测人"
          value={draft.observer}
          onChange={(event) =>
            setDraft((current) => ({ ...current, observer: event.target.value }))
          }
          error={errorFor("observer")}
          data-testid="observer-input"
        />
      </div>
      <div className="entry-editor">
        <div className="entry-editor-heading">
          <h3>测量记录</h3>
          <Button tone="secondary" size="sm" onClick={addEntry} type="button">
            <Plus size={15} />
            添加行
          </Button>
        </div>
        {draft.entries.map((entry, index) => (
          <div className="entry-row" key={`${index}-${entry.accessionId}`}>
            <SelectField
              label="材料"
              value={entry.accessionId}
              onChange={(event) =>
                updateEntry(index, "accessionId", event.target.value)
              }
              error={errorFor(`entries.${index}.accessionId`)}
            >
              <option value="">请选择材料</option>
              {accessions.map((accession) => (
                <option value={accession.id} key={accession.id}>
                  {accession.accessionNo} - {accession.cultivar}
                </option>
              ))}
            </SelectField>
            <TextField
              label="株高（毫米）"
              type="number"
              value={entry.heightMm}
              onChange={(event) =>
                updateEntry(index, "heightMm", event.target.value)
              }
              error={errorFor(`entries.${index}.heightMm`)}
            />
            <TextField
              label="叶片数"
              type="number"
              value={entry.leafCount}
              onChange={(event) =>
                updateEntry(index, "leafCount", event.target.value)
              }
              error={errorFor(`entries.${index}.leafCount`)}
            />
            <TextField
              label="电导率 mS/cm"
              type="number"
              step="0.1"
              value={entry.ecMs}
              onChange={(event) =>
                updateEntry(index, "ecMs", event.target.value)
              }
              error={errorFor(`entries.${index}.ecMs`)}
            />
            <TextField
              label="备注"
              value={entry.notes}
              onChange={(event) =>
                updateEntry(index, "notes", event.target.value)
              }
            />
            <Button
              tone="ghost"
              size="sm"
              className="icon-button entry-remove"
              onClick={() => removeEntry(index)}
              disabled={draft.entries.length === 1}
              aria-label={`移除第 ${index + 1} 行`}
              type="button"
            >
              <Trash2 size={16} />
            </Button>
          </div>
        ))}
        {errorFor("entries") ? (
          <p className="form-level-error">{errorFor("entries")}</p>
        ) : null}
      </div>
      <div className="editor-actions">
        <Button tone="secondary" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" data-testid="save-observation-button" disabled={submitting}>
          {submitting ? "提交中…" : "记录观测"}
        </Button>
      </div>
    </form>
  );
}
