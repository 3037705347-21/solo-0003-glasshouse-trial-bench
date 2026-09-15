import { useMemo, useState } from "react";
import { Plus, X } from "lucide-react";
import { Button } from "../../components/Button";
import { TextAreaField, TextField } from "../../components/fields";
import type { CloseoutDraft } from "../../domain/closeout";
import { createCloseoutReview } from "../../domain/closeout";
import type { CloseoutReview } from "../../domain/types";
import type { FieldError } from "../../domain/result";
import { useWorkspace } from "../../state/store";

interface CloseoutFormProps {
  trialId: string;
  onSaved: (review: CloseoutReview) => void;
  onCancel: () => void;
}

export function CloseoutForm({ trialId, onSaved, onCancel }: CloseoutFormProps) {
  const { state, dispatch } = useWorkspace();
  const [draft, setDraft] = useState<CloseoutDraft>({
    trialId,
    createdBy: "",
    conclusion: "",
    outstandingIssues: "",
    nextSeasonAdvice: "",
    actionItems: [],
  });
  const [actionText, setActionText] = useState("");
  const [errors, setErrors] = useState<FieldError[]>([]);

  const errorFor = (field: string): string | undefined => {
    return errors.find((error) => error.field === field)?.message;
  };

  const addActionItem = () => {
    const text = actionText.trim();
    if (!text) {
      return;
    }
    setDraft((current) => ({
      ...current,
      actionItems: [...current.actionItems, text],
    }));
    setActionText("");
  };

  const removeActionItem = (index: number) => {
    setDraft((current) => ({
      ...current,
      actionItems: current.actionItems.filter(
        (_, itemIndex) => itemIndex !== index,
      ),
    }));
  };

  const handleSubmit = () => {
    const result = createCloseoutReview(draft, state);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    dispatch({ type: "closeout/recorded", review: result.value });
    onSaved(result.value);
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
      data-testid="closeout-form"
    >
      <div className="form-grid">
        <TextField label="试验" value={trialLabel} readOnly />
        <TextField
          label="复盘负责人"
          value={draft.createdBy}
          onChange={(event) =>
            setDraft((current) => ({ ...current, createdBy: event.target.value }))
          }
          error={errorFor("createdBy")}
          data-testid="reviewer-input"
        />
        <TextAreaField
          label="复盘结论"
          rows={3}
          value={draft.conclusion}
          onChange={(event) =>
            setDraft((current) => ({ ...current, conclusion: event.target.value }))
          }
          error={errorFor("conclusion")}
          className="field-span-2"
          data-testid="conclusion-input"
        />
        <TextAreaField
          label="遗留问题"
          rows={2}
          value={draft.outstandingIssues}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              outstandingIssues: event.target.value,
            }))
          }
          hint="可选，记录本次复盘未解决的问题"
          className="field-span-2"
          data-testid="issues-input"
        />
        <TextAreaField
          label="下季建议"
          rows={2}
          value={draft.nextSeasonAdvice}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              nextSeasonAdvice: event.target.value,
            }))
          }
          error={errorFor("nextSeasonAdvice")}
          className="field-span-2"
          data-testid="advice-input"
        />
      </div>
      <div className="entry-editor">
        <div className="entry-editor-heading">
          <h3>后续行动</h3>
          <span className="field-hint">添加行动项后，复盘将以待跟进状态记录</span>
        </div>
        <div className="action-input-row">
          <TextField
            label="行动内容"
            value={actionText}
            onChange={(event) => setActionText(event.target.value)}
            className="action-input-grow"
            data-testid="action-input"
          />
          <Button
            tone="secondary"
            onClick={addActionItem}
            type="button"
            data-testid="add-action-item"
          >
            <Plus size={15} />
            添加
          </Button>
        </div>
        {draft.actionItems.length > 0 ? (
          <div className="action-chips">
            {draft.actionItems.map((item, index) => (
              <span className="action-chip" key={`${item}-${index}`}>
                {item}
                <Button
                  tone="ghost"
                  size="sm"
                  className="icon-button"
                  onClick={() => removeActionItem(index)}
                  aria-label={`移除行动 ${index + 1}`}
                  type="button"
                >
                  <X size={14} />
                </Button>
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="editor-actions">
        <Button tone="secondary" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" data-testid="save-closeout-button">
          记录复盘
        </Button>
      </div>
    </form>
  );
}
