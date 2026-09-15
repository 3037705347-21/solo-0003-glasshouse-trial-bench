import type { Accession, Bench, WorkspaceState } from "./types";
import { BENCH_LIGHT_COMPATIBILITY } from "./rules";
import { isAccessionRetired } from "./accession";
import { canAssignAccession } from "./bench";

/**
 * 跨页面准备度判定。
 *
 * 一件材料能否继续推进取决于它要做什么：每个动作独立判定，
 * 结论分为 ready（可推进）、blocked（受阻，附依据）、
 * excluded（当前不适用，例如停用材料不纳入放行）。
 * 判定全部实时推导，不落库；放行快照的过期识别见 clearance.ts。
 */

export type ReadinessAction = "assign" | "observe" | "restore" | "clear";

export type ReadinessStatus = "ready" | "blocked" | "excluded";

export interface ReadinessReason {
  code: string;
  message: string;
  tone: "critical" | "warning" | "info";
}

export interface ReadinessVerdict {
  action: ReadinessAction;
  status: ReadinessStatus;
  /** 决定状态的依据（blocked / excluded 时至少一条） */
  reasons: ReadinessReason[];
  /** 不改变状态、但与其他动作相关的提示 */
  advisories: ReadinessReason[];
}

export interface AccessionReadiness {
  accession: Accession;
  verdict: ReadinessVerdict;
}

export const READINESS_ACTIONS: ReadinessAction[] = [
  "assign",
  "observe",
  "restore",
  "clear",
];

export const READINESS_ACTION_LABELS: Record<ReadinessAction, string> = {
  assign: "台架分配",
  observe: "生长观测",
  restore: "恢复使用",
  clear: "试验放行",
};

export const READINESS_ACTION_SHORT_LABELS: Record<ReadinessAction, string> = {
  assign: "分配",
  observe: "观测",
  restore: "恢复",
  clear: "放行",
};

export const READINESS_STATUS_LABELS: Record<ReadinessStatus, string> = {
  ready: "可推进",
  blocked: "受阻",
  excluded: "不适用",
};

const LIGHT_LABELS: Record<Accession["preferredLight"], string> = {
  "full-sun": "全日照",
  "partial-shade": "半阴",
  shade: "遮阴",
};

function benchUnavailableLabel(bench: Bench): string {
  return bench.status === "quarantine" ? "正在隔离" : "已停用";
}

function openFlagsFor(state: WorkspaceState, accession: Accession) {
  return state.flags.filter(
    (flag) => flag.accessionId === accession.id && flag.state === "open",
  );
}

function evaluateAssign(
  state: WorkspaceState,
  accession: Accession,
): ReadinessVerdict {
  const advisories: ReadinessReason[] = [];
  if (isAccessionRetired(accession)) {
    return {
      action: "assign",
      status: "blocked",
      reasons: [
        {
          code: "ACCESSION_RETIRED",
          message: "材料已停用，不能进入新分配；如需继续请先恢复",
          tone: "critical",
        },
      ],
      advisories,
    };
  }

  const bench = state.benches.find((item) =>
    item.assignedIds.includes(accession.id),
  );
  if (bench) {
    if (bench.status === "blocked" || bench.status === "quarantine") {
      return {
        action: "assign",
        status: "blocked",
        reasons: [
          {
            code: "BENCH_UNAVAILABLE",
            message: `所在台架 ${bench.code} ${benchUnavailableLabel(bench)}，需要先移出再重新分配`,
            tone: "critical",
          },
        ],
        advisories,
      };
    }
    return {
      action: "assign",
      status: "excluded",
      reasons: [
        {
          code: "ALREADY_ASSIGNED",
          message: `已分配到台架 ${bench.code}，无需新分配；如需调整请先移出`,
          tone: "info",
        },
      ],
      advisories,
    };
  }

  const assignable = state.benches.filter((candidate) =>
    canAssignAccession(accession, candidate),
  );
  if (assignable.length > 0) {
    advisories.push({
      code: "COMPATIBLE_BENCHES",
      message: `当前有 ${assignable.length} 个兼容且有空位的台架`,
      tone: "info",
    });
    const trial = state.trials.find((item) => item.id === accession.trialId);
    if (trial?.state === "cleared") {
      advisories.push({
        code: "TRIAL_CLEARED",
        message: "试验已放行，通常不再需要新分配",
        tone: "info",
      });
    }
    return { action: "assign", status: "ready", reasons: [], advisories };
  }

  const lightCompatible = state.benches.filter((candidate) =>
    BENCH_LIGHT_COMPATIBILITY[accession.preferredLight].includes(
      candidate.lightProfile,
    ),
  );
  const reason: ReadinessReason =
    lightCompatible.length === 0
      ? {
          code: "NO_COMPATIBLE_BENCH",
          message: `没有光照兼容的台架（需要${LIGHT_LABELS[accession.preferredLight]}）`,
          tone: "warning",
        }
      : lightCompatible.every(
            (candidate) =>
              candidate.status === "blocked" ||
              candidate.status === "quarantine",
          )
        ? {
            code: "BENCH_UNAVAILABLE",
            message: "光照兼容的台架均不可用（停用或隔离）",
            tone: "critical",
          }
        : {
            code: "NO_COMPATIBLE_BENCH",
            message: "光照兼容的台架当前满位或不可用",
            tone: "warning",
          };
  return { action: "assign", status: "blocked", reasons: [reason], advisories };
}

function evaluateObserve(
  state: WorkspaceState,
  accession: Accession,
): ReadinessVerdict {
  const advisories: ReadinessReason[] = [];
  if (isAccessionRetired(accession)) {
    return {
      action: "observe",
      status: "blocked",
      reasons: [
        {
          code: "ACCESSION_RETIRED",
          message: "材料已停用，不能进入新观测；历史观测仍然保留",
          tone: "critical",
        },
      ],
      advisories,
    };
  }
  const trial = state.trials.find((item) => item.id === accession.trialId);
  if (!trial) {
    return {
      action: "observe",
      status: "blocked",
      reasons: [
        {
          code: "TRIAL_UNKNOWN",
          message: "所属试验不存在，无法录入观测",
          tone: "critical",
        },
      ],
      advisories,
    };
  }
  if (trial.state === "paused" || trial.state === "cleared") {
    return {
      action: "observe",
      status: "blocked",
      reasons: [
        {
          code: "TRIAL_STATE",
          message:
            trial.state === "paused"
              ? "试验已暂停，不能录入新观测"
              : "试验已放行，观测流程已结束",
          tone: "warning",
        },
      ],
      advisories,
    };
  }
  const openFlags = openFlagsFor(state, accession);
  if (openFlags.length > 0) {
    advisories.push({
      code: "OPEN_FLAGS",
      message: `有 ${openFlags.length} 个未处理标记：不影响观测，但会阻止放行`,
      tone: "info",
    });
  }
  return { action: "observe", status: "ready", reasons: [], advisories };
}

function evaluateRestore(
  state: WorkspaceState,
  accession: Accession,
): ReadinessVerdict {
  const advisories: ReadinessReason[] = [];
  if (!isAccessionRetired(accession)) {
    return {
      action: "restore",
      status: "excluded",
      reasons: [
        {
          code: "NOT_RETIRED",
          message: "材料当前在用，无需恢复",
          tone: "info",
        },
      ],
      advisories,
    };
  }
  const bench = state.benches.find((item) =>
    item.assignedIds.includes(accession.id),
  );
  if (bench) {
    if (bench.status === "blocked" || bench.status === "quarantine") {
      return {
        action: "restore",
        status: "blocked",
        reasons: [
          {
            code: "BENCH_UNAVAILABLE",
            message: `台架 ${bench.code} 当前${benchUnavailableLabel(bench)}，请先移出或恢复台架`,
            tone: "critical",
          },
        ],
        advisories,
      };
    }
    if (
      !BENCH_LIGHT_COMPATIBILITY[accession.preferredLight].includes(
        bench.lightProfile,
      )
    ) {
      return {
        action: "restore",
        status: "blocked",
        reasons: [
          {
            code: "LIGHT_MISMATCH",
            message: `材料所需光照与台架 ${bench.code} 不兼容，请先调整分配`,
            tone: "critical",
          },
        ],
        advisories,
      };
    }
  }
  advisories.push({
    code: "CONFIRM_CONDITIONS",
    message: "恢复前需要重新确认台架状态和光照条件",
    tone: "info",
  });
  return { action: "restore", status: "ready", reasons: [], advisories };
}

function evaluateClear(
  state: WorkspaceState,
  accession: Accession,
): ReadinessVerdict {
  const advisories: ReadinessReason[] = [];
  if (isAccessionRetired(accession)) {
    return {
      action: "clear",
      status: "excluded",
      reasons: [
        {
          code: "NOT_IN_SCOPE",
          message: "材料已停用，不纳入本次放行范围；历史记录仍然保留",
          tone: "info",
        },
      ],
      advisories,
    };
  }
  const reasons: ReadinessReason[] = [];
  const trial = state.trials.find((item) => item.id === accession.trialId);
  if (!trial) {
    reasons.push({
      code: "TRIAL_UNKNOWN",
      message: "所属试验不存在",
      tone: "critical",
    });
  } else if (trial.state === "draft") {
    reasons.push({
      code: "TRIAL_DRAFT",
      message: "试验仍是草稿，请先转为进行中",
      tone: "warning",
    });
  }
  const bench = state.benches.find((item) =>
    item.assignedIds.includes(accession.id),
  );
  if (!bench) {
    reasons.push({
      code: "UNASSIGNED",
      message: "尚未分配到台架",
      tone: "warning",
    });
  } else if (bench.status === "blocked" || bench.status === "quarantine") {
    reasons.push({
      code: "BENCH_UNAVAILABLE",
      message: `所在台架 ${bench.code} ${benchUnavailableLabel(bench)}`,
      tone: "critical",
    });
  }
  openFlagsFor(state, accession).forEach((flag) => {
    reasons.push({
      code: "FLAG_OPEN",
      message: `未处理标记 ${flag.code}：${flag.message}`,
      tone:
        flag.severity === "critical"
          ? "critical"
          : flag.severity === "warning"
            ? "warning"
            : "info",
    });
  });
  if (reasons.length > 0) {
    return { action: "clear", status: "blocked", reasons, advisories };
  }
  return { action: "clear", status: "ready", reasons: [], advisories };
}

/** 判定单个材料在指定动作下的准备度（实时推导）。 */
export function evaluateReadiness(
  state: WorkspaceState,
  accession: Accession,
  action: ReadinessAction,
): ReadinessVerdict {
  switch (action) {
    case "assign":
      return evaluateAssign(state, accession);
    case "observe":
      return evaluateObserve(state, accession);
    case "restore":
      return evaluateRestore(state, accession);
    case "clear":
      return evaluateClear(state, accession);
  }
}

/** 判定单个材料在全部动作下的准备度。 */
export function evaluateAccessionReadiness(
  state: WorkspaceState,
  accession: Accession,
): ReadinessVerdict[] {
  return READINESS_ACTIONS.map((action) =>
    evaluateReadiness(state, accession, action),
  );
}

/** 判定试验内全部材料在指定动作下的准备度。 */
export function readinessForTrialAction(
  state: WorkspaceState,
  trialId: string,
  action: ReadinessAction,
): AccessionReadiness[] {
  return state.accessions
    .filter((accession) => accession.trialId === trialId)
    .map((accession) => ({
      accession,
      verdict: evaluateReadiness(state, accession, action),
    }));
}

export function summarizeReadiness(
  items: AccessionReadiness[],
): Record<ReadinessStatus, number> {
  return items.reduce(
    (summary, item) => ({
      ...summary,
      [item.verdict.status]: summary[item.verdict.status] + 1,
    }),
    { ready: 0, blocked: 0, excluded: 0 } as Record<ReadinessStatus, number>,
  );
}
