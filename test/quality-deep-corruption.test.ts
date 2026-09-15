import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { scanWorkspace, parseCollections } from "../src/domain/quality";
import type { WorkspaceState } from "../src/domain/types";
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

function rules(report: ReturnType<typeof scanWorkspace>): string[] {
  return report.findings.map((finding) => finding.ruleCode);
}

describe("深层损坏防护 — 数组中的空值", () => {
  it("各集合中的 null 被报告为结构损坏，且不拖垮扫描", () => {
    const state = makeHealthyWorkspace() as unknown as WorkspaceState;
    state.trials.push(null as never);
    state.accessions.push(null as never);
    state.benches.push(null as never);
    state.observationPasses.push(null as never);
    state.flags.push(null as never);
    state.clearanceSnapshots.push(null as never);

    const report = scanWorkspace(state);
    assert.ok(rules(report).includes("T-STRUCT-01"));
    assert.ok(rules(report).includes("A-STRUCT-01"));
    assert.ok(rules(report).includes("B-STRUCT-01"));
    assert.ok(rules(report).includes("O-STRUCT-01"));
    assert.ok(rules(report).includes("F-STRUCT-01"));
    assert.ok(rules(report).includes("C-STRUCT-01"));
    // 好对象的跨对象检查仍正常（健康部分没有误报）
    assert.ok(report.counts.blocking >= 6);
  });

  it("观测条目数组中的 null 生成条目级问题，父观测保留", () => {
    const state = makeState({
      observationPasses: [
        makePass({
          entries: [
            null,
            { accessionId: "acc-1", heightMm: 100, leafCount: 8, ecMs: 1.8, notes: "" },
          ] as never,
        }),
      ],
    });
    const report = scanWorkspace(state);
    assert.ok(rules(report).includes("O-STRUCT-04"));
    // 合法条目仍参与跨对象检查
    assert.ok(!rules(report).includes("O-ENTRY-ACC-MISSING-01"));
  });

  it("快照 metrics/blockers 中的 null 不拖垮启动检查", () => {
    const state = makeState({
      clearanceSnapshots: [
        makeSnapshot({
          metrics: [null, { label: "材料数", value: 1, detail: "x" }] as never,
          blockers: [null, { code: "X", message: "y" }] as never,
        }),
      ],
    });
    const report = scanWorkspace(state);
    assert.ok(rules(report).includes("C-STRUCT-05"));
    // 快照外壳仍参与试验引用检查（这里 trial-1 存在，不报 missing）
    const snapshotFindings = report.findings.filter((f) => f.domain === "clearance");
    assert.ok(snapshotFindings.length >= 2);
  });
});

describe("深层损坏防护 — 缺字段与错误类型", () => {
  it("对象缺必填字段时每个字段生成带证据的独立稳定问题", () => {
    const state = makeState({
      benches: [
        {
          id: "bad-bench",
          code: "B-BAD",
          // 缺 status / lightProfile / capacity / sector / irrigationLine
          assignedIds: ["acc-1"],
        } as never,
      ],
    });
    const report = scanWorkspace(state);
    const benchIssues = report.findings.filter((f) => f.ruleCode === "B-STRUCT-02");
    const fields = benchIssues.map((f) =>
      f.evidence.find((e) => e.label === "字段")?.value,
    );
    assert.ok(fields.includes("status"));
    assert.ok(fields.includes("lightProfile"));
    assert.ok(fields.includes("sector"));
    assert.ok(fields.includes("irrigationLine"));
  });

  it("同一对象多个字段问题的 id 互不相同且跨扫描稳定", () => {
    const state = makeState({
      trials: [
        {
          id: "t-bad",
          code: "BAD-01",
          state: "not-a-state",
          startDate: "not-a-date",
          endDate: "2026-05-01",
        } as never,
      ],
    });
    const first = scanWorkspace(state);
    const second = scanWorkspace(state);
    const ids = first.findings
      .filter((f) => f.ruleCode === "T-STRUCT-02")
      .map((f) => f.id);
    assert.ok(new Set(ids).size === ids.length, "同对象的不同字段问题必须有不同 id");
    assert.deepEqual(
      second.findings.map((f) => f.id).sort(),
      first.findings.map((f) => f.id).sort(),
    );
  });

  it("枚举字段错误（光照/状态/严重程度）被识别", () => {
    const state = makeState({
      accessions: [makeAccession({ preferredLight: "moonlight" as never })],
      flags: [makeFlag({ severity: "apocalyptic" as never, state: "halfway" as never })],
    });
    const report = scanWorkspace(state);
    const codes = rules(report);
    assert.ok(codes.includes("A-STRUCT-02"));
    assert.ok(codes.includes("F-STRUCT-02"));
  });

  it("数值越界（数量/容量/测量值）与日期错误生成可追溯证据", () => {
    const state = makeState({
      accessions: [makeAccession({ quantity: 9999 })],
      benches: [makeBench({ capacity: -3 })],
      observationPasses: [
        makePass({
          entries: [
            { accessionId: "acc-1", heightMm: 99999, leafCount: 8, ecMs: 1.8, notes: "" },
          ],
        }),
      ],
    });
    const report = scanWorkspace(state);
    const codes = rules(report);
    assert.ok(codes.includes("A-FIELD-02"));
    assert.ok(codes.includes("B-FIELD-02"));
    assert.ok(codes.includes("O-STRUCT-05"));
    const heightIssue = report.findings.find((f) =>
      f.evidence.some((e) => e.label === "位置" && e.value.includes("heightMm")),
    );
    assert.ok(heightIssue, "必须携带字段位置证据");
    assert.equal(heightIssue.fix, undefined, "深层字段问题不提供自动修复");
  });

  it("assignedIds 类型错误（含非字符串）被识别", () => {
    const state = makeState({
      benches: [makeBench({ assignedIds: ["acc-1", 42 as never, null as never] })],
    });
    const report = scanWorkspace(state);
    assert.ok(rules(report).includes("B-STRUCT-02"));
  });

  it("顶层集合为 null 或缺失时不崩溃，报告 COLLECTION-01", () => {
    const broken = { trials: [], accessions: [], benches: null } as unknown as WorkspaceState;
    const report = scanWorkspace(broken);
    assert.ok(rules(report).includes("COLLECTION-01"));
    const nullReport = scanWorkspace(null);
    assert.ok(rules(nullReport).includes("COLLECTION-01"));
  });
});

describe("深层损坏防护 — 未知字段（旧/新版本）", () => {
  it("对象中出现未知字段时给出 info 提示且不删除", () => {
    const state = makeState({
      trials: [
        { ...makeTrial(), experimentalField: "future-value" } as never,
      ],
    });
    const report = scanWorkspace(state);
    const unknown = report.findings.find((f) => f.ruleCode === "T-STRUCT-03");
    assert.ok(unknown);
    assert.equal(unknown.severity, "info");
    assert.ok(
      unknown.evidence.some((e) => e.value.includes("experimentalField")),
    );
  });
});

describe("深层损坏防护 — 坏快照不影响其他流程", () => {
  it("单个损坏快照不会让整批扫描抛出，其他领域问题照常报告", () => {
    const state = makeState({
      benches: [makeBench({ assignedIds: ["ghost-id"], status: "assigned" })],
      clearanceSnapshots: [
        null,
        makeSnapshot({ blockers: [{ code: "ok", message: "fine" }] }),
      ] as never,
    });
    const report = scanWorkspace(state);
    assert.ok(rules(report).includes("C-STRUCT-01"));
    assert.ok(rules(report).includes("B-ASSIGN-MISSING-01"));
    // 好快照仍参与阻止项悬空检查（没有缺失引用，无相关 info）
  });

  it("parseCollections 保留合法快照外壳，只剔除坏嵌套条目", () => {
    const parsed = parseCollections({
      ...makeState(),
      clearanceSnapshots: [
        makeSnapshot({
          metrics: [
            { label: "x", value: 1, detail: "ok" },
            { label: "bad" } as never,
          ],
        }),
      ],
    });
    assert.equal(parsed.snapshots.length, 1);
    assert.equal(parsed.snapshots[0].metrics.length, 1);
    assert.ok(parsed.findings.some((f) => f.ruleCode === "C-STRUCT-05"));
  });
});

describe("健康工作区仍然零误报", () => {
  it("扩展字段校验后，健康夹具与示例工作区不产生结构问题", async () => {
    const report = scanWorkspace(makeHealthyWorkspace());
    assert.deepEqual(report.findings, []);
    const { createSampleWorkspaceState } = await import("../src/state/sampleData");
    assert.equal(scanWorkspace(createSampleWorkspaceState()).healthy, true);
  });
});
