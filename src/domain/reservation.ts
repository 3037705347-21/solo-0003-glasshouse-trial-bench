import type {
  Accession,
  Bench,
  BenchReservation,
  BenchStatus,
  PreferredLight,
  ReservationVerdict,
  WorkspaceState,
} from "./types";
import { createId } from "./id";
import { BENCH_LIGHT_COMPATIBILITY } from "./rules";
import {
  eachDateInclusive,
  parseDateOnly,
  windowsOverlap,
  type DateWindow,
} from "./rules";
import { fail, fieldError, ok, type Result } from "./result";

/* ------------------------------------------------------------------ */
/* 日期窗口与占用模型                                                    */
/* ------------------------------------------------------------------ */

function reservationWindow(
  reservation: BenchReservation,
): DateWindow | null {
  if (
    !parseDateOnly(reservation.startDate) ||
    !parseDateOnly(reservation.endDate) ||
    reservation.startDate > reservation.endDate
  ) {
    return null;
  }
  return {
    startDate: reservation.startDate,
    endDate: reservation.endDate,
  };
}

function accessionWindow(
  state: WorkspaceState,
  accession: Accession,
): DateWindow | null {
  const trial = state.trials.find((item) => item.id === accession.trialId);
  if (
    !trial ||
    !parseDateOnly(trial.startDate) ||
    !parseDateOnly(trial.endDate)
  ) {
    return null;
  }
  return { startDate: trial.startDate, endDate: trial.endDate };
}

function withinWindow(date: string, window: DateWindow): boolean {
  return date >= window.startDate && date <= window.endDate;
}

/** 某天台架上的真实材料占用数；查不到试验窗口的材料按全程占用处理（更安全）。 */
function realCountOn(
  bench: Bench,
  state: WorkspaceState,
  date: string,
): number {
  return bench.assignedIds.reduce((count, accessionId) => {
    const accession = state.accessions.find((item) => item.id === accessionId);
    const window = accession ? accessionWindow(state, accession) : null;
    if (!window || withinWindow(date, window)) {
      return count + 1;
    }
    return count;
  }, 0);
}

/** 该预留当前确实在架的履约材料 ID（未匹配到台架/材料的历史记录会被剔除）。 */
function consumedAccessionsOnBench(
  reservation: BenchReservation,
  bench: Bench | undefined,
): Set<string> {
  if (!bench) {
    return new Set();
  }
  return new Set(
    reservation.consumedAccessionIds.filter((accessionId) =>
      bench.assignedIds.includes(accessionId),
    ),
  );
}

/**
 * 按试验归集某天台架上真实材料占用的试验编号。
 * excludeAccessionIds 中的材料（通常是该预留自己已消耗的履约材料）不计入，
 * 但同试验先于预留存在、未消耗预留的真实材料仍然作为竞争方保留。
 */
function realTrialGroupsOn(
  bench: Bench,
  state: WorkspaceState,
  date: string,
  excludeAccessionIds: Set<string> = new Set(),
): Map<string, string> {
  const groups = new Map<string, string>();
  bench.assignedIds.forEach((accessionId) => {
    if (excludeAccessionIds.has(accessionId)) {
      return;
    }
    const accession = state.accessions.find((item) => item.id === accessionId);
    if (!accession) {
      return;
    }
    const window = accessionWindow(state, accession);
    if (window && !withinWindow(date, window)) {
      return;
    }
    const trial = state.trials.find((item) => item.id === accession.trialId);
    if (trial) {
      groups.set(trial.id, trial.code);
    }
  });
  return groups;
}

/** 某天该预留已被实际材料履约的槽位数（材料仍在该台架、试验窗口覆盖当天）。 */
function consumedAt(
  reservation: BenchReservation,
  state: WorkspaceState,
  bench: Bench | undefined,
  date: string,
): number {
  if (!bench || reservation.status === "cancelled") {
    return 0;
  }
  return reservation.consumedAccessionIds.reduce((count, accessionId) => {
    if (!bench.assignedIds.includes(accessionId)) {
      return count;
    }
    const accession = state.accessions.find((item) => item.id === accessionId);
    if (!accession || accession.trialId !== reservation.trialId) {
      return count;
    }
    const window = accessionWindow(state, accession);
    if (!window || withinWindow(date, window)) {
      return count + 1;
    }
    return count;
  }, 0);
}

/** 该预留当前仍在台架上的履约材料数（与日期无关）。 */
export function fulfilledSlotCount(
  reservation: BenchReservation,
  state: WorkspaceState,
): number {
  const bench = state.benches.find((item) => item.id === reservation.benchId);
  if (!bench) {
    return 0;
  }
  return reservation.consumedAccessionIds.reduce((count, accessionId) => {
    if (!bench.assignedIds.includes(accessionId)) {
      return count;
    }
    const accession = state.accessions.find((item) => item.id === accessionId);
    if (!accession || accession.trialId !== reservation.trialId) {
      return count;
    }
    return count + 1;
  }, 0);
}

/** 某天该预留仍持有的未履约槽位数；取消的预留不占位。 */
function heldAt(
  reservation: BenchReservation,
  state: WorkspaceState,
  bench: Bench | undefined,
  date: string,
): number {
  if (!bench || reservation.status === "cancelled") {
    return 0;
  }
  const window = reservationWindow(reservation);
  if (!window || !withinWindow(date, window)) {
    return 0;
  }
  return Math.max(0, reservation.slots - consumedAt(reservation, state, bench, date));
}

/* ------------------------------------------------------------------ */
/* 预留重新判定（有效 / 冲突 / 失效）                                    */
/* ------------------------------------------------------------------ */

export type ReservationInvalidReason =
  | "missing_trial"
  | "missing_bench"
  | "invalid_window"
  | "bench_unavailable"
  | "sector_changed"
  | "light_changed"
  | "capacity_shrunk";

export const RESERVATION_INVALID_REASONS: Record<
  ReservationInvalidReason,
  string
> = {
  missing_trial: "关联试验已被删除，预留无法继续生效",
  missing_bench: "关联台架已被删除，预留无法继续生效",
  invalid_window: "预留日期无效，请重新登记",
  bench_unavailable: "台架已转入停用或隔离维护状态",
  sector_changed: "台架区域已调整，与预留登记时不一致",
  light_changed: "台架光照已调整，与预留登记时不一致",
  capacity_shrunk: "台架容量已下调到预留槽位以下",
};

export interface ReservationConflictGroup {
  kind: "reservation" | "trial";
  label: string;
}

export interface ReservationEvaluation {
  reservation: BenchReservation;
  verdict: ReservationVerdict;
  reasons: ReservationInvalidReason[];
  /** 当前已履约槽位数。 */
  consumedSlots: number;
  /** 当前仍持有的槽位数（slots - 已履约）。 */
  heldSlots: number;
  /** 造成容量冲突的其他预留或试验。 */
  conflicts: ReservationConflictGroup[];
}

function structuralReasons(
  reservation: BenchReservation,
  state: WorkspaceState,
  bench: Bench | undefined,
): ReservationInvalidReason[] {
  const trial = state.trials.find((item) => item.id === reservation.trialId);
  if (!trial) {
    return ["missing_trial"];
  }
  if (!bench) {
    return ["missing_bench"];
  }
  if (!reservationWindow(reservation)) {
    return ["invalid_window"];
  }
  if (bench.status === "blocked" || bench.status === "quarantine") {
    return ["bench_unavailable"];
  }
  if (bench.sector !== reservation.sectorSnapshot) {
    return ["sector_changed"];
  }
  if (bench.lightProfile !== reservation.lightProfileSnapshot) {
    return ["light_changed"];
  }
  if (reservation.slots > bench.capacity) {
    return ["capacity_shrunk"];
  }
  return [];
}

function evaluateBench(
  state: WorkspaceState,
  bench: Bench,
  reservations: BenchReservation[],
): ReservationEvaluation[] {
  const active = reservations.filter(
    (reservation) => reservation.status !== "cancelled",
  );

  const analyzed = active.map((reservation) => {
    const reasons = structuralReasons(reservation, state, bench);
    const consumedSlots = fulfilledSlotCount(reservation, state);
    return {
      reservation,
      reasons,
      consumedSlots,
      effective: reasons.length === 0,
    };
  });

  // 有效的持有者（含后来被判为冲突的）；失效预留不参与任何容量计算。
  const holders = analyzed.filter((item) => item.effective);

  // 汇总所有持有窗口内的日期。
  const dateSet = new Set<string>();
  holders.forEach((item) => {
    const window = reservationWindow(item.reservation);
    if (window) {
      eachDateInclusive(window).forEach((date) => dateSet.add(date));
    }
  });

  const conflictMap = new Map<string, Set<string>>();
  const conflictGroups = new Map<string, ReservationConflictGroup[]>();

  dateSet.forEach((date) => {
    const holdings = holders.map((item) => ({
      item,
      held: heldAt(item.reservation, state, bench, date),
    }));
    const real = realCountOn(bench, state, date);

    holdings.forEach(({ item, held }) => {
      if (held === 0) {
        return;
      }
      const reservedLoad = holdings.reduce(
        (total, entry) => total + entry.held,
        0,
      );
      if (real + reservedLoad <= bench.capacity) {
        return;
      }
      const id = item.reservation.id;
      if (!conflictMap.has(id)) {
        conflictMap.set(id, new Set());
        conflictGroups.set(id, []);
      }
      const ownTrial = item.reservation.trialId;
      // 只排除该预留自己已消耗的履约材料；同试验其他在架真实材料仍会竞争容量。
      const ownConsumed = consumedAccessionsOnBench(
        item.reservation,
        bench,
      );
      const realGroups = realTrialGroupsOn(
        bench,
        state,
        date,
        ownConsumed,
      );
      holdings.forEach((entry) => {
        if (entry.item.reservation.id === id || entry.held === 0) {
          return;
        }
        const trial = state.trials.find(
          (candidate) => candidate.id === entry.item.reservation.trialId,
        );
        const key = `reservation:${entry.item.reservation.id}`;
        if (!conflictMap.get(id)?.has(key)) {
          conflictMap.get(id)?.add(key);
          conflictGroups.get(id)?.push({
            kind: "reservation",
            label: `预留 ${entry.item.reservation.code}（试验 ${trial?.code ?? "未知"}）`,
          });
        }
      });
      realGroups.forEach((trialCode, trialId) => {
        const isOwnTrial = trialId === ownTrial;
        const key = `trial:${trialId}:${isOwnTrial ? "own" : "other"}`;
        if (!conflictMap.get(id)?.has(key)) {
          conflictMap.get(id)?.add(key);
          conflictGroups.get(id)?.push({
            kind: "trial",
            label: isOwnTrial
              ? `试验 ${trialCode} 先于本预留占用的实际材料（未消耗本预留）`
              : `试验 ${trialCode} 已实际分配的材料`,
          });
        }
      });
    });
  });

  return analyzed.map((item) => {
    const { reservation, reasons, consumedSlots } = item;
    let verdict: ReservationVerdict;
    if (reasons.length > 0) {
      verdict = "invalid";
    } else if (conflictMap.has(reservation.id)) {
      verdict = "conflict";
    } else {
      verdict = "valid";
    }
    return {
      reservation,
      verdict,
      reasons,
      consumedSlots,
      heldSlots: Math.max(0, reservation.slots - consumedSlots),
      conflicts: conflictGroups.get(reservation.id) ?? [],
    };
  });
}

/** 重新判定全部（或指定台架的）预留。取消的预留单独返回 cancelled 判定。 */
export function evaluateReservations(
  state: WorkspaceState,
  benchId?: string,
): Map<string, ReservationEvaluation> {
  const result = new Map<string, ReservationEvaluation>();
  const benches = benchId
    ? state.benches.filter((bench) => bench.id === benchId)
    : state.benches;

  benches.forEach((bench) => {
    const reservations = state.reservations.filter(
      (reservation) => reservation.benchId === bench.id,
    );
    evaluateBench(state, bench, reservations).forEach((evaluation) => {
      result.set(evaluation.reservation.id, evaluation);
    });
  });

  // 非活动（已取消）的预留不依赖台架状态，直接给 cancelled 判定。
  state.reservations
    .filter((reservation) => reservation.status === "cancelled")
    .forEach((reservation) => {
      if (benchId && reservation.benchId !== benchId) {
        return;
      }
      result.set(reservation.id, {
        reservation,
        verdict: "cancelled",
        reasons: [],
        consumedSlots: fulfilledSlotCount(reservation, state),
        heldSlots: 0,
        conflicts: [],
      });
    });

  return result;
}

export function evaluateReservation(
  state: WorkspaceState,
  reservationId: string,
): ReservationEvaluation | undefined {
  return evaluateReservations(state).get(reservationId);
}

/* ------------------------------------------------------------------ */
/* 计划期间的台架可分配空间                                              */
/* ------------------------------------------------------------------ */

export interface BenchDayLoad {
  date: string;
  real: number;
  held: number;
  load: number;
  free: number;
}

export interface BenchCapacityPlan {
  bench: Bench;
  days: BenchDayLoad[];
  minFree: number;
  peakLoad: number;
  peakDate: string;
  evaluations: ReservationEvaluation[];
}

export function planBenchCapacity(
  state: WorkspaceState,
  window: DateWindow,
  bench: Bench,
): BenchCapacityPlan {
  const evaluations = evaluateReservations(state, bench.id);
  const activeHolders = [...evaluations.values()].filter(
    (evaluation) =>
      evaluation.verdict === "valid" || evaluation.verdict === "conflict",
  );
  const days: BenchDayLoad[] = eachDateInclusive(window).map((date) => {
    const real = realCountOn(bench, state, date);
    const held = activeHolders.reduce(
      (total, evaluation) =>
        total +
        heldAt(evaluation.reservation, state, bench, date),
      0,
    );
    const load = real + held;
    return {
      date,
      real,
      held,
      load,
      free: Math.max(0, bench.capacity - load),
    };
  });
  const peak = days.reduce(
    (best, day) => (day.load > best.load ? day : best),
    days[0] ?? { date: window.startDate, real: 0, held: 0, load: 0, free: bench.capacity },
  );
  const minFree = days.reduce(
    (minimum, day) => Math.min(minimum, day.free),
    bench.capacity,
  );
  return {
    bench,
    days,
    minFree,
    peakLoad: peak.load,
    peakDate: peak.date,
    evaluations: [...evaluations.values()],
  };
}

/** 覆盖所有试验与有效预留的整体计划窗口。 */
export function overallPlanningWindow(state: WorkspaceState): DateWindow {
  const windows: DateWindow[] = [];
  state.trials.forEach((trial) => {
    if (parseDateOnly(trial.startDate) && parseDateOnly(trial.endDate)) {
      windows.push({ startDate: trial.startDate, endDate: trial.endDate });
    }
  });
  state.reservations.forEach((reservation) => {
    const window = reservationWindow(reservation);
    if (window) {
      windows.push(window);
    }
  });
  if (windows.length === 0) {
    return { startDate: "2026-01-01", endDate: "2026-12-31" };
  }
  const startDate = windows
    .map((item) => item.startDate)
    .sort((left, right) => left.localeCompare(right))[0];
  const endDate = windows
    .map((item) => item.endDate)
    .sort((left, right) => right.localeCompare(left))[0];
  return { startDate, endDate };
}

/* ------------------------------------------------------------------ */
/* 登记预留                                                            */
/* ------------------------------------------------------------------ */

export interface ReservationDraft {
  trialId: string;
  benchId: string;
  startDate: string;
  endDate: string;
  slots: number;
  note: string;
  requestKey: string;
}

export interface CreatedReservation {
  reservation: BenchReservation;
  evaluation: ReservationEvaluation;
  duplicate: boolean;
}

export function nextReservationNumber(state: WorkspaceState): string {
  const largest = state.reservations.reduce((max, item) => {
    const match = /^RSV-(\d+)$/.exec(item.code);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `RSV-${String(largest + 1).padStart(4, "0")}`;
}

export function createReservation(
  draft: ReservationDraft,
  state: WorkspaceState,
): Result<CreatedReservation> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  const trial = state.trials.find((item) => item.id === draft.trialId);
  const bench = state.benches.find((item) => item.id === draft.benchId);

  if (!trial) {
    errors.push(fieldError("trialId", "required", "请选择有效试验"));
  }
  if (!bench) {
    errors.push(fieldError("benchId", "required", "请选择台架"));
  }
  if (!parseDateOnly(draft.startDate)) {
    errors.push(fieldError("startDate", "invalid_date", "开始日期无效"));
  }
  if (!parseDateOnly(draft.endDate)) {
    errors.push(fieldError("endDate", "invalid_date", "结束日期无效"));
  }
  if (
    parseDateOnly(draft.startDate) &&
    parseDateOnly(draft.endDate) &&
    draft.startDate > draft.endDate
  ) {
    errors.push(
      fieldError("endDate", "date_sequence", "结束日期不能早于开始日期"),
    );
  }
  if (
    Number.isNaN(draft.slots) ||
    !Number.isInteger(draft.slots) ||
    draft.slots < 1
  ) {
    errors.push(
      fieldError("slots", "range", "预留槽位数必须是不小于 1 的整数"),
    );
  }
  if (bench && draft.slots > bench.capacity) {
    errors.push(
      fieldError(
        "slots",
        "exceeds_capacity",
        `台架 ${bench.code} 总容量仅 ${bench.capacity} 个槽位`,
      ),
    );
  }
  if (bench?.status === "blocked") {
    errors.push(
      fieldError(
        "benchId",
        "blocked",
        `台架 ${bench.code} 已停用：${bench.blockedReason ?? "未记录原因"}`,
      ),
    );
  }
  if (bench?.status === "quarantine") {
    errors.push(
      fieldError("benchId", "quarantine", `台架 ${bench.code} 正在隔离`),
    );
  }
  if (!draft.requestKey.trim()) {
    errors.push(fieldError("requestKey", "missing", "缺少请求标识，无法防重复"));
  }
  if (errors.length > 0) {
    return fail(errors);
  }

  // 幂等：同一请求键（且未取消）重复提交直接返回原预留，不多占容量。
  const existing = state.reservations.find(
    (item) =>
      item.requestKey === draft.requestKey.trim() &&
      item.status !== "cancelled",
  );
  if (existing) {
    const nextState: WorkspaceState = { ...state };
    const evaluation = evaluateReservation(nextState, existing.id);
    if (!evaluation) {
      return fail([
        fieldError("requestKey", "evaluate_failed", "预留判定失败"),
      ]);
    }
    return ok({ reservation: existing, evaluation, duplicate: true });
  }

  const reservation: BenchReservation = {
    id: createId("rsv"),
    code: nextReservationNumber(state),
    requestKey: draft.requestKey.trim(),
    trialId: draft.trialId,
    benchId: draft.benchId,
    startDate: draft.startDate,
    endDate: draft.endDate,
    slots: draft.slots,
    note: draft.note.trim(),
    status: "active",
    consumedAccessionIds: [],
    bookedOn: new Date().toISOString(),
    benchCode: bench!.code,
    sectorSnapshot: bench!.sector,
    lightProfileSnapshot: bench!.lightProfile,
    benchStatusSnapshot: bench!.status,
  };

  const nextState: WorkspaceState = {
    ...state,
    reservations: [...state.reservations, reservation],
  };
  const evaluation = evaluateReservation(nextState, reservation.id);
  if (!evaluation) {
    return fail([fieldError("benchId", "evaluate_failed", "预留判定失败")]);
  }
  return ok({ reservation, evaluation, duplicate: false });
}

/* ------------------------------------------------------------------ */
/* 取消预留：不触碰任何已实际分配的材料                                  */
/* ------------------------------------------------------------------ */

export function cancelReservation(
  state: WorkspaceState,
  reservationId: string,
): Result<BenchReservation> {
  const reservation = state.reservations.find(
    (item) => item.id === reservationId,
  );
  if (!reservation) {
    return fail([fieldError("reservationId", "not_found", "预留不存在")]);
  }
  if (reservation.status === "cancelled") {
    return fail([
      fieldError("reservationId", "already_cancelled", "该预留已经取消"),
    ]);
  }
  return ok({ ...reservation, status: "cancelled" as const });
}

/* ------------------------------------------------------------------ */
/* 实际分配消耗预留                                                     */
/* ------------------------------------------------------------------ */

export interface AssignmentPlan {
  bench: Bench;
  consumedReservation: BenchReservation | null;
}

function conflictLabels(
  labels: ReservationConflictGroup[],
): string {
  if (labels.length === 0) {
    return "无其他冲突预留";
  }
  const names = labels.map((group) => group.label);
  const head = names.slice(0, 4).join("、");
  return names.length > 4 ? `${head} 等 ${names.length} 项` : head;
}

/**
 * 分配材料到台架：优先消耗同试验、时间窗重叠的有效（含冲突中）预留，
 * 消耗预留时净占用为 0；没有可消耗预留时按真实占用登记。
 * 任意一天突破总容量都会被拒绝，并指出与哪些试验/预留重叠。
 */
export function planAssignment(
  state: WorkspaceState,
  accessionId: string,
  benchId: string,
): Result<AssignmentPlan> {
  const accession = state.accessions.find((item) => item.id === accessionId);
  const bench = state.benches.find((item) => item.id === benchId);
  if (!accession) {
    return fail([fieldError("accessionId", "not_found", "材料不存在")]);
  }
  if (!bench) {
    return fail([fieldError("benchId", "not_found", "台架不存在")]);
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
      fieldError("benchId", "quarantine", `台架 ${bench.code} 正在隔离`),
    ]);
  }
  const occupiedBench = state.benches.find((candidate) =>
    candidate.assignedIds.includes(accession.id),
  );
  if (occupiedBench) {
    return fail([
      fieldError(
        "benchId",
        "duplicate",
        occupiedBench.id === bench.id
          ? "该材料已经分配到该台架"
          : `该材料已分配到台架 ${occupiedBench.code}，请先移出再改派`,
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

  const window = accessionWindow(state, accession);
  // 缺少可识别的试验窗口时退化为即时容量判断（不消耗预留）。
  if (!window) {
    if (bench.assignedIds.length >= bench.capacity) {
      return fail([
        fieldError("benchId", "capacity", `台架 ${bench.code} 没有空位`),
      ]);
    }
    return ok({
      bench: {
        ...bench,
        assignedIds: [...bench.assignedIds, accession.id],
        status: "assigned",
      },
      consumedReservation: null,
    });
  }

  const evaluations = evaluateReservations(state, bench.id);
  const candidates = [...evaluations.values()]
    .filter(
      (evaluation) =>
        (evaluation.verdict === "valid" ||
          evaluation.verdict === "conflict") &&
        evaluation.reservation.trialId === accession.trialId &&
        windowsOverlap(
          {
            startDate: evaluation.reservation.startDate,
            endDate: evaluation.reservation.endDate,
          },
          window,
        ) &&
        evaluation.heldSlots > 0,
    )
    .map((evaluation) => evaluation.reservation)
    .sort(
      (left, right) =>
        left.endDate.localeCompare(right.endDate) ||
        left.bookedOn.localeCompare(right.bookedOn),
    );

  const days = eachDateInclusive(window);

  const feasibleWithout = days.every((date) => {
    const real = realCountOn(bench, state, date);
    const held = [...evaluations.values()]
      .filter(
        (evaluation) =>
          evaluation.verdict === "valid" || evaluation.verdict === "conflict",
      )
      .reduce(
        (total, evaluation) =>
          total + heldAt(evaluation.reservation, state, bench, date),
        0,
      );
    return real + 1 + held <= bench.capacity;
  });

  for (const candidate of candidates) {
    const candidateWindow = reservationWindow(candidate)!;
    const feasible = days.every((date) => {
      const real = realCountOn(bench, state, date) + 1;
      const held = [...evaluations.values()]
        .filter(
          (evaluation) =>
            evaluation.verdict === "valid" ||
            evaluation.verdict === "conflict",
        )
        .reduce((total, evaluation) => {
          let value = heldAt(
            evaluation.reservation,
            state,
            bench,
            date,
          );
          if (evaluation.reservation.id === candidate.id) {
            // 消耗该预留：重叠日净占用为 0，预留少持有 1 个槽位。
            value = withinWindow(date, candidateWindow)
              ? Math.max(0, value - 1)
              : value;
          }
          return total + value;
        }, 0);
      return real + held <= bench.capacity;
    });
    if (feasible) {
      const updatedReservation: BenchReservation = {
        ...candidate,
        consumedAccessionIds: Array.from(
          new Set([...candidate.consumedAccessionIds, accession.id]),
        ),
      };
      return ok({
        bench: {
          ...bench,
          assignedIds: [...bench.assignedIds, accession.id],
          status: "assigned",
        },
        consumedReservation: updatedReservation,
      });
    }
  }

  if (feasibleWithout) {
    return ok({
      bench: {
        ...bench,
        assignedIds: [...bench.assignedIds, accession.id],
        status: "assigned",
      },
      consumedReservation: null,
    });
  }

  // 汇总容量突破当天的重叠预留/试验，给出明确冲突方。
  const blockerLabels = new Map<string, ReservationConflictGroup>();
  const consumedOnBench = new Set(
    state.reservations
      .filter(
        (reservation) =>
          reservation.benchId === bench.id &&
          reservation.status !== "cancelled",
      )
      .flatMap((reservation) => reservation.consumedAccessionIds)
      .filter((accessionId) => bench.assignedIds.includes(accessionId)),
  );
  days.forEach((date) => {
    const real = realCountOn(bench, state, date);
    const holdings = [...evaluations.values()]
      .filter(
        (evaluation) =>
          evaluation.verdict === "valid" ||
          evaluation.verdict === "conflict",
      )
      .map((evaluation) => ({
        evaluation,
        held: heldAt(evaluation.reservation, state, bench, date),
      }));
    const held = holdings.reduce((total, item) => total + item.held, 0);
    if (real + 1 + held <= bench.capacity) {
      return;
    }
    holdings.forEach(({ evaluation: current, held: heldValue }) => {
      if (heldValue === 0) {
        return;
      }
      const trial = state.trials.find(
        (item) => item.id === current.reservation.trialId,
      );
      blockerLabels.set(`reservation:${current.reservation.id}`, {
        kind: "reservation",
        label: `预留 ${current.reservation.code}（试验 ${trial?.code ?? "未知"}）`,
      });
    });
    realTrialGroupsOn(bench, state, date, consumedOnBench).forEach(
      (trialCode, trialId) => {
        const isOwnTrial = trialId === accession.trialId;
        blockerLabels.set(
          `trial:${trialId}:${isOwnTrial ? "own" : "other"}`,
          {
            kind: "trial",
            label: isOwnTrial
              ? `试验 ${trialCode} 已在该台架上的实际材料（未消耗预留）`
              : `试验 ${trialCode} 已实际分配的材料`,
          },
        );
      },
    );
  });

  return fail([
    fieldError(
      "benchId",
      "capacity",
      `台架 ${bench.code} 在试验期间没有可分配空间；重叠冲突：${conflictLabels([
        ...blockerLabels.values(),
      ])}`,
    ),
  ]);
}

/* ------------------------------------------------------------------ */
/* 台架维护：容量 / 状态 / 区域 / 光照调整（旧预留随后重新判定）          */
/* ------------------------------------------------------------------ */

/** UI 用：材料当前是否可以分配到该台架（考虑预留消耗与跨期容量）。 */
export function canAssignAccessionToBench(
  state: WorkspaceState,
  accessionId: string,
  benchId: string,
): boolean {
  return planAssignment(state, accessionId, benchId).ok;
}

export interface BenchDraft {
  sector: string;
  capacity: number;
  lightProfile: PreferredLight;
  status: BenchStatus;
  blockedReason?: string;
}

export const BENCH_STATUS_OPTIONS: BenchStatus[] = [
  "available",
  "assigned",
  "blocked",
  "quarantine",
];

export function editBench(current: Bench, draft: BenchDraft): Result<Bench> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  if (!draft.sector.trim()) {
    errors.push(fieldError("sector", "required", "请填写区域"));
  }
  if (
    Number.isNaN(draft.capacity) ||
    !Number.isInteger(draft.capacity) ||
    draft.capacity < 1
  ) {
    errors.push(
      fieldError("capacity", "range", "容量必须是不小于 1 的整数"),
    );
  }
  if (draft.capacity < current.assignedIds.length) {
    errors.push(
      fieldError(
        "capacity",
        "assigned",
        `台架上已有 ${current.assignedIds.length} 份实际材料，容量不能低于该数`,
      ),
    );
  }
  if (
    current.assignedIds.length > 0 &&
    draft.lightProfile !== current.lightProfile
  ) {
    errors.push(
      fieldError(
        "lightProfile",
        "assigned",
        "请先移出台架上的材料，再修改光照类型",
      ),
    );
  }
  if (!BENCH_STATUS_OPTIONS.includes(draft.status)) {
    errors.push(fieldError("status", "invalid", "请选择有效运行状态"));
  }
  if (errors.length > 0) {
    return fail(errors);
  }
  return ok({
    ...current,
    sector: draft.sector.trim(),
    capacity: draft.capacity,
    lightProfile: draft.lightProfile,
    status: draft.status,
    blockedReason:
      draft.status === "blocked" ? draft.blockedReason?.trim() || "维护中" : undefined,
  });
}
