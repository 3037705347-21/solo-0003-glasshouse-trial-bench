import type {
  Accession,
  Flag,
  ObservationEntry,
  ObservationPass,
  RuleVersion,
  WorkspaceState,
} from "./types";
import { createId } from "./id";
import { parseDateOnly, todayDateOnly } from "./rules";
import {
  resolveRuleVersion,
  RULE_METRIC_LABELS,
  ruleVersionLabel,
} from "./ruleVersion";
import { fail, fieldError, ok, type Result } from "./result";

export interface ObservationDraft {
  trialId: string;
  observedOn: string;
  observer: string;
  ruleVersionId: string;
  entries: ObservationEntry[];
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
  const resolution = trial
    ? resolveRuleVersion(state, trial.id)
    : { kind: "none" as const };
  const ruleVersion =
    resolution.kind === "resolved" ? resolution.version : undefined;
  if (trial) {
    if (!ruleVersion) {
      errors.push(
        fieldError(
          "ruleVersionId",
          "no_rule_version",
          "该试验没有启用的规则版本，请先在规则版本页启用后再记录观测",
        ),
      );
    } else if (draft.ruleVersionId !== ruleVersion.id) {
      errors.push(
        fieldError(
          "ruleVersionId",
          "stale_rule_version",
          `当前启用的规则版本是 ${ruleVersionLabel(ruleVersion, state.trials)}，请刷新表单后重新提交`,
        ),
      );
    }
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
  const accessionIds = new Set(state.accessions.map((item) => item.id));
  const seen = new Set<string>();
  draft.entries.forEach((entry, index) => {
    if (!accessionIds.has(entry.accessionId)) {
      errors.push(
        fieldError(
          `entries.${index}.accessionId`,
          "unknown",
          "请选择有效材料",
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
    if (!ruleVersion) {
      return;
    }
    const ranges = ruleVersion.ranges;
    if (
      Number.isNaN(entry.heightMm) ||
      entry.heightMm < ranges.heightMm.min ||
      entry.heightMm > ranges.heightMm.max
    ) {
      errors.push(
        fieldError(
          `entries.${index}.heightMm`,
          "range",
          `${RULE_METRIC_LABELS.heightMm}必须在 ${ranges.heightMm.min}-${ranges.heightMm.max} 之间`,
        ),
      );
    }
    if (
      Number.isNaN(entry.leafCount) ||
      entry.leafCount < ranges.leafCount.min ||
      entry.leafCount > ranges.leafCount.max
    ) {
      errors.push(
        fieldError(
          `entries.${index}.leafCount`,
          "range",
          `${RULE_METRIC_LABELS.leafCount}必须在 ${ranges.leafCount.min}-${ranges.leafCount.max} 之间`,
        ),
      );
    }
    if (
      Number.isNaN(entry.ecMs) ||
      entry.ecMs < ranges.ecMs.min ||
      entry.ecMs > ranges.ecMs.max
    ) {
      errors.push(
        fieldError(
          `entries.${index}.ecMs`,
          "range",
          `${RULE_METRIC_LABELS.ecMs}必须在 ${ranges.ecMs.min}-${ranges.ecMs.max} 之间`,
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
  return ok({
    id: createId("obs"),
    trialId: value.trialId,
    observedOn: value.observedOn,
    observer: value.observer,
    ruleVersionId: value.ruleVersionId,
    entries: value.entries.map((entry) => ({ ...entry })),
  });
}

export interface FlagSeed {
  trialId: string;
  accessionId: string;
  observationPassId: string;
  code: string;
  message: string;
  severity: "info" | "warning" | "critical";
  ruleVersionId?: string;
}

export function deriveFlags(
  pass: ObservationPass,
  accessions: Accession[],
  ruleVersion: RuleVersion,
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
    ruleVersion.flagConditions.forEach((condition) => {
      const value = entry[condition.metric];
      const triggered =
        condition.comparator === "lt"
          ? value < condition.threshold
          : value >= condition.threshold;
      if (!triggered) {
        return;
      }
      flags.push(
        makeFlag(
          {
            trialId: pass.trialId,
            accessionId: entry.accessionId,
            observationPassId: pass.id,
            code: condition.code,
            message: interpolateTemplate(condition.messageTemplate, {
              cultivar: accession.cultivar,
              threshold: condition.threshold,
              value,
            }),
            severity: condition.severity,
            ruleVersionId: ruleVersion.id,
          },
          createdOn,
        ),
      );
    });
  });
  return flags;
}

function interpolateTemplate(
  template: string,
  vars: Record<string, string | number>,
): string {
  return template.replace(
    /\{(cultivar|threshold|value)\}/g,
    (match, key: string) => String(vars[key] ?? match),
  );
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
    .filter((pass) => pass.entries.some((entry) => entry.accessionId === accessionId))
    .sort((left, right) => right.observedOn.localeCompare(left.observedOn));
  return matches[0]?.entries.find((entry) => entry.accessionId === accessionId);
}
