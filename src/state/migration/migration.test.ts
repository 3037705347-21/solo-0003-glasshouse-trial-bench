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
      { id: "acc-ok", trialId: "t1", lifecycleStatus: "active", preferredLight: "full-sun" } as any,
      { id: "acc-new", trialId: "t1", lifecycleStatus: "active", preferredLight: "full-sun" } as any,
    ],
    benches: [
      { id: "b1", code: "B1", capacity: 4, status: "available", lightProfile: "full-sun", assignedIds: ["acc-ok", "acc-gone"] } as any,
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
  assert.equal(relinked.ok, true);
  if (!relinked.ok) throw new Error("expected ok");
  assert.deepEqual(
    (relinked.value.state.benches[0] as any).assignedIds,
    ["acc-ok", "acc-new"],
  );
  assert.equal(relinked.value.issues.find((i: any) => i.id === issue.id), undefined);

  // 清空：只移除悬空项
  const cleared = resolveDanglingByClear(result.state, result.issues, issue);
  assert.equal(cleared.ok, true);
  if (!cleared.ok) throw new Error("expected ok");
  assert.deepEqual((cleared.value.state.benches[0] as any).assignedIds, ["acc-ok"]);
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
  assert.equal(kept.ok, true);
  if (!kept.ok) throw new Error("expected ok");
  assert.equal(kept.value.state.flags[0].accessionId, "ghost");
  assert.equal(kept.value.issues[0].status, "ignored");
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
  assert.equal(fixed.ok, true);
  if (!fixed.ok) throw new Error("expected ok");
  assert.equal((fixed.value.state.trials[0] as any).state, "active");
  // 修正后复检不再发现该问题
  assert.equal(fixed.value.issues.find((i: any) => i.id === issue.id), undefined);

  // 不允许改成另一个非法值
  const rejected = resolveUnknownEnum(result.state, result.issues, issue, "nope");
  assert.equal(rejected.ok, false);
  if (rejected.ok) throw new Error("expected rejection");
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

// ---------------------------------------------------------------------------
// 边界回归：非整数版本、领域冲突重关联、观测条目悬空、相邻对象不被污染
// ---------------------------------------------------------------------------

test("非整数/字符串/越界版本一律拒绝，不得截断后当成已知版本改写", () => {
  const base = minimalState();
  for (const badVersion of [1.7, 2.5, 0, -1, NaN]) {
    const raw = JSON.stringify({ version: badVersion, state: base });
    const result = migrateWorkspace(raw, NOW);
    assert.equal(result.ok, false, `version ${String(badVersion)} 应被拒绝`);
    if (result.ok) throw new Error("expected failure");
    assert.equal(result.code, "invalid_envelope");
  }
  // 字符串版本号也不能被接受
  const stringVersion = migrateWorkspace(
    JSON.stringify({ version: "1", state: base }),
    NOW,
  );
  assert.equal(stringVersion.ok, false);
});

test("观测条目引用缺失材料时进入待处理清单，测量数据保留", () => {
  const state = minimalState({
    trials: [{ id: "t1" } as any],
    accessions: [{ id: "acc-keep", trialId: "t1" } as any],
    observationPasses: [
      {
        id: "pass-1",
        trialId: "t1",
        observedOn: "2026-03-01",
        observer: "M. Ikeda",
        entries: [
          { accessionId: "acc-keep", heightMm: 58, leafCount: 6, ecMs: 1.8, notes: "正常行" },
          { accessionId: "acc-gone", heightMm: 71, leafCount: 7, ecMs: 2.0, notes: "悬空行" },
        ],
      } as any,
    ],
  });
  const result = migrateWorkspace(v1Envelope(state), NOW);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("expected ok");
  const issue = result.issues.find(
    (i) =>
      i.ownerCollection === "observationPasses" &&
      i.field === "entries.1.accessionId",
  ) as DanglingReferenceIssue;
  assert.ok(issue, "悬空观测材料应被登记");
  assert.equal(issue.missingRef, "acc-gone");
  assert.equal(issue.clearable, false); // 材料身份不可清空
  // 测量事实保留
  const entry = result.state.observationPasses[0].entries[1];
  assert.equal(entry.accessionId, "acc-gone");
  assert.equal(entry.heightMm, 71);
});

test("观测条目重关联要求同试验在用材料；可成功关联到有效材料", () => {
  const state = minimalState({
    trials: [{ id: "t1" }, { id: "t2" }] as any,
    accessions: [
      { id: "acc-new", trialId: "t1", lifecycleStatus: "active" } as any,
      { id: "acc-other-trial", trialId: "t2", lifecycleStatus: "active" } as any,
      { id: "acc-retired", trialId: "t1", lifecycleStatus: "retired" } as any,
    ],
    observationPasses: [
      {
        id: "pass-1",
        trialId: "t1",
        entries: [{ accessionId: "acc-gone", heightMm: 10, leafCount: 1, ecMs: 1, notes: "" }],
      } as any,
    ],
  });
  const result = migrateWorkspace(v1Envelope(state), NOW);
  if (!result.ok) throw new Error("expected ok");
  const issue = result.issues.find(
    (i) => i.ownerCollection === "observationPasses",
  ) as DanglingReferenceIssue;

  // 空选择：拒绝
  assert.equal(resolveDanglingByRelink(result.state, result.issues, issue, "").ok, false);
  // 跨试验：拒绝
  assert.equal(resolveDanglingByRelink(result.state, result.issues, issue, "acc-other-trial").ok, false);
  // 停用材料：拒绝
  assert.equal(resolveDanglingByRelink(result.state, result.issues, issue, "acc-retired").ok, false);
  // 同试验在用：成功
  const fixed = resolveDanglingByRelink(result.state, result.issues, issue, "acc-new");
  assert.equal(fixed.ok, true);
  if (!fixed.ok) throw new Error("expected ok");
  assert.equal(fixed.value.state.observationPasses[0].entries[0].accessionId, "acc-new");
});

test("台架重关联拒绝同台架重复，成功时不污染相邻槽位", () => {
  const state = minimalState({
    accessions: [
      { id: "acc-a", trialId: "t1", lifecycleStatus: "active", preferredLight: "full-sun" } as any,
      { id: "acc-c", trialId: "t1", lifecycleStatus: "active", preferredLight: "full-sun" } as any,
    ],
    benches: [
      // b1：acc-a 已在本台架；悬空槽待重关联
      { id: "b1", code: "B1", capacity: 4, status: "assigned", lightProfile: "full-sun", assignedIds: ["acc-a", "acc-gone"] } as any,
    ],
  });
  const result = migrateWorkspace(v1Envelope(state), NOW);
  if (!result.ok) throw new Error("expected ok");
  const issue = result.issues.find(
    (i) => i.ownerCollection === "benches" && i.field === "assignedIds",
  ) as DanglingReferenceIssue;

  // 关联到已在同台架的 acc-a：拒绝（重复）——与正常分配规则一致
  const dupSame = resolveDanglingByRelink(result.state, result.issues, issue, "acc-a");
  assert.equal(dupSame.ok, false);
  if (!dupSame.ok) assert.equal(dupSame.errors[0].code, "duplicate");

  // 拒绝时原状态完全不变（悬空值与相邻槽位都保留）
  assert.deepEqual((result.state.benches[0] as any).assignedIds, ["acc-a", "acc-gone"]);

  // 成功关联到空闲的 acc-c
  const okRelink = resolveDanglingByRelink(result.state, result.issues, issue, "acc-c");
  assert.equal(okRelink.ok, true);
  if (!okRelink.ok) throw new Error("expected ok");
  assert.deepEqual(
    (okRelink.value.state.benches[0] as any).assignedIds,
    ["acc-a", "acc-c"],
  ); // 相邻槽位 acc-a 不动
});

test("台架重关联还拒绝停用材料/不可用台架/容量满/光照不匹配", () => {
  const state = minimalState({
    trials: [{ id: "t1" } as any],
    accessions: [
      { id: "acc-occupant", trialId: "t1", lifecycleStatus: "active", preferredLight: "full-sun" } as any,
      { id: "acc-active-sun", trialId: "t1", lifecycleStatus: "active", preferredLight: "full-sun" } as any,
      { id: "acc-retired-sun", trialId: "t1", lifecycleStatus: "retired", preferredLight: "full-sun" } as any,
      { id: "acc-shade", trialId: "t1", lifecycleStatus: "active", preferredLight: "shade" } as any,
    ],
    benches: [
      // 容量满（1 个合法占用 + 1 个悬空 = 2 > capacity 1）
      { id: "b-full", code: "BF", capacity: 1, status: "assigned", lightProfile: "full-sun", assignedIds: ["acc-occupant", "acc-gone-full"] } as any,
      // 隔离台架
      { id: "b-quar", code: "BQ", capacity: 4, status: "quarantine", lightProfile: "full-sun", assignedIds: ["acc-gone-quar"] } as any,
      // shade 台架：full-sun 材料光照不匹配；停用材料也被拒
      { id: "b-shade", code: "BS", capacity: 4, status: "assigned", lightProfile: "shade", assignedIds: ["acc-gone-shade"] } as any,
    ],
  });
  const result = migrateWorkspace(v1Envelope(state), NOW);
  if (!result.ok) throw new Error("expected ok");
  const issueFor = (benchId: string) =>
    result.issues.find(
      (i) => i.ownerCollection === "benches" && i.ownerId === benchId,
    ) as DanglingReferenceIssue;

  // 容量满
  const full = resolveDanglingByRelink(result.state, result.issues, issueFor("b-full"), "acc-active-sun");
  assert.equal(full.ok, false);
  if (!full.ok) assert.equal(full.errors[0].code, "capacity");

  // 隔离台架
  const quar = resolveDanglingByRelink(result.state, result.issues, issueFor("b-quar"), "acc-active-sun");
  assert.equal(quar.ok, false);
  if (!quar.ok) assert.equal(quar.errors[0].code, "quarantine");

  // 停用材料
  const retired = resolveDanglingByRelink(result.state, result.issues, issueFor("b-shade"), "acc-retired-sun");
  assert.equal(retired.ok, false);
  if (!retired.ok) assert.equal(retired.errors[0].code, "retired");

  // 光照不匹配
  const light = resolveDanglingByRelink(result.state, result.issues, issueFor("b-shade"), "acc-active-sun");
  assert.equal(light.ok, false);
  if (!light.ok) assert.equal(light.errors[0].code, "light_mismatch");

  // 光照兼容的 shade 材料可以关联到 shade 台架
  const compatible = resolveDanglingByRelink(result.state, result.issues, issueFor("b-shade"), "acc-shade");
  assert.equal(compatible.ok, true);
});

test("替代重关联拒绝自身/循环/停用/跨试验", () => {
  const state = minimalState({
    trials: [{ id: "t1" }, { id: "t2" }] as any,
    accessions: [
      // owner 已停用，顶层 replacementId 悬空
      { id: "acc-owner", trialId: "t1", lifecycleStatus: "retired", labels: [], retirementHistory: [], replacementId: "acc-gone" } as any,
      { id: "acc-retired", trialId: "t1", lifecycleStatus: "retired" } as any,
      { id: "acc-other", trialId: "t2", lifecycleStatus: "active" } as any,
      { id: "acc-good", trialId: "t1", lifecycleStatus: "active" } as any,
    ],
  });
  const result = migrateWorkspace(v1Envelope(state), NOW);
  if (!result.ok) throw new Error("expected ok");
  const issue = result.issues.find(
    (i) => i.ownerCollection === "accessions" && i.field === "replacementId",
  ) as DanglingReferenceIssue;
  assert.ok(issue);

  assert.equal(resolveDanglingByRelink(result.state, result.issues, issue, "acc-owner").ok, false); // 自身
  assert.equal(resolveDanglingByRelink(result.state, result.issues, issue, "acc-retired").ok, false); // 停用
  assert.equal(resolveDanglingByRelink(result.state, result.issues, issue, "acc-other").ok, false); // 跨试验

  // 构造循环：让 acc-good 已指向 owner，再把 owner 指回 acc-good
  const cyclicState: WorkspaceState = {
    ...result.state,
    accessions: result.state.accessions.map((a) =>
      a.id === "acc-good" ? { ...(a as any), replacementId: "acc-owner" } : a,
    ),
  };
  assert.equal(resolveDanglingByRelink(cyclicState, result.issues, issue, "acc-good").ok, false);

  // 合法关联成功，且不改动相邻材料
  const fixed = resolveDanglingByRelink(result.state, result.issues, issue, "acc-good");
  assert.equal(fixed.ok, true);
  if (!fixed.ok) throw new Error("expected ok");
  assert.equal(
    fixed.value.state.accessions.find((a) => a.id === "acc-other"),
    result.state.accessions.find((a) => a.id === "acc-other"),
  );
});

test("不可清空的引用（flag/观测材料）不能通过 clear 清空", () => {
  const state = minimalState({
    trials: [{ id: "t1" } as any],
    flags: [{ id: "f1", trialId: "t1", accessionId: "ghost", observationPassId: "p" } as any],
  });
  const result = migrateWorkspace(v1Envelope(state), NOW);
  if (!result.ok) throw new Error("expected ok");
  const issue = result.issues.find((i) => i.field === "accessionId") as DanglingReferenceIssue;
  const cleared = resolveDanglingByClear(result.state, result.issues, issue);
  assert.equal(cleared.ok, false);
});

// ---------------------------------------------------------------------------
// 替换 vs 新增、台架状态重算、观测同次去重
// ---------------------------------------------------------------------------

function benchFixture(overrides: any = {}) {
  return minimalState({
    trials: [{ id: "t1" } as any],
    accessions: [
      { id: "acc-a", trialId: "t1", lifecycleStatus: "active", preferredLight: "full-sun" } as any,
      { id: "acc-b", trialId: "t1", lifecycleStatus: "active", preferredLight: "full-sun" } as any,
    ],
    benches: [
      {
        id: "b1",
        code: "B1",
        capacity: 1,
        status: "assigned",
        lightProfile: "full-sun",
        assignedIds: ["acc-a"],
        ...overrides,
      } as any,
    ],
  });
}

test("台架悬空槽是替换而非新增：容量已满但仅有的占用是悬空槽时允许重关联", () => {
  // capacity 1，唯一槽位悬空（没有任何合法占用）——重关联应合法，不能按新增被容量拒绝
  const state = benchFixture({ assignedIds: ["acc-vanished"] });
  const result = migrateWorkspace(v1Envelope(state), NOW);
  if (!result.ok) throw new Error("expected ok");
  const issue = result.issues.find(
    (i) => i.ownerCollection === "benches",
  ) as DanglingReferenceIssue;

  const fixed = resolveDanglingByRelink(result.state, result.issues, issue, "acc-b");
  assert.equal(fixed.ok, true);
  if (!fixed.ok) throw new Error(JSON.stringify(fixed.errors));
  const bench: any = fixed.value.state.benches[0];
  assert.deepEqual(bench.assignedIds, ["acc-b"]);
  assert.equal(bench.status, "assigned");
});

test("移除悬空槽后仍真满位（合法占用已占满）时，重关联才按容量拒绝", () => {
  // capacity 1，合法占用 acc-a 已占满，另有一条悬空引用（异常超额）：
  // 移除悬空后仍满，重关联必须被容量规则拒绝。
  const state = benchFixture({ assignedIds: ["acc-a", "acc-vanished"] });
  const result = migrateWorkspace(v1Envelope(state), NOW);
  if (!result.ok) throw new Error("expected ok");
  const issue = result.issues.find(
    (i) => i.ownerCollection === "benches",
  ) as DanglingReferenceIssue;
  const fixed = resolveDanglingByRelink(result.state, result.issues, issue, "acc-b");
  assert.equal(fixed.ok, false);
  if (!fixed.ok) assert.equal(fixed.errors[0].code, "capacity");
});

test("清空台架悬空槽后按剩余占用重算状态：清空最后一个槽位变为 available", () => {
  // 台架只有一个悬空槽（无合法占用），清空后应为 available 而非仍显示已分配
  const state = benchFixture({ assignedIds: ["acc-vanished"] });
  const result = migrateWorkspace(v1Envelope(state), NOW);
  if (!result.ok) throw new Error("expected ok");
  const issue = result.issues.find(
    (i) => i.ownerCollection === "benches",
  ) as DanglingReferenceIssue;
  const cleared = resolveDanglingByClear(result.state, result.issues, issue);
  assert.equal(cleared.ok, true);
  if (!cleared.ok) throw new Error("expected ok");
  const bench: any = cleared.value.state.benches[0];
  assert.deepEqual(bench.assignedIds, []);
  assert.equal(bench.status, "available");
});

test("清空悬空槽但仍有其它合法占用时，台架保持 assigned", () => {
  const state = benchFixture({ capacity: 4, assignedIds: ["acc-a", "acc-vanished"] });
  const result = migrateWorkspace(v1Envelope(state), NOW);
  if (!result.ok) throw new Error("expected ok");
  const issue = result.issues.find(
    (i) => i.ownerCollection === "benches",
  ) as DanglingReferenceIssue;
  const cleared = resolveDanglingByClear(result.state, result.issues, issue);
  assert.equal(cleared.ok, true);
  if (!cleared.ok) throw new Error("expected ok");
  const bench: any = cleared.value.state.benches[0];
  assert.deepEqual(bench.assignedIds, ["acc-a"]);
  assert.equal(bench.status, "assigned");
});

test("观测条目重关联拒绝同一次观测中已存在的材料（去重）", () => {
  const state = minimalState({
    trials: [{ id: "t1" } as any],
    accessions: [
      { id: "acc-dup", trialId: "t1", lifecycleStatus: "active" } as any,
      { id: "acc-free", trialId: "t1", lifecycleStatus: "active" } as any,
    ],
    observationPasses: [
      {
        id: "pass-1",
        trialId: "t1",
        entries: [
          { accessionId: "acc-dup", heightMm: 50, leafCount: 6, ecMs: 1.5, notes: "已存在" },
          { accessionId: "acc-gone", heightMm: 70, leafCount: 7, ecMs: 1.6, notes: "悬空行" },
        ],
      } as any,
    ],
  });
  const result = migrateWorkspace(v1Envelope(state), NOW);
  if (!result.ok) throw new Error("expected ok");
  const issue = result.issues.find(
    (i) =>
      i.ownerCollection === "observationPasses" &&
      i.field === "entries.1.accessionId",
  ) as DanglingReferenceIssue;

  // 关联到同次观测已有的 acc-dup：拒绝 duplicate，数据不变
  const dup = resolveDanglingByRelink(result.state, result.issues, issue, "acc-dup");
  assert.equal(dup.ok, false);
  if (!dup.ok) assert.equal(dup.errors[0].code, "duplicate");
  assert.equal(
    result.state.observationPasses[0].entries[1].accessionId,
    "acc-gone",
  );

  // 关联到空闲材料 acc-free：成功，且两条记录分别保留
  const fixed = resolveDanglingByRelink(result.state, result.issues, issue, "acc-free");
  assert.equal(fixed.ok, true);
  if (!fixed.ok) throw new Error("expected ok");
  const entries = fixed.value.state.observationPasses[0].entries;
  assert.deepEqual(
    entries.map((e) => e.accessionId),
    ["acc-dup", "acc-free"],
  );
});
