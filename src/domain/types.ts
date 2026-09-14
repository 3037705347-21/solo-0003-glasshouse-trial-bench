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

/**
 * 快照生成瞬间的引用副本。台账靠这些冻结值回看“当时”的状态，
 * 之后材料、台架或标记的任何修改都不会回写到历史快照。
 */
export interface SnapshotTrialRef {
  id: string;
  code: string;
  cropFamily: string;
  objective: string;
  season: string;
  state: TrialState;
}

export interface SnapshotAccessionRef {
  id: string;
  accessionNo: string;
  cultivar: string;
  source: string;
  quantity: number;
  preferredLight: PreferredLight;
  assignedBenchId?: string;
  labels: string[];
  // 早于本次修订生成的快照里没有以下字段，比对时按“未知、不判差异”处理。
  propagatedOn?: string;
  trayCells?: number;
  genotypeNote?: string;
}

export interface SnapshotBenchRef {
  id: string;
  code: string;
  sector: string;
  capacity: number;
  assignedIds: string[];
  lightProfile: PreferredLight;
  status: BenchStatus;
  blockedReason?: string;
}

export interface SnapshotFlagRef {
  id: string;
  accessionId: string;
  observationPassId: string;
  code: string;
  message: string;
  severity: FlagSeverity;
  state: FlagState;
  resolutionNote?: string;
}

export interface SnapshotPassRef {
  id: string;
  observedOn: string;
  observer: string;
  entryCount: number;
}

export interface SnapshotCapture {
  schema: 1;
  capturedOn: string;
  trial: SnapshotTrialRef;
  accessions: SnapshotAccessionRef[];
  benches: SnapshotBenchRef[];
  flags: SnapshotFlagRef[];
  observationPasses: SnapshotPassRef[];
}

export interface ClearanceSnapshot {
  id: string;
  trialId: string;
  generatedOn: string;
  status: ClearanceStatus;
  metrics: ClearanceMetric[];
  blockers: ClearanceBlocker[];
  /**
   * 内嵌的引用快照。早于台账功能生成的历史记录没有该字段，
   * 台账会把它们标记为“无法核对”，且仍保持只读。
   */
  capture?: SnapshotCapture;
}

export interface WorkspaceState {
  trials: Trial[];
  accessions: Accession[];
  benches: Bench[];
  observationPasses: ObservationPass[];
  flags: Flag[];
  clearanceSnapshots: ClearanceSnapshot[];
}
