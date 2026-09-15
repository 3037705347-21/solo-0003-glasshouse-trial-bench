import type {
  Accession,
  Bench,
  ClearanceSnapshot,
  Flag,
  ObservationPass,
  Trial,
  WorkspaceState,
} from "../src/domain/types";

export function makeTrial(overrides: Partial<Trial> = {}): Trial {
  return {
    id: "trial-1",
    code: "TST-01",
    cropFamily: "茄科",
    objective: "用于数据质量测试的试验目标，至少十二个字。",
    season: "春季",
    startDate: "2026-02-01",
    endDate: "2026-05-01",
    state: "active",
    ...overrides,
  };
}

export function makeAccession(overrides: Partial<Accession> = {}): Accession {
  return {
    id: "acc-1",
    trialId: "trial-1",
    accessionNo: "ACC-0001",
    cultivar: "Tiny Tim",
    source: "Pioneer Seed Lab",
    propagatedOn: "2026-02-02",
    quantity: 96,
    trayCells: 104,
    preferredLight: "full-sun",
    genotypeNote: "有限生长型矮化品系，节间紧凑。",
    labels: [],
    ...overrides,
  };
}

export function makeBench(overrides: Partial<Bench> = {}): Bench {
  return {
    id: "bench-1",
    code: "B-1",
    sector: "东翼",
    capacity: 4,
    assignedIds: [],
    lightProfile: "full-sun",
    irrigationLine: "IR-1",
    status: "available",
    ...overrides,
  };
}

export function makePass(overrides: Partial<ObservationPass> = {}): ObservationPass {
  return {
    id: "pass-1",
    trialId: "trial-1",
    observedOn: "2026-02-10",
    observer: "M. Ikeda",
    entries: [
      {
        accessionId: "acc-1",
        heightMm: 100,
        leafCount: 8,
        ecMs: 1.8,
        notes: "",
      },
    ],
    ...overrides,
  };
}

export function makeFlag(overrides: Partial<Flag> = {}): Flag {
  return {
    id: "flag-1",
    trialId: "trial-1",
    accessionId: "acc-1",
    observationPassId: "pass-1",
    code: "HT_UNDER",
    message: "低于阈值",
    severity: "warning",
    state: "open",
    createdOn: "2026-02-10T09:00:00.000Z",
    ...overrides,
  };
}

export function makeSnapshot(
  overrides: Partial<ClearanceSnapshot> = {},
): ClearanceSnapshot {
  return {
    id: "snap-1",
    trialId: "trial-1",
    generatedOn: "2026-02-12T09:00:00.000Z",
    status: "blocked",
    metrics: [],
    blockers: [],
    ...overrides,
  };
}

export function makeState(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
  return {
    trials: [makeTrial()],
    accessions: [makeAccession()],
    benches: [makeBench()],
    observationPasses: [makePass()],
    flags: [],
    clearanceSnapshots: [],
    ...overrides,
  };
}

/** 与 sampleData 结构一致的健康工作区（独立构造，避免测试耦合示例数据）。 */
export function makeHealthyWorkspace(): WorkspaceState {
  const trialA = makeTrial();
  const trialB = makeTrial({ id: "trial-2", code: "TST-02", state: "draft" });
  const acc1 = makeAccession();
  const acc2 = makeAccession({
    id: "acc-2",
    accessionNo: "ACC-0002",
    preferredLight: "partial-shade",
    trialId: "trial-2",
  });
  const benchA = makeBench({
    id: "bench-1",
    code: "B-1",
    assignedIds: ["acc-1"],
    status: "assigned",
  });
  const benchB = makeBench({
    id: "bench-2",
    code: "B-2",
    lightProfile: "shade",
    status: "available",
  });
  const pass = makePass({
    entries: [
      { accessionId: "acc-1", heightMm: 120, leafCount: 9, ecMs: 2.0, notes: "" },
    ],
  });
  return {
    trials: [trialA, trialB],
    accessions: [acc1, acc2],
    benches: [benchA, benchB],
    observationPasses: [pass],
    flags: [],
    clearanceSnapshots: [],
  };
}
