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

export interface ClearanceSnapshot {
  id: string;
  trialId: string;
  generatedOn: string;
  status: ClearanceStatus;
  metrics: ClearanceMetric[];
  blockers: ClearanceBlocker[];
}

export type CloseoutStatus = "completed" | "follow-up" | "closed";

export interface CloseoutActionItem {
  id: string;
  text: string;
  createdOn: string;
  completedOn?: string;
}

export interface CloseoutAccessionFact {
  accessionNo: string;
  cultivar: string;
  benchCode?: string;
}

export interface CloseoutPassFact {
  observedOn: string;
  observer: string;
  entryCount: number;
}

export interface CloseoutFlagFact {
  code: string;
  severity: FlagSeverity;
  state: FlagState;
  message: string;
}

export interface CloseoutBenchFact {
  code: string;
  sector: string;
  usedSlots: number;
  capacity: number;
}

export interface CloseoutClearanceFact {
  snapshotId: string;
  generatedOn: string;
  status: ClearanceStatus;
  blockerCount: number;
}

export interface CloseoutFacts {
  capturedOn: string;
  trialCode: string;
  trialState: TrialState;
  accessions: CloseoutAccessionFact[];
  observationPasses: CloseoutPassFact[];
  flags: CloseoutFlagFact[];
  benches: CloseoutBenchFact[];
  clearance?: CloseoutClearanceFact;
}

export interface CloseoutReview {
  id: string;
  trialId: string;
  round: number;
  createdOn: string;
  createdBy: string;
  conclusion: string;
  outstandingIssues: string;
  nextSeasonAdvice: string;
  status: CloseoutStatus;
  statusChangedOn: string;
  closedOn?: string;
  facts: CloseoutFacts;
  actionItems: CloseoutActionItem[];
}

export interface WorkspaceState {
  trials: Trial[];
  accessions: Accession[];
  benches: Bench[];
  observationPasses: ObservationPass[];
  flags: Flag[];
  clearanceSnapshots: ClearanceSnapshot[];
  closeoutReviews: CloseoutReview[];
}
