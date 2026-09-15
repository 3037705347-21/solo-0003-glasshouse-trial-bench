import { GROWTH_BOUNDS, TRAY_CELL_OPTIONS, parseDateOnly } from "../rules";
import type {
  Accession,
  Bench,
  ClearanceBlocker,
  ClearanceMetric,
  ClearanceSnapshot,
  Flag,
  ObservationEntry,
  ObservationPass,
  PreferredLight,
  Trial,
  WorkspaceState,
} from "../types";
import { buildFinding, evidence, objectRef } from "./catalog";
import {
  isNonEmptyString,
  isNumber,
  isRecord,
  isString,
  objectId,
  objectLabel,
} from "./guards";
import type { QualityDomain, QualityFinding, QualitySeverity } from "./types";

export interface ParsedCollections {
  trials: Trial[];
  accessions: Accession[];
  benches: Bench[];
  passes: ObservationPass[];
  flags: Flag[];
  snapshots: ClearanceSnapshot[];
  findings: QualityFinding[];
}

const TRIAL_STATES = ["draft", "active", "paused", "cleared"];
const LIGHTS: PreferredLight[] = ["full-sun", "partial-shade", "shade"];
const BENCH_STATES = ["available", "assigned", "blocked", "quarantine"];
const FLAG_STATES = ["open", "resolved", "waived"];
const FLAG_SEVERITIES = ["info", "warning", "critical"];
const CLEARANCE_STATUSES = ["ready", "blocked"];

type ObjectKind =
  | "trial"
  | "accession"
  | "bench"
  | "pass"
  | "flag"
  | "snapshot";

interface CollectionSpec {
  key: keyof WorkspaceState;
  domain: QualityDomain;
  kind: ObjectKind;
}

const COLLECTION_SPECS: CollectionSpec[] = [
  { key: "trials", domain: "trials", kind: "trial" },
  { key: "accessions", domain: "accessions", kind: "accession" },
  { key: "benches", domain: "benches", kind: "bench" },
  { key: "observationPasses", domain: "observations", kind: "pass" },
  { key: "flags", domain: "flags", kind: "flag" },
  { key: "clearanceSnapshots", domain: "clearance", kind: "snapshot" },
];

const COLLECTION_LABELS: Record<keyof WorkspaceState, string> = {
  trials: "试验",
  accessions: "材料",
  benches: "台架",
  observationPasses: "观测记录",
  flags: "标记",
  clearanceSnapshots: "放行快照",
};

class IssueBuilder {
  readonly findings: QualityFinding[] = [];

  private labelOf(raw: unknown, index: number): string {
    return objectLabel(
      raw,
      ["code", "accessionNo", "observedOn", "generatedOn"],
      `第 ${index + 1} 项`,
    );
  }

  private idOf(raw: unknown, index: number): string {
    return objectId(raw, index);
  }

  malformedObject(spec: CollectionSpec, raw: unknown, index: number, reason: string, ruleCode: string): void {
    this.findings.push(
      buildFinding({
        ruleCode,
        domain: spec.domain,
        severity: "blocking",
        title: `${COLLECTION_LABELS[spec.key]}条目结构损坏`,
        detail: `${COLLECTION_LABELS[spec.key]}集合第 ${index + 1} 项${reason}，已跳过它继续扫描其余对象。`,
        objectRefs: [objectRef(spec.kind, this.idOf(raw, index), this.labelOf(raw, index))],
        evidence: [
          evidence("集合", COLLECTION_LABELS[spec.key]),
          evidence("位置", `第 ${index + 1} 项`),
          evidence("问题", reason),
          evidence(
            "实际类型",
            Array.isArray(raw) ? "数组" : raw === null ? "null" : typeof raw,
          ),
        ],
        idKey: "item",
        manual: {
          path: "/quality",
          actionLabel: "在数据质量中心处理",
          instruction: "条目结构损坏，自动修复可能丢失数据，必须人工核对。",
        },
      }),
    );
  }

  field(input: {
    spec: CollectionSpec;
    raw: Record<string, unknown>;
    index: number;
    ruleCode: string;
    severity?: QualitySeverity;
    title: string;
    detail: string;
    field: string;
    value: unknown;
    idKey: string;
    path?: string;
  }): void {
    const { spec, raw, index } = input;
    this.findings.push(
      buildFinding({
        ruleCode: input.ruleCode,
        domain: spec.domain,
        severity: input.severity ?? "blocking",
        title: input.title,
        detail: input.detail,
        objectRefs: [objectRef(spec.kind, this.idOf(raw, index), this.labelOf(raw, index))],
        evidence: [
          evidence("对象", this.labelOf(raw, index)),
          evidence("字段", input.field),
          evidence("实际值", describeValue(input.value)),
        ],
        idKey: input.idKey,
        manual: {
          path: input.path ?? "/quality",
          actionLabel: "在数据质量中心处理",
          instruction: "字段无效的深层损坏无法安全自动修复，需要人工核对原始数据。",
        },
      }),
    );
  }

  unknownField(
    spec: CollectionSpec,
    raw: Record<string, unknown>,
    index: number,
    field: string,
    value: unknown,
    ruleCode: string,
  ): void {
    this.field({
      spec,
      raw,
      index,
      ruleCode,
      severity: "info",
      title: `${COLLECTION_LABELS[spec.key]}包含未知字段`,
      detail: `字段 ${field} 不属于当前版本的${COLLECTION_LABELS[spec.key]}结构，可能来自更新版本；该字段会被忽略但不会被删除。`,
      field,
      value,
      idKey: `unknown:${field}`,
    });
  }
}

function describeValue(value: unknown): string {
  if (value === undefined) {
    return "缺失（undefined）";
  }
  if (value === null) {
    return "空值（null）";
  }
  if (Array.isArray(value)) {
    return `数组（${value.length} 项）`;
  }
  if (typeof value === "object") {
    return `对象（键：${Object.keys(value).slice(0, 5).join("、")}）`;
  }
  const rendered = String(value);
  return rendered.length > 80 ? `${rendered.slice(0, 80)}…` : rendered;
}

type FieldOptions = { required?: boolean; nonEmpty?: boolean; date?: boolean };

function expectString(
  builder: IssueBuilder,
  spec: CollectionSpec,
  raw: Record<string, unknown>,
  index: number,
  field: string,
  ruleCode: string,
  options: FieldOptions = {},
): boolean {
  const value = raw[field];
  if (value === undefined && !options.required) {
    return true;
  }
  let valid = isString(value);
  if (valid && options.nonEmpty) {
    valid = isNonEmptyString(value);
  }
  if (valid && options.date) {
    valid = Boolean(parseDateOnly(value as string));
  }
  if (!valid) {
    builder.field({
      spec,
      raw,
      index,
      ruleCode,
      title: `${COLLECTION_LABELS[spec.key]}字段无效`,
      detail: `字段 ${field} 必须是${
        options.date
          ? "有效日期字符串（YYYY-MM-DD）"
          : options.nonEmpty
            ? "非空字符串"
            : "字符串"
      }。`,
      field,
      value,
      idKey: field,
    });
    return false;
  }
  return true;
}

function expectEnum<T extends string>(
  builder: IssueBuilder,
  spec: CollectionSpec,
  raw: Record<string, unknown>,
  index: number,
  field: string,
  allowed: readonly T[],
  ruleCode: string,
  severity: QualitySeverity = "blocking",
): boolean {
  const value = raw[field];
  if (isString(value) && allowed.includes(value as T)) {
    return true;
  }
  builder.field({
    spec,
    raw,
    index,
    ruleCode,
    severity,
    title: `${COLLECTION_LABELS[spec.key]}枚举字段无效`,
    detail: `字段 ${field} 必须是以下值之一：${allowed.join("、")}。`,
    field,
    value,
    idKey: field,
  });
  return false;
}

function expectNumber(
  builder: IssueBuilder,
  spec: CollectionSpec,
  raw: Record<string, unknown>,
  index: number,
  field: string,
  ruleCode: string,
  range?: { min?: number; max?: number },
  severity: QualitySeverity = "warning",
): boolean {
  const value = raw[field];
  let valid = isNumber(value);
  if (valid && range) {
    if (range.min !== undefined && (value as number) < range.min) {
      valid = false;
    }
    if (range.max !== undefined && (value as number) > range.max) {
      valid = false;
    }
  }
  if (!valid) {
    builder.field({
      spec,
      raw,
      index,
      ruleCode,
      severity,
      title: `${COLLECTION_LABELS[spec.key]}数值字段无效`,
      detail: `字段 ${field} 必须是${
        range
          ? ` ${range.min ?? "−∞"} 到 ${range.max ?? "+∞"} 之间的`
          : "有限"
      }数值。`,
      field,
      value,
      idKey: field,
    });
    return false;
  }
  return true;
}

function expectStringArray(
  builder: IssueBuilder,
  spec: CollectionSpec,
  raw: Record<string, unknown>,
  index: number,
  field: string,
  ruleCode: string,
): string[] | null {
  const value = raw[field];
  if (!Array.isArray(value) || !value.every((item) => isString(item))) {
    builder.field({
      spec,
      raw,
      index,
      ruleCode,
      title: `${COLLECTION_LABELS[spec.key]}数组字段无效`,
      detail: `字段 ${field} 必须是字符串数组。`,
      field,
      value,
      idKey: field,
    });
    return null;
  }
  return value;
}

function checkUnknownKeys(
  builder: IssueBuilder,
  spec: CollectionSpec,
  raw: Record<string, unknown>,
  index: number,
  known: Set<string>,
  ruleCode: string,
): void {
  Object.keys(raw).forEach((key) => {
    if (!known.has(key)) {
      builder.unknownField(spec, raw, index, key, raw[key], ruleCode);
    }
  });
}

/* ------------------------------------------------------------------ */
/* 各实体深层校验                                                        */
/* ------------------------------------------------------------------ */

const TRIAL_KEYS = new Set([
  "id",
  "code",
  "cropFamily",
  "objective",
  "season",
  "startDate",
  "endDate",
  "state",
]);

function parseTrial(builder: IssueBuilder, raw: unknown, index: number): Trial | null {
  const spec = COLLECTION_SPECS[0];
  if (!isRecord(raw)) {
    builder.malformedObject(spec, raw, index, "不是对象（可能是 null 或基本类型）", "T-STRUCT-01");
    return null;
  }
  const stateOk = expectEnum(builder, spec, raw, index, "state", TRIAL_STATES, "T-STRUCT-02");
  expectString(builder, spec, raw, index, "id", "T-STRUCT-02", { required: true, nonEmpty: true });
  expectString(builder, spec, raw, index, "code", "T-STRUCT-02", { required: true, nonEmpty: true });
  expectString(builder, spec, raw, index, "cropFamily", "T-STRUCT-02", { required: true, nonEmpty: true });
  expectString(builder, spec, raw, index, "objective", "T-STRUCT-02", { required: true, nonEmpty: true });
  expectString(builder, spec, raw, index, "season", "T-STRUCT-02", { required: true, nonEmpty: true });
  expectString(builder, spec, raw, index, "startDate", "T-STRUCT-02", { required: true, date: true });
  expectString(builder, spec, raw, index, "endDate", "T-STRUCT-02", { required: true, date: true });
  checkUnknownKeys(builder, spec, raw, index, TRIAL_KEYS, "T-STRUCT-03");
  return stateOk ? (raw as unknown as Trial) : null;
}

const ACCESSION_KEYS = new Set([
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
]);

function parseAccession(builder: IssueBuilder, raw: unknown, index: number): Accession | null {
  const spec = COLLECTION_SPECS[1];
  if (!isRecord(raw)) {
    builder.malformedObject(spec, raw, index, "不是对象（可能是 null 或基本类型）", "A-STRUCT-01");
    return null;
  }
  const idOk = expectString(builder, spec, raw, index, "id", "A-STRUCT-02", { required: true, nonEmpty: true });
  expectString(builder, spec, raw, index, "accessionNo", "A-STRUCT-02", { required: true, nonEmpty: true });
  expectString(builder, spec, raw, index, "trialId", "A-STRUCT-02", { required: true, nonEmpty: true });
  expectString(builder, spec, raw, index, "cultivar", "A-STRUCT-02", { required: true, nonEmpty: true });
  expectString(builder, spec, raw, index, "source", "A-STRUCT-02", { required: true, nonEmpty: true });
  expectString(builder, spec, raw, index, "genotypeNote", "A-STRUCT-02", { required: true, nonEmpty: true });
  expectEnum(builder, spec, raw, index, "preferredLight", LIGHTS, "A-STRUCT-02");
  expectNumber(builder, spec, raw, index, "quantity", "A-FIELD-02", { min: 1, max: 500 });
  expectString(builder, spec, raw, index, "propagatedOn", "A-FIELD-02", { required: true, date: true });
  const trayOk = expectNumber(builder, spec, raw, index, "trayCells", "A-FIELD-02", undefined, "warning");
  if (trayOk && isNumber(raw.trayCells) && !TRAY_CELL_OPTIONS.includes(raw.trayCells)) {
    builder.field({
      spec,
      raw,
      index,
      ruleCode: "A-FIELD-02",
      severity: "warning",
      title: "穴盘规格不受支持",
      detail: `trayCells 必须是 ${TRAY_CELL_OPTIONS.join("、")} 之一。`,
      field: "trayCells",
      value: raw.trayCells,
      idKey: "trayCells-options",
    });
  }
  const labels = expectStringArray(builder, spec, raw, index, "labels", "A-STRUCT-02");
  checkUnknownKeys(builder, spec, raw, index, ACCESSION_KEYS, "A-STRUCT-03");
  return idOk && labels !== null ? (raw as unknown as Accession) : null;
}

const BENCH_KEYS = new Set([
  "id",
  "code",
  "sector",
  "capacity",
  "assignedIds",
  "lightProfile",
  "irrigationLine",
  "status",
  "blockedReason",
]);

function parseBench(builder: IssueBuilder, raw: unknown, index: number): Bench | null {
  const spec = COLLECTION_SPECS[2];
  if (!isRecord(raw)) {
    builder.malformedObject(spec, raw, index, "不是对象（可能是 null 或基本类型）", "B-STRUCT-01");
    return null;
  }
  const idOk = expectString(builder, spec, raw, index, "id", "B-STRUCT-02", { required: true, nonEmpty: true });
  expectString(builder, spec, raw, index, "code", "B-STRUCT-02", { required: true, nonEmpty: true });
  expectString(builder, spec, raw, index, "sector", "B-STRUCT-02", { required: true, nonEmpty: true });
  expectString(builder, spec, raw, index, "irrigationLine", "B-STRUCT-02", { required: true, nonEmpty: true });
  expectEnum(builder, spec, raw, index, "lightProfile", LIGHTS, "B-STRUCT-02");
  const statusOk = expectEnum(builder, spec, raw, index, "status", BENCH_STATES, "B-STRUCT-02");
  expectNumber(builder, spec, raw, index, "capacity", "B-FIELD-02", { min: 1 }, "warning");
  const assigned = expectStringArray(builder, spec, raw, index, "assignedIds", "B-STRUCT-02");
  if (assigned) {
    assigned.forEach((id, entryIndex) => {
      if (id.trim().length === 0) {
        builder.field({
          spec,
          raw,
          index,
          ruleCode: "B-STRUCT-04",
          title: "台架分配列表包含空 id",
          detail: `assignedIds 第 ${entryIndex + 1} 项是空字符串。`,
          field: `assignedIds[${entryIndex}]`,
          value: id,
          idKey: `assigned-empty-${entryIndex}`,
        });
      }
    });
  }
  if (raw.blockedReason !== undefined && !isString(raw.blockedReason)) {
    builder.field({
      spec,
      raw,
      index,
      ruleCode: "B-STRUCT-02",
      severity: "warning",
      title: "停用原因字段类型错误",
      detail: "blockedReason 存在时必须是字符串。",
      field: "blockedReason",
      value: raw.blockedReason,
      idKey: "blockedReason",
    });
  }
  checkUnknownKeys(builder, spec, raw, index, BENCH_KEYS, "B-STRUCT-03");
  return idOk && statusOk && assigned !== null ? (raw as unknown as Bench) : null;
}

const ENTRY_KEYS = new Set(["accessionId", "heightMm", "leafCount", "ecMs", "notes"]);

function entryIssue(
  builder: IssueBuilder,
  passId: string,
  passLabel: string,
  entryIndex: number,
  field: string,
  value: unknown,
  detail: string,
  ruleCode = "O-STRUCT-05",
  severity: QualitySeverity = "blocking",
): void {
  builder.findings.push(
    buildFinding({
      ruleCode,
      domain: "observations",
      severity,
      title: "测量条目字段无效",
      detail,
      objectRefs: [objectRef("pass", passId, passLabel)],
      evidence: [
        evidence("位置", `entries[${entryIndex}].${field}`),
        evidence("实际值", describeValue(value)),
      ],
      idKey: `${field}-${entryIndex}`,
      manual: {
        path: "/observations",
        actionLabel: "前往生长观测",
        instruction: "测量值是历史证据，必须人工核对，不能自动改写。",
      },
    }),
  );
}

function parseEntry(
  builder: IssueBuilder,
  raw: unknown,
  passId: string,
  passLabel: string,
  entryIndex: number,
): ObservationEntry | null {
  if (!isRecord(raw)) {
    builder.findings.push(
      buildFinding({
        ruleCode: "O-STRUCT-04",
        domain: "observations",
        severity: "blocking",
        title: "测量条目结构损坏",
        detail: `观测 ${passLabel} 的第 ${entryIndex + 1} 个测量条目不是对象（可能是 null），已跳过该条目继续扫描。`,
        objectRefs: [objectRef("pass", passId, passLabel)],
        evidence: [
          evidence("位置", `entries[${entryIndex}]`),
          evidence(
            "实际类型",
            Array.isArray(raw) ? "数组" : raw === null ? "null" : typeof raw,
          ),
        ],
        idKey: `entry-${entryIndex}`,
        manual: {
          path: "/observations",
          actionLabel: "前往生长观测",
          instruction: "测量条目可能包含真实数据，必须人工核对。",
        },
      }),
    );
    return null;
  }
  let valid = true;
  if (!isNonEmptyString(raw.accessionId)) {
    entryIssue(builder, passId, passLabel, entryIndex, "accessionId", raw.accessionId, "测量条目缺少非空的材料 id");
    valid = false;
  }
  const bounds: Array<["heightMm" | "leafCount" | "ecMs", string]> = [
    ["heightMm", "株高"],
    ["leafCount", "叶片数"],
    ["ecMs", "电导率"],
  ];
  bounds.forEach(([field, label]) => {
    const value = raw[field];
    if (!isNumber(value) || value < GROWTH_BOUNDS[field].min || value > GROWTH_BOUNDS[field].max) {
      entryIssue(
        builder,
        passId,
        passLabel,
        entryIndex,
        field,
        value,
        `${label}越界或类型错误（允许 ${GROWTH_BOUNDS[field].min}-${GROWTH_BOUNDS[field].max}）`,
      );
      valid = false;
    }
  });
  if (raw.notes !== undefined && !isString(raw.notes)) {
    entryIssue(
      builder,
      passId,
      passLabel,
      entryIndex,
      "notes",
      raw.notes,
      "备注必须是字符串",
      "O-STRUCT-05",
      "warning",
    );
  }
  Object.keys(raw).forEach((key) => {
    if (!ENTRY_KEYS.has(key)) {
      entryIssue(
        builder,
        passId,
        passLabel,
        entryIndex,
        key,
        raw[key],
        `测量条目包含未知字段 ${key}（可能来自更新版本，会被忽略但不删除）`,
        "O-STRUCT-06",
        "info",
      );
    }
  });
  return valid ? (raw as unknown as ObservationEntry) : null;
}

const PASS_KEYS = new Set(["id", "trialId", "observedOn", "observer", "entries"]);

function parsePass(builder: IssueBuilder, raw: unknown, index: number): ObservationPass | null {
  const spec = COLLECTION_SPECS[3];
  if (!isRecord(raw)) {
    builder.malformedObject(spec, raw, index, "不是对象（可能是 null 或基本类型）", "O-STRUCT-01");
    return null;
  }
  const idOk = expectString(builder, spec, raw, index, "id", "O-STRUCT-02", { required: true, nonEmpty: true });
  expectString(builder, spec, raw, index, "trialId", "O-STRUCT-02", { required: true, nonEmpty: true });
  expectString(builder, spec, raw, index, "observedOn", "O-STRUCT-02", { required: true, date: true });
  expectString(builder, spec, raw, index, "observer", "O-STRUCT-02", { required: true, nonEmpty: true });
  const id = isNonEmptyString(raw.id) ? raw.id : objectId(raw, index);
  const label = objectLabel(raw, ["observedOn", "observer"], objectId(raw, index));
  let entries: ObservationEntry[] | null = null;
  if (!Array.isArray(raw.entries)) {
    builder.field({
      spec,
      raw,
      index,
      ruleCode: "O-STRUCT-02",
      title: "观测缺少测量条目数组",
      detail: "entries 必须是数组，空数组表示无测量记录；null 或其他类型无法参与条目级校验。",
      field: "entries",
      value: raw.entries,
      idKey: "entries",
      path: "/observations",
    });
  } else {
    entries = raw.entries
      .map((entryRaw, entryIndex) =>
        parseEntry(builder, entryRaw, id, label, entryIndex),
      )
      .filter((item): item is ObservationEntry => item !== null);
  }
  checkUnknownKeys(builder, spec, raw, index, PASS_KEYS, "O-STRUCT-06");
  if (!idOk || entries === null) {
    return null;
  }
  return { ...(raw as unknown as Omit<ObservationPass, "entries">), entries };
}

const FLAG_KEYS = new Set([
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
]);

function parseFlag(builder: IssueBuilder, raw: unknown, index: number): Flag | null {
  const spec = COLLECTION_SPECS[4];
  if (!isRecord(raw)) {
    builder.malformedObject(spec, raw, index, "不是对象（可能是 null 或基本类型）", "F-STRUCT-01");
    return null;
  }
  const idOk = expectString(builder, spec, raw, index, "id", "F-STRUCT-02", { required: true, nonEmpty: true });
  expectString(builder, spec, raw, index, "trialId", "F-STRUCT-02", { required: true, nonEmpty: true });
  expectString(builder, spec, raw, index, "accessionId", "F-STRUCT-02", { required: true, nonEmpty: true });
  expectString(builder, spec, raw, index, "observationPassId", "F-STRUCT-02", { required: true, nonEmpty: true });
  expectString(builder, spec, raw, index, "code", "F-STRUCT-02", { required: true, nonEmpty: true });
  expectString(builder, spec, raw, index, "message", "F-STRUCT-02", { required: true, nonEmpty: true });
  expectString(builder, spec, raw, index, "createdOn", "F-STRUCT-02", { required: true, nonEmpty: true });
  expectEnum(builder, spec, raw, index, "severity", FLAG_SEVERITIES, "F-STRUCT-02");
  const stateOk = expectEnum(builder, spec, raw, index, "state", FLAG_STATES, "F-STRUCT-02");
  if (isString(raw.state) && (raw.state === "resolved" || raw.state === "waived")) {
    if (!isNonEmptyString(raw.resolutionNote)) {
      builder.field({
        spec,
        raw,
        index,
        ruleCode: "F-FIELD-02",
        severity: "warning",
        title: "已处理标记缺少处理说明",
        detail: "resolved 或 waived 状态的标记必须提供非空 resolutionNote。",
        field: "resolutionNote",
        value: raw.resolutionNote,
        idKey: "resolutionNote",
      });
    }
    if (!isNonEmptyString(raw.resolvedOn)) {
      builder.field({
        spec,
        raw,
        index,
        ruleCode: "F-FIELD-02",
        severity: "warning",
        title: "已处理标记缺少处理时间",
        detail: "resolved 或 waived 状态的标记必须提供 resolvedOn。",
        field: "resolvedOn",
        value: raw.resolvedOn,
        idKey: "resolvedOn",
      });
    }
  }
  if (
    raw.state === "open" &&
    (raw.resolutionNote !== undefined || raw.resolvedOn !== undefined)
  ) {
    builder.field({
      spec,
      raw,
      index,
      ruleCode: "F-FIELD-03",
      severity: "info",
      title: "未处理标记携带处理信息",
      detail: "open 状态的标记不应携带 resolutionNote 或 resolvedOn，状态与字段不一致。",
      field: "state",
      value: raw.state,
      idKey: "open-with-resolution",
    });
  }
  checkUnknownKeys(builder, spec, raw, index, FLAG_KEYS, "F-STRUCT-03");
  return idOk && stateOk ? (raw as unknown as Flag) : null;
}

function snapshotChildIssue(
  builder: IssueBuilder,
  snapshotId: string,
  snapshotLabel: string,
  position: string,
  value: unknown,
  detail: string,
  ruleCode: string,
): void {
  builder.findings.push(
    buildFinding({
      ruleCode,
      domain: "clearance",
      severity: "blocking",
      title: "快照嵌套条目损坏",
      detail,
      objectRefs: [objectRef("snapshot", snapshotId, snapshotLabel)],
      evidence: [
        evidence("位置", position),
        evidence("实际值", describeValue(value)),
      ],
      idKey: position,
      manual: {
        path: "/clearance",
        actionLabel: "前往试验放行",
        instruction: "快照是不可变历史记录，不会被自动改写或删除，请人工核对。",
      },
    }),
  );
}

function parseMetric(
  builder: IssueBuilder,
  snapshotId: string,
  snapshotLabel: string,
  metricIndex: number,
  raw: unknown,
): ClearanceMetric | null {
  if (!isRecord(raw)) {
    snapshotChildIssue(
      builder,
      snapshotId,
      snapshotLabel,
      `metrics[${metricIndex}]`,
      raw,
      "指标条目必须是对象，当前为 null 或其他类型。",
      "C-STRUCT-05",
    );
    return null;
  }
  let valid = true;
  if (!isNonEmptyString(raw.label)) {
    snapshotChildIssue(builder, snapshotId, snapshotLabel, `metrics[${metricIndex}].label`, raw.label, "指标缺少非空 label", "C-STRUCT-05");
    valid = false;
  }
  if (!isString(raw.detail)) {
    snapshotChildIssue(builder, snapshotId, snapshotLabel, `metrics[${metricIndex}].detail`, raw.detail, "指标 detail 必须是字符串", "C-STRUCT-05");
  }
  if (!isNumber(raw.value)) {
    snapshotChildIssue(builder, snapshotId, snapshotLabel, `metrics[${metricIndex}].value`, raw.value, "指标 value 必须是有限数值", "C-STRUCT-05");
    valid = false;
  }
  return valid ? (raw as unknown as ClearanceMetric) : null;
}

function parseBlocker(
  builder: IssueBuilder,
  snapshotId: string,
  snapshotLabel: string,
  blockerIndex: number,
  raw: unknown,
): ClearanceBlocker | null {
  if (!isRecord(raw)) {
    snapshotChildIssue(
      builder,
      snapshotId,
      snapshotLabel,
      `blockers[${blockerIndex}]`,
      raw,
      "阻止项必须是对象，当前为 null 或其他类型。",
      "C-STRUCT-05",
    );
    return null;
  }
  let valid = true;
  if (!isNonEmptyString(raw.code)) {
    snapshotChildIssue(builder, snapshotId, snapshotLabel, `blockers[${blockerIndex}].code`, raw.code, "阻止项缺少非空 code", "C-STRUCT-05");
    valid = false;
  }
  if (!isString(raw.message)) {
    snapshotChildIssue(builder, snapshotId, snapshotLabel, `blockers[${blockerIndex}].message`, raw.message, "阻止项 message 必须是字符串", "C-STRUCT-05");
    valid = false;
  }
  if (raw.accessionId !== undefined && !isNonEmptyString(raw.accessionId)) {
    snapshotChildIssue(builder, snapshotId, snapshotLabel, `blockers[${blockerIndex}].accessionId`, raw.accessionId, "accessionId 存在时必须是非空字符串", "C-STRUCT-05");
  }
  if (raw.benchId !== undefined && !isNonEmptyString(raw.benchId)) {
    snapshotChildIssue(builder, snapshotId, snapshotLabel, `blockers[${blockerIndex}].benchId`, raw.benchId, "benchId 存在时必须是非空字符串", "C-STRUCT-05");
  }
  return valid ? (raw as unknown as ClearanceBlocker) : null;
}

const SNAPSHOT_KEYS = new Set([
  "id",
  "trialId",
  "generatedOn",
  "status",
  "metrics",
  "blockers",
]);

function parseSnapshot(
  builder: IssueBuilder,
  raw: unknown,
  index: number,
): ClearanceSnapshot | null {
  const spec = COLLECTION_SPECS[5];
  if (!isRecord(raw)) {
    builder.malformedObject(spec, raw, index, "不是对象（可能是 null 或基本类型）", "C-STRUCT-01");
    return null;
  }
  const idOk = expectString(builder, spec, raw, index, "id", "C-STRUCT-02", { required: true, nonEmpty: true });
  expectString(builder, spec, raw, index, "trialId", "C-STRUCT-02", { required: true, nonEmpty: true });
  expectString(builder, spec, raw, index, "generatedOn", "C-STRUCT-02", { required: true, nonEmpty: true });
  const statusOk = expectEnum(builder, spec, raw, index, "status", CLEARANCE_STATUSES, "C-STRUCT-02");
  const id = isNonEmptyString(raw.id) ? raw.id : objectId(raw, index);
  const label = objectLabel(raw, ["generatedOn"], objectId(raw, index));
  let metrics: ClearanceMetric[] | null = null;
  let blockers: ClearanceBlocker[] | null = null;
  if (!Array.isArray(raw.metrics)) {
    builder.field({
      spec,
      raw,
      index,
      ruleCode: "C-STRUCT-02",
      title: "快照缺少指标数组",
      detail: "metrics 必须是数组；null 或其他类型无法参与指标级校验。",
      field: "metrics",
      value: raw.metrics,
      idKey: "metrics",
      path: "/clearance",
    });
  } else {
    metrics = raw.metrics
      .map((metricRaw, metricIndex) =>
        parseMetric(builder, id, label, metricIndex, metricRaw),
      )
      .filter((item): item is ClearanceMetric => item !== null);
  }
  if (!Array.isArray(raw.blockers)) {
    builder.field({
      spec,
      raw,
      index,
      ruleCode: "C-STRUCT-02",
      title: "快照缺少阻止项数组",
      detail: "blockers 必须是数组；null 或其他类型无法参与阻止项级校验。",
      field: "blockers",
      value: raw.blockers,
      idKey: "blockers",
      path: "/clearance",
    });
  } else {
    blockers = raw.blockers
      .map((blockerRaw, blockerIndex) =>
        parseBlocker(builder, id, label, blockerIndex, blockerRaw),
      )
      .filter((item): item is ClearanceBlocker => item !== null);
  }
  checkUnknownKeys(builder, spec, raw, index, SNAPSHOT_KEYS, "C-STRUCT-03");
  // 快照即使嵌套数组含坏条目，也保留“外壳”参与跨对象检查，单个坏快照不能拖垮启动检查。
  if (!idOk || !statusOk || metrics === null || blockers === null) {
    return null;
  }
  return {
    ...(raw as unknown as Omit<ClearanceSnapshot, "metrics" | "blockers">),
    metrics,
    blockers,
  };
}

/* ------------------------------------------------------------------ */
/* 入口                                                                  */
/* ------------------------------------------------------------------ */

export function parseCollections(
  state: Partial<WorkspaceState> | null | undefined,
): ParsedCollections {
  const builder = new IssueBuilder();
  const safeState = isRecord(state) ? state : {};

  COLLECTION_SPECS.forEach((spec) => {
    const value = safeState[spec.key];
    if (!Array.isArray(value)) {
      builder.findings.push(
        buildFinding({
          ruleCode: "COLLECTION-01",
          domain: spec.domain,
          severity: "blocking",
          title: `${COLLECTION_LABELS[spec.key]}集合缺失或类型错误`,
          detail: `顶层字段 ${spec.key} 必须是数组；当前为 ${
            value === null ? "null" : typeof value
          }，该集合按空处理，但问题已记录。`,
          evidence: [
            evidence("字段", spec.key),
            evidence("实际类型", value === null ? "null" : typeof value),
          ],
          idKey: `collection-${spec.key}`,
          manual: {
            path: "/quality",
            actionLabel: "在数据质量中心处理",
            instruction: "顶层集合结构错误，必须人工核对持久化数据。",
          },
        }),
      );
    }
  });

  const trials = (Array.isArray(safeState.trials) ? safeState.trials : [])
    .map((raw, index) => parseTrial(builder, raw, index))
    .filter((item): item is Trial => item !== null);
  const accessions = (Array.isArray(safeState.accessions) ? safeState.accessions : [])
    .map((raw, index) => parseAccession(builder, raw, index))
    .filter((item): item is Accession => item !== null);
  const benches = (Array.isArray(safeState.benches) ? safeState.benches : [])
    .map((raw, index) => parseBench(builder, raw, index))
    .filter((item): item is Bench => item !== null);
  const passes = (Array.isArray(safeState.observationPasses) ? safeState.observationPasses : [])
    .map((raw, index) => parsePass(builder, raw, index))
    .filter((item): item is ObservationPass => item !== null);
  const flags = (Array.isArray(safeState.flags) ? safeState.flags : [])
    .map((raw, index) => parseFlag(builder, raw, index))
    .filter((item): item is Flag => item !== null);
  const snapshots = (Array.isArray(safeState.clearanceSnapshots) ? safeState.clearanceSnapshots : [])
    .map((raw, index) => parseSnapshot(builder, raw, index))
    .filter((item): item is ClearanceSnapshot => item !== null);

  return {
    trials,
    accessions,
    benches,
    passes,
    flags,
    snapshots,
    findings: builder.findings,
  };
}
