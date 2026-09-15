import { useMemo, useState } from "react";
import type { Accession, PreferredLight } from "../../domain/types";
import type { AccessionDraft } from "../../domain/accession";
import { Button } from "../../components/Button";
import {
  SelectField,
  TextAreaField,
  TextField,
} from "../../components/fields";
import { LIGHT_PROFILES, TRAY_CELL_OPTIONS } from "../../domain/rules";
import type { FieldError } from "../../domain/result";
import {
  createAccession,
  updateAccession,
} from "../../domain/accession";
import { findSoftDuplicates } from "../../domain/duplicates";
import { useWorkspace } from "../../state/store";

interface RosterFormProps {
  trialId: string;
  nextAccessionNo: string;
  accession?: Accession;
  onSaved: () => void;
  onCancel: () => void;
}

function blankDraft(trialId: string, nextAccessionNo: string): AccessionDraft {
  return {
    trialId,
    accessionNo: nextAccessionNo,
    cultivar: "",
    source: "",
    propagatedOn: "",
    quantity: 72,
    trayCells: 104,
    preferredLight: "full-sun",
    genotypeNote: "",
    labels: [],
  };
}

function draftFromAccession(accession: Accession): AccessionDraft {
  return {
    trialId: accession.trialId,
    accessionNo: accession.accessionNo,
    cultivar: accession.cultivar,
    source: accession.source,
    propagatedOn: accession.propagatedOn,
    quantity: accession.quantity,
    trayCells: accession.trayCells,
    preferredLight: accession.preferredLight,
    genotypeNote: accession.genotypeNote,
    labels: accession.labels,
  };
}

export function RosterForm({
  trialId,
  nextAccessionNo,
  accession,
  onSaved,
  onCancel,
}: RosterFormProps) {
  const { state, dispatch } = useWorkspace();
  const [draft, setDraft] = useState<AccessionDraft>(() =>
    accession
      ? draftFromAccession(accession)
      : blankDraft(trialId, nextAccessionNo),
  );
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [labelText, setLabelText] = useState(() =>
    accession ? accession.labels.join(", ") : "",
  );

  const errorFor = (field: string): string | undefined => {
    return errors.find((error) => error.field === field)?.message;
  };

  const update = <K extends keyof AccessionDraft>(
    key: K,
    value: AccessionDraft[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = () => {
    const labels = labelText
      .split(",")
      .map((label) => label.trim())
      .filter(Boolean);
    const candidate = { ...draft, labels };
    const result = accession
      ? updateAccession(accession, candidate, state)
      : createAccession(candidate, state);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    dispatch({
      type: accession ? "accession/updated" : "accession/created",
      accession: result.value,
    });
    onSaved();
  };

  const trialLabel = useMemo(
    () =>
      state.trials.find((trial) => trial.id === trialId)?.code ?? "当前试验",
    [state.trials, trialId],
  );

  const softDuplicates = useMemo(() => {
    return findSoftDuplicates(
      state,
      {
        trialId: draft.trialId,
        accessionNo: draft.accessionNo,
        cultivar: draft.cultivar,
        source: draft.source,
        propagatedOn: draft.propagatedOn,
        preferredLight: draft.preferredLight,
      },
      accession?.id,
    );
  }, [state, draft, accession]);

  return (
    <form
      className="editor-form"
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
      data-testid="accession-form"
    >
      <div className="form-grid">
        <TextField
          label="试验"
          value={trialLabel}
          readOnly
          hint="由当前选中的试验确定"
        />
        <TextField
          label="材料编号"
          value={draft.accessionNo}
          onChange={(event) => update("accessionNo", event.target.value)}
          error={errorFor("accessionNo")}
          data-testid="accession-number-input"
        />
        <TextField
          label="品种"
          value={draft.cultivar}
          onChange={(event) => update("cultivar", event.target.value)}
          error={errorFor("cultivar")}
          data-testid="cultivar-input"
        />
        <TextField
          label="来源"
          value={draft.source}
          onChange={(event) => update("source", event.target.value)}
          error={errorFor("source")}
        />
        <TextField
          label="繁殖日期"
          type="date"
          value={draft.propagatedOn}
          onChange={(event) => update("propagatedOn", event.target.value)}
          error={errorFor("propagatedOn")}
        />
        <TextField
          label="数量"
          type="number"
          min={1}
          max={500}
          value={draft.quantity}
          onChange={(event) => update("quantity", Number(event.target.value))}
          error={errorFor("quantity")}
        />
        <SelectField
          label="穴盘规格"
          value={draft.trayCells}
          onChange={(event) => update("trayCells", Number(event.target.value))}
        >
          {TRAY_CELL_OPTIONS.map((option) => (
            <option value={option} key={option}>
              {option} 孔
            </option>
          ))}
        </SelectField>
        <SelectField
          label="适宜光照"
          value={draft.preferredLight}
          onChange={(event) =>
            update("preferredLight", event.target.value as PreferredLight)
          }
          error={errorFor("preferredLight")}
        >
          {LIGHT_PROFILES.map((profile) => (
            <option value={profile} key={profile}>
              {profile === "full-sun"
                ? "全日照"
                : profile === "partial-shade"
                  ? "半阴"
                  : "遮阴"}
            </option>
          ))}
        </SelectField>
        <TextField
          label="标签"
          value={labelText}
          onChange={(event) => setLabelText(event.target.value)}
          hint="多个标签用逗号分隔"
          className="field-span-2"
        />
        <TextAreaField
          label="基因型 / 批次说明"
          value={draft.genotypeNote}
          onChange={(event) => update("genotypeNote", event.target.value)}
          error={errorFor("genotypeNote")}
          className="field-span-2"
          rows={4}
        />
      </div>
      {softDuplicates.length > 0 ? (
        <div className="soft-duplicate-callout" data-testid="soft-duplicate-warning">
          <strong>发现可能重复的已登记批次：</strong>
          <ul>
            {softDuplicates.slice(0, 3).map((pair) => {
              const other = state.accessions.find(
                (item) => item.id === pair.rightId,
              );
              if (!other) {
                return null;
              }
              return (
                <li key={pair.key}>
                  {other.accessionNo} · {other.cultivar}（{other.source}）
                  — {pair.signals.map((signal) => signal.label).join("、")}
                </li>
              );
            })}
          </ul>
          <span>
            如果确认是不同批次可继续保存；如果是重复录入，请到“重复治理”页合并。
          </span>
        </div>
      ) : null}
      <div className="editor-actions">
        <Button tone="secondary" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" data-testid="save-accession-button">
          {accession ? "保存材料" : "创建材料"}
        </Button>
      </div>
    </form>
  );
}
