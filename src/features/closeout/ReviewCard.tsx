import { useState } from "react";
import { Check } from "lucide-react";
import { Button } from "../../components/Button";
import { StatusBadge } from "../../components/StatusBadge";
import type { ToastMessage } from "../../components/Toast";
import {
  completeCloseoutAction,
  describeCloseoutStatus,
  transitionCloseout,
} from "../../domain/closeout";
import type { CloseoutReview, CloseoutStatus } from "../../domain/types";
import { useWorkspace } from "../../state/store";
import { FactsDigest, formatTimestamp } from "./FactsDigest";

interface ReviewCardProps {
  review: CloseoutReview;
  onToast: (toast: Omit<ToastMessage, "id">) => void;
}

function statusBadgeTone(status: CloseoutStatus) {
  if (status === "completed") {
    return "positive" as const;
  }
  if (status === "follow-up") {
    return "warning" as const;
  }
  return "neutral" as const;
}

export function ReviewCard({ review, onToast }: ReviewCardProps) {
  const { dispatch } = useWorkspace();
  const [error, setError] = useState<string | undefined>();

  const applyTransition = (next: CloseoutStatus) => {
    const result = transitionCloseout(review, next);
    if (!result.ok) {
      setError(result.errors[0]?.message);
      return;
    }
    dispatch({ type: "closeout/transitioned", review: result.value });
    setError(undefined);
    onToast({
      tone: "success",
      title: next === "closed" ? "复盘已关闭" : "复盘状态已更新",
      message: `第 ${review.round} 轮复盘现在为${describeCloseoutStatus(next)}。`,
    });
  };

  const completeAction = (actionId: string) => {
    const result = completeCloseoutAction(review, actionId);
    if (!result.ok) {
      setError(result.errors[0]?.message);
      return;
    }
    dispatch({ type: "closeout/action-completed", review: result.value });
    setError(undefined);
    onToast({
      tone: "success",
      title: "后续行动已完成",
      message: "完成时间已保留在复盘时间线中。",
    });
  };

  return (
    <article className="review-card" data-testid={`review-card-${review.id}`}>
      <header className="review-card-header">
        <div>
          <span className="review-round">第 {review.round} 轮复盘</span>
          <span className="review-meta">
            {review.createdBy} · 记录于 {formatTimestamp(review.createdOn)}
          </span>
        </div>
        <StatusBadge tone={statusBadgeTone(review.status)}>
          {describeCloseoutStatus(review.status)}
        </StatusBadge>
      </header>
      <FactsDigest facts={review.facts} />
      <div className="review-body">
        <section>
          <h4>结论</h4>
          <p>{review.conclusion}</p>
        </section>
        {review.outstandingIssues ? (
          <section>
            <h4>遗留问题</h4>
            <p>{review.outstandingIssues}</p>
          </section>
        ) : null}
        <section>
          <h4>下季建议</h4>
          <p>{review.nextSeasonAdvice}</p>
        </section>
      </div>
      {review.actionItems.length > 0 ? (
        <div className="review-actions">
          <h4>后续行动</h4>
          <ul>
            {review.actionItems.map((item) => (
              <li
                className={`action-item ${item.completedOn ? "action-item-done" : ""}`}
                key={item.id}
              >
                <div>
                  <span>{item.text}</span>
                  <span className="action-timeline">
                    记录于 {formatTimestamp(item.createdOn)}
                    {item.completedOn
                      ? ` · 完成于 ${formatTimestamp(item.completedOn)}`
                      : " · 待完成"}
                  </span>
                </div>
                {!item.completedOn && review.status !== "closed" ? (
                  <Button
                    tone="secondary"
                    size="sm"
                    onClick={() => completeAction(item.id)}
                    data-testid="complete-action-item"
                  >
                    <Check size={15} />
                    标记完成
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <footer className="review-card-footer">
        {error ? <p className="form-level-error">{error}</p> : null}
        {review.status === "closed" ? (
          <span className="review-closed-note">
            已于 {formatTimestamp(review.closedOn ?? review.statusChangedOn)}{" "}
            关闭，结论与阶段事实已归档。
          </span>
        ) : (
          <div className="review-transitions">
            {review.status === "completed" ? (
              <Button
                tone="secondary"
                size="sm"
                onClick={() => applyTransition("follow-up")}
              >
                标记待跟进
              </Button>
            ) : null}
            {review.status === "follow-up" ? (
              <Button
                tone="secondary"
                size="sm"
                onClick={() => applyTransition("completed")}
                data-testid="complete-review"
              >
                标记已完成
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={() => applyTransition("closed")}
              data-testid="close-review"
            >
              关闭复盘
            </Button>
          </div>
        )}
      </footer>
    </article>
  );
}
