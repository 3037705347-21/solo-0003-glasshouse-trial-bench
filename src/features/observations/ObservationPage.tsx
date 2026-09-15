import { useState } from "react";
import { NotebookPen, Plus } from "lucide-react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import type { ObservationPass } from "../../domain/types";
import { isAccessionRetired } from "../../domain/accession";
import { isPassLive, liveEntriesOf } from "../../domain/dedup";
import {
  openFlagsForTrial,
  passesForTrial,
  pendingReviewsForTrial,
  auditsForPass,
} from "../../state/selectors";
import { useWorkspace } from "../../state/store";
import { FlagPanel } from "./FlagPanel";
import { PassForm, type ObservationSaveOutcome } from "./PassForm";
import { DuplicateReviewPanel } from "./DuplicateReviewPanel";

const OUTCOME_TOAST: Record<
  ObservationSaveOutcome,
  { tone: ToastMessage["tone"]; title: string; message: string }
> = {
  recorded: {
    tone: "success",
    title: "观测已记录",
    message: "已根据测量数据生成生长标记。",
  },
  duplicate_retry: {
    tone: "info",
    title: "重复提交已忽略",
    message: "检测到同一次提交的重试，沿用先前保存的观测，未重复入库。",
  },
  auto_converged: {
    tone: "warning",
    title: "重复录入已自动收敛",
    message: "测量内容与短时间内的另一次录入完全一致，已收敛到先前记录并写入审计。",
  },
  review_opened: {
    tone: "warning",
    title: "观测已保存，疑似重复待裁决",
    message: "同一天存在接近的观测记录，请在裁决队列中确认是重测还是重复。",
  },
};

function PassDedupBadge({ pass }: { pass: ObservationPass }) {
  if (pass.dedupStatus === "converged") {
    return <StatusBadge tone="neutral">已收敛为重复</StatusBadge>;
  }
  if (pass.dedupStatus === "partially_converged") {
    return <StatusBadge tone="warning">部分条目已收敛</StatusBadge>;
  }
  return null;
}

function PassAuditLine({ pass }: { pass: ObservationPass }) {
  const { state } = useWorkspace();
  const audits = auditsForPass(state, pass.id);
  const autoAudit = audits.find((audit) => audit.kind === "auto_converged");
  if (pass.dedupStatus === "converged" && autoAudit) {
    return (
      <p className="pass-dedup-note" data-testid={`converged-note-${pass.id}`}>
        自动收敛：{autoAudit.reason}，权威记录 {autoAudit.canonicalPassId.slice(4, 12)}…
      </p>
    );
  }
  const manualAudit = audits.find((audit) => audit.kind === "manual");
  if (manualAudit && (pass.dedupStatus === "converged" || pass.dedupStatus === "partially_converged")) {
    return (
      <p className="pass-dedup-note" data-testid={`converged-note-${pass.id}`}>
        人工收敛（{manualAudit.decidedBy}）：{manualAudit.decisionNote}
      </p>
    );
  }
  if (manualAudit && manualAudit.verdict === "keep_both") {
    return (
      <p className="pass-dedup-note" data-testid={`retain-note-${pass.id}`}>
        人工裁决保留（{manualAudit.decidedBy}）：{manualAudit.decisionNote}
      </p>
    );
  }
  return null;
}

export function ObservationPage() {
  const { state } = useWorkspace();
  const [trialId, setTrialId] = useState(() => state.trials[0]?.id ?? "");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const passes = passesForTrial(state, trialId);
  const pendingReviews = pendingReviewsForTrial(state, trialId);
  const flags = openFlagsForTrial(state, trialId);

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 5200);
  };

  const livePassCount = passes.filter(isPassLive).length;

  return (
    <div className="page">
      <PageHeader
        eyebrow="生长观测"
        title="观测记录"
        description="录入测量数据；系统自动识别重试与重复，疑似重复进入人工裁决，所有决定可追溯。"
        actions={
          <Button onClick={() => setDialogOpen(true)} data-testid="open-observation-form">
            <Plus size={16} />
            新建观测
          </Button>
        }
      />
      <section className="control-strip">
        <select
          className="compact-select"
          value={trialId}
          onChange={(event) => setTrialId(event.target.value)}
          aria-label="选择试验"
          data-testid="observation-trial-select"
        >
          {state.trials.map((trial) => (
            <option value={trial.id} key={trial.id}>
              {trial.code} - {trial.cropFamily}
            </option>
          ))}
        </select>
      </section>

      <DuplicateReviewPanel reviews={pendingReviews} />

      <div className="observation-workspace">
        <section className="pass-list">
          <div className="pass-list-heading">
            <NotebookPen size={18} aria-hidden="true" />
            <h2>观测历史</h2>
            <span>
              {livePassCount} 次有效观测
              {passes.length !== livePassCount
                ? ` · ${passes.length - livePassCount} 条已收敛`
                : ""}
            </span>
          </div>
          {passes.length === 0 ? (
            <p className="muted-copy">该试验还没有观测记录。</p>
          ) : (
            <div className="pass-cards">
              {passes.map((pass) => {
                const live = isPassLive(pass);
                const liveEntries = liveEntriesOf(pass);
                return (
                  <article
                    className={`pass-card${live ? "" : " pass-card-converged"}`}
                    key={pass.id}
                    data-testid={`pass-${pass.id}`}
                    data-dedup-status={pass.dedupStatus}
                  >
                    <div className="pass-card-top">
                      <strong>{pass.observedOn}</strong>
                      <span>{pass.observer}</span>
                    </div>
                    <p>
                      {liveEntries.length} 条有效测量记录
                      {pass.entries.length !== liveEntries.length
                        ? `（${pass.entries.length - liveEntries.length} 条已收敛）`
                        : ""}
                    </p>
                    <PassDedupBadge pass={pass} />
                    <div className="pass-card-tags">
                      {liveEntries.map((entry) => {
                        const accession = state.accessions.find(
                          (item) => item.id === entry.accessionId,
                        );
                        return (
                          <StatusBadge
                            tone={
                              accession && isAccessionRetired(accession)
                                ? "warning"
                                : "neutral"
                            }
                            key={entry.accessionId}
                          >
                            {accession
                              ? `${accession.accessionNo}${isAccessionRetired(accession) ? " 已停用" : ""}`
                              : entry.accessionId}
                          </StatusBadge>
                        );
                      })}
                    </div>
                    <PassAuditLine pass={pass} />
                  </article>
                );
              })}
            </div>
          )}
        </section>
        <FlagPanel flags={flags} />
      </div>
      <Dialog
        open={dialogOpen}
        title="记录观测"
        onClose={() => setDialogOpen(false)}
        wide
      >
        {trialId ? (
          <PassForm
            trialId={trialId}
            onCancel={() => setDialogOpen(false)}
            onSaved={(outcome) => {
              setDialogOpen(false);
              pushToast(OUTCOME_TOAST[outcome]);
            }}
          />
        ) : (
          <p>请先创建试验，再录入观测。</p>
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
