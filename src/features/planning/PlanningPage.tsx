import { useState } from "react";
import { ListChecks } from "lucide-react";
import { PageHeader } from "../../components/PageHeader";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import { EmptyState } from "../../components/EmptyState";
import { useWorkspace } from "../../state/store";
import { allPlans, defaultPlanningPolicy } from "../../state/selectors";
import type { PlanningPolicy } from "../../domain/types";
import { todayDateOnly } from "../../domain/rules";
import { applyPlan, planAllocations, retargetPlanItem } from "../../domain/planner";
import { PlanningControls } from "./PlanningControls";
import { PlanPanel } from "./PlanPanel";

export function PlanningPage() {
  const { state, dispatch } = useWorkspace();
  const plans = allPlans(state);
  const [policy, setPolicy] = useState<PlanningPolicy>(() =>
    defaultPlanningPolicy(state, todayDateOnly()),
  );
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 5000);
  };

  const handleGenerate = () => {
    const plan = planAllocations(
      state,
      policy,
      new Date().toISOString(),
      state.allocationPlans,
    );
    dispatch({ type: "plan/generated", plan });
    if (plan.unplaced.length > 0) {
      pushToast({
        tone: "warning",
        title: "建议已生成，含未放置材料",
        message: `${plan.unplaced.length} 份材料在硬约束内放不下，请在计划中人工指定。`,
      });
    } else {
      pushToast({
        tone: "success",
        title: "分配建议已生成",
        message: "相同输入下结果可复现；可逐条查看依据并人工调整。",
      });
    }
  };

  const handleRetarget = (planId: string, accessionId: string, targetBenchId: string) => {
    const plan = plans.find((entry) => entry.id === planId);
    if (!plan) {
      return;
    }
    const updated = retargetPlanItem(plan, accessionId, targetBenchId || undefined);
    dispatch({ type: "plan/updated", plan: updated });
  };

  const handleClearEdits = (planId: string) => {
    const plan = plans.find((entry) => entry.id === planId);
    if (!plan) {
      return;
    }
    const policySnapshot: PlanningPolicy = {
      ...plan.policy,
      scopeTrialIds: [...plan.policy.scopeTrialIds],
      priorityOverrides: { ...plan.policy.priorityOverrides },
    };
    const regenerated = planAllocations(
      state,
      policySnapshot,
      new Date().toISOString(),
      state.allocationPlans,
    );
    const restored = {
      ...regenerated,
      id: plan.id,
      code: plan.code,
      createdAt: plan.createdAt,
    };
    dispatch({ type: "plan/updated", plan: restored });
    pushToast({
      tone: "info",
      title: "已恢复规划器建议",
      message: "人工钉选已清除，按当前数据重新核算。",
    });
  };

  const handleApply = (planId: string) => {
    const plan = plans.find((entry) => entry.id === planId);
    if (!plan) {
      return;
    }
    const result = applyPlan(state, plan, new Date().toISOString());
    if (!result.ok) {
      pushToast({
        tone: "error",
        title: "无法应用计划",
        message: result.errors[0]?.message,
      });
      return;
    }
    dispatch({
      type: "plan/applied",
      plan: result.value.plan,
      benches: result.value.benches,
    });
    pushToast({
      tone: "success",
      title: "计划已应用到现场",
      message: `${plan.code} 的迁移与新分配已写入台架占用。`,
    });
  };

  const handleDiscard = (planId: string) => {
    dispatch({ type: "plan/discarded", planId });
    pushToast({
      tone: "info",
      title: "计划已废弃",
      message: "建议记录保留为历史，不再参与应用。",
    });
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="离线分配规划"
        title="多批次台架分配"
        description="在光照、容量、维护窗口与预留缓冲约束下，为多个试验批次生成确定性、可解释的分配建议；人工修改后可即时判断哪些部分仍然有效。"
      />

      <PlanningControls
        trials={state.trials}
        policy={policy}
        onChange={setPolicy}
        onGenerate={handleGenerate}
      />

      <div className="plan-list" data-testid="plan-list">
        {plans.length === 0 ? (
          <EmptyState
            icon={ListChecks}
            title="尚未生成分配建议"
            description="选择参与共享台架的批次与规划期，生成第一版离线分配计划。计划只是建议，应用前不会改动现场。"
          />
        ) : (
          plans.map((plan) => (
            <PlanPanel
              key={plan.id}
              state={state}
              plan={plan}
              onRetarget={(accessionId, targetBenchId) =>
                handleRetarget(plan.id, accessionId, targetBenchId)
              }
              onClearEdits={() => handleClearEdits(plan.id)}
              onApply={() => handleApply(plan.id)}
              onDiscard={() => handleDiscard(plan.id)}
            />
          ))
        )}
      </div>

      <ToastRegion
        messages={toasts}
        onDismiss={(id) =>
          setToasts((current) => current.filter((item) => item.id !== id))
        }
      />
    </div>
  );
}
