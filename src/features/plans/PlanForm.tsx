import { useMemo, useState } from "react";
import { Button } from "../../components/Button";
import { TextAreaField, TextField } from "../../components/fields";
import type { ObservationPlan } from "../../domain/types";
import type { ObservationPlanDraft } from "../../domain/observationPlan";
import type { FieldError } from "../../domain/result";
import {
  createObservationPlan,
  refreshPlanBaseline,
} from "../../domain/observationPlan";
import { todayDateOnly } from "../../domain/rules";
import { benchForAccession } from "../../state/selectors";
import { useWorkspace } from "../../state/store";

interface PlanFormProps {
  trialId: string;
  plan?: ObservationPlan;
  onSaved: () => void;
  onCancel: () => void;
}

function blankDraft(trialId: string): ObservationPlanDraft {
  return {
    trialId,
    scheduledOn: todayDateOnly(),
    assignee: "",
    note: "",
    accessionIds: [],
  };
}

function draftFromPlan(plan: ObservationPlan): ObservationPlanDraft {
  return {
    trialId: plan.trialId,
    scheduledOn: plan.scheduledOn,
    assignee: plan.assignee,
    note: plan.note,
    accessionIds: [...plan.accessionIds],
  };
}

export function PlanForm({ trialId, plan, onSaved, onCancel }: PlanFormProps) {
  const { state, dispatch } = useWorkspace();
  const accessions = useMemo(
    () => state.accessions.filter((accession) => accession.trialId === trialId),
    [state.accessions, trialId],
  );
  const [draft, setDraft] = useState<ObservationPlanDraft>(() =>
    plan ? draftFromPlan(plan) : blankDraft(trialId),
  );
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const errorFor = (field: string): string | undefined =>
    errors.find((error) => error.field === field)?.message;

  const toggleAccession = (accessionId: string) => {
    setDraft((current) => {
      const selected = new Set(current.accessionIds);
      if (selected.has(accessionId)) {
        selected.delete(accessionId);
      } else {
        selected.add(accessionId);
      }
      return {
        ...current,
        // 保持材料在登记列表中的顺序。
        accessionIds: accessions
          .map((accession) => accession.id)
          .filter((id) => selected.has(id)),
      };
    });
  };

  const handleSubmit = () => {
    if (submitting) {
      return;
    }
    const candidate: ObservationPlanDraft = { ...draft, trialId };
    const result = createObservationPlan(candidate, state);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setSubmitting(true);
    if (plan) {
      // 编辑已有计划：保留身份、状态和完成信息，用最新快照重建基线，
      // 这样编辑范围后不会错误地标为漂移。
      const refreshed = refreshPlanBaseline(
        {
          ...plan,
          scheduledOn: result.value.scheduledOn,
          assignee: result.value.assignee,
          note: result.value.note,
          accessionIds: result.value.accessionIds,
        },
        state,
      );
      dispatch({ type: "plan/updated", plan: refreshed });
    } else {
      dispatch({ type: "plan/created", plan: result.value });
    }
    onSaved();
  };

  const trialLabel =
    state.trials.find((trial) => trial.id === trialId)?.code ?? "当前试验";

  return (
    <form
      className="editor-form"
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
      data-testid="plan-form"
    >
      <div className="form-grid">
        <TextField label="试验" value={trialLabel} readOnly />
        <TextField
          label="计划观测日期"
          type="date"
          value={draft.scheduledOn}
          onChange={(event) =>
            setDraft((current) => ({
              ...current,
              scheduledOn: event.target.value,
            }))
          }
          error={errorFor("scheduledOn")}
          data-testid="plan-date-input"
        />
        <TextField
          label="负责人"
          value={draft.assignee}
          onChange={(event) =>
            setDraft((current) => ({ ...current, assignee: event.target.value }))
          }
          error={errorFor("assignee")}
          data-testid="plan-assignee-input"
        />
      </div>
      <div className="plan-scope-editor">
        <div className="entry-editor-heading">
          <h3>计划材料范围</h3>
          <span className="muted-copy">
            已选 {draft.accessionIds.length} / {accessions.length}
          </span>
        </div>
        <div className="plan-scope-list">
          {accessions.map((accession) => {
            const checked = draft.accessionIds.includes(accession.id);
            const bench = benchForAccession(state, accession.id);
            return (
              <label
                className={`plan-scope-option ${checked ? "plan-scope-option-checked" : ""}`}
                key={accession.id}
              >
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => toggleAccession(accession.id)}
                  data-testid={`plan-scope-${accession.id}`}
                />
                <span className="plan-scope-no">{accession.accessionNo}</span>
                <span className="plan-scope-cultivar">{accession.cultivar}</span>
                <span className="plan-scope-bench">
                  台架 {bench ? bench.code : "未分配"}
                </span>
              </label>
            );
          })}
        </div>
        {errorFor("accessionIds") ? (
          <p className="form-level-error">{errorFor("accessionIds")}</p>
        ) : null}
      </div>
      <TextAreaField
        label="计划备注"
        rows={3}
        value={draft.note}
        onChange={(event) =>
          setDraft((current) => ({ ...current, note: event.target.value }))
        }
        hint="记录本批次的观测重点、复查项或注意事项（可选）。"
      />
      <div className="editor-actions">
        <Button tone="secondary" onClick={onCancel}>
          取消
        </Button>
        <Button type="submit" disabled={submitting} data-testid="save-plan-button">
          {plan ? "保存计划" : "建立计划"}
        </Button>
      </div>
    </form>
  );
}
