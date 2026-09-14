import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Link2,
  Pencil,
  Play,
  RefreshCw,
} from "lucide-react";
import { Button } from "../../components/Button";
import { StatusBadge } from "../../components/StatusBadge";
import type {
  ObservationPlan,
  PlanScheduleStatus,
  WorkspaceState,
} from "../../domain/types";
import {
  canCompletePlan,
  PLAN_SCHEDULE_LABELS,
} from "../../domain/observationPlan";
import type { PlanView } from "../../state/selectors";

interface PlanCardProps {
  view: PlanView;
  state: WorkspaceState;
  onComplete: (plan: ObservationPlan) => void;
  onLinkExisting: (plan: ObservationPlan) => void;
  onReconfirm: (plan: ObservationPlan) => void;
  onEdit: (plan: ObservationPlan) => void;
}

type BadgeTone = "neutral" | "positive" | "warning" | "critical" | "info";

const scheduleBadgeTone: Record<PlanScheduleStatus, BadgeTone> = {
  upcoming: "neutral",
  "due-soon": "warning",
  "due-today": "critical",
  overdue: "critical",
  completed: "positive",
};

export function PlanCard({
  view,
  state,
  onComplete,
  onLinkExisting,
  onReconfirm,
  onEdit,
}: PlanCardProps) {
  const { plan, scheduleStatus, followUpStatus, drifts, linkedPass } = view;
  const completed = followUpStatus === "completed";
  const stale = followUpStatus === "stale";
  const completionEnabled = canCompletePlan(plan, state);

  return (
    <article
      className={`plan-card ${stale ? "plan-card-stale" : ""} ${completed ? "plan-card-completed" : ""}`}
      data-testid={`plan-card-${plan.id}`}
    >
      <header className="plan-card-top">
        <div className="plan-card-date">
          <CalendarClock size={16} aria-hidden="true" />
          <strong>{plan.scheduledOn}</strong>
        </div>
        <div className="plan-card-badges">
          {stale ? (
            <StatusBadge tone="critical">待重新确认</StatusBadge>
          ) : null}
          <StatusBadge tone={scheduleBadgeTone[scheduleStatus]}>
            {PLAN_SCHEDULE_LABELS[scheduleStatus]}
          </StatusBadge>
        </div>
      </header>

      <p className="plan-card-note">{plan.note || "（没有计划备注）"}</p>

      <div className="plan-card-meta">
        <span>负责人：{plan.assignee}</span>
        <span>材料：{plan.accessionIds.length} 种</span>
      </div>

      <div className="plan-card-tags">
        {plan.accessionSnapshots.map((snapshot) => {
          const driftForAccession = drifts.find(
            (drift) => drift.accessionId === snapshot.accessionId,
          );
          return (
            <span
              className={`plan-scope-tag ${driftForAccession ? "plan-scope-tag-drift" : ""}`}
              key={snapshot.accessionId}
            >
              {snapshot.accessionNo}
            </span>
          );
        })}
      </div>

      {stale ? (
        <ul className="plan-drift-list" data-testid={`plan-drift-${plan.id}`}>
          {drifts.map((drift) => (
            <li key={`${drift.code}-${drift.accessionId ?? "trial"}`}>
              <AlertTriangle size={14} aria-hidden="true" />
              <span>{drift.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {completed && linkedPass ? (
        <div className="plan-link-box" data-testid={`plan-link-${plan.id}`}>
          <Link2 size={14} aria-hidden="true" />
          <span>
            已关联观测 {linkedPass.observedOn} · {linkedPass.observer} ·{" "}
            {linkedPass.entries.length} 条记录
          </span>
          <CheckCircle2 size={15} className="plan-link-icon" aria-hidden="true" />
        </div>
      ) : null}
      {completed && !linkedPass ? (
        <p className="muted-copy">关联的观测记录已不在工作区中（历史保留）。</p>
      ) : null}

      {!completed ? (
        <div className="plan-card-actions">
          {stale ? (
            <Button
              size="sm"
              onClick={() => onReconfirm(plan)}
              data-testid={`plan-reconfirm-${plan.id}`}
            >
              <RefreshCw size={14} />
              重新确认
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={() => onComplete(plan)}
              disabled={!completionEnabled}
              data-testid={`plan-complete-${plan.id}`}
            >
              <Play size={14} />
              去观测并完成
            </Button>
          )}
          <Button
            tone="secondary"
            size="sm"
            onClick={() => onLinkExisting(plan)}
            disabled={stale}
            data-testid={`plan-link-existing-${plan.id}`}
          >
            <Link2 size={14} />
            关联已有观测
          </Button>
          <Button
            tone="ghost"
            size="sm"
            className="icon-button"
            onClick={() => onEdit(plan)}
            aria-label="编辑计划"
            data-testid={`plan-edit-${plan.id}`}
          >
            <Pencil size={15} />
          </Button>
        </div>
      ) : null}
    </article>
  );
}
