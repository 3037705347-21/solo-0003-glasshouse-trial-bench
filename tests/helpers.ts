import type {
  Accession,
  Bench,
  ObservationEntry,
  ObservationPass,
  PreferredLight,
  Trial,
  WorkspaceState,
} from "../src/domain/types";
import type { AccessionDraft } from "../src/domain/accession";
import type { ObservationDraft } from "../src/domain/observation";
import type { FieldError, Result } from "../src/domain/result";

let sequence = 0;

/**
 * Deterministic, human-readable ids for test fixtures so failure output stays
 * readable and tests never depend on the production random id generator.
 */
export function testId(kind: string, key: string | number): string {
  if (typeof key === "string") {
    return key.startsWith(`${kind}-`) ? key : `${kind}-${key}`;
  }
  return `${kind}-${String(key).replace(/[^a-zA-Z0-9-]/g, "_")}`;
}

/**
 * Fixture overrides accept a short numeric id which the factory expands into
 * the entity's prefixed string id.
 */
type Override<T> = Omit<Partial<T>, "id"> & { id?: string | number };

export function makeTrial(overrides: Override<Trial> = {}): Trial {
  const { id, ...rest } = overrides;
  return {
    id: id === undefined ? testId("trl", ++sequence) : testId("trl", id),
    code: "TST-01",
    cropFamily: "测试科属",
    objective: "用于自动化测试的试验目标描述。",
    season: "春季",
    startDate: "2026-03-01",
    endDate: "2026-06-01",
    state: "active",
    ...rest,
  };
}

export function makeAccession(
  overrides: Override<Accession> = {},
): Accession {
  const { id, accessionNo, ...rest } = overrides;
  const resolvedId = id === undefined ? testId("acc", ++sequence) : testId("acc", id);
  return {
    id: resolvedId,
    trialId: "trl-1",
    accessionNo:
      accessionNo ??
      `ACC-${String(resolvedId).replace(/\D/g, "").padStart(4, "0")}`,
    cultivar: "Test Cultivar",
    source: "Test Seed Source",
    propagatedOn: "2026-03-05",
    quantity: 48,
    trayCells: 72,
    preferredLight: "full-sun",
    genotypeNote: "用于自动化测试的基因型批次说明。",
    labels: [],
    ...rest,
  };
}

export function makeBench(overrides: Override<Bench> = {}): Bench {
  const { id, ...rest } = overrides;
  return {
    id: id === undefined ? testId("bench", ++sequence) : testId("bench", id),
    code: "B-1",
    sector: "测试区",
    capacity: 4,
    assignedIds: [],
    lightProfile: "full-sun",
    irrigationLine: "IR-T",
    status: "available",
    ...rest,
  };
}

export function makeEntry(
  overrides: Partial<ObservationEntry> = {},
): ObservationEntry {
  return {
    accessionId: "acc-1",
    heightMm: 100,
    leafCount: 8,
    ecMs: 1.8,
    notes: "",
    ...overrides,
  };
}

export function makePass(
  overrides: Override<ObservationPass> = {},
): ObservationPass {
  const { id, ...rest } = overrides;
  return {
    id: id === undefined ? testId("obs", ++sequence) : testId("obs", id),
    trialId: "trl-1",
    observedOn: "2026-03-10",
    observer: "T. Observer",
    entries: [makeEntry()],
    ...rest,
  };
}

export function makeState(
  overrides: Partial<WorkspaceState> = {},
): WorkspaceState {
  return {
    trials: [],
    accessions: [],
    benches: [],
    observationPasses: [],
    flags: [],
    clearanceSnapshots: [],
    ...overrides,
  };
}

/**
 * A small but fully connected workspace: one active trial, two accessions and
 * two compatible benches, all empty.
 */
export function makeTrialWorkspace(): {
  state: WorkspaceState;
  trial: Trial;
  accessions: Accession[];
  benches: Bench[];
} {
  const trial = makeTrial({ id: 1 });
  const accessions = [
    makeAccession({
      id: 1,
      trialId: trial.id,
      accessionNo: "ACC-0001",
      // partial-shade accepts both full-sun and partial-shade benches, so
      // fixture scenarios can move this accession between the two benches.
      preferredLight: "partial-shade",
    }),
    makeAccession({
      id: 2,
      trialId: trial.id,
      accessionNo: "ACC-0002",
      preferredLight: "full-sun",
    }),
  ];
  const benches = [
    makeBench({ id: 1, code: "S-1", lightProfile: "full-sun", capacity: 2 }),
    makeBench({ id: 2, code: "H-1", lightProfile: "partial-shade", capacity: 2 }),
  ];
  return { state: makeState({ trials: [trial], accessions, benches }), trial, accessions, benches };
}

export function validAccessionDraft(
  overrides: Partial<AccessionDraft> = {},
): AccessionDraft {
  return {
    trialId: "trl-1",
    accessionNo: "ACC-0001",
    cultivar: "Test Cultivar",
    source: "Test Seed Source",
    propagatedOn: "2026-03-05",
    quantity: 48,
    trayCells: 72,
    preferredLight: "full-sun",
    genotypeNote: "用于自动化测试的基因型批次说明。",
    labels: [],
    ...overrides,
  };
}

export function validObservationDraft(
  overrides: Partial<ObservationDraft> = {},
): ObservationDraft {
  return {
    trialId: "trl-1",
    observedOn: "2026-03-10",
    observer: "T. Observer",
    entries: [makeEntry()],
    ...overrides,
  };
}

export type FailedResult = { ok: false; errors: FieldError[] };

/** Assert a Result is a failure and return its field errors for inspection. */
export function expectFailure(result: Result<unknown>): FailedResult {
  if (result.ok) {
    throw new Error("Expected the result to be rejected, but it succeeded");
  }
  return result;
}

export function errorCodes(result: FailedResult): string[] {
  return result.errors.map((error) => error.code);
}

export function errorFields(result: FailedResult): string[] {
  return result.errors.map((error) => error.field);
}

export function findError(
  result: FailedResult,
  field: string,
): FieldError | undefined {
  return result.errors.find((error) => error.field === field);
}

export const LIGHTS: PreferredLight[] = ["full-sun", "partial-shade", "shade"];
