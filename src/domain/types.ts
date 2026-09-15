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
export type AccessionLifecycle = "active" | "retired";

export interface AccessionRetirementRecord {
  id: string;
  retiredAt: string;
  reason: string;
  replacementId?: string;
  restoredAt?: string;
}

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
  lifecycleStatus: AccessionLifecycle;
  retiredAt?: string;
  retirementReason?: string;
  replacementId?: string;
  retirementHistory: AccessionRetirementRecord[];
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

export type FlagSeverity = "info" | "warning" | "critical";
export type FlagState = "open" | "resolved" | "waived" | "superseded";
export type FlagScope = "accession" | "trial";
export type FlagFollowUpType = "recurrence" | "escalation";

/**
 * 只追加的标记处理流水。每次解决、豁免、重开、升级或复发观测
 * 都会留下一条不可变记录，保证旧处理结论可以被回看和审计。
 */
export interface FlagHistoryEntry {
  id: string;
  at: string;
  action:
    | "created"
    | "resolved"
    | "waived"
    | "reopened"
    | "escalated"
    | "recurrence-observed";
  note: string;
  /** escalated 时指向新生成的跟进标记。 */
  followUpFlagId?: string;
}

export interface Flag {
  id: string;
  trialId: string;
  accessionId: string;
  observationPassId: string;
  code: string;
  message: string;
  severity: FlagSeverity;
  state: FlagState;
  /** accession：仅约束该材料；trial：升级后约束整个试验的放行。 */
  scope: FlagScope;
  createdOn: string;
  resolvedOn?: string;
  resolutionNote?: string;
  /** 跟进标记指向其来源标记；原始标记该字段为空。 */
  followUpOfId?: string;
  followUpType?: FlagFollowUpType;
  /** 升级说明只写在升级产生的跟进标记上。 */
  escalationNote?: string;
  /** 被升级取代时，指向代表扩大后处理范围的跟进标记。 */
  supersededById?: string;
  history: FlagHistoryEntry[];
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
  /** 当阻止项来自标记时保留标记引用，快照不可变但可追溯到具体标记。 */
  flagId?: string;
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
  flags: Flag[];
  clearanceSnapshots: ClearanceSnapshot[];
}
