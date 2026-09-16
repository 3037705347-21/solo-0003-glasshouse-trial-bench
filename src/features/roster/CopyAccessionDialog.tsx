import { useState } from "react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import {
  SelectField,
  TextAreaField,
  TextField,
} from "../../components/fields";
import {
  copyAccessionAcrossTrials,
  remainingQuantity,
} from "../../domain/consumption";
import type { FieldError } from "../../domain/result";
import type { Accession, WorkspaceState } from "../../domain/types";
import { useWorkspace } from "../../state/store";

interface CopyAccessionDialogProps {
  accession: Accession;
  state: WorkspaceState;
  suggestedAccessionNo: string;
  onCancel: () => void;
  onSaved: (accession: Accession) => void;
}

export function CopyAccessionDialog({
  accession,
  state,
  suggestedAccessionNo,
  onCancel,
  onSaved,
}: CopyAccessionDialogProps) {
  const { dispatch } = useWorkspace();
  const otherTrials = state.trials.filter(
    (trial) => trial.id !== accession.trialId,
  );
  const remaining = remainingQuantity(accession, state.consumptionEvents);
  const [targetTrialId, setTargetTrialId] = useState(otherTrials[0]?.id ?? "");  const [accessionNo, setAccessionNo] = useState(suggestedAccessionNo);
  const [quantity, setQuantity] = useState(Math.max(1, remaining));
  const [recordedBy, setRecordedBy] = useState("");
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FieldError[]>([]);
  const errorFor = (field: string) =>
    errors.find((error) => error.field === field)?.message;

  const duplicateInTarget = state.accessions.some(
    (item) =>
      item.accessionNo === accessionNo.trim() && item.trialId === targetTrialId,
  );

  const handleSubmit = () => {
    const result = copyAccessionAcrossTrials(
      {
        accession,
        accessionNo: accessionNo.trim(),
        targetTrialId,
        quantity,
        recordedBy,
        note,
      },
      state,
    );
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    dispatch({
      type: "accession/copied",
      accession: result.value.accession,
      sourceEvent: result.value.sourceEvent,
    });
    onSaved(result.value.accession);
  };

  return (
    <Dialog
      open
      title={`跨试验复制 · ${accession.accessionNo}`}
      onClose={onCancel}
      wide
    >
      <form
        className="editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
        data-testid="copy-accession-form"
      >
        <div className="lifecycle-callout">
          <strong>
            {accession.accessionNo} · {accession.cultivar}（当前余量 {remaining}）
          </strong>
          <span>
            复制会在目标试验建立独立新批次：耗用流水不复制，新批次从空账本开始；
            复制数量从源批次以「跨试验复制」转出，归属清楚可追溯。
          </span>
        </div>
        {otherTrials.length === 0 ? (
          <p className="form-level-error">
            当前只有一个试验，没有可复制的目标试验。
          </p>
        ) : (
        <div className="form-grid">
          <SelectField
            label="目标试验"
            value={targetTrialId}
            onChange={(event) => setTargetTrialId(event.target.value)}
            error={errorFor("targetTrialId")}
            data-testid="copy-target-trial-select"
          >
            <option value="">请选择目标试验</option>
            {otherTrials.map((trial) => (
              <option value={trial.id} key={trial.id}>
                {trial.code} - {trial.cropFamily}
              </option>
            ))}
          </SelectField>
          <TextField
            label="新材料编号"
            value={accessionNo}
            onChange={(event) => setAccessionNo(event.target.value)}
            error={errorFor("accessionNo")}
            hint={
              duplicateInTarget
                ? "目标试验中已存在相同编号，必须重新编号"
                : "默认建议下一个序号，可修改"
            }
            data-testid="copy-accession-no"
          />
          <TextField
            label="复制数量（从源批次转出）"
            type="number"
            min={1}
            value={quantity}
            onChange={(event) => setQuantity(Number(event.target.value))}
            error={errorFor("quantity")}
            hint={
              errorFor("quantity")
                ? undefined
                : `源批次余量 ${remaining}，复制后剩余 ${Math.max(0, remaining - (Number.isFinite(quantity) ? quantity : 0))}`
            }
            data-testid="copy-quantity-input"
          />
          <TextField
            label="操作人"
            value={recordedBy}
            onChange={(event) => setRecordedBy(event.target.value)}
            error={errorFor("recordedBy")}
            data-testid="copy-recorded-by"
          />
          <TextAreaField
            label="复制说明"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            error={errorFor("note")}
            className="field-span-2"
            rows={3}
            data-testid="copy-note-input"
          />
        </div>
        )}
        <div className="editor-actions">
          <Button tone="secondary" type="button" onClick={onCancel}>
            取消
          </Button>
          <Button
            type="submit"
            disabled={otherTrials.length === 0 || remaining <= 0}
            data-testid="confirm-copy-accession"
          >
            复制到目标试验
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
