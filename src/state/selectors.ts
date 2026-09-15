import type {
  Accession,
  Bench,
  ClearanceSnapshot,
  DedupAudit,
  DuplicateReview,
  Flag,
  ObservationPass,
  Trial,
  WorkspaceState,
} from "../domain/types";
import {
  isPassLive,
  liveEntriesOf,
} from "../domain/dedup";
import {
  isAccessionRetired,
  latestRetirementRecord,
} from "../domain/accession";

export function trialById(
  state: WorkspaceState,
  trialId: string,
): Trial | undefined {
  return state.trials.find((trial) => trial.id === trialId);
}

export function accessionsForTrial(
  state: WorkspaceState,
  trialId: string,
): Accession[] {
  return state.accessions.filter(
    (accession) => accession.trialId === trialId,
  );
}

export function activeAccessionsForTrial(
  state: WorkspaceState,
  trialId: string,
): Accession[] {
  return accessionsForTrial(state, trialId).filter(
    (accession) => !isAccessionRetired(accession),
  );
}

export function replacementForAccession(
  state: WorkspaceState,
  accession: Accession,
): Accession | undefined {
  const replacementId =
    accession.replacementId ?? latestRetirementRecord(accession)?.replacementId;
  return replacementId
    ? state.accessions.find((item) => item.id === replacementId)
    : undefined;
}

export function replacedByAccessions(
  state: WorkspaceState,
  accessionId: string,
): Accession[] {
  return state.accessions.filter((accession) => {
    const latest = latestRetirementRecord(accession);
    return (
      accession.replacementId === accessionId ||
      latest?.replacementId === accessionId
    );
  });
}

export function accessionById(
  state: WorkspaceState,
  accessionId: string,
): Accession | undefined {
  return state.accessions.find((accession) => accession.id === accessionId);
}

export function benchForAccession(
  state: WorkspaceState,
  accessionId: string,
): Bench | undefined {
  return state.benches.find((bench) =>
    bench.assignedIds.includes(accessionId),
  );
}

export function openFlagsForTrial(
  state: WorkspaceState,
  trialId: string,
): Flag[] {
  return state.flags.filter(
    (flag) => flag.trialId === trialId && flag.state === "open",
  );
}

/** 观测历史按业务日期倒序；整次收敛的记录仍展示（解释性），但排在最后并带标记。 */
export function passesForTrial(
  state: WorkspaceState,
  trialId: string,
): ObservationPass[] {
  return state.observationPasses
    .filter((pass) => pass.trialId === trialId)
    .sort((left, right) => {
      const dateOrder = right.observedOn.localeCompare(left.observedOn);
      if (dateOrder !== 0) {
        return dateOrder;
      }
      // 同一天：有效观测在前，收敛记录在后。
      return Number(isPassLive(left)) - Number(isPassLive(right));
    });
}

/** 参与指标、标记与放行计算的有效观测（排除整次收敛与已收敛条目）。 */
export function livePassesForTrial(
  state: WorkspaceState,
  trialId: string,
): ObservationPass[] {
  return passesForTrial(state, trialId).filter(isPassLive);
}

export function pendingReviewsForTrial(
  state: WorkspaceState,
  trialId: string,
): DuplicateReview[] {
  return state.duplicateReviews
    .filter((review) => review.trialId === trialId && review.status === "pending")
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function resolvedReviewsForPass(
  state: WorkspaceState,
  passId: string,
): DuplicateReview[] {
  return state.duplicateReviews.filter(
    (review) =>
      review.status === "resolved" &&
      (review.candidatePassId === passId || review.existingPassId === passId),
  );
}

export function auditsForPass(
  state: WorkspaceState,
  passId: string,
): DedupAudit[] {
  return state.dedupAudits
    .filter(
      (audit) =>
        audit.candidatePassId === passId || audit.canonicalPassId === passId,
    )
    .sort((left, right) => right.at.localeCompare(left.at));
}

export function liveEntryCount(pass: ObservationPass): number {
  return liveEntriesOf(pass).length;
}

export function latestSnapshotForTrial(
  state: WorkspaceState,
  trialId: string,
): ClearanceSnapshot | undefined {
  return [...state.clearanceSnapshots]
    .filter((snapshot) => snapshot.trialId === trialId)
    .sort((left, right) => right.generatedOn.localeCompare(left.generatedOn))[0];
}

export function benchUtilization(
  bench: Bench,
): { used: number; capacity: number; percent: number } {
  const percent =
    bench.capacity === 0
      ? 0
      : Math.round((bench.assignedIds.length / bench.capacity) * 100);
  return {
    used: bench.assignedIds.length,
    capacity: bench.capacity,
    percent,
  };
}

export function accessionStatus(
  state: WorkspaceState,
  accession: Accession,
): "assigned" | "unassigned" | "blocked" | "retired" {
  if (isAccessionRetired(accession)) {
    return "retired";
  }
  const bench = benchForAccession(state, accession.id);
  if (!bench) {
    return "unassigned";
  }
  return bench.status === "blocked" || bench.status === "quarantine"
    ? "blocked"
    : "assigned";
}
