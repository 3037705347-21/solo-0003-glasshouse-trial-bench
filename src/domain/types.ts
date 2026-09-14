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

export type LineageRelation = "selfed" | "cross" | "selected-from";

export interface AccessionLineage {
  id: string;
  childAccessionId: string;
  parentAccessionId: string;
  relation: LineageRelation;
  note: string;
  createdOn: string;
}

export interface TrialCopyRecord {
  id: string;
  /** 客户端幂等键：同一次复制请求重试只会返回该记录。 */
  idempotencyKey: string;
  sourceTrialId: string;
  sourceTrialCode: string;
  newTrialId: string;
  newTrialCode: string;
  copiedAccessionCount: number;
  skippedAccessionCount: number;
  fieldSelection: string[];
  /** 提交时使用的模板修订号，用于解释来源版本。 */
  templateRevision: string;
  createdOn: string;
}

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
  accessionLineage: AccessionLineage[];
  trialCopyRecords: TrialCopyRecord[];
}
