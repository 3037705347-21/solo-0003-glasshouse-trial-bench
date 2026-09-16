import { useState } from "react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { TextAreaField, TextField } from "../../components/fields";
import {
  correctConsumption,
  destinationLabel,
  effectiveUsedQuantity,
  remainingQuantity,
} from "../../domain/consumption";
import type { FieldError } from "../../domain/result";
import type {
  Accession,
  ConsumptionEvent,
  WorkspaceState,
} from "../../domain/types";
import { useWorkspace } from "../../state/store";

interface CorrectConsumptionDialogProps {
  accession: Accession;
  event: ConsumptionEvent;
  state: WorkspaceState;
  onCancel: () => void;
  onSaved: (event: ConsumptionEvent) => void;
}

export function CorrectConsumptionDialog({
  accession,
  event,
  state,
  onCancel,
  onSaved,
}: CorrectConsumptionDialogProps) {
  const { dispatch } = useWorkspace();
  const currentQuantity = effectiveUsedQuantity(event, state.consumptionEvents);
  const remaining = remainingQuantity(accession, state.consumptionEvents);
  const [correctedQuantity, setCorrectedQuantity] = useState(currentQuantity);
  const [recordedBy, setRecordedBy] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FieldError[]>([]);
  const errorFor = (field: string) =>
    errors.find((error) => error.field === field)?.message;

  const delta = currentQuantity - correctedQuantity;
  const projectedRemaining = remaining + delta;

  const handleSubmit = () => {
    const result = correctConsumption(
      event,
      { correctedQuantity, recordedBy, note },
      state,
    );
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    dispatch({ type: "consumption/recorded", event: result.value });
    onSaved(result.value);
  };

  return (
    <Dialog
      open
      title={`更正耗用 · ${accession.accessionNo}`}
      onClose={onCancel}
      wide
    >
      <form
        className="editor-form"
        onSubmit={(formEvent) => {
          formEvent.preventDefault();
          handleSubmit();
        }}
        data-testid="correction-form"
      >
        <div className="lifecycle-callout">
          <strong>
            {event.usedOn} · {destinationLabel(event.destination)} ·{" "}
            {event.ref.label}
          </strong>
          <span>
            原始记录登记耗用 {currentQuantity}（说明：{event.note}）。
            更正只会追加一条冲销流水，原始记录保留留痕、不会被覆盖。
          </span>
        </div>
        <div className="form-grid">
          <TextField
            label="更正后耗用数量"
            type="number"
            min={0}
            value={correctedQuantity}
            onChange={(formEvent) =>
              setCorrectedQuantity(Number(formEvent.target.value))
            }
            error={errorFor("correctedQuantity")}
            hint={
              Number.isFinite(delta)
                ? delta >= 0
                  ? `将冲回 ${delta} 到批次余量，更正后余量 ${projectedRemaining}`
                  : `将追加耗用 ${-delta}，更正后余量 ${projectedRemaining}`
                : undefined
            }
            data-testid="correction-quantity-input"
          />
          <TextField
            label="更正人"
            value={recordedBy}
            onChange={(formEvent) => setRecordedBy(formEvent.target.value)}
            error={errorFor("recordedBy")}
            data-testid="correction-recorded-by"
          />
          <TextAreaField
            label="更正原因"
            value={note}
            onChange={(formEvent) => setNote(formEvent.target.value)}
            error={errorFor("note")}
            hint="请说明原始数量为何有误（如现场复核、计数口径修正）"
            className="field-span-2"
            rows={3}
            data-testid="correction-note-input"
          />
        </div>
        <div className="editor-actions">
          <Button tone="secondary" type="button" onClick={onCancel}>
            取消
          </Button>
          <Button type="submit" data-testid="confirm-correction">
            提交更正
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
