import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ArrowRight,
  CalendarClock,
  CircleDot,
  Flag,
  Pencil,
  PlayCircle,
} from "lucide-react";
import { Button } from "../../components/Button";
import { StatusBadge } from "../../components/StatusBadge";
import type {
  ScheduleItem,
  TrialSchedule,
} from "../../domain/schedule";
import { describeTrialStateLabel } from "../../domain/schedule";
import { itemWorkflowPath } from "./workflowLink";

interface TrialScheduleCardProps {
  schedule: TrialSchedule;
  onEdit: (trialId: string) => void;
}

const ITEM_ICON: Record<ScheduleItem["kind"], typeof CircleDot> = {
  "trial-start": PlayCircle,
  "trial-end": CalendarClock,
  observation: CircleDot,
  "observation-due": CalendarClock,
  "observation-overdue": AlertTriangle,
  "observation-gap": AlertTriangle,
  closure: Flag,
};

const ITEM_LABEL: Record<ScheduleItem["kind"], string> = {
  "trial-start": "区间开始",
  "trial-end": "区间结束",
  observation: "观测记录",
  "observation-due": "观测节奏",
  "observation-overdue": "观测逾期",
  "observation-gap": "观测缺失",
  closure: "关闭节点",
};

export function TrialScheduleCard({ schedule, onEdit }: TrialScheduleCardProps) {
  const navigate = useNavigate();
  const { trial } = schedule;
  const dueItem = schedule.items.find((item) =>
    [
      "observation-due",
      "observation-overdue",
      "observation-gap",
    ].includes(item.kind),
  );
  const dueOverdue =
    dueItem?.status === "overdue" || dueItem?.status === "gap";

  return (
    <article
      className={`schedule-card schedule-card-${trial.state}`}
      data-testid={`schedule-card-${trial.id}`}
    >
      <header className="schedule-card-header">
        <div>
          <div className="schedule-card-title-row">
            <h3>{trial.code}</h3>
            <StatusBadge tone={stateTone(trial.state)}>
              {describeTrialStateLabel(trial.state)}
            </StatusBadge>
            {schedule.phase === "finished" ? (
              <StatusBadge tone="neutral">已结束</StatusBadge>
            ) : null}
            {schedule.sameDay ? (
              <StatusBadge tone="info">单日</StatusBadge>
            ) : null}
          </div>
          <p className="schedule-card-meta">
            {trial.cropFamily} · {trial.season} ·{" "}
            {schedule.sameDay ? (
              <>{schedule.startDate}（开始结束同日）</>
            ) : (
              <>
                {schedule.startDate} <ArrowRight size={12} /> {schedule.endDate}
              </>
            )}
          </p>
          <p className="schedule-card-objective">{trial.objective}</p>
          {schedule.expectedNextDue &&
          trial.state !== "cleared" &&
          schedule.phase !== "finished" ? (
            <p
              className={`schedule-card-due ${
                dueOverdue ? "schedule-card-due-overdue" : ""
              }`}
            >
              <CalendarClock size={13} aria-hidden="true" />
              {dueOverdue ? "期望观测日已到：" : "下一个期望观测日："}
              <strong>{schedule.expectedNextDue}</strong>
            </p>
          ) : null}
        </div>
        <Button
          tone="ghost"
          size="sm"
          onClick={() => onEdit(trial.id)}
          data-testid={`edit-trial-${trial.id}`}
        >
          <Pencil size={14} />
          修改日期
        </Button>
      </header>

      {schedule.conflicts.length > 0 ? (
        <ul className="schedule-conflict-list" data-testid={`schedule-conflicts-${trial.id}`}>
          {schedule.conflicts.map((conflict, index) => (
            <li key={`${conflict.code}-${index}`}>
              <AlertTriangle size={14} aria-hidden="true" />
              <span>{conflict.message}</span>
            </li>
          ))}
        </ul>
      ) : null}

      <ul className="schedule-item-list">
        {schedule.items.map((item) => {
          const Icon = ITEM_ICON[item.kind];
          return (
            <li key={`${item.kind}-${item.date}`}>
              <button
                type="button"
                className="schedule-item"
                onClick={() =>
                  navigate(itemWorkflowPath(item.kind, item.trialId))
                }
                title="跳转到对应工作流"
                data-testid={`schedule-item-${trial.id}-${item.kind}-${item.date}`}
              >
                <span
                  className={`schedule-item-icon schedule-item-${item.status}`}
                >
                  <Icon size={14} aria-hidden="true" />
                </span>
                <span className="schedule-item-date">{item.date}</span>
                <span className="schedule-item-kind">
                  {ITEM_LABEL[item.kind]}
                </span>
                <span className="schedule-item-detail">{item.detail}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </article>
  );
}

function stateTone(state: TrialSchedule["trial"]["state"]) {
  switch (state) {
    case "active":
      return "positive";
    case "paused":
      return "info";
    case "cleared":
      return "neutral";
    case "draft":
      return "warning";
  }
}
