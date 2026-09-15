import type {
  ClearanceBlocker,
  ClearanceMetric,
  ClearanceSnapshot,
  Trial,
  WorkspaceState,
} from "./types";
import { createId } from "./id";
import { isAccessionRetired } from "./accession";

/**
 * 计算放行推导全部输入的确定性指纹。指纹覆盖：试验状态、
 * 试验内材料的编号与生命周期、台架状态与占用、未处理标记。
 * 任何一项变化都会改变指纹，从而可以识别已保存快照是否过期。
 */
export function clearanceInputFingerprint(
  state: WorkspaceState,
  trialId: string,
): string {
  const trial = state.trials.find((item) => item.id === trialId);
  const accessions = state.accessions.filter(
    (accession) => accession.trialId === trialId,
  );
  const activeIds = new Set(
    accessions
      .filter((accession) => !isAccessionRetired(accession))
      .map((accession) => accession.id),
  );
  const accessionPart = accessions
    .map(
      (accession) =>
        `${accession.id}:${accession.accessionNo}:${accession.lifecycleStatus}`,
    )
    .sort();
  const benchPart = state.benches
    .map(
      (bench) =>
        `${bench.id}:${bench.code}:${bench.status}:${[...bench.assignedIds].sort().join("+")}`,
    )
    .sort();
  const flagPart = state.flags
    .filter(
      (flag) =>
        flag.trialId === trialId &&
        flag.state === "open" &&
        activeIds.has(flag.accessionId),
    )
    .map((flag) => `${flag.id}:${flag.code}:${flag.message}`)
    .sort();
  return hashString(
    JSON.stringify({
      trial: trial?.state ?? "missing",
      accessions: accessionPart,
      benches: benchPart,
      flags: flagPart,
    }),
  );
}

function hashString(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

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
  const openFlags = state.flags.filter(
    (flag) =>
      flag.trialId === trialId &&
      flag.state === "open" &&
      activeAccessionIds.has(flag.accessionId),
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
  openFlags.forEach((flag) => {
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
    inputFingerprint: clearanceInputFingerprint(state, trialId),
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

export type SnapshotDriftCode =
  | "STATUS_CHANGED"
  | "BLOCKER_ADDED"
  | "BLOCKER_CLEARED"
  | "METRIC_CHANGED"
  | "INPUTS_CHANGED";

export interface SnapshotDrift {
  code: SnapshotDriftCode;
  message: string;
}

export interface SnapshotFreshness {
  /** true 表示快照生成后相关数据已变化，保存的结论可能不再适用 */
  stale: boolean;
  /** 校验依据：输入指纹（精确）或结论对比（旧快照的退化路径） */
  verifiedBy: "fingerprint" | "diff";
  /** 具体变化清单，用于解释过期原因 */
  drift: SnapshotDrift[];
}

function blockerKey(blocker: ClearanceBlocker): string {
  return `${blocker.code}|${blocker.accessionId ?? ""}|${blocker.benchId ?? ""}`;
}

function statusLabel(status: ClearanceSnapshot["status"]): string {
  return status === "ready" ? "就绪" : "阻止";
}

/**
 * 识别已保存快照是否已经过期，并解释依据。
 * 优先比对输入指纹；指纹缺失（旧数据）时退化为结论对比。
 */
export function evaluateSnapshotFreshness(
  state: WorkspaceState,
  snapshot: ClearanceSnapshot,
): SnapshotFreshness {
  const live = buildClearanceSnapshot(state, snapshot.trialId);
  const drift: SnapshotDrift[] = [];

  if (live.status !== snapshot.status) {
    drift.push({
      code: "STATUS_CHANGED",
      message: `放行结论已从「${statusLabel(snapshot.status)}」变为「${statusLabel(live.status)}」`,
    });
  }

  const savedBlockers = new Map(
    snapshot.blockers.map((blocker) => [blockerKey(blocker), blocker]),
  );
  const liveBlockers = new Map(
    live.blockers.map((blocker) => [blockerKey(blocker), blocker]),
  );
  live.blockers.forEach((blocker) => {
    if (!savedBlockers.has(blockerKey(blocker))) {
      drift.push({
        code: "BLOCKER_ADDED",
        message: `新增阻止项 ${blocker.code}：${blocker.message}`,
      });
    }
  });
  snapshot.blockers.forEach((blocker) => {
    if (!liveBlockers.has(blockerKey(blocker))) {
      drift.push({
        code: "BLOCKER_CLEARED",
        message: `阻止项已消除 ${blocker.code}：${blocker.message}`,
      });
    }
  });

  const liveMetrics = new Map(live.metrics.map((metric) => [metric.label, metric]));
  snapshot.metrics.forEach((metric) => {
    const current = liveMetrics.get(metric.label);
    if (current && current.value !== metric.value) {
      drift.push({
        code: "METRIC_CHANGED",
        message: `指标「${metric.label}」从 ${metric.value} 变为 ${current.value}`,
      });
    }
  });

  if (!snapshot.inputFingerprint) {
    // 旧版本快照没有输入指纹，只能按结论差异判断。
    return { stale: drift.length > 0, verifiedBy: "diff", drift };
  }
  if (snapshot.inputFingerprint === live.inputFingerprint) {
    return { stale: false, verifiedBy: "fingerprint", drift: [] };
  }
  if (drift.length === 0) {
    // 输入变了但结论恰好一致：仍然标记过期，避免把偶然一致当成有效。
    drift.push({
      code: "INPUTS_CHANGED",
      message: "快照生成后的相关数据已变化，结论细节可能与当前不同",
    });
  }
  return { stale: true, verifiedBy: "fingerprint", drift };
}
