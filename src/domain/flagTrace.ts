import type {
  Accession,
  Flag,
  FlagSeverity,
  FlagState,
  ObservationEntry,
  ObservationPass,
  Trial,
  WorkspaceState,
} from "./types";

/**
 * 一条标记的完整可追溯视图。工作台不持有独立副本，而是从工作区的
 * 标记、试验、材料、观测和放行状态实时拼装出来。
 */
export interface FlagTrace {
  flag: Flag;
  trial?: Trial;
  accession?: Accession;
  /** 材料登记所属的试验，可能与产生标记的观测试验不同（跨试验引用）。 */
  accessionTrial?: Trial;
  pass?: ObservationPass;
  entry?: ObservationEntry;
  /** 该材料是否在产生标记的观测试验之外被登记。 */
  crossTrial: boolean;
  /** 开放标记是否仍阻挡其观测试验的放行。 */
  blockingClearance: boolean;
  related: Flag[];
}

export interface FlagFilters {
  trialId: string;
  accessionId: string;
  severity: "" | FlagSeverity;
  code: string;
  state: "" | FlagState;
  from: string;
  to: string;
}

export const EMPTY_FLAG_FILTERS: FlagFilters = {
  trialId: "",
  accessionId: "",
  severity: "",
  code: "",
  state: "",
  from: "",
  to: "",
};

/**
 * 只有“未处理”的标记会进入实时放行计算；试验已经放向后，历史标记不再
 * 阻挡（快照不可变，这里反映的是实时约束视图）。
 */
export function flagBlocksClearance(
  flag: Flag,
  trial: Trial | undefined,
): boolean {
  return flag.state === "open" && trial?.state !== "cleared";
}

export function buildFlagTrace(
  flag: Flag,
  state: WorkspaceState,
): FlagTrace {
  const trial = state.trials.find((item) => item.id === flag.trialId);
  const accession = state.accessions.find(
    (item) => item.id === flag.accessionId,
  );
  const accessionTrial = state.trials.find(
    (item) => item.id === accession?.trialId,
  );
  const pass = state.observationPasses.find(
    (item) => item.id === flag.observationPassId,
  );
  const entry = pass?.entries.find(
    (item) => item.accessionId === flag.accessionId,
  );
  const related = state.flags
    .filter(
      (item) =>
        item.id !== flag.id && item.accessionId === flag.accessionId,
    )
    .sort(compareFlags);
  return {
    flag,
    trial,
    accession,
    accessionTrial,
    pass,
    entry,
    crossTrial:
      accession !== undefined && accession.trialId !== flag.trialId,
    blockingClearance: flagBlocksClearance(flag, trial),
    related,
  };
}

export function flagTraces(state: WorkspaceState): FlagTrace[] {
  return [...state.flags]
    .sort(compareFlags)
    .map((flag) => buildFlagTrace(flag, state));
}

function compareFlags(left: Flag, right: Flag): number {
  const byCreated = right.createdOn.localeCompare(left.createdOn);
  if (byCreated !== 0) {
    return byCreated;
  }
  return right.id.localeCompare(left.id);
}

export function filterFlagTraces(
  traces: FlagTrace[],
  filters: FlagFilters,
): FlagTrace[] {
  return traces.filter((trace) => {
    const { flag } = trace;
    if (filters.trialId && flag.trialId !== filters.trialId) {
      return false;
    }
    if (filters.accessionId && flag.accessionId !== filters.accessionId) {
      return false;
    }
    if (filters.severity && flag.severity !== filters.severity) {
      return false;
    }
    if (filters.code && flag.code !== filters.code) {
      return false;
    }
    if (filters.state && flag.state !== filters.state) {
      return false;
    }
    const createdDay = flag.createdOn.slice(0, 10);
    if (filters.from && createdDay < filters.from) {
      return false;
    }
    if (filters.to && createdDay > filters.to) {
      return false;
    }
    return true;
  });
}

export const FLAG_SEVERITY_LABELS: Record<FlagSeverity, string> = {
  critical: "严重",
  warning: "警告",
  info: "提示",
};

export const FLAG_STATE_LABELS: Record<FlagState, string> = {
  open: "未处理",
  resolved: "已解决",
  waived: "已豁免",
};

export const FLAG_CODE_LABELS: Record<string, string> = {
  HT_UNDER: "株高低于阈值",
  HT_OVER: "株高超过阈值",
  LEAF_LOW: "真叶数不足",
  EC_HIGH: "基质电导率偏高",
};

export function flagCodeLabel(code: string): string {
  return FLAG_CODE_LABELS[code] ?? code;
}

/** createdOn / resolvedOn 存的是 ISO 时间戳，缺失时退回原始字符串。 */
export function formatTimestamp(value: string | undefined): string {
  if (!value) {
    return "—";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

/** 观测日期是 date-only 字符串，直接展示并在无效时回退。 */
export function formatObservedOn(value: string | undefined): string {
  if (!value) {
    return "—";
  }
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("zh-CN");
}
