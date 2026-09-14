import { describe, expect, it } from "vitest";
import {
  applyClearance,
  blockerCount,
  buildClearanceSnapshot,
  canClearTrial,
  snapshotForTrial,
} from "../src/domain/clearance";
import type {
  Accession,
  Bench,
  ClearanceSnapshot,
  Flag,
  WorkspaceState,
} from "../src/domain/types";
import {
  makeAccession,
  makeBench,
  makeState,
  makeTrial,
} from "./helpers";

function readyState(
  overrides: {
    trialState?: "draft" | "active" | "paused" | "cleared";
    accessions?: Accession[];
    benches?: Bench[];
    flags?: Flag[];
  } = {},
): WorkspaceState {
  const trial = makeTrial({ id: 1, state: overrides.trialState ?? "active" });
  const accessions = overrides.accessions ?? [
    makeAccession({ id: 1, trialId: trial.id, accessionNo: "ACC-0001" }),
  ];
  const benches = overrides.benches ?? [
    makeBench({
      id: 1,
      status: "assigned",
      assignedIds: accessions.map((accession) => accession.id),
    }),
  ];
  return makeState({
    trials: [trial],
    accessions,
    benches,
    flags: overrides.flags ?? [],
  });
}

function makeFlag(overrides: Partial<Flag> = {}): Flag {
  return {
    id: "flg-1",
    trialId: "trl-1",
    accessionId: "acc-1",
    observationPassId: "obs-1",
    code: "HT_UNDER",
    message: "低于阈值",
    severity: "warning",
    state: "open",
    createdOn: "2026-03-10T08:00:00.000Z",
    ...overrides,
  };
}

function metric(snapshot: ClearanceSnapshot, label: string): number | undefined {
  return snapshot.metrics.find((item) => item.label === label)?.value;
}

function blockerCodes(snapshot: ClearanceSnapshot): string[] {
  return snapshot.blockers.map((blocker) => blocker.code);
}

describe("放行快照 - 就绪场景", () => {
  it("活动试验、全部材料已分配、台架可用且无未处理标记时为 ready", () => {
    const snapshot = buildClearanceSnapshot(readyState(), "trl-1");
    expect(snapshot.status).toBe("ready");
    expect(snapshot.blockers).toEqual([]);
    expect(snapshot.trialId).toBe("trl-1");
    expect(snapshot.id).toBeTruthy();
    expect(snapshot.generatedOn).toBeTruthy();
  });

  it("canClearTrial 对就绪快照返回 ready", () => {
    const result = canClearTrial(readyState(), "trl-1");
    expect(result.ready).toBe(true);
    expect(result.snapshot.status).toBe("ready");
  });
});

describe("放行快照 - 阻止项：材料组合", () => {
  it("没有材料的试验被 NO_ACCESSIONS 阻止", () => {
    const state = readyState({ accessions: [], benches: [] });
    const snapshot = buildClearanceSnapshot(state, "trl-1");
    expect(snapshot.status).toBe("blocked");
    expect(blockerCodes(snapshot)).toContain("NO_ACCESSIONS");
    expect(metric(snapshot, "材料数")).toBe(0);
  });

  it("未分配材料产生 UNASSIGNED 阻止项并带上材料 id", () => {
    const assigned = makeAccession({ id: 1, trialId: "trl-1", accessionNo: "ACC-0001" });
    const unassigned = makeAccession({ id: 2, trialId: "trl-1", accessionNo: "ACC-0002" });
    const state = readyState({
      accessions: [assigned, unassigned],
      benches: [makeBench({ id: 1, status: "assigned", assignedIds: [assigned.id] })],
    });
    const snapshot = buildClearanceSnapshot(state, "trl-1");
    expect(blockerCodes(snapshot)).toContain("UNASSIGNED");
    const blocker = snapshot.blockers.find((item) => item.code === "UNASSIGNED");
    expect(blocker?.accessionId).toBe(unassigned.id);
    expect(metric(snapshot, "已分配")).toBe(1);
  });

  it("仅统计当前试验的材料，其他试验的材料不影响结果", () => {
    const otherAccession = makeAccession({
      id: 9,
      trialId: "trl-9",
      accessionNo: "ACC-0009",
    });
    const state = readyState();
    state.accessions.push(otherAccession);
    state.trials.push(makeTrial({ id: 9, code: "OTH-09" }));
    const snapshot = buildClearanceSnapshot(state, "trl-1");
    expect(metric(snapshot, "材料数")).toBe(1);
    expect(snapshot.status).toBe("ready");
  });
});

describe("放行快照 - 阻止项：台架组合", () => {
  it("停用台架产生 BENCH_BLOCKED 阻止项并带台架 id，即使台上没有材料", () => {
    const state = readyState({
      benches: [
        makeBench({ id: 1, status: "assigned", assignedIds: ["acc-1"] }),
        makeBench({ id: 2, status: "blocked", blockedReason: "维修" }),
      ],
    });
    const snapshot = buildClearanceSnapshot(state, "trl-1");
    expect(blockerCodes(snapshot)).toContain("BENCH_BLOCKED");
    const blocker = snapshot.blockers.find((item) => item.code === "BENCH_BLOCKED");
    expect(blocker?.benchId).toBe("bench-2");
  });

  it("隔离台架产生 BENCH_QUARANTINE 阻止项", () => {
    const state = readyState({
      benches: [
        makeBench({ id: 1, status: "assigned", assignedIds: ["acc-1"] }),
        makeBench({ id: 2, status: "quarantine" }),
      ],
    });
    const snapshot = buildClearanceSnapshot(state, "trl-1");
    expect(blockerCodes(snapshot)).toContain("BENCH_QUARANTINE");
  });

  it("可用和已分配的正常台架不产生台架阻止项", () => {
    const state = readyState({
      benches: [
        makeBench({ id: 1, status: "assigned", assignedIds: ["acc-1"] }),
        makeBench({ id: 2, status: "available" }),
      ],
    });
    const snapshot = buildClearanceSnapshot(state, "trl-1");
    expect(blockerCodes(snapshot)).not.toContain("BENCH_BLOCKED");
    expect(blockerCodes(snapshot)).not.toContain("BENCH_QUARANTINE");
  });
});

describe("放行快照 - 阻止项：标记组合", () => {
  it("未处理标记产生 FLAG_<code> 阻止项", () => {
    const state = readyState({ flags: [makeFlag()] });
    const snapshot = buildClearanceSnapshot(state, "trl-1");
    expect(blockerCodes(snapshot)).toContain("FLAG_HT_UNDER");
    expect(metric(snapshot, "未处理标记")).toBe(1);
  });

  it("已解决或已豁免的标记不产生阻止项", () => {
    const state = readyState({
      flags: [
        makeFlag({ id: "flg-1", state: "resolved" }),
        makeFlag({ id: "flg-2", code: "EC_HIGH", state: "waived" }),
      ],
    });
    const snapshot = buildClearanceSnapshot(state, "trl-1");
    expect(snapshot.status).toBe("ready");
    expect(metric(snapshot, "未处理标记")).toBe(0);
  });

  it("其他试验的未处理标记不计入当前试验", () => {
    const state = readyState({
      flags: [makeFlag({ id: "flg-9", trialId: "trl-9" })],
    });
    const snapshot = buildClearanceSnapshot(state, "trl-1");
    expect(metric(snapshot, "未处理标记")).toBe(0);
    expect(snapshot.status).toBe("ready");
  });

  it("多个未处理标记各自产生阻止项", () => {
    const state = readyState({
      flags: [
        makeFlag({ id: "flg-1", code: "HT_UNDER" }),
        makeFlag({ id: "flg-2", code: "LEAF_LOW" }),
        makeFlag({ id: "flg-3", code: "EC_HIGH", severity: "critical" }),
      ],
    });
    const snapshot = buildClearanceSnapshot(state, "trl-1");
    expect(blockerCodes(snapshot)).toEqual(
      expect.arrayContaining(["FLAG_HT_UNDER", "FLAG_LEAF_LOW", "FLAG_EC_HIGH"]),
    );
    expect(blockerCount(snapshot)).toBe(3);
  });
});

describe("放行快照 - 阻止项：试验状态", () => {
  it("草稿状态试验被 TRIAL_DRAFT 阻止", () => {
    const state = readyState({ trialState: "draft" });
    const snapshot = buildClearanceSnapshot(state, "trl-1");
    expect(blockerCodes(snapshot)).toContain("TRIAL_DRAFT");
    expect(snapshot.status).toBe("blocked");
  });

  it("活动试验没有草稿阻止项", () => {
    const snapshot = buildClearanceSnapshot(readyState({ trialState: "active" }), "trl-1");
    expect(blockerCodes(snapshot)).not.toContain("TRIAL_DRAFT");
  });
});

describe("放行快照 - 指标与组合", () => {
  it("指标反映材料、分配、标记和在用台架数量", () => {
    const accessions = [
      makeAccession({ id: 1, trialId: "trl-1" }),
      makeAccession({ id: 2, trialId: "trl-1" }),
      makeAccession({ id: 3, trialId: "trl-1" }),
    ];
    const state = makeState({
      trials: [makeTrial({ id: 1, state: "active" })],
      accessions,
      benches: [
        makeBench({ id: 1, status: "assigned", assignedIds: [accessions[0]!.id, accessions[1]!.id] }),
        makeBench({ id: 2, status: "available" }),
      ],
      flags: [
        makeFlag({ id: "flg-1", accessionId: "acc-1" }),
        makeFlag({ id: "flg-2", accessionId: "acc-2", state: "resolved" }),
      ],
    });
    const snapshot = buildClearanceSnapshot(state, "trl-1");
    expect(metric(snapshot, "材料数")).toBe(3);
    expect(metric(snapshot, "已分配")).toBe(2);
    expect(metric(snapshot, "未处理标记")).toBe(1);
    expect(metric(snapshot, "在用台架")).toBe(1);
    expect(blockerCodes(snapshot).sort()).toEqual(["FLAG_HT_UNDER", "UNASSIGNED"]);
  });

  it("所有阻止项类型可以同时出现", () => {
    const state = makeState({
      trials: [makeTrial({ id: 1, state: "draft" })],
      accessions: [],
      benches: [
        makeBench({ id: 1, status: "blocked", blockedReason: "维修" }),
        makeBench({ id: 2, status: "quarantine" }),
      ],
      flags: [],
    });
    const snapshot = buildClearanceSnapshot(state, "trl-1");
    expect(blockerCodes(snapshot).sort()).toEqual(
      ["BENCH_BLOCKED", "BENCH_QUARANTINE", "NO_ACCESSIONS", "TRIAL_DRAFT"].sort(),
    );
  });

  it("快照是不可变的：生成后修改工作区不改变快照内容", () => {
    const state = readyState();
    const snapshot = buildClearanceSnapshot(state, "trl-1");
    state.accessions[0]!.cultivar = "Mutated";
    state.benches[0]!.status = "blocked";
    expect(snapshot.status).toBe("ready");
    expect(snapshot.blockers).toEqual([]);
  });
});

describe("放行应用", () => {
  it("就绪快照应用后试验进入已放行状态", () => {
    const state = readyState({ trialState: "active" });
    const snapshot = buildClearanceSnapshot(state, "trl-1");
    const trials = applyClearance(state, snapshot);
    expect(trials.find((trial) => trial.id === "trl-1")?.state).toBe("cleared");
  });

  it("被阻止的快照不会改变任何试验状态", () => {
    const state = readyState({ trialState: "draft" });
    const snapshot = buildClearanceSnapshot(state, "trl-1");
    const trials = applyClearance(state, snapshot);
    expect(trials.find((trial) => trial.id === "trl-1")?.state).toBe("draft");
    expect(trials).toBe(state.trials);
  });

  it("暂停试验即使快照就绪，也不能通过放行绕过转换表进入已放行状态", () => {
    const state = readyState({ trialState: "paused" });
    const snapshot = buildClearanceSnapshot(state, "trl-1");
    expect(snapshot.status).toBe("ready");
    const trials = applyClearance(state, snapshot);
    expect(trials.find((trial) => trial.id === "trl-1")?.state).toBe("paused");
  });
});

describe("快照检索", () => {
  it("snapshotForTrial 返回指定试验最近生成的快照", () => {
    const older = { ...buildClearanceSnapshot(readyState(), "trl-1"), generatedOn: "2026-03-01T00:00:00.000Z" };
    const newer = { ...buildClearanceSnapshot(readyState(), "trl-1"), generatedOn: "2026-03-02T00:00:00.000Z" };
    const result = snapshotForTrial([older, newer], "trl-1");
    expect(result).toBe(newer);
  });
});
