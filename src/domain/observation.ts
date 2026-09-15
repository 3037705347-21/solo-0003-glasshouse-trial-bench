import type {
  Accession,
  Flag,
  FlagRevision,
  FlagState,
  ObservationEntry,
  ObservationPass,
  ReinterpretationRecord,
  RuleSet,
  WorkspaceState,
} from "./types";
import { createId } from "./id";
import { parseDateOnly, todayDateOnly } from "./rules";
import { renderFlagMessage } from "./ruleset";
import { fail, fieldError, ok, type Result } from "./result";
import { isAccessionRetired } from "./accession";

export interface ObservationDraft {
  trialId: string;
  observedOn: string;
  observer: string;
  entries: ObservationEntry[];
}

export function validateObservationDraft(
  draft: ObservationDraft,
  state: WorkspaceState,
  ruleSet: RuleSet,
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
  const bounds = ruleSet.growthBounds;
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
      entry.heightMm < bounds.heightMm.min ||
      entry.heightMm > bounds.heightMm.max
    ) {
      errors.push(
        fieldError(
          `entries.${index}.heightMm`,
          "range",
          `株高必须在 ${bounds.heightMm.min}-${bounds.heightMm.max} 毫米之间`,
        ),
      );
    }
    if (
      Number.isNaN(entry.leafCount) ||
      entry.leafCount < bounds.leafCount.min ||
      entry.leafCount > bounds.leafCount.max
    ) {
      errors.push(
        fieldError(
          `entries.${index}.leafCount`,
          "range",
          `叶片数必须在 ${bounds.leafCount.min}-${bounds.leafCount.max} 之间`,
        ),
      );
    }
    if (
      Number.isNaN(entry.ecMs) ||
      entry.ecMs < bounds.ecMs.min ||
      entry.ecMs > bounds.ecMs.max
    ) {
      errors.push(
        fieldError(
          `entries.${index}.ecMs`,
          "range",
          `电导率必须在 ${bounds.ecMs.min}-${bounds.ecMs.max} mS/cm 之间`,
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
  ruleSet: RuleSet,
): Result<ObservationPass> {
  const validated = validateObservationDraft(draft, state, ruleSet);
  if (!validated.ok) {
    return validated;
  }
  const value = validated.value;
  return ok({
    id: createId("obs"),
    trialId: value.trialId,
    observedOn: value.observedOn,
    observer: value.observer,
    entries: value.entries.map((entry) => ({ ...entry })),
    ruleSetId: ruleSet.id,
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

/**
 * 依据给定规则版本从观测记录派生标记。
 * 这是纯函数：同一份观测加同一份规则版本永远得到同一组标记，
 * 因此任何历史结论都可以用存储的规则版本复现。
 */
export function deriveFlags(
  pass: ObservationPass,
  accessions: Accession[],
  ruleSet: RuleSet,
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
    ruleSet.flagThresholds.forEach((threshold) => {
      const measured = entry[threshold.metric];
      const triggered =
        threshold.comparator === "lt"
          ? measured < threshold.value
          : measured >= threshold.value;
      if (!triggered) {
        return;
      }
      flags.push(
        makeFlag(
          {
            trialId: pass.trialId,
            accessionId: entry.accessionId,
            observationPassId: pass.id,
            code: threshold.code,
            message: renderFlagMessage(threshold.messageTemplate, {
              cultivar: accession.cultivar,
              value: threshold.value,
            }),
            severity: threshold.severity,
          },
          createdOn,
          ruleSet.id,
        ),
      );
    });
  });
  return flags;
}

function makeFlag(seed: FlagSeed, createdOn: string, ruleSetId: string): Flag {
  return {
    ...seed,
    id: createId("flg"),
    state: "open",
    createdOn,
    ruleSetId,
    revisionHistory: [],
  };
}

function appendRevision(
  flag: Flag,
  toState: FlagState,
  note: string,
  changedOn: string,
): FlagRevision[] {
  return [
    ...flag.revisionHistory,
    {
      id: createId("frev"),
      changedOn,
      fromState: flag.state,
      toState,
      note: note.trim(),
    },
  ];
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
  const changedOn = new Date().toISOString();
  return ok({
    ...flag,
    state: next,
    resolvedOn: changedOn,
    resolutionNote: note.trim(),
    revisionHistory: appendRevision(flag, next, note, changedOn),
  });
}

/**
 * 更正一条已经由人工处理的标记：重开为未处理状态。
 * 被规则取代（superseded）的标记属于历史结论，不能再更正；
 * 重开必须填写说明，并完整保留在修订历史中。
 */
export function correctFlagState(
  flag: Flag,
  note: string,
): Result<Flag> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  if (flag.state !== "resolved" && flag.state !== "waived") {
    errors.push(
      fieldError(
        "state",
        "not_correctable",
        flag.state === "superseded"
          ? "被规则取代的标记是历史结论，不能更正"
          : "只有已解决或已豁免的标记需要更正",
      ),
    );
  }
  if (note.trim().length < 8) {
    errors.push(
      fieldError("note", "too_short", "请填写至少 8 个字符的更正说明"),
    );
  }
  if (errors.length > 0) {
    return fail(errors);
  }
  const changedOn = new Date().toISOString();
  return ok({
    ...flag,
    state: "open",
    resolvedOn: undefined,
    resolutionNote: undefined,
    revisionHistory: appendRevision(flag, "open", note, changedOn),
  });
}

export interface ReinterpretationPlan {
  pass: ObservationPass;
  targetRuleSet: RuleSet;
  created: Flag[];
  superseded: Flag[];
  carried: Flag[];
}

function flagKey(flag: Pick<Flag, "accessionId" | "code">): string {
  return `${flag.accessionId}::${flag.code}`;
}

/**
 * 计算用另一份规则版本重新解释某次观测的差异，不落库。
 * 预览和确认共用同一份计划，保证用户看到的就是将要发生的。
 */
export function planReinterpretation(
  state: WorkspaceState,
  passId: string,
  targetRuleSet: RuleSet,
): Result<ReinterpretationPlan> {
  const pass = state.observationPasses.find((item) => item.id === passId);
  if (!pass) {
    return fail([fieldError("passId", "unknown", "找不到该观测记录")]);
  }
  if (targetRuleSet.status !== "published") {
    return fail([
      fieldError("ruleSetId", "retired", "不能按已退役的规则版本重新解释"),
    ]);
  }
  const derived = deriveFlags(pass, state.accessions, targetRuleSet);
  const current = state.flags.filter(
    (flag) => flag.observationPassId === passId && flag.state !== "superseded",
  );
  const derivedKeys = new Set(derived.map(flagKey));
  const currentByKey = new Map(current.map((flag) => [flagKey(flag), flag]));
  const carried = current.filter((flag) => derivedKeys.has(flagKey(flag)));
  const superseded = current.filter(
    (flag) => flag.state === "open" && !derivedKeys.has(flagKey(flag)),
  );
  const created = derived.filter((flag) => !currentByKey.has(flagKey(flag)));
  return ok({ pass, targetRuleSet, created, superseded, carried });
}

/**
 * 应用重新解释计划：
 * - 仍然触发的标记原样保留（包括人工解决/豁免的决定）；
 * - 不再触发且仍未处理的标记转为 superseded，内容保留、记录原因；
 * - 新触发的标记以目标规则版本新建。
 * 旧结论从不删除或改写，只被取代，因此历史始终可解释。
 */
export function applyReinterpretation(
  plan: ReinterpretationPlan,
  note: string,
): Result<{ updatedFlags: Flag[]; createdFlags: Flag[]; record: ReinterpretationRecord }> {
  if (note.trim().length < 8) {
    return fail([
      fieldError("note", "too_short", "请用至少 8 个字符说明重新解释的原因"),
    ]);
  }
  const changedOn = new Date().toISOString();
  const updatedFlags = plan.superseded.map((flag) => ({
    ...flag,
    state: "superseded" as FlagState,
    supersededOn: changedOn,
    supersededReason: note.trim(),
    supersededByRuleSetId: plan.targetRuleSet.id,
    revisionHistory: appendRevision(flag, "superseded", note, changedOn),
  }));
  const record: ReinterpretationRecord = {
    id: createId("reinterpret"),
    passId: plan.pass.id,
    trialId: plan.pass.trialId,
    fromRuleSetId: plan.pass.ruleSetId,
    toRuleSetId: plan.targetRuleSet.id,
    createdFlagIds: plan.created.map((flag) => flag.id),
    supersededFlagIds: plan.superseded.map((flag) => flag.id),
    carriedFlagIds: plan.carried.map((flag) => flag.id),
    note: note.trim(),
    createdOn: changedOn,
  };
  return ok({ updatedFlags, createdFlags: plan.created, record });
}

export function latestObservationForAccession(
  passes: ObservationPass[],
  accessionId: string,
): ObservationEntry | undefined {
  const matches = passes
    .filter((pass) => pass.entries.some((entry) => entry.accessionId === accessionId))
    .sort((left, right) => right.observedOn.localeCompare(left.observedOn));
  return matches[0]?.entries.find((entry) => entry.accessionId === accessionId);
}
