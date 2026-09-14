import type {
  Bench,
  ClearanceBlocker,
  ClearanceMetric,
  ClearanceSnapshot,
  Flag,
  SnapshotBenchRef,
  SnapshotCapture,
  SnapshotFlagRef,
  SnapshotPassRef,
  Trial,
  WorkspaceState,
} from "./types";
import { createId } from "./id";

function captureTrialRef(trial: Trial | undefined, trialId: string, stateAfter: Trial["state"]) {
  return {
    id: trialId,
    code: trial?.code ?? trialId,
    cropFamily: trial?.cropFamily ?? "未知科属",
    objective: trial?.objective ?? "",
    season: trial?.season ?? "",
    // ready 快照会在同一事务中把试验推进为已放行，记录应用后的状态。
    state: stateAfter,
  };
}

function captureAccessions(state: WorkspaceState, trialId: string) {
  const benchByAccession = new Map<string, string>();
  state.benches.forEach((bench) => {
    bench.assignedIds.forEach((accessionId) => {
      benchByAccession.set(accessionId, bench.id);
    });
  });
  return state.accessions
    .filter((accession) => accession.trialId === trialId)
    .map((accession) => ({
      id: accession.id,
      accessionNo: accession.accessionNo,
      cultivar: accession.cultivar,
      source: accession.source,
      quantity: accession.quantity,
      preferredLight: accession.preferredLight,
      assignedBenchId: benchByAccession.get(accession.id),
      labels: [...accession.labels],
    }));
}

function captureBenches(state: WorkspaceState, trialId: string): SnapshotBenchRef[] {
  const trialAccessionIds = new Set(
    state.accessions
      .filter((accession) => accession.trialId === trialId)
      .map((accession) => accession.id),
  );
  const relevant = (bench: Bench) =>
    bench.status === "blocked" ||
    bench.status === "quarantine" ||
    bench.assignedIds.some((accessionId) => trialAccessionIds.has(accessionId));
  return state.benches.filter(relevant).map((bench) => ({
    id: bench.id,
    code: bench.code,
    sector: bench.sector,
    capacity: bench.capacity,
    assignedIds: [...bench.assignedIds],
    lightProfile: bench.lightProfile,
    status: bench.status,
    blockedReason: bench.blockedReason,
  }));
}

function captureFlags(state: WorkspaceState, trialId: string): SnapshotFlagRef[] {
  return state.flags
    .filter((flag) => flag.trialId === trialId)
    .map((flag: Flag) => ({
      id: flag.id,
      accessionId: flag.accessionId,
      observationPassId: flag.observationPassId,
      code: flag.code,
      message: flag.message,
      severity: flag.severity,
      state: flag.state,
      resolutionNote: flag.resolutionNote,
    }));
}

function capturePasses(state: WorkspaceState, trialId: string): SnapshotPassRef[] {
  return state.observationPasses
    .filter((pass) => pass.trialId === trialId)
    .map((pass) => ({
      id: pass.id,
      observedOn: pass.observedOn,
      observer: pass.observer,
      entryCount: pass.entries.length,
    }));
}

/**
 * 生成快照的不可变引用台账。基于应用放行后的工作区计算，
 * 这样就绪快照冻结的就是“放行后”的试验状态。
 */
export function buildSnapshotCapture(
  state: WorkspaceState,
  trialId: string,
): SnapshotCapture {
  const trial = state.trials.find((item) => item.id === trialId);
  return {
    schema: 1,
    capturedOn: new Date().toISOString(),
    trial: captureTrialRef(trial, trialId, trial?.state ?? "draft"),
    accessions: captureAccessions(state, trialId),
    benches: captureBenches(state, trialId),
    flags: captureFlags(state, trialId),
    observationPasses: capturePasses(state, trialId),
  };
}

export function buildClearanceSnapshot(
  state: WorkspaceState,
  trialId: string,
  capture?: SnapshotCapture,
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
    capture,
  };
}

export function canClearTrial(
  state: WorkspaceState,
  trialId: string,
): { ready: boolean; snapshot: ClearanceSnapshot } {
  const snapshot = buildClearanceSnapshot(state, trialId);
  return { ready: snapshot.status === "ready", snapshot };
}

/**
 * 快照创建事务：先按当前状态计算指标与阻止项；就绪时放行试验，
 * 再基于放行后的工作区冻结引用，保证台账里记录的是“当时”的真实状态。
 */
export function createClearanceSnapshot(
  state: WorkspaceState,
  trialId: string,
): { snapshot: ClearanceSnapshot; trials: Trial[] } {
  const preview = buildClearanceSnapshot(state, trialId);
  const trials = applyClearance(state, preview);
  const postState: WorkspaceState = { ...state, trials };
  const capture = buildSnapshotCapture(postState, trialId);
  return {
    snapshot: { ...preview, capture },
    trials,
  };
}

/**
 * 从当前工作区重建一份等价捕获，台账用它和冻结捕获逐字段比对，
 * 判断历史快照是否已随材料/台架/标记变化而过期。
 */
export function buildLiveCapture(
  state: WorkspaceState,
  trialId: string,
): SnapshotCapture {
  const trial = state.trials.find((item) => item.id === trialId);
  return {
    schema: 1,
    capturedOn: "",
    trial: captureTrialRef(trial, trialId, trial?.state ?? "draft"),
    accessions: captureAccessions(state, trialId),
    benches: captureBenches(state, trialId),
    flags: captureFlags(state, trialId),
    observationPasses: capturePasses(state, trialId),
  };
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
