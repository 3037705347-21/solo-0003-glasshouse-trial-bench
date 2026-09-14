import { useState } from "react";
import type { Flag, ObservationPass, ObservationPlan } from "../../domain/types";
import { PassForm } from "../observations/PassForm";
import { completePlanWithPass } from "../../domain/observationPlan";
import { useWorkspace } from "../../state/store";

interface CompletePlanDialogProps {
  plan: ObservationPlan;
  onSaved: (pass: ObservationPass) => void;
  onCancel: () => void;
}

/**
 * 计划完成对话框：复用观测录入表单，但把材料范围限定为计划范围。保存时通过
 * 单个 reducer 动作同时落库观测与计划关联，领域层和 reducer 都有去重保护，
 * 重复保存或重复点击完成不会生成多份观测或多份关联。
 */
export function CompletePlanDialog({
  plan,
  onSaved,
  onCancel,
}: CompletePlanDialogProps) {
  const { state, dispatch } = useWorkspace();
  const [submitError, setSubmitError] = useState<string | undefined>();

  const handlePassRecorded = (pass: ObservationPass, flags: Flag[]) => {
    const result = completePlanWithPass(plan, pass, state);
    if (!result.ok) {
      // 领域层拒绝（计划已完成、范围不符、出现漂移等）时不落库观测，
      // 展示错误并保留表单，避免产生孤立观测。
      setSubmitError(result.errors[0]?.message);
      return;
    }
    dispatch({
      type: "plan/observation-recorded",
      pass,
      flags,
      plan: result.value,
    });
    onSaved(pass);
  };

  return (
    <div>
      <p className="muted-copy plan-complete-intro">
        计划日期 {plan.scheduledOn} · 负责人 {plan.assignee}。测量范围已限定为
        该计划的 {plan.accessionIds.length} 种材料。
      </p>
      {submitError ? <p className="form-level-error">{submitError}</p> : null}
      <PassForm
        trialId={plan.trialId}
        scopedAccessionIds={plan.accessionIds}
        initialObserver={plan.assignee}
        onCancel={onCancel}
        onSaved={() => undefined}
        onPassRecorded={handlePassRecorded}
      />
    </div>
  );
}
