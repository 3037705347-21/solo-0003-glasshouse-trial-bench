import type {
  Accession,
  Bench,
  ClearanceBlocker,
  ClearanceSnapshot,
  Flag,
  ObservationEntry,
  PreferredLight,
  Trial,
  WorkspaceState,
} from "./types";
import { BENCH_LIGHT_COMPATIBILITY } from "./rules";
import { findBenchForAccession } from "./bench";

export type DossierNoticeTone = "warning" | "critical" | "info";

export interface DossierNotice {
  code:
    | "TRIAL_MISSING"
    | "UNASSIGNED"
    | "BENCH_BLOCKED"
    | "BENCH_QUARANTINE"
    | "LIGHT_MISMATCH"
    | "FLAGS_OPEN"
    | "NO_OBSERVATIONS";
  tone: DossierNoticeTone;
  title: string;
  factSource: string;
  impact: string;
}

export interface DossierObservation {
  passId: string;
  observedOn: string;
  observer: string;
  entry: ObservationEntry;
  flags: Flag[];
}

export interface DossierClearanceRecord {
  snapshot: ClearanceSnapshot;
  relatedBlockers: ClearanceBlocker[];
  namesAccession: boolean;
}

export interface AccessionDossier {
  accession: Accession;
  trial: Trial | undefined;
  bench: Bench | undefined;
  benchOccupancy:
    | { used: number; capacity: number; percent: number }
    | undefined;
  benchMates: Accession[];
  lightCompatible: boolean | undefined;
  observations: DossierObservation[];
  flags: Flag[];
  openFlags: Flag[];
  snapshots: DossierClearanceRecord[];
  notices: DossierNotice[];
}

const lightLabels: Record<PreferredLight, string> = {
  "full-sun": "全日照",
  "partial-shade": "半阴",
  shade: "遮阴",
};

export function preferredLightLabel(light: PreferredLight): string {
  return lightLabels[light];
}

export function buildAccessionDossier(
  state: WorkspaceState,
  accessionId: string,
): AccessionDossier | undefined {
  const accession = state.accessions.find((item) => item.id === accessionId);
  if (!accession) {
    return undefined;
  }

  const trial = state.trials.find((item) => item.id === accession.trialId);
  const bench = findBenchForAccession(state.benches, accession);
  const benchMates = bench
    ? bench.assignedIds
        .filter((id) => id !== accession.id)
        .flatMap((id) => {
          const mate = state.accessions.find((item) => item.id === id);
          return mate ? [mate] : [];
        })
    : [];
  const benchOccupancy = bench
    ? {
        used: bench.assignedIds.length,
        capacity: bench.capacity,
        percent:
          bench.capacity === 0
            ? 0
            : Math.round((bench.assignedIds.length / bench.capacity) * 100),
      }
    : undefined;
  const lightCompatible = bench
    ? BENCH_LIGHT_COMPATIBILITY[accession.preferredLight].includes(
        bench.lightProfile,
      )
    : undefined;

  const observations: DossierObservation[] = state.observationPasses
    .flatMap((pass) => {
      const entry = pass.entries.find(
        (item) => item.accessionId === accession.id,
      );
      if (!entry) {
        return [];
      }
      const flags = state.flags.filter(
        (flag) =>
          flag.observationPassId === pass.id &&
          flag.accessionId === accession.id,
      );
      return [{ passId: pass.id, observedOn: pass.observedOn, observer: pass.observer, entry, flags }];
    })
    .sort((left, right) => right.observedOn.localeCompare(left.observedOn));

  const flags = state.flags
    .filter((flag) => flag.accessionId === accession.id)
    .sort((left, right) => right.createdOn.localeCompare(left.createdOn));
  const openFlags = flags.filter((flag) => flag.state === "open");

  const snapshots = state.clearanceSnapshots
    .filter((snapshot) => snapshot.trialId === accession.trialId)
    .map((snapshot) => {
      const relatedBlockers = snapshot.blockers.filter(
        (blocker) =>
          blocker.accessionId === accession.id ||
          (bench ? blocker.benchId === bench.id : false),
      );
      return {
        snapshot,
        relatedBlockers,
        namesAccession: relatedBlockers.some(
          (blocker) => blocker.accessionId === accession.id,
        ),
      };
    })
    .sort((left, right) =>
      right.snapshot.generatedOn.localeCompare(left.snapshot.generatedOn),
    );

  const notices = buildNotices({
    accession,
    trial,
    bench,
    lightCompatible,
    openFlags,
    observationCount: observations.length,
  });

  return {
    accession,
    trial,
    bench,
    benchOccupancy,
    benchMates,
    lightCompatible,
    observations,
    flags,
    openFlags,
    snapshots,
    notices,
  };
}

function buildNotices({
  accession,
  trial,
  bench,
  lightCompatible,
  openFlags,
  observationCount,
}: {
  accession: Accession;
  trial: Trial | undefined;
  bench: Bench | undefined;
  lightCompatible: boolean | undefined;
  openFlags: Flag[];
  observationCount: number;
}): DossierNotice[] {
  const notices: DossierNotice[] = [];

  if (!trial) {
    notices.push({
      code: "TRIAL_MISSING",
      tone: "critical",
      title: "试验归属缺失",
      factSource: `材料登记记录中的试验归属为 ${accession.trialId}，但当前试验列表中找不到该试验。`,
      impact:
        "试验状态、季节与放行上下文均无法确定，需要回到材料登记核对该材料的试验归属。",
    });
  }

  if (!bench) {
    notices.push({
      code: "UNASSIGNED",
      tone: "warning",
      title: "尚未分配台架",
      factSource:
        "台架布局中没有任何台架的分配名单（assignedIds）包含该材料，事实实时取自当前台架状态。",
      impact:
        "该材料当前不占用台架槽位；生成放行快照时会产生 UNASSIGNED 阻止项，试验无法放行。",
    });
  } else {
    if (bench.status === "blocked") {
      notices.push({
        code: "BENCH_BLOCKED",
        tone: "critical",
        title: `所在台架 ${bench.code} 已停用`,
        factSource: `台架布局记录：${bench.code} 当前状态为“受限/停用”，记录原因：${bench.blockedReason ?? "未记录原因"}。`,
        impact:
          "材料仍占用受限台架；生成放行快照时会产生 BENCH_BLOCKED 阻止项，请先在台架布局移出材料。",
      });
    }
    if (bench.status === "quarantine") {
      notices.push({
        code: "BENCH_QUARANTINE",
        tone: "critical",
        title: `所在台架 ${bench.code} 正在隔离`,
        factSource: `台架布局记录：${bench.code} 当前状态为“隔离”，不接受任何分配或放行。`,
        impact:
          "材料仍占用隔离台架；生成放行快照时会产生 BENCH_QUARANTINE 阻止项，请先在台架布局移出材料。",
      });
    }
    if (lightCompatible === false) {
      notices.push({
        code: "LIGHT_MISMATCH",
        tone: "warning",
        title: "台架光照与材料偏好不兼容",
        factSource: `材料适宜光照为“${preferredLightLabel(accession.preferredLight)}”，${bench.code} 的光照为“${preferredLightLabel(bench.lightProfile)}”，不在光照兼容表内。`,
        impact:
          "当前摆放可能影响生长，且该组合无法通过正常分配流程产生，请核对台架状态或材料登记数据。",
      });
    }
  }

  if (openFlags.length > 0) {
    const codes = Array.from(new Set(openFlags.map((flag) => flag.code))).join(
      "、",
    );
    notices.push({
      code: "FLAGS_OPEN",
      tone: "critical",
      title: `${openFlags.length} 个派生标记尚未处理`,
      factSource: `生长观测入库时派生的标记中，仍有 ${openFlags.length} 个处于 open（${codes}），事实实时取自标记生命周期状态。`,
      impact:
        "每个未处理标记都会作为阻止项进入放行快照；需要在生长观测页填写处理说明后解决或豁免。",
    });
  }

  if (observationCount === 0) {
    notices.push({
      code: "NO_OBSERVATIONS",
      tone: "warning",
      title: "尚无观测记录",
      factSource:
        "全部观测批次（ObservationPass）中都没有该材料的测量条目，事实实时取自观测历史。",
      impact:
        "缺少株高、叶片数与基质电导率数据，无法判断是否应派生生长标记；缺测本身不阻止放行，但放行缺少该材料的生长证据。",
    });
  }

  return notices;
}
