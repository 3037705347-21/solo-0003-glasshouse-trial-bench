import type {
  Accession,
  Bench,
  BenchMaintenanceRecord,
  BenchRelocationRecord,
  WorkspaceState,
} from "./types";
import { BENCH_LIGHT_COMPATIBILITY } from "./rules";
import { createId } from "./id";
import { fail, fieldError, ok, type Result } from "./result";

export interface BenchMaintenanceDraft {
  requestedAt: string;
  reason: string;
}

export const MAINTENANCE_FLOW_STATUSES: ReadonlyArray<Bench["status"]> = [
  "maintenance-pending",
  "maintenance",
];

export function isBenchInMaintenanceFlow(bench: Bench): boolean {
  return MAINTENANCE_FLOW_STATUSES.includes(bench.status);
}

export function isBenchMaintenancePending(bench: Bench): boolean {
  return bench.status === "maintenance-pending";
}

export function latestMaintenanceRecord(
  bench: Bench,
): BenchMaintenanceRecord | undefined {
  return bench.maintenanceHistory[bench.maintenanceHistory.length - 1];
}

function normalizeTimestamp(value: string): string | undefined {
  if (!value.trim()) {
    return undefined;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

/**
 * 申请台架临时维护：仅在用台架（available/assigned）可以申请。
 * 申请后台架进入 maintenance-pending 过渡态，不强制立即清空材料，
 * 但新分配与普通移出都会被冻结，材料只能通过有明确去处的 relocate 疏散。
 */
export function requestBenchMaintenance(
  bench: Bench,
  draft: BenchMaintenanceDraft,
): Result<Bench> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  if (isBenchInMaintenanceFlow(bench)) {
    errors.push(
      fieldError(
        "status",
        "already_in_maintenance",
        `台架 ${bench.code} 已经处于维护流程中`,
      ),
    );
  }
  if (bench.status === "blocked") {
    errors.push(
      fieldError(
        "status",
        "blocked",
        `台架 ${bench.code} 当前受限：${bench.blockedReason ?? "未记录原因"}，请先解除受限状态`,
      ),
    );
  }
  if (bench.status === "quarantine") {
    errors.push(
      fieldError(
        "status",
        "quarantine",
        `台架 ${bench.code} 正在隔离，不能申请维护`,
      ),
    );
  }
  if (draft.reason.trim().length < 4) {
    errors.push(
      fieldError("reason", "too_short", "请填写至少四个字符的维护原因"),
    );
  }
  const requestedAt = normalizeTimestamp(draft.requestedAt);
  if (!requestedAt) {
    errors.push(fieldError("requestedAt", "invalid_date", "申请时间无效"));
  }
  if (errors.length > 0 || !requestedAt) {
    return fail(errors);
  }

  const record: BenchMaintenanceRecord = {
    id: createId("mnt"),
    benchId: bench.id,
    requestedAt,
    reason: draft.reason.trim(),
    previousStatus: bench.status,
    relocations: [],
  };
  return ok({
    ...bench,
    status: "maintenance-pending",
    blockedReason: undefined,
    maintenanceHistory: [...bench.maintenanceHistory, record],
  });
}

/**
 * 维护疏散的去处校验：目的台架必须正常、有余位、光照兼容。
 * 停用材料同样需要物理撤离，因此不在此处拦截（由 UI 提示其历史引用仍保留）。
 */
export function validateMaintenanceRelocation(
  accession: Accession,
  fromBench: Bench,
  toBench: Bench | undefined,
): Result<{ targetBenchId: string }> {
  if (!isBenchMaintenancePending(fromBench)) {
    return fail([
      fieldError(
        "fromBenchId",
        "not_pending",
        `台架 ${fromBench.code} 当前不在维护过渡态，不能执行维护迁移`,
      ),
    ]);
  }
  if (!toBench) {
    return fail([
      fieldError("toBenchId", "unknown", "请选择接收材料的台架"),
    ]);
  }
  if (toBench.id === fromBench.id) {
    return fail([
      fieldError("toBenchId", "same_bench", "接收台架不能是正在维护的台架"),
    ]);
  }
  if (isBenchInMaintenanceFlow(toBench)) {
    return fail([
      fieldError(
        "toBenchId",
        "in_maintenance",
        `台架 ${toBench.code} 也在维护流程中，不能接收材料`,
      ),
    ]);
  }
  if (toBench.status === "blocked" || toBench.status === "quarantine") {
    return fail([
      fieldError(
        "toBenchId",
        "unavailable",
        `台架 ${toBench.code} 当前不可用（${toBench.status === "blocked" ? "受限" : "隔离"}）`,
      ),
    ]);
  }
  if (!fromBench.assignedIds.includes(accession.id)) {
    return fail([
      fieldError(
        "accessionId",
        "not_on_bench",
        `${accession.accessionNo} 当前不在台架 ${fromBench.code} 上`,
      ),
    ]);
  }
  if (toBench.assignedIds.includes(accession.id)) {
    return fail([
      fieldError(
        "toBenchId",
        "duplicate",
        `${accession.accessionNo} 已经在台架 ${toBench.code} 上`,
      ),
    ]);
  }
  if (toBench.assignedIds.length >= toBench.capacity) {
    return fail([
      fieldError(
        "toBenchId",
        "capacity",
        `台架 ${toBench.code} 没有空位`,
      ),
    ]);
  }
  if (
    !BENCH_LIGHT_COMPATIBILITY[accession.preferredLight].includes(
      toBench.lightProfile,
    )
  ) {
    return fail([
      fieldError(
        "toBenchId",
        "light_mismatch",
        `${accession.cultivar} 需要 ${accession.preferredLight}，${toBench.code} 为 ${toBench.lightProfile}`,
      ),
    ]);
  }
  return ok({ targetBenchId: toBench.id });
}

export interface MaintenanceRelocationResult {
  sourceBench: Bench;
  targetBench: Bench;
  record: BenchRelocationRecord;
}

/**
 * 执行一次维护疏散：原子地更新来源/目的台架，并向当前维护记录追加迁移条目。
 * 观测、标记和放行快照只引用 accessionId，随材料移动且不被改写。
 */
export function relocateForMaintenance(
  state: WorkspaceState,
  fromBenchId: string,
  accessionId: string,
  toBenchId: string,
  note: string,
): Result<MaintenanceRelocationResult> {
  const fromBench = state.benches.find((bench) => bench.id === fromBenchId);
  const toBench = state.benches.find((bench) => bench.id === toBenchId);
  const accession = state.accessions.find((item) => item.id === accessionId);
  if (!fromBench || !accession) {
    return fail([fieldError("accessionId", "unknown", "材料或台架不存在")]);
  }
  if (!toBench) {
    return fail([fieldError("toBenchId", "unknown", "请选择接收材料的台架")]);
  }
  const validated = validateMaintenanceRelocation(accession, fromBench, toBench);
  if (!validated.ok) {
    return validated;
  }

  const record: BenchRelocationRecord = {
    id: createId("rel"),
    accessionId,
    fromBenchId,
    toBenchId,
    relocatedAt: new Date().toISOString(),
    note: note.trim(),
  };
  const recordIndex = fromBench.maintenanceHistory.length - 1;
  const sourceBench: Bench = {
    ...fromBench,
    assignedIds: fromBench.assignedIds.filter((id) => id !== accessionId),
    maintenanceHistory: fromBench.maintenanceHistory.map((entry, index) =>
      index === recordIndex
        ? { ...entry, relocations: [...entry.relocations, record] }
        : entry,
    ),
  };
  const targetBench: Bench = {
    ...toBench,
    assignedIds: [...toBench.assignedIds, accessionId],
    status: "assigned",
  };
  return ok({ sourceBench, targetBench, record });
}

/** 过渡态结束条件：台架上仍有材料时不能正式开始维护。 */
export function canStartBenchMaintenance(bench: Bench): boolean {
  return isBenchMaintenancePending(bench) && bench.assignedIds.length === 0;
}

export function startBenchMaintenance(bench: Bench): Result<Bench> {
  if (!isBenchMaintenancePending(bench)) {
    return fail([
      fieldError(
        "status",
        "not_pending",
        `台架 ${bench.code} 尚未申请维护，不能开始维护`,
      ),
    ]);
  }
  if (bench.assignedIds.length > 0) {
    return fail([
      fieldError(
        "assignedIds",
        "not_evacuated",
        `台架 ${bench.code} 上仍有 ${bench.assignedIds.length} 个材料，请先完成疏散或取消维护`,
      ),
    ]);
  }
  const recordIndex = bench.maintenanceHistory.length - 1;
  return ok({
    ...bench,
    status: "maintenance",
    maintenanceHistory: bench.maintenanceHistory.map((entry, index) =>
      index === recordIndex
        ? { ...entry, startedAt: new Date().toISOString() }
        : entry,
    ),
  });
}

export function completeBenchMaintenance(
  bench: Bench,
  endNote: string,
): Result<Bench> {
  if (bench.status !== "maintenance") {
    return fail([
      fieldError(
        "status",
        "not_in_maintenance",
        `台架 ${bench.code} 当前不在维护中，不能完成维护`,
      ),
    ]);
  }
  if (bench.assignedIds.length > 0) {
    return fail([
      fieldError(
        "assignedIds",
        "not_evacuated",
        `台架 ${bench.code} 上仍有材料，不能完成维护`,
      ),
    ]);
  }
  return ok(finalizeMaintenance(bench, "completed", endNote, "available"));
}

/**
 * 取消维护：
 * - 尚未发生任何迁移时，精确恢复申请前的状态（available/assigned）；
 * - 已经发生迁移时，按当前占用事实派生状态（非空 assigned，空 available），
 *   迁移记录与取消结论都保留在维护历史中，旧操作不被抹除。
 */
export function cancelBenchMaintenance(
  bench: Bench,
  endNote: string,
): Result<Bench> {
  if (!isBenchInMaintenanceFlow(bench)) {
    return fail([
      fieldError(
        "status",
        "not_in_maintenance",
        `台架 ${bench.code} 当前不在维护流程中`,
      ),
    ]);
  }
  const record = latestMaintenanceRecord(bench);
  let restoredStatus: Bench["status"];
  if (bench.status === "maintenance") {
    restoredStatus = "available";
  } else if (record && record.relocations.length === 0) {
    restoredStatus = record.previousStatus;
  } else {
    restoredStatus = bench.assignedIds.length > 0 ? "assigned" : "available";
  }
  return ok(finalizeMaintenance(bench, "cancelled", endNote, restoredStatus));
}

function finalizeMaintenance(
  bench: Bench,
  outcome: "completed" | "cancelled",
  endNote: string,
  nextStatus: Bench["status"],
): Bench {
  const recordIndex = bench.maintenanceHistory.length - 1;
  return {
    ...bench,
    status: nextStatus,
    maintenanceHistory: bench.maintenanceHistory.map((entry, index) =>
      index === recordIndex
        ? {
            ...entry,
            endedAt: new Date().toISOString(),
            outcome,
            endNote: endNote.trim() || undefined,
          }
        : entry,
    ),
  };
}

/** 可作为疏散目的地的台架：正常状态且不在维护流程中。 */
export function relocationTargetCandidates(
  state: WorkspaceState,
  accession: Accession,
  fromBench: Bench,
): Bench[] {
  return state.benches.filter((candidate) => {
    if (candidate.id === fromBench.id || isBenchInMaintenanceFlow(candidate)) {
      return false;
    }
    if (candidate.status === "blocked" || candidate.status === "quarantine") {
      return false;
    }
    if (candidate.assignedIds.length >= candidate.capacity) {
      return false;
    }
    return BENCH_LIGHT_COMPATIBILITY[accession.preferredLight].includes(
      candidate.lightProfile,
    );
  });
}
