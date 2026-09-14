import { useMemo, useState } from "react";
import { CalendarCheck2, Plus } from "lucide-react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { EmptyState } from "../../components/EmptyState";
import { MetricCard } from "../../components/MetricCard";
import { PageHeader } from "../../components/PageHeader";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { SelectField } from "../../components/fields";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import type { ObservationPlan } from "../../domain/types";
import {
  linkPlanToPass,
  reconfirmObservationPlan,
} from "../../domain/observationPlan";
import { passesForTrial, plansForTrial } from "../../state/selectors";
import { useWorkspace } from "../../state/store";
import { PlanCard } from "./PlanCard";
import { PlanForm } from "./PlanForm";
import { CompletePlanDialog } from "./CompletePlanDialog";

type StatusFilter = "all" | "open" | "due" | "stale" | "completed";

const filterOptions: Array<{ value: StatusFilter; label: string }> = [
  { value: "all", label: "全部" },
  { value: "open", label: "未到期" },
  { value: "due", label: "待跟进" },
  { value: "stale", label: "待确认" },
  { value: "completed", label: "已完成" },
];

export function PlansPage() {
  const { state, dispatch } = useWorkspace();
  const [trialId, setTrialId] = useState(() => state.trials[0]?.id ?? "");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingPlan, setEditingPlan] = useState<ObservationPlan | undefined>();
  const [completingPlan, setCompletingPlan] = useState<
    ObservationPlan | undefined
  >();
  const [linkingPlan, setLinkingPlan] = useState<
    ObservationPlan | undefined
  >();
  const [linkPassId, setLinkPassId] = useState("");
  const [linkError, setLinkError] = useState<string | undefined>();
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  };

  const views = useMemo(
    () => plansForTrial(state, trialId),
    [state, trialId],
  );
  const trialPasses = useMemo(
    () => passesForTrial(state, trialId),
    [state, trialId],
  );

  const counts = useMemo(() => {
    return views.reduce(
      (summary, view) => {
        summary.total += 1;
        if (view.followUpStatus === "completed") {
          summary.completed += 1;
        } else {
          summary.open += 1;
          if (view.followUpStatus === "stale") {
            summary.stale += 1;
          }
          if (
            view.scheduleStatus === "due-soon" ||
            view.scheduleStatus === "due-today" ||
            view.scheduleStatus === "overdue"
          ) {
            summary.due += 1;
          }
        }
        return summary;
      },
      { total: 0, open: 0, due: 0, stale: 0, completed: 0 },
    );
  }, [views]);

  const filteredViews = views.filter((view) => {
    if (filter === "all") {
      return true;
    }
    if (filter === "completed") {
      return view.followUpStatus === "completed";
    }
    if (filter === "stale") {
      return view.followUpStatus === "stale";
    }
    if (filter === "due") {
      return (
        view.followUpStatus !== "completed" &&
        (view.scheduleStatus === "due-soon" ||
          view.scheduleStatus === "due-today" ||
          view.scheduleStatus === "overdue")
      );
    }
    return (
      view.followUpStatus === "pending" && view.scheduleStatus === "upcoming"
    );
  });

  const openCreate = () => {
    setEditingPlan(undefined);
    setEditorOpen(true);
  };

  const handleReconfirm = (plan: ObservationPlan) => {
    const result = reconfirmObservationPlan(plan, state);
    if (!result.ok) {
      pushToast({
        tone: "error",
        title: "重新确认失败",
        message: result.errors[0]?.message,
      });
      return;
    }
    dispatch({ type: "plan/reconfirmed", plan: result.value });
    pushToast({
      tone: "success",
      title: "计划已重新确认",
      message: "已按当前台架、试验和材料编号更新计划基线。",
    });
  };

  const openLinkExisting = (plan: ObservationPlan) => {
    setLinkingPlan(plan);
    setLinkPassId(trialPasses[0]?.id ?? "");
    setLinkError(undefined);
  };

  const handleLinkExisting = () => {
    if (!linkingPlan) {
      return;
    }
    const pass = state.observationPasses.find((item) => item.id === linkPassId);
    if (!pass) {
      setLinkError("请选择一条观测记录");
      return;
    }
    const result = linkPlanToPass(linkingPlan, pass);
    if (!result.ok) {
      setLinkError(result.errors[0]?.message);
      return;
    }
    dispatch({ type: "plan/linked", plan: result.value });
    setLinkingPlan(undefined);
    pushToast({
      tone: "success",
      title: "已关联观测记录",
      message: "计划已标记完成，历史观测没有被改写。",
    });
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="试验执行"
        title="观测计划与跟进"
        description="按日期安排观测任务，指定材料范围、负责人和备注；到期前、当天或逾期都会给出明确状态。"
        actions={
          <Button onClick={openCreate} data-testid="open-create-plan">
            <Plus size={16} />
            新建观测计划
          </Button>
        }
      />

      <section className="control-strip">
        <select
          className="compact-select"
          value={trialId}
          onChange={(event) => setTrialId(event.target.value)}
          aria-label="选择试验"
          data-testid="plan-trial-select"
        >
          {state.trials.map((trial) => (
            <option value={trial.id} key={trial.id}>
              {trial.code} - {trial.cropFamily}
            </option>
          ))}
        </select>
        <SegmentedTabs
          label="按跟进状态筛选"
          value={filter}
          options={filterOptions}
          onChange={setFilter}
        />
      </section>

      <section className="metric-grid">
        <MetricCard label="计划总数" value={counts.total} detail="该试验的观测计划" />
        <MetricCard
          label="待跟进"
          value={counts.due}
          accent={counts.due > 0 ? "critical" : "neutral"}
          detail="临近、今天到期或已逾期"
        />
        <MetricCard
          label="待重新确认"
          value={counts.stale}
          accent={counts.stale > 0 ? "warning" : "neutral"}
          detail="材料台架、试验或编号已变化"
        />
        <MetricCard
          label="已完成"
          value={counts.completed}
          accent="positive"
          detail={`${counts.open} 个仍在跟进中`}
        />
      </section>

      {views.length === 0 ? (
        <section className="content-panel">
          <EmptyState
            icon={CalendarCheck2}
            title="还没有观测计划"
            description="为试验建立按日期安排的观测任务，工作人员就不必只靠日期和记忆决定巡哪一批材料。"
            action={
              <Button onClick={openCreate}>
                <Plus size={16} />
                新建观测计划
              </Button>
            }
          />
        </section>
      ) : (
        <section className="plan-grid" data-testid="plan-grid">
          {filteredViews.length === 0 ? (
            <p className="muted-copy">当前筛选下没有观测计划。</p>
          ) : (
            filteredViews.map((view) => (
              <PlanCard
                key={view.plan.id}
                view={view}
                state={state}
                onComplete={(plan) => setCompletingPlan(plan)}
                onLinkExisting={openLinkExisting}
                onReconfirm={handleReconfirm}
                onEdit={(plan) => {
                  setEditingPlan(plan);
                  setEditorOpen(true);
                }}
              />
            ))
          )}
        </section>
      )}

      <Dialog
        open={editorOpen}
        title={editingPlan ? "编辑观测计划" : "新建观测计划"}
        onClose={() => setEditorOpen(false)}
        wide
      >
        {trialId ? (
          <PlanForm
            trialId={trialId}
            plan={editingPlan}
            onCancel={() => setEditorOpen(false)}
            onSaved={() => {
              setEditorOpen(false);
              pushToast({
                tone: "success",
                title: editingPlan ? "计划已更新" : "计划已建立",
                message: editingPlan
                  ? "计划基线已按当前数据刷新。"
                  : "观测计划已保存，将在到期前后提示跟进。",
              });
            }}
          />
        ) : (
          <p>请先创建试验，再安排观测计划。</p>
        )}
      </Dialog>

      <Dialog
        open={Boolean(completingPlan)}
        title="记录计划观测"
        onClose={() => setCompletingPlan(undefined)}
        wide
      >
        {completingPlan ? (
          <CompletePlanDialog
            plan={completingPlan}
            onCancel={() => setCompletingPlan(undefined)}
            onSaved={(pass) => {
              setCompletingPlan(undefined);
              pushToast({
                tone: "success",
                title: "计划已完成",
                message: `已保存观测 ${pass.observedOn}，并关联到该计划。`,
              });
            }}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={Boolean(linkingPlan)}
        title="关联已有观测"
        onClose={() => setLinkingPlan(undefined)}
      >
        <div className="editor-form">
          <p className="muted-copy">
            把该计划补关联到一条已经保存的观测记录。关联只写在计划上，不会
            修改历史观测。
          </p>
          <SelectField
            label="选择观测记录"
            value={linkPassId}
            onChange={(event) => {
              setLinkPassId(event.target.value);
              setLinkError(undefined);
            }}
            error={linkError}
          >
            {trialPasses.length === 0 ? (
              <option value="">该试验还没有观测记录</option>
            ) : (
              trialPasses.map((pass) => (
                <option value={pass.id} key={pass.id}>
                  {pass.observedOn} · {pass.observer} · {pass.entries.length} 条记录
                </option>
              ))
            )}
          </SelectField>
          <div className="editor-actions">
            <Button tone="secondary" onClick={() => setLinkingPlan(undefined)}>
              取消
            </Button>
            <Button
              onClick={handleLinkExisting}
              disabled={trialPasses.length === 0}
              data-testid="confirm-link-existing"
            >
              关联并完成
            </Button>
          </div>
        </div>
      </Dialog>

      <ToastRegion
        messages={toasts}
        onDismiss={(id) =>
          setToasts((current) => current.filter((item) => item.id !== id))
        }
      />
    </div>
  );
}
