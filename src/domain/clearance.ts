import type {
  ClearanceBlocker,
  ClearanceMetric,
  ClearanceSnapshot,
  Trial,
  TrialState,
  WorkspaceState,
} from "./types";
import { createId } from "./id";
import { canTransitionTrial, transitionTrial } from "./trial";

function trialClearanceBlockerMessage(state: TrialState): string {
  switch (state) {
    case "draft":
      return "请先将试验转为进行中，再申请放行";
    case "paused":
      return "试验已暂停，请先恢复为进行中再申请放行";
    case "cleared":
      return "试验已放行，无需重复申请";
    default:
      return "当前状态不能申请放行";
  }
}

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
  accessions.forEach((accession) => {
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
  if (trial && !canTransitionTrial(trial.state, "cleared")) {
    blockers.push({
      code: "TRIAL_STATE",
      message: trialClearanceBlockerMessage(trial.state),
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
      value: accessions.filter((item) => assignedIds.has(item.id)).length,
      detail: "已放置到台架的材料数",
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
  return state.trials.map((trial) => {
    if (trial.id !== snapshot.trialId) {
      return trial;
    }
    const result = transitionTrial(trial, "cleared");
    return result.ok ? result.value : trial;
  });
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
