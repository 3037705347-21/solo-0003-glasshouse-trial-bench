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

/** 一次观测在去重流程中的生命周期状态。 */
export type PassDedupStatus =
  | "canonical" // 权威记录，或被判定为合理重测后保留
  | "partially_converged" // 部分条目被裁决收敛，剩余条目仍有效
  | "converged"; // 整次观测是重复，已收敛进 canonical 记录

/**
 * 去重身份三元组：
 * - idempotencyToken：表单打开时生成一次、重试时复用，识别"同一次提交的重复送达"。
 * - contentFingerprint：对试验、日期、观测人、全部测量值的规范化哈希，识别"内容相同的重复录入"。
 * - recordedAt：客户端入库时刻，与业务日期 observedOn 分离，用于短窗口与审计排序。
 */
export interface ObservationPass {
  id: string;
  trialId: string;
  observedOn: string;
  observer: string;
  entries: ObservationEntry[];
  idempotencyToken: string;
  contentFingerprint: string;
  recordedAt: string;
  dedupStatus: PassDedupStatus;
  /** 整次或部分被收敛时，收敛去向的权威观测 id。 */
  canonicalPassId?: string;
  /** 条目级收敛：被判定为重复的材料（其余材料仍视为有效测量）。 */
  convergedAccessionIds: string[];
}

export type FlagSeverity = "info" | "warning" | "critical";
/** withdrawn：观测被去重收敛后，其派生出的未处理标记同步撤回，不再阻止放行。 */
export type FlagState = "open" | "resolved" | "waived" | "withdrawn";

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

/** 人工对疑似重复的裁决方向。 */
export type ReviewVerdict = "keep_both" | "converge";
export type ReviewStatus = "pending" | "resolved";
export type ReviewSuggestion = "converge" | "keep_both" | "review";

/**
 * 一次"疑似重复"裁决工单。系统永远不自动删除数据：
 * 只有内容字节级一致才自动收敛；数值落在测量容差内但不完全一致时，必须人工裁决。
 */
export interface DuplicateReview {
  id: string;
  trialId: string;
  status: ReviewStatus;
  candidatePassId: string; // 后提交、等待裁决的观测
  existingPassId: string; // 先前已存在的候选权威观测
  sharedAccessionIds: string[]; // 两次观测共同覆盖的材料
  /** 每个共同材料的数值差异摘要，供裁决人解释决定。 */
  differences: ReviewEntryDifference[];
  suggestion: ReviewSuggestion;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
  verdict?: ReviewVerdict;
  /** converge 时选择保留哪一次的测量作为权威（existing 或 candidate）。 */
  survivorPassId?: string;
  decisionNote?: string;
}

export interface ReviewEntryDifference {
  accessionId: string;
  heightDeltaMm: number;
  leafDelta: number;
  ecDelta: number;
  withinTolerance: boolean;
}

/** 去重决策的不可变审计记录；自动收敛和人工裁决各产生一条，纯重试不产生。 */
export interface DedupAudit {
  id: string;
  trialId: string;
  at: string;
  kind: "auto_converged" | "manual";
  candidatePassId: string;
  canonicalPassId: string;
  convergedAccessionIds: string[];
  reason: string;
  matchedBy: "fingerprint" | "manual_review";
  reviewId?: string;
  decidedBy?: string;
  decisionNote?: string;
  verdict?: ReviewVerdict;
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
  duplicateReviews: DuplicateReview[];
  dedupAudits: DedupAudit[];
}
