import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scanWorkspace } from "../src/domain/quality";
import type { Bench } from "../src/domain/types";
import {
  makeAccession,
  makeBench,
  makeFlag,
  makeHealthyWorkspace,
  makePass,
  makeSnapshot,
  makeState,
  makeTrial,
} from "./fixtures";

function codes(report: ReturnType<typeof scanWorkspace>): string[] {
  return report.findings.map((finding) => finding.ruleCode);
}

describe("scanWorkspace — 健康工作区", () => {
  it("对结构完整、引用一致的工作区不报告任何问题", () => {
    const report = scanWorkspace(makeHealthyWorkspace());
    assert.equal(report.healthy, true);
    assert.equal(report.findings.length, 0);
    assert.deepEqual(report.counts, { blocking: 0, warning: 0, info: 0 });
  });

  it("示例工作区（首次启动）必须是健康的", async () => {
    const { createSampleWorkspaceState } = await import(
      "../src/state/sampleData"
    );
    const report = scanWorkspace(createSampleWorkspaceState());
    assert.deepEqual(
      report.findings.map((finding) => `${finding.ruleCode}: ${finding.title}`),
      [],
    );
  });
});

describe("scanWorkspace — 试验领域", () => {
  it("材料引用已消失的试验时报告阻断", () => {
    const state = makeState({
      trials: [],
      accessions: [makeAccession({ trialId: "ghost-trial" })],
    });
    const report = scanWorkspace(state);
    assert.equal(report.counts.blocking >= 1, true);
    assert.ok(codes(report).includes("A-TRIAL-MISSING-01"));
    const finding = report.findings.find((item) => item.ruleCode === "A-TRIAL-MISSING-01");
    assert.ok(finding);
    assert.equal(finding.fix, undefined, "缺失试验不能自动指派，必须人工处理");
    assert.ok(finding.manual);
    assert.ok(
      finding.evidence.some((item) => item.value === "ghost-trial"),
      "证据必须包含缺失的试验 id",
    );
  });

  it("已放行试验仍有未处理标记时给出警告", () => {
    const state = makeState({
      trials: [makeTrial({ state: "cleared" })],
      flags: [makeFlag({ state: "open" })],
    });
    const report = scanWorkspace(state);
    assert.ok(codes(report).includes("T-CLEARED-FLAGS-01"));
    assert.equal(
      report.findings.find((item) => item.ruleCode === "T-CLEARED-FLAGS-01")
        ?.severity,
      "warning",
    );
  });

  it("试验编号重复被识别", () => {
    const state = makeState({
      trials: [
        makeTrial({ id: "t1", code: "DUP-01" }),
        makeTrial({ id: "t2", code: "DUP-01" }),
      ],
    });
    const report = scanWorkspace(state);
    assert.ok(codes(report).includes("T-DUP-CODE-01"));
  });
});

describe("scanWorkspace — 台架领域", () => {
  it("台架引用已消失材料（悬空 id）时报告阻断并提供安全修复", () => {
    const state = makeState({
      benches: [makeBench({ assignedIds: ["acc-ghost"] })],
    });
    const report = scanWorkspace(state);
    const finding = report.findings.find(
      (item) => item.ruleCode === "B-ASSIGN-MISSING-01",
    );
    assert.ok(finding);
    assert.equal(finding.severity, "blocking");
    assert.equal(finding.fix?.kind, "bench.unassign");
    assert.deepEqual(finding.fix.context, {
      benchId: "bench-1",
      accessionId: "acc-ghost",
      reason: "missing-accession",
    });
  });

  it("同一材料跨多个台架时报告阻断，并确定性地给出保留台架", () => {
    const acc = makeAccession({ id: "acc-1", preferredLight: "full-sun" });
    const state = makeState({
      accessions: [acc],
      benches: [
        makeBench({
          id: "b1",
          code: "B-1",
          lightProfile: "full-sun",
          assignedIds: ["acc-1"],
          status: "assigned",
        }),
        makeBench({
          id: "b2",
          code: "B-2",
          lightProfile: "full-sun",
          assignedIds: ["acc-1"],
          status: "assigned",
        }),
      ],
    });
    const report = scanWorkspace(state);
    const finding = report.findings.find(
      (item) => item.ruleCode === "A-BENCH-MULTI-01",
    );
    assert.ok(finding);
    assert.equal(finding.fix?.kind, "accession.detangle-benches");
    assert.equal(finding.fix.context.keepBenchId, "b1");
    assert.deepEqual(finding.fix.context.removeBenchIds, ["b2"]);
  });

  it("容量矛盾为阻断且不提供自动修复（该移出谁无法自动判断）", () => {
    const state = makeState({
      accessions: [
        makeAccession({ id: "a1" }),
        makeAccession({ id: "a2", accessionNo: "ACC-0002" }),
      ],
      benches: [
        makeBench({
          capacity: 1,
          assignedIds: ["a1", "a2"],
          status: "assigned",
        }),
      ],
    });
    const report = scanWorkspace(state);
    const finding = report.findings.find((item) => item.ruleCode === "B-CAPACITY-01");
    assert.ok(finding);
    assert.equal(finding.severity, "blocking");
    assert.equal(finding.fix, undefined);
    assert.ok(finding.manual);
  });

  it("停用台架仍占用材料时提供移出全部链接的修复", () => {
    const state = makeState({
      benches: [
        makeBench({
          status: "blocked",
          blockedReason: "维修",
          assignedIds: ["acc-1"],
        }),
      ],
    });
    const report = scanWorkspace(state);
    const finding = report.findings.find(
      (item) => item.ruleCode === "B-RESTRICTED-OCCUPIED-01",
    );
    assert.ok(finding);
    assert.equal(finding.fix?.kind, "bench.release-all");
  });

  it("台架内重复 id 与状态派生矛盾分别报告", () => {
    const state = makeState({
      benches: [
        makeBench({ assignedIds: ["acc-1", "acc-1"], status: "available" }),
      ],
    });
    const report = scanWorkspace(state);
    assert.ok(codes(report).includes("B-ASSIGN-DUP-01"));
    assert.ok(codes(report).includes("B-STATUS-DERIVED-01"));
  });
});

describe("scanWorkspace — 观测与标记领域", () => {
  it("观测引用已消失的材料时为阻断，且只提供人工入口（历史测量不能丢弃）", () => {
    const state = makeState({
      observationPasses: [
        makePass({
          entries: [
            {
              accessionId: "acc-ghost",
              heightMm: 100,
              leafCount: 8,
              ecMs: 1.8,
              notes: "",
            },
          ],
        }),
      ],
    });
    const report = scanWorkspace(state);
    const finding = report.findings.find(
      (item) => item.ruleCode === "O-ENTRY-ACC-MISSING-01",
    );
    assert.ok(finding);
    assert.equal(finding.severity, "blocking");
    assert.equal(finding.fix, undefined);
    assert.equal(finding.manual?.path, "/observations");
  });

  it("标记指向错误试验但材料与观测一致时可自动校正", () => {
    const state = makeState({
      trials: [makeTrial({ id: "trial-1" }), makeTrial({ id: "trial-2", code: "TST-02" })],
      accessions: [makeAccession({ id: "acc-1", trialId: "trial-2" })],
      observationPasses: [makePass({ trialId: "trial-2" })],
      flags: [
        makeFlag({ trialId: "trial-1", accessionId: "acc-1", observationPassId: "pass-1" }),
      ],
    });
    const report = scanWorkspace(state);
    const finding = report.findings.find(
      (item) => item.ruleCode === "F-TRIAL-MISMATCH-01",
    );
    assert.ok(finding);
    assert.equal(finding.fix?.kind, "flag.correct-trial");
    assert.equal(finding.fix.context.targetTrialId, "trial-2");
  });

  it("标记引用不存在的观测时为阻断且不自动修复", () => {
    const state = makeState({
      flags: [makeFlag({ observationPassId: "pass-ghost" })],
    });
    const report = scanWorkspace(state);
    assert.ok(codes(report).includes("F-PASS-MISSING-01"));
    assert.equal(
      report.findings.find((item) => item.ruleCode === "F-PASS-MISSING-01")?.fix,
      undefined,
    );
  });
});

describe("scanWorkspace — 快照领域", () => {
  it("快照引用消失的试验时只报告不修复（快照不可变）", () => {
    const state = makeState({
      clearanceSnapshots: [makeSnapshot({ trialId: "trial-gone" })],
    });
    const report = scanWorkspace(state);
    const finding = report.findings.find(
      (item) => item.ruleCode === "C-TRIAL-MISSING-01",
    );
    assert.ok(finding);
    assert.equal(finding.fix, undefined);
    assert.equal(finding.severity, "warning");
  });

  it("快照阻止项引用已消失对象时给出追溯提示", () => {
    const state = makeState({
      clearanceSnapshots: [
        makeSnapshot({
          blockers: [{ code: "X", message: "x", benchId: "bench-gone" }],
        }),
      ],
    });
    const report = scanWorkspace(state);
    assert.ok(codes(report).includes("C-BLOCKER-BENCH-01"));
  });
});

describe("scanWorkspace — 畸形数据不崩溃", () => {
  it("数组中混入 null 与缺字段对象时报告结构问题并继续扫描", () => {
    const state = makeState({
      benches: [
        null as unknown as Bench,
        makeBench({ id: "ok-bench", code: "B-OK" }),
        { id: "bad-bench", code: "B-BAD" } as unknown as Bench,
      ],
    });
    const report = scanWorkspace(state);
    assert.ok(codes(report).includes("B-STRUCT-01"));
    // 好台架仍然参与跨对象校验（没有被畸形记录拖垮整个扫描）。
    assert.ok(
      report.findings.every((finding) => finding.objectRefs.length > 0),
      "每条问题都必须携带对象引用",
    );
  });

  it("稳定 id：相同问题两次扫描得到相同 finding id", () => {
    const state = makeState({
      benches: [makeBench({ assignedIds: ["acc-ghost"] })],
    });
    const first = scanWorkspace(state);
    const second = scanWorkspace(state);
    assert.deepEqual(
      first.findings.map((item) => item.id).sort(),
      second.findings.map((item) => item.id).sort(),
    );
  });
});
