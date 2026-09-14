import { useMemo, useState } from "react";
import { CircleAlert, TriangleAlert } from "lucide-react";
import type { Accession, PreferredLight } from "../../domain/types";
import type { AccessionDraft } from "../../domain/accession";
import { Button } from "../../components/Button";
import {
  SelectField,
  TextAreaField,
  TextField,
} from "../../components/fields";
import {
  LIGHT_PROFILES,
  TRAY_CELL_OPTIONS,
  isBenchCompatible,
  lightProfileLabel,
} from "../../domain/rules";
import type { FieldError } from "../../domain/result";
import {
  createAccession,
  updateAccession,
} from "../../domain/accession";
import { benchForAccession } from "../../state/selectors";
import { useWorkspace } from "../../state/store";

export interface AccessionSaveOutcome {
  lightConflict: boolean;
  benchCode?: string;
}

interface RosterFormProps {
  trialId: string;
  nextAccessionNo: string;
  accession?: Accession;
  onSaved: (outcome: AccessionSaveOutcome) => void;
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

  // 编辑模式下材料当前所在的台架（未分配则为 undefined）
  const assignedBench = useMemo(
    () => (accession ? benchForAccession(state, accession.id) : undefined),
    [state, accession],
  );

  // 用“已保存材料 + 草稿光照”构造预览对象，实时判断改完后是否仍与台架兼容
  const draftPreview: Accession | undefined = accession
    ? { ...accession, preferredLight: draft.preferredLight }
    : undefined;
  const draftConflictsWithBench = Boolean(
    assignedBench &&
      draftPreview &&
      !isBenchCompatible(draftPreview, assignedBench),
  );
  const draftStillCompatible = Boolean(
    assignedBench &&
      draftPreview &&
      isBenchCompatible(draftPreview, assignedBench),
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
    onSaved({
      lightConflict: draftConflictsWithBench,
      benchCode: assignedBench?.code,
    });
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
      data-testid="accession-form"
    >
      {assignedBench ? (
        draftConflictsWithBench ? (
          <div
            className="form-notice form-notice-danger"
            role="alert"
            data-testid="light-conflict-notice"
          >
            <TriangleAlert size={18} aria-hidden="true" />
            <div>
              <strong>
                该材料目前在 {assignedBench.code}（
                {lightProfileLabel(assignedBench.lightProfile)}）上
              </strong>
              <p>
                改成「{lightProfileLabel(draft.preferredLight)}
                」后与台架光照不兼容。保存后材料仍会留在原台架并被标记为
                <strong>光照冲突</strong>，布局页和放行检查都会提示；请在保存后前往台架布局将其移出
                {assignedBench.code} 并重新分配到兼容台架。
              </p>
            </div>
          </div>
        ) : draftStillCompatible ? (
          <div className="form-notice form-notice-info" data-testid="light-compatible-notice">
            <CircleAlert size={18} aria-hidden="true" />
            <div>
              <strong>
                该材料已分配到 {assignedBench.code}（
                {lightProfileLabel(assignedBench.lightProfile)}）
              </strong>
              <p>
                「{lightProfileLabel(draft.preferredLight)}
                」光照与该台架兼容，保存后无需移动。
              </p>
            </div>
          </div>
        ) : null
      ) : null}
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
          hint={
            assignedBench
              ? `当前台架 ${assignedBench.code} 为${lightProfileLabel(
                  assignedBench.lightProfile,
                )}光照，修改后必须保持兼容`
            : undefined
          }
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
