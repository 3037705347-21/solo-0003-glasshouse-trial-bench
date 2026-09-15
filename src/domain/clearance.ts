import type {
  ClearanceBlocker,
  ClearanceMetric,
  ClearanceSnapshot,
  Trial,
  WorkspaceState,
} from "./types";
import { createId } from "./id";
import { isAccessionRetired } from "./accession";
import { isBlockingFlag } from "./flag";

export function buildClearanceSnapshot(
  state: WorkspaceState,
  trialId: string,
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
  const blockingFlags = state.flags.filter(
    (flag) =>
      flag.trialId === trialId && isBlockingFlag(flag, activeAccessionIds),
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
      message:
        flag.scope === "trial"
          ? `${flag.message}（升级为全试验范围）`
          : flag.message,
      accessionId: flag.accessionId,
      flagId: flag.id,
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
      value: blockingFlags.length,
      detail: "当前会阻止放行的开放标记（含复发与升级跟进）",
    },
    {
      label: "已处理标记",
      value: state.flags.filter(
        (flag) =>
          flag.trialId === trialId &&
          (flag.state === "resolved" || flag.state === "waived"),
      ).length,
      detail: "保留处理结论、可被重开或升级的标记数",
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

/**
 * 已放行试验的当前状态是否已经偏离放行时的判断。
 * 历史快照保持不变；只说明“当下重新计算会被阻止”，提醒用户重新生成快照。
 */
export function clearanceHasDrifted(
  state: WorkspaceState,
  trialId: string,
): boolean {
  const trial = state.trials.find((item) => item.id === trialId);
  if (!trial || trial.state !== "cleared") {
    return false;
  }
  return buildClearanceSnapshot(state, trialId).status === "blocked";
}
