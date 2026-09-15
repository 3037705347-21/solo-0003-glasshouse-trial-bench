import { useMemo, useState } from "react";
import { Archive, Plus } from "lucide-react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import { buildCloseoutFacts } from "../../domain/closeout";
import type { CloseoutReview } from "../../domain/types";
import { closeoutReviewsForTrial, trialById } from "../../state/selectors";
import { useWorkspace } from "../../state/store";
import { CloseoutForm } from "./CloseoutForm";
import { FactsDigest } from "./FactsDigest";
import { ReviewCard } from "./ReviewCard";

interface CloseoutNotice {
  tone: "info" | "warning";
  text: string;
}

export function CloseoutPage() {
  const { state } = useWorkspace();
  const [trialId, setTrialId] = useState(() => state.trials[0]?.id ?? "");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const trial = trialById(state, trialId);
  const reviews = closeoutReviewsForTrial(state, trialId);

  const liveFacts = useMemo(
    () => buildCloseoutFacts(state, trialId),
    [state, trialId],
  );

  const notices = useMemo<CloseoutNotice[]>(() => {
    const list: CloseoutNotice[] = [];
    if (!trial) {
      return list;
    }
    if (trial.state === "draft") {
      list.push({
        tone: "warning",
        text: "草稿试验尚未开始，不能创建关闭复盘。",
      });
      return list;
    }
    if (trial.state !== "cleared") {
      list.push({
        tone: "info",
        text: "该试验尚未放行，复盘将记录当前阶段事实。",
      });
    }
    const openFlags = liveFacts.flags.filter(
      (flag) => flag.state === "open",
    ).length;
    if (openFlags > 0) {
      list.push({
        tone: "warning",
        text: `仍有 ${openFlags} 个未处理标记，将一并写入复盘事实。`,
      });
    }
    if (liveFacts.observationPasses.length === 0) {
      list.push({
        tone: "warning",
        text: "该试验还没有观测记录，复盘将标记为空观测。",
      });
    }
    if (!liveFacts.clearance) {
      list.push({
        tone: "info",
        text: "尚未生成放行快照，放行结论将记录为未生成。",
      });
    }
    return list;
  }, [trial, liveFacts]);

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  };

  const handleSaved = (review: CloseoutReview) => {
    setDialogOpen(false);
    pushToast({
      tone: "success",
      title: "复盘已记录",
      message: `第 ${review.round} 轮复盘已归档，阶段事实已冻结。`,
    });
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="试验关闭"
        title="关闭复盘"
        description="在试验放行或收尾时冻结阶段事实，记录结论、遗留问题、后续行动和下季建议。"
        actions={
          <Button
            onClick={() => setDialogOpen(true)}
            disabled={!trial || trial.state === "draft"}
            data-testid="open-closeout-form"
          >
            <Plus size={16} />
            新建复盘
          </Button>
        }
      />
      <section className="control-strip">
        <select
          className="compact-select"
          value={trialId}
          onChange={(event) => setTrialId(event.target.value)}
          aria-label="选择试验"
          data-testid="closeout-trial-select"
        >
          {state.trials.map((item) => (
            <option value={item.id} key={item.id}>
              {item.code} - {item.cropFamily}
            </option>
          ))}
        </select>
      </section>
      <div className="closeout-workspace">
        <section
          className="review-timeline-panel"
          aria-label="复盘记录"
        >
          <div className="pass-list-heading">
            <Archive size={18} aria-hidden="true" />
            <h2>复盘记录</h2>
            <span>{reviews.length} 轮复盘</span>
          </div>
          {reviews.length === 0 ? (
            <EmptyState
              icon={Archive}
              title="还没有复盘记录"
              description="试验放行或接近尾声时，新建一轮复盘来冻结阶段事实并记录结论。"
            />
          ) : (
            <div className="review-timeline" data-testid="review-timeline">
              {[...reviews].reverse().map((review) => (
                <ReviewCard
                  key={review.id}
                  review={review}
                  onToast={pushToast}
                />
              ))}
            </div>
          )}
        </section>
        <aside className="facts-panel" aria-label="当前阶段事实">
          <div className="flag-panel-heading">
            <Archive size={18} aria-hidden="true" />
            <h3>当前阶段事实</h3>
          </div>
          {notices.length > 0 ? (
            <div className="closeout-notices">
              {notices.map((notice) => (
                <p
                  className={`closeout-notice closeout-notice-${notice.tone}`}
                  key={notice.text}
                >
                  {notice.text}
                </p>
              ))}
            </div>
          ) : null}
          <FactsDigest facts={liveFacts} />
          <p className="muted-copy">新建复盘时将冻结以上事实，后续变更不会改写已归档的复盘。</p>
        </aside>
      </div>
      <Dialog
        open={dialogOpen}
        title="新建关闭复盘"
        onClose={() => setDialogOpen(false)}
        wide
      >
        {trialId ? (
          <CloseoutForm
            trialId={trialId}
            onCancel={() => setDialogOpen(false)}
            onSaved={handleSaved}
          />
        ) : (
          <p>请先创建试验，再记录复盘。</p>
        )}
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
