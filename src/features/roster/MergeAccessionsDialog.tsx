import { useMemo, useState } from "react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import {
  SelectField,
  TextAreaField,
  TextField,
} from "../../components/fields";
import {
  mergeAccessions,
  remainingQuantity,
} from "../../domain/consumption";
import { isAccessionRetired } from "../../domain/accession";
import type { FieldError } from "../../domain/result";
import type {
  Accession,
  ConsumptionEvent,
  WorkspaceState,
} from "../../domain/types";
import { useWorkspace } from "../../state/store";
import { todayDateOnly } from "../../domain/rules";

interface MergeAccessionsDialogProps {
  accession: Accession;
  state: WorkspaceState;
  onCancel: () => void;
  onSaved: (events: ConsumptionEvent[], target: Accession) => void;
}

export function MergeAccessionsDialog({
  accession,
  state,
  onCancel,
  onSaved,
}: MergeAccessionsDialogProps) {
  const { dispatch } = useWorkspace();
  const candidates = useMemo(
    () =>
      state.accessions.filter(
        (item) =>
          item.id !== accession.id &&
          item.trialId === accession.trialId &&
          !isAccessionRetired(item),
      ),
    [state.accessions, accession],
  );
  const [targetId, setTargetId] = useState(candidates[0]?.id ?? "");
  const [usedOn, setUsedOn] = useState(todayDateOnly());
  const [recordedBy, setRecordedBy] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FieldError[]>([]);
  const errorFor = (field: string) =>
    errors.find((error) => error.field === field)?.message;

  const sourceRemaining = remainingQuantity(
    accession,
    state.consumptionEvents,
  );
  const target = candidates.find((item) => item.id === targetId);
  const targetRemaining = target
    ? remainingQuantity(target, state.consumptionEvents)
    : 0;

  const handleSubmit = () => {
    const result = mergeAccessions(
      {
        sourceId: accession.id,
        targetId,
        recordedBy,
        usedOn,
        note,
      },
      state,
    );
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    dispatch({
      type: "accessions/merged",
      source: result.value.source,
      target: result.value.target,
      events: result.value.events,
    });
    onSaved(result.value.events, result.value.target);
  };

  return (
    <Dialog
      open
      title={`合并批次 · ${accession.accessionNo}`}
      onClose={onCancel}
      wide
    >
      <form
        className="editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
        data-testid="merge-form"
      >
        <div className="lifecycle-callout">
          <strong>
            {accession.accessionNo} · {accession.cultivar}（余量 {sourceRemaining}）
          </strong>
          <span>
            源批次全部余量转出后会停用并指向目标批次；历史耗用仍留在源批次，
            不会改写台架、观测或既有快照。
          </span>
        </div>
        <div className="form-grid">
          <SelectField
            label="目标批次（同试验）"
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            error={errorFor("targetId")}
            hint={
              target
                ? `${target.accessionNo} 当前余量 ${targetRemaining}，合并后为 ${targetRemaining + sourceRemaining}`
                : "没有可选目标批次"
            }
            data-testid="merge-target-select"
          >
            <option value="">请选择目标批次</option>
            {candidates.map((item) => (
              <option value={item.id} key={item.id}>
                {item.accessionNo} - {item.cultivar}（余量{" "}
                {remainingQuantity(item, state.consumptionEvents)}）
              </option>
            ))}
          </SelectField>
          <TextField
            label="合并日期"
            type="date"
            value={usedOn}
            max={todayDateOnly()}
            onChange={(event) => setUsedOn(event.target.value)}
            error={errorFor("usedOn")}
            data-testid="merge-date-input"
          />
          <TextField
            label="操作人"
            value={recordedBy}
            onChange={(event) => setRecordedBy(event.target.value)}
            error={errorFor("recordedBy")}
            data-testid="merge-recorded-by"
          />
          <TextAreaField
            label="合并说明"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            error={errorFor("note")}
            hint="转出原因会同时写入源/目标两条配对流水"
            className="field-span-2"
            rows={3}
            data-testid="merge-note-input"
          />
        </div>
        <div className="editor-actions">
          <Button tone="secondary" type="button" onClick={onCancel}>
            取消
          </Button>
          <Button type="submit" tone="danger" data-testid="confirm-merge">
            转出余量并停用源批次
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
