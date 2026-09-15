import type {
  Accession,
  Flag,
  ObservationEntry,
  ObservationPass,
  ObservationRevision,
  WorkspaceState,
} from "./types";
import { createId } from "./id";
import { GROWTH_BOUNDS, parseDateOnly, todayDateOnly } from "./rules";
import { fail, fieldError, ok, type Result } from "./result";
import { isAccessionRetired } from "./accession";

export interface ObservationDraft {
  trialId: string;
  observedOn: string;
  observer: string;
  entries: ObservationEntry[];
}

export interface ObservationValidationOptions {
  /**
   * 提供时表示本次校验服务于观测修订：更正是对历史记录的修复，
   * 不受试验状态限制，也允许保留原版本中现已停用的材料行。
   */
  revisionOf?: ObservationPass;
}

export function validateObservationDraft(
  draft: ObservationDraft,
  state: WorkspaceState,
  options: ObservationValidationOptions = {},
): Result<ObservationDraft> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  const trial = state.trials.find((item) => item.id === draft.trialId);
  if (!trial) {
    errors.push(fieldError("trialId", "unknown", "请选择有效试验"));
  } else if (
    !options.revisionOf &&
    trial.state !== "active" &&
    trial.state !== "draft"
  ) {
    errors.push(
      fieldError(
        "trialId",
        "trial_state",
        "只能对进行中或草稿状态的试验添加观测",
      ),
    );
  }
  if (!parseDateOnly(draft.observedOn)) {
    errors.push(
      fieldError("observedOn", "invalid_date", "观测日期无效"),
    );
  } else if (!isDateOnOrBeforeToday(draft.observedOn)) {
    errors.push(
      fieldError(
        "observedOn",
        "future",
        "观测日期不能晚于今天",
      ),
    );
  }
  if (draft.observer.trim().length < 3) {
    errors.push(fieldError("observer", "required", "请填写观测人"));
  }
  if (draft.entries.length === 0) {
    errors.push(
      fieldError("entries", "empty", "请至少添加一条测量记录"),
    );
  }
  const accessionsById = new Map(
    state.accessions.map((item) => [item.id, item]),
  );
  const revisableAccessionIds = new Set(
    (options.revisionOf?.entries ?? []).map((entry) => entry.accessionId),
  );
  const seen = new Set<string>();
  draft.entries.forEach((entry, index) => {
    const accession = accessionsById.get(entry.accessionId);
    if (!accession) {
      errors.push(
        fieldError(
          `entries.${index}.accessionId`,
          "unknown",
          "请选择有效材料",
        ),
      );
    } else if (
      isAccessionRetired(accession) &&
      !revisableAccessionIds.has(entry.accessionId)
    ) {
      errors.push(
        fieldError(
          `entries.${index}.accessionId`,
          "retired",
          `${accession.accessionNo} 已停用，不能进入新观测`,
        ),
      );
    } else if (accession.trialId !== draft.trialId) {
      errors.push(
        fieldError(
          `entries.${index}.accessionId`,
          "cross_trial",
          "观测材料必须属于当前试验",
        ),
      );
    } else if (seen.has(entry.accessionId)) {
      errors.push(
        fieldError(
          `entries.${index}.accessionId`,
          "duplicate",
          "同一材料在单次观测中只能出现一次",
        ),
      );
    }
    seen.add(entry.accessionId);
    if (
      Number.isNaN(entry.heightMm) ||
      entry.heightMm < GROWTH_BOUNDS.heightMm.min ||
      entry.heightMm > GROWTH_BOUNDS.heightMm.max
    ) {
      errors.push(
        fieldError(
          `entries.${index}.heightMm`,
          "range",
          `株高必须在 ${GROWTH_BOUNDS.heightMm.min}-${GROWTH_BOUNDS.heightMm.max} 毫米之间`,
        ),
      );
    }
    if (
      Number.isNaN(entry.leafCount) ||
      entry.leafCount < GROWTH_BOUNDS.leafCount.min ||
      entry.leafCount > GROWTH_BOUNDS.leafCount.max
    ) {
      errors.push(
        fieldError(
          `entries.${index}.leafCount`,
          "range",
          `叶片数必须在 ${GROWTH_BOUNDS.leafCount.min}-${GROWTH_BOUNDS.leafCount.max} 之间`,
        ),
      );
    }
    if (
      Number.isNaN(entry.ecMs) ||
      entry.ecMs < GROWTH_BOUNDS.ecMs.min ||
      entry.ecMs > GROWTH_BOUNDS.ecMs.max
    ) {
      errors.push(
        fieldError(
          `entries.${index}.ecMs`,
          "range",
          `电导率必须在 ${GROWTH_BOUNDS.ecMs.min}-${GROWTH_BOUNDS.ecMs.max} mS/cm 之间`,
        ),
      );
    }
  });
  if (errors.length > 0) {
    return fail(errors);
  }
  return ok({
    ...draft,
    observer: draft.observer.trim(),
  });
}

function isDateOnOrBeforeToday(value: string): boolean {
  const date = parseDateOnly(value);
  const today = parseDateOnly(todayDateOnly());
  return Boolean(date && today && date.getTime() <= today.getTime());
}

export function createObservationPass(
  draft: ObservationDraft,
  state: WorkspaceState,
): Result<ObservationPass> {
  const validated = validateObservationDraft(draft, state);
  if (!validated.ok) {
    return validated;
  }
  const value = validated.value;
  const id = createId("obs");
  return ok({
    id,
    trialId: value.trialId,
    observedOn: value.observedOn,
    observer: value.observer,
    entries: value.entries.map((entry) => ({ ...entry })),
    seriesId: id,
  });
}

export interface FlagSeed {
  trialId: string;
  accessionId: string;
  observationPassId: string;
  code: string;
  message: string;
  severity: "info" | "warning" | "critical";
}

export function deriveFlags(
  pass: ObservationPass,
  accessions: Accession[],
): Flag[] {
  const accessionById = new Map(
    accessions.map((accession) => [accession.id, accession]),
  );
  const createdOn = new Date().toISOString();
  const flags: Flag[] = [];
  pass.entries.forEach((entry) => {
    const accession = accessionById.get(entry.accessionId);
    if (!accession) {
      return;
    }
    if (entry.heightMm < 60) {
      flags.push(
        makeFlag(
          {
            trialId: pass.trialId,
            accessionId: entry.accessionId,
            observationPassId: pass.id,
            code: "HT_UNDER",
            message: `${accession.cultivar} 低于 60 毫米生长阈值`,
            severity: "warning",
          },
          createdOn,
        ),
      );
    }
    if (entry.heightMm >= 420) {
      flags.push(
        makeFlag(
          {
            trialId: pass.trialId,
            accessionId: entry.accessionId,
            observationPassId: pass.id,
            code: "HT_OVER",
            message: `${accession.cultivar} 高于 420 毫米生长阈值`,
            severity: "critical",
          },
          createdOn,
        ),
      );
    }
    if (entry.leafCount < 5) {
      flags.push(
        makeFlag(
          {
            trialId: pass.trialId,
            accessionId: entry.accessionId,
            observationPassId: pass.id,
            code: "LEAF_LOW",
            message: `${accession.cultivar} 的真叶数少于 5 片`,
            severity: "warning",
          },
          createdOn,
        ),
      );
    }
    if (entry.ecMs >= 3.5) {
      flags.push(
        makeFlag(
          {
            trialId: pass.trialId,
            accessionId: entry.accessionId,
            observationPassId: pass.id,
            code: "EC_HIGH",
            message: `${accession.cultivar} 的基质电导率偏高`,
            severity: "critical",
          },
          createdOn,
        ),
      );
    }
  });
  return flags;
}

function makeFlag(seed: FlagSeed, createdOn: string): Flag {
  return {
    ...seed,
    id: createId("flg"),
    state: "open",
    createdOn,
  };
}

export function transitionFlag(
  flag: Flag,
  next: "resolved" | "waived",
  note: string,
): Result<Flag> {
  if (flag.state !== "open") {
    return fail([
      fieldError("state", "not_open", "只有未处理的标记可以变更"),
    ]);
  }
  if (note.trim().length < 8) {
    return fail([
      fieldError(
        "resolutionNote",
        "too_short",
        "请填写至少 8 个字符的处理说明",
      ),
    ]);
  }
  return ok({
    ...flag,
    state: next,
    resolvedOn: new Date().toISOString(),
    resolutionNote: note.trim(),
  });
}

export function latestObservationForAccession(
  passes: ObservationPass[],
  accessionId: string,
): ObservationEntry | undefined {
  const matches = passes
    .filter((pass) => !isPassSuperseded(pass))
    .filter((pass) => pass.entries.some((entry) => entry.accessionId === accessionId))
    .sort((left, right) => right.observedOn.localeCompare(left.observedOn));
  return matches[0]?.entries.find((entry) => entry.accessionId === accessionId);
}

// ---------------------------------------------------------------------------
// 观测修订
//
// 观测版本链：每次更正产生一个不可变的新版本，旧版本保留并通过
// supersedesId / supersededById 指针串联。seriesId 标识整条版本链
// （等于首个版本的 id），版本号 v1..vn 由链上位置派生。
// ---------------------------------------------------------------------------

export interface ObservationRevisionDraft {
  observedOn: string;
  observer: string;
  entries: ObservationEntry[];
  reason: string;
  revisedBy: string;
}

export interface ObservationRevisionOutcome {
  /** 新生效的版本（链头） */
  revision: ObservationPass;
  /** 被取代的版本（已写入 supersededById） */
  supersededPass: ObservationPass;
  /** 因修订失效的未处理标记 */
  retiredFlags: Flag[];
  /** 基于更正后数据重新派生的标记 */
  derivedFlags: Flag[];
  /** 新版本在链上的版本号（v1 起算） */
  version: number;
}

export function isPassSuperseded(pass: ObservationPass): boolean {
  return Boolean(pass.supersededById);
}

export function passSeries(
  passes: ObservationPass[],
  seriesId: string,
): ObservationPass[] {
  return passes.filter((pass) => pass.seriesId === seriesId);
}

/**
 * 将版本链按 v1..vn 排序：从根版本沿 supersededById 走到链头。
 * 正常流程下链是线性的；若异常数据产生分叉，剩余分支按修订时间
 * 确定性追加，保证任何状态下界面都可解释。
 */
export function orderPassSeries(
  series: ObservationPass[],
): ObservationPass[] {
  const byId = new Map(series.map((pass) => [pass.id, pass]));
  const visited = new Set<string>();
  const ordered: ObservationPass[] = [];
  let cursor: ObservationPass | undefined =
    series.find((pass) => !pass.supersedesId) ?? series[0];
  while (cursor && !visited.has(cursor.id)) {
    ordered.push(cursor);
    visited.add(cursor.id);
    cursor = cursor.supersededById ? byId.get(cursor.supersededById) : undefined;
  }
  const remainder = series
    .filter((pass) => !visited.has(pass.id))
    .sort((left, right) => {
      const leftOn = left.revision?.revisedOn ?? "";
      const rightOn = right.revision?.revisedOn ?? "";
      return leftOn.localeCompare(rightOn) || left.id.localeCompare(right.id);
    });
  return [...ordered, ...remainder];
}

export function currentPassForSeries(
  passes: ObservationPass[],
  seriesId: string,
): ObservationPass | undefined {
  const ordered = orderPassSeries(passSeries(passes, seriesId));
  return ordered.find((pass) => !isPassSuperseded(pass)) ?? ordered[ordered.length - 1];
}

export function passVersionNumber(
  series: ObservationPass[],
  pass: ObservationPass,
): number {
  const ordered = orderPassSeries(series);
  const index = ordered.findIndex((item) => item.id === pass.id);
  return index === -1 ? 1 : index + 1;
}

export function reviseObservationPass(
  basePassId: string,
  draft: ObservationRevisionDraft,
  state: WorkspaceState,
): Result<ObservationRevisionOutcome> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  const base = state.observationPasses.find((pass) => pass.id === basePassId);
  if (!base) {
    return fail([
      fieldError("basePassId", "unknown", "要更正的观测版本不存在"),
    ]);
  }
  const series = passSeries(state.observationPasses, base.seriesId);
  const head = currentPassForSeries(state.observationPasses, base.seriesId);
  if (!head || head.id !== base.id) {
    errors.push(
      fieldError(
        "basePassId",
        "stale_base",
        `该观测已存在更新的修订版本 v${passVersionNumber(series, head ?? base)}，请基于最新版本更正`,
      ),
    );
  }
  if (draft.reason.trim().length < 8) {
    errors.push(
      fieldError(
        "reason",
        "too_short",
        "请填写至少 8 个字符的更正原因",
      ),
    );
  }
  if (draft.revisedBy.trim().length < 3) {
    errors.push(fieldError("revisedBy", "required", "请填写更正人"));
  }
  const validated = validateObservationDraft(
    {
      trialId: base.trialId,
      observedOn: draft.observedOn,
      observer: draft.observer,
      entries: draft.entries,
    },
    state,
    { revisionOf: base },
  );
  if (!validated.ok) {
    errors.push(...validated.errors);
  } else if (passContentEquals(base, validated.value)) {
    errors.push(
      fieldError(
        "entries",
        "no_changes",
        "更正内容与当前版本一致，未检测到需要更正的变化",
      ),
    );
  }
  if (errors.length > 0 || !validated.ok) {
    return fail(errors);
  }

  const value = validated.value;
  const revisedOn = new Date().toISOString();
  const version = series.length + 1;
  const revisionRecord: ObservationRevision = {
    id: createId("rev"),
    revisedOn,
    revisedBy: draft.revisedBy.trim(),
    reason: draft.reason.trim(),
    basePassId: base.id,
  };
  const revision: ObservationPass = {
    id: createId("obs"),
    trialId: base.trialId,
    observedOn: value.observedOn,
    observer: value.observer,
    entries: value.entries.map((entry) => ({ ...entry })),
    seriesId: base.seriesId,
    supersedesId: base.id,
    revision: revisionRecord,
  };
  const supersededPass: ObservationPass = {
    ...base,
    supersededById: revision.id,
  };

  // 依赖重估：旧版本的未处理标记随数据失效，但保留在台账中并指向
  // 接替它的新标记；已解决/已豁免的历史处理决定保持不变。
  const derivedFlags = deriveFlags(revision, state.accessions);
  const retiredFlags = state.flags
    .filter(
      (flag) => flag.observationPassId === base.id && flag.state === "open",
    )
    .map((flag) => {
      const successor = derivedFlags.find(
        (candidate) =>
          candidate.accessionId === flag.accessionId &&
          candidate.code === flag.code,
      );
      if (successor) {
        successor.supersedesFlagId = flag.id;
      }
      return {
        ...flag,
        state: "superseded" as const,
        resolvedOn: revisedOn,
        resolutionNote: `因观测修订 v${version} 生效而失效`,
        supersededByFlagId: successor?.id,
      };
    });

  return ok({ revision, supersededPass, retiredFlags, derivedFlags, version });
}

/**
 * 将修订结果应用到工作区状态：旧版本写入取代指针并追加新版本，
 * 失效标记原位替换，新派生标记追加。reducer 与共享状态事务共用。
 */
export function applyObservationRevision(
  state: WorkspaceState,
  outcome: ObservationRevisionOutcome,
): WorkspaceState {
  return {
    ...state,
    observationPasses: [
      ...state.observationPasses.map((pass) =>
        pass.id === outcome.supersededPass.id ? outcome.supersededPass : pass,
      ),
      outcome.revision,
    ],
    flags: [
      ...state.flags.map((flag) => {
        const retired = outcome.retiredFlags.find(
          (item) => item.id === flag.id,
        );
        return retired ?? flag;
      }),
      ...outcome.derivedFlags,
    ],
  };
}

function passContentEquals(
  pass: ObservationPass,
  draft: ObservationDraft,
): boolean {
  if (pass.observedOn !== draft.observedOn || pass.observer !== draft.observer) {
    return false;
  }
  return JSON.stringify(pass.entries) === JSON.stringify(draft.entries);
}
