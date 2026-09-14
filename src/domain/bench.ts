import type {
  Accession,
  Bench,
  BenchOperationalStatus,
  BenchStatus,
  BenchStatusRecord,
  PreferredLight,
  WorkspaceState,
} from "./types";
import { BENCH_LIGHT_COMPATIBILITY, LIGHT_PROFILES } from "./rules";
import { createId } from "./id";
import { fail, fieldError, ok, type Result } from "./result";

export const BENCH_CODE_PATTERN = /^[A-Z]{1,4}-\d{1,3}$/;
export const BENCH_CAPACITY_MIN = 1;
export const BENCH_CAPACITY_MAX = 100;
const REASON_MIN_LENGTH = 2;

/** 台架当前的运维状态：受限 / 隔离优先，占用只影响“可用”的展示。 */
export function benchOperationalStatus(bench: Bench): BenchOperationalStatus {
  if (bench.status === "blocked" || bench.status === "quarantine") {
    return bench.status;
  }
  return "available";
}

/** 最近一次受限 / 隔离记录的原因，兼容旧版 blockedReason 字段。 */
export function benchStatusNote(bench: Bench): string {
  return bench.statusNote ?? bench.blockedReason ?? "";
}

/** 台架上的真实占用槽位数。 */
export function benchOccupancy(bench: Bench): number {
  return bench.assignedIds.length;
}

export function canAssignAccession(accession: Accession, bench: Bench): boolean {
  if (bench.status === "blocked" || bench.status === "quarantine") {
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
  if (bench.status === "blocked") {
    return fail([
      fieldError(
        "benchId",
        "blocked",
        `台架 ${bench.code} 已受限：${benchStatusNote(bench) || "未记录原因"}`,
      ),
    ]);
  }
  if (bench.status === "quarantine") {
    return fail([
      fieldError(
        "benchId",
        "quarantine",
        `台架 ${bench.code} 正在隔离：${benchStatusNote(bench) || "未记录原因"}`,
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
  if (!bench.assignedIds.includes(accessionId)) {
    return fail([
      fieldError(
        "benchId",
        "not_assigned",
        "该材料未分配到该台架",
      ),
    ]);
  }
  const assignedIds = bench.assignedIds.filter((id) => id !== accessionId);
  // 受限 / 隔离属于运维状态，清空台架不能把它悄悄恢复为可用。
  const status: BenchStatus =
    bench.status === "blocked" || bench.status === "quarantine"
      ? bench.status
      : assignedIds.length === 0
        ? "available"
        : "assigned";
  return ok({ ...bench, assignedIds, status });
}

/**
 * 修改光照类型时，使用与材料分配完全相同的兼容性矩阵检查台上已有材料，
 * 避免把在用台架改成与现场材料冲突的光照；只阻断真正冲突的材料。
 */
export function updateBenchLight(
  bench: Bench,
  lightProfile: PreferredLight,
  state: WorkspaceState,
): Result<Bench> {
  if (!LIGHT_PROFILES.includes(lightProfile)) {
    return fail([
      fieldError("lightProfile", "invalid", "请选择支持的光照类型"),
    ]);
  }
  if (bench.lightProfile === lightProfile) {
    return ok(bench);
  }
  const conflicts = lightConflictsForBench(
    bench,
    lightProfile,
    state,
  );
  if (conflicts.length > 0) {
    return fail([
      fieldError(
        "lightProfile",
        "light_conflict",
        `新光照与台上 ${conflicts.length} 个材料冲突：${conflicts
          .map((accession) => `${accession.cultivar}（${accession.accessionNo}）`)
          .join("、")}；请先移出这些材料，或改选其他光照。`,
      ),
    ]);
  }
  return ok({ ...bench, lightProfile });
}

/** 返回在给定光照下会与台架冲突（或已从台账中缺失）的已分配材料。 */
export function lightConflictsForBench(
  bench: Bench,
  lightProfile: PreferredLight,
  state: WorkspaceState,
): Accession[] {
  return bench.assignedIds.flatMap((id) => {
    const accession = state.accessions.find((item) => item.id === id);
    if (!accession) {
      return [];
    }
    return BENCH_LIGHT_COMPATIBILITY[accession.preferredLight].includes(
      lightProfile,
    )
      ? []
      : [accession];
  });
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

// ---------------------------------------------------------------------------
// 台架台账：创建 / 编辑
// ---------------------------------------------------------------------------

export interface BenchDraft {
  code: string;
  sector: string;
  capacity: number;
  lightProfile: PreferredLight;
  irrigationLine: string;
  /** 创建时的初始运维状态；编辑时不允许通过该表单切换状态。 */
  status: BenchOperationalStatus;
  statusNote: string;
}

export function validateBenchDraft(
  draft: BenchDraft,
  state: WorkspaceState,
  current?: Bench,
): Result<Required<Pick<BenchDraft, "statusNote">> & BenchDraft> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  const code = draft.code.trim().toUpperCase();
  if (!BENCH_CODE_PATTERN.test(code)) {
    errors.push(
      fieldError("code", "invalid_format", "请使用类似 E-3 或 NORTH-12 的台架编号"),
    );
  }
  const duplicate = state.benches.find(
    (item) => item.code.trim().toUpperCase() === code && item.id !== current?.id,
  );
  if (duplicate) {
    errors.push(fieldError("code", "duplicate", "该台架编号已被使用"));
  }
  if (draft.sector.trim().length < 2) {
    errors.push(fieldError("sector", "required", "请填写所属区域"));
  }
  if (draft.irrigationLine.trim().length < 2) {
    errors.push(fieldError("irrigationLine", "required", "请填写灌溉管路"));
  }
  if (
    Number.isNaN(draft.capacity) ||
    !Number.isInteger(draft.capacity) ||
    draft.capacity < BENCH_CAPACITY_MIN ||
    draft.capacity > BENCH_CAPACITY_MAX
  ) {
    errors.push(
      fieldError(
        "capacity",
        "range",
        `容量必须是 ${BENCH_CAPACITY_MIN} 到 ${BENCH_CAPACITY_MAX} 之间的整数`,
      ),
    );
  }
  const occupancy = current ? benchOccupancy(current) : 0;
  if (
    !Number.isNaN(draft.capacity) &&
    Number.isInteger(draft.capacity) &&
    draft.capacity < occupancy
  ) {
    errors.push(
      fieldError(
        "capacity",
        "below_occupancy",
        `容量不能低于当前真实占用 ${occupancy} 个槽位`,
      ),
    );
  }
  if (!LIGHT_PROFILES.includes(draft.lightProfile)) {
    errors.push(
      fieldError("lightProfile", "invalid", "请选择支持的光照类型"),
    );
  }
  if (
    current &&
    current.lightProfile !== draft.lightProfile &&
    !errors.some((error) => error.field === "lightProfile")
  ) {
    const conflicts = lightConflictsForBench(current, draft.lightProfile, state);
    if (conflicts.length > 0) {
      errors.push(
        fieldError(
          "lightProfile",
          "light_conflict",
          `新光照与台上 ${conflicts.length} 个材料冲突：${conflicts
            .map((accession) => `${accession.cultivar}（${accession.accessionNo}）`)
            .join("、")}；请先移出这些材料，或改选其他光照。`,
        ),
      );
    }
  }
  // 初始运维状态与原因只在创建时校验；编辑表单不能切换状态。
  if (!current) {
    if (
      draft.status !== "available" &&
      draft.status !== "blocked" &&
      draft.status !== "quarantine"
    ) {
      errors.push(fieldError("status", "invalid", "请选择有效运行状态"));
    }
    const note = draft.statusNote.trim();
    if (draft.status !== "available" && note.length < REASON_MIN_LENGTH) {
      errors.push(
        fieldError(
          "statusNote",
          "required",
          draft.status === "quarantine"
            ? "隔离台架必须记录原因"
            : "受限台架必须记录原因",
        ),
      );
    }
  }
  if (errors.length > 0) {
    return fail(errors);
  }
  return ok({
    ...draft,
    code,
    sector: draft.sector.trim(),
    irrigationLine: draft.irrigationLine.trim(),
    statusNote:
      !current && draft.status !== "available"
        ? draft.statusNote.trim()
        : draft.statusNote,
  });
}

export function createBench(draft: BenchDraft, state: WorkspaceState): Result<Bench> {
  const validated = validateBenchDraft(draft, state);
  if (!validated.ok) {
    return validated;
  }
  const value = validated.value;
  const bench: Bench = {
    id: createId("bench"),
    code: value.code,
    sector: value.sector,
    capacity: value.capacity,
    assignedIds: [],
    lightProfile: value.lightProfile,
    irrigationLine: value.irrigationLine,
    status: value.status,
    statusNote: value.statusNote || undefined,
  };
  if (value.status !== "available") {
    bench.statusHistory = [
      buildStatusRecord("available", value.status, value.statusNote),
    ];
  }
  return ok(bench);
}

export function updateBench(
  current: Bench,
  draft: BenchDraft,
  state: WorkspaceState,
): Result<Bench> {
  const validated = validateBenchDraft(draft, state, current);
  if (!validated.ok) {
    return validated;
  }
  const value = validated.value;
  // 运维状态只能通过 changeBenchStatus 切换，编辑表单保持现有状态不变。
  return ok({
    ...current,
    code: value.code,
    sector: value.sector,
    capacity: value.capacity,
    lightProfile: value.lightProfile,
    irrigationLine: value.irrigationLine,
  });
}

// ---------------------------------------------------------------------------
// 台架运维状态切换（可用 / 受限 / 隔离）
// ---------------------------------------------------------------------------

export function changeBenchStatus(
  current: Bench,
  target: BenchOperationalStatus,
  reason: string,
  state: WorkspaceState,
  nowIso: string = new Date().toISOString(),
): Result<Bench> {
  const from = benchOperationalStatus(current);
  if (from === target) {
    return fail([
      fieldError("status", "unchanged", "台架已经处于该状态"),
    ]);
  }
  const trimmedReason = reason.trim();
  if (target !== "available" && trimmedReason.length < REASON_MIN_LENGTH) {
    return fail([
      fieldError(
        "reason",
        "required",
        target === "quarantine" ? "隔离必须记录原因" : "受限必须记录原因",
      ),
    ]);
  }
  if (target === "available") {
    const issues = validateBenchReady(current, state);
    if (issues.length > 0) {
      return fail(issues);
    }
  }
  const record = buildStatusRecord(from, target, trimmedReason, nowIso);
  const status: BenchStatus =
    target === "available"
      ? current.assignedIds.length > 0
        ? "assigned"
        : "available"
      : target;
  return ok({
    ...current,
    status,
    statusNote: target === "available" ? undefined : trimmedReason,
    blockedReason: undefined,
    statusHistory: [record, ...(current.statusHistory ?? [])],
  });
}

function buildStatusRecord(
  from: BenchOperationalStatus,
  to: BenchOperationalStatus,
  reason: string,
  changedOn: string = new Date().toISOString(),
): BenchStatusRecord {
  return {
    id: createId("bstr"),
    from,
    to,
    reason: reason.trim(),
    changedOn,
  };
}

/**
 * 恢复台架前的现场适配校验，与材料分配共用同一套规则：
 * 容量必须容纳真实占用、已分配材料必须仍在台账中、光照必须仍兼容。
 */
export function validateBenchReady(
  bench: Bench,
  state: WorkspaceState,
): Array<ReturnType<typeof fieldError>> {
  const issues: Array<ReturnType<typeof fieldError>> = [];
  if (bench.assignedIds.length > bench.capacity) {
    issues.push(
      fieldError(
        "capacity",
        "below_occupancy",
        `容量 ${bench.capacity} 小于真实占用 ${bench.assignedIds.length}，请先扩容或移出材料`,
      ),
    );
  }
  bench.assignedIds.forEach((id) => {
    const accession = state.accessions.find((item) => item.id === id);
    if (!accession) {
      issues.push(
        fieldError(
          "assignedIds",
          "missing_accession",
          `台架上的材料 ${id} 已不在材料台账中，请先移出后再恢复`,
        ),
      );
      return;
    }
    if (
      !BENCH_LIGHT_COMPATIBILITY[accession.preferredLight].includes(
        bench.lightProfile,
      )
    ) {
      issues.push(
        fieldError(
          "assignedIds",
          "light_conflict",
          `${accession.cultivar}（${accession.accessionNo}）需要 ${accession.preferredLight} 光照，与台架 ${bench.lightProfile} 不兼容`,
        ),
      );
    }
  });
  return issues;
}

export function benchMatchesQuery(bench: Bench, query: string): boolean {
  const haystack = [
    bench.code,
    bench.sector,
    bench.irrigationLine,
    benchStatusNote(bench),
    ...bench.assignedIds,
  ]
    .join(" ")
    .toLowerCase();
  return !query.trim() || haystack.includes(query.toLowerCase());
}
