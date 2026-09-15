import type { QualityFinding, RepairArchive, RepairJournal } from "../domain/quality/types";
import { buildFinding, evidence, objectRef } from "../domain/quality/catalog";
import { fingerprintState } from "../domain/quality/fingerprint";
import type { WorkspaceState } from "../domain/types";
import { isWorkspaceState } from "./types";
import { createSampleWorkspaceState } from "./sampleData";

export const WORKSPACE_STORAGE_KEY = "glasshouse-trial-bench:workspace:v1";
export const QUARANTINE_STORAGE_KEY =
  "glasshouse-trial-bench:quarantine:v1";
export const REPAIR_ARCHIVE_STORAGE_KEY =
  "glasshouse-trial-bench:repair-archive:v1";

export const WORKSPACE_FORMAT_VERSION = 1;

export interface StoredWorkspace {
  version: 1;
  savedAt?: string;
  state: WorkspaceState;
}

/** 可注入的存储接口，使引导逻辑可以在 Node 单元测试中脱离浏览器运行。 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export function browserStorage(): StorageLike {
  return window.localStorage;
}

export interface QuarantineEntry {
  id: string;
  reason:
    | "parse-error"
    | "schema-mismatch"
    | "version-unknown"
    | "version-legacy";
  detail: string;
  detectedAt: string;
  storageKey: string;
  /** 原始内容（解析失败时为原始字符串；结构不符时为解析后的 JSON 文本）。 */
  raw: string;
  envelopeVersion?: number;
}

export type WorkspaceBoot =
  | {
      kind: "sample";
      state: WorkspaceState;
      quarantine: QuarantineEntry[];
      findings: QualityFinding[];
    }
  | {
      kind: "loaded";
      state: WorkspaceState;
      quarantine: QuarantineEntry[];
      findings: QualityFinding[];
    }
  | {
      kind: "empty";
      state: WorkspaceState;
      quarantine: QuarantineEntry[];
      findings: QualityFinding[];
    };

export function emptyWorkspaceState(): WorkspaceState {
  return {
    trials: [],
    accessions: [],
    benches: [],
    observationPasses: [],
    flags: [],
    clearanceSnapshots: [],
  };
}

export function loadQuarantine(storage: StorageLike): QuarantineEntry[] {
  try {
    const raw = storage.getItem(QUARANTINE_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed.filter(
      (item): item is QuarantineEntry =>
        typeof item === "object" &&
        item !== null &&
        typeof (item as QuarantineEntry).id === "string" &&
        typeof (item as QuarantineEntry).raw === "string",
    );
  } catch {
    return [];
  }
}

export function saveQuarantine(storage: StorageLike, entries: QuarantineEntry[]): void {
  if (entries.length === 0) {
    storage.removeItem(QUARANTINE_STORAGE_KEY);
    return;
  }
  storage.setItem(QUARANTINE_STORAGE_KEY, JSON.stringify(entries));
}

function quarantineFinding(entry: QuarantineEntry): QualityFinding {
  const reasonLabels: Record<QuarantineEntry["reason"], string> = {
    "parse-error": "存储内容不是合法 JSON",
    "schema-mismatch": "存储内容缺少必需的工作区集合",
    "version-unknown": "持久化版本号无法识别",
    "version-legacy": "无版本封装的旧版（v0）工作区",
  };
  return buildFinding({
    ruleCode: "P-QUARANTINE-01",
    domain: "persistence",
    severity: "blocking",
    title: "损坏的工作区数据已隔离",
    detail:
      "上次保存的工作区无法通过结构校验，系统没有用示例数据覆盖它，也没有丢弃任何内容。原始数据已放入隔离区，请导出核对；确认无用后再显式清除。",
    objectRefs: [objectRef("storage", entry.id, `隔离记录 ${entry.id.slice(0, 12)}`)],
    evidence: [
      evidence("隔离原因", reasonLabels[entry.reason]),
      evidence("细节", entry.detail),
      evidence("发现时间", entry.detectedAt),
      evidence("原始字节数", entry.raw.length),
      ...(entry.envelopeVersion !== undefined
        ? [evidence("记录的版本号", entry.envelopeVersion)]
        : []),
    ],
  });
}

function envelopeFinding(savedAt: string | undefined): QualityFinding {
  return buildFinding({
    ruleCode: "P-ENVELOPE-01",
    domain: "persistence",
    severity: "info",
    title: "持久化封装缺少保存时间戳",
    detail:
      "工作区数据本身完整，但外层封装缺少 savedAt，无法追溯最后保存时间；下次保存时会自动补齐。",
    objectRefs: [objectRef("storage", WORKSPACE_STORAGE_KEY, "工作区存储")],
    evidence: [evidence("版本", WORKSPACE_FORMAT_VERSION), evidence("savedAt", savedAt ?? "缺失")],
  });
}

/** 根据隔离区当前内容与封装状态重算持久化领域问题。 */
export function persistenceFindings(
  quarantine: QuarantineEntry[],
  envelopeMissing: boolean = false,
): QualityFinding[] {
  return [
    ...quarantine.map(quarantineFinding),
    ...(envelopeMissing ? [envelopeFinding(undefined)] : []),
  ];
}

/** 只重算隔离区对应的阻断问题（隔离记录增删后供 UI 调用）。 */
export function quarantineFindings(
  quarantine: QuarantineEntry[],
): QualityFinding[] {
  return quarantine.map(quarantineFinding);
}

function createQuarantineEntry(
  reason: QuarantineEntry["reason"],
  detail: string,
  raw: string,
  envelopeVersion?: number,
): QuarantineEntry {
  return {
    id: `qtn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    reason,
    detail,
    detectedAt: new Date().toISOString(),
    storageKey: WORKSPACE_STORAGE_KEY,
    raw,
    envelopeVersion,
  };
}

/**
 * 引导工作区：
 * - 没有存储：进入确定性示例工作区（首次使用，保持原有体验）
 * - 解析失败 / 结构不符 / 版本未知：原始数据隔离，以空工作区启动并报告阻断问题，
 *   绝不静默回退示例数据、绝不覆盖损坏内容
 */
export function bootWorkspace(storage: StorageLike): WorkspaceBoot {
  const quarantine = loadQuarantine(storage);
  const raw = storage.getItem(WORKSPACE_STORAGE_KEY);

  if (raw === null) {
    return {
      kind: "sample",
      state: createSampleWorkspaceState(),
      quarantine,
      findings: persistenceFindings(quarantine, false),
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    const entry = createQuarantineEntry(
      "parse-error",
      error instanceof Error ? error.message : "JSON.parse 失败",
      raw,
    );
    return quarantineBoot(storage, entry, quarantine);
  }

  if (typeof parsed !== "object" || parsed === null) {
    const entry = createQuarantineEntry(
      "schema-mismatch",
      "顶层不是对象封装",
      raw,
    );
    return quarantineBoot(storage, entry, quarantine);
  }

  const envelope = parsed as Partial<StoredWorkspace>;

  // 旧版本形态：内容本身是一个工作区状态（六个集合都在），但没有版本封装。
  // 视为 v0 遗留数据，隔离并提示人工迁移，绝不静默包装或替换。
  if (
    envelope.version === undefined &&
    isWorkspaceState(parsed)
  ) {
    const entry = createQuarantineEntry(
      "version-legacy",
      "数据是未封装版本号的旧版工作区（v0），需要人工迁移到当前版本",
      raw,
      0,
    );
    return quarantineBoot(storage, entry, quarantine);
  }

  if (envelope.version !== WORKSPACE_FORMAT_VERSION) {
    const entry = createQuarantineEntry(
      "version-unknown",
      `期望版本 ${WORKSPACE_FORMAT_VERSION}，实际 ${String(envelope.version)}`,
      raw,
      typeof envelope.version === "number" ? envelope.version : undefined,
    );
    return quarantineBoot(storage, entry, quarantine);
  }

  if (!isWorkspaceState(envelope.state)) {
    const entry = createQuarantineEntry(
      "schema-mismatch",
      "state 缺少 trials/accessions/benches/observationPasses/flags/clearanceSnapshots 中的一个或多个集合",
      raw,
      envelope.version,
    );
    return quarantineBoot(storage, entry, quarantine);
  }

  const envelopeMissing = !(
    typeof envelope.savedAt === "string" && envelope.savedAt.length > 0
  );
  const findings = persistenceFindings(quarantine, envelopeMissing);

  return {
    kind: "loaded",
    state: envelope.state,
    quarantine,
    findings,
  };
}

function quarantineBoot(
  storage: StorageLike,
  entry: QuarantineEntry,
  previous: QuarantineEntry[],
): WorkspaceBoot {
  // 同一损坏内容（相同存储键 + 原始字节）在多次引导中只隔离一次，
  // 避免每次重启重复产生阻断问题；损坏的工作区键本身保持不动。
  const alreadyQuarantined = previous.some(
    (item) => item.storageKey === entry.storageKey && item.raw === entry.raw,
  );
  const quarantine = alreadyQuarantined ? previous : [...previous, entry];
  if (!alreadyQuarantined) {
    saveQuarantine(storage, quarantine);
  }
  return {
    kind: "empty",
    state: emptyWorkspaceState(),
    quarantine,
    findings: persistenceFindings(quarantine),
  };
}

/** 持久化一条新的隔离记录（页面确认“隔离损坏数据”后调用）。 */
export function appendQuarantine(
  storage: StorageLike,
  entry: QuarantineEntry,
): QuarantineEntry[] {
  const next = [...loadQuarantine(storage), entry];
  saveQuarantine(storage, next);
  return next;
}

export function makeQuarantineEntry(
  reason: QuarantineEntry["reason"],
  detail: string,
  raw: string,
  envelopeVersion?: number,
): QuarantineEntry {
  return createQuarantineEntry(reason, detail, raw, envelopeVersion);
}

export function discardQuarantineEntry(
  storage: StorageLike,
  id: string,
): QuarantineEntry[] {
  const next = loadQuarantine(storage).filter((entry) => entry.id !== id);
  saveQuarantine(storage, next);
  return next;
}

/* ------------------------------------------------------------------ */
/* 工作区读写（保留原接口名，供 store 使用）                              */
/* ------------------------------------------------------------------ */

/**
 * 直接读取已保存工作区的信封内容。修复协调器需要读取“存储中的实际状态”
 * 而不是引导结果（损坏时为空工作区）；损坏或缺失时返回 null。
 */
export function loadWorkspaceEnvelope(
  storage?: StorageLike,
): { state: WorkspaceState; savedAt?: string } | null {
  const target = storage ?? browserStorage();
  try {
    const raw = target.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<StoredWorkspace>;
    if (parsed.version !== WORKSPACE_FORMAT_VERSION || !isWorkspaceState(parsed.state)) {
      return null;
    }
    return { state: parsed.state, savedAt: parsed.savedAt };
  } catch {
    return null;
  }
}

export function loadWorkspaceState(storage?: StorageLike): WorkspaceState {
  return bootWorkspace(storage ?? browserStorage()).state;
}

export function saveWorkspaceState(
  state: WorkspaceState,
  storage?: StorageLike,
): void {
  const target = storage ?? browserStorage();
  const stored: StoredWorkspace = {
    version: WORKSPACE_FORMAT_VERSION,
    savedAt: new Date().toISOString(),
    state,
  };
  target.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(stored));
}

export function clearWorkspaceStorage(storage?: StorageLike): void {
  const target = storage ?? browserStorage();
  target.removeItem(WORKSPACE_STORAGE_KEY);
}

/* ------------------------------------------------------------------ */
/* 修复会话归档                                                          */
/* ------------------------------------------------------------------ */

function isRepairJournal(value: unknown): value is RepairJournal {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<RepairJournal>;
  // 兼容 v1 会话（无 version/recoveryLog）与 v2 的 conflicted 状态。
  const validStatus =
    candidate.status === "in_progress" ||
    candidate.status === "completed" ||
    candidate.status === "conflicted";
  return (
    typeof candidate.id === "string" &&
    typeof candidate.startedAt === "string" &&
    validStatus &&
    typeof candidate.stateBefore === "object" &&
    candidate.stateBefore !== null &&
    Array.isArray(candidate.items)
  );
}

/**
 * 把旧版（v1，无 version/recoveryLog/指纹）会话规范化为当前格式，
 * 保证旧归档和手工注入的会话也能参与指纹对账恢复。
 */
function normalizeJournal(value: unknown): RepairJournal | null {
  if (!isRepairJournal(value)) {
    return null;
  }
  const candidate = value as RepairJournal;
  const normalized: RepairJournal = {
    ...candidate,
    version: candidate.version === 2 ? 2 : 1,
    recoveryLog: Array.isArray(candidate.recoveryLog)
      ? candidate.recoveryLog
      : [
          {
            at: candidate.startedAt,
            event: "legacy-journal",
            detail: "会话来自旧版本，已补全恢复日志",
          },
        ],
    items: candidate.items.map((item) => ({
      ...item,
      changes: Array.isArray(item.changes) ? item.changes : [],
    })),
  };
  if (!normalized.stateBeforeFingerprint) {
    normalized.stateBeforeFingerprint = fingerprintState(normalized.stateBefore);
  }
  if (!normalized.previewFingerprint) {
    normalized.previewFingerprint = normalized.stateBeforeFingerprint;
  }
  return normalized;
}

export function loadRepairArchive(storage: StorageLike): RepairArchive {
  try {
    const raw = storage.getItem(REPAIR_ARCHIVE_STORAGE_KEY);
    if (!raw) {
      return { active: null, history: [] };
    }
    const parsed = JSON.parse(raw) as Partial<RepairArchive>;
    return {
      active: normalizeJournal(parsed.active),
      history: Array.isArray(parsed.history)
        ? (parsed.history
            .map((item) => normalizeJournal(item))
            .filter((item): item is RepairJournal => item !== null))
        : [],
    };
  } catch {
    return { active: null, history: [] };
  }
}

export function saveRepairArchive(storage: StorageLike, archive: RepairArchive): void {
  storage.setItem(REPAIR_ARCHIVE_STORAGE_KEY, JSON.stringify(archive));
}

export function saveActiveRepair(storage: StorageLike, journal: RepairJournal): void {
  const archive = loadRepairArchive(storage);
  saveRepairArchive(storage, { ...archive, active: journal });
}
