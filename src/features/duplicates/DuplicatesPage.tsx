import { useMemo, useState } from "react";
import {
  Check,
  GitMerge,
  History,
  Scale,
  ShieldQuestion,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import { detectDuplicateCandidates } from "../../domain/duplicates";
import { createId } from "../../domain/id";
import type {
  Accession,
  DuplicateCandidatePair,
} from "../../domain/types";
import { useWorkspace } from "../../state/store";
import { MergeAccessionsDialog } from "./MergeAccessionsDialog";

type PairSelection =
  | { kind: "candidate"; pair: DuplicateCandidatePair }
  | { kind: "members"; survivorId: string; memberIds: string[] };

export function DuplicatesPage() {
  const { state, dispatch } = useWorkspace();
  const navigate = useNavigate();
  const [trialFilter, setTrialFilter] = useState(
    () => state.trials[0]?.id ?? "",
  );
  const [selection, setSelection] = useState<PairSelection | undefined>();
  const [mergeOpen, setMergeOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  };

  const accessionById = (id: string): Accession | undefined =>
    state.accessions.find((item) => item.id === id);

  const candidates = useMemo(() => {
    return detectDuplicateCandidates(state).filter((pair) => {
      const left = accessionById(pair.leftId);
      return left?.trialId === trialFilter;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, trialFilter]);

  const dismissed = useMemo(
    () =>
      state.duplicateReviews
        .filter((review) => review.decision === "dismissed")
        .map((review) => ({
          review,
          left: accessionById(review.leftId),
          right: accessionById(review.rightId),
        }))
        .filter(
          (entry) =>
            entry.left?.trialId === trialFilter && entry.right?.trialId === trialFilter,
        ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, trialFilter],
  );

  const recentMerges = useMemo(
    () =>
      [...state.mergeRecords]
        .filter((record) => {
          const survivor = accessionById(record.survivorId);
          return survivor?.trialId === trialFilter;
        })
        .sort((a, b) => b.mergedOn.localeCompare(a.mergedOn)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, trialFilter],
  );

  const dismissPair = (pair: DuplicateCandidatePair) => {
    dispatch({
      type: "duplicate/reviewed",
      review: {
        id: createId("rev"),
        pairKey: pair.key,
        leftId: pair.leftId,
        rightId: pair.rightId,
        decision: "dismissed",
        decidedOn: new Date().toISOString(),
      },
    });
    pushToast({
      tone: "info",
      title: "已标记为不同批次",
      message: "该候选对将不再提示，可在下方恢复。",
    });
  };

  const restoreReview = (pairKey: string) => {
    const review = state.duplicateReviews.find(
      (item) => item.pairKey === pairKey,
    );
    if (review) {
      dispatch({
        type: "duplicate/reviewed",
        review: { ...review, decision: "open", decidedOn: new Date().toISOString() },
      });
    }
  };

  const openMerge = (pair: DuplicateCandidatePair) => {
    setSelection({ kind: "candidate", pair });
    setMergeOpen(true);
  };

  return (
    <div className="page" data-testid="duplicates-page">
      <PageHeader
        eyebrow="重复治理"
        title="重复批次裁决"
        description="系统列出相似依据与区分依据，由人判断是重复录入还是必须分开保留的不同批次。"
      />
      <section className="control-strip">
        <select
          className="compact-select"
          value={trialFilter}
          onChange={(event) => setTrialFilter(event.target.value)}
          aria-label="按试验筛选"
          data-testid="duplicates-trial-filter"
        >
          {state.trials.map((trial) => (
            <option value={trial.id} key={trial.id}>
              {trial.code} - {trial.cropFamily}
            </option>
          ))}
        </select>
      </section>

      <section className="content-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-title">疑似重复候选</span>
            <span className="panel-subtitle">
              {candidates.length} 对候选，按证据强度排序；分数仅供参考，强区分会降级
            </span>
          </div>
          <ShieldQuestion size={20} className="panel-icon" aria-hidden="true" />
        </div>
        {candidates.length === 0 ? (
          <EmptyState
            icon={Check}
            title="没有待裁决的候选对"
            description="同试验内当前没有足够相似的批次，或全部已人工排除。"
          />
        ) : (
          <div className="duplicate-list">
            {candidates.map((pair) => {
              const left = accessionById(pair.leftId);
              const right = accessionById(pair.rightId);
              if (!left || !right) {
                return null;
              }
              return (
                <article
                  className="duplicate-card"
                  key={pair.key}
                  data-testid={`duplicate-pair-${pair.key}`}
                >
                  <header className="duplicate-card-header">
                    <StatusBadge tone={pair.verdict === "likely" ? "critical" : "warning"}>
                      {pair.verdict === "likely" ? "疑似重复" : "可能重复"}
                    </StatusBadge>
                    <span className="duplicate-score">证据分 {pair.score}</span>
                    <div className="duplicate-actions">
                      <Button
                        size="sm"
                        onClick={() => openMerge(pair)}
                        data-testid={`merge-pair-${pair.key}`}
                      >
                        <GitMerge size={15} />
                        发起合并
                      </Button>
                      <Button
                        size="sm"
                        tone="secondary"
                        onClick={() => dismissPair(pair)}
                        data-testid={`dismiss-pair-${pair.key}`}
                      >
                        <X size={15} />
                        是不同批次
                      </Button>
                    </div>
                  </header>
                  <div className="duplicate-members">
                    <DuplicateMemberCard accession={left} state={state} onHistory={(id) => navigate(`/accessions/${id}/history`)} />
                    <Scale size={18} className="duplicate-scale" aria-hidden="true" />
                    <DuplicateMemberCard accession={right} state={state} onHistory={(id) => navigate(`/accessions/${id}/history`)} />
                  </div>
                  <div className="duplicate-signals">
                    <div>
                      <h4>相似依据</h4>
                      <ul>
                        {pair.signals.map((signal) => (
                          <li key={signal.code} className="duplicate-signal-match">
                            <strong>{signal.label}</strong>
                            <span>{signal.detail}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    {pair.strongDistinctions.length > 0 ? (
                      <div>
                        <h4>区分依据（必须保留为不同批次的理由）</h4>
                        <ul>
                          {pair.strongDistinctions.map((signal) => (
                            <li key={signal.code} className="duplicate-signal-distinct">
                              <strong>{signal.label}</strong>
                              <span>{signal.detail}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {dismissed.length > 0 ? (
        <section className="content-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-title">已排除候选</span>
              <span className="panel-subtitle">
                人工确认“看起来相似但属于不同批次”的对
              </span>
            </div>
          </div>
          <div className="duplicate-dismissed-list">
            {dismissed.map(({ review, left, right }) => (
              <div className="duplicate-dismissed-row" key={review.id}>
                <span>
                  {left?.accessionNo} · {left?.cultivar}
                </span>
                <span className="muted-copy">↔</span>
                <span>
                  {right?.accessionNo} · {right?.cultivar}
                </span>
                <Button
                  size="sm"
                  tone="ghost"
                  onClick={() => restoreReview(review.pairKey)}
                  data-testid={`restore-review-${review.pairKey}`}
                >
                  恢复提示
                </Button>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="content-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-title">合并历史</span>
            <span className="panel-subtitle">每次身份合并的审计记录</span>
          </div>
          <History size={20} className="panel-icon" aria-hidden="true" />
        </div>
        {recentMerges.length === 0 ? (
          <p className="history-empty">该试验还没有执行过合并。</p>
        ) : (
          <div className="merge-log-list">
            {recentMerges.map((record) => {
              const survivor = accessionById(record.survivorId);
              const tombstones = record.mergedIds
                .map((id) => accessionById(id))
                .filter((item): item is Accession => Boolean(item));
              return (
                <article className="merge-log-entry" key={record.id}>
                  <header>
                    <StatusBadge tone="positive">
                      {`存活者 ${survivor?.accessionNo ?? record.survivorId}`}
                    </StatusBadge>
                    <span>{new Date(record.mergedOn).toLocaleString()}</span>
                  </header>
                  <p>{record.reason}</p>
                  <div className="merge-log-members">
                    {tombstones.map((tombstone) => (
                      <button
                        type="button"
                        key={tombstone.id}
                        className="merge-log-link"
                        onClick={() =>
                          navigate(`/accessions/${tombstone.id}/history`)
                        }
                        data-testid={`merge-log-${tombstone.id}`}
                      >
                        {tombstone.accessionNo} · {tombstone.cultivar} → {survivor?.accessionNo}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="merge-log-link"
                    onClick={() =>
                      navigate(`/accessions/${record.survivorId}/history`)
                    }
                  >
                    查看存活者完整溯源
                  </button>
                </article>
              );
            })}
          </div>
        )}
      </section>

      {mergeOpen && selection?.kind === "candidate" ? (
        <MergeAccessionsDialog
          pairIds={[selection.pair.leftId, selection.pair.rightId]}
          initialSurvivorId={selection.pair.leftId}
          onClose={() => setMergeOpen(false)}
          onMerged={(survivor) => {
            setMergeOpen(false);
            pushToast({
              tone: "success",
              title: "批次已合并",
              message: `当前操作现在唯一归属于 ${survivor.accessionNo}。`,
            });
          }}
        />
      ) : null}
      <ToastRegion
        messages={toasts}
        onDismiss={(id) =>
          setToasts((current) => current.filter((item) => item.id !== id))
        }
      />
    </div>
  );
}

interface DuplicateMemberCardProps {
  accession: Accession;
  state: ReturnType<typeof useWorkspace>["state"];
  onHistory: (id: string) => void;
}

function DuplicateMemberCard({ accession, state, onHistory }: DuplicateMemberCardProps) {
  const bench = state.benches.find((item) =>
    item.assignedIds.includes(accession.id),
  );
  const observationCount = state.observationPasses.reduce(
    (total, pass) =>
      total +
      pass.entries.filter((entry) => entry.accessionId === accession.id).length,
    0,
  );
  return (
    <div className="duplicate-member-card">
      <strong>
        {accession.accessionNo} · {accession.cultivar}
      </strong>
      <span>{accession.source}</span>
      <span>
        繁殖 {accession.propagatedOn} · 数量 {accession.quantity}
      </span>
      <span>
        {accession.preferredLight === "full-sun"
          ? "全日照"
          : accession.preferredLight === "partial-shade"
            ? "半阴"
            : "遮阴"}{" "}
        · {accession.trayCells} 孔
      </span>
      <span className="muted-copy">
        台架 {bench ? bench.code : "未分配"} · {observationCount} 条观测
      </span>
      <Button tone="ghost" size="sm" onClick={() => onHistory(accession.id)}>
        <History size={14} />
        查看历史
      </Button>
    </div>
  );
}
