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
  ruleSetId: string;
}

export type FlagSeverity = "info" | "warning" | "critical";
export type FlagState = "open" | "resolved" | "waived" | "superseded";

export interface FlagRevision {
  id: string;
  changedOn: string;
  fromState: FlagState;
  toState: FlagState;
  note: string;
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
  createdOn: string;
  resolvedOn?: string;
  resolutionNote?: string;
  ruleSetId: string;
  supersededOn?: string;
  supersededReason?: string;
  supersededByRuleSetId?: string;
  revisionHistory: FlagRevision[];
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
  ruleSetId: string;
}

export type RuleSetScope =
  | { kind: "workspace" }
  | { kind: "season"; season: string }
  | { kind: "trial"; trialId: string };

export type RuleSetStatus = "published" | "retired";

export interface GrowthBound {
  min: number;
  max: number;
}

export interface GrowthBounds {
  heightMm: GrowthBound;
  leafCount: GrowthBound;
  ecMs: GrowthBound;
}

export type FlagMetric = "heightMm" | "leafCount" | "ecMs";
export type FlagComparator = "lt" | "gte";

export interface FlagThreshold {
  code: string;
  metric: FlagMetric;
  comparator: FlagComparator;
  value: number;
  severity: FlagSeverity;
  messageTemplate: string;
}

export interface ClearancePolicy {
  blockingSeverities: FlagSeverity[];
}

export interface RuleSet {
  id: string;
  version: number;
  name: string;
  scope: RuleSetScope;
  effectiveFrom: string;
  status: RuleSetStatus;
  note: string;
  createdOn: string;
  growthBounds: GrowthBounds;
  flagThresholds: FlagThreshold[];
  clearance: ClearancePolicy;
  retiredOn?: string;
  retireNote?: string;
}

export interface ReinterpretationRecord {
  id: string;
  passId: string;
  trialId: string;
  fromRuleSetId: string;
  toRuleSetId: string;
  createdFlagIds: string[];
  supersededFlagIds: string[];
  carriedFlagIds: string[];
  note: string;
  createdOn: string;
}

export interface WorkspaceState {
  trials: Trial[];
  accessions: Accession[];
  benches: Bench[];
  observationPasses: ObservationPass[];
  flags: Flag[];
  clearanceSnapshots: ClearanceSnapshot[];
  ruleSets: RuleSet[];
  reinterpretations: ReinterpretationRecord[];
}
