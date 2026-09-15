import { useState } from "react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { SelectField, TextAreaField } from "../../components/fields";
import { escalateFlag, escalatableSeverities } from "../../domain/flag";
import type { FieldError } from "../../domain/result";
import type { Flag } from "../../domain/types";
import { useWorkspace } from "../../state/store";

interface EscalateFlagDialogProps {
  flag: Flag;
  onCancel: () => void;
  onEscalated: (followUp: Flag) => void;
}

export function EscalateFlagDialog({
  flag,
  onCancel,
  onEscalated,
}: EscalateFlagDialogProps) {
  const { dispatch } = useWorkspace();
  const severities = escalatableSeverities(flag);
  const [severity, setSeverity] = useState<Flag["severity"]>(
    severities.includes(flag.severity) ? flag.severity : severities[0],
  );
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<FieldError[]>([]);
  const errorFor = (field: string) =>
    errors.find((error) => error.field === field)?.message;

  const handleSubmit = () => {
    const result = escalateFlag(flag, { severity, note });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    dispatch({
      type: "flag/escalated",
      superseded: result.value.superseded,
      followUp: result.value.followUp,
    });
    onEscalated(result.value.followUp);
  };

  return (
    <Dialog open title={`扩大处理范围 ${flag.code}`} onClose={onCancel}>
      <form
        className="editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
        data-testid="escalate-flag-form"
      >
        <div className="lifecycle-callout">
          <strong>升级为全试验跟进</strong>
          <span>
            原结论会作为历史定论保留，标记变为“已取代”；新建的跟进标记将按试验范围阻止放行，直到它被解决或豁免。
          </span>
        </div>
        <div className="form-grid">
          <SelectField
            label="跟进严重程度"
            value={severity}
            onChange={(event) =>
              setSeverity(event.target.value as Flag["severity"])
            }
            error={errorFor("severity")}
            hint="不能低于原标记的严重程度"
            data-testid="escalate-severity"
          >
            <option value="info">提示</option>
            <option value="warning">警告</option>
            <option value="critical">严重</option>
          </SelectField>
          <TextAreaField
            label="升级说明"
            rows={4}
            className="field-span-2"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            error={errorFor("escalationNote")}
            data-testid="escalate-note"
          />
        </div>
        <div className="editor-actions">
          <Button tone="secondary" type="button" onClick={onCancel}>
            取消
          </Button>
          <Button type="submit" tone="danger" data-testid="confirm-escalate-flag">
            确认扩大范围
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
