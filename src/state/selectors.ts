import type {
  Accession,
  AllocationPlan,
  Bench,
  ClearanceSnapshot,
  Flag,
  ObservationPass,
  PlanningPolicy,
  Trial,
  WorkspaceState,
} from "../domain/types";
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

export function passesForTrial(
  state: WorkspaceState,
  trialId: string,
): ObservationPass[] {
  return state.observationPasses
    .filter((pass) => pass.trialId === trialId)
    .sort((left, right) => right.observedOn.localeCompare(left.observedOn));
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

export function planById(
  state: WorkspaceState,
  planId: string,
): AllocationPlan | undefined {
  return state.allocationPlans.find((plan) => plan.id === planId);
}

export function plansForTrial(
  state: WorkspaceState,
  trialId: string,
): AllocationPlan[] {
  return [...state.allocationPlans]
    .filter(
      (plan) =>
        plan.lifecycle !== "discarded" &&
        plan.policy.scopeTrialIds.includes(trialId),
    )
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function allPlans(state: WorkspaceState): AllocationPlan[] {
  return [...state.allocationPlans]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function defaultPlanningPolicy(
  state: WorkspaceState,
  today: string,
): PlanningPolicy {
  const horizonFrom = today;
  const futureEnds = state.trials
    .map((trial) => trial.endDate)
    .filter((date) => date >= today)
    .sort();
  const horizonTo = futureEnds[futureEnds.length - 1];
  return {
    scopeTrialIds: state.trials.map((trial) => trial.id),
    horizonFrom,
    horizonTo: horizonTo && horizonTo >= today ? horizonTo : today,
    reservedSlotsEnabled: true,
    relocateFromMaintenance: true,
    priorityOverrides: {},
  };
}
