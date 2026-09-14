import type {
  Accession,
  Bench,
  BenchStatus,
  ClearanceSnapshot,
  Flag,
  PreferredLight,
  SnapshotAccessionRef,
  SnapshotBenchRef,
  SnapshotCapture,
  SnapshotFlagRef,
  SnapshotTrialRef,
  Trial,
  TrialState,
  WorkspaceState,
} from "./types";
import { buildLiveCapture } from "./clearance";

/** 台账新鲜度：台账里展示的是派生标记，从不修改历史快照本身。 */
export type SnapshotFreshness =
  | "current" // 冻结捕获与当前状态一致
  | "stale" // 引用对象已变化或消失
  | "unverifiable"; // 旧版快照，无冻结捕获，无法核对

export type DriftKind =
  | "TRIAL_MISSING"
  | "TRIAL_CHANGED"
  | "ACCESSION_MISSING"
  | "ACCESSION_CHANGED"
  | "ACCESSION_ADDED"
  | "BENCH_MISSING"
  | "BENCH_CHANGED"
  | "BENCH_ADDED"
  | "FLAG_MISSING"
  | "FLAG_CHANGED"
  | "FLAG_ADDED"
  | "PASS_MISSING";

export interface SnapshotDrift {
  kind: DriftKind;
  refId: string;
  label: string;
  detail?: string;
}

export interface SnapshotAnalysis {
  snapshot: ClearanceSnapshot;
  trial: Trial | undefined;
  freshness: SnapshotFreshness;
  drifts: SnapshotDrift[];
}

export function sortSnapshotsNewestFirst(
  snapshots: ClearanceSnapshot[],
): ClearanceSnapshot[] {
  return [...snapshots].sort((left, right) => {
    const byTime = right.generatedOn.localeCompare(left.generatedOn);
    return byTime !== 0 ? byTime : right.id.localeCompare(left.id);
  });
}

function sameSet(captured: string[], live: string[]): boolean {
  return captured.length === live.length
    && captured.every((id) => live.includes(id));
}

function compareTrial(
  frozen: SnapshotTrialRef,
  live: Trial | undefined,
  drifts: SnapshotDrift[],
): void {
  if (!live) {
    drifts.push({
      kind: "TRIAL_MISSING",
      refId: frozen.id,
      label: frozen.code,
      detail: "快照引用的试验已不存在",
    });
    return;
  }
  const changes: string[] = [];
  if (frozen.state !== live.state) {
    changes.push(`状态：${trialStateLabel(frozen.state)} → ${trialStateLabel(live.state)}`);
  }
  if (frozen.code !== live.code) {
    changes.push(`编号：${frozen.code} → ${live.code}`);
  }
  if (frozen.cropFamily !== live.cropFamily) {
    changes.push(`科属：${frozen.cropFamily} → ${live.cropFamily}`);
  }
  if (frozen.objective !== live.objective) {
    changes.push("目标已修改");
  }
  if (changes.length > 0) {
    drifts.push({
      kind: "TRIAL_CHANGED",
      refId: frozen.id,
      label: frozen.code,
      detail: changes.join("；"),
    });
  }
}

function compareAccession(
  frozen: SnapshotAccessionRef,
  live: Accession | undefined,
  drifts: SnapshotDrift[],
): void {
  if (!live) {
    drifts.push({
      kind: "ACCESSION_MISSING",
      refId: frozen.id,
      label: frozen.accessionNo,
      detail: "快照引用的材料已不存在",
    });
    return;
  }
  const changes: string[] = [];
  if (frozen.accessionNo !== live.accessionNo) {
    changes.push(`编号：${frozen.accessionNo} → ${live.accessionNo}`);
  }
  if (frozen.cultivar !== live.cultivar) {
    changes.push(`品种：${frozen.cultivar} → ${live.cultivar}`);
  }
  if (frozen.quantity !== live.quantity) {
    changes.push(`数量：${frozen.quantity} → ${live.quantity}`);
  }
  if (frozen.preferredLight !== live.preferredLight) {
    changes.push("适宜光照已修改");
  }
  if (!sameSet(frozen.labels, live.labels)) {
    changes.push("标签已修改");
  }
  if (changes.length > 0) {
    drifts.push({
      kind: "ACCESSION_CHANGED",
      refId: frozen.id,
      label: frozen.accessionNo,
      detail: changes.join("；"),
    });
  }
}

function compareBench(
  frozen: SnapshotBenchRef,
  live: Bench | undefined,
  drifts: SnapshotDrift[],
): void {
  if (!live) {
    drifts.push({
      kind: "BENCH_MISSING",
      refId: frozen.id,
      label: frozen.code,
      detail: "快照引用的台架已不存在",
    });
    return;
  }
  const changes: string[] = [];
  if (frozen.status !== live.status) {
    changes.push(`状态：${benchStatusLabel(frozen.status)} → ${benchStatusLabel(live.status)}`);
  }
  if (frozen.capacity !== live.capacity) {
    changes.push(`容量：${frozen.capacity} → ${live.capacity}`);
  }
  if (!sameSet(frozen.assignedIds, live.assignedIds)) {
    changes.push("材料分配已变化");
  }
  if (frozen.lightProfile !== live.lightProfile) {
    changes.push("光照类型已修改");
  }
  if (changes.length > 0) {
    drifts.push({
      kind: "BENCH_CHANGED",
      refId: frozen.id,
      label: frozen.code,
      detail: changes.join("；"),
    });
  }
}

function compareFlag(
  frozen: SnapshotFlagRef,
  live: Flag | undefined,
  drifts: SnapshotDrift[],
): void {
  if (!live) {
    drifts.push({
      kind: "FLAG_MISSING",
      refId: frozen.id,
      label: frozen.code,
      detail: "快照引用的标记已不存在",
    });
    return;
  }
  const changes: string[] = [];
  if (frozen.state !== live.state) {
    changes.push(`生命周期：${flagStateLabel(frozen.state)} → ${flagStateLabel(live.state)}`);
  }
  if (frozen.severity !== live.severity) {
    changes.push(`严重程度：${frozen.severity} → ${live.severity}`);
  }
  if (frozen.message !== live.message) {
    changes.push("描述已修改");
  }
  if (changes.length > 0) {
    drifts.push({
      kind: "FLAG_CHANGED",
      refId: frozen.id,
      label: frozen.code,
      detail: changes.join("；"),
    });
  }
}

/**
 * 把快照冻结捕获与当前工作区比对，得出去重排序后的过期原因。
 * 只读：不触碰快照内容。
 */
export function analyzeSnapshot(
  state: WorkspaceState,
  snapshot: ClearanceSnapshot,
): SnapshotAnalysis {
  const trial = state.trials.find((item) => item.id === snapshot.trialId);
  const capture = snapshot.capture;
  if (!capture) {
    return { snapshot, trial, freshness: "unverifiable", drifts: [] };
  }
  const live = buildLiveCapture(state, snapshot.trialId);
  const drifts: SnapshotDrift[] = [];

  compareTrial(capture.trial, trial, drifts);

  capture.accessions.forEach((frozen) => {
    compareAccession(
      frozen,
      state.accessions.find((item) => item.id === frozen.id),
      drifts,
    );
  });
  live.accessions.forEach((current) => {
    if (!capture.accessions.some((frozen) => frozen.id === current.id)) {
      drifts.push({
        kind: "ACCESSION_ADDED",
        refId: current.id,
        label: current.accessionNo,
        detail: "快照生成后新增的材料",
      });
    }
  });

  capture.benches.forEach((frozen) => {
    compareBench(
      frozen,
      state.benches.find((item) => item.id === frozen.id),
      drifts,
    );
  });
  live.benches.forEach((current) => {
    if (!capture.benches.some((frozen) => frozen.id === current.id)) {
      drifts.push({
        kind: "BENCH_ADDED",
        refId: current.id,
        label: current.code,
        detail: "快照生成后新出现的相关台架（如新增的受限台架）",
      });
    }
  });

  capture.flags.forEach((frozen) => {
    compareFlag(
      frozen,
      state.flags.find((item) => item.id === frozen.id),
      drifts,
    );
  });
  live.flags.forEach((current) => {
    if (!capture.flags.some((frozen) => frozen.id === current.id)) {
      drifts.push({
        kind: "FLAG_ADDED",
        refId: current.id,
        label: current.code,
        detail: "快照生成后新派生的标记",
      });
    }
  });

  capture.observationPasses.forEach((frozen) => {
    if (!state.observationPasses.some((pass) => pass.id === frozen.id)) {
      drifts.push({
        kind: "PASS_MISSING",
        refId: frozen.id,
        label: `${frozen.observedOn} · ${frozen.observer}`,
        detail: "快照引用的观测记录已不存在",
      });
    }
  });

  return {
    snapshot,
    trial,
    freshness: drifts.length === 0 ? "current" : "stale",
    drifts,
  };
}

/* ------------------------------------------------------------------ */
/* 引用关系（详情弹窗）                                                  */
/* ------------------------------------------------------------------ */

export type ReferenceStatus =
  | "unchanged" // 当时与当前一致
  | "changed" // 对象仍在，但内容已变
  | "missing" // 引用对象已从工作区删除
  | "new" // 快照生成后才出现
  | "legacy"; // 旧快照没有冻结数据，只能展示当前值

export interface ReferenceRow {
  id: string;
  title: string;
  subtitle?: string;
  status: ReferenceStatus;
  frozenText?: string;
  liveText?: string;
  driftDetail?: string;
}

export interface SnapshotReferences {
  trialRow?: ReferenceRow;
  accessions: ReferenceRow[];
  benches: ReferenceRow[];
  flags: ReferenceRow[];
  passes: ReferenceRow[];
}

function benchAssignmentText(
  bench: SnapshotBenchRef,
  capture: SnapshotCapture,
): string {
  const names = bench.assignedIds.map((id) => {
    const accession = capture.accessions.find((item) => item.id === id);
    return accession ? accession.accessionNo : id;
  });
  return names.length > 0 ? names.join("、") : "空台架";
}

function accessionBenchText(benchId: string | undefined): string {
  return benchId ? `台架 ${benchId}` : "未分配";
}

function frozenBenchCode(
  capture: SnapshotCapture,
  benchId: string | undefined,
): string {
  if (!benchId) {
    return "未分配";
  }
  const bench = capture.benches.find((item) => item.id === benchId);
  return bench ? `台架 ${bench.code}` : `台架 ${benchId}（已不存在）`;
}

/**
 * 解析快照与材料、台架、标记、观测之间的引用关系。
 * 新快照展示冻结值与当前值的并排对比；旧快照（无捕获）退化为
 * 基于当前工作区的引用视图，并逐行标记为 legacy。
 */
export function resolveSnapshotReferences(
  state: WorkspaceState,
  snapshot: ClearanceSnapshot,
  analysis: SnapshotAnalysis,
): SnapshotReferences {
  const capture: SnapshotCapture | undefined = snapshot.capture;
  const driftBy = (kind: DriftKind, id: string) =>
    analysis.drifts.find(
      (drift) => drift.kind === kind && drift.refId === id,
    );

  if (!capture) {
    return resolveLegacyReferences(state, snapshot);
  }

  const trialLive = state.trials.find((item) => item.id === snapshot.trialId);
  const trialRow: ReferenceRow = {
    id: capture.trial.id,
    title: `${capture.trial.code} · ${capture.trial.cropFamily}`,
    subtitle: capture.trial.objective,
    status: trialLive
      ? driftBy("TRIAL_CHANGED", capture.trial.id)
        ? "changed"
        : "unchanged"
      : "missing",
    frozenText: `当时状态：${trialStateLabel(capture.trial.state)}`,
    liveText: trialLive
      ? `当前状态：${trialStateLabel(trialLive.state)}`
      : "当前状态：试验已不存在",
    driftDetail: driftBy("TRIAL_CHANGED", capture.trial.id)?.detail,
  };

  const accessions: ReferenceRow[] = capture.accessions.map((frozen) => {
    const live = state.accessions.find((item) => item.id === frozen.id);
    const drift = driftBy("ACCESSION_CHANGED", frozen.id);
    return {
      id: frozen.id,
      title: `${frozen.accessionNo} · ${frozen.cultivar}`,
      subtitle: `${frozen.source} · ${frozen.quantity} 株`,
      status: !live ? "missing" : drift ? "changed" : "unchanged",
      frozenText: `当时：${frozenBenchCode(capture, frozen.assignedBenchId)}`,
      liveText: live
        ? `当前：${live.quantity} 株；${accessionBenchText(benchOfAccession(state, frozen.id))}`
        : "当前：材料已不存在",
      driftDetail: drift?.detail,
    };
  });
  state.accessions
    .filter((accession) => accession.trialId === snapshot.trialId)
    .forEach((live) => {
      if (!capture.accessions.some((frozen) => frozen.id === live.id)) {
        accessions.push({
          id: live.id,
          title: `${live.accessionNo} · ${live.cultivar}`,
          subtitle: `${live.source} · ${live.quantity} 株`,
          status: "new",
          liveText: "快照生成后新增的材料",
        });
      }
    });

  const benches: ReferenceRow[] = capture.benches.map((frozen) => {
    const live = state.benches.find((item) => item.id === frozen.id);
    const drift = driftBy("BENCH_CHANGED", frozen.id);
    return {
      id: frozen.id,
      title: `台架 ${frozen.code} · ${frozen.sector}`,
      subtitle:
        frozen.status === "blocked" || frozen.status === "quarantine"
          ? frozen.blockedReason ?? "台架不可用"
          : `${lightLabel(frozen.lightProfile)} · ${frozen.assignedIds.length}/${frozen.capacity} 槽位`,
      status: !live ? "missing" : drift ? "changed" : "unchanged",
      frozenText: `当时：${benchStatusLabel(frozen.status)}；${benchAssignmentText(frozen, capture)}`,
      liveText: live
        ? `当前：${benchStatusLabel(live.status)}；${live.assignedIds.length}/${live.capacity} 槽位`
        : "当前：台架已不存在",
      driftDetail: drift?.detail,
    };
  });
  const benchCapture = buildLiveCapture(state, snapshot.trialId).benches;
  benchCapture.forEach((current) => {
    if (!capture.benches.some((frozen) => frozen.id === current.id)) {
      benches.push({
        id: current.id,
        title: `台架 ${current.code} · ${current.sector}`,
        subtitle:
          current.status === "blocked" || current.status === "quarantine"
            ? current.blockedReason ?? "台架不可用"
            : lightLabel(current.lightProfile),
        status: "new",
        liveText: "快照生成后新出现的相关台架",
      });
    }
  });

  const flags: ReferenceRow[] = capture.flags.map((frozen) => {
    const live = state.flags.find((item) => item.id === frozen.id);
    const drift = driftBy("FLAG_CHANGED", frozen.id);
    const accession = state.accessions.find(
      (item) => item.id === frozen.accessionId,
    );
    return {
      id: frozen.id,
      title: frozen.code,
      subtitle: frozen.message,
      status: !live ? "missing" : drift ? "changed" : "unchanged",
      frozenText: `当时：${flagStateLabel(frozen.state)}（${accession?.accessionNo ?? frozen.accessionId}）`,
      liveText: live
        ? `当前：${flagStateLabel(live.state)}`
        : "当前：标记已不存在",
      driftDetail: drift?.detail,
    };
  });
  state.flags
    .filter((flag) => flag.trialId === snapshot.trialId)
    .forEach((live) => {
      if (!capture.flags.some((frozen) => frozen.id === live.id)) {
        flags.push({
          id: live.id,
          title: live.code,
          subtitle: live.message,
          status: "new",
          liveText: `快照生成后新派生的标记（${flagStateLabel(live.state)}）`,
        });
      }
    });

  const passes: ReferenceRow[] = capture.observationPasses.map((frozen) => {
    const live = state.observationPasses.find((item) => item.id === frozen.id);
    return {
      id: frozen.id,
      title: `${frozen.observedOn} · ${frozen.observer}`,
      subtitle: `${frozen.entryCount} 条测量记录`,
      status: live ? "unchanged" : "missing",
      frozenText: `当时：${frozen.entryCount} 条记录`,
      liveText: live ? `当前：${live.entries.length} 条记录` : "当前：观测已不存在",
    };
  });
  state.observationPasses
    .filter((pass) => pass.trialId === snapshot.trialId)
    .forEach((livePass) => {
      if (
        !capture.observationPasses.some((frozen) => frozen.id === livePass.id)
      ) {
        passes.push({
          id: livePass.id,
          title: `${livePass.observedOn} · ${livePass.observer}`,
          subtitle: `${livePass.entries.length} 条测量记录`,
          status: "new",
          liveText: "快照生成后新增的观测",
        });
      }
    });

  return { trialRow, accessions, benches, flags, passes };
}

function resolveLegacyReferences(
  state: WorkspaceState,
  snapshot: ClearanceSnapshot,
): SnapshotReferences {
  const accessionIds = new Set<string>();
  const benchIds = new Set<string>();
  snapshot.blockers.forEach((blocker) => {
    if (blocker.accessionId) {
      accessionIds.add(blocker.accessionId);
    }
    if (blocker.benchId) {
      benchIds.add(blocker.benchId);
    }
  });

  const trial = state.trials.find((item) => item.id === snapshot.trialId);
  const trialRow: ReferenceRow | undefined = trial
    ? {
        id: trial.id,
        title: `${trial.code} · ${trial.cropFamily}`,
        subtitle: trial.objective,
        status: "legacy",
        liveText: `当前状态：${trialStateLabel(trial.state)}`,
      }
    : {
        id: snapshot.trialId,
        title: snapshot.trialId,
        status: "missing",
        liveText: "快照引用的试验已不存在",
      };

  const accessions: ReferenceRow[] = [];
  accessionIds.forEach((id) => {
    const accession = state.accessions.find((item) => item.id === id);
    accessions.push(
      accession
        ? {
            id,
            title: `${accession.accessionNo} · ${accession.cultivar}`,
            subtitle: accession.source,
            status: "legacy",
            liveText: `当前：${accessionBenchText(benchOfAccession(state, id))}`,
          }
        : {
            id,
            title: id,
            status: "missing",
            liveText: "快照引用的材料已不存在",
          },
    );
  });

  const benches: ReferenceRow[] = [];
  benchIds.forEach((id) => {
    const bench = state.benches.find((item) => item.id === id);
    benches.push(
      bench
        ? {
            id,
            title: `台架 ${bench.code} · ${bench.sector}`,
            subtitle: bench.blockedReason ?? benchStatusLabel(bench.status),
            status: "legacy",
            liveText: `当前：${benchStatusLabel(bench.status)}`,
          }
        : {
            id,
            title: id,
            status: "missing",
            liveText: "快照引用的台架已不存在",
          },
    );
  });

  // 标记本身在旧快照里没有 ID，只能按试验 + 阻止项编码近似匹配当前标记。
  const flags: ReferenceRow[] = [];
  state.flags
    .filter((flag) => flag.trialId === snapshot.trialId)
    .forEach((flag) => {
      const accession = state.accessions.find(
        (item) => item.id === flag.accessionId,
      );
      const matched = snapshot.blockers.some(
        (blocker) =>
          blocker.accessionId === flag.accessionId &&
          blocker.code === `FLAG_${flag.code}`,
      );
      if (matched) {
        flags.push({
          id: flag.id,
          title: flag.code,
          subtitle: flag.message,
          status: "legacy",
          frozenText: `当时：阻止项（${accession?.accessionNo ?? flag.accessionId}）`,
          liveText: `当前：${flagStateLabel(flag.state)}`,
        });
      }
    });

  return { trialRow, accessions, benches, flags, passes: [] };
}

function benchOfAccession(state: WorkspaceState, accessionId: string): string | undefined {
  return state.benches.find((bench) => bench.assignedIds.includes(accessionId))?.id;
}

/* ------------------------------------------------------------------ */
/* 标签                                                                 */
/* ------------------------------------------------------------------ */

export function trialStateLabel(state: TrialState): string {
  switch (state) {
    case "draft":
      return "草稿";
    case "active":
      return "进行中";
    case "paused":
      return "已暂停";
    case "cleared":
      return "已放行";
  }
}

export function benchStatusLabel(status: BenchStatus): string {
  switch (status) {
    case "available":
      return "可用";
    case "assigned":
      return "在用";
    case "blocked":
      return "停用";
    case "quarantine":
      return "隔离";
  }
}

export function flagStateLabel(state: Flag["state"]): string {
  switch (state) {
    case "open":
      return "未处理";
    case "resolved":
      return "已解决";
    case "waived":
      return "已豁免";
  }
}

export function lightLabel(light: PreferredLight): string {
  switch (light) {
    case "full-sun":
      return "全日照";
    case "partial-shade":
      return "半阴";
    case "shade":
      return "遮阴";
  }
}

export function formatSnapshotTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString("zh-CN", { hour12: false });
}
