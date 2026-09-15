import type {
  ClearanceBlocker,
  ClearanceMetric,
  ClearanceSnapshot,
  RuleSet,
  Trial,
  WorkspaceState,
} from "./types";
import { createId } from "./id";
import { isAccessionRetired } from "./accession";

export function buildClearanceSnapshot(
  state: WorkspaceState,
  trialId: string,
  ruleSet: RuleSet,
): ClearanceSnapshot {
  const trial = state.trials.find((item) => item.id === trialId);
  const accessions = state.accessions.filter(
    (accession) => accession.trialId === trialId,
  );
  const activeAccessions = accessions.filter(
    (accession) => !isAccessionRetired(accession),
  );
  const activeAccessionIds = new Set(
    activeAccessions.map((accession) => accession.id),
  );
  const assignedIds = new Set(
    state.benches.flatMap((bench) => bench.assignedIds),
  );
  const openFlags = state.flags.filter(
    (flag) =>
      flag.trialId === trialId &&
      flag.state === "open" &&
      activeAccessionIds.has(flag.accessionId),
  );
  const blockingFlags = openFlags.filter((flag) =>
    ruleSet.clearance.blockingSeverities.includes(flag.severity),
  );
  const blockers: ClearanceBlocker[] = [];
  activeAccessions.forEach((accession) => {
    if (!assignedIds.has(accession.id)) {
      blockers.push({
        code: "UNASSIGNED",
        message: `${accession.accessionNo} has no bench assignment`,
        accessionId: accession.id,
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
  blockingFlags.forEach((flag) => {
    blockers.push({
      code: `FLAG_${flag.code}`,
      message: flag.message,
      accessionId: flag.accessionId,
    });
  });
  if (activeAccessions.length === 0) {
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
      label: "在用材料",
      value: activeAccessions.length,
      detail: "仍参与新分配和新观测的材料数",
    },
    {
      label: "已分配",
      value: activeAccessions.filter((item) => assignedIds.has(item.id)).length,
      detail: "已放置到台架的在用材料数",
    },
    {
      label: "未处理标记",
      value: openFlags.length,
      detail: "未解决的观测标记",
    },
    {
      label: "在用台架",
      value: state.benches.filter(
        (bench) =>
          bench.status === "assigned" &&
          bench.assignedIds.some((id) => activeAccessionIds.has(id)),
      ).length,
      detail: "至少有一个在用材料的台架数",
    },
  ];
  return {
    id: createId("clr"),
    trialId,
    generatedOn: new Date().toISOString(),
    status: blockers.length === 0 ? "ready" : "blocked",
    metrics,
    blockers,
    ruleSetId: ruleSet.id,
  };
}

export function canClearTrial(
  state: WorkspaceState,
  trialId: string,
  ruleSet: RuleSet,
): { ready: boolean; snapshot: ClearanceSnapshot } {
  const snapshot = buildClearanceSnapshot(state, trialId, ruleSet);
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
