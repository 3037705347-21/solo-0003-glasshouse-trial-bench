import { useState } from "react";
import { GitCompare, ShieldQuestion } from "lucide-react";
import { Button } from "../../components/Button";
import { StatusBadge } from "../../components/StatusBadge";
import { TextField, TextAreaField } from "../../components/fields";
import type {
  DuplicateReview,
  ObservationEntry,
  ObservationPass,
} from "../../domain/types";
import {
  RETAKE_TOLERANCE,
  adjudicateDuplicateReview,
} from "../../domain/dedup";
import { withdrawFlagsForConvergedEntries } from "../../domain/observation";
import { useWorkspace } from "../../state/store";

interface DuplicateReviewPanelProps {
  reviews: DuplicateReview[];
}

const SUGGESTION_COPY: Record<DuplicateReview["suggestion"], { label: string; tone: "positive" | "warning" | "neutral" }> = {
  converge: { label: "建议收敛（容差内）", tone: "warning" },
  keep_both: { label: "建议都保留（差异显著）", tone: "positive" },
  review: { label: "需人工判断", tone: "neutral" },
};

function entryOf(pass: ObservationPass, accessionId: string): ObservationEntry | undefined {
  return pass.entries.find((entry) => entry.accessionId === accessionId);
}

function ReviewCard({ review }: { review: DuplicateReview }) {
  const { state, dispatch } = useWorkspace();
  const candidate = state.observationPasses.find(
    (pass) => pass.id === review.candidatePassId,
  );
  const existing = state.observationPasses.find(
    (pass) => pass.id === review.existingPassId,
  );
  const [verdict, setVerdict] = useState<"keep_both" | "converge">("converge");
  const [survivor, setSurvivor] = useState<string>(review.existingPassId);
  const [decidedBy, setDecidedBy] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>();

  if (!candidate || !existing) {
    return null;
  }

  const suggestion = SUGGESTION_COPY[review.suggestion];

  const submit = () => {
    const result = adjudicateDuplicateReview(
      {
        reviewId: review.id,
        verdict,
        decidedBy,
        decisionNote: note,
        survivorPassId: verdict === "converge" ? survivor : undefined,
      },
      state,
    );
    if (!result.ok) {
      setError(result.errors[0]?.message ?? "裁决无效");
      return;
    }
    const allFlags = withdrawFlagsForConvergedEntries(
      state.flags,
      result.value.withdrawnFlagKeys,
      `来源观测已在去重裁决 ${result.value.audit.id} 中收敛`,
    );
    const withdrawnKeySet = new Set(
      result.value.withdrawnFlagKeys.map(
        (key) => `${key.passId} ${key.accessionId}`,
      ),
    );
    dispatch({
      type: "duplicate/resolved",
      review: result.value.review,
      audit: result.value.audit,
      updatedPasses: result.value.updatedPasses,
      withdrawnFlags: allFlags.filter(
        (flag) =>
          flag.state === "withdrawn" &&
          withdrawnKeySet.has(
            `${flag.observationPassId}::${flag.accessionId}`,
          ),
      ),
    });
  };

  return (
    <article className="review-card" data-testid={`review-${review.id}`}>
      <header className="review-card-head">
        <div>
          <strong>疑似重复观测</strong>
          <StatusBadge tone={suggestion.tone}>{suggestion.label}</StatusBadge>
        </div>
        <span className="muted-copy">{candidate.observedOn} · {candidate.observer}</span>
      </header>

      <div className="review-diff" data-testid="review-diff">
        <table>
          <thead>
            <tr>
              <th>材料</th>
              <th>先前记录（株高/叶片/EC）</th>
              <th>新记录（株高/叶片/EC）</th>
              <th>差异</th>
            </tr>
          </thead>
          <tbody>
            {review.differences.map((diff) => {
              const accession = state.accessions.find(
                (item) => item.id === diff.accessionId,
              );
              const oldEntry = entryOf(existing, diff.accessionId);
              const newEntry = entryOf(candidate, diff.accessionId);
              return (
                <tr key={diff.accessionId}>
                  <td>{accession?.accessionNo ?? diff.accessionId}</td>
                  <td>
                    {oldEntry
                      ? `${oldEntry.heightMm} / ${oldEntry.leafCount} / ${oldEntry.ecMs}`
                      : "—"}
                  </td>
                  <td>
                    {newEntry
                      ? `${newEntry.heightMm} / ${newEntry.leafCount} / ${newEntry.ecMs}`
                      : "—"}
                  </td>
                  <td>
                    <StatusBadge tone={diff.withinTolerance ? "warning" : "positive"}>
                      {diff.withinTolerance
                        ? `Δ${diff.heightDeltaMm}mm · ${diff.leafDelta}叶 · ${diff.ecDelta}EC（容差内）`
                        : `Δ${diff.heightDeltaMm}mm · ${diff.leafDelta}叶 · ${diff.ecDelta}EC（超出容差）`}
                    </StatusBadge>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="field-hint">
          自动收敛容差：株高 ±{RETAKE_TOLERANCE.heightMm} mm、叶片 ±
          {RETAKE_TOLERANCE.leafCount}、EC ±{RETAKE_TOLERANCE.ecMs}。
          容差内差异视为同一物理观测的两次读数；超出容差通常意味着植物状态发生真实变化。
        </p>
      </div>

      <div className="review-decision">
        <label className="review-choice">
          <input
            type="radio"
            name={`verdict-${review.id}`}
            checked={verdict === "converge"}
            onChange={() => setVerdict("converge")}
            data-testid="verdict-converge"
          />
          <span>收敛为重复</span>
        </label>
        <label className="review-choice">
          <input
            type="radio"
            name={`verdict-${review.id}`}
            checked={verdict === "keep_both"}
            onChange={() => setVerdict("keep_both")}
            data-testid="verdict-keep-both"
          />
          <span>两条都保留（合理重测）</span>
        </label>
      </div>

      {verdict === "converge" ? (
        <div className="review-survivor">
          <span>保留哪一次的测量作为权威记录：</span>
          <label className="review-choice">
            <input
              type="radio"
              name={`survivor-${review.id}`}
              checked={survivor === existing.id}
              onChange={() => setSurvivor(existing.id)}
              data-testid="survivor-existing"
            />
            <span>先前记录（{existing.id.slice(0, 12)}…）</span>
          </label>
          <label className="review-choice">
            <input
              type="radio"
              name={`survivor-${review.id}`}
              checked={survivor === candidate.id}
              onChange={() => setSurvivor(candidate.id)}
              data-testid="survivor-candidate"
            />
            <span>新记录（{candidate.id.slice(0, 12)}…）</span>
          </label>
        </div>
      ) : null}

      <div className="review-attribution">
        <TextField
          label="裁决人"
          value={decidedBy}
          onChange={(event) => setDecidedBy(event.target.value)}
          data-testid="review-decided-by"
        />
        <TextAreaField
          label="裁决说明（至少 8 个字符，解释为什么收敛或保留）"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          data-testid="review-note"
        />
      </div>
      {error ? <p className="form-level-error">{error}</p> : null}
      <div className="editor-actions">
        <Button onClick={submit} data-testid="submit-review">
          提交裁决
        </Button>
      </div>
    </article>
  );
}

export function DuplicateReviewPanel({ reviews }: DuplicateReviewPanelProps) {
  if (reviews.length === 0) {
    return null;
  }
  return (
    <section className="content-panel review-panel" data-testid="review-queue">
      <div className="panel-heading">
        <div>
          <span className="panel-title">重复观测裁决队列</span>
          <span className="panel-subtitle">
            系统只自动收敛字节级完全一致的录入；读数不同的疑似重复必须由人工裁决，决定会写入审计
          </span>
        </div>
        <ShieldQuestion size={20} className="panel-icon" aria-hidden="true" />
      </div>
      <div className="review-list">
        {reviews.map((review) => (
          <ReviewCard key={review.id} review={review} />
        ))}
      </div>
      <p className="field-hint">
        <GitCompare size={13} aria-hidden="true" /> 不同观测人在同一天对同一材料的各自测量会直接保留，不进入此队列。
      </p>
    </section>
  );
}
