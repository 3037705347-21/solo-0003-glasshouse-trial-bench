import type {
  Accession,
  Bench,
  ClearanceSnapshot,
  Flag,
  ObservationPass,
  ObservationPlan,
  PlanScheduleStatus,
  Trial,
  WorkspaceState,
} from "../domain/types";
import {
  detectPlanDrift,
  planFollowUpStatus,
  planScheduleStatus,
} from "../domain/observationPlan";

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
): "assigned" | "unassigned" | "blocked" {
  const bench = benchForAccession(state, accession.id);
  if (!bench) {
    return "unassigned";
  }
  return bench.status === "blocked" || bench.status === "quarantine"
    ? "blocked"
    : "assigned";
}

export interface PlanView {
  plan: ObservationPlan;
  scheduleStatus: PlanScheduleStatus;
  followUpStatus: ReturnType<typeof planFollowUpStatus>;
  drifts: ReturnType<typeof detectPlanDrift>;
  linkedPass?: ObservationPass;
}

export function planView(state: WorkspaceState, plan: ObservationPlan): PlanView {
  return {
    plan,
    scheduleStatus: planScheduleStatus(plan),
    followUpStatus: planFollowUpStatus(plan, state),
    drifts: detectPlanDrift(plan, state),
    linkedPass: state.observationPasses.find(
      (pass) => pass.id === plan.linkedObservationPassId,
    ),
  };
}

export function plansForTrial(
  state: WorkspaceState,
  trialId: string,
): PlanView[] {
  return state.observationPlans
    .filter((plan) => plan.trialId === trialId)
    .map((plan) => planView(state, plan))
    .sort((left, right) =>
      left.plan.scheduledOn.localeCompare(right.plan.scheduledOn),
    );
}

/** 关联到某条观测记录的计划（观测 -> 计划 方向的追溯）。 */
export function planForObservationPass(
  state: WorkspaceState,
  passId: string,
): ObservationPlan | undefined {
  return state.observationPlans.find(
    (plan) => plan.linkedObservationPassId === passId,
  );
}
