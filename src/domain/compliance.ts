import type {
  CompliancePackage,
  PackageAccessionRecord,
  PackageCheckCategory,
  PackageCheckFinding,
  PackageClearanceRecord,
  PackageFlagRecord,
  PackageInventoryEntry,
  PackageObservationRecord,
  PackageScopeNote,
  WorkspaceState,
} from "./types";
import { createId } from "./id";
import { fail, fieldError, ok, type Result } from "./result";

export const PACKAGE_CHECK_CATEGORY_LABELS: Record<PackageCheckCategory, string> = {
  "missing-page": "缺页",
  "broken-ref": "断裂引用",
  duplicate: "重复对象",
  "open-blocker": "未处理阻止项",
};

export function buildCompliancePackage(
  state: WorkspaceState,
  trialId: string,
): Result<CompliancePackage> {
  const trial = state.trials.find((item) => item.id === trialId);
  if (!trial) {
    return fail([fieldError("trialId", "unknown", "请选择有效试验")]);
  }

  const trialAccessions = state.accessions.filter(
    (accession) => accession.trialId === trialId,
  );
  const accessionById = new Map(
    state.accessions.map((accession) => [accession.id, accession]),
  );
  const passIds = new Set(state.observationPasses.map((pass) => pass.id));

  const accessions: PackageAccessionRecord[] = trialAccessions.map(
    (accession) => {
      const bench = state.benches.find((item) =>
        item.assignedIds.includes(accession.id),
      );
      return {
        id: accession.id,
        accessionNo: accession.accessionNo,
        cultivar: accession.cultivar,
        source: accession.source,
        quantity: accession.quantity,
        trayCells: accession.trayCells,
        preferredLight: accession.preferredLight,
        labels: [...accession.labels],
        benchCode: bench?.code ?? null,
        benchSector: bench?.sector ?? null,
      };
    },
  );

  const observations: PackageObservationRecord[] = state.observationPasses
    .filter((pass) => pass.trialId === trialId)
    .sort((left, right) => left.observedOn.localeCompare(right.observedOn))
    .map((pass) => ({
      id: pass.id,
      observedOn: pass.observedOn,
      observer: pass.observer,
      entries: pass.entries.map((entry) => ({ ...entry })),
    }));

  const flags: PackageFlagRecord[] = state.flags
    .filter((flag) => flag.trialId === trialId)
    .map((flag) => ({
      id: flag.id,
      accessionNo:
        accessionById.get(flag.accessionId)?.accessionNo ?? flag.accessionId,
      code: flag.code,
      message: flag.message,
      severity: flag.severity,
      state: flag.state,
      resolutionNote: flag.resolutionNote ?? null,
    }));

  const latestClearance = [...state.clearanceSnapshots]
    .filter((snapshot) => snapshot.trialId === trialId)
    .sort((left, right) => right.generatedOn.localeCompare(left.generatedOn))[0];
  const clearance: PackageClearanceRecord | null = latestClearance
    ? {
        snapshotId: latestClearance.id,
        generatedOn: latestClearance.generatedOn,
        status: latestClearance.status,
        blockers: latestClearance.blockers.map((blocker) => ({ ...blocker })),
      }
    : null;

  const checks = collectPackageChecks(
    state,
    trialId,
    trialAccessions.map((accession) => accession.id),
    clearance,
  );

  const handledFlags = flags.filter((flag) => flag.state !== "open");
  const openFlags = flags.filter((flag) => flag.state === "open");
  const measurementCount = observations.reduce(
    (total, pass) => total + pass.entries.length,
    0,
  );

  const included: PackageScopeNote[] = [];
  const excluded: PackageScopeNote[] = [];
  if (accessions.length > 0) {
    included.push({
      label: "材料记录",
      detail: `全部 ${accessions.length} 份材料记录及生成时点的台架位置已纳入`,
    });
  } else {
    excluded.push({
      label: "材料记录",
      detail: "该试验没有材料，无内容可纳入",
    });
  }
  if (observations.length > 0) {
    included.push({
      label: "观测记录",
      detail: `${observations.length} 次观测、${measurementCount} 条测量已纳入`,
    });
  } else {
    excluded.push({
      label: "观测记录",
      detail: "该试验没有观测记录，无内容可纳入",
    });
  }
  if (handledFlags.length > 0) {
    included.push({
      label: "标记处理结果",
      detail: `${handledFlags.length} 条已解决或已豁免的标记处理结果已纳入`,
    });
  }
  if (openFlags.length > 0) {
    excluded.push({
      label: "未处理标记",
      detail: `${openFlags.length} 条未处理标记被排除，处理后才能纳入`,
    });
  }
  if (clearance && clearance.status === "ready") {
    included.push({
      label: "放行快照",
      detail: `快照 ${clearance.snapshotId}（就绪）已纳入`,
    });
  } else if (clearance) {
    excluded.push({
      label: "放行快照",
      detail: `快照 ${clearance.snapshotId} 处于被阻止状态，放行结论未纳入`,
    });
  } else {
    excluded.push({
      label: "放行快照",
      detail: "尚未生成放行快照，无内容可纳入",
    });
  }

  const inventory: PackageInventoryEntry[] = [
    {
      key: "accessions",
      label: "材料记录",
      count: accessions.length,
      detail: "生成时点冻结的材料与台架位置",
    },
    {
      key: "observations",
      label: "观测记录",
      count: observations.length,
      detail: "生成时点冻结的观测批次",
    },
    {
      key: "measurements",
      label: "测量条目",
      count: measurementCount,
      detail: "各观测批次中的测量记录",
    },
    {
      key: "handledFlags",
      label: "标记处理结果",
      count: handledFlags.length,
      detail: "已解决或已豁免的标记",
    },
    {
      key: "openFlags",
      label: "未处理标记",
      count: openFlags.length,
      detail: "生成时点仍未处理的标记",
    },
    {
      key: "clearance",
      label: "放行快照",
      count: clearance ? 1 : 0,
      detail: clearance ? "最近一次已保存的放行快照" : "尚未生成放行快照",
    },
  ];

  const version = nextPackageVersion(state, trialId);
  const digest = computePackageDigest({
    trialId,
    accessions,
    observations,
    flags,
    clearance,
    checks,
  });

  return ok({
    id: createId("pkg"),
    trialId: trial.id,
    trialCode: trial.code,
    trialCropFamily: trial.cropFamily,
    version,
    generatedOn: new Date().toISOString(),
    status: checks.length === 0 ? "complete" : "with-exclusions",
    inventory,
    accessions,
    observations,
    flags,
    clearance,
    checks,
    included,
    excluded,
    digest,
    exportFileName: `compliance-package-${trial.code}-v${version}.json`,
  });
}

function collectPackageChecks(
  state: WorkspaceState,
  trialId: string,
  trialAccessionIds: string[],
  clearance: PackageClearanceRecord | null,
): PackageCheckFinding[] {
  const checks: PackageCheckFinding[] = [];
  const accessionById = new Map(
    state.accessions.map((accession) => [accession.id, accession]),
  );
  const passIds = new Set(state.observationPasses.map((pass) => pass.id));

  if (trialAccessionIds.length === 0) {
    checks.push({
      category: "missing-page",
      code: "NO_ACCESSIONS",
      message: "该试验没有任何材料记录",
    });
  }
  const trialPasses = state.observationPasses.filter(
    (pass) => pass.trialId === trialId,
  );
  if (trialPasses.length === 0) {
    checks.push({
      category: "missing-page",
      code: "NO_OBSERVATIONS",
      message: "该试验没有任何观测记录",
    });
  }
  trialAccessionIds.forEach((accessionId) => {
    const accession = accessionById.get(accessionId);
    if (!accession) {
      return;
    }
    const observed = trialPasses.some((pass) =>
      pass.entries.some((entry) => entry.accessionId === accessionId),
    );
    if (!observed) {
      checks.push({
        category: "missing-page",
        code: "ACCESSION_UNOBSERVED",
        message: `${accession.accessionNo} 没有任何观测测量`,
      });
    }
    const placed = state.benches.some((bench) =>
      bench.assignedIds.includes(accessionId),
    );
    if (!placed) {
      checks.push({
        category: "missing-page",
        code: "ACCESSION_UNPLACED",
        message: `${accession.accessionNo} 没有台架位置记录`,
      });
    }
  });
  if (!clearance) {
    checks.push({
      category: "missing-page",
      code: "CLEARANCE_MISSING",
      message: "尚未生成放行快照",
    });
  }

  state.flags
    .filter((flag) => flag.trialId === trialId)
    .forEach((flag) => {
      if (!accessionById.has(flag.accessionId)) {
        checks.push({
          category: "broken-ref",
          code: "FLAG_ACCESSION_MISSING",
          message: `标记 ${flag.code} 引用的材料已不存在`,
        });
      }
      if (!passIds.has(flag.observationPassId)) {
        checks.push({
          category: "broken-ref",
          code: "FLAG_PASS_MISSING",
          message: `标记 ${flag.code} 引用的观测记录已不存在`,
        });
      }
    });
  trialPasses.forEach((pass) => {
    pass.entries.forEach((entry) => {
      if (!accessionById.has(entry.accessionId)) {
        checks.push({
          category: "broken-ref",
          code: "ENTRY_ACCESSION_MISSING",
          message: `${pass.observedOn} 的观测中有测量引用了不存在的材料`,
        });
      }
    });
  });
  state.benches.forEach((bench) => {
    bench.assignedIds.forEach((accessionId) => {
      if (!accessionById.has(accessionId)) {
        checks.push({
          category: "broken-ref",
          code: "BENCH_ASSIGNMENT_MISSING",
          message: `台架 ${bench.code} 引用了不存在的材料`,
        });
      }
    });
  });

  const accessionNoCounts = new Map<string, number>();
  trialAccessionIds.forEach((accessionId) => {
    const accession = accessionById.get(accessionId);
    if (!accession) {
      return;
    }
    accessionNoCounts.set(
      accession.accessionNo,
      (accessionNoCounts.get(accession.accessionNo) ?? 0) + 1,
    );
  });
  accessionNoCounts.forEach((count, accessionNo) => {
    if (count > 1) {
      checks.push({
        category: "duplicate",
        code: "DUPLICATE_ACCESSION_NO",
        message: `材料编号 ${accessionNo} 在试验中出现了 ${count} 次`,
      });
    }
  });
  const benchesByAccession = new Map<string, string[]>();
  state.benches.forEach((bench) => {
    bench.assignedIds.forEach((accessionId) => {
      const list = benchesByAccession.get(accessionId) ?? [];
      list.push(bench.code);
      benchesByAccession.set(accessionId, list);
    });
  });
  trialAccessionIds.forEach((accessionId) => {
    const accession = accessionById.get(accessionId);
    const benchCodes = benchesByAccession.get(accessionId) ?? [];
    if (accession && benchCodes.length > 1) {
      checks.push({
        category: "duplicate",
        code: "ACCESSION_DOUBLE_PLACED",
        message: `${accession.accessionNo} 同时出现在多个台架：${benchCodes.join("、")}`,
      });
    }
  });

  state.flags
    .filter((flag) => flag.trialId === trialId && flag.state === "open")
    .forEach((flag) => {
      checks.push({
        category: "open-blocker",
        code: `FLAG_OPEN_${flag.code}`,
        message: `未处理标记：${flag.message}`,
      });
    });
  if (clearance && clearance.status === "blocked") {
    clearance.blockers
      .filter((blocker) => !blocker.code.startsWith("FLAG_"))
      .forEach((blocker) => {
        checks.push({
          category: "open-blocker",
          code: `CLEARANCE_${blocker.code}`,
          message: `放行阻止项：${blocker.message}`,
        });
      });
  }

  return checks;
}

export function nextPackageVersion(
  state: WorkspaceState,
  trialId: string,
): number {
  return (
    state.compliancePackages
      .filter((item) => item.trialId === trialId)
      .reduce((max, item) => Math.max(max, item.version), 0) + 1
  );
}

interface PackageDigestInput {
  trialId: string;
  accessions: PackageAccessionRecord[];
  observations: PackageObservationRecord[];
  flags: PackageFlagRecord[];
  clearance: PackageClearanceRecord | null;
  checks: PackageCheckFinding[];
}

function computePackageDigest(input: PackageDigestInput): string {
  const json = JSON.stringify(input);
  let hash = 0x811c9dc5;
  for (let index = 0; index < json.length; index += 1) {
    hash ^= json.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `pkg-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function serializeCompliancePackage(pkg: CompliancePackage): string {
  return JSON.stringify(
    {
      fileType: "glasshouse-compliance-package",
      exportedFrom: "glasshouse-trial-bench",
      package: pkg,
    },
    null,
    2,
  );
}
