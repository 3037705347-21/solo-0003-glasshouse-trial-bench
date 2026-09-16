import { useState } from "react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import {
  SelectField,
  TextAreaField,
  TextField,
} from "../../components/fields";
import {
  CONSUMPTION_DESTINATIONS,
  destinationLabel,
  recordConsumption,
  remainingQuantity,
} from "../../domain/consumption";
import type { FieldError } from "../../domain/result";
import type {
  Accession,
  ConsumptionDestination,
  ConsumptionEvent,
  WorkspaceState,
} from "../../domain/types";
import { useWorkspace } from "../../state/store";
import { todayDateOnly } from "../../domain/rules";

interface RecordConsumptionDialogProps {
  accession: Accession;
  state: WorkspaceState;
  onCancel: () => void;
  onSaved: (event: ConsumptionEvent) => void;
}

export function RecordConsumptionDialog({
  accession,
  state,
  onCancel,
  onSaved,
}: RecordConsumptionDialogProps) {
  const { dispatch } = useWorkspace();
  const remaining = remainingQuantity(accession, state.consumptionEvents);
  const [quantity, setQuantity] = useState(1);
  const [usedOn, setUsedOn] = useState(todayDateOnly());
  const [recordedBy, setRecordedBy] = useState("");
  const [destination, setDestination] =
    useState<ConsumptionDestination>("trial");
  const [refLabel, setRefLabel] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FieldError[]>([]);
  const errorFor = (field: string) =>
    errors.find((error) => error.field === field)?.message;

  const handleSubmit = () => {
    const result = recordConsumption(
      {
        accessionId: accession.id,
        quantity,
        usedOn,
        recordedBy,
        destination,
        refLabel,
        note,
      },
      state,
    );
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    dispatch({ type: "consumption/recorded", event: result.value });
    onSaved(result.value);
  };

  const plannedAfter = Math.max(0, remaining - (Number.isFinite(quantity) ? quantity : 0));

  return (
    <Dialog open title={`登记耗用 · ${accession.accessionNo}`} onClose={onCancel} wide>
      <form
        className="editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
        data-testid="consumption-form"
      >
        <div className="lifecycle-callout">
          <strong>
            {accession.accessionNo} · {accession.cultivar}
          </strong>
          <span>
            登记数量 {accession.quantity}，当前余量 {remaining}；登记后余量 {plannedAfter}。
            耗用流水只追加、不覆盖，事后可对单条耗用发起更正留痕。
          </span>
        </div>
        <div className="form-grid">
          <TextField
            label="耗用数量"
            type="number"
            min={1}
            value={quantity}
            onChange={(event) => setQuantity(Number(event.target.value))}
            error={errorFor("quantity")}
            hint={
              errorFor("quantity")
                ? undefined
                : `当前余量 ${remaining}，不能登记超过余量的耗用`
            }
            data-testid="consumption-quantity-input"
          />
          <TextField
            label="使用日期"
            type="date"
            value={usedOn}
            max={todayDateOnly()}
            onChange={(event) => setUsedOn(event.target.value)}
            error={errorFor("usedOn")}
            data-testid="consumption-date-input"
          />
          <TextField
            label="登记人"
            value={recordedBy}
            onChange={(event) => setRecordedBy(event.target.value)}
            error={errorFor("recordedBy")}
            data-testid="consumption-recorded-by"
          />
          <SelectField
            label="去向类型"
            value={destination}
            onChange={(event) =>
              setDestination(event.target.value as ConsumptionDestination)
            }
            data-testid="consumption-destination-select"
          >
            {CONSUMPTION_DESTINATIONS.map((value) => (
              <option value={value} key={value}>
                {destinationLabel(value)}
              </option>
            ))}
          </SelectField>
          <TextField
            label="去向 / 活动"
            value={refLabel}
            onChange={(event) => setRefLabel(event.target.value)}
            error={errorFor("refLabel")}
            hint={
              destination === "trial"
                ? "试验使用自动归属本试验，可留空"
                : "例如：品比展示、猝倒病销毁、苗盘合并"
            }
            className="field-span-2"
            data-testid="consumption-ref-input"
          />
          <TextAreaField
            label="说明"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            error={errorFor("note")}
            className="field-span-2"
            rows={3}
            data-testid="consumption-note-input"
          />
        </div>
        <div className="editor-actions">
          <Button tone="secondary" type="button" onClick={onCancel}>
            取消
          </Button>
          <Button type="submit" data-testid="confirm-consumption">
            登记耗用
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
