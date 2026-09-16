import type {
  Bench,
  ClearanceStatus,
  Flag,
  FlagSeverity,
  ObservationPass,
  Trial,
  WorkspaceState,
} from "./types";
import { parseDateOnly } from "./rules";
import { isAccessionRetired } from "./accession";

/**
 * 今日工作台的所有事项都是从当前工作区记录实时派生的视图模型，
 * 不单独持久化：处理动作发生在原工作流中，下一次派生即反映最新状态。
 */

export const OBSERVATION_CADENCE_DAYS = 7;
export const CLEARANCE_LEAD_DAYS = 7;

export type WorkbenchCategory =
  | "observation"
  | "flag"
  | "exception"
  | "clearance"
  | "maintenance";

export type WorkbenchObjectType = "trial" | "accession" | "bench";

/**
 * overdue/today/upcoming 只对带截止日期的事项有意义；
 * standing 表示没有截止日期、随时等待处理的事项；
 * paused 表示试验暂停后被保留、暂不升级为逾期的旧提醒。
 */
export type WorkbenchDueStatus =
  | "overdue"
  | "today"
  | "upcoming"
  | "standing"
  | "paused";

export interface WorkbenchItem {
  /** 稳定但不持久化的派生标识：同一来源在一次派生中只出现一次 */
  id: string;
  category: WorkbenchCategory;
  objectType: WorkbenchObjectType;
  /** 事项所属试验；台架级跨试验事项为 undefined */
  trialId?: string;
  /** 涉及的材料或台架，用于“同一对象多条提醒”的分组 */
  accessionId?: string;
  benchId?: string;
  /** 派生源记录（观测标记等），处理完成后来源消失，事项即消失 */
  sourceFlagId?: string;
  title: string;
  detail: string;
  dueOn?: string;
  dueStatus: WorkbenchDueStatus;
  severity: FlagSeverity;
  /** 点击后跳回的工作流地址（hash 路由路径 + 查询参数） */
  route: string;
}

export interface WorkbenchSummary {
  total: number;
  overdue: number;
  today: number;
  standing: number;
  upcoming: number;
  paused: number;
}

export function buildWorkbench(
  state: WorkspaceState,
  today: string,
): WorkbenchItem[] {
  const items: WorkbenchItem[] = [];
  state.trials.forEach((trial) => {
    items.push(...observationItems(state, trial, today));
    items.push(...clearanceItems(state, trial, today));
    items.push(...unassignedItems(state, trial));
  });
  state.flags.forEach((flag) => {
    const item = openFlagItem(state, flag);
    if (item) {
      items.push(item);
    }
  });
  state.benches.forEach((bench) => {
    const item = benchItem(bench);
    if (item) {
      items.push(item);
    }
  });
  return items.sort(compareWorkbenchItems);
}

export function summarizeWorkbench(items: WorkbenchItem[]): WorkbenchSummary {
  const summary: WorkbenchSummary = {
    total: items.length,
    overdue: 0,
    today: 0,
    standing: 0,
    upcoming: 0,
    paused: 0,
  };
  items.forEach((item) => {
    summary[item.dueStatus] += 1;
  });
  return summary;
}

function observationItems(
  state: WorkspaceState,
  trial: Trial,
  today: string,
): WorkbenchItem[] {
  if (trial.state === "draft" || trial.state === "cleared") {
    return [];
  }
  // 观测窗口已经结束的试验不再排观测计划。
  const windowEnd = parseDateOnly(trial.endDate);
  const current = parseDateOnly(today);
  if (!windowEnd || !current || current.getTime() > windowEnd.getTime()) {
    return [];
  }
  const lastPass = latestPassForTrial(state.observationPasses, trial.id);
  const anchor = lastPass?.observedOn ?? trial.startDate;
  const anchorDate = parseDateOnly(anchor);
  if (!anchorDate) {
    return [];
  }
  const dueDate = addDays(anchorDate, OBSERVATION_CADENCE_DAYS);
  const dueOn = toDateOnly(dueDate);
  if (trial.state === "paused") {
    // 暂停后保留旧提醒，但冻结逾期升级，单独呈现为“已暂停”。
    return [
      {
        id: `wb-observation-${trial.id}`,
        category: "observation",
        objectType: "trial",
        trialId: trial.id,
        title: `${trial.code} 观测计划已暂停`,
        detail: `上一节奏点 ${dueOn} 的观测计划保留中，试验恢复后继续按 ${OBSERVATION_CADENCE_DAYS} 天节奏提醒。`,
        dueOn,
        dueStatus: "paused",
        severity: "info",
        route: `/observations?trial=${encodeURIComponent(trial.id)}&new=1`,
      },
    ];
  }
  const offsetDays = dayDifference(current, dueDate);
  if (offsetDays > 0) {
    // 未来的观测计划不在今日工作台展示。
    return [];
  }
  const overdueDays = Math.abs(offsetDays);
  const dueStatus: WorkbenchDueStatus =
    offsetDays === 0 ? "today" : "overdue";
  return [
    {
      id: `wb-observation-${trial.id}`,
      category: "observation",
      objectType: "trial",
      trialId: trial.id,
      title: `${trial.code} 观测计划${dueStatus === "today" ? "今天到期" : "已逾期"}`,
      detail:
        lastPass
          ? `最近一次观测为 ${lastPass.observedOn}（${lastPass.observer}），按 ${OBSERVATION_CADENCE_DAYS} 天节奏应于 ${dueOn} 记录新一轮观测。`
          : `尚无观测记录，试验开始于 ${trial.startDate}，应于 ${dueOn} 前完成首轮观测。`,
      dueOn,
      dueStatus,
      severity: dueStatus === "overdue" ? "critical" : "warning",
      route: `/observations?trial=${encodeURIComponent(trial.id)}&new=1`,
    },
  ];
}

function clearanceItems(
  state: WorkspaceState,
  trial: Trial,
  today: string,
): WorkbenchItem[] {
  if (trial.state !== "active") {
    return [];
  }
  const end = parseDateOnly(trial.endDate);
  const current = parseDateOnly(today);
  if (!end || !current) {
    return [];
  }
  const daysToEnd = dayDifference(current, end);
  if (daysToEnd > CLEARANCE_LEAD_DAYS) {
    return [];
  }
  const snapshot = liveClearanceStatus(state, trial.id);
  const dueStatus: WorkbenchDueStatus =
    daysToEnd < 0 ? "overdue" : daysToEnd === 0 ? "today" : "upcoming";
  const blockerText =
    snapshot.status === "blocked"
      ? `当前仍有 ${snapshot.blockerCount} 个放行阻止项。`
      : "当前约束检查已就绪，可以生成放行快照。";
  return [
    {
      id: `wb-clearance-${trial.id}`,
      category: "clearance",
      objectType: "trial",
      trialId: trial.id,
      title: `${trial.code} ${
        dueStatus === "upcoming"
          ? `临近放行（剩 ${daysToEnd} 天）`
          : dueStatus === "today"
            ? "今天到达放行节点"
            : "放行节点已逾期"
      }`,
      detail: `试验计划结束于 ${trial.endDate}。${blockerText}`,
      dueOn: trial.endDate,
      dueStatus,
      severity:
        snapshot.status === "blocked"
          ? dueStatus === "upcoming"
            ? "warning"
            : "critical"
          : "info",
      route: `/clearance?trial=${encodeURIComponent(trial.id)}`,
    },
  ];
}

function openFlagItem(state: WorkspaceState, flag: Flag): WorkbenchItem | null {
  if (flag.state !== "open") {
    return null;
  }
  const trial = state.trials.find((item) => item.id === flag.trialId);
  // 已放行试验的旧标记不再进入工作台；暂停试验的未处理标记保留但冻结升级。
  if (!trial || trial.state === "cleared") {
    return null;
  }
  const accession = state.accessions.find(
    (item) => item.id === flag.accessionId,
  );
  const paused = trial.state === "paused";
  const suffix = accession && isAccessionRetired(accession) ? "（材料已停用）" : "";
  return {
    id: `wb-flag-${flag.id}`,
    category: "flag",
    objectType: "accession",
    trialId: trial.id,
    accessionId: flag.accessionId,
    sourceFlagId: flag.id,
    title: `${flag.code} 开放标记${suffix}`,
    detail: flag.message,
    dueStatus: paused ? "paused" : "standing",
    severity: paused ? "info" : flag.severity,
    route: `/observations?trial=${encodeURIComponent(trial.id)}&flag=${encodeURIComponent(flag.id)}`,
  };
}

function unassignedItems(
  state: WorkspaceState,
  trial: Trial,
): WorkbenchItem[] {
  if (trial.state !== "active" && trial.state !== "paused") {
    return [];
  }
  const quarantineBenchIds = new Set(
    state.benches
      .filter((bench) => bench.status === "quarantine")
      .map((bench) => bench.id),
  );
  return state.accessions
    .filter(
      (accession) =>
        accession.trialId === trial.id && !isAccessionRetired(accession),
    )
    .filter((accession) => {
      const bench = state.benches.find((item) =>
        item.assignedIds.includes(accession.id),
      );
      // 没有任何台架承担 → 未分配；落在隔离台架上 → 需重新安置。
      return !bench || quarantineBenchIds.has(bench.id);
    })
    .map((accession) => {
      const bench = state.benches.find((item) =>
        item.assignedIds.includes(accession.id),
      );
      const quarantined = Boolean(bench && bench.status === "quarantine");
      const paused = trial.state === "paused";
      return {
        id: `wb-exception-${accession.id}`,
        category: "exception" as const,
        objectType: "accession" as const,
        trialId: trial.id,
        accessionId: accession.id,
        benchId: quarantined ? bench?.id : undefined,
        title: quarantined
          ? `${accession.accessionNo} 所在台架 ${bench?.code ?? ""} 正在隔离`
          : `${accession.accessionNo} 尚未分配台架`,
        detail: quarantined
          ? `${accession.cultivar} 需要移出隔离台架并重新分配。`
          : `${accession.cultivar} 缺少台架分配，会阻止试验放行。`,
        dueStatus: (paused ? "paused" : "standing") as WorkbenchDueStatus,
        severity: (paused
          ? "info"
          : quarantined
            ? "critical"
            : "warning") as FlagSeverity,
        route: `/layout?trial=${encodeURIComponent(trial.id)}&accession=${encodeURIComponent(accession.id)}`,
      };
    });
}

function benchItem(bench: Bench): WorkbenchItem | null {
  if (bench.status === "quarantine") {
    // 隔离台架上的每份材料已经作为异常单独列出，这里只提示台架本身需要解除隔离。
    return {
      id: `wb-bench-${bench.id}`,
      category: "exception",
      objectType: "bench",
      benchId: bench.id,
      title: `台架 ${bench.code} 正在隔离`,
      detail: `位于${bench.sector}，灌溉管路 ${bench.irrigationLine}。请检查后解除隔离，恢复分配。`,
      dueStatus: "standing",
      severity: "critical",
      route: `/layout?bench=${encodeURIComponent(bench.id)}`,
    };
  }
  if (bench.status === "blocked") {
    return {
      id: `wb-bench-${bench.id}`,
      category: "maintenance",
      objectType: "bench",
      benchId: bench.id,
      title: `台架 ${bench.code} 维护未完成`,
      detail: `位于${bench.sector}：${bench.blockedReason ?? "已停用，原因未记录"}。完成维护并恢复可用后该事项消失。`,
      dueStatus: "standing",
      severity: "warning",
      route: `/layout?bench=${encodeURIComponent(bench.id)}`,
    };
  }
  return null;
}

function latestPassForTrial(
  passes: ObservationPass[],
  trialId: string,
): ObservationPass | undefined {
  return passes
    .filter((pass) => pass.trialId === trialId)
    .sort((left, right) => right.observedOn.localeCompare(left.observedOn))[0];
}

function liveClearanceStatus(
  state: WorkspaceState,
  trialId: string,
): { status: ClearanceStatus; blockerCount: number } {
  // 与放行页一致的实时口径：不读取已保存快照，避免展示过期结论。
  const activeAccessions = state.accessions.filter(
    (accession) =>
      accession.trialId === trialId && !isAccessionRetired(accession),
  );
  const assignedIds = new Set(
    state.benches.flatMap((bench) => bench.assignedIds),
  );
  const activeIds = new Set(activeAccessions.map((accession) => accession.id));
  let blockers = 0;
  activeAccessions.forEach((accession) => {
    if (!assignedIds.has(accession.id)) {
      blockers += 1;
    }
  });
  blockers += state.benches.filter(
    (bench) => bench.status === "blocked" || bench.status === "quarantine",
  ).length;
  blockers += state.flags.filter(
    (flag) =>
      flag.trialId === trialId &&
      flag.state === "open" &&
      activeIds.has(flag.accessionId),
  ).length;
  if (activeAccessions.length === 0) {
    blockers += 1;
  }
  return {
    status: blockers === 0 ? "ready" : "blocked",
    blockerCount: blockers,
  };
}

const severityRank: Record<FlagSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

const statusRank: Record<WorkbenchDueStatus, number> = {
  overdue: 0,
  today: 1,
  upcoming: 2,
  standing: 3,
  paused: 4,
};

const categoryRank: Record<WorkbenchCategory, number> = {
  observation: 0,
  clearance: 1,
  exception: 2,
  flag: 3,
  maintenance: 4,
};

function compareWorkbenchItems(left: WorkbenchItem, right: WorkbenchItem): number {
  if (statusRank[left.dueStatus] !== statusRank[right.dueStatus]) {
    return statusRank[left.dueStatus] - statusRank[right.dueStatus];
  }
  if (severityRank[left.severity] !== severityRank[right.severity]) {
    return severityRank[left.severity] - severityRank[right.severity];
  }
  if (categoryRank[left.category] !== categoryRank[right.category]) {
    return categoryRank[left.category] - categoryRank[right.category];
  }
  const leftDue = left.dueOn ?? "9999-12-31";
  const rightDue = right.dueOn ?? "9999-12-31";
  if (leftDue !== rightDue) {
    return leftDue.localeCompare(rightDue);
  }
  return left.title.localeCompare(right.title, "zh-Hans-CN");
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date.getTime());
  next.setDate(next.getDate() + days);
  return next;
}

function dayDifference(from: Date, to: Date): number {
  const utcFrom = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const utcTo = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.round((utcTo - utcFrom) / 86400000);
}

function toDateOnly(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
