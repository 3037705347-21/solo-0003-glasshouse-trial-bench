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

export type ClearanceCheckKey =
  | "material-identity"
  | "bench-placement"
  | "observation-completeness"
  | "label-handling";

export type ClearanceCheckStatus = "confirmed" | "not-applicable" | "unconfirmed";

export interface ClearanceCheckRecord {
  key: ClearanceCheckKey;
  status: ClearanceCheckStatus;
  note: string;
  confirmedBy: string;
  confirmedAt: string;
  contextSignature: string;
  stale: boolean;
}

export interface ClearanceCheckDraft {
  trialId: string;
  records: ClearanceCheckRecord[];
}

export interface ClearanceSnapshot {
  id: string;
  trialId: string;
  generatedOn: string;
  status: ClearanceStatus;
  metrics: ClearanceMetric[];
  blockers: ClearanceBlocker[];
  checks: ClearanceCheckRecord[];
}

export interface WorkspaceState {
  trials: Trial[];
  accessions: Accession[];
  benches: Bench[];
  observationPasses: ObservationPass[];
  flags: Flag[];
  clearanceSnapshots: ClearanceSnapshot[];
  clearanceCheckDrafts: ClearanceCheckDraft[];
}
