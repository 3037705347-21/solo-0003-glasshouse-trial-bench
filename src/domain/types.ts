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
export type AccessionLifecycle = "active" | "retired" | "merged";

export interface AccessionRetirementRecord {
  id: string;
  retiredAt: string;
  reason: string;
  replacementId?: string;
  restoredAt?: string;
}

/**
 * 合并时被丢弃的同 pass 观测条目：存活者条目唯一入库，
 * 被合并来源的测量值不做静默删除，完整留档在这里。
 */
export interface DiscardedObservationEntry {
  passId: string;
  observedOn: string;
  observer: string;
  heightMm: number;
  leafCount: number;
  ecMs: number;
  notes: string;
  keptSourceId: string;
}

/** 身份合并审计记录，随合并提交不可变保存。 */
export interface AccessionMergeRecord {
  id: string;
  mergeId: string;
  survivorId: string;
  mergedIds: string[];
  mergedOn: string;
  reason: string;
  /** 合并后存活者每个冲突字段最终采用的值与来源。 */
  fieldResolutions: Array<{
    field: MergeFieldKey | "quantity";
    chosenSourceId: string;
    strategy: "keep" | "sum" | "custom";
  }>;
  /** 重写前各来源所在的台架，供审计“物理位置冲突如何裁决”。 */
  benchResolutions: Array<{
    sourceId: string;
    fromBenchId?: string;
    action: "kept" | "removed";
  }>;
  /** 同 pass 观测碰撞中被丢弃的测量值。 */
  discardedObservations: DiscardedObservationEntry[];
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
  /** 仅当 lifecycleStatus === "merged" 时存在：身份别名指向存活者。 */
  mergedIntoId?: string;
  mergedAt?: string;
  /** 指向描述本次合并的审计记录。 */
  mergeRecordId?: string;
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
  /** 合并重写后，保留测量值最初录入的批次身份。 */
  sourceAccessionId?: string;
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
  /** 合并重写后，标记最初派生自哪个批次。 */
  sourceAccessionId?: string;
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
  mergeRecords: AccessionMergeRecord[];
  duplicateReviews: DuplicateReview[];
}

export type MergeFieldKey =
  | "accessionNo"
  | "cultivar"
  | "source"
  | "propagatedOn"
  | "trayCells"
  | "preferredLight"
  | "genotypeNote";

export type DuplicateVerdict = "likely" | "possible";

export interface DuplicateSignal {
  code: string;
  label: string;
  detail: string;
  weight: number;
  matching: boolean;
}

export interface DuplicateCandidatePair {
  key: string;
  leftId: string;
  rightId: string;
  score: number;
  verdict: DuplicateVerdict;
  signals: DuplicateSignal[];
  strongDistinctions: DuplicateSignal[];
}

export type DuplicateReviewDecision = "dismissed" | "open";

export interface DuplicateReview {
  id: string;
  pairKey: string;
  leftId: string;
  rightId: string;
  decision: DuplicateReviewDecision;
  decidedOn: string;
  note?: string;
}
