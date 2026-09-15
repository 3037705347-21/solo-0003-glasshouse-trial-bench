import type {
  ClearanceSnapshot,
  FlagSeverity,
  ObservationPass,
  Trial,
  WorkspaceState,
} from "./types";
import { parseDateOnly, todayDateOnly } from "./rules";

const DAY_MS = 86400000;

export interface ScheduleSummary {
  startDate: string;
  endDate: string;
  spanDays: number | null;
  daysRemaining: number | null;
  ended: boolean;
}

export interface MaterialSummary {
  total: number;
  assigned: number;
  unassigned: number;
  blockedPlacement: number;
  totalQuantity: number;
}

export interface ObservationSummary {
  passCount: number;
  entryCount: number;
  latestPass: ObservationPass | null;
  daysSinceLatest: number | null;
}

export interface FlagSummary {
  evaluated: boolean;
  open: number;
  openBySeverity: Record<FlagSeverity, number>;
  total: number;
  lastActivityOn: string | null;
}

export interface BenchSummary {
  benchCount: number;
  usedSlots: number;
  capacitySlots: number;
  unavailable: number;
  benchCodes: string[];
}

export interface ClearanceSummary {
  latest: ClearanceSnapshot | null;
  snapshotCount: number;
}

export interface TrialComparison {
  trial: Trial;
  schedule: ScheduleSummary;
  materials: MaterialSummary;
  observations: ObservationSummary;
  flags: FlagSummary;
  benches: BenchSummary;
  clearance: ClearanceSummary;
}

function daysBetween(from: string, to: string): number | null {
  const start = parseDateOnly(from);
  const end = parseDateOnly(to);
  if (!start || !end) {
    return null;
  }
  return Math.round((end.getTime() - start.getTime()) / DAY_MS);
}

/**
 * 按单个试验的引用闭包计算对比摘要：
 * 材料取本试验登记的材料，台架只统计承载这些材料的台架，
 * 观测、标记和放行快照按 trialId 归属本试验的记录。
 * 其他试验的材料或台架不会混入；缺失的数据以空值表达，
 * 由界面呈现为缺口而不是零值。
 */
export function compareTrial(
  state: WorkspaceState,
  trialId: string,
): TrialComparison | null {
  const trial = state.trials.find((item) => item.id === trialId);
  if (!trial) {
    return null;
  }

  const accessions = state.accessions.filter(
    (accession) => accession.trialId === trialId,
  );
  const accessionIds = new Set(accessions.map((accession) => accession.id));

  const assignedIdSet = new Set(
    state.benches.flatMap((bench) => bench.assignedIds),
  );
  const assigned = accessions.filter((accession) =>
    assignedIdSet.has(accession.id),
  );
  const blockedPlacement = assigned.filter((accession) => {
    const bench = state.benches.find((item) =>
      item.assignedIds.includes(accession.id),
    );
    return bench?.status === "blocked" || bench?.status === "quarantine";
  }).length;

  const benches = state.benches.filter((bench) =>
    bench.assignedIds.some((id) => accessionIds.has(id)),
  );
  const usedSlots = benches.reduce(
    (sum, bench) =>
      sum + bench.assignedIds.filter((id) => accessionIds.has(id)).length,
    0,
  );

  const passes = state.observationPasses
    .filter((pass) => pass.trialId === trialId)
    .sort((left, right) => right.observedOn.localeCompare(left.observedOn));
  const latestPass = passes[0] ?? null;
  const today = todayDateOnly();

  const trialFlags = state.flags.filter((flag) => flag.trialId === trialId);
  const openFlags = trialFlags.filter((flag) => flag.state === "open");
  const openBySeverity: Record<FlagSeverity, number> = {
    info: 0,
    warning: 0,
    critical: 0,
  };
  openFlags.forEach((flag) => {
    openBySeverity[flag.severity] += 1;
  });
  const activityDates = trialFlags
    .flatMap((flag) => [flag.createdOn, flag.resolvedOn])
    .filter((value): value is string => Boolean(value))
    .sort();
  const lastActivityOn =
    activityDates.length > 0
      ? activityDates[activityDates.length - 1]
      : null;

  const snapshots = state.clearanceSnapshots
    .filter((snapshot) => snapshot.trialId === trialId)
    .sort((left, right) => right.generatedOn.localeCompare(left.generatedOn));

  const spanDays = daysBetween(trial.startDate, trial.endDate);
  const remaining = daysBetween(today, trial.endDate);

  return {
    trial,
    schedule: {
      startDate: trial.startDate,
      endDate: trial.endDate,
      spanDays,
      daysRemaining: remaining === null ? null : Math.max(0, remaining),
      ended: remaining !== null && remaining < 0,
    },
    materials: {
      total: accessions.length,
      assigned: assigned.length,
      unassigned: accessions.length - assigned.length,
      blockedPlacement,
      totalQuantity: accessions.reduce(
        (sum, accession) => sum + accession.quantity,
        0,
      ),
    },
    observations: {
      passCount: passes.length,
      entryCount: passes.reduce((sum, pass) => sum + pass.entries.length, 0),
      latestPass,
      daysSinceLatest: latestPass
        ? daysBetween(latestPass.observedOn, today)
        : null,
    },
    flags: {
      evaluated: passes.length > 0,
      open: openFlags.length,
      openBySeverity,
      total: trialFlags.length,
      lastActivityOn,
    },
    benches: {
      benchCount: benches.length,
      usedSlots,
      capacitySlots: benches.reduce((sum, bench) => sum + bench.capacity, 0),
      unavailable: benches.filter(
        (bench) => bench.status === "blocked" || bench.status === "quarantine",
      ).length,
      benchCodes: benches.map((bench) => bench.code).sort(),
    },
    clearance: {
      latest: snapshots[0] ?? null,
      snapshotCount: snapshots.length,
    },
  };
}

export function compareTrials(
  state: WorkspaceState,
  trialIds: string[],
): TrialComparison[] {
  return trialIds
    .map((trialId) => compareTrial(state, trialId))
    .filter(
      (comparison): comparison is TrialComparison => comparison !== null,
    );
}
