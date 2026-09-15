import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  advanceRepair,
  applyFix,
  applyFixPlan,
  createRepairJournal,
  pendingItems,
  previewFixes,
  rollbackRepair,
  scanWorkspace,
  selectFixable,
  verifyProjectedState,
} from "../src/domain/quality";
import {
  makeAccession,
  makeBench,
  makeFlag,
  makeHealthyWorkspace,
  makePass,
  makeState,
  makeTrial,
} from "./fixtures";

function planFor(state: ReturnType<typeof makeState>, ruleCode: string) {
  const report = scanWorkspace(state);
  const finding = report.findings.find((item) => item.ruleCode === ruleCode);
  assert.ok(finding, `期望找到规则 ${ruleCode}`);
  const plans = selectFixable([finding]);
  assert.equal(plans.length, 1, `${ruleCode} 必须可自动修复`);
  return plans[0];
}

describe("修复注册表 — 幂等与安全边界", () => {
  it("bench.unassign 移除悬空引用后重复执行返回 already-fixed", () => {
    const state = makeState({
      benches: [makeBench({ assignedIds: ["acc-ghost"] })],
    });
    const plan = planFor(state, "B-ASSIGN-MISSING-01");

    const once = applyFix(state, plan.fix);
    assert.equal(once.status, "applied");
    assert.deepEqual(
      once.state.benches[0].assignedIds,
      [],
      "悬空引用必须被移除",
    );

    const twice = applyFix(once.state, plan.fix);
    assert.equal(twice.status, "already-fixed");
    assert.deepEqual(twice.state, once.state, "重复执行不得再改动状态");
  });

  it("bench.dedupe 折叠台架内重复 id 且不删除其它材料", () => {
    const state = makeState({
      accessions: [makeAccession({ id: "a1" }), makeAccession({ id: "a2", accessionNo: "ACC-0002" })],
      benches: [
        makeBench({ assignedIds: ["a1", "a1", "a2"], status: "assigned" }),
      ],
    });
    const plan = planFor(state, "B-ASSIGN-DUP-01");
    const result = applyFix(state, plan.fix);
    assert.equal(result.status, "applied");
    assert.deepEqual(result.state.benches[0].assignedIds, ["a1", "a2"]);
  });

  it("release-all 不会静默扩大范围：预演后出现新占用时返回 conflict", () => {
    const state = makeState({
      benches: [
        makeBench({
          status: "blocked",
          blockedReason: "维修",
          assignedIds: ["acc-1"],
        }),
      ],
    });
    const plan = planFor(state, "B-RESTRICTED-OCCUPIED-01");
    const mutated = {
      ...state,
      benches: [
        makeBench({
          id: "bench-1",
          status: "blocked",
          blockedReason: "维修",
          assignedIds: ["acc-1", "acc-new"],
        }),
      ],
    };
    const outcome = applyFix(mutated, plan.fix);
    assert.equal(outcome.status, "conflict");
    assert.deepEqual(outcome.state, mutated, "冲突时状态必须保持不变");
  });

  it("detangle 保留一个台架、从其余台架移出且材料记录不被删除", () => {
    const acc = makeAccession({ id: "acc-1", preferredLight: "full-sun" });
    const state = makeState({
      accessions: [acc],
      benches: [
        makeBench({ id: "b1", code: "B-1", assignedIds: ["acc-1"], status: "assigned" }),
        makeBench({ id: "b2", code: "B-2", assignedIds: ["acc-1"], status: "assigned" }),
      ],
    });
    const plan = planFor(state, "A-BENCH-MULTI-01");
    const result = applyFix(state, plan.fix);
    assert.equal(result.status, "applied");
    const benches = result.state.benches;
    assert.deepEqual(benches.find((b) => b.id === "b1")?.assignedIds, ["acc-1"]);
    assert.deepEqual(benches.find((b) => b.id === "b2")?.assignedIds, []);
    assert.equal(result.state.accessions.length, 1, "材料本身必须保留");
  });
});

describe("整批预演", () => {
  it("多个关联损坏：预演在副本上运行，不写入原状态；终态校验无新增阻断", () => {
    // 关联损坏：同一材料跨两台架 + 一个悬空引用 + 台架状态派生错误
    const acc = makeAccession({ id: "acc-1", preferredLight: "full-sun" });
    const state = makeState({
      accessions: [acc, makeAccession({ id: "acc-2", accessionNo: "ACC-0002" })],
      benches: [
        makeBench({
          id: "b1",
          code: "B-1",
          assignedIds: ["acc-1"],
          status: "available", // 占用却标记可用
        }),
        makeBench({ id: "b2", code: "B-2", assignedIds: ["acc-1", "ghost-id"] }),
      ],
    });
    const before = JSON.stringify(state);
    const report = scanWorkspace(state);
    const plans = selectFixable(report.blocking);
    assert.ok(plans.length >= 2, "关联损坏应产生多个可修复阻断");

    const dryRun = previewFixes(state, plans);
    assert.equal(JSON.stringify(state), before, "预演不得修改原状态");
    assert.ok(dryRun.appliedCount >= 2);
    assert.equal(dryRun.conflicts.length, 0);

    const verification = verifyProjectedState(state, plans);
    assert.equal(verification.safe, true);
    assert.equal(verification.introduced.length, 0);
    assert.equal(verification.remaining.length, 0, "目标阻断必须在预计终态中全部消解");
  });

  it("整批执行产出审计记录，且只触碰被修复的集合", () => {
    const state = makeState({
      benches: [makeBench({ assignedIds: ["ghost-id"], status: "assigned" })],
    });
    const report = scanWorkspace(state);
    const plans = selectFixable(report.findings);
    const result = applyFixPlan(state, plans);
    assert.equal(result.appliedCount, 1);
    assert.equal(result.state.benches[0].assignedIds.length, 0);
    assert.equal(result.records[0].changes.length > 0, true, "每条修复必须记录变更说明");
    // 历史集合未被触碰
    assert.equal(result.state.observationPasses.length, state.observationPasses.length);
    assert.equal(result.state.clearanceSnapshots.length, state.clearanceSnapshots.length);
  });
});

describe("修复会话 — 中断恢复", () => {
  it("会话冻结修复前状态，可整批回滚到完全相同的快照", () => {
    const state = makeState({
      benches: [makeBench({ assignedIds: ["ghost-id"], status: "assigned" })],
    });
    const plans = selectFixable(scanWorkspace(state).findings);
    const journal = createRepairJournal({ stateBefore: state, plans });

    const advanced = advanceRepair(journal, state);
    assert.notDeepEqual(advanced.state, state);
    assert.equal(advanced.journal.status, "completed");

    const rolledBack = rollbackRepair(advanced.journal);
    assert.deepEqual(rolledBack.state, state, "回滚必须恢复修复前快照");
    assert.equal(rolledBack.journal.outcome, "rolled-back");
  });

  it("模拟中断后续跑：已执行项幂等跳过，pending 项继续完成", () => {
    // 两个互相独立的悬空引用
    const state = makeState({
      benches: [
        makeBench({ id: "b1", code: "B-1", assignedIds: ["ghost-1"], status: "assigned" }),
        makeBench({ id: "b2", code: "B-2", assignedIds: ["ghost-2"], status: "assigned" }),
      ],
    });
    const plans = selectFixable(scanWorkspace(state).findings);
    assert.equal(plans.length, 2);
    const journal = createRepairJournal({ stateBefore: state, plans });

    // “中断”：只把第一项推进 applied（用 applyFix 模拟半截执行后崩溃）
    const first = applyFix(state, plans[0].fix);
    assert.equal(first.status, "applied");
    const partiallyAdvanced = advanceRepair(journal, first.state);
    // 两项一起推进：第一项 already-fixed，第二项 applied
    const statuses = partiallyAdvanced.journal.items.map((item) => item.status);
    assert.ok(statuses.includes("already-fixed"));
    assert.ok(statuses.includes("applied"));
    assert.equal(partiallyAdvanced.applied, 1);
    assert.equal(partiallyAdvanced.skipped, 1);
    assert.deepEqual(
      partiallyAdvanced.state.benches.map((bench) => bench.assignedIds),
      [[], []],
    );
  });

  it("在工作区已被外部改写时拒绝重放（并发冲突），保持当前状态", () => {
    const damaged = makeState({
      benches: [makeBench({ assignedIds: ["ghost-id"], status: "assigned" })],
    });
    const plans = selectFixable(scanWorkspace(damaged).findings);
    const journal = createRepairJournal({ stateBefore: damaged, plans });
    const healthy = makeHealthyWorkspace();

    const result = advanceRepair(journal, healthy);
    assert.equal(result.applied, 0);
    assert.equal(result.journal.status, "conflicted");
    assert.deepEqual(result.state, healthy, "冲突时当前工作区必须原样保留");
    assert.ok(result.journal.conflictReason);
  });

  it("终态工作区 + 未完成会话：只补写会话，不重复执行修复", () => {
    const damaged = makeState({
      benches: [makeBench({ assignedIds: ["ghost-id"], status: "assigned" })],
    });
    const plans = selectFixable(scanWorkspace(damaged).findings);
    const journal = createRepairJournal({ stateBefore: damaged, plans });
    // 工作区已经是修复后的终态（模拟“工作区已保存、会话未完成”）
    const fixed = applyFix(damaged, plans[0].fix).state;

    const result = advanceRepair(journal, fixed);
    assert.equal(result.applied, 0, "终态已存在时不得重复执行");
    assert.equal(result.journal.status, "completed");
    assert.deepEqual(result.state, fixed);
  });

  it("pendingItems 只返回尚未处理的审计行", () => {
    const state = makeState({
      benches: [makeBench({ assignedIds: ["ghost-id"], status: "assigned" })],
    });
    const journal = createRepairJournal({
      stateBefore: state,
      plans: selectFixable(scanWorkspace(state).findings),
    });
    assert.equal(pendingItems(journal).length, 1);
    const advanced = advanceRepair(journal, state).journal;
    assert.equal(pendingItems(advanced).length, 0);
  });
});

describe("修复不得丢弃历史", () => {
  it("校正标记的试验引用时，观测记录与标记内容保持不变", () => {
    const state = makeState({
      trials: [makeTrial({ id: "trial-1" }), makeTrial({ id: "trial-2", code: "TST-02" })],
      accessions: [makeAccession({ trialId: "trial-2" })],
      observationPasses: [makePass({ trialId: "trial-2" })],
      flags: [makeFlag({ trialId: "trial-1" })],
    });
    const plan = planFor(state, "F-TRIAL-MISMATCH-01");
    const result = applyFix(state, plan.fix);
    assert.equal(result.state.flags[0].trialId, "trial-2");
    assert.equal(result.state.flags[0].id, "flag-1");
    assert.equal(result.state.observationPasses.length, 1);
    assert.equal(result.state.flags[0].resolutionNote, undefined);
  });
});
