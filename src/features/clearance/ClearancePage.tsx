import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Play, ShieldCheck } from "lucide-react";
import { Button } from "../../components/Button";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import {
  applyClearance,
  buildClearanceSnapshot,
} from "../../domain/clearance";
import { describeCloseoutStatus } from "../../domain/closeout";
import { transitionTrial } from "../../domain/trial";
import {
  closeoutReviewsForTrial,
  latestSnapshotForTrial,
} from "../../state/selectors";
import { useWorkspace } from "../../state/store";
import { SnapshotCard } from "./SnapshotCard";

export function ClearancePage() {
  const { state, dispatch } = useWorkspace();
  const [trialId, setTrialId] = useState(() => state.trials[0]?.id ?? "");
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const latest = latestSnapshotForTrial(state, trialId);
  const trial = state.trials.find((item) => item.id === trialId);
  const reviews = closeoutReviewsForTrial(state, trialId);
  const latestReview = reviews[reviews.length - 1];

  const liveSnapshot = useMemo(
    () => buildClearanceSnapshot(state, trialId),
    [state, trialId],
  );

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  };

  const handleGenerate = () => {
    const snapshot = buildClearanceSnapshot(state, trialId);
    const trials = applyClearance(state, snapshot);
    dispatch({ type: "clearance/generated", snapshot, trials });
    pushToast({
      tone: snapshot.status === "ready" ? "success" : "warning",
      title: snapshot.status === "ready" ? "试验已放行" : "放行被阻止",
      message:
        snapshot.status === "ready"
          ? "试验状态已更新为已放行。"
          : `仍有 ${snapshot.blockers.length} 个阻止项。`,
    });
  };

  const handleActivate = () => {
    if (!trial) {
      return;
    }
    const result = transitionTrial(trial, "active");
    if (!result.ok) {
      pushToast({
        tone: "error",
        title: "启动失败",
        message: result.errors[0]?.message,
      });
      return;
    }
    dispatch({
      type: "trial/transitioned",
      trialId: trial.id,
      state: result.value.state,
    });
    pushToast({
      tone: "success",
        title: "试验已启动",
        message: `${trial.code} 已进入进行中状态。`,
    });
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="试验放行"
        title="放行检查"
        description="检查跨模块约束，并生成一次不可变的放行快照。"
        actions={
          trial?.state === "draft" ? (
            <Button onClick={handleActivate}>
              <Play size={16} />
              启动试验
            </Button>
          ) : (
            <Button onClick={handleGenerate} data-testid="generate-clearance">
              <ShieldCheck size={16} />
              生成快照
            </Button>
          )
        }
      />
      <section className="control-strip">
        <select
          className="compact-select"
          value={trialId}
          onChange={(event) => setTrialId(event.target.value)}
          aria-label="选择试验"
          data-testid="clearance-trial-select"
        >
          {state.trials.map((item) => (
            <option value={item.id} key={item.id}>
              {item.code} - {item.cropFamily}（
              {item.state === "draft"
                ? "草稿"
                : item.state === "active"
                  ? "进行中"
                  : item.state === "paused"
                    ? "已暂停"
                    : "已放行"}
              ）
            </option>
          ))}
        </select>
      </section>
      <section className="clearance-preview">
        <div className="panel-heading">
          <div>
            <span className="panel-title">实时约束视图</span>
            <span className="panel-subtitle">
              根据当前材料、台架和标记重新计算
            </span>
          </div>
          <ShieldCheck size={20} className="panel-icon" aria-hidden="true" />
        </div>
        <SnapshotCard snapshot={liveSnapshot} />
      </section>
      {latest ? (
        <section className="clearance-preview">
          <div className="panel-heading">
            <div>
              <span className="panel-title">已保存快照</span>
              <span className="panel-subtitle">最近生成的放行快照</span>
            </div>
          </div>
          <SnapshotCard snapshot={latest} />
        </section>
      ) : null}
      <section className="content-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-title">关闭复盘记录</span>
            <span className="panel-subtitle">
              {latestReview
                ? `共 ${reviews.length} 轮复盘，最近为${describeCloseoutStatus(latestReview.status)}`
                : "该试验还没有复盘记录"}
            </span>
          </div>
          <Link
            to="/closeout"
            className="button button-secondary button-sm"
            data-testid="goto-closeout"
          >
            前往关闭复盘
          </Link>
        </div>
        {reviews.length === 0 ? (
          <p className="muted-copy clearance-review-empty">
            {trial?.state === "cleared"
              ? "试验已放行，可以创建关闭复盘来归档结论。"
              : "试验放行或接近尾声时，可以创建关闭复盘。"}
          </p>
        ) : (
          <ul className="clearance-review-list" data-testid="clearance-review-list">
            {[...reviews].reverse().map((review) => {
              const createdOn = new Date(review.createdOn);
              const dateLabel = Number.isNaN(createdOn.getTime())
                ? review.createdOn
                : createdOn.toLocaleString();
              return (
                <li key={review.id} data-testid={`clearance-review-${review.id}`}>
                  <span className="clearance-review-round">
                    第 {review.round} 轮
                  </span>
                  <StatusBadge
                    tone={
                      review.status === "completed"
                        ? "positive"
                        : review.status === "follow-up"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {describeCloseoutStatus(review.status)}
                  </StatusBadge>
                  <span className="clearance-review-date">{dateLabel}</span>
                  <span className="clearance-review-conclusion">
                    {review.conclusion}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
      <ToastRegion
        messages={toasts}
        onDismiss={(id) =>
          setToasts((current) => current.filter((item) => item.id !== id))
        }
      />
    </div>
  );
}
