export type {
  FixKind,
  FixOutcome,
  FixSpec,
  ManualRoute,
  ObjectKind,
  QualityDomain,
  QualityEvidence,
  QualityFinding,
  QualityObjectRef,
  QualityReport,
  QualitySeverity,
  RepairArchive,
  RepairItemRecord,
  RepairJournal,
  RepairJournalVersion,
  RepairOutcome,
  RepairPhase,
} from "./types";
export {
  DOMAIN_LABELS,
  DOMAIN_ORDER,
  OBJECT_KIND_LABELS,
  SEVERITY_LABELS,
  MANUAL_ROUTES,
  buildFinding,
  buildFix,
  evidence,
  objectRef,
} from "./catalog";
export { scanWorkspace } from "./checks";
export { parseCollections } from "./structure";
export { fingerprintState } from "./fingerprint";
export {
  applyFix,
  applyFixPlan,
  previewFixes,
  reconcileBenchStatus,
  selectFixable,
  verifyProjectionReport,
  verifyProjectedState,
} from "./fixes";
export type {
  BatchFixResult,
  DryRunItemResult,
  DryRunResult,
  PlannedFix,
  ProjectionCheck,
} from "./fixes";
export {
  abandonRepair,
  advanceRepair,
  archiveJournal,
  createRepairJournal,
  pendingItems,
  reconcilePendingPlans,
  resolveRepairRecovery,
  rollbackRepair,
} from "./repair";
export type { RecoveryResult } from "./repair";

