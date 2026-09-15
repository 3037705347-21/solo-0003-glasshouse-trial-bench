import type {
  Accession,
  Flag,
  ObservationEntry,
  ObservationPass,
  WorkspaceState,
} from "./types";
import { createId } from "./id";
import { GROWTH_BOUNDS, parseDateOnly, todayDateOnly } from "./rules";
import { fail, fieldError, ok, type Result } from "./result";
import { isAccessionRetired } from "./accession";
import { fingerprintObservationDraft, mintIdempotencyToken } from "./dedup";

export interface ObservationDraft {
  trialId: string;
  observedOn: string;
  observer: string;
  entries: ObservationEntry[];
  /** 表单打开时生成、重试时复用；缺省时由领域层补一个新令牌。 */
  idempotencyToken: string;
  /** 预生成的观测 id，保证去重决策与工单引用的是同一条记录。 */
  passId?: string;
}

export function validateObservationDraft(
  draft: ObservationDraft,
  state: WorkspaceState,
): Result<ObservationDraft> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  const trial = state.trials.find((item) => item.id === draft.trialId);
  if (!trial) {
    errors.push(fieldError("trialId", "unknown", "请选择有效试验"));
  } else if (trial.state !== "active" && trial.state !== "draft") {
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
    } else if (isAccessionRetired(accession)) {
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
    idempotencyToken: draft.idempotencyToken || mintIdempotencyToken(),
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
  const recordedAt = new Date().toISOString();
  return ok({
    id: value.passId ?? createId("obs"),
    trialId: value.trialId,
    observedOn: value.observedOn,
    observer: value.observer,
    entries: value.entries.map((entry) => ({ ...entry })),
    idempotencyToken: value.idempotencyToken,
    contentFingerprint: fingerprintObservationDraft(value),
    recordedAt,
    dedupStatus: "canonical",
    convergedAccessionIds: [],
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

/**
 * 观测被去重收敛后，撤回其派生的未处理标记：
 * open → withdrawn 并写明收敛去向；已处理的标记保持原样（历史结论不被去重改写）。
 */
export function withdrawFlagsForConvergedPasses(
  flags: Flag[],
  convergedPassIds: string[],
  reason: string,
): Flag[] {
  const targets = new Set(convergedPassIds);
  return flags.map((flag) => {
    if (flag.state !== "open" || !targets.has(flag.observationPassId)) {
      return flag;
    }
    return {
      ...flag,
      state: "withdrawn",
      resolvedOn: new Date().toISOString(),
      resolutionNote: reason,
    };
  });
}

/**
 * 条目级撤回：部分收敛时，只撤回被收敛材料的 open 标记，
 * 同一观测中其他材料的标记继续有效。
 */
export function withdrawFlagsForConvergedEntries(
  flags: Flag[],
  keys: Array<{ passId: string; accessionId: string }>,
  reason: string,
): Flag[] {
  const keySet = new Set(keys.map((key) => `${key.passId}::${key.accessionId}`));
  const resolvedOn = new Date().toISOString();
  return flags.map((flag) => {
    if (
      flag.state !== "open" ||
      !keySet.has(`${flag.observationPassId}::${flag.accessionId}`)
    ) {
      return flag;
    }
    return {
      ...flag,
      state: "withdrawn",
      resolvedOn,
      resolutionNote: reason,
    };
  });
}

export function latestObservationForAccession(
  passes: ObservationPass[],
  accessionId: string,
): ObservationEntry | undefined {
  const matches = passes
    .filter(
      (pass) =>
        pass.dedupStatus !== "converged" &&
        pass.entries.some(
          (entry) =>
            entry.accessionId === accessionId &&
            !pass.convergedAccessionIds.includes(accessionId),
        ),
    )
    .sort((left, right) => right.observedOn.localeCompare(left.observedOn));
  return matches[0]?.entries.find((entry) => entry.accessionId === accessionId);
}
