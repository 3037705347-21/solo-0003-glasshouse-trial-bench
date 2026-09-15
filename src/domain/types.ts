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
  ruleVersionId?: string;
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
  ruleVersionId?: string;
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
  ruleVersionId?: string;
}

export type RuleScope =
  | { kind: "trial"; trialId: string }
  | { kind: "cropFamily"; cropFamily: string };

export type RuleMetric = "heightMm" | "leafCount" | "ecMs";

export type RuleComparator = "lt" | "gte";

export interface MeasurementRange {
  min: number;
  max: number;
}

export type MeasurementRanges = Record<RuleMetric, MeasurementRange>;

export interface FlagCondition {
  code: string;
  metric: RuleMetric;
  comparator: RuleComparator;
  threshold: number;
  severity: FlagSeverity;
  messageTemplate: string;
}

export type RuleVersionStatus = "inactive" | "active" | "archived";

export interface RuleVersion {
  id: string;
  scope: RuleScope;
  version: number;
  ranges: MeasurementRanges;
  flagConditions: FlagCondition[];
  changeReason: string;
  createdAt: string;
  status: RuleVersionStatus;
}

export interface WorkspaceState {
  trials: Trial[];
  accessions: Accession[];
  benches: Bench[];
  observationPasses: ObservationPass[];
  flags: Flag[];
  clearanceSnapshots: ClearanceSnapshot[];
  ruleVersions: RuleVersion[];
}
