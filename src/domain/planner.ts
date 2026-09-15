import type {
  Accession,
  AllocationPlan,
  AllocationPlanItem,
  Bench,
  PlanItemReason,
  PlanTradeoff,
  PlanUnplaced,
  PlanningPolicy,
  PriorityOverride,
  Trial,
  WorkspaceState,
} from "./types";
import { BENCH_LIGHT_COMPATIBILITY } from "./rules";
import { createId } from "./id";
import { isAccessionRetired } from "./accession";
import { assignAccession, releaseAccession } from "./bench";
import { fail, fieldError, ok, type Result } from "./result";

export const PLANNER_ALGORITHM_VERSION = 1;

/* ------------------------------------------------------------------ */
/* 确定性工具：规范化指纹 —— 同输入必得同输出，且可检测“世界是否变化” */
/* ------------------------------------------------------------------ */

function stableClone(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableClone);
  }
  if (value && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = stableClone((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(stableClone(value));
}

function fnvHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * 参与规划的全部输入：范围内试验、相关材料（光照/生命周期）、
 * 所有共享台架（含范围外占用，因为台架是跨批共享资源）以及策略。
 * createdAt 等元数据刻意排除，保证同态输入同指纹。
 */
export function planningFingerprint(
  state: Pick<WorkspaceState, "trials" | "accessions" | "benches">,
  policy: PlanningPolicy,
): string {
  const scope = new Set(policy.scopeTrialIds);
  const payload = {
    v: PLANNER_ALGORITHM_VERSION,
    policy: stableClone(policy),
    trials: state.trials
      .filter((trial) => scope.has(trial.id))
      .map((trial) => ({
        id: trial.id,
        state: trial.state,
        startDate: trial.startDate,
        endDate: trial.endDate,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    accessions: state.accessions
      .filter((accession) => scope.has(accession.trialId))
      .map((accession) => ({
        id: accession.id,
        trialId: accession.trialId,
        accessionNo: accession.accessionNo,
        preferredLight: accession.preferredLight,
        lifecycleStatus: accession.lifecycleStatus,
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
    benches: state.benches
      .map((bench) => ({
        id: bench.id,
        code: bench.code,
        sector: bench.sector,
        capacity: bench.capacity,
        status: bench.status,
        lightProfile: bench.lightProfile,
        reservedSlots: bench.reservedSlots ?? 0,
        maintenance: (bench.maintenance ?? []).map((window) => ({
          from: window.from,
          to: window.to,
        })),
        assignedIds: [...bench.assignedIds].sort(),
      }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };
  return fnvHash(canonicalJson(payload));
}

/* ------------------------------------------------------------------ */
/* 业务边界：硬约束（永远不越过）                                       */
/* ------------------------------------------------------------------ */

export function isBenchServicable(bench: Bench): boolean {
  return bench.status === "available" || bench.status === "assigned";
}

export function isLightCompatible(accession: Accession, bench: Bench): boolean {
  return BENCH_LIGHT_COMPATIBILITY[accession.preferredLight].includes(
    bench.lightProfile,
  );
}

export function windowsOverlap(
  window: { from: string; to: string },
  horizon: { from: string; to: string },
): boolean {
  return !(window.to < horizon.from || window.from > horizon.to);
}

export function benchUnderMaintenance(
  bench: Bench,
  policy: PlanningPolicy,
): { active: boolean; reason?: string } {
  const hit = (bench.maintenance ?? []).find((window) =>
    windowsOverlap(window, {
      from: policy.horizonFrom,
      to: policy.horizonTo,
    }),
  );
  return hit ? { active: true, reason: hit.reason } : { active: false };
}

/**
 * 有效可分配容量：物理容量减去预留缓冲。缓冲是软策略，
 * 仅用于排序与预警；物理容量本身是硬上限。
 */
export function effectiveCapacity(bench: Bench, policy: PlanningPolicy): number {
  const reserved = policy.reservedSlotsEnabled ? bench.reservedSlots ?? 0 : 0;
  return Math.max(0, bench.capacity - reserved);
}

function targetBenchFeasible(
  bench: Bench,
  accession: Accession,
  occupancy: Map<string, number>,
  policy: PlanningPolicy,
): boolean {
  if (!isBenchServicable(bench) || !isLightCompatible(accession, bench)) {
    return false;
  }
  if (benchUnderMaintenance(bench, policy).active) {
    return false;
  }
  return (occupancy.get(bench.id) ?? 0) < bench.capacity;
}

/** 既有分配是否可以原地保留（现场稳定性优先）。 */
function stayFeasible(
  bench: Bench,
  accession: Accession,
  policy: PlanningPolicy,
): boolean {
  if (!isBenchServicable(bench) || !isLightCompatible(accession, bench)) {
    return false;
  }
  if (policy.relocateFromMaintenance && benchUnderMaintenance(bench, policy).active) {
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* 优先级：人工覆盖 > 试验状态（不依赖时钟，结果可复现）                */
/* ------------------------------------------------------------------ */

export type EffectivePriority = "high" | "normal" | "low";

const PRIORITY_RANK: Record<EffectivePriority, number> = {
  high: 0,
  normal: 1,
  low: 2,
};

export function effectivePriority(
  trial: Trial,
  policy: PlanningPolicy,
): EffectivePriority {
  const override: PriorityOverride | undefined =
    policy.priorityOverrides[trial.id];
  if (override) {
    return override;
  }
  if (trial.state === "active" || trial.state === "paused") {
    return "high";
  }
  if (trial.state === "cleared") {
    return "low";
  }
  return "normal";
}

export function describePriority(priority: EffectivePriority): string {
  if (priority === "high") {
    return "高（进行中/暂停中的批次）";
  }
  if (priority === "low") {
    return "低（已放行批次）";
  }
  return "常规（草稿批次）";
}

/* ------------------------------------------------------------------ */
/* 规划器                                                              */
/* ------------------------------------------------------------------ */

interface PlacementTask {
  accession: Accession;
  source?: Bench;
  forced: boolean;
  evictReason?: PlanItemReason;
  priority: EffectivePriority;
}

function reason(code: string, message: string): PlanItemReason {
  return { code, message };
}

function currentBenchMap(benches: Bench[]): Map<string, Bench> {
  const map = new Map<string, Bench>();
  benches
    .slice()
    .sort((a, b) => a.code.localeCompare(b.code))
    .forEach((bench) => {
      bench.assignedIds.forEach((accessionId) => {
        if (!map.has(accessionId)) {
          map.set(accessionId, bench);
        }
      });
    });
  return map;
}

function describeBench(bench: Bench): string {
  return `${bench.code}（${bench.sector}）`;
}

export function nextPlanCode(plans: AllocationPlan[]): string {
  const largest = plans.reduce((max, plan) => {
    const match = /^PLAN-(\d+)$/.exec(plan.code);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
  return `PLAN-${String(largest + 1).padStart(3, "0")}`;
}

/**
 * 离线多批次分配规划。
 *
 * 取舍原则（冲突时由规划器按此裁决，并写入 tradeoffs）：
 * 1. 硬约束绝不越过：停用材料不分配；停用/隔离/维修台架不接收新材料；
 *    光照必须兼容；物理容量是硬上限；一份材料只在一个台架。
 * 2. 现场稳定优先于优先级：既有合法分配一律保留，规划器绝不驱逐
 *    已在场（含更低优先级批次）的材料来腾位。
 * 3. 只有维修/隔离/停用等硬原因才触发迁移；迁移目标就近同批聚拢。
 * 4. 预留缓冲默认保留，只有在不如此则高优先级材料无处可放时才动用，
 *    并逐条+计划级预警。
 * 5. 仍放不下的材料标记 unplaced，而不是降低硬约束强行塞入。
 */
export function planAllocations(
  state: WorkspaceState,
  policy: PlanningPolicy,
  createdAt: string,
  existingPlans: AllocationPlan[] = [],
): AllocationPlan {
  const trialById = new Map(state.trials.map((trial) => [trial.id, trial]));
  const accessionById = new Map(
    state.accessions.map((accession) => [accession.id, accession]),
  );
  const scopedTrialIds = new Set(
    policy.scopeTrialIds.filter((id) => trialById.has(id)),
  );

  const occupancy = new Map<string, number>();
  const cohesion = new Map<string, Map<string, number>>();
  state.benches.forEach((bench) => {
    occupancy.set(bench.id, bench.assignedIds.length);
    const trialCounts = new Map<string, number>();
    bench.assignedIds.forEach((accessionId) => {
      const occupant = accessionById.get(accessionId);
      if (occupant) {
        trialCounts.set(
          occupant.trialId,
          (trialCounts.get(occupant.trialId) ?? 0) + 1,
        );
      }
    });
    cohesion.set(bench.id, trialCounts);
  });

  const assignedBench = currentBenchMap(state.benches);

  const items: AllocationPlanItem[] = [];
  const tasks: PlacementTask[] = [];
  const unplaced: PlanUnplaced[] = [];
  const tradeoffCodes = new Map<string, PlanTradeoff>();

  const recordTradeoff = (code: string, message: string) => {
    if (!tradeoffCodes.has(code)) {
      tradeoffCodes.set(code, { code, message });
    }
  };

  const activeScoped = state.accessions
    .filter(
      (accession) =>
        scopedTrialIds.has(accession.trialId) && !isAccessionRetired(accession),
    )
    .sort((a, b) => a.id.localeCompare(b.id));

  activeScoped.forEach((accession) => {
    const source = assignedBench.get(accession.id);
    const trial = trialById.get(accession.trialId);
    const priority = trial ? effectivePriority(trial, policy) : "normal";
    if (source && stayFeasible(source, accession, policy)) {
      items.push({
        accessionId: accession.id,
        trialId: accession.trialId,
        sourceBenchId: source.id,
        targetBenchId: source.id,
        status: "stays",
        pinned: false,
        reasons: [
          reason(
            "KEPT",
            `${accession.cultivar} 已在 ${describeBench(source)}，现场保持原位，不搬动`,
          ),
        ],
        warnings: [],
      });
      return;
    }
    const evictReason = source
      ? buildEvictionReason(source, accession, policy)
      : undefined;
    tasks.push({
      accession,
      source,
      forced: Boolean(source),
      evictReason,
      priority,
    });
  });

  tasks.sort((a, b) => {
    const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    if (byPriority !== 0) {
      return byPriority;
    }
    if (a.forced !== b.forced) {
      return a.forced ? -1 : 1;
    }
    const trialA = trialById.get(a.accession.trialId);
    const trialB = trialById.get(b.accession.trialId);
    const byStart = (trialA?.startDate ?? "").localeCompare(
      trialB?.startDate ?? "",
    );
    if (byStart !== 0) {
      return byStart;
    }
    return a.accession.accessionNo.localeCompare(b.accession.accessionNo);
  });

  tasks.forEach((task) => {
    const { accession, source, forced, evictReason } = task;
    const candidates = state.benches
      .filter((bench) =>
        targetBenchFeasible(bench, accession, occupancy, policy),
      )
      .map((bench) => scoreTarget(bench, accession, occupancy, cohesion, policy));

    if (candidates.length === 0) {
      const code = describeNoCandidate(state.benches, accession, policy);
      unplaced.push({
        accessionId: accession.id,
        trialId: accession.trialId,
        code: code.code,
        message: code.message,
      });
      items.push({
        accessionId: accession.id,
        trialId: accession.trialId,
        sourceBenchId: source?.id,
        status: forced ? "moved" : "new",
        pinned: false,
        reasons: evictReason ? [evictReason] : [],
        warnings: [code],
      });
      recordTradeoff(
        "STABILITY",
        "容量不足时，规划器不驱逐已在场的其他批次材料；放不下的材料保留为“未放置”，交人工裁决",
      );
      return;
    }

    candidates.sort(compareScored);
    const chosen = candidates[0];
    const target = chosen.bench;

    if (source) {
      occupancy.set(source.id, (occupancy.get(source.id) ?? 1) - 1);
      const sourceCounts = cohesion.get(source.id);
      const sameTrialAtSource = sourceCounts?.get(accession.trialId) ?? 0;
      sourceCounts?.set(accession.trialId, Math.max(0, sameTrialAtSource - 1));
    }
    occupancy.set(target.id, (occupancy.get(target.id) ?? 0) + 1);
    const targetCounts =
      cohesion.get(target.id) ?? new Map<string, number>();
    cohesion.set(target.id, targetCounts);
    targetCounts.set(
      accession.trialId,
      (targetCounts.get(accession.trialId) ?? 0) + 1,
    );

    const warnings: PlanItemReason[] = [];
    if (chosen.usesBuffer) {
      warnings.push(
        reason(
          "RESERVED_USED",
          `${describeBench(target)} 的常规槽位已满，动用预留缓冲（剩余缓冲 ${Math.max(
            0,
            target.capacity - (occupancy.get(target.id) ?? 0),
          )} 位）`,
        ),
      );
      recordTradeoff(
        "RESERVED_BUFFER",
        "为避免高优先级材料无处放置，规划动用了台架预留缓冲槽位；现场应尽快恢复缓冲",
      );
    }

    const itemReasons: PlanItemReason[] = [];
    if (evictReason) {
      itemReasons.push(evictReason);
      recordTradeoff(
        "MAINTENANCE",
        "规划期内有台架维修/隔离，相关在场材料被迁移到兼容台架",
      );
    }
    itemReasons.push(
      chosen.cohesion > 0
        ? reason(
            "COHESION",
            `与同试验 ${chosen.cohesion} 份材料集中在 ${describeBench(target)}，便于统一管护`,
          )
        : reason(
            "BALANCE",
            `${describeBench(target)} 光照兼容且在候选台架中占用最低，负载更均衡`,
          ),
    );

    items.push({
      accessionId: accession.id,
      trialId: accession.trialId,
      sourceBenchId: source?.id,
      targetBenchId: target.id,
      status: forced ? "moved" : "new",
      pinned: false,
      reasons: itemReasons,
      warnings,
    });
  });

  if (unplaced.length > 0) {
    recordTradeoff(
      "INSUFFICIENT_CAPACITY",
      `共享台架在规划期内容量不足，${unplaced.length} 份材料未能放置；请扩容、调整窗口或人工指定`,
    );
  }

  state.accessions
    .filter(
      (accession) =>
        scopedTrialIds.has(accession.trialId) && isAccessionRetired(accession),
    )
    .sort((a, b) => a.id.localeCompare(b.id))
    .forEach((accession) => {
      items.push({
        accessionId: accession.id,
        trialId: accession.trialId,
        sourceBenchId: assignedBench.get(accession.id)?.id,
        status: "excluded",
        pinned: false,
        reasons: [
          reason(
            "RETIRED",
            `${accession.cultivar} 已停用，不进入新分配；其现场占用（如有）保持历史记录`,
          ),
        ],
        warnings: [],
      });
    });

  items.sort(compareItems);

  return {
    id: createId("plan"),
    code: nextPlanCode(existingPlans),
    algorithmVersion: PLANNER_ALGORITHM_VERSION,
    createdAt,
    lifecycle: "draft",
    policy,
    inputFingerprint: planningFingerprint(state, policy),
    items,
    unplaced,
    tradeoffs: Array.from(tradeoffCodes.values()).sort((a, b) =>
      a.code.localeCompare(b.code),
    ),
  };
}

function buildEvictionReason(
  source: Bench,
  accession: Accession,
  policy: PlanningPolicy,
): PlanItemReason {
  if (source.status === "blocked") {
    return reason(
      "BENCH_BLOCKED",
      `原台架 ${describeBench(source)} 已停用（${source.blockedReason ?? "未记录原因"}），必须迁出`,
    );
  }
  if (source.status === "quarantine") {
    return reason(
      "BENCH_QUARANTINE",
      `原台架 ${describeBench(source)} 正在隔离，必须迁出`,
    );
  }
  const maintenance = benchUnderMaintenance(source, policy);
  if (policy.relocateFromMaintenance && maintenance.active) {
    return reason(
      "MAINTENANCE",
      `原台架 ${describeBench(source)} 在规划期内维修（${maintenance.reason ?? "未记录原因"}），提前迁出`,
    );
  }
  return reason(
    "UNAVAILABLE",
    `${accession.cultivar} 在 ${describeBench(source)} 的现有分配不再满足约束，需要迁移`,
  );
}

interface ScoredTarget {
  bench: Bench;
  cohesion: number;
  respectsBuffer: boolean;
  usesBuffer: boolean;
  fillAfter: number;
}

function scoreTarget(
  bench: Bench,
  accession: Accession,
  occupancy: Map<string, number>,
  cohesion: Map<string, Map<string, number>>,
  policy: PlanningPolicy,
): ScoredTarget {
  const used = occupancy.get(bench.id) ?? 0;
  const sameTrial = cohesion.get(bench.id)?.get(accession.trialId) ?? 0;
  const after = used + 1;
  return {
    bench,
    cohesion: sameTrial,
    respectsBuffer: after <= effectiveCapacity(bench, policy),
    usesBuffer: after > effectiveCapacity(bench, policy),
    fillAfter: bench.capacity === 0 ? 1 : after / bench.capacity,
  };
}

function compareScored(a: ScoredTarget, b: ScoredTarget): number {
  if (a.cohesion !== b.cohesion) {
    return b.cohesion - a.cohesion;
  }
  if (a.respectsBuffer !== b.respectsBuffer) {
    return a.respectsBuffer ? -1 : 1;
  }
  if (a.fillAfter !== b.fillAfter) {
    return a.fillAfter - b.fillAfter;
  }
  return a.bench.code.localeCompare(b.bench.code);
}

function describeNoCandidate(
  benches: Bench[],
  accession: Accession,
  policy: PlanningPolicy,
): PlanItemReason {
  const lightCompatible = benches.filter((bench) =>
    isLightCompatible(accession, bench),
  );
  const serviceable = lightCompatible.filter(
    (bench) => isBenchServicable(bench) && !benchUnderMaintenance(bench, policy).active,
  );
  if (lightCompatible.length === 0) {
    return reason(
      "NO_COMPATIBLE_LIGHT",
      `没有任何台架提供 ${accession.preferredLight} 兼容光照`,
    );
  }
  if (serviceable.length === 0) {
    return reason(
      "ALL_UNAVAILABLE",
      "光照兼容的台架均处于停用、隔离或规划期维修中",
    );
  }
  return reason(
    "CAPACITY_FULL",
    "光照兼容且可用的台架在规划期内均已满位",
  );
}

function compareItems(a: AllocationPlanItem, b: AllocationPlanItem): number {
  const rank: Record<AllocationPlanItem["status"], number> = {
    moved: 0,
    new: 1,
    unplaced: 2,
    stays: 3,
    excluded: 4,
  };
  if (rank[a.status] !== rank[b.status]) {
    return rank[a.status] - rank[b.status];
  }
  if (a.trialId !== b.trialId) {
    return a.trialId.localeCompare(b.trialId);
  }
  return a.accessionId.localeCompare(b.accessionId);
}

/* ------------------------------------------------------------------ */
/* 人工修改后的再校验：哪些部分仍然有效                                */
/* ------------------------------------------------------------------ */

export type ItemVerdict =
  | "valid"
  | "suboptimal"
  | "invalid"
  | "incomplete"
  | "ignored";

export interface ItemValidation {
  accessionId: string;
  verdict: ItemVerdict;
  violations: PlanItemReason[];
  suggestionBenchId?: string;
}

export interface PlanValidationReport {
  planId: string;
  inputChanged: boolean;
  currentFingerprint: string;
  items: ItemValidation[];
  invalidCount: number;
  incompleteCount: number;
  suboptimalCount: number;
  applicable: boolean;
  summary: PlanItemReason[];
}

export function validatePlan(
  state: WorkspaceState,
  plan: AllocationPlan,
): PlanValidationReport {
  const currentFingerprint = planningFingerprint(state, plan.policy);
  const inputChanged = currentFingerprint !== plan.inputFingerprint;

  const benchById = new Map(state.benches.map((bench) => [bench.id, bench]));
  const accessionById = new Map(
    state.accessions.map((accession) => [accession.id, accession]),
  );

  // 端态容量：以当前现场为基线，扣除迁出，计入迁入；stays 已包含在基线内。
  const baseOccupancy = new Map<string, number>();
  state.benches.forEach((bench) => {
    baseOccupancy.set(bench.id, bench.assignedIds.length);
  });
  const arriving = new Map<string, AllocationPlanItem[]>();
  plan.items.forEach((item) => {
    if (item.status === "excluded") {
      return;
    }
    if (
      item.sourceBenchId &&
      item.targetBenchId &&
      item.sourceBenchId !== item.targetBenchId
    ) {
      baseOccupancy.set(
        item.sourceBenchId,
        Math.max(0, (baseOccupancy.get(item.sourceBenchId) ?? 1) - 1),
      );
    }
    if (
      item.targetBenchId &&
      item.targetBenchId !== item.sourceBenchId
    ) {
      const list = arriving.get(item.targetBenchId) ?? [];
      list.push(item);
      arriving.set(item.targetBenchId, list);
    }
  });
  const overflowAccessions = new Set<string>();
  arriving.forEach((targets, benchId) => {
    const bench = benchById.get(benchId);
    if (!bench) {
      return;
    }
    const overflow =
      (baseOccupancy.get(benchId) ?? 0) + targets.length - bench.capacity;
    if (overflow > 0) {
      targets
        .slice()
        .sort((a, b) => {
          if (a.pinned !== b.pinned) {
            return a.pinned ? 1 : -1;
          }
          return a.accessionId.localeCompare(b.accessionId);
        })
        .slice(-overflow)
        .forEach((item) => overflowAccessions.add(item.accessionId));
    }
  });

  const liveOccupancy = new Map<string, number>();
  state.benches.forEach((bench) =>
    liveOccupancy.set(bench.id, bench.assignedIds.length),
  );

  const items: ItemValidation[] = plan.items.map((item) => {
    const accession = accessionById.get(item.accessionId);

    if (item.status === "excluded") {
      return { accessionId: item.accessionId, verdict: "ignored", violations: [] };
    }
    if (item.status === "unplaced" || !item.targetBenchId) {
      return {
        accessionId: item.accessionId,
        verdict: "incomplete",
        violations: [
          reason(
            "UNPLACED",
            "该材料尚无目标台架，计划不能应用；请人工指定台架或调整范围",
          ),
        ],
      };
    }

    const violations: PlanItemReason[] = [];
    const target = benchById.get(item.targetBenchId);

    if (!accession) {
      violations.push(reason("UNKNOWN_ACCESSION", "材料已不存在"));
    } else if (isAccessionRetired(accession)) {
      violations.push(reason("RETIRED", "材料已停用，不能进入分配"));
    }
    if (!target) {
      violations.push(reason("UNKNOWN_BENCH", "目标台架已不存在"));
    } else {
      if (!isBenchServicable(target)) {
        violations.push(
          reason(
            "BENCH_UNAVAILABLE",
            `台架 ${target.code} 当前${target.status === "quarantine" ? "隔离" : "停用"}中`,
          ),
        );
      }
      if (accession && !isLightCompatible(accession, target)) {
        violations.push(
          reason(
            "LIGHT_MISMATCH",
            `台架 ${target.code} 的光照与材料所需不兼容`,
          ),
        );
      }
      const maintenance = benchUnderMaintenance(target, plan.policy);
      if (maintenance.active) {
        violations.push(
          reason(
            "MAINTENANCE",
            `台架 ${target.code} 在规划期内维修（${maintenance.reason ?? "未记录原因"}）`,
          ),
        );
      }
      if (overflowAccessions.has(item.accessionId)) {
        violations.push(
          reason(
            "CAPACITY",
            `台架 ${target.code} 物理容量不足，应用计划后端态会超出容量`,
          ),
        );
      }
    }

    if (violations.length > 0) {
      const suggestion = accession
        ? findStaticAlternative(state.benches, accession, plan.policy, liveOccupancy)
        : undefined;
      return {
        accessionId: item.accessionId,
        verdict: "invalid",
        violations,
        suggestionBenchId: suggestion?.id,
      };
    }

    // 硬约束合法，但偏离软策略 → suboptimal（仍可应用）。
    if (
      target &&
      accession &&
      isSoftSuboptimal(target, accession, state.benches, plan.policy, liveOccupancy)
    ) {
      return {
        accessionId: item.accessionId,
        verdict: "suboptimal",
        violations: [
          item.pinned
            ? reason(
                "MANUAL_DEVIATION",
                `人工钉选的 ${target.code} 仍合法，但占用了预留缓冲；存在当前更优的兼容台架`,
              )
            : reason(
                "BUFFER_PRESSURE",
                `${target.code} 已在使用预留缓冲，条件允许时建议迁回常规槽位`,
              ),
        ],
      };
    }

    return { accessionId: item.accessionId, verdict: "valid", violations: [] };
  });

  const invalidCount = items.filter((item) => item.verdict === "invalid").length;
  const incompleteCount = items.filter(
    (item) => item.verdict === "incomplete",
  ).length;
  const suboptimalCount = items.filter(
    (item) => item.verdict === "suboptimal",
  ).length;

  const summary: PlanItemReason[] = [];
  if (inputChanged) {
    summary.push(
      reason(
        "INPUT_CHANGED",
        "计划生成后台架或材料数据已变化，以下结论基于当前数据重新核算；未标红的条目仍然有效",
      ),
    );
  }
  if (invalidCount > 0) {
    summary.push(
      reason(
        "HARD_CONFLICT",
        `${invalidCount} 条建议触碰硬约束（停用/隔离/维修/光照/容量），必须修改后才能应用`,
      ),
    );
  }
  if (incompleteCount > 0) {
    summary.push(
      reason("PENDING", `${incompleteCount} 份材料尚未放置，计划暂不完整`),
    );
  }
  if (invalidCount === 0 && incompleteCount === 0) {
    summary.push(
      reason(
        "ALL_VALID",
        suboptimalCount > 0
          ? `全部建议可应用，其中 ${suboptimalCount} 条为合法但偏离软策略的人工选择`
          : "全部建议当前仍有效，可直接应用",
      ),
    );
  }

  return {
    planId: plan.id,
    inputChanged,
    currentFingerprint,
    items,
    invalidCount,
    incompleteCount,
    suboptimalCount,
    applicable: invalidCount === 0 && incompleteCount === 0,
    summary,
  };
}

function findStaticAlternative(
  benches: Bench[],
  accession: Accession,
  policy: PlanningPolicy,
  liveOccupancy: Map<string, number>,
): Bench | undefined {
  return benches
    .filter(
      (bench) =>
        isBenchServicable(bench) &&
        isLightCompatible(accession, bench) &&
        !benchUnderMaintenance(bench, policy).active &&
        (liveOccupancy.get(bench.id) ?? 0) < bench.capacity,
    )
    .sort((a, b) => a.code.localeCompare(b.code))[0];
}

function isSoftSuboptimal(
  target: Bench,
  accession: Accession,
  benches: Bench[],
  policy: PlanningPolicy,
  liveOccupancy: Map<string, number>,
): boolean {
  const usedAtTarget = liveOccupancy.get(target.id) ?? 0;
  if (usedAtTarget < effectiveCapacity(target, policy)) {
    return false;
  }
  // 目标台架已动用缓冲，而当前现场存在另一个缓冲内的兼容台架。
  return benches.some(
    (bench) =>
      bench.id !== target.id &&
      isBenchServicable(bench) &&
      isLightCompatible(accession, bench) &&
      !benchUnderMaintenance(bench, policy).active &&
      (liveOccupancy.get(bench.id) ?? 0) < effectiveCapacity(bench, policy),
  );
}

/* ------------------------------------------------------------------ */
/* 应用计划：逐条走既有领域动作，硬约束在领域层再校验一次              */
/* ------------------------------------------------------------------ */

export function applyPlan(
  state: WorkspaceState,
  plan: AllocationPlan,
  appliedAt: string,
): Result<{ benches: Bench[]; plan: AllocationPlan }> {
  if (plan.lifecycle === "applied") {
    return fail([fieldError("plan", "already_applied", "该计划已经应用过")]);
  }
  const report = validatePlan(state, plan);
  if (!report.applicable) {
    return fail([
      fieldError(
        "plan",
        "not_applicable",
        `计划存在 ${report.invalidCount} 条硬冲突、${report.incompleteCount} 条未放置，不能应用`,
      ),
    ]);
  }

  let benches = state.benches.map((bench) => ({ ...bench }));
  const benchIndex = () => {
    const map = new Map<string, Bench>();
    benches.forEach((bench) => map.set(bench.id, bench));
    return map;
  };

  for (const item of plan.items) {
    if (
      item.status === "excluded" ||
      !item.targetBenchId ||
      item.targetBenchId === item.sourceBenchId
    ) {
      continue;
    }
    const index = benchIndex();
    const source = item.sourceBenchId ? index.get(item.sourceBenchId) : undefined;
    if (source) {
      const released = releaseAccession(item.accessionId, source);
      if (!released.ok) {
        return released;
      }
      benches = benches.map((bench) =>
        bench.id === source.id ? released.value : bench,
      );
    }
  }

  for (const item of plan.items) {
    if (
      item.status === "excluded" ||
      !item.targetBenchId ||
      item.targetBenchId === item.sourceBenchId
    ) {
      continue;
    }
    const accession = state.accessions.find((entry) => entry.id === item.accessionId);
    const index = benchIndex();
    const target = index.get(item.targetBenchId);
    if (!accession || !target) {
      return fail([fieldError("plan", "missing_reference", "计划引用了不存在的材料或台架")]);
    }
    const assigned = assignAccession(accession, target);
    if (!assigned.ok) {
      return assigned;
    }
    benches = benches.map((bench) =>
      bench.id === target.id ? assigned.value : bench,
    );
  }

  return ok({
    benches,
    plan: { ...plan, lifecycle: "applied", appliedAt },
  });
}

export function retargetPlanItem(
  plan: AllocationPlan,
  accessionId: string,
  targetBenchId: string | undefined,
): AllocationPlan {
  return {
    ...plan,
    items: plan.items.map((item) => {
      if (item.accessionId !== accessionId || item.status === "excluded") {
        return item;
      }
      if (!targetBenchId) {
        return {
          ...item,
          targetBenchId: undefined,
          status: "unplaced",
          pinned: true,
        };
      }
      return {
        ...item,
        targetBenchId,
        status:
          item.sourceBenchId && item.sourceBenchId === targetBenchId
            ? "stays"
            : item.sourceBenchId
              ? "moved"
              : "new",
        pinned: true,
        warnings: [],
      };
    }),
  };
}
