import type { Accession, Bench, PreferredLight } from "./types";
import { BENCH_LIGHT_COMPATIBILITY } from "./rules";
import { fail, fieldError, ok, type Result } from "./result";
import { isAccessionRetired } from "./accession";
import { isBenchInMaintenanceFlow } from "./benchMaintenance";

export function canAssignAccession(accession: Accession, bench: Bench): boolean {
  if (isAccessionRetired(accession)) {
    return false;
  }
  if (
    bench.status === "blocked" ||
    bench.status === "quarantine" ||
    isBenchInMaintenanceFlow(bench)
  ) {
    return false;
  }
  if (bench.assignedIds.includes(accession.id)) {
    return false;
  }
  if (bench.assignedIds.length >= bench.capacity) {
    return false;
  }
  return BENCH_LIGHT_COMPATIBILITY[accession.preferredLight].includes(
    bench.lightProfile,
  );
}

export function validateBenchAssignment(
  accession: Accession,
  bench: Bench,
): Result<{ accessionId: string; benchId: string }> {
  if (isAccessionRetired(accession)) {
    return fail([
      fieldError(
        "accessionId",
        "retired",
        `${accession.accessionNo} 已停用，不能进入新分配`,
      ),
    ]);
  }
  if (bench.status === "blocked") {
    return fail([
      fieldError(
        "benchId",
        "blocked",
        `台架 ${bench.code} 已停用：${bench.blockedReason ?? "未记录原因"}`,
      ),
    ]);
  }
  if (bench.status === "quarantine") {
    return fail([
      fieldError(
        "benchId",
        "quarantine",
        `台架 ${bench.code} 正在隔离`,
      ),
    ]);
  }
  if (bench.status === "maintenance-pending") {
    return fail([
      fieldError(
        "benchId",
        "maintenance_pending",
        `台架 ${bench.code} 已申请维护，请先在维护面板中疏散或取消`,
      ),
    ]);
  }
  if (bench.status === "maintenance") {
    return fail([
      fieldError(
        "benchId",
        "in_maintenance",
        `台架 ${bench.code} 正在维护中，不能分配材料`,
      ),
    ]);
  }
  if (bench.assignedIds.includes(accession.id)) {
    return fail([
      fieldError(
        "benchId",
        "duplicate",
        "该材料已经分配到该台架",
      ),
    ]);
  }
  if (bench.assignedIds.length >= bench.capacity) {
    return fail([
      fieldError(
        "benchId",
        "capacity",
        `台架 ${bench.code} 没有空位`,
      ),
    ]);
  }
  if (
    !BENCH_LIGHT_COMPATIBILITY[accession.preferredLight].includes(
      bench.lightProfile,
    )
  ) {
    return fail([
      fieldError(
        "benchId",
        "light_mismatch",
        `${accession.cultivar} 需要 ${accession.preferredLight}，${bench.code} 为 ${bench.lightProfile}`,
      ),
    ]);
  }
  return ok({ accessionId: accession.id, benchId: bench.id });
}

export function assignAccession(
  accession: Accession,
  bench: Bench,
): Result<Bench> {
  const validated = validateBenchAssignment(accession, bench);
  if (!validated.ok) {
    return validated;
  }
  return ok({
    ...bench,
    assignedIds: [...bench.assignedIds, accession.id],
    status: "assigned",
  });
}

export function releaseAccession(
  accessionId: string,
  bench: Bench,
): Result<Bench> {
  if (isBenchInMaintenanceFlow(bench)) {
    return fail([
      fieldError(
        "benchId",
        "maintenance_pending",
        bench.status === "maintenance"
          ? `台架 ${bench.code} 正在维护中`
          : `台架 ${bench.code} 已申请维护：请通过“迁移到其他台架”为材料指定去处，不能直接移出`,
      ),
    ]);
  }
  if (!bench.assignedIds.includes(accessionId)) {
    return fail([
      fieldError(
        "benchId",
        "not_assigned",
        "该材料未分配到该台架",
      ),
    ]);
  }
  return ok({
    ...bench,
    assignedIds: bench.assignedIds.filter((id) => id !== accessionId),
    status: bench.assignedIds.length === 1 ? "available" : "assigned",
  });
}

export function updateBenchLight(
  bench: Bench,
  lightProfile: PreferredLight,
): Result<Bench> {
  if (isBenchInMaintenanceFlow(bench)) {
    return fail([
      fieldError(
        "lightProfile",
        "in_maintenance",
        `台架 ${bench.code} 处于维护流程中，请在维护结束后再修改光照类型`,
      ),
    ]);
  }
  if (bench.assignedIds.length > 0) {
    return fail([
      fieldError(
        "lightProfile",
        "assigned",
        "请先移出台架上的材料，再修改光照类型",
      ),
    ]);
  }
  return ok({ ...bench, lightProfile });
}

export function benchUtilization(bench: Bench): number {
  return bench.capacity === 0
    ? 0
    : Math.round((bench.assignedIds.length / bench.capacity) * 100);
}

export function findBenchForAccession(
  benches: Bench[],
  accession: Accession,
): Bench | undefined {
  return benches.find((bench) => bench.assignedIds.includes(accession.id));
}
