import { useMemo, useState } from "react";
import { Button } from "../../components/Button";
import {
  SelectField,
  TextAreaField,
  TextField,
} from "../../components/fields";
import {
  createIncident,
  INCIDENT_KINDS,
  incidentKindLabel,
  type IncidentDraft,
} from "../../domain/incident";
import type { FieldError } from "../../domain/result";
import { todayDateOnly } from "../../domain/rules";
import type { IncidentKind } from "../../domain/types";
import { useWorkspace } from "../../state/store";

interface IncidentFormProps {
  onSaved: () => void;
  onCancel: () => void;
}

function blankDraft(): IncidentDraft {
  return {
    kind: "contamination",
    accessionIds: [],
    observationPassId: "",
    flagId: "",
    discoveredOn: todayDateOnly(),
    cause: "",
    scope: "",
    initialAction: "",
  };
}

export function IncidentForm({ onSaved, onCancel }: IncidentFormProps) {
  const { state, dispatch } = useWorkspace();
  const [draft, setDraft] = useState<IncidentDraft>(blankDraft);
  const [errors, setErrors] = useState<FieldError[]>([]);

  const errorFor = (field: string): string | undefined => {
    return errors.find((error) => error.field === field)?.message;
  };

  const update = <K extends keyof IncidentDraft>(
    key: K,
    value: IncidentDraft[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const toggleAccession = (accessionId: string) => {
    setDraft((current) => {
      const accessionIds = current.accessionIds.includes(accessionId)
        ? current.accessionIds.filter((id) => id !== accessionId)
        : [...current.accessionIds, accessionId];
      const passStillValid = state.observationPasses
        .filter((pass) => pass.id === current.observationPassId)
        .some((pass) =>
          pass.entries.some((entry) => accessionIds.includes(entry.accessionId)),
        );
      const flagStillValid = state.flags
        .filter((flag) => flag.id === current.flagId)
        .some((flag) => accessionIds.includes(flag.accessionId));
      return {
        ...current,
        accessionIds,
        observationPassId: passStillValid ? current.observationPassId : "",
        flagId: flagStillValid ? current.flagId : "",
      };
    });
  };

  const cluePasses = useMemo(
    () =>
      state.observationPasses.filter((pass) =>
        pass.entries.some((entry) =>
          draft.accessionIds.includes(entry.accessionId),
        ),
      ),
    [state.observationPasses, draft.accessionIds],
  );

  const clueFlags = useMemo(
    () =>
      state.flags.filter((flag) =>
        draft.accessionIds.includes(flag.accessionId),
      ),
    [state.flags, draft.accessionIds],
  );

  const trialCodeFor = (trialId: string): string =>
    state.trials.find((trial) => trial.id === trialId)?.code ?? "未知试验";

  const handleSubmit = () => {
    const result = createIncident(draft, state);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    dispatch({ type: "incident/recorded", incident: result.value });
    onSaved();
  };

  return (
    <form
      className="editor-form"
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
      data-testid="incident-form"
    >
      <div className="form-grid">
        <SelectField
          label="事件类型"
          value={draft.kind}
          onChange={(event) =>
            update("kind", event.target.value as IncidentKind)
          }
          error={errorFor("kind")}
          data-testid="incident-kind-select"
        >
          {INCIDENT_KINDS.map((kind) => (
            <option value={kind} key={kind}>
              {incidentKindLabel(kind)}
            </option>
          ))}
        </SelectField>
        <TextField
          label="发现时间"
          type="date"
          value={draft.discoveredOn}
          onChange={(event) => update("discoveredOn", event.target.value)}
          error={errorFor("discoveredOn")}
          data-testid="incident-discovered-input"
        />
        <div className="field field-span-2">
          <span className="field-label">影响材料</span>
          <div className="checkbox-grid">
            {state.accessions.map((accession) => (
              <label className="checkbox-option" key={accession.id}>
                <input
                  type="checkbox"
                  checked={draft.accessionIds.includes(accession.id)}
                  onChange={() => toggleAccession(accession.id)}
                  data-testid={`incident-accession-${accession.id}`}
                />
                <span>
                  {accession.accessionNo} - {accession.cultivar}（
                  {trialCodeFor(accession.trialId)}）
                </span>
              </label>
            ))}
          </div>
          {errorFor("accessionIds") ? (
            <span className="field-error">{errorFor("accessionIds")}</span>
          ) : null}
        </div>
        <TextAreaField
          label="原因"
          rows={2}
          value={draft.cause}
          onChange={(event) => update("cause", event.target.value)}
          error={errorFor("cause")}
          className="field-span-2"
          data-testid="incident-cause-input"
        />
        <TextAreaField
          label="影响范围"
          rows={2}
          value={draft.scope}
          onChange={(event) => update("scope", event.target.value)}
          error={errorFor("scope")}
          className="field-span-2"
          data-testid="incident-scope-input"
          hint="只记录本次受影响的材料与数量，同批其他对象不受影响"
        />
        <TextAreaField
          label="初始处置动作"
          rows={2}
          value={draft.initialAction}
          onChange={(event) => update("initialAction", event.target.value)}
          error={errorFor("initialAction")}
          className="field-span-2"
          data-testid="incident-action-input"
        />
        <SelectField
          label="关联观测（可选）"
          value={draft.observationPassId}
          onChange={(event) => update("observationPassId", event.target.value)}
          error={errorFor("observationPassId")}
          data-testid="incident-pass-select"
          hint={
            draft.accessionIds.length === 0
              ? "请先选择影响材料"
              : "只列出包含受影响材料的观测"
          }
        >
          <option value="">不关联观测</option>
          {cluePasses.map((pass) => (
            <option value={pass.id} key={pass.id}>
              {pass.observedOn} - {pass.observer}（
              {trialCodeFor(pass.trialId)}）
            </option>
          ))}
        </SelectField>
        <SelectField
          label="关联标记（可选）"
          value={draft.flagId}
          onChange={(event) => update("flagId", event.target.value)}
          error={errorFor("flagId")}
          data-testid="incident-flag-select"
          hint={
            draft.accessionIds.length === 0
              ? "请先选择影响材料"
              : "只列出属于受影响材料的标记"
          }
        >
          <option value="">不关联标记</option>
          {clueFlags.map((flag) => (
            <option value={flag.id} key={flag.id}>
              {flag.code} - {flag.message}
            </option>
          ))}
        </SelectField>
      </div>
      <div className="editor-actions">
        <Button tone="secondary" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" data-testid="save-incident-button">
          记录事件
        </Button>
      </div>
    </form>
  );
}
