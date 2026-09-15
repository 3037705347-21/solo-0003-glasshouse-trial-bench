import type {
  Accession,
  ObservationEntry,
  ObservationPass,
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
    entries: value.entries.map((entry) => ({ ...entry })),
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
