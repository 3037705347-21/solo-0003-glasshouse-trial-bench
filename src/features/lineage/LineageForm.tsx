import { useState } from "react";
import { Button } from "../../components/Button";
import { SelectField, TextAreaField } from "../../components/fields";
import {
  createLineageRelation,
  type LineageDraft,
} from "../../domain/lineage";
import type { LineageRelationType } from "../../domain/types";
import type { FieldError } from "../../domain/result";
import { activeAccessionsForTrial } from "../../state/selectors";
import { useWorkspace } from "../../state/store";

interface LineageFormProps {
  trialId: string;
  initialEndpointId?: string;
  onSaved: () => void;
  onCancel: () => void;
}

export function LineageForm({
  trialId,
  initialEndpointId,
  onSaved,
  onCancel,
}: LineageFormProps) {
  const { state, dispatch } = useWorkspace();
  const accessions = activeAccessionsForTrial(state, trialId);
  const [draft, setDraft] = useState<LineageDraft>({
    trialId,
    type: "parent",
    endpointAId: initialEndpointId ?? "",
    endpointBId: "",
    note: "",
  });
  const [errors, setErrors] = useState<FieldError[]>([]);

  const errorFor = (field: string): string | undefined =>
    errors.find((error) => error.field === field)?.message;

  const update = <K extends keyof LineageDraft>(
    key: K,
    value: LineageDraft[K],
  ) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const label = (id: string): string => {
    const accession = accessions.find((item) => item.id === id);
    return accession
      ? `${accession.accessionNo} - ${accession.cultivar}`
      : "请选择材料";
  };

  const handleSubmit = () => {
    const result = createLineageRelation(draft, state);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    dispatch({ type: "lineage/created", relation: result.value });
    onSaved();
  };

  const relationType = draft.type;

  return (
    <form
      className="editor-form"
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
      data-testid="lineage-form"
    >
      <SelectField
        label="关系类型"
        value={relationType}
        onChange={(event) =>
          update("type", event.target.value as LineageRelationType)
        }
        data-testid="lineage-type-select"
      >
        <option value="parent">父代 / 子代（有方向，由左向右延续）</option>
        <option value="cohort">同批衍生（无方向，两批材料同源）</option>
      </SelectField>

      <div className="lineage-endpoint-grid">
        <SelectField
          label={relationType === "parent" ? "父代材料" : "材料 A"}
          value={draft.endpointAId}
          onChange={(event) => update("endpointAId", event.target.value)}
          error={errorFor("endpointAId")}
          data-testid="lineage-endpoint-a"
        >
          <option value="">请选择材料</option>
          {accessions.map((accession) => (
            <option value={accession.id} key={accession.id}>
              {label(accession.id)}
            </option>
          ))}
        </SelectField>
        <span className="lineage-relation-symbol" aria-hidden="true">
          {relationType === "parent" ? "→" : "⇄"}
        </span>
        <SelectField
          label={relationType === "parent" ? "子代材料" : "材料 B"}
          value={draft.endpointBId}
          onChange={(event) => update("endpointBId", event.target.value)}
          error={errorFor("endpointBId")}
          data-testid="lineage-endpoint-b"
        >
          <option value="">请选择材料</option>
          {accessions.map((accession) => (
            <option value={accession.id} key={accession.id}>
              {label(accession.id)}
            </option>
          ))}
        </SelectField>
      </div>
      <p className="muted-copy lineage-form-hint">
        关系仅能连接当前试验内的材料；系统会拒绝自我引用、重复关系以及会形成谱系环的父代连接。
      </p>
      {errorFor("trialId") ? (
        <p className="form-level-error">{errorFor("trialId")}</p>
      ) : null}
      <TextAreaField
        label="关系说明（可选）"
        rows={2}
        value={draft.note ?? ""}
        onChange={(event) => update("note", event.target.value)}
      />
      <div className="editor-actions">
        <Button tone="secondary" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" data-testid="save-lineage-button">
          添加关系
        </Button>
      </div>
    </form>
  );
}
