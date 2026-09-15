/**
 * 升级运行器：从任意历史版本的原始落盘载荷，得到当前版本的工作区。
 *
 * 结果是显式的 MigrationResult：
 * - ok:true  —— 升级成功（可能携带待人工处理项，调用方必须展示）；
 * - ok:false —— 无法安全升级，调用方必须进入恢复模式，绝不能落盘覆盖、
 *               也绝不能用示例工作区顶替。
 *
 * 结构性校验（这些一旦不满足，任何“识别出的历史事实”都无法被安全引用，
 * 因此判失败而不是猜测修复）：
 * - 载荷不是 JSON 对象；
 * - 版本号缺失或高于当前版本（来自更新版本的数据，旧代码无权改写）；
 * - 六个集合缺失或不是数组；
 * - 集合元素不是对象或缺少字符串 id；
 * - 某个已注册迁移步骤抛错。
 */
import type { WorkspaceState } from "../../domain/types";
import {
  reconcileIssues,
  scanIntegrity,
  COLLECTION_KEYS,
  type CollectionKey,
} from "./integrity";
import { STATE_MIGRATIONS } from "./registry";
import {
  CURRENT_SCHEMA_VERSION,
  type MigrationFailure,
  type MigrationIssue,
  type MigrationResult,
  type MigrationStepRecord,
} from "./types";

type RecordBag = Record<string, unknown>;

function isRecord(value: unknown): value is RecordBag {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function failure(
  code: MigrationFailure["code"],
  message: string,
  raw: unknown,
  failedStep?: MigrationFailure["failedStep"],
): MigrationFailure {
  return { ok: false, code, message, raw, failedStep };
}

/**
 * 从旧信封/旧载荷中取出状态与版本。
 * 兼容 v1 应用写出的 `{ version: 1, savedAt, state }` 信封，
 * 以及更早、可能直接内联的形状（此处保守地只承认这两种）。
 */
function extractStateAndVersion(
  parsed: RecordBag,
): { state: unknown; version: unknown } | undefined {
  if (isRecord(parsed.state) && typeof parsed.schemaVersion === "number") {
    return { state: parsed.state, version: parsed.schemaVersion };
  }
  if (isRecord(parsed.state) && typeof parsed.version === "number") {
    return { state: parsed.state, version: parsed.version };
  }
  return undefined;
}

function structurallyValidState(state: unknown): state is WorkspaceState {
  if (!isRecord(state)) {
    return false;
  }
  for (const key of COLLECTION_KEYS) {
    const collection = (state as RecordBag)[key];
    if (!Array.isArray(collection)) {
      return false;
    }
    for (const item of collection) {
      if (!isRecord(item) || typeof item.id !== "string" || item.id === "") {
        return false;
      }
    }
  }
  return true;
}

/** 必填外键字段类型必须是字符串（可选字段允许缺省，但给了就必须是字符串）。 */
function validateReferenceFieldTypes(state: WorkspaceState): string | undefined {
  const required: Array<[CollectionKey, string]> = [
    ["accessions", "trialId"],
    ["observationPasses", "trialId"],
    ["flags", "trialId"],
    ["flags", "accessionId"],
    ["flags", "observationPassId"],
    ["clearanceSnapshots", "trialId"],
  ];
  const bag = state as unknown as Record<string, unknown[]>;
  for (const [collection, field] of required) {
    for (const item of bag[collection] as RecordBag[]) {
      if (typeof item[field] !== "string") {
        return `${collection}.${field}`;
      }
    }
  }
  for (const accession of bag.accessions as RecordBag[]) {
    if (
      accession.replacementId !== undefined &&
      typeof accession.replacementId !== "string"
    ) {
      return "accessions.replacementId";
    }
    if (!Array.isArray(accession.labels)) {
      return "accessions.labels";
    }
  }
  for (const bench of bag.benches as RecordBag[]) {
    if (!Array.isArray(bench.assignedIds)) {
      return "benches.assignedIds";
    }
  }
  return undefined;
}

/**
 * 执行升级。
 * @param rawText localStorage 中读到的原始字符串（未解析，便于损坏时原样导出）
 * @param now 注入当前时间，保证结果确定、可测试
 */
export function migrateWorkspace(rawText: string, now: string): MigrationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return failure(
      "invalid_json",
      "工作区数据不是有效的 JSON，可能已损坏。原始内容已保留，请导出后人工处理。",
      rawText,
    );
  }

  if (!isRecord(parsed)) {
    return failure(
      "invalid_envelope",
      "工作区数据的顶层结构不是对象，无法识别其版本。",
      parsed,
    );
  }

  const extracted = extractStateAndVersion(parsed);
  if (!extracted) {
    return failure(
      "invalid_envelope",
      "工作区数据缺少可识别的版本号或状态体。",
      parsed,
    );
  }

  const startVersion = Math.trunc(Number(extracted.version));
  if (!Number.isInteger(startVersion) || startVersion < 1) {
    return failure(
      "invalid_envelope",
      `无法识别的工作区版本号：${String(extracted.version)}。`,
      parsed,
    );
  }
  if (startVersion > CURRENT_SCHEMA_VERSION) {
    return failure(
      "unsupported_future_version",
      `工作区数据版本 ${startVersion} 高于当前应用支持的版本 ${CURRENT_SCHEMA_VERSION}。请升级应用后再打开，避免旧程序改写新数据。`,
      parsed,
    );
  }

  let working = extracted.state;
  const history: MigrationStepRecord[] = [];

  // 起始结构校验（v1 自身也必须结构成立）。
  if (!structurallyValidState(working)) {
    return failure(
      "corrupt_collections",
      "工作区的集合结构损坏（集合不是数组，或记录缺少 id）。无法在不丢事实的前提下自动升级。",
      parsed,
    );
  }

  // 逐版本串行迁移，永不跳版本。
  let version = startVersion;
  while (version < CURRENT_SCHEMA_VERSION) {
    const step = STATE_MIGRATIONS.find((item) => item.fromVersion === version);
    if (!step) {
      return failure(
        "migration_threw",
        `缺少从版本 ${version} 出发的迁移步骤，升级链断裂。`,
        parsed,
      );
    }
    try {
      working = step.migrate(working);
    } catch (cause) {
      return failure(
        "migration_threw",
        `从版本 ${step.fromVersion} 升级到 ${step.toVersion}（${step.name}）时失败：${
          cause instanceof Error ? cause.message : String(cause)
        }`,
        parsed,
        {
          fromVersion: step.fromVersion,
          toVersion: step.toVersion,
          migration: step.name,
        },
      );
    }
    if (!structurallyValidState(working)) {
      return failure(
        "corrupt_collections",
        `迁移 ${step.name} 产出了结构损坏的状态，已中止。`,
        parsed,
        {
          fromVersion: step.fromVersion,
          toVersion: step.toVersion,
          migration: step.name,
        },
      );
    }
    history.push({
      fromVersion: step.fromVersion,
      toVersion: step.toVersion,
      migration: step.name,
      migratedAt: now,
    });
    version = step.toVersion;
  }

  const state = working as WorkspaceState;
  const badField = validateReferenceFieldTypes(state);
  if (badField) {
    return failure(
      "corrupt_collections",
      `字段 ${badField} 的类型不符合当前版本要求，无法安全解释引用关系。`,
      parsed,
    );
  }

  // 引用完整性等问题：记录保留，登记为待人工处理项（不是失败）。
  const issues: MigrationIssue[] = scanIntegrity(state, now);

  return {
    ok: true,
    state,
    schemaVersion: CURRENT_SCHEMA_VERSION,
    issues,
    history,
  };
}

/** 对“已经是当前版本”的工作区重新做完整性扫描（用于加载现存数据或人工处理后复检）。 */
export function rescanCurrentWorkspace(
  state: WorkspaceState,
  previous: MigrationIssue[],
  now: string,
): MigrationIssue[] {
  return reconcileIssues(previous, scanIntegrity(state, now));
}
