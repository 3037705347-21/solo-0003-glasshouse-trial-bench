import { useMemo, useRef, useState } from "react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { TextAreaField, TextField } from "../../components/fields";
import type {
  ObservationRevisionDraft,
  ObservationRevisionOutcome,
} from "../../domain/observation";
import { deriveFlags, passSeries } from "../../domain/observation";
import type { FieldError } from "../../domain/result";
import type { Accession, ObservationPass } from "../../domain/types";
import { activeAccessionsForTrial } from "../../state/selectors";
import { useWorkspace } from "../../state/store";
import { EntryRowsEditor } from "./EntryRowsEditor";

interface RevisePassDialogProps {
  pass: ObservationPass;
  onCancel: () => void;
  onSaved: (outcome: ObservationRevisionOutcome) => void;
}

export function RevisePassDialog({
  pass,
  onCancel,
  onSaved,
}: RevisePassDialogProps) {
  const { state, commitObservationRevision } = useWorkspace();
  const [draft, setDraft] = useState<ObservationRevisionDraft>({
    observedOn: pass.observedOn,
    observer: pass.observer,
    entries: pass.entries.map((entry) => ({ ...entry })),
    reason: "",
    revisedBy: "",
  });
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [pending, setPending] = useState(false);
  /** 同步重入防护：双击或快速重试只放行第一个提交 */
  const pendingRef = useRef(false);
  const errorFor = (field: string) =>
    errors.find((error) => error.field === field)?.message;

  const accessions = useMemo(() => {
    const active = activeAccessionsForTrial(state, pass.trialId);
    const known = new Set(active.map((accession) => accession.id));
    const retained = pass.entries
      .map((entry) =>
        state.accessions.find((accession) => accession.id === entry.accessionId),
      )
      .filter(
        (accession): accession is Accession =>
          accession !== undefined && !known.has(accession.id),
      );
    return [...active, ...retained];
  }, [state, pass]);

  const series = passSeries(state.observationPasses, pass.seriesId);
  const nextVersion = series.length + 1;

  const impact = useMemo(() => {
    const retiring = state.flags.filter(
      (flag) => flag.observationPassId === pass.id && flag.state === "open",
    );
    const settled = state.flags.filter(
      (flag) => flag.observationPassId === pass.id && flag.state !== "open",
    );
    const derived = deriveFlags(
      { ...pass, observedOn: draft.observedOn, entries: draft.entries },
      state.accessions,
    );
    return { retiring, settled, derived };
  }, [state, pass, draft.observedOn, draft.entries]);

  const handleSubmit = async () => {
    if (pendingRef.current) {
      return;
    }
    pendingRef.current = true;
    setPending(true);
    try {
      const result = await commitObservationRevision(pass.id, draft);
      if (!result.ok) {
        setErrors(result.errors);
        return;
      }
      onSaved(result.value);
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  };

  return (
    <Dialog open title={`更正观测 · 生成第 ${nextVersion} 版`} onClose={onCancel} wide>
      <form
        className="editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
        data-testid="revise-observation-form"
      >
        <div className="lifecycle-callout">
          <strong>{pass.observedOn} · {pass.observer}</strong>
          <span>
            原版本将保留在修订历史中，其未处理标记会失效；更正后的版本立即生效并重新派生标记。
          </span>
        </div>
        <div className="revision-impact" data-testid="revision-impact">
          <span>
            将使 <strong>{impact.retiring.length}</strong> 个未处理标记失效
          </span>
          <span>
            重新派生 <strong>{impact.derived.length}</strong> 个标记
          </span>
          <span>
            <strong>{impact.settled.length}</strong> 个已处理标记保持不变
          </span>
        </div>
        <div className="form-grid">
          <TextField
            label="观测日期"
            type="date"
            value={draft.observedOn}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                observedOn: event.target.value,
              }))
            }
            error={errorFor("observedOn")}
          />
          <TextField
            label="观测人"
            value={draft.observer}
            onChange={(event) =>
              setDraft((current) => ({ ...current, observer: event.target.value }))
            }
            error={errorFor("observer")}
          />
        </div>
        <EntryRowsEditor
          entries={draft.entries}
          accessions={accessions}
          errors={errors}
          onChange={(entries) =>
            setDraft((current) => ({ ...current, entries }))
          }
        />
        <div className="form-grid">
          <TextField
            label="更正人"
            value={draft.revisedBy}
            onChange={(event) =>
              setDraft((current) => ({ ...current, revisedBy: event.target.value }))
            }
            error={errorFor("revisedBy")}
            data-testid="reviser-input"
          />
          <TextAreaField
            label="更正原因"
            value={draft.reason}
            onChange={(event) =>
              setDraft((current) => ({ ...current, reason: event.target.value }))
            }
            error={errorFor("reason")}
            rows={3}
            hint="说明录错内容与更正依据，至少 8 个字符"
            data-testid="revision-reason-input"
          />
        </div>
        {errorFor("basePassId") ? (
          <p className="form-level-error" data-testid="revision-conflict">
            {errorFor("basePassId")}
          </p>
        ) : null}
        <div className="editor-actions">
          <Button tone="secondary" type="button" onClick={onCancel}>
            取消
          </Button>
          <Button type="submit" disabled={pending} data-testid="save-revision-button">
            {pending ? "提交中…" : "确认更正"}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
