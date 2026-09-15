import type { WorkspaceState } from "../types";

/**
 * 数据质量中心覆盖的领域：六个实体领域，加上跨持久化版本的引导检查。
 */
export type QualityDomain =
  | "trials"
  | "accessions"
  | "benches"
  | "observations"
  | "flags"
  | "clearance"
  | "persistence";

/**
 * blocking：跨对象引用断裂或核心不变量被破坏，继续工作流会扩散错误。
 * warning：完整性风险，需要人工判断但不会立即阻断。
 * info：可追溯的偏差或历史记录问题。
 */
export type QualitySeverity = "blocking" | "warning" | "info";

export type ObjectKind =
  | "trial"
  | "accession"
  | "bench"
  | "pass"
  | "flag"
  | "snapshot"
  | "storage";

export interface QualityObjectRef {
  kind: ObjectKind;
  id: string;
  label: string;
}

export interface QualityEvidence {
  label: string;
  value: string;
}

/**
 * 可安全自动修复的问题种类。每一种修复都是确定性、幂等的，
 * 只解除引用链接或校正派生字段，绝不删除观测/标记/快照等历史记录。
 */
export type FixKind =
  | "bench.unassign"
  | "bench.dedupe"
  | "bench.reconcile-status"
  | "bench.release-all"
  | "accession.detangle-benches"
  | "flag.correct-trial";

export interface FixSpec {
  kind: FixKind;
  /** 一句话说明会执行什么操作，例如“从台架 E-2 移出 ACC-0009”。 */
  action: string;
  /** 为什么这个修复可以安全自动执行。 */
  rationale: string;
  /** 修复执行所需的确定性上下文（对象 id、保留选择等）。 */
  context: Record<string, string | string[]>;
}

export interface ManualRoute {
  path: string;
  actionLabel: string;
  instruction: string;
}

export interface QualityFinding {
  /** 稳定标识：规则代码 + 涉及对象的确定性组合，跨扫描保持不变。 */
  id: string;
  ruleCode: string;
  domain: QualityDomain;
  severity: QualitySeverity;
  title: string;
  detail: string;
  objectRefs: QualityObjectRef[];
  evidence: QualityEvidence[];
  fix?: FixSpec;
  manual?: ManualRoute;
}

export interface QualityReport {
  scannedAt: string;
  findings: QualityFinding[];
  blocking: QualityFinding[];
  warning: QualityFinding[];
  info: QualityFinding[];
  counts: Record<QualitySeverity, number>;
  byDomain: Record<QualityDomain, QualityFinding[]>;
  healthy: boolean;
}

export type FixStatus = "applied" | "already-fixed" | "conflict";

export interface FixOutcome {
  status: FixStatus;
  state: WorkspaceState;
  changes: string[];
  conflictReason?: string;
}

/** 修复会话中的单条记录，状态机会随整批执行推进。 */
export interface RepairItemRecord {
  findingId: string;
  ruleCode: string;
  severity: QualitySeverity;
  title: string;
  action: string;
  fix?: FixSpec;
  status: "pending" | FixStatus;
  changes: string[];
  conflictReason?: string;
  appliedAt?: string;
}

export type RepairOutcome = "applied" | "rolled-back" | "abandoned";
export interface RepairJournal {
  id: string;
  startedAt: string;
  updatedAt: string;
  status: "in_progress" | "completed";
  outcome?: RepairOutcome;
  stateBefore: WorkspaceState;
  stateAfter?: WorkspaceState;
  items: RepairItemRecord[];
  completedAt?: string;
}

export interface RepairArchive {
  active: RepairJournal | null;
  history: RepairJournal[];
}
