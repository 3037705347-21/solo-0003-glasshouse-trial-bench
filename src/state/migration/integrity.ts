/**
 * 升级后的完整性扫描。
 *
 * 它不“修复”任何东西，只负责发现并登记：
 * - dangling reference：引用字段指向不存在的实体（旧数据缺失新关联）。
 *   记录与原始引用值都保留，交由人工决定重新关联 / 保留悬空 /（可空字段）清空。
 * - unknown enum：出现当前代码不认识的枚举值。记录保留，当前代码无法解释，需人工裁决。
 * - unknown field：当前代码不认识的字段。值始终原样保留在记录上，仅做提示。
 *
 * 真正的结构性损坏（集合不是数组、记录没有字符串 id、必填字段类型错误）由
 * runner 判定为升级失败，不在本扫描范围内。
 */
import type { WorkspaceState } from "../../domain/types";
import type {
  DanglingReferenceIssue,
  MigrationIssue,
  ReferencedCollection,
  UnknownEnumValueIssue,
  UnknownFieldIssue,
} from "./types";

type RecordBag = Record<string, unknown>;

export const COLLECTION_KEYS = [
  "trials",
  "accessions",
  "benches",
  "observationPasses",
  "flags",
  "clearanceSnapshots",
] as const;

export type CollectionKey = (typeof COLLECTION_KEYS)[number];

function isRecord(value: unknown): value is RecordBag {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 每个实体当前代码认识的字段（含可选字段）。其余字段一律视为未知字段并保留。
const KNOWN_FIELDS: Record<CollectionKey, ReadonlySet<string>> = {
  trials: new Set([
    "id",
    "code",
    "cropFamily",
    "objective",
    "season",
    "startDate",
    "endDate",
    "state",
  ]),
  accessions: new Set([
    "id",
    "trialId",
    "accessionNo",
    "cultivar",
    "source",
    "propagatedOn",
    "quantity",
    "trayCells",
    "preferredLight",
    "genotypeNote",
    "labels",
    "lifecycleStatus",
    "retiredAt",
    "retirementReason",
    "replacementId",
    "retirementHistory",
  ]),
  benches: new Set([
    "id",
    "code",
    "sector",
    "capacity",
    "assignedIds",
    "lightProfile",
    "irrigationLine",
    "status",
    "blockedReason",
  ]),
  observationPasses: new Set([
    "id",
    "trialId",
    "observedOn",
    "observer",
    "entries",
  ]),
  flags: new Set([
    "id",
    "trialId",
    "accessionId",
    "observationPassId",
    "code",
    "message",
    "severity",
    "state",
    "createdOn",
    "resolvedOn",
    "resolutionNote",
  ]),
  clearanceSnapshots: new Set([
    "id",
    "trialId",
    "generatedOn",
    "status",
    "metrics",
    "blockers",
  ]),
};

const ENUM_FIELDS: Record<
  CollectionKey,
  ReadonlyArray<{ field: string; values: readonly string[] }>
> = {
  trials: [{ field: "state", values: ["draft", "active", "paused", "cleared"] }],
  accessions: [
    {
      field: "preferredLight",
      values: ["full-sun", "partial-shade", "shade"],
    },
    { field: "lifecycleStatus", values: ["active", "retired"] },
  ],
  benches: [
    {
      field: "lightProfile",
      values: ["full-sun", "partial-shade", "shade"],
    },
    {
      field: "status",
      values: ["available", "assigned", "blocked", "quarantine"],
    },
  ],
  observationPasses: [],
  flags: [
    { field: "severity", values: ["info", "warning", "critical"] },
    { field: "state", values: ["open", "resolved", "waived"] },
  ],
  clearanceSnapshots: [{ field: "status", values: ["ready", "blocked"] }],
};

interface ReferenceSpec {
  field: string;
  target: ReferencedCollection;
  issueCode: DanglingReferenceIssue["code"];
  /** 引用为空（未设置）时是否合法。 */
  optional: boolean;
  /** 悬空后是否允许人工通过“清空引用”解决。 */
  clearable: boolean;
}

// 记录上的直接外键。数组型引用（benches.assignedIds、retirementHistory 等）
// 单独处理。
const DIRECT_REFERENCES: Partial<
  Record<CollectionKey, ReadonlyArray<ReferenceSpec>>
> = {
  accessions: [
    {
      field: "trialId",
      target: "trials",
      issueCode: "dangling_trial_reference",
      optional: false,
      clearable: false,
    },
    {
      field: "replacementId",
      target: "accessions",
      issueCode: "dangling_accession_reference",
      optional: true,
      clearable: true,
    },
  ],
  observationPasses: [
    {
      field: "trialId",
      target: "trials",
      issueCode: "dangling_trial_reference",
      optional: false,
      clearable: false,
    },
  ],
  flags: [
    {
      field: "trialId",
      target: "trials",
      issueCode: "dangling_trial_reference",
      optional: false,
      clearable: false,
    },
    {
      field: "accessionId",
      target: "accessions",
      issueCode: "dangling_accession_reference",
      optional: false,
      clearable: false,
    },
    {
      field: "observationPassId",
      target: "observationPasses",
      issueCode: "dangling_pass_reference",
      optional: false,
      clearable: false,
    },
  ],
  clearanceSnapshots: [
    {
      field: "trialId",
      target: "trials",
      issueCode: "dangling_trial_reference",
      optional: false,
      clearable: false,
    },
  ],
};

function labelFor(collection: CollectionKey, record: RecordBag): string {
  const code =
    typeof record.code === "string"
      ? record.code
      : typeof record.accessionNo === "string"
        ? record.accessionNo
        : undefined;
  return code ? `${collection}:${code}` : `${collection}:${String(record.id)}`;
}

export function asRecordBag(value: unknown): RecordBag | undefined {
  return isRecord(value) ? value : undefined;
}

/**
 * 扫描已升级到当前版本的工作区。返回待人工处理项。
 * `now` 以参数注入，保证可测试、结果确定。
 */
export function scanIntegrity(
  state: WorkspaceState,
  now: string,
): MigrationIssue[] {
  const issues: MigrationIssue[] = [];

  const stateBag = state as unknown as RecordBag;
  const idSets: Record<ReferencedCollection, Set<string>> = {
    trials: new Set(),
    accessions: new Set(),
    benches: new Set(),
    observationPasses: new Set(),
    flags: new Set(),
    clearanceSnapshots: new Set(),
  };
  const records: Array<{
    collection: CollectionKey;
    record: RecordBag;
  }> = [];

  for (const key of COLLECTION_KEYS) {
    const collection = stateBag[key];
    if (!Array.isArray(collection)) {
      continue; // 结构损坏由 runner 处理
    }
    for (const item of collection) {
      if (!isRecord(item) || typeof item.id !== "string") {
        continue; // 结构损坏由 runner 处理
      }
      idSets[key].add(item.id);
      records.push({ collection: key, record: item });
    }
  }

  const pushIssue = (issue: MigrationIssue): void => {
    issues.push(issue);
  };

  for (const { collection, record } of records) {
    const ownerId = record.id as string;
    const ownerLabel = labelFor(collection, record);

    // 未知字段：不删除，仅登记。
    const known = KNOWN_FIELDS[collection];
    for (const field of Object.keys(record)) {
      if (!known.has(field)) {
        const issue: UnknownFieldIssue = {
          id: `unknown-field:${collection}:${ownerId}:${field}`,
          code: "unknown_field",
          message: `记录 ${ownerLabel} 包含当前版本不认识的字段「${field}」，该字段已原样保留。`,
          severity: "warning",
          status: "open",
          detectedAt: now,
          ownerCollection: collection,
          ownerId,
          ownerLabel,
          field,
        };
        pushIssue(issue);
      }
    }

    // 未知枚举值。
    for (const { field, values } of ENUM_FIELDS[collection]) {
      const value = record[field];
      if (typeof value === "string" && !values.includes(value)) {
        const issue: UnknownEnumValueIssue = {
          id: `unknown-enum:${collection}:${ownerId}:${field}`,
          code: "unknown_enum_value",
          message: `记录 ${ownerLabel} 的「${field}」取值「${value}」不被当前版本支持，请人工确认后改为受支持的取值。`,
          severity: "critical",
          status: "open",
          detectedAt: now,
          ownerCollection: collection,
          ownerId,
          ownerLabel,
          field,
          unknownValue: value,
          supportedValues: values,
        };
        pushIssue(issue);
      }
    }

    // 直接外键的悬空引用。
    for (const ref of DIRECT_REFERENCES[collection] ?? []) {
      const value = record[ref.field];
      if (value === undefined || value === null || value === "") {
        continue; // 可空字段未设置，合法
      }
      if (typeof value !== "string") {
        continue; // 类型错误属于结构损坏，由 runner 处理
      }
      if (!idSets[ref.target].has(value)) {
        const issue: DanglingReferenceIssue = {
          id: `dangling-ref:${collection}:${ownerId}:${ref.field}:${value}`,
          code: ref.issueCode,
          message: `记录 ${ownerLabel} 的「${ref.field}」引用了不存在的 ${ref.target}（${value}）。记录已保留，请选择目标或保留现状。`,
          severity: "critical",
          status: "open",
          detectedAt: now,
          ownerCollection: collection,
          ownerId,
          ownerLabel,
          field: ref.field,
          missingRef: value,
          targetCollection: ref.target,
          clearable: ref.clearable,
        };
        pushIssue(issue);
      }
    }
  }

  // 数组外键：台架上的 assignedIds。悬空不删除槽位引用，登记为可清空的问题。
  for (const benchRecord of (stateBag.benches as unknown[] | undefined) ?? []) {
    if (!isRecord(benchRecord) || typeof benchRecord.id !== "string") {
      continue;
    }
    const assigned = benchRecord.assignedIds;
    if (!Array.isArray(assigned)) {
      continue;
    }
    const ownerLabel = labelFor("benches", benchRecord);
    for (const candidate of assigned) {
      if (typeof candidate !== "string" || !idSets.accessions.has(candidate)) {
        const missingRef = typeof candidate === "string" ? candidate : String(candidate);
        pushIssue({
          id: `dangling-ref:benches:${benchRecord.id}:assignedIds:${missingRef}`,
          code: "dangling_accession_reference",
          message: `台架 ${ownerLabel} 的分配列表包含不存在的材料（${missingRef}）。槽位引用已保留，请重新关联或从台架移除。`,
          severity: "critical",
          status: "open",
          detectedAt: now,
          ownerCollection: "benches",
          ownerId: benchRecord.id,
          ownerLabel,
          field: "assignedIds",
          missingRef,
          targetCollection: "accessions",
          clearable: true,
        });
      }
    }
  }

  // 停用历史中的替代引用。
  for (const accessionRecord of (stateBag.accessions as unknown[] | undefined) ??
    []) {
    if (!isRecord(accessionRecord) || typeof accessionRecord.id !== "string") {
      continue;
    }
    const history = accessionRecord.retirementHistory;
    if (!Array.isArray(history)) {
      continue;
    }
    const ownerLabel = labelFor("accessions", accessionRecord);
    const accessionId = accessionRecord.id;
    history.forEach((entry, index) => {
      if (
        !isRecord(entry) ||
        typeof entry.replacementId !== "string" ||
        entry.replacementId === ""
      ) {
        return;
      }
      if (!idSets.accessions.has(entry.replacementId)) {
        pushIssue({
          id: `dangling-ref:accessions:${accessionId}:retirementHistory.${index}.replacementId:${entry.replacementId}`,
          code: "dangling_accession_reference",
          message: `材料 ${ownerLabel} 的停用记录引用了不存在的替代材料（${entry.replacementId}）。历史记录已保留。`,
          severity: "warning",
          status: "open",
          detectedAt: now,
          ownerCollection: "accessions",
          ownerId: accessionId,
          ownerLabel,
          field: `retirementHistory.${index}.replacementId`,
          missingRef: entry.replacementId,
          targetCollection: "accessions",
          clearable: true,
        });
      }
    });
  }

  // 观测条目里的材料引用。旧数据的观测行可能引用已不存在的材料：
  // 测量记录（株高/叶片数/电导率）是历史事实，必须保留，只登记悬空引用。
  for (const passRecord of (stateBag.observationPasses as unknown[] | undefined) ??
    []) {
    if (!isRecord(passRecord) || typeof passRecord.id !== "string") {
      continue;
    }
    const entries = passRecord.entries;
    if (!Array.isArray(entries)) {
      continue; // 结构损坏由 runner 处理
    }
    const passLabel = labelFor("observationPasses", passRecord);
    const passId = passRecord.id;
    entries.forEach((entry, index) => {
      if (
        !isRecord(entry) ||
        typeof entry.accessionId !== "string" ||
        entry.accessionId === ""
      ) {
        return; // 类型损坏由 runner 处理
      }
      if (!idSets.accessions.has(entry.accessionId)) {
        pushIssue({
          id: `dangling-ref:observationPasses:${passId}:entries.${index}.accessionId:${entry.accessionId}`,
          code: "dangling_accession_reference",
          message: `观测 ${passLabel} 的第 ${index + 1} 条测量记录引用了不存在的材料（${entry.accessionId}）。测量数据已保留，请重新关联或保留现状。`,
          severity: "critical",
          status: "open",
          detectedAt: now,
          ownerCollection: "observationPasses",
          ownerId: passId,
          ownerLabel: passLabel,
          field: `entries.${index}.accessionId`,
          missingRef: entry.accessionId,
          targetCollection: "accessions",
          // 观测行的材料身份是必填语义，不允许“清空”（那会让测量记录失去归属），
          // 只能重新关联或原样保留并知悉。
          clearable: false,
        });
      }
    });
  }

  return dedupeIssues(issues);
}

/** 按稳定 id 去重，保证重复扫描不会堆积同一问题。 */
export function dedupeIssues(issues: MigrationIssue[]): MigrationIssue[] {
  const byId = new Map<string, MigrationIssue>();
  for (const issue of issues) {
    const existing = byId.get(issue.id);
    if (!existing) {
      byId.set(issue.id, issue);
    }
  }
  return [...byId.values()];
}

/** 合并已登记问题与新扫描结果：保留用户处理状态，关闭已不存在的问题。 */
export function reconcileIssues(
  previous: MigrationIssue[],
  scanned: MigrationIssue[],
): MigrationIssue[] {
  const previousById = new Map(previous.map((issue) => [issue.id, issue]));
  return scanned.map((fresh) => {
    const prior = previousById.get(fresh.id);
    // 问题仍在：保留用户的处理状态与备注，更新文案/严重度。
    if (prior) {
      return { ...fresh, status: prior.status, resolvedAt: prior.resolvedAt, resolutionNote: prior.resolutionNote };
    }
    return fresh;
  });
}
