import { createId } from "./id";
import type {
  Accession,
  Bench,
  BenchStatus,
  ClearanceSnapshot,
  Flag,
  FlagSeverity,
  FlagState,
  ObservationPass,
  PreferredLight,
  Trial,
  TrialState,
  WorkspaceState,
} from "./types";

/**
 * 追加式工作区审计日志。
 *
 * 条目只保存「人能读懂的摘要」：变化字段的前后值、计数和编号，
 * 绝不复制整份工作区状态，长文本字段也会被截断，避免敏感或冗余信息落盘。
 */

export type AuditObjectType =
  | "workspace"
  | "trial"
  | "accession"
  | "bench"
  | "observation"
  | "flag"
  | "snapshot";

export type AuditOpType =
  | "trial.created"
  | "trial.transitioned"
  | "accession.created"
  | "accession.updated"
  | "bench.assigned"
  | "bench.released"
  | "bench.batch-released"
  | "observation.recorded"
  | "flag.transitioned"
  | "clearance.generated"
  | "workspace.replaced";

export interface AuditChange {
  field: string;
  label: string;
  before?: string;
  after?: string;
}

export type AuditItemKind = "created" | "updated" | "removed";

export interface AuditItem {
  objectType: AuditObjectType;
  objectId: string;
  /** 操作发生时捕获的对象短摘要，即使对象后来被删除也能显示。 */
  objectLabel: string;
  kind: AuditItemKind;
  changes: AuditChange[];
  resultLabel?: string;
  /** 便于跳回相关对象所在的试验视图。 */
  trialId?: string;
}

export interface AuditEntry {
  /** 单调递增序号，由 reducer 分配，保证相邻操作可比较。 */
  seq: number;
  id: string;
  at: string;
  op: AuditOpType;
  summary: string;
  outcomeLabel?: string;
  /** 一次整体操作（重置、导入恢复、批量移出）包含多个对象条目。 */
  items: AuditItem[];
}

/** 单条审计条目允许的最大对象数，避免异常导入刷爆存储。 */
export const AUDIT_ITEMS_CAP = 200;
/** 审计日志保留的最大条目数，超出后丢弃最旧条目。 */
export const AUDIT_ENTRIES_CAP = 2000;

const LONG_TEXT = 48;
const LIST_ITEMS = 3;

export function clip(value: unknown, max = LONG_TEXT): string {
  const text = typeof value === "string" ? value : String(value ?? "");
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

/* ------------------------------------------------------------------ */
/* 显示名称与枚举翻译                                                   */
/* ------------------------------------------------------------------ */

export const trialStateLabel: Record<TrialState, string> = {
  draft: "草稿",
  active: "进行中",
  paused: "已暂停",
  cleared: "已放行",
};

export const flagStateLabel: Record<FlagState, string> = {
  open: "未处理",
  resolved: "已解决",
  waived: "已豁免",
};

export const flagSeverityLabel: Record<FlagSeverity, string> = {
  info: "提示",
  warning: "警告",
  critical: "严重",
};

export const benchStatusLabel: Record<BenchStatus, string> = {
  available: "可用",
  assigned: "已分配",
  blocked: "受限",
  quarantine: "隔离",
};

export const lightLabel: Record<PreferredLight, string> = {
  "full-sun": "全日照",
  "partial-shade": "半阴",
  shade: "遮阴",
};

export const objectTypeLabel: Record<AuditObjectType, string> = {
  workspace: "工作区",
  trial: "试验",
  accession: "材料",
  bench: "台架",
  observation: "观测",
  flag: "标记",
  snapshot: "放行快照",
};

export function trialLabel(trial: Pick<Trial, "code">): string {
  return trial.code;
}

export function accessionLabel(
  accession: Pick<Accession, "accessionNo" | "cultivar">,
): string {
  return `${accession.accessionNo} ${accession.cultivar}`;
}

export function benchLabel(bench: Pick<Bench, "code" | "sector">): string {
  return `${bench.code} ${bench.sector}`;
}

export function passLabel(pass: Pick<ObservationPass, "observedOn">): string {
  return `${pass.observedOn} 观测`;
}

/* ------------------------------------------------------------------ */
/* 字段差异                                                             */
/* ------------------------------------------------------------------ */

const FIELD_LABELS: Record<string, string> = {
  // trial
  state: "状态",
  code: "编号",
  cropFamily: "作物科属",
  objective: "目标",
  season: "季节",
  startDate: "开始日期",
  endDate: "结束日期",
  // accession
  accessionNo: "材料编号",
  cultivar: "品种",
  source: "来源",
  propagatedOn: "繁殖日期",
  quantity: "数量",
  trayCells: "穴盘规格",
  preferredLight: "适宜光照",
  genotypeNote: "基因型说明",
  labels: "标签",
  // bench
  sector: "区域",
  capacity: "容量",
  assignedIds: "已分配材料",
  lightProfile: "光照类型",
  irrigationLine: "灌溉管路",
  status: "运行状态",
  blockedReason: "停用原因",
  // observation
  observedOn: "观测日期",
  observer: "观测人",
  entries: "测量记录",
  // flag
  severity: "严重程度",
  message: "描述",
  resolutionNote: "处理说明",
  resolvedOn: "处理时间",
};

const LONG_FIELDS = new Set([
  "objective",
  "genotypeNote",
  "message",
  "resolutionNote",
  "blockedReason",
]);

export function fieldLabel(field: string): string {
  return FIELD_LABELS[field] ?? field;
}

function formatScalar(field: string, value: unknown): string {
  if (value === undefined || value === null || value === "") {
    return "（空）";
  }
  switch (field) {
    case "state":
      // 试验状态与标记状态取值互不相交，统一在此翻译。
      return (
        trialStateLabel[value as TrialState] ??
        flagStateLabel[value as FlagState] ??
        String(value)
      );
    case "preferredLight":
    case "lightProfile":
      return lightLabel[value as PreferredLight] ?? String(value);
    case "status":
      return benchStatusLabel[value as BenchStatus] ?? String(value);
    case "severity":
      return flagSeverityLabel[value as FlagSeverity] ?? String(value);
    case "labels":
      return Array.isArray(value) ? value.join(", ") || "（无标签）" : String(value);
    default:
      return String(value);
  }
}

function formatField(field: string, value: unknown): string {
  const text = formatScalar(field, value);
  return LONG_FIELDS.has(field) ? clip(text, 40) : text;
}

function change(field: string, before: unknown, after: unknown): AuditChange {
  return {
    field,
    label: fieldLabel(field),
    before: before === undefined ? undefined : formatField(field, before),
    after: after === undefined ? undefined : formatField(field, after),
  };
}

function diffFields<T extends object>(
  before: T,
  after: T,
  fields: Array<keyof T>,
): AuditChange[] {
  const changes: AuditChange[] = [];
  fields.forEach((field) => {
    const left = before[field];
    const right = after[field];
    if (JSON.stringify(left) !== JSON.stringify(right)) {
      changes.push(change(field as string, left, right));
    }
  });
  return changes;
}

function accessionNoList(
  ids: string[],
  state: WorkspaceState,
): string {
  if (ids.length === 0) {
    return "（空）";
  }
  const names = ids.map(
    (id) =>
      state.accessions.find((accession) => accession.id === id)?.accessionNo ??
      id,
  );
  const head = names.slice(0, LIST_ITEMS).join("、");
  return names.length > LIST_ITEMS ? `${head} 等 ${names.length} 个` : head;
}

/* ------------------------------------------------------------------ */
/* 各操作的条目构建                                                     */
/* ------------------------------------------------------------------ */

function makeEntry(
  op: AuditOpType,
  summary: string,
  items: AuditItem[],
  outcomeLabel?: string,
): AuditEntry {
  return {
    // seq 由 reducer 在追加时分配。
    seq: 0,
    id: createId("aud"),
    at: new Date().toISOString(),
    op,
    summary,
    outcomeLabel,
    items,
  };
}

export function buildTrialCreatedEntry(trial: Trial): AuditEntry {
  const item: AuditItem = {
    objectType: "trial",
    objectId: trial.id,
    objectLabel: trialLabel(trial),
    kind: "created",
    changes: [
      change("cropFamily", undefined, trial.cropFamily),
      change("season", undefined, trial.season),
      change("startDate", undefined, trial.startDate),
      change("endDate", undefined, trial.endDate),
    ],
    resultLabel: `新试验处于「${trialStateLabel.draft}」状态`,
    trialId: trial.id,
  };
  return makeEntry(
    "trial.created",
    `创建试验 ${trial.code}`,
    [item],
    "试验已进入草稿状态",
  );
}

export function buildTrialTransitionedEntry(
  before: Trial,
  nextState: TrialState,
): AuditEntry {
  const item: AuditItem = {
    objectType: "trial",
    objectId: before.id,
    objectLabel: trialLabel(before),
    kind: "updated",
    changes: [change("state", before.state, nextState)],
    trialId: before.id,
  };
  return makeEntry(
    "trial.transitioned",
    `试验 ${before.code}：${trialStateLabel[before.state]} → ${trialStateLabel[nextState]}`,
    [item],
    `${before.code} 现在为「${trialStateLabel[nextState]}」`,
  );
}

export function buildAccessionCreatedEntry(accession: Accession): AuditEntry {
  const item: AuditItem = {
    objectType: "accession",
    objectId: accession.id,
    objectLabel: accessionLabel(accession),
    kind: "created",
    changes: [
      change("cultivar", undefined, accession.cultivar),
      change("source", undefined, accession.source),
      change("quantity", undefined, accession.quantity),
      change("preferredLight", undefined, accession.preferredLight),
    ],
    resultLabel: `${accession.trayCells} 孔穴盘 · 繁殖于 ${accession.propagatedOn}`,
    trialId: accession.trialId,
  };
  return makeEntry(
    "accession.created",
    `新建材料 ${accession.accessionNo} ${accession.cultivar}`,
    [item],
    "材料已进入登记清单，可分配台架",
  );
}

const ACCESSION_FIELDS: Array<keyof Accession> = [
  "accessionNo",
  "cultivar",
  "source",
  "propagatedOn",
  "quantity",
  "trayCells",
  "preferredLight",
  "genotypeNote",
  "labels",
];

export function buildAccessionUpdatedEntry(
  before: Accession,
  after: Accession,
): AuditEntry {
  const item: AuditItem = {
    objectType: "accession",
    objectId: after.id,
    objectLabel: accessionLabel(after),
    kind: "updated",
    changes: diffFields(before, after, ACCESSION_FIELDS),
    trialId: after.trialId,
  };
  return makeEntry(
    "accession.updated",
    `更新材料 ${after.accessionNo} ${after.cultivar}`,
    [item],
    item.changes.length > 0
      ? `变更 ${item.changes.length} 个字段`
      : "字段未发生变化",
  );
}

function benchAssignmentChanges(
  state: WorkspaceState,
  before: Bench,
  after: Bench,
): AuditChange[] {
  const changes: AuditChange[] = [];
  if (JSON.stringify(before.assignedIds) !== JSON.stringify(after.assignedIds)) {
    changes.push({
      field: "assignedIds",
      label: fieldLabel("assignedIds"),
      before: accessionNoList(before.assignedIds, state),
      after: accessionNoList(after.assignedIds, state),
    });
  }
  if (before.status !== after.status) {
    changes.push(change("status", before.status, after.status));
  }
  return changes;
}

export function buildBenchAssignedEntry(
  state: WorkspaceState,
  before: Bench,
  after: Bench,
  accession: Accession,
): AuditEntry {
  const item: AuditItem = {
    objectType: "bench",
    objectId: after.id,
    objectLabel: benchLabel(after),
    kind: "updated",
    changes: benchAssignmentChanges(state, before, after),
    resultLabel: `占用 ${after.assignedIds.length}/${after.capacity}`,
    trialId: accession.trialId,
  };
  return makeEntry(
    "bench.assigned",
    `分配台架：${accessionLabel(accession)} → ${after.code}`,
    [item],
    `${accession.accessionNo} 现在位于 ${after.code}`,
  );
}

export function buildBenchReleasedEntry(
  state: WorkspaceState,
  before: Bench,
  after: Bench,
  accession: Accession,
): AuditEntry {
  const item: AuditItem = {
    objectType: "bench",
    objectId: after.id,
    objectLabel: benchLabel(after),
    kind: "updated",
    changes: benchAssignmentChanges(state, before, after),
    resultLabel: `占用 ${after.assignedIds.length}/${after.capacity}`,
    trialId: accession.trialId,
  };
  return makeEntry(
    "bench.released",
    `移出台架：${accessionLabel(accession)} 离开 ${before.code}`,
    [item],
    after.status === "available"
      ? `${after.code} 已恢复可用`
      : `${after.code} 仍有其他材料`,
  );
}

export function buildBatchReleaseEntry(
  state: WorkspaceState,
  updatedBenches: Bench[],
  releasedAccessionIds: string[],
  trialId: string,
): AuditEntry {
  const items: AuditItem[] = updatedBenches.map((after) => {
    const before = state.benches.find((bench) => bench.id === after.id);
    return {
      objectType: "bench" as const,
      objectId: after.id,
      objectLabel: benchLabel(after),
      kind: "updated" as const,
      changes: before
        ? benchAssignmentChanges(state, before, after)
        : [],
      resultLabel: `占用 ${after.assignedIds.length}/${after.capacity}`,
      trialId,
    };
  });
  return makeEntry(
    "bench.batch-released",
    `批量移出 ${releasedAccessionIds.length} 个材料（${updatedBenches.length} 个台架）`,
    items,
    `台架空位已恢复，涉及 ${updatedBenches.length} 个台架`,
  );
}

export function buildObservationEntry(
  pass: ObservationPass,
  flags: Flag[],
): AuditEntry {
  const passItem: AuditItem = {
    objectType: "observation",
    objectId: pass.id,
    objectLabel: passLabel(pass),
    kind: "created",
    changes: [
      change("observedOn", undefined, pass.observedOn),
      change("observer", undefined, pass.observer),
    ],
    resultLabel: `${pass.entries.length} 条测量记录`,
    trialId: pass.trialId,
  };
  const flagItems: AuditItem[] = flags.map((flag) => ({
    objectType: "flag" as const,
    objectId: flag.id,
    objectLabel: flag.code,
    kind: "created" as const,
    changes: [change("severity", undefined, flag.severity)],
    resultLabel: clip(flag.message, 40),
    trialId: flag.trialId,
  }));
  return makeEntry(
    "observation.recorded",
    `记录观测 · ${pass.observedOn} · ${pass.observer}`,
    [passItem, ...flagItems],
    flags.length > 0
      ? `已保存 ${pass.entries.length} 条记录，派生 ${flags.length} 个标记`
      : `已保存 ${pass.entries.length} 条记录，未派生标记`,
  );
}

export function buildFlagTransitionedEntry(
  before: Flag,
  after: Flag,
): AuditEntry {
  const item: AuditItem = {
    objectType: "flag",
    objectId: after.id,
    objectLabel: after.code,
    kind: "updated",
    changes: [
      change("state", before.state, after.state),
      ...(after.resolutionNote
        ? [change("resolutionNote", undefined, after.resolutionNote)]
        : []),
    ],
    resultLabel: clip(after.message, 40),
    trialId: after.trialId,
  };
  return makeEntry(
    "flag.transitioned",
    `${flagStateLabel[after.state]}标记 · ${after.code}`,
    [item],
    `标记已${after.state === "resolved" ? "解决" : "豁免"}`,
  );
}

export function buildClearanceEntry(
  before: WorkspaceState,
  snapshot: ClearanceSnapshot,
  trialsAfter: Trial[],
): AuditEntry {
  const trialBefore = before.trials.find(
    (trial) => trial.id === snapshot.trialId,
  );
  const trialAfter = trialsAfter.find(
    (trial) => trial.id === snapshot.trialId,
  );
  const statusText = snapshot.status === "ready" ? "就绪" : "阻止";
  const snapshotItem: AuditItem = {
    objectType: "snapshot",
    objectId: snapshot.id,
    objectLabel: `放行快照 · ${statusText}`,
    kind: "created",
    changes: [
      {
        field: "status",
        label: "放行结果",
        after: statusText,
      },
      {
        field: "blockers",
        label: "阻止项",
        after:
          snapshot.blockers.length === 0
            ? "无"
            : `${snapshot.blockers.length} 项`,
      },
    ],
    resultLabel: `${snapshot.metrics.length} 项指标 · ${snapshot.generatedOn}`,
    trialId: snapshot.trialId,
  };
  const items: AuditItem[] = [snapshotItem];
  if (trialBefore && trialAfter && trialBefore.state !== trialAfter.state) {
    items.push({
      objectType: "trial",
      objectId: trialAfter.id,
      objectLabel: trialLabel(trialAfter),
      kind: "updated",
      changes: [change("state", trialBefore.state, trialAfter.state)],
      trialId: trialAfter.id,
    });
  }
  return makeEntry(
    "clearance.generated",
    `生成放行快照 · ${trialBefore?.code ?? snapshot.trialId} · ${statusText}`,
    items,
    snapshot.status === "ready"
      ? `${trialBefore?.code ?? ""} 已放行`.trim()
      : `快照已保存，仍有 ${snapshot.blockers.length} 个阻止项`,
  );
}

/* ------------------------------------------------------------------ */
/* 工作区整体替换（重置 / 导入恢复）                                     */
/* ------------------------------------------------------------------ */

export type WorkspaceReplaceSource = "sample" | "import";

interface EntityConfig<T> {
  objectType: AuditObjectType;
  idOf: (entity: T) => string;
  labelOf: (entity: T) => string;
  trialIdOf?: (entity: T) => string;
  fields?: Array<keyof T>;
}

const TRIAL_FIELDS: Array<keyof Trial> = [
  "code",
  "cropFamily",
  "objective",
  "season",
  "startDate",
  "endDate",
  "state",
];

function diffCollection<T extends { id: string }>(
  beforeList: T[],
  afterList: T[],
  config: EntityConfig<T>,
  beforeState: WorkspaceState,
  afterState: WorkspaceState,
): AuditItem[] {
  const beforeMap = new Map(beforeList.map((entity) => [config.idOf(entity), entity]));
  const afterMap = new Map(afterList.map((entity) => [config.idOf(entity), entity]));
  const items: AuditItem[] = [];

  afterMap.forEach((after, id) => {
    const before = beforeMap.get(id);
    if (!before) {
      items.push({
        objectType: config.objectType,
        objectId: id,
        objectLabel: config.labelOf(after),
        kind: "created",
        changes: [],
        resultLabel: describeCreated(config.objectType, after),
        trialId: config.trialIdOf?.(after),
      });
      return;
    }
    const changes = config.fields
      ? diffFields(before, after, config.fields)
      : [];
    if (changes.length > 0) {
      items.push({
        objectType: config.objectType,
        objectId: id,
        objectLabel: config.labelOf(after),
        kind: "updated",
        changes,
        trialId: config.trialIdOf?.(after),
      });
    }
  });

  beforeMap.forEach((before, id) => {
    if (!afterMap.has(id)) {
      items.push({
        objectType: config.objectType,
        objectId: id,
        objectLabel: config.labelOf(before),
        kind: "removed",
        changes: [],
        resultLabel: describeRemoved(config.objectType, before, beforeState),
        trialId: config.trialIdOf?.(before),
      });
    }
  });

  return items;
}

function describeCreated(
  type: AuditObjectType,
  entity: unknown,
): string | undefined {
  if (type === "accession") {
    const accession = entity as Accession;
    return `品种 ${clip(accession.cultivar, 24)} · 数量 ${accession.quantity}`;
  }
  if (type === "trial") {
    const trial = entity as Trial;
    return `${trialStateLabel[trial.state]} · ${trial.season}`;
  }
  if (type === "bench") {
    const bench = entity as Bench;
    return `${benchStatusLabel[bench.status]} · 容量 ${bench.capacity}`;
  }
  if (type === "observation") {
    const pass = entity as ObservationPass;
    return `${pass.entries.length} 条测量记录`;
  }
  if (type === "flag") {
    const flag = entity as Flag;
    return `${flagSeverityLabel[flag.severity]} · ${flagStateLabel[flag.state]}`;
  }
  if (type === "snapshot") {
    const snapshot = entity as ClearanceSnapshot;
    return snapshot.status === "ready" ? "就绪" : `${snapshot.blockers.length} 个阻止项`;
  }
  return undefined;
}

function describeRemoved(
  type: AuditObjectType,
  entity: unknown,
  state: WorkspaceState,
): string | undefined {
  if (type === "accession") {
    const accession = entity as Accession;
    const bench = state.benches.find((candidate) =>
      candidate.assignedIds.includes(accession.id),
    );
    return bench ? `移除前位于 ${bench.code}` : "移除前未分配台架";
  }
  if (type === "bench") {
    const bench = entity as Bench;
    return `移除前占用 ${bench.assignedIds.length}/${bench.capacity}`;
  }
  if (type === "observation") {
    return "观测记录已随恢复移除";
  }
  if (type === "flag") {
    const flag = entity as Flag;
    return `移除前为「${flagStateLabel[flag.state]}」`;
  }
  if (type === "snapshot") {
    return "快照已随恢复移除";
  }
  if (type === "trial") {
    return "试验及其下属对象不再可导航";
  }
  return undefined;
}

function countsDelta(before: WorkspaceState, after: WorkspaceState): string {
  const parts: Array<[string, number, number]> = [
    ["试验", before.trials.length, after.trials.length],
    ["材料", before.accessions.length, after.accessions.length],
    ["台架", before.benches.length, after.benches.length],
    ["观测", before.observationPasses.length, after.observationPasses.length],
    ["标记", before.flags.length, after.flags.length],
    ["快照", before.clearanceSnapshots.length, after.clearanceSnapshots.length],
  ];
  return parts
    .filter(([, left, right]) => left !== right)
    .map(([label, left, right]) => `${label} ${left}→${right}`)
    .join("；");
}

export function buildWorkspaceReplacedEntry(
  before: WorkspaceState,
  after: WorkspaceState,
  source: WorkspaceReplaceSource,
  sourceLabel?: string,
): AuditEntry {
  const items: AuditItem[] = [
    ...diffCollection(
      before.trials,
      after.trials,
      {
        objectType: "trial",
        idOf: (trial) => trial.id,
        labelOf: trialLabel,
        trialIdOf: (trial) => trial.id,
        fields: TRIAL_FIELDS,
      },
      before,
      after,
    ),
    ...diffCollection(
      before.accessions,
      after.accessions,
      {
        objectType: "accession",
        idOf: (accession) => accession.id,
        labelOf: accessionLabel,
        trialIdOf: (accession) => accession.trialId,
        fields: ACCESSION_FIELDS,
      },
      before,
      after,
    ),
    ...diffBenches(before, after),
    ...diffCollection(
      before.observationPasses,
      after.observationPasses,
      {
        objectType: "observation",
        idOf: (pass) => pass.id,
        labelOf: passLabel,
        trialIdOf: (pass) => pass.trialId,
      },
      before,
      after,
    ),
    ...diffCollection(
      before.flags,
      after.flags,
      {
        objectType: "flag",
        idOf: (flag) => flag.id,
        labelOf: (flag) => flag.code,
        trialIdOf: (flag) => flag.trialId,
        fields: ["severity", "state", "resolutionNote"],
      },
      before,
      after,
    ),
    ...diffCollection(
      before.clearanceSnapshots,
      after.clearanceSnapshots,
      {
        objectType: "snapshot",
        idOf: (snapshot) => snapshot.id,
        labelOf: (snapshot) =>
          `放行快照 · ${snapshot.status === "ready" ? "就绪" : "阻止"}`,
        trialIdOf: (snapshot) => snapshot.trialId,
      },
      before,
      after,
    ),
  ];

  const limited = items.slice(0, AUDIT_ITEMS_CAP);
  const delta = countsDelta(before, after);
  const summary =
    source === "sample"
      ? "重置为示例工作区"
      : `从备份恢复工作区${sourceLabel ? `（${clip(sourceLabel, 24)}）` : ""}`;
  const outcome =
    items.length === 0
      ? "工作区内容未发生变化"
      : [delta, items.length > limited.length
          ? `仅记录前 ${limited.length} 个对象变化`
          : `共 ${items.length} 个对象变化`]
          .filter(Boolean)
          .join("；");

  return makeEntry("workspace.replaced", summary, limited, outcome);
}

function diffBenches(
  before: WorkspaceState,
  after: WorkspaceState,
): AuditItem[] {
  const config: EntityConfig<Bench> = {
    objectType: "bench",
    idOf: (bench) => bench.id,
    labelOf: benchLabel,
    fields: ["sector", "capacity", "lightProfile", "irrigationLine", "status"],
  };
  const items = diffCollection(
    before.benches,
    after.benches,
    config,
    before,
    after,
  );
  // 台架分配列表需要材料编号摘要，单独补上。
  after.benches.forEach((benchAfter) => {
    const benchBefore = before.benches.find((bench) => bench.id === benchAfter.id);
    if (
      benchBefore &&
      JSON.stringify(benchBefore.assignedIds) !==
        JSON.stringify(benchAfter.assignedIds)
    ) {
      const trialId = inferBenchTrialId(before, after, benchAfter.assignedIds);
      const item = items.find(
        (candidate) =>
          candidate.objectType === "bench" && candidate.objectId === benchAfter.id,
      );
      const assignmentChange: AuditChange = {
        field: "assignedIds",
        label: fieldLabel("assignedIds"),
        before: accessionNoList(benchBefore.assignedIds, before),
        after: accessionNoList(benchAfter.assignedIds, after),
      };
      if (item) {
        item.changes.unshift(assignmentChange);
        if (!item.trialId) {
          item.trialId = trialId;
        }
      } else {
        items.push({
          objectType: "bench",
          objectId: benchAfter.id,
          objectLabel: benchLabel(benchAfter),
          kind: "updated",
          changes: [assignmentChange],
          trialId,
        });
      }
    }
  });
  return items;
}

/** 台架本身不隶属试验；借由其上材料反查试验，便于跳回后定位试验筛选。 */
function inferBenchTrialId(
  before: WorkspaceState,
  after: WorkspaceState,
  assignedIds: string[],
): string | undefined {
  const ids = new Set(assignedIds);
  const accession =
    after.accessions.find((candidate) => ids.has(candidate.id)) ??
    before.accessions.find((candidate) => ids.has(candidate.id));
  return accession?.trialId;
}

/* ------------------------------------------------------------------ */
/* 日志归并辅助                                                          */
/* ------------------------------------------------------------------ */

export function nextAuditSeq(entries: readonly AuditEntry[]): number {
  return entries.reduce((max, entry) => Math.max(max, entry.seq), 0) + 1;
}

export function appendAuditEntry(
  entries: readonly AuditEntry[],
  entry: AuditEntry,
): AuditEntry[] {
  const next = [...entries, { ...entry, seq: nextAuditSeq(entries) }];
  return next.length > AUDIT_ENTRIES_CAP
    ? next.slice(next.length - AUDIT_ENTRIES_CAP)
    : next;
}

export function isAuditEntry(value: unknown): value is AuditEntry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<AuditEntry>;
  return (
    typeof candidate.seq === "number" &&
    typeof candidate.id === "string" &&
    typeof candidate.at === "string" &&
    typeof candidate.op === "string" &&
    typeof candidate.summary === "string" &&
    Array.isArray(candidate.items)
  );
}
