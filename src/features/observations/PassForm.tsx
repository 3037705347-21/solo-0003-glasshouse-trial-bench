import { useMemo, useState } from "react";
import { Button } from "../../components/Button";
import { TextField } from "../../components/fields";
import type { ObservationDraft } from "../../domain/observation";
import type { FieldError } from "../../domain/result";
import { createObservationPass, deriveFlags } from "../../domain/observation";
import { todayDateOnly } from "../../domain/rules";
import { activeAccessionsForTrial } from "../../state/selectors";
import { useWorkspace } from "../../state/store";
import {
  EntryRowsEditor,
  emptyObservationEntry,
} from "./EntryRowsEditor";

interface PassFormProps {
  trialId: string;
  onSaved: () => void;
  onCancel: () => void;
}

export function PassForm({ trialId, onSaved, onCancel }: PassFormProps) {
  const { state, dispatch } = useWorkspace();
  const accessions = activeAccessionsForTrial(state, trialId);
  const [draft, setDraft] = useState<ObservationDraft>({
    trialId,
    observedOn: todayDateOnly(),
    observer: "",
    entries: [emptyObservationEntry(accessions[0]?.id ?? "")],
  });
  const [errors, setErrors] = useState<FieldError[]>([]);

  const errorFor = (field: string): string | undefined => {
    return errors.find((error) => error.field === field)?.message;
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
      <EntryRowsEditor
        entries={draft.entries}
        accessions={accessions}
        errors={errors}
        onChange={(entries) =>
          setDraft((current) => ({ ...current, entries }))
        }
      />
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
