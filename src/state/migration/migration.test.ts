import { test } from "node:test";
import assert from "node:assert/strict";
import { migrateWorkspace } from "./runner";
import { CURRENT_SCHEMA_VERSION } from "./types";
import { scanIntegrity, reconcileIssues } from "./integrity";
import {
  resolveDanglingByRelink,
  resolveDanglingByClear,
  keepDanglingAsIs,
  resolveUnknownEnum,
} from "./resolution";
import type {
  DanglingReferenceIssue,
  MigrationIssue,
  UnknownEnumValueIssue,
} from "./types";
import type { WorkspaceState } from "../../domain/types";

const NOW = "2026-09-15T00:00:00.000Z";

function v1Envelope(state: unknown): string {
  // 旧应用写出的信封形状
  return JSON.stringify({ version: 1, savedAt: NOW, state });
}

function minimalState(overrides: Partial<WorkspaceState> = {}): WorkspaceState {
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

test("v1 数据无损升级到当前版本：补 lifecycleStatus 与 retirementHistory，其余字段保留", () => {
  const oldState = minimalState({
    accessions: [
      {
        id: "acc-1",
        trialId: "t1",
        accessionNo: "ACC-0001",
        cultivar: "Tiny Tim",
        source: "Lab",
        propagatedOn: "2026-02-18",
        quantity: 96,
        trayCells: 104,
        preferredLight: "full-sun",
        genotypeNote: "note note note",
        labels: [],
        // 旧字段：retiredAt 存在，但没有 lifecycleStatus / retirementHistory
        retiredAt: "2026-05-01T00:00:00.000Z",
      } as any,
      {
        id: "acc-2",
        trialId: "t1",
        accessionNo: "ACC-0002",
        cultivar: "Micro Tom",
        source: "Lab",
        propagatedOn: "2026-02-18",
        quantity: 96,
        trayCells: 104,
        preferredLight: "full-sun",
        genotypeNote: "note note note",
        labels: [],
        experimentalNewField: { keep: true },
      } as any,
    ],
    trials: [{ id: "t1" } as any],
  });

  const result = migrateWorkspace(v1Envelope(oldState), NOW);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected ok");
  assert.equal(result.schemaVersion, CURRENT_SCHEMA_VERSION);

  const acc1 = result.state.accessions.find((a: any) => a.id === "acc-1")!;
  assert.equal(acc1.lifecycleStatus, "retired");
  assert.deepEqual(acc1.retirementHistory, []);
  assert.equal(acc1.retiredAt, "2026-05-01T00:00:00.000Z");

  const acc2 = result.state.accessions.find((a: any) => a.id === "acc-2")!;
  assert.equal(acc2.lifecycleStatus, "active");
  // 未知字段原样透传，不丢失
  assert.deepEqual((acc2 as any).experimentalNewField, { keep: true });
});

test("缺失新关联（悬空引用）不删除记录，登记为 critical 待处理项并保留原值", () => {
  const state = minimalState({
    trials: [{ id: "t1" } as any],
    accessions: [{ id: "acc-1", trialId: "t1" } as any],
    flags: [
      {
        id: "flag-1",
        trialId: "t1",
        accessionId: "acc-gone", // 材料已不存在
        observationPassId: "pass-gone",
        code: "X",
        severity: "warning",
        state: "open",
      } as any,
    ],
  });
  const result = migrateWorkspace(v1Envelope(state), NOW);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected ok");

  // 记录仍在
  assert.equal(result.state.flags.length, 1);
  const dangling = result.issues.filter((i) => i.code.startsWith("dangling_"));
  assert.ok(dangling.length >= 2, "应同时报告 accession 和 pass 的悬空引用");
  const accIssue = result.issues.find(
    (i) => i.code === "dangling_accession_reference",
  ) as DanglingReferenceIssue;
  assert.equal(accIssue.missingRef, "acc-gone");
  assert.equal(accIssue.ownerId, "flag-1");
  assert.equal(accIssue.clearable, false); // 不可空，不能清空
});

test("台架 assignedIds 悬空可重新关联或清空，且不误伤正常槽位", () => {
  const state = minimalState({
    accessions: [
      { id: "acc-ok", trialId: "t1" } as any,
      { id: "acc-new", trialId: "t1" } as any,
    ],
    benches: [
      { id: "b1", assignedIds: ["acc-ok", "acc-gone"] } as any,
    ],
  });
  let result = migrateWorkspace(v1Envelope(state), NOW);
  if (!result.ok) throw new Error("expected ok");
  const issue = result.issues.find(
    (i) => i.ownerCollection === "benches" && i.field === "assignedIds",
  ) as DanglingReferenceIssue;
  assert.ok(issue);
  assert.equal(issue.clearable, true);

  // 重新关联后复检不再有该悬空问题
  const relinked = resolveDanglingByRelink(result.state, result.issues, issue, "acc-new");
  assert.deepEqual(
    (relinked.state.benches[0] as any).assignedIds,
    ["acc-ok", "acc-new"],
  );
  assert.equal(relinked.issues.find((i) => i.id === issue.id), undefined);

  // 清空：只移除悬空项
  const cleared = resolveDanglingByClear(result.state, result.issues, issue);
  assert.deepEqual((cleared.state.benches[0] as any).assignedIds, ["acc-ok"]);
});

test("保留悬空（keep）不改动事实，仅把问题标记为 ignored", () => {
  const state = minimalState({
    trials: [{ id: "t1" } as any],
    flags: [
      { id: "f1", trialId: "t1", accessionId: "ghost", observationPassId: "p" } as any,
    ],
  });
  const result = migrateWorkspace(v1Envelope(state), NOW);
  if (!result.ok) throw new Error("expected ok");
  const issue = result.issues.find((i) => i.field === "accessionId")!;
  const kept = keepDanglingAsIs(result.state, result.issues, issue as DanglingReferenceIssue, "人工确认保留");
  assert.equal(kept.state.flags[0].accessionId, "ghost");
  assert.equal(kept.issues[0].status, "ignored");
});

test("未知枚举值保留记录并登记，可人工修正后复检通过", () => {
  const state = minimalState({
    trials: [{ id: "t1", state: "weird-state" } as any],
  });
  const result = migrateWorkspace(v1Envelope(state), NOW);
  if (!result.ok) throw new Error("expected ok");
  const issue = result.issues.find(
    (i) => i.code === "unknown_enum_value",
  ) as UnknownEnumValueIssue;
  assert.ok(issue);
  assert.equal(issue.unknownValue, "weird-state");
  assert.ok(issue.supportedValues.includes("active"));

  const fixed = resolveUnknownEnum(result.state, result.issues, issue, "active");
  assert.equal((fixed.state.trials[0] as any).state, "active");
  // 修正后复检不再发现该问题
  assert.equal(fixed.issues.find((i) => i.id === issue.id), undefined);

  // 不允许改成另一个非法值
  const rejected = resolveUnknownEnum(result.state, result.issues, issue, "nope");
  assert.equal((rejected.state.trials[0] as any).state, "weird-state");
});

test("损坏 JSON 判失败而非回退示例数据", () => {
  const result = migrateWorkspace("{ not json", NOW);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected failure");
  assert.equal(result.code, "invalid_json");
  assert.equal(result.raw, "{ not json"); // 原始内容可导出
});

test("集合不是数组判结构损坏", () => {
  const result = migrateWorkspace(v1Envelope({ trials: "nope" }), NOW);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected failure");
  assert.equal(result.code, "corrupt_collections");
});

test("记录缺少 id 判结构损坏", () => {
  const result = migrateWorkspace(
    v1Envelope({ trials: [{ code: "X" }] }),
    NOW,
  );
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected failure");
  assert.equal(result.code, "corrupt_collections");
});

test("来自更高版本的数据拒绝升级（旧程序不得改写新数据）", () => {
  const raw = JSON.stringify({
    schemaVersion: CURRENT_SCHEMA_VERSION + 1,
    state: minimalState(),
  });
  const result = migrateWorkspace(raw, NOW);
  assert.equal(result.ok, false);
  if (result.ok) throw new Error("expected failure");
  assert.equal(result.code, "unsupported_future_version");
});

test("当前版本数据往返：无问题时 issues 为空", () => {
  const state = minimalState({
    trials: [{ id: "t1", state: "draft" } as any],
    accessions: [{ id: "a1", trialId: "t1", labels: [], retirementHistory: [] } as any],
  });
  const raw = JSON.stringify({ schemaVersion: CURRENT_SCHEMA_VERSION, state });
  const result = migrateWorkspace(raw, NOW);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected ok");
  assert.deepEqual(result.issues, []);
  assert.deepEqual(result.history, []);
});

test("reconcileIssues 保留用户处理状态；问题消失后不再出现", () => {
  const state = minimalState();
  const scanned = scanIntegrity(state as WorkspaceState, NOW);
  assert.deepEqual(scanned, []);

  const previous: MigrationIssue[] = [
    {
      id: "x",
      code: "unknown_field",
      message: "m",
      severity: "warning",
      status: "ignored",
      detectedAt: NOW,
      resolutionNote: "kept",
      ownerCollection: "trials",
      ownerId: "t1",
      ownerLabel: "trials:t1",
      field: "f",
    },
  ];
  // 已不存在的问题在重新扫描后被移除（不保留僵尸问题）
  assert.deepEqual(reconcileIssues(previous, []), []);
});
