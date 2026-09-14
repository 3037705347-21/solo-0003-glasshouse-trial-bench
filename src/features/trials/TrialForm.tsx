import { useState } from "react";
import type { Trial } from "../../domain/types";
import type { TrialDraft } from "../../domain/trial";
import { Button } from "../../components/Button";
import {
  SelectField,
  TextAreaField,
  TextField,
} from "../../components/fields";
import { TRIAL_SEASONS } from "../../domain/rules";
import type { FieldError } from "../../domain/result";
import { createTrial, updateTrial } from "../../domain/trial";
import { useWorkspace } from "../../state/store";

interface TrialFormProps {
  trial?: Trial;
  onSaved: () => void;
  onCancel: () => void;
}

function blankDraft(): TrialDraft {
  return {
    code: "",
    cropFamily: "",
    objective: "",
    season: "春季",
    startDate: "",
    endDate: "",
  };
}

function draftFromTrial(trial: Trial): TrialDraft {
  return {
    code: trial.code,
    cropFamily: trial.cropFamily,
    objective: trial.objective,
    season: trial.season,
    startDate: trial.startDate,
    endDate: trial.endDate,
  };
}

export function TrialForm({ trial, onSaved, onCancel }: TrialFormProps) {
  const { state, dispatch } = useWorkspace();
  const [draft, setDraft] = useState<TrialDraft>(() =>
    trial ? draftFromTrial(trial) : blankDraft(),
  );
  const [errors, setErrors] = useState<FieldError[]>([]);

  const errorFor = (field: string): string | undefined => {
    return errors.find((error) => error.field === field)?.message;
  };

  const update = <K extends keyof TrialDraft>(
    key: K,
    value: TrialDraft[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = () => {
    const result = trial
      ? updateTrial(trial, draft, state)
      : createTrial(draft, state);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    dispatch(
      trial
        ? { type: "trial/updated", trial: result.value }
        : { type: "trial/created", trial: result.value },
    );
    onSaved();
  };

  return (
    <form
      className="editor-form"
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
      data-testid="trial-form"
    >
      <div className="form-grid">
        <TextField
          label="试验编号"
          value={draft.code}
          onChange={(event) => update("code", event.target.value)}
          error={errorFor("code")}
          hint="例如 CUC-07，保存时自动转为大写"
          data-testid="trial-code-input"
        />
        <TextField
          label="作物科属"
          value={draft.cropFamily}
          onChange={(event) => update("cropFamily", event.target.value)}
          error={errorFor("cropFamily")}
          data-testid="trial-crop-input"
        />
        <SelectField
          label="季节"
          value={draft.season}
          onChange={(event) => update("season", event.target.value)}
          error={errorFor("season")}
        >
          {TRIAL_SEASONS.map((season) => (
            <option value={season} key={season}>
              {season}
            </option>
          ))}
        </SelectField>
        <TextField
          label="开始日期"
          type="date"
          value={draft.startDate}
          onChange={(event) => update("startDate", event.target.value)}
          error={errorFor("startDate")}
        />
        <TextField
          label="结束日期"
          type="date"
          value={draft.endDate}
          onChange={(event) => update("endDate", event.target.value)}
          error={errorFor("endDate")}
        />
        <TextAreaField
          label="试验目标"
          value={draft.objective}
          onChange={(event) => update("objective", event.target.value)}
          error={errorFor("objective")}
          className="field-span-2"
          rows={3}
        />
      </div>
      {errorFor("state") ? (
        <p className="form-level-error">{errorFor("state")}</p>
      ) : null}
      <div className="editor-actions">
        <Button tone="secondary" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" data-testid="save-trial-button">
          {trial ? "保存试验" : "创建试验"}
        </Button>
      </div>
    </form>
  );
}
