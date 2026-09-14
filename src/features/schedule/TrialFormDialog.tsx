import { useState } from "react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { SelectField, TextField, TextAreaField } from "../../components/fields";
import type { FieldError } from "../../domain/result";
import { fieldError } from "../../domain/result";
import { TRIAL_SEASONS } from "../../domain/rules";
import { createTrial, updateTrial, type TrialDraft } from "../../domain/trial";
import type { Trial } from "../../domain/types";
import { useWorkspace } from "../../state/store";

interface TrialFormDialogProps {
  open: boolean;
  trial?: Trial;
  onClose: () => void;
  onSaved: (trial: Trial) => void;
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

const emptyDraft: TrialDraft = {
  code: "",
  cropFamily: "",
  objective: "",
  season: TRIAL_SEASONS[0],
  startDate: "",
  endDate: "",
};

export function TrialFormDialog({
  open,
  trial,
  onClose,
  onSaved,
}: TrialFormDialogProps) {
  const { state, dispatch } = useWorkspace();
  const [draft, setDraft] = useState<TrialDraft>(
    trial ? draftFromTrial(trial) : emptyDraft,
  );
  const [errors, setErrors] = useState<FieldError[]>([]);

  const errorFor = (field: string): string | undefined =>
    errors.find((error) => error.field === field)?.message;

  const update = <K extends keyof TrialDraft>(key: K, value: TrialDraft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = () => {
    const normalizedCode = draft.code.trim().toUpperCase();
    if (
      !trial &&
      normalizedCode &&
      state.trials.some((item) => item.code === normalizedCode)
    ) {
      setErrors([
        fieldError("code", "duplicate_code", "该试验编号已存在，请使用其他编号"),
      ]);
      return;
    }
    const result = trial
      ? updateTrial(trial, draft)
      : createTrial({ ...draft, code: normalizedCode });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    dispatch({
      type: trial ? "trial/updated" : "trial/created",
      trial: result.value,
    });
    onSaved(result.value);
  };

  return (
    <Dialog
      open={open}
      title={trial ? "修改试验日期" : "新建试验"}
      onClose={onClose}
      footer={
        <>
          <Button tone="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            type="submit"
            form="trial-form"
            data-testid="save-trial-button"
          >
            {trial ? "保存修改" : "创建试验"}
          </Button>
        </>
      }
    >
      <form
        id="trial-form"
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
            placeholder="如 SOL-04"
            data-testid="trial-code-input"
          />
          <TextField
            label="作物科属"
            value={draft.cropFamily}
            onChange={(event) => update("cropFamily", event.target.value)}
            error={errorFor("cropFamily")}
            data-testid="trial-family-input"
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
            data-testid="trial-start-input"
          />
          <TextField
            label="结束日期"
            type="date"
            value={draft.endDate}
            onChange={(event) => update("endDate", event.target.value)}
            error={errorFor("endDate")}
            hint={draft.startDate === draft.endDate ? "开始与结束为同一天" : undefined}
            data-testid="trial-end-input"
          />
        </div>
        <TextAreaField
          label="试验目标"
          value={draft.objective}
          onChange={(event) => update("objective", event.target.value)}
          error={errorFor("objective")}
          rows={3}
        />
      </form>
    </Dialog>
  );
}
