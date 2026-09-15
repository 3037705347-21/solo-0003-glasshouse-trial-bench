import type {
  IncidentKind,
  QualityIncident,
  WorkspaceState,
} from "./types";
import { createId } from "./id";
import { parseDateOnly, todayDateOnly } from "./rules";
import { fail, fieldError, ok, type Result } from "./result";

export const INCIDENT_KINDS: IncidentKind[] = [
  "contamination",
  "quality",
  "loss",
];

export interface IncidentDraft {
  kind: IncidentKind;
  accessionIds: string[];
  observationPassId: string;
  flagId: string;
  discoveredOn: string;
  cause: string;
  scope: string;
  initialAction: string;
}

export function incidentKindLabel(kind: IncidentKind): string {
  if (kind === "contamination") {
    return "疑似污染";
  }
  if (kind === "quality") {
    return "品质异常";
  }
  return "意外损耗";
}

export function incidentStatusLabel(incident: QualityIncident): string {
  return incident.status === "active" ? "活动中" : "已解除";
}

export function validateIncidentDraft(
  draft: IncidentDraft,
  state: WorkspaceState,
): Result<IncidentDraft> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  if (!INCIDENT_KINDS.includes(draft.kind)) {
    errors.push(fieldError("kind", "invalid", "请选择事件类型"));
  }
  const accessionIds = Array.from(new Set(draft.accessionIds));
  if (accessionIds.length === 0) {
    errors.push(
      fieldError("accessionIds", "empty", "请至少选择一个受影响材料"),
    );
  }
  accessionIds.forEach((accessionId) => {
    if (!state.accessions.some((item) => item.id === accessionId)) {
      errors.push(
        fieldError("accessionIds", "unknown", "所选材料不存在，请重新选择"),
      );
    }
  });
  if (!parseDateOnly(draft.discoveredOn)) {
    errors.push(
      fieldError("discoveredOn", "invalid_date", "发现时间无效"),
    );
  } else {
    const discovered = parseDateOnly(draft.discoveredOn);
    const today = parseDateOnly(todayDateOnly());
    if (discovered && today && discovered.getTime() > today.getTime()) {
      errors.push(
        fieldError("discoveredOn", "future", "发现时间不能晚于今天"),
      );
    }
  }
  if (draft.cause.trim().length < 6) {
    errors.push(
      fieldError("cause", "too_short", "请用至少 6 个字符描述事件原因"),
    );
  }
  if (draft.scope.trim().length < 6) {
    errors.push(
      fieldError("scope", "too_short", "请用至少 6 个字符描述影响范围"),
    );
  }
  if (draft.initialAction.trim().length < 6) {
    errors.push(
      fieldError(
        "initialAction",
        "too_short",
        "请用至少 6 个字符描述已采取的处置动作",
      ),
    );
  }
  if (draft.observationPassId) {
    const pass = state.observationPasses.find(
      (item) => item.id === draft.observationPassId,
    );
    if (!pass) {
      errors.push(
        fieldError("observationPassId", "unknown", "所选观测记录不存在"),
      );
    } else if (
      !pass.entries.some((entry) => accessionIds.includes(entry.accessionId))
    ) {
      errors.push(
        fieldError(
          "observationPassId",
          "mismatch",
          "所选观测不包含任何受影响材料的测量记录",
        ),
      );
    }
  }
  if (draft.flagId) {
    const flag = state.flags.find((item) => item.id === draft.flagId);
    if (!flag) {
      errors.push(fieldError("flagId", "unknown", "所选标记不存在"));
    } else if (!accessionIds.includes(flag.accessionId)) {
      errors.push(
        fieldError(
          "flagId",
          "mismatch",
          "所选标记不属于任何受影响材料",
        ),
      );
    }
  }
  if (errors.length > 0) {
    return fail(errors);
  }
  return ok({
    ...draft,
    accessionIds,
    cause: draft.cause.trim(),
    scope: draft.scope.trim(),
    initialAction: draft.initialAction.trim(),
  });
}

export function createIncident(
  draft: IncidentDraft,
  state: WorkspaceState,
): Result<QualityIncident> {
  const validated = validateIncidentDraft(draft, state);
  if (!validated.ok) {
    return validated;
  }
  const value = validated.value;
  const createdOn = new Date().toISOString();
  return ok({
    id: createId("inc"),
    kind: value.kind,
    accessionIds: value.accessionIds,
    observationPassId: value.observationPassId || undefined,
    flagId: value.flagId || undefined,
    discoveredOn: value.discoveredOn,
    cause: value.cause,
    scope: value.scope,
    actions: [{ recordedOn: createdOn, note: value.initialAction }],
    status: "active",
    createdOn,
  });
}

export function appendIncidentAction(
  incident: QualityIncident,
  note: string,
): Result<QualityIncident> {
  if (incident.status !== "active") {
    return fail([
      fieldError("status", "not_active", "只有进行中的事件可以追加处置"),
    ]);
  }
  if (note.trim().length < 6) {
    return fail([
      fieldError(
        "actionNote",
        "too_short",
        "请用至少 6 个字符描述处置动作",
      ),
    ]);
  }
  return ok({
    ...incident,
    actions: [
      ...incident.actions,
      { recordedOn: new Date().toISOString(), note: note.trim() },
    ],
  });
}

export function liftIncident(
  incident: QualityIncident,
  resolution: string,
): Result<QualityIncident> {
  if (incident.status !== "active") {
    return fail([
      fieldError("status", "not_active", "只有进行中的事件可以解除"),
    ]);
  }
  if (resolution.trim().length < 8) {
    return fail([
      fieldError(
        "resolution",
        "too_short",
        "请填写至少 8 个字符的解除结论",
      ),
    ]);
  }
  return ok({
    ...incident,
    status: "lifted",
    liftedOn: new Date().toISOString(),
    resolution: resolution.trim(),
  });
}

export function incidentsForAccession(
  incidents: QualityIncident[],
  accessionId: string,
): QualityIncident[] {
  return incidents.filter((incident) =>
    incident.accessionIds.includes(accessionId),
  );
}

export function activeIncidentsForAccession(
  incidents: QualityIncident[],
  accessionId: string,
): QualityIncident[] {
  return incidentsForAccession(incidents, accessionId).filter(
    (incident) => incident.status === "active",
  );
}

export function incidentTouchesTrial(
  incident: QualityIncident,
  state: WorkspaceState,
  trialId: string,
): boolean {
  return incident.accessionIds.some(
    (accessionId) =>
      state.accessions.find((item) => item.id === accessionId)?.trialId ===
      trialId,
  );
}

export function incidentMatchesQuery(
  incident: QualityIncident,
  state: WorkspaceState,
  statusFilter: "all" | "active" | "lifted",
  trialFilter: string,
): boolean {
  const matchesStatus =
    statusFilter === "all" || incident.status === statusFilter;
  const matchesTrial =
    !trialFilter || incidentTouchesTrial(incident, state, trialFilter);
  return matchesStatus && matchesTrial;
}
