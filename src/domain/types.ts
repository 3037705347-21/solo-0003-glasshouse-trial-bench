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

export interface ClearanceSnapshot {
  id: string;
  trialId: string;
  generatedOn: string;
  status: ClearanceStatus;
  metrics: ClearanceMetric[];
  blockers: ClearanceBlocker[];
}

export type AttachmentSubjectKind = "accession" | "observationPass" | "flag";

export type AttachmentTransferMode = "duplicate" | "merge";

/**
 * 附件从其他记录复制或合并而来时的溯源信息。
 * 全部字段在转移时固化，即使来源记录之后被移除，
 * 溯源标签也不会变成断链。
 */
export interface AttachmentOrigin {
  attachmentId: string;
  subjectKind: AttachmentSubjectKind;
  subjectId: string;
  subjectLabel: string;
  transferredBy: AttachmentTransferMode;
  transferredAt: string;
}

export interface Attachment {
  id: string;
  subjectKind: AttachmentSubjectKind;
  subjectId: string;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
  checksum: string;
  /** base64 数据地址；为空字符串表示内容缺失（例如导入数据不完整）。 */
  dataUrl: string;
  uploadedAt: string;
  origin?: AttachmentOrigin;
}

export interface WorkspaceState {
  trials: Trial[];
  accessions: Accession[];
  benches: Bench[];
  observationPasses: ObservationPass[];
  flags: Flag[];
  clearanceSnapshots: ClearanceSnapshot[];
  attachments: Attachment[];
}
