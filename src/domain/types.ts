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
  /**
   * 跨试验复制来源：从另一批次复制档案时记录原批次编号，
   * 耗用流水不随之复制，归属始终从空账本开始。
   */
  copiedFromAccessionNo?: string;
  copiedFromTrialCode?: string;
}

export type ConsumptionKind = "use" | "correction" | "transfer";
export type ConsumptionDestination =
  | "trial"
  | "activity"
  | "waste"
  | "merge";

export interface ConsumptionRef {
  /** 试验、活动或合并目标批次等去向对象的 id，可空。 */
  id?: string;
  /** 去向的人类可读名称，例如试验编号、活动说明或目标材料编号。 */
  label: string;
  /** 跨试验耗用：材料归属试验之外的试验编号。 */
  trialCode?: string;
}

export interface ConsumptionEvent {
  id: string;
  accessionId: string;
  /**
   * 对账面数量的带符号影响：耗用与转出为负，更正事件为
   * 新旧数量的差值（冲回为正、追加耗用为负）。
   */
  delta: number;
  kind: ConsumptionKind;
  usedOn: string;
  recordedAt: string;
  recordedBy: string;
  destination: ConsumptionDestination;
  ref: ConsumptionRef;
  note: string;
  /** correction 事件指向被更正的原始 use 事件；永不删除原事件。 */
  supersedesId?: string;
  /** transfer 事件配对的另一条事件 id（源/目标批次互相指向）。 */
  transferPairId?: string;
  /** transfer 事件中另一批次的材料编号，用于目标批次已删除时仍可追溯。 */
  transferPairAccessionNo?: string;
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
  flags: Flag[];
  clearanceSnapshots: ClearanceSnapshot[];
  /** 全局耗用流水，按批次（accessionId）归属，仅追加、不就地改写。 */
  consumptionEvents: ConsumptionEvent[];
}
