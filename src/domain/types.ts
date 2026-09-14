export type TrialState = "draft" | "active" | "paused" | "cleared";

export interface Trial {
  id: string;
  code: string;
  cropFamily: string;
  objective: string;
  season: string;
  startDate: string;
  endDate: string;
  state: TrialState;
}

export type PreferredLight = "full-sun" | "partial-shade" | "shade";

export interface Accession {
  id: string;
  trialId: string;
  accessionNo: string;
  cultivar: string;
  source: string;
  propagatedOn: string;
  quantity: number;
  trayCells: number;
  preferredLight: PreferredLight;
  genotypeNote: string;
  labels: string[];
}

export type BenchStatus = "available" | "assigned" | "blocked" | "quarantine";

export interface Bench {
  id: string;
  code: string;
  sector: string;
  capacity: number;
  assignedIds: string[];
  lightProfile: PreferredLight;
  irrigationLine: string;
  status: BenchStatus;
  blockedReason?: string;
}

export interface ObservationEntry {
  accessionId: string;
  heightMm: number;
  leafCount: number;
  ecMs: number;
  notes: string;
}

export interface ObservationPass {
  id: string;
  trialId: string;
  observedOn: string;
  observer: string;
  entries: ObservationEntry[];
}

export type PlanScheduleStatus =
  | "upcoming"
  | "due-soon"
  | "due-today"
  | "overdue"
  | "completed";

/**
 * 观测计划当前的跟进状态。`stale` 表示计划建立时记录的材料快照与当前
 * 登记数据不一致，需要工作人员重新确认后才能完成。
 */
export type PlanFollowUpStatus = "pending" | "stale" | "completed";

/**
 * 计划材料在建立（或最近一次重新确认）时的快照。观测计划与观测记录分开
 * 保存，这份快照只用于保留历史并检测后续变化，永远不会回写材料或观测。
 */
export interface PlanAccessionSnapshot {
  accessionId: string;
  accessionNo: string;
  cultivar: string;
  benchId: string | null;
  benchCode: string | null;
  trialState: TrialState;
}

export interface ObservationPlan {
  id: string;
  trialId: string;
  /** 计划观测日期（YYYY-MM-DD）。 */
  scheduledOn: string;
  assignee: string;
  note: string;
  accessionIds: string[];
  accessionSnapshots: PlanAccessionSnapshot[];
  status: PlanFollowUpStatus;
  createdAt: string;
  createdOn: string;
  confirmedOn?: string;
  completedOn?: string;
  completedBy?: string;
  /** 完成后关联到的真实观测记录，二者互相追溯。 */
  linkedObservationPassId?: string;
}

export type PlanDriftCode =
  | "BENCH_MOVED"
  | "TRIAL_PAUSED"
  | "TRIAL_STATE_CHANGED"
  | "ACCESSION_NO_CHANGED"
  | "ACCESSIONS_MISSING";

export interface PlanDrift {
  code: PlanDriftCode;
  message: string;
  accessionId?: string;
}

export type FlagSeverity = "info" | "warning" | "critical";
export type FlagState = "open" | "resolved" | "waived";

export interface Flag {
  id: string;
  trialId: string;
  accessionId: string;
  observationPassId: string;
  code: string;
  message: string;
  severity: FlagSeverity;
  state: FlagState;
  createdOn: string;
  resolvedOn?: string;
  resolutionNote?: string;
}

export type ClearanceStatus = "ready" | "blocked";

export interface ClearanceMetric {
  label: string;
  value: number;
  detail: string;
}

export interface ClearanceBlocker {
  code: string;
  message: string;
  accessionId?: string;
  benchId?: string;
}

export interface ClearanceSnapshot {
  id: string;
  trialId: string;
  generatedOn: string;
  status: ClearanceStatus;
  metrics: ClearanceMetric[];
  blockers: ClearanceBlocker[];
}

export interface WorkspaceState {
  trials: Trial[];
  accessions: Accession[];
  benches: Bench[];
  observationPasses: ObservationPass[];
  observationPlans: ObservationPlan[];
  flags: Flag[];
  clearanceSnapshots: ClearanceSnapshot[];
}
