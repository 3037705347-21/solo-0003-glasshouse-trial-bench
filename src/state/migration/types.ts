/**
 * 工作区数据升级机制的对外类型。
 *
 * 设计要点：
 * - 升级是有版本号的、逐版本串行的迁移链（从旧到新），永不跳版本改写。
 * - 识别出的历史事实一律保留：未知字段原样透传，引用缺失只登记为“待人工处理项”，
 *   不静默删除记录。
 * - 升级结果是显式判别联合：成功、带人工处理项的成功、无法自动处理的失败。
 *   失败永远不能被伪装成成功（调用方必须进入恢复模式而不是落盘覆盖）。
 */
import type { WorkspaceState } from "../../domain/types";

/** 当前代码能够读写的工作区结构版本。 */
export const CURRENT_SCHEMA_VERSION = 2;

/** 落盘信封版本，与领域状态版本独立演进（仅在信封本身形状变化时提升）。 */
export const ENVELOPE_VERSION = 1;

// ---------------------------------------------------------------------------
// 待人工处理项（migration issue）
// ---------------------------------------------------------------------------

export type IssueSeverity = "warning" | "critical";

/** 引用所指向的实体集合。 */
export type ReferencedCollection =
  | "trials"
  | "accessions"
  | "benches"
  | "observationPasses"
  | "flags"
  | "clearanceSnapshots";

export type IssueStatus = "open" | "resolved" | "ignored";

interface IssueBase {
  /** 稳定标识：同一份旧数据多次升级应得到同一批 id，便于幂等去重。 */
  id: string;
  code: string;
  message: string;
  severity: IssueSeverity;
  status: IssueStatus;
  /** 升级发现该问题的时间（ISO），用户处理后会更新。 */
  detectedAt: string;
  resolvedAt?: string;
  resolutionNote?: string;
}

/** 记录中的引用字段指向了一个不存在的实体（旧数据缺失新关联的典型情形）。 */
export interface DanglingReferenceIssue extends IssueBase {
  code:
    | "dangling_trial_reference"
    | "dangling_accession_reference"
    | "dangling_bench_reference"
    | "dangling_pass_reference";
  /** 持有坏引用的记录所在集合。 */
  ownerCollection: ReferencedCollection;
  /** 持有坏引用的记录 id。 */
  ownerId: string;
  /** 便于人工定位的描述，例如材料编号或台架编号。 */
  ownerLabel: string;
  /** 出问题的字段名。 */
  field: string;
  /** 原始（悬空）引用值，永远保留以便追溯。 */
  missingRef: string;
  /** 该引用应当指向的集合。 */
  targetCollection: ReferencedCollection;
  /** 该字段是否允许通过“清空引用”来解决（例如 observationPassId 不可清空）。 */
  clearable: boolean;
}

/** 记录包含当前代码不认识的枚举值；记录被保留，但当前代码无法安全解释。 */
export interface UnknownEnumValueIssue extends IssueBase {
  code: "unknown_enum_value";
  ownerCollection: ReferencedCollection;
  ownerId: string;
  ownerLabel: string;
  field: string;
  unknownValue: string;
  /** 当前代码支持的取值，供人工对照修正。 */
  supportedValues: readonly string[];
}

/**
 * 当前代码不认识的字段。值不会被丢弃（始终原样保留在记录上），
 * 这里只做提示——可能来自更新的版本或已下线的实验字段。
 */
export interface UnknownFieldIssue extends IssueBase {
  code: "unknown_field";
  ownerCollection: ReferencedCollection;
  ownerId: string;
  ownerLabel: string;
  field: string;
}

export type MigrationIssue =
  | DanglingReferenceIssue
  | UnknownEnumValueIssue
  | UnknownFieldIssue;

export function isDanglingReferenceIssue(
  issue: MigrationIssue,
): issue is DanglingReferenceIssue {
  return issue.code.startsWith("dangling_");
}

// ---------------------------------------------------------------------------
// 升级日志
// ---------------------------------------------------------------------------

export interface MigrationStepRecord {
  /** 迁移起点版本。 */
  fromVersion: number;
  /** 迁移目标版本。 */
  toVersion: number;
  /** 该步骤注册的迁移名称，便于排查。 */
  migration: string;
  migratedAt: string;
}

// ---------------------------------------------------------------------------
// 升级结果
// ---------------------------------------------------------------------------

export interface MigratedWorkspace {
  state: WorkspaceState;
  /** 升级后达到的结构版本。 */
  schemaVersion: number;
  issues: MigrationIssue[];
  history: MigrationStepRecord[];
}

export type MigrationFailureCode =
  | "invalid_json"
  | "invalid_envelope"
  | "unsupported_future_version"
  | "corrupt_collections"
  | "migration_threw";

export interface MigrationFailure {
  ok: false;
  code: MigrationFailureCode;
  message: string;
  /** 出错的迁移步骤（若在某个版本步骤中失败）。 */
  failedStep?: { fromVersion: number; toVersion: number; migration: string };
  /** 导致失败的原始载荷（JSON 文本无法解析时为原始字符串）。 */
  raw: unknown;
}

export type MigrationResult =
  | ({ ok: true } & MigratedWorkspace)
  | MigrationFailure;

// ---------------------------------------------------------------------------
// 落盘信封
// ---------------------------------------------------------------------------

/**
 * 每个版本写入磁盘的包裹结构。
 *
 * - `preMigrationSnapshot`：仅当本次保存由一次升级触发时存在，保存的是升级前的
 *   原始信封（含旧版本 state）。它是升级的“后悔药”：即使升级后的数据被证明有问题，
 *   也能取回升级前逐字的历史事实。升级稳定后的后续日常保存会保留该快照，直到
 *   下一次升级才被替换。
 */
export interface StoredEnvelope {
  envelopeVersion: number;
  schemaVersion: number;
  savedAt: string;
  state: WorkspaceState;
  issues: MigrationIssue[];
  migrationHistory: MigrationStepRecord[];
  preMigrationSnapshot?: unknown;
}
