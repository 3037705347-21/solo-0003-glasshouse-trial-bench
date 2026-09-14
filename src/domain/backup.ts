import type { WorkspaceState } from "./types";
import {
  GROWTH_BOUNDS,
  LIGHT_PROFILES,
  TRAY_CELL_OPTIONS,
  parseDateOnly,
} from "./rules";
import { fail, fieldError, ok, type FieldError, type Result } from "./result";

export const BACKUP_FORMAT_VERSION = 1;
export const BACKUP_FILE_KIND = "glasshouse-trial-bench/workspace-backup";

export interface BackupSummary {
  trials: number;
  accessions: number;
  benches: number;
  observationPasses: number;
  flags: number;
  clearanceSnapshots: number;
  trialCodes: string[];
}

export interface WorkspaceBackup {
  kind: typeof BACKUP_FILE_KIND;
  version: number;
  exportedAt: string;
  summary: BackupSummary;
  state: WorkspaceState;
}

const COLLECTION_LABELS: Array<{ key: keyof BackupSummary & keyof WorkspaceState; label: string }> = [
  { key: "trials", label: "试验" },
  { key: "accessions", label: "材料" },
  { key: "benches", label: "台架" },
  { key: "observationPasses", label: "观测记录" },
  { key: "flags", label: "生长标记" },
  { key: "clearanceSnapshots", label: "放行快照" },
];

const TRIAL_STATES = ["draft", "active", "paused", "cleared"];
const BENCH_STATUSES = ["available", "assigned", "blocked", "quarantine"];
const FLAG_SEVERITIES = ["info", "warning", "critical"];
const FLAG_STATES = ["open", "resolved", "waived"];
const CLEARANCE_STATUSES = ["ready", "blocked"];
const LIGHT_PROFILE_VALUES: string[] = [...LIGHT_PROFILES];

export function summarizeWorkspace(state: WorkspaceState): BackupSummary {
  return {
    trials: state.trials.length,
    accessions: state.accessions.length,
    benches: state.benches.length,
    observationPasses: state.observationPasses.length,
    flags: state.flags.length,
    clearanceSnapshots: state.clearanceSnapshots.length,
    trialCodes: state.trials.map((trial) => trial.code),
  };
}

export function createWorkspaceBackup(
  state: WorkspaceState,
  exportedAt: string = new Date().toISOString(),
): WorkspaceBackup {
  return {
    kind: BACKUP_FILE_KIND,
    version: BACKUP_FORMAT_VERSION,
    exportedAt,
    summary: summarizeWorkspace(state),
    state,
  };
}

export function parseWorkspaceBackup(text: string): Result<WorkspaceBackup> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return fail([
      fieldError("file", "corrupt_json", "备份文件已损坏：内容不是有效的 JSON"),
    ]);
  }
  if (!isRecord(parsed)) {
    return fail([
      fieldError("file", "corrupt_structure", "备份文件已损坏：顶层结构不完整"),
    ]);
  }
  if (parsed.kind !== BACKUP_FILE_KIND) {
    return fail([
      fieldError("kind", "wrong_kind", "该文件不是温室试验台导出的工作区备份"),
    ]);
  }
  if (typeof parsed.version !== "number" || !Number.isInteger(parsed.version)) {
    return fail([
      fieldError("version", "invalid", "备份文件缺少有效的格式版本号"),
    ]);
  }
  if (parsed.version < BACKUP_FORMAT_VERSION) {
    return fail([
      fieldError(
        "version",
        "too_old",
        `备份文件版本 v${parsed.version} 过旧，当前应用最低需要 v${BACKUP_FORMAT_VERSION}`,
      ),
    ]);
  }
  if (parsed.version > BACKUP_FORMAT_VERSION) {
    return fail([
      fieldError(
        "version",
        "too_new",
        `备份文件版本 v${parsed.version} 高于当前应用支持的 v${BACKUP_FORMAT_VERSION}，请换用更新版本的应用`,
      ),
    ]);
  }
  if (
    typeof parsed.exportedAt !== "string" ||
    Number.isNaN(Date.parse(parsed.exportedAt))
  ) {
    return fail([
      fieldError("exportedAt", "invalid", "备份文件缺少有效的导出时间"),
    ]);
  }
  const summary = parseSummary(parsed.summary);
  if (!summary.ok) {
    return fail(summary.errors);
  }
  if (!isRecord(parsed.state)) {
    return fail([
      fieldError("state", "missing", "备份文件不完整：缺少工作区数据"),
    ]);
  }
  const shapeErrors = checkWorkspaceShape(parsed.state);
  if (shapeErrors.length > 0) {
    return fail(shapeErrors);
  }
  const state = parsed.state as unknown as WorkspaceState;
  if (!summaryMatches(summary.value, summarizeWorkspace(state))) {
    return fail([
      fieldError(
        "summary",
        "mismatch",
        "内容摘要与文件实际数据不一致，文件可能已被修改",
      ),
    ]);
  }
  const integrity = validateWorkspaceIntegrity(state);
  if (!integrity.ok) {
    return fail(integrity.errors);
  }
  return ok({
    kind: BACKUP_FILE_KIND,
    version: parsed.version,
    exportedAt: parsed.exportedAt,
    summary: summary.value,
    state,
  });
}

export function validateWorkspaceIntegrity(
  state: WorkspaceState,
): Result<WorkspaceState> {
  const errors: FieldError[] = [];
  const trialIds = checkTrials(state.trials, errors);
  const accessionIds = checkAccessions(state.accessions, trialIds, errors);
  checkBenches(state.benches, accessionIds, errors);
  const passIds = checkObservationPasses(
    state.observationPasses,
    trialIds,
    accessionIds,
    errors,
  );
  checkFlags(state.flags, trialIds, accessionIds, passIds, state, errors);
  checkClearanceSnapshots(
    state.clearanceSnapshots,
    trialIds,
    accessionIds,
    state.benches,
    errors,
  );
  return errors.length > 0 ? fail(errors) : ok(state);
}

function checkWorkspaceShape(value: Record<string, unknown>): FieldError[] {
  return COLLECTION_LABELS.filter(({ key }) => !Array.isArray(value[key])).map(
    ({ key, label }) =>
      fieldError(
        `state.${key}`,
        "missing_collection",
        `备份文件不完整：缺少${label}集合`,
      ),
  );
}

function parseSummary(value: unknown): Result<BackupSummary> {
  const invalid = () =>
    fail<BackupSummary>([
      fieldError("summary", "invalid", "备份文件的内容摘要缺失或结构无效"),
    ]);
  if (!isRecord(value)) {
    return invalid();
  }
  const countsValid = COLLECTION_LABELS.every(
    ({ key }) =>
      typeof value[key] === "number" &&
      Number.isInteger(value[key]) &&
      (value[key] as number) >= 0,
  );
  if (!countsValid || !isStringArray(value.trialCodes)) {
    return invalid();
  }
  return ok({
    trials: value.trials as number,
    accessions: value.accessions as number,
    benches: value.benches as number,
    observationPasses: value.observationPasses as number,
    flags: value.flags as number,
    clearanceSnapshots: value.clearanceSnapshots as number,
    trialCodes: value.trialCodes,
  });
}

function summaryMatches(declared: BackupSummary, actual: BackupSummary): boolean {
  return (
    COLLECTION_LABELS.every(({ key }) => declared[key] === actual[key]) &&
    declared.trialCodes.length === actual.trialCodes.length
  );
}

function checkTrials(trials: unknown[], errors: FieldError[]): Set<string> {
  const ids = new Set<string>();
  const codes = new Set<string>();
  trials.forEach((trial, index) => {
    const path = `trials[${index}]`;
    if (!isRecord(trial)) {
      errors.push(fieldError(path, "invalid_record", `第 ${index + 1} 条试验记录结构无效`));
      return;
    }
    collectId(trial.id, ids, path, "试验", errors);
    if (!isNonEmptyString(trial.code)) {
      errors.push(fieldError(`${path}.code`, "required", `第 ${index + 1} 条试验缺少编号`));
    } else if (codes.has(trial.code)) {
      errors.push(
        fieldError(`${path}.code`, "conflict", `试验编号 ${trial.code} 与文件内其他记录冲突`),
      );
    } else {
      codes.add(trial.code);
    }
    if (!isNonEmptyString(trial.cropFamily)) {
      errors.push(fieldError(`${path}.cropFamily`, "required", `试验 ${label(trial.code)} 缺少作物科属`));
    }
    if (!isNonEmptyString(trial.objective)) {
      errors.push(fieldError(`${path}.objective`, "required", `试验 ${label(trial.code)} 缺少目标`));
    }
    if (!isNonEmptyString(trial.season)) {
      errors.push(fieldError(`${path}.season`, "required", `试验 ${label(trial.code)} 缺少季节`));
    }
    if (!isDateOnly(trial.startDate)) {
      errors.push(fieldError(`${path}.startDate`, "invalid_date", `试验 ${label(trial.code)} 的开始日期无效`));
    }
    if (!isDateOnly(trial.endDate)) {
      errors.push(fieldError(`${path}.endDate`, "invalid_date", `试验 ${label(trial.code)} 的结束日期无效`));
    }
    if (
      isDateOnly(trial.startDate) &&
      isDateOnly(trial.endDate) &&
      parseDateOnly(trial.startDate)!.getTime() > parseDateOnly(trial.endDate)!.getTime()
    ) {
      errors.push(
        fieldError(`${path}.endDate`, "date_sequence", `试验 ${label(trial.code)} 的结束日期早于开始日期`),
      );
    }
    if (!isNonEmptyString(trial.state) || !TRIAL_STATES.includes(trial.state)) {
      errors.push(fieldError(`${path}.state`, "invalid", `试验 ${label(trial.code)} 的生命周期状态无效`));
    }
  });
  return ids;
}

function checkAccessions(
  accessions: unknown[],
  trialIds: Set<string>,
  errors: FieldError[],
): Set<string> {
  const ids = new Set<string>();
  const numbers = new Set<string>();
  accessions.forEach((accession, index) => {
    const path = `accessions[${index}]`;
    if (!isRecord(accession)) {
      errors.push(fieldError(path, "invalid_record", `第 ${index + 1} 条材料记录结构无效`));
      return;
    }
    collectId(accession.id, ids, path, "材料", errors);
    const name = label(accession.accessionNo);
    if (!isNonEmptyString(accession.accessionNo)) {
      errors.push(fieldError(`${path}.accessionNo`, "required", `第 ${index + 1} 条材料缺少编号`));
    } else if (numbers.has(accession.accessionNo)) {
      errors.push(
        fieldError(`${path}.accessionNo`, "conflict", `材料编号 ${accession.accessionNo} 与文件内其他记录冲突`),
      );
    } else {
      numbers.add(accession.accessionNo);
    }
    if (!isNonEmptyString(accession.trialId) || !trialIds.has(accession.trialId)) {
      errors.push(
        fieldError(
          `${path}.trialId`,
          "broken_reference",
          `材料 ${name} 引用了不存在的试验 ${String(accession.trialId)}`,
        ),
      );
    }
    if (!isNonEmptyString(accession.cultivar)) {
      errors.push(fieldError(`${path}.cultivar`, "required", `材料 ${name} 缺少品种`));
    }
    if (!isNonEmptyString(accession.source)) {
      errors.push(fieldError(`${path}.source`, "required", `材料 ${name} 缺少来源`));
    }
    if (!isDateOnly(accession.propagatedOn)) {
      errors.push(fieldError(`${path}.propagatedOn`, "invalid_date", `材料 ${name} 的繁殖日期无效`));
    }
    if (
      !isFiniteNumber(accession.quantity) ||
      !Number.isInteger(accession.quantity) ||
      accession.quantity < 1 ||
      accession.quantity > 500
    ) {
      errors.push(fieldError(`${path}.quantity`, "range", `材料 ${name} 的数量超出 1-500 范围`));
    }
    if (!isFiniteNumber(accession.trayCells) || !TRAY_CELL_OPTIONS.includes(accession.trayCells)) {
      errors.push(fieldError(`${path}.trayCells`, "invalid", `材料 ${name} 的穴盘规格不受支持`));
    }
    if (!isNonEmptyString(accession.preferredLight) || !LIGHT_PROFILE_VALUES.includes(accession.preferredLight)) {
      errors.push(fieldError(`${path}.preferredLight`, "invalid", `材料 ${name} 的光照类型无效`));
    }
    if (typeof accession.genotypeNote !== "string") {
      errors.push(fieldError(`${path}.genotypeNote`, "required", `材料 ${name} 缺少基因型说明`));
    }
    if (!isStringArray(accession.labels)) {
      errors.push(fieldError(`${path}.labels`, "invalid", `材料 ${name} 的标签结构无效`));
    }
  });
  return ids;
}

function checkBenches(
  benches: unknown[],
  accessionIds: Set<string>,
  errors: FieldError[],
): void {
  const ids = new Set<string>();
  const codes = new Set<string>();
  const assignmentOwner = new Map<string, string>();
  benches.forEach((bench, index) => {
    const path = `benches[${index}]`;
    if (!isRecord(bench)) {
      errors.push(fieldError(path, "invalid_record", `第 ${index + 1} 条台架记录结构无效`));
      return;
    }
    collectId(bench.id, ids, path, "台架", errors);
    const name = label(bench.code);
    if (!isNonEmptyString(bench.code)) {
      errors.push(fieldError(`${path}.code`, "required", `第 ${index + 1} 条台架缺少编号`));
    } else if (codes.has(bench.code)) {
      errors.push(
        fieldError(`${path}.code`, "conflict", `台架编号 ${bench.code} 与文件内其他记录冲突`),
      );
    } else {
      codes.add(bench.code);
    }
    if (!isNonEmptyString(bench.sector)) {
      errors.push(fieldError(`${path}.sector`, "required", `台架 ${name} 缺少区域`));
    }
    if (!isFiniteNumber(bench.capacity) || !Number.isInteger(bench.capacity) || bench.capacity < 1) {
      errors.push(fieldError(`${path}.capacity`, "range", `台架 ${name} 的容量无效`));
    }
    if (!isNonEmptyString(bench.lightProfile) || !LIGHT_PROFILE_VALUES.includes(bench.lightProfile)) {
      errors.push(fieldError(`${path}.lightProfile`, "invalid", `台架 ${name} 的光照类型无效`));
    }
    if (!isNonEmptyString(bench.irrigationLine)) {
      errors.push(fieldError(`${path}.irrigationLine`, "required", `台架 ${name} 缺少灌溉管路`));
    }
    if (!isNonEmptyString(bench.status) || !BENCH_STATUSES.includes(bench.status)) {
      errors.push(fieldError(`${path}.status`, "invalid", `台架 ${name} 的运行状态无效`));
    }
    if (bench.blockedReason !== undefined && typeof bench.blockedReason !== "string") {
      errors.push(fieldError(`${path}.blockedReason`, "invalid", `台架 ${name} 的停用原因结构无效`));
    }
    if (!isStringArray(bench.assignedIds)) {
      errors.push(fieldError(`${path}.assignedIds`, "invalid", `台架 ${name} 的分配列表结构无效`));
      return;
    }
    const seen = new Set<string>();
    bench.assignedIds.forEach((accessionId) => {
      if (!accessionIds.has(accessionId)) {
        errors.push(
          fieldError(
            `${path}.assignedIds`,
            "broken_reference",
            `台架 ${name} 分配了不存在的材料 ${accessionId}`,
          ),
        );
        return;
      }
      if (seen.has(accessionId)) {
        errors.push(
          fieldError(`${path}.assignedIds`, "conflict", `台架 ${name} 重复分配了材料 ${accessionId}`),
        );
        return;
      }
      seen.add(accessionId);
      const owner = assignmentOwner.get(accessionId);
      if (owner) {
        errors.push(
          fieldError(
            `${path}.assignedIds`,
            "conflict",
            `材料 ${accessionId} 同时出现在台架 ${owner} 和 ${name} 上，存在冲突`,
          ),
        );
      } else {
        assignmentOwner.set(accessionId, name);
      }
    });
    if (isFiniteNumber(bench.capacity) && bench.assignedIds.length > bench.capacity) {
      errors.push(
        fieldError(`${path}.assignedIds`, "capacity", `台架 ${name} 的分配数量超出容量`),
      );
    }
  });
}

function checkObservationPasses(
  passes: unknown[],
  trialIds: Set<string>,
  accessionIds: Set<string>,
  errors: FieldError[],
): Set<string> {
  const ids = new Set<string>();
  passes.forEach((pass, index) => {
    const path = `observationPasses[${index}]`;
    if (!isRecord(pass)) {
      errors.push(fieldError(path, "invalid_record", `第 ${index + 1} 条观测记录结构无效`));
      return;
    }
    collectId(pass.id, ids, path, "观测记录", errors);
    const name = label(pass.id);
    if (!isNonEmptyString(pass.trialId) || !trialIds.has(pass.trialId)) {
      errors.push(
        fieldError(`${path}.trialId`, "broken_reference", `观测记录 ${name} 引用了不存在的试验 ${String(pass.trialId)}`),
      );
    }
    if (!isDateOnly(pass.observedOn)) {
      errors.push(fieldError(`${path}.observedOn`, "invalid_date", `观测记录 ${name} 的观测日期无效`));
    }
    if (!isNonEmptyString(pass.observer)) {
      errors.push(fieldError(`${path}.observer`, "required", `观测记录 ${name} 缺少观测人`));
    }
    if (!Array.isArray(pass.entries) || pass.entries.length === 0) {
      errors.push(fieldError(`${path}.entries`, "empty", `观测记录 ${name} 缺少测量记录`));
      return;
    }
    const seen = new Set<string>();
    pass.entries.forEach((entry, entryIndex) => {
      const entryPath = `${path}.entries[${entryIndex}]`;
      if (!isRecord(entry)) {
        errors.push(fieldError(entryPath, "invalid_record", `观测记录 ${name} 的第 ${entryIndex + 1} 条测量结构无效`));
        return;
      }
      if (!isNonEmptyString(entry.accessionId) || !accessionIds.has(entry.accessionId)) {
        errors.push(
          fieldError(
            `${entryPath}.accessionId`,
            "broken_reference",
            `观测记录 ${name} 的第 ${entryIndex + 1} 条测量引用了不存在的材料 ${String(entry.accessionId)}`,
          ),
        );
      } else if (seen.has(entry.accessionId)) {
        errors.push(
          fieldError(`${entryPath}.accessionId`, "conflict", `观测记录 ${name} 中材料 ${entry.accessionId} 重复出现`),
        );
      }
      seen.add(String(entry.accessionId));
      checkMeasurement(entry.heightMm, GROWTH_BOUNDS.heightMm, `${entryPath}.heightMm`, "株高", name, errors);
      checkMeasurement(entry.leafCount, GROWTH_BOUNDS.leafCount, `${entryPath}.leafCount`, "叶片数", name, errors);
      checkMeasurement(entry.ecMs, GROWTH_BOUNDS.ecMs, `${entryPath}.ecMs`, "电导率", name, errors);
      if (typeof entry.notes !== "string") {
        errors.push(fieldError(`${entryPath}.notes`, "invalid", `观测记录 ${name} 的第 ${entryIndex + 1} 条测量备注结构无效`));
      }
    });
  });
  return ids;
}

function checkFlags(
  flags: unknown[],
  trialIds: Set<string>,
  accessionIds: Set<string>,
  passIds: Set<string>,
  state: WorkspaceState,
  errors: FieldError[],
): void {
  const ids = new Set<string>();
  const accessionTrial = new Map<string, string>();
  (state.accessions as unknown[]).forEach((accession) => {
    if (isRecord(accession) && isNonEmptyString(accession.id) && isNonEmptyString(accession.trialId)) {
      accessionTrial.set(accession.id, accession.trialId);
    }
  });
  const passTrial = new Map<string, string>();
  (state.observationPasses as unknown[]).forEach((pass) => {
    if (isRecord(pass) && isNonEmptyString(pass.id) && isNonEmptyString(pass.trialId)) {
      passTrial.set(pass.id, pass.trialId);
    }
  });
  flags.forEach((flag, index) => {
    const path = `flags[${index}]`;
    if (!isRecord(flag)) {
      errors.push(fieldError(path, "invalid_record", `第 ${index + 1} 条标记记录结构无效`));
      return;
    }
    collectId(flag.id, ids, path, "标记", errors);
    const name = label(flag.id);
    if (!isNonEmptyString(flag.trialId) || !trialIds.has(flag.trialId)) {
      errors.push(fieldError(`${path}.trialId`, "broken_reference", `标记 ${name} 引用了不存在的试验 ${String(flag.trialId)}`));
    }
    if (!isNonEmptyString(flag.accessionId) || !accessionIds.has(flag.accessionId)) {
      errors.push(fieldError(`${path}.accessionId`, "broken_reference", `标记 ${name} 引用了不存在的材料 ${String(flag.accessionId)}`));
    }
    if (!isNonEmptyString(flag.observationPassId) || !passIds.has(flag.observationPassId)) {
      errors.push(fieldError(`${path}.observationPassId`, "broken_reference", `标记 ${name} 引用了不存在的观测记录 ${String(flag.observationPassId)}`));
    }
    if (
      isNonEmptyString(flag.trialId) &&
      isNonEmptyString(flag.accessionId) &&
      accessionTrial.has(flag.accessionId) &&
      accessionTrial.get(flag.accessionId) !== flag.trialId
    ) {
      errors.push(fieldError(`${path}.accessionId`, "inconsistent", `标记 ${name} 的试验与引用材料所属试验不一致`));
    }
    if (
      isNonEmptyString(flag.trialId) &&
      isNonEmptyString(flag.observationPassId) &&
      passTrial.has(flag.observationPassId) &&
      passTrial.get(flag.observationPassId) !== flag.trialId
    ) {
      errors.push(fieldError(`${path}.observationPassId`, "inconsistent", `标记 ${name} 的试验与引用观测所属试验不一致`));
    }
    if (!isNonEmptyString(flag.code)) {
      errors.push(fieldError(`${path}.code`, "required", `标记 ${name} 缺少代码`));
    }
    if (!isNonEmptyString(flag.message)) {
      errors.push(fieldError(`${path}.message`, "required", `标记 ${name} 缺少说明`));
    }
    if (!isNonEmptyString(flag.severity) || !FLAG_SEVERITIES.includes(flag.severity)) {
      errors.push(fieldError(`${path}.severity`, "invalid", `标记 ${name} 的严重程度无效`));
    }
    if (!isNonEmptyString(flag.state) || !FLAG_STATES.includes(flag.state)) {
      errors.push(fieldError(`${path}.state`, "invalid", `标记 ${name} 的生命周期状态无效`));
    }
    if (!isIsoTimestamp(flag.createdOn)) {
      errors.push(fieldError(`${path}.createdOn`, "invalid_date", `标记 ${name} 的创建时间无效`));
    }
    if (
      (flag.state === "resolved" || flag.state === "waived") &&
      !isNonEmptyString(flag.resolutionNote)
    ) {
      errors.push(fieldError(`${path}.resolutionNote`, "required", `标记 ${name} 已处理但缺少处理说明`));
    }
    if (flag.resolvedOn !== undefined && !isIsoTimestamp(flag.resolvedOn)) {
      errors.push(fieldError(`${path}.resolvedOn`, "invalid_date", `标记 ${name} 的处理时间无效`));
    }
  });
}

function checkClearanceSnapshots(
  snapshots: unknown[],
  trialIds: Set<string>,
  accessionIds: Set<string>,
  benches: unknown[],
  errors: FieldError[],
): void {
  const ids = new Set<string>();
  const benchIds = new Set<string>();
  benches.forEach((bench) => {
    if (isRecord(bench) && isNonEmptyString(bench.id)) {
      benchIds.add(bench.id);
    }
  });
  snapshots.forEach((snapshot, index) => {
    const path = `clearanceSnapshots[${index}]`;
    if (!isRecord(snapshot)) {
      errors.push(fieldError(path, "invalid_record", `第 ${index + 1} 条放行快照结构无效`));
      return;
    }
    collectId(snapshot.id, ids, path, "放行快照", errors);
    const name = label(snapshot.id);
    if (!isNonEmptyString(snapshot.trialId) || !trialIds.has(snapshot.trialId)) {
      errors.push(fieldError(`${path}.trialId`, "broken_reference", `放行快照 ${name} 引用了不存在的试验 ${String(snapshot.trialId)}`));
    }
    if (!isIsoTimestamp(snapshot.generatedOn)) {
      errors.push(fieldError(`${path}.generatedOn`, "invalid_date", `放行快照 ${name} 的生成时间无效`));
    }
    if (!isNonEmptyString(snapshot.status) || !CLEARANCE_STATUSES.includes(snapshot.status)) {
      errors.push(fieldError(`${path}.status`, "invalid", `放行快照 ${name} 的状态无效`));
    }
    if (!Array.isArray(snapshot.metrics)) {
      errors.push(fieldError(`${path}.metrics`, "invalid", `放行快照 ${name} 的指标结构无效`));
    } else {
      snapshot.metrics.forEach((metric, metricIndex) => {
        if (
          !isRecord(metric) ||
          !isNonEmptyString(metric.label) ||
          !isFiniteNumber(metric.value) ||
          typeof metric.detail !== "string"
        ) {
          errors.push(fieldError(`${path}.metrics[${metricIndex}]`, "invalid", `放行快照 ${name} 的第 ${metricIndex + 1} 条指标结构无效`));
        }
      });
    }
    if (!Array.isArray(snapshot.blockers)) {
      errors.push(fieldError(`${path}.blockers`, "invalid", `放行快照 ${name} 的阻止项结构无效`));
    } else {
      snapshot.blockers.forEach((blocker, blockerIndex) => {
        const blockerPath = `${path}.blockers[${blockerIndex}]`;
        if (!isRecord(blocker) || !isNonEmptyString(blocker.code) || !isNonEmptyString(blocker.message)) {
          errors.push(fieldError(blockerPath, "invalid", `放行快照 ${name} 的第 ${blockerIndex + 1} 条阻止项结构无效`));
          return;
        }
        if (blocker.accessionId !== undefined && !accessionIds.has(String(blocker.accessionId))) {
          errors.push(fieldError(`${blockerPath}.accessionId`, "broken_reference", `放行快照 ${name} 的阻止项引用了不存在的材料 ${String(blocker.accessionId)}`));
        }
        if (blocker.benchId !== undefined && !benchIds.has(String(blocker.benchId))) {
          errors.push(fieldError(`${blockerPath}.benchId`, "broken_reference", `放行快照 ${name} 的阻止项引用了不存在的台架 ${String(blocker.benchId)}`));
        }
      });
    }
  });
}

function collectId(
  id: unknown,
  ids: Set<string>,
  path: string,
  labelText: string,
  errors: FieldError[],
): void {
  if (!isNonEmptyString(id)) {
    errors.push(fieldError(`${path}.id`, "required", `${labelText}记录缺少标识`));
    return;
  }
  if (ids.has(id)) {
    errors.push(fieldError(`${path}.id`, "conflict", `${labelText}记录标识 ${id} 与文件内其他记录冲突`));
    return;
  }
  ids.add(id);
}

function checkMeasurement(
  value: unknown,
  bounds: { min: number; max: number },
  path: string,
  labelText: string,
  passName: string,
  errors: FieldError[],
): void {
  if (!isFiniteNumber(value) || value < bounds.min || value > bounds.max) {
    errors.push(
      fieldError(path, "range", `观测记录 ${passName} 的${labelText}超出 ${bounds.min}-${bounds.max} 范围`),
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isDateOnly(value: unknown): value is string {
  return typeof value === "string" && parseDateOnly(value) !== null;
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function label(value: unknown): string {
  return isNonEmptyString(value) ? value : "（未命名）";
}
