import { useMemo, useState } from "react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import {
  SelectField,
  TextAreaField,
  TextField,
} from "../../components/fields";
import {
  replacementCandidatesForAccession,
  restoreAccession,
  retireAccession,
} from "../../domain/accession";
import type { FieldError } from "../../domain/result";
import type { Accession, WorkspaceState } from "../../domain/types";
import { benchForAccession } from "../../state/selectors";
import { useWorkspace } from "../../state/store";

interface LifecycleDialogProps {
  accession: Accession;
  state: WorkspaceState;
  onCancel: () => void;
  onSaved: (accession: Accession) => void;
}

function localDateTimeValue(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

export function RetireAccessionDialog({
  accession,
  state,
  onCancel,
  onSaved,
}: LifecycleDialogProps) {
  const { dispatch } = useWorkspace();
  const candidates = useMemo(
    () => replacementCandidatesForAccession(state, accession),
    [state, accession],
  );
  const [retiredAt, setRetiredAt] = useState(localDateTimeValue);
  const [reason, setReason] = useState("");
  const [replacementId, setReplacementId] = useState(
    candidates[0]?.id ?? "",
  );
  const [errors, setErrors] = useState<FieldError[]>([]);
  const errorFor = (field: string) =>
    errors.find((error) => error.field === field)?.message;
  const bench = benchForAccession(state, accession.id);

  const handleSubmit = () => {
    const result = retireAccession(
      accession,
      { retiredAt, reason, replacementId },
      state,
    );
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    dispatch({ type: "accession/updated", accession: result.value });
    onSaved(result.value);
  };

  return (
    <Dialog open title={`停用 ${accession.accessionNo}`} onClose={onCancel} wide>
      <form
        className="editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
        data-testid="retire-accession-form"
      >
        <div className="lifecycle-callout">
          <strong>{accession.cultivar}</strong>
          <span>
            {bench
              ? `当前仍记录在台架 ${bench.code}，停用不会自动移除这条历史占用。`
              : "当前尚未分配台架，停用后会保留已有历史记录。"}
          </span>
        </div>
        <div className="form-grid">
          <TextField
            label="停用时间"
            type="datetime-local"
            value={retiredAt}
            onChange={(event) => setRetiredAt(event.target.value)}
            error={errorFor("retiredAt")}
            data-testid="retire-accession-date"
          />
          <SelectField
            label="替代材料"
            value={replacementId}
            onChange={(event) => setReplacementId(event.target.value)}
            error={errorFor("replacementId")}
            hint="替代材料必须属于同一试验且仍在用"
            data-testid="retire-replacement-select"
          >
            <option value="">请选择替代材料</option>
            {candidates.map((candidate) => (
              <option value={candidate.id} key={candidate.id}>
                {candidate.accessionNo} - {candidate.cultivar}
              </option>
            ))}
          </SelectField>
          <TextAreaField
            label="停用原因"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            error={errorFor("reason")}
            className="field-span-2"
            rows={4}
            data-testid="retire-accession-reason"
          />
        </div>
        <div className="editor-actions">
          <Button tone="secondary" type="button" onClick={onCancel}>
            取消
          </Button>
          <Button type="submit" tone="danger" data-testid="confirm-retire-accession">
            确认停用
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function RestoreAccessionDialog({
  accession,
  state,
  onCancel,
  onSaved,
}: LifecycleDialogProps) {
  const { dispatch } = useWorkspace();
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const errorFor = (field: string) =>
    errors.find((error) => error.field === field)?.message;
  const bench = benchForAccession(state, accession.id);

  const handleSubmit = () => {
    const result = restoreAccession(accession, state, confirmed);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    dispatch({ type: "accession/updated", accession: result.value });
    onSaved(result.value);
  };

  return (
    <Dialog open title={`恢复 ${accession.accessionNo}`} onClose={onCancel}>
      <form
        className="editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
        data-testid="restore-accession-form"
      >
        <div className="lifecycle-callout">
          <strong>{accession.cultivar}</strong>
          <span>
            {bench
              ? `恢复前将重新检查台架 ${bench.code} 的状态、容量和光照兼容性。`
              : "恢复后材料会重新进入分配和观测的可选范围。"}
          </span>
        </div>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
            data-testid="restore-bench-conditions"
          />
          <span>已重新检查当前台架条件和光照兼容性</span>
        </label>
        {errorFor("benchConditionsConfirmed") ? (
          <p className="form-level-error">
            {errorFor("benchConditionsConfirmed")}
          </p>
        ) : null}
        {errorFor("benchId") ? (
          <p className="form-level-error">{errorFor("benchId")}</p>
        ) : null}
        {errorFor("preferredLight") ? (
          <p className="form-level-error">{errorFor("preferredLight")}</p>
        ) : null}
        <div className="editor-actions">
          <Button tone="secondary" type="button" onClick={onCancel}>
            取消
          </Button>
          <Button type="submit" data-testid="confirm-restore-accession">
            确认恢复
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
