import { useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "../../components/Button";
import { SelectField, TextField } from "../../components/fields";
import type { ObservationEntry } from "../../domain/types";
import type { ObservationDraft } from "../../domain/observation";
import type { FieldError } from "../../domain/result";
import { createObservationPass, deriveFlags } from "../../domain/observation";
import { todayDateOnly } from "../../domain/rules";
import { accessionsForTrial } from "../../state/selectors";
import { useWorkspace } from "../../state/store";

interface PassFormProps {
  trialId: string;
  onSaved: () => void;
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
  const accessions = accessionsForTrial(state, trialId);
  const [draft, setDraft] = useState<ObservationDraft>({
    trialId,
    observedOn: todayDateOnly(),
    observer: "",
    entries: [emptyEntry(accessions[0]?.id ?? "")],
  });
  const [errors, setErrors] = useState<FieldError[]>([]);

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
    const result = createObservationPass(draft, state);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    const flags = deriveFlags(result.value, state.accessions);
    dispatch({ type: "observation/recorded", pass: result.value, flags });
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
        <Button type="submit" data-testid="save-observation-button">
          记录观测
        </Button>
      </div>
    </form>
  );
}
