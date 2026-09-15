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

export interface MaintenanceWindow {
  from: string;
  to: string;
  reason: string;
}

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
  reservedSlots?: number;
  maintenance?: MaintenanceWindow[];
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

export type PlanItemStatus =
  | "stays"
  | "moved"
  | "new"
  | "unplaced"
  | "excluded";

export type PlanLifecycle = "draft" | "applied" | "discarded";
export type PriorityOverride = "high" | "normal" | "low";

export interface PlanningPolicy {
  scopeTrialIds: string[];
  horizonFrom: string;
  horizonTo: string;
  reservedSlotsEnabled: boolean;
  relocateFromMaintenance: boolean;
  priorityOverrides: Record<string, PriorityOverride>;
}

export interface PlanItemReason {
  code: string;
  message: string;
}

export interface AllocationPlanItem {
  accessionId: string;
  trialId: string;
  sourceBenchId?: string;
  targetBenchId?: string;
  status: PlanItemStatus;
  pinned: boolean;
  reasons: PlanItemReason[];
  warnings: PlanItemReason[];
}

export interface PlanUnplaced {
  accessionId: string;
  trialId: string;
  code: string;
  message: string;
}

export interface PlanTradeoff {
  code: string;
  message: string;
}

export interface AllocationPlan {
  id: string;
  code: string;
  algorithmVersion: number;
  createdAt: string;
  lifecycle: PlanLifecycle;
  policy: PlanningPolicy;
  inputFingerprint: string;
  items: AllocationPlanItem[];
  unplaced: PlanUnplaced[];
  tradeoffs: PlanTradeoff[];
  appliedAt?: string;
}

export interface WorkspaceState {
  trials: Trial[];
  accessions: Accession[];
  benches: Bench[];
  observationPasses: ObservationPass[];
  flags: Flag[];
  clearanceSnapshots: ClearanceSnapshot[];
  allocationPlans: AllocationPlan[];
}
