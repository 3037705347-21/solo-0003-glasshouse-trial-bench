import type {
  ClearanceBlocker,
  ClearanceMetric,
  ClearanceSnapshot,
  Trial,
  WorkspaceState,
} from "./types";
import { createId } from "./id";
import { isBenchCompatible, lightProfileLabel } from "./rules";

export function buildClearanceSnapshot(
  state: WorkspaceState,
  trialId: string,
): ClearanceSnapshot {
  const trial = state.trials.find((item) => item.id === trialId);
  const accessions = state.accessions.filter(
    (accession) => accession.trialId === trialId,
  );
  const assignedIds = new Set(
    state.benches.flatMap((bench) => bench.assignedIds),
  );
  const openFlags = state.flags.filter(
    (flag) => flag.trialId === trialId && flag.state === "open",
  );
  const blockers: ClearanceBlocker[] = [];
  const lightConflicts: Array<{ accessionId: string; benchCode: string }> = [];
  accessions.forEach((accession) => {
    if (!assignedIds.has(accession.id)) {
      blockers.push({
        code: "UNASSIGNED",
        message: `${accession.accessionNo} has no bench assignment`,
        accessionId: accession.id,
      });
      return;
    }
    const bench = state.benches.find((item) =>
      item.assignedIds.includes(accession.id),
    );
    if (bench && !isBenchCompatible(accession, bench)) {
      lightConflicts.push({ accessionId: accession.id, benchCode: bench.code });
      blockers.push({
        code: "LIGHT_CONFLICT",
        message: `${accession.accessionNo} 需要${lightProfileLabel(
          accession.preferredLight,
        )}光照，但仍在 ${bench.code}（${lightProfileLabel(
          bench.lightProfile,
        )}）上，请将其移出台架后重新分配`,
        accessionId: accession.id,
        benchId: bench.id,
      });
    }
  });
  state.benches
    .filter((bench) => bench.status === "blocked" || bench.status === "quarantine")
    .forEach((bench) => {
      blockers.push({
        code: bench.status === "blocked" ? "BENCH_BLOCKED" : "BENCH_QUARANTINE",
        message: `Bench ${bench.code} is not available`,
        benchId: bench.id,
      });
    });
  openFlags.forEach((flag) => {
    blockers.push({
      code: `FLAG_${flag.code}`,
      message: flag.message,
      accessionId: flag.accessionId,
    });
  });
  if (accessions.length === 0) {
    blockers.push({
      code: "NO_ACCESSIONS",
        message: "该试验没有材料",
    });
  }
  if (trial?.state === "draft") {
    blockers.push({
      code: "TRIAL_DRAFT",
      message: "请先将试验转为进行中，再申请放行",
    });
  }
  const metrics: ClearanceMetric[] = [
    {
      label: "材料数",
      value: accessions.length,
      detail: "该试验中的材料总数",
    },
    {
      label: "已分配",
      value: accessions.filter(
        (item) =>
          assignedIds.has(item.id) &&
          !lightConflicts.some((conflict) => conflict.accessionId === item.id),
      ).length,
      detail: "已放置到光照兼容台架的材料数",
    },
    {
      label: "光照冲突",
      value: lightConflicts.length,
      detail: lightConflicts.length
        ? `材料光照与台架不一致：${lightConflicts
            .map((conflict) => conflict.benchCode)
            .join("、")}，需移出后重新分配`
        : "材料光照与所在台架保持一致",
    },
    {
      label: "未处理标记",
      value: openFlags.length,
      detail: "未解决的观测标记",
    },
    {
      label: "在用台架",
      value: state.benches.filter((bench) => bench.status === "assigned").length,
      detail: "至少有一个材料的台架数",
    },
  ];
  return {
    id: createId("clr"),
    trialId,
    generatedOn: new Date().toISOString(),
    status: blockers.length === 0 ? "ready" : "blocked",
    metrics,
    blockers,
  };
}

export function canClearTrial(
  state: WorkspaceState,
  trialId: string,
): { ready: boolean; snapshot: ClearanceSnapshot } {
  const snapshot = buildClearanceSnapshot(state, trialId);
  return { ready: snapshot.status === "ready", snapshot };
}

export function applyClearance(
  state: WorkspaceState,
  snapshot: ClearanceSnapshot,
): Trial[] {
  if (snapshot.status !== "ready") {
    return state.trials;
  }
  return state.trials.map((trial) =>
    trial.id === snapshot.trialId ? { ...trial, state: "cleared" } : trial,
  );
}

export function snapshotForTrial(
  snapshots: ClearanceSnapshot[],
  trialId: string,
): ClearanceSnapshot | undefined {
  return [...snapshots]
    .filter((snapshot) => snapshot.trialId === trialId)
    .sort((left, right) => right.generatedOn.localeCompare(left.generatedOn))[0];
}

export function blockerCount(snapshot: ClearanceSnapshot): number {
  return snapshot.blockers.length;
}
