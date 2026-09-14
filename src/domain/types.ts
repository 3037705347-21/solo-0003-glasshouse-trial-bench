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

export type PackageCheckCategory =
  | "missing-page"
  | "broken-ref"
  | "duplicate"
  | "open-blocker";

export interface PackageCheckFinding {
  category: PackageCheckCategory;
  code: string;
  message: string;
}

export interface PackageAccessionRecord {
  id: string;
  accessionNo: string;
  cultivar: string;
  source: string;
  quantity: number;
  trayCells: number;
  preferredLight: PreferredLight;
  labels: string[];
  benchCode: string | null;
  benchSector: string | null;
}

export interface PackageObservationRecord {
  id: string;
  observedOn: string;
  observer: string;
  entries: ObservationEntry[];
}

export interface PackageFlagRecord {
  id: string;
  accessionNo: string;
  code: string;
  message: string;
  severity: FlagSeverity;
  state: FlagState;
  resolutionNote: string | null;
}

export interface PackageClearanceRecord {
  snapshotId: string;
  generatedOn: string;
  status: ClearanceStatus;
  blockers: ClearanceBlocker[];
}

export interface PackageInventoryEntry {
  key: string;
  label: string;
  count: number;
  detail: string;
}

export interface PackageScopeNote {
  label: string;
  detail: string;
}

export type CompliancePackageStatus = "complete" | "with-exclusions";

export interface CompliancePackage {
  id: string;
  trialId: string;
  trialCode: string;
  trialCropFamily: string;
  version: number;
  generatedOn: string;
  status: CompliancePackageStatus;
  inventory: PackageInventoryEntry[];
  accessions: PackageAccessionRecord[];
  observations: PackageObservationRecord[];
  flags: PackageFlagRecord[];
  clearance: PackageClearanceRecord | null;
  checks: PackageCheckFinding[];
  included: PackageScopeNote[];
  excluded: PackageScopeNote[];
  digest: string;
  exportFileName: string;
}

export interface WorkspaceState {
  trials: Trial[];
  accessions: Accession[];
  benches: Bench[];
  observationPasses: ObservationPass[];
  flags: Flag[];
  clearanceSnapshots: ClearanceSnapshot[];
  compliancePackages: CompliancePackage[];
}
