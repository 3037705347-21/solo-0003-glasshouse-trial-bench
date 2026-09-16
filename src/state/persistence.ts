import type {
  Accession,
  ConsumptionEvent,
  WorkspaceState,
} from "../domain/types";
import { isWorkspaceState } from "./types";
import { createSampleWorkspaceState } from "./sampleData";

export const WORKSPACE_STORAGE_KEY = "glasshouse-trial-bench:workspace:v1";

function normalizeAccession(accession: Accession): Accession {
  return {
    ...accession,
    lifecycleStatus:
      accession.lifecycleStatus ??
      (accession.retiredAt ? "retired" : "active"),
    retirementHistory: Array.isArray(accession.retirementHistory)
      ? accession.retirementHistory
      : [],
  };
}

function normalizeConsumptionEvent(
  event: ConsumptionEvent,
): ConsumptionEvent | null {
  if (
    !event ||
    typeof event.id !== "string" ||
    typeof event.accessionId !== "string" ||
    typeof event.delta !== "number" ||
    typeof event.usedOn !== "string" ||
    typeof event.note !== "string"
  ) {
    return null;
  }
  return {
    ...event,
    kind: ["use", "correction", "transfer"].includes(event.kind)
      ? event.kind
      : "use",
    destination: ["trial", "activity", "waste", "merge"].includes(
      event.destination,
    )
      ? event.destination
      : "activity",
    ref:
      event.ref && typeof event.ref.label === "string"
        ? event.ref
        : { label: "未记录去向" },
    recordedAt: event.recordedAt ?? new Date(0).toISOString(),
    recordedBy: event.recordedBy ?? "未知",
  };
}

export function normalizeWorkspaceState(
  state: WorkspaceState,
): WorkspaceState {
  return {
    ...state,
    accessions: state.accessions.map(normalizeAccession),
    consumptionEvents: (
      Array.isArray(state.consumptionEvents)
        ? state.consumptionEvents
        : []
    ).flatMap((event) => {
      const normalized = normalizeConsumptionEvent(event);
      return normalized ? [normalized] : [];
    }),
  };
}

export interface StoredWorkspace {
  version: 1;
  savedAt: string;
  state: WorkspaceState;
}

export function loadWorkspaceState(): WorkspaceState {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) {
      return createSampleWorkspaceState();
    }
    const parsed = JSON.parse(raw) as Partial<StoredWorkspace>;
    if (!parsed || !isWorkspaceState(parsed.state)) {
      return createSampleWorkspaceState();
    }
    return normalizeWorkspaceState(parsed.state);
  } catch {
    return createSampleWorkspaceState();
  }
}

export function saveWorkspaceState(state: WorkspaceState): void {
  const stored: StoredWorkspace = {
    version: 1,
    savedAt: new Date().toISOString(),
    state,
  };
  window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(stored));
}

export function clearWorkspaceStorage(): void {
  window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
}
