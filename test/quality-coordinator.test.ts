import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  fingerprintState,
  scanWorkspace,
  selectFixable,
} from "../src/domain/quality";
import {
  InjectedCrash,
  type CrashInjection,
  resumeRepairBatch,
  rollbackRepairBatch,
  startRepairBatch,
} from "../src/state/repairCoordinator";
import {
  loadRepairArchive,
  loadWorkspaceEnvelope,
} from "../src/state/persistence";
import type { WorkspaceState } from "../src/domain/types";
import { makeBench, makeState } from "./fixtures";
import { MemoryStorage, STORAGE_KEYS, seedWorkspace } from "./memoryStorage";

/** 构造含 n 个独立悬空引用的工作区（每个台架一个）。 */
function workspaceWithGhosts(count: number): WorkspaceState {
  return makeState({
    trials: [],
    accessions: [],
    observationPasses: [],
    flags: [],
    benches: Array.from({ length: count }, (_, index) =>
      makeBench({
        id: `b${index + 1}`,
        code: `B-${index + 1}`,
        assignedIds: [`ghost-${index + 1}`],
        status: "assigned",
      }),
    ),
  });
}

function plansFor(state: WorkspaceState) {
  return selectFixable(scanWorkspace(state).findings);
}

function isRepaired(state: WorkspaceState): boolean {
  return state.benches.every((bench) => bench.assignedIds.length === 0);
}

describe("startRepairBatch — 正常路径", () => {
  it("全部成功：工作区为终态、会话归档、active 为 null", () => {
    const storage = new MemoryStorage();
    const damaged = workspaceWithGhosts(2);
    seedWorkspace(storage, damaged);
    const plans = plansFor(damaged);

    const result = startRepairBatch(storage, plans, {
      expectedFingerprint: fingerprintState(damaged),
    });
    assert.equal(result.crashed, false);
    assert.equal(result.writes, 1 + plans.length * 2 + 2);
    const stored = loadWorkspaceEnvelope(storage)?.state;
    assert.ok(stored && isRepaired(stored));
    const archive = loadRepairArchive(storage);
    assert.equal(archive.active, null);
    assert.equal(archive.history[0].outcome, "applied");
  });

  it("预演指纹不匹配（外部写入）：不做任何写入，抛出并发错误", () => {
    const storage = new MemoryStorage();
    const damaged = workspaceWithGhosts(1);
    seedWorkspace(storage, damaged);
    const plans = plansFor(damaged);

    // 模拟外部写入：存储中的工作区已经变化
    const externallyChanged: WorkspaceState = {
      ...damaged,
      benches: [makeBench({ id: "b1", code: "B-1", assignedIds: [] })],
    };
    seedWorkspace(storage, externallyChanged);

    assert.throws(
      () =>
        startRepairBatch(storage, plans, {
          expectedFingerprint: fingerprintState(damaged),
        }),
      /工作区在预演后/,
    );
    // 工作区保持外部写入后的状态；没有产生活动会话
    assert.deepEqual(loadWorkspaceEnvelope(storage)?.state, externallyChanged);
    assert.equal(loadRepairArchive(storage).active, null);
  });

  it("会话执行中检测到修复项冲突：停止且不应用后续项", () => {
    // release-all 修复在台架占用计划外变化时返回 conflict。
    const storage = new MemoryStorage();
    const state = makeState({
      accessions: [
        {
          id: "acc-1",
          trialId: "trial-1",
          accessionNo: "ACC-0001",
          cultivar: "Tiny Tim",
          source: "Pioneer Seed Lab",
          propagatedOn: "2026-02-02",
          quantity: 10,
          trayCells: 104,
          preferredLight: "full-sun",
          genotypeNote: "用于冲突测试的材料，至少十字。",
          labels: [],
        },
      ],
      benches: [
        makeBench({
          status: "blocked",
          blockedReason: "维修",
          assignedIds: ["acc-1"],
        }),
      ],
    });
    // 只取 release-all 这一条计划（过滤悬空引用等其他 finding）
    const allPlans = plansFor(state);
    const plans = allPlans.filter(
      (plan) => plan.fix.kind === "bench.release-all",
    );
    assert.equal(plans.length, 1);
    seedWorkspace(storage, state);
    // 预演确认后，另一个窗口向该台架追加计划外占用
    const changed = structuredClone(state);
    changed.benches[0].assignedIds = ["acc-1", "acc-new"];
    seedWorkspace(storage, changed);

    const result = startRepairBatch(storage, plans, {
      expectedFingerprint: fingerprintState(changed),
    });
    assert.equal(result.crashed, false);
    assert.equal(loadRepairArchive(storage).active?.status, "conflicted");
    // 冲突时不得清空台架（不能只应用部分修复）
    assert.deepEqual(loadWorkspaceEnvelope(storage)?.state.benches[0].assignedIds, [
      "acc-1",
      "acc-new",
    ]);
  });
});

describe("startRepairBatch — 每个持久化写入边界的故障注入", () => {
  const planCount = 3;

  it("逐边界参数化：任意一次写入后中断，恢复都收敛到终态且不重复执行", () => {
    const damaged = workspaceWithGhosts(planCount);
    const plans = plansFor(damaged);
    const totalWrites = 1 + plans.length * 2 + 2;

    // afterWriteCount=totalWrites 时所有写入已完成，属于成功路径（不中断）；
    // 1..totalWrites-1 是真正的“某次写入后进程中断”边界。
    for (let boundary = 1; boundary <= totalWrites; boundary += 1) {
      const storage = new MemoryStorage();
      seedWorkspace(storage, structuredClone(damaged));
      const injection: CrashInjection = { afterWriteCount: boundary };

      let crashed = false;
      try {
        startRepairBatch(storage, plans, {
          expectedFingerprint: fingerprintState(damaged),
          injection,
        });
      } catch (error) {
        assert.ok(error instanceof InjectedCrash, `边界 ${boundary} 应抛 InjectedCrash`);
        crashed = true;
      }

      if (boundary < totalWrites) {
        assert.equal(crashed, true, `边界 ${boundary} 必须中断`);
      } else {
        // 最后一次写入（会话归档）完成后“崩溃”：两边都已一致，恢复为 no-op。
        assert.equal(crashed, true);
      }

      // 中断后的存储必须可恢复
      const resumed = resumeRepairBatch(storage);
      if (boundary < totalWrites) {
        assert.ok(resumed, `边界 ${boundary}：必须检测到活动会话`);
        assert.notEqual(
          resumed.phase,
          "conflict",
          `边界 ${boundary}：同存储恢复不应冲突（${resumed.detail}）`,
        );
      } else {
        assert.equal(resumed, null, "终态边界：无活动会话，恢复为 no-op");
      }

      // 重复恢复必须是幂等的：第二次调用没有活动会话
      const second = resumeRepairBatch(storage);
      assert.equal(second, null, `边界 ${boundary}：恢复后不得留下活动会话`);

      const finalState = loadWorkspaceEnvelope(storage)?.state;
      assert.ok(finalState, `边界 ${boundary}：终态必须已保存`);
      assert.ok(isRepaired(finalState), `边界 ${boundary}：所有悬空引用必须解除`);
      const archive = loadRepairArchive(storage);
      assert.equal(archive.active, null, `边界 ${boundary}：会话必须归档`);
      assert.equal(archive.history[0].outcome, "applied");

      // 历史集合没有被丢弃
      assert.deepEqual(finalState.flags, damaged.flags);
      assert.deepEqual(finalState.observationPasses, damaged.observationPasses);
      assert.deepEqual(finalState.clearanceSnapshots, damaged.clearanceSnapshots);
    }
  });

  it("写入失败（failWriteCount）：工作区与会话保持可对账，恢复后收敛", () => {
    const damaged = workspaceWithGhosts(2);
    const plans = plansFor(damaged);
    const totalWrites = 1 + plans.length * 2 + 2;

    for (let boundary = 1; boundary <= totalWrites; boundary += 1) {
      const storage = new MemoryStorage();
      seedWorkspace(storage, structuredClone(damaged));
      let threw = false;
      try {
        startRepairBatch(storage, plans, {
          expectedFingerprint: fingerprintState(damaged),
          injection: { failWriteCount: boundary },
        });
      } catch (error) {
        threw = true;
        assert.ok(error instanceof InjectedCrash, `边界 ${boundary}: ${String(error)}`);
      }
      if (boundary === 1) {
        // 第一次写入（会话创建）即失败：没有活动会话，原始工作区保持不变。
        assert.equal(threw, true);
        assert.equal(loadRepairArchive(storage).active, null);
        assert.deepEqual(loadWorkspaceEnvelope(storage)?.state, damaged);
        continue;
      }
      const resumed = resumeRepairBatch(storage);
      assert.ok(resumed, `边界 ${boundary}：失败后仍要能恢复`);
      assert.notEqual(resumed.phase, "conflict");
      const finalState = loadWorkspaceEnvelope(storage)?.state;
      assert.ok(finalState && isRepaired(finalState), `边界 ${boundary}：终态收敛`);
    }
  });
});

describe("resumeRepairBatch — 六种恢复组合", () => {
  it("1. 会话待执行、工作区为修复前：从头执行", () => {
    const storage = new MemoryStorage();
    const damaged = workspaceWithGhosts(2);
    seedWorkspace(storage, damaged);
    const plans = plansFor(damaged);
    // 只创建会话（第 1 次写入后中断）
    assert.throws(
      () =>
        startRepairBatch(storage, plans, {
          expectedFingerprint: fingerprintState(damaged),
          injection: { afterWriteCount: 1 },
        }),
      InjectedCrash,
    );
    const result = resumeRepairBatch(storage);
    assert.equal(result?.phase, "resumed");
    assert.equal(result?.applied, 2);
    assert.ok(isRepaired(loadWorkspaceEnvelope(storage)!.state));
  });

  it("2. 部分执行：从对应前缀续跑，不重复已生效项", () => {
    const storage = new MemoryStorage();
    const damaged = workspaceWithGhosts(3);
    seedWorkspace(storage, damaged);
    const plans = plansFor(damaged);
    // 第 2 次写入 = 第 1 项“工作区已写、会话尚未记录”之后：
    // 存储中的工作区处于第 1 步前缀，会话里该项仍为 pending。
    assert.throws(
      () =>
        startRepairBatch(storage, plans, {
          expectedFingerprint: fingerprintState(damaged),
          injection: { afterWriteCount: 2 },
        }),
      InjectedCrash,
    );
    const storedAfterCrash = loadWorkspaceEnvelope(storage)!.state;
    assert.equal(storedAfterCrash.benches[0].assignedIds.length, 0);
    assert.equal(storedAfterCrash.benches[1].assignedIds.length, 1);

    const result = resumeRepairBatch(storage);
    assert.equal(result?.phase, "resumed");
    assert.equal(result?.applied, 2);
    assert.equal(result?.alreadyFixed, 1, "第一项应识别为已生效，不重复执行");
    assert.ok(isRepaired(loadWorkspaceEnvelope(storage)!.state));
  });

  it("3. 会话已完成但工作区尚未保存：幂等补放到终态", () => {
    // 构造“会话 completed、stateAfter 为终态，但工作区停在中间前缀”的不一致状态。
    const storage = new MemoryStorage();
    const damaged = workspaceWithGhosts(2);
    seedWorkspace(storage, damaged);
    const plans = plansFor(damaged);
    // 让所有项执行完毕（会话已写终态），但最终工作区写入前中断。
    // 写入顺序：会话(1) 项1工作区(2) 项1会话(3) 项2工作区(4) 项2会话(5) 终态工作区(6) 终态会话(7)
    assert.throws(
      () =>
        startRepairBatch(storage, plans, {
          expectedFingerprint: fingerprintState(damaged),
          injection: { afterWriteCount: 5 },
        }),
      InjectedCrash,
    );
    // 第 5 次写入后：工作区是终态（第 4 次），会话记录了两项完成但 status 仍 in_progress。
    const result = resumeRepairBatch(storage);
    assert.ok(result);
    assert.notEqual(result.phase, "conflict");
    assert.ok(isRepaired(loadWorkspaceEnvelope(storage)!.state));
  });

  it("4. 工作区已保存终态、会话未完成：只补写会话，绝不重新执行", () => {
    const storage = new MemoryStorage();
    const damaged = workspaceWithGhosts(1);
    seedWorkspace(storage, damaged);
    const plans = plansFor(damaged);
    // 写入序列：会话(1) 项1工作区(2) 项1会话(3) 终态工作区(4) 终态会话(5)
    // 在第 4 次写入后中断：工作区终态，会话 in_progress。
    assert.throws(
      () =>
        startRepairBatch(storage, plans, {
          expectedFingerprint: fingerprintState(damaged),
          injection: { afterWriteCount: 4 },
        }),
      InjectedCrash,
    );
    assert.ok(isRepaired(loadWorkspaceEnvelope(storage)!.state));
    const result = resumeRepairBatch(storage);
    assert.equal(result?.phase, "already-applied");
    assert.equal(result?.applied, 0, "不得重复执行修复");
    assert.equal(loadRepairArchive(storage).active, null);
  });

  it("5. 两边内容不一致（外部写入）：冲突且保持当前状态", () => {
    const storage = new MemoryStorage();
    const damaged = workspaceWithGhosts(2);
    seedWorkspace(storage, damaged);
    const plans = plansFor(damaged);
    // 创建会话后中断
    assert.throws(
      () =>
        startRepairBatch(storage, plans, {
          expectedFingerprint: fingerprintState(damaged),
          injection: { afterWriteCount: 1 },
        }),
      InjectedCrash,
    );
    // 外部写入一个既非修复前也非任何前缀的工作区
    const tampered: WorkspaceState = {
      ...damaged,
      benches: [
        ...damaged.benches,
        makeBench({ id: "extra", code: "B-X", assignedIds: ["someone-else"] }),
      ],
    };
    seedWorkspace(storage, tampered);

    const result = resumeRepairBatch(storage);
    assert.equal(result?.phase, "conflict");
    assert.deepEqual(
      loadWorkspaceEnvelope(storage)?.state,
      tampered,
      "冲突时当前工作区必须原样保留",
    );
    assert.equal(loadRepairArchive(storage).active?.status, "conflicted");

    // 人工决定回滚后，恢复修复前快照
    rollbackRepairBatch(storage);
    const rolledBack = loadWorkspaceEnvelope(storage)!.state;
    assert.deepEqual(rolledBack, damaged);
  });

  it("6. 重复恢复：第二次调用无活动会话，状态不再变化", () => {
    const storage = new MemoryStorage();
    const damaged = workspaceWithGhosts(2);
    seedWorkspace(storage, damaged);
    const plans = plansFor(damaged);
    assert.throws(
      () =>
        startRepairBatch(storage, plans, {
          expectedFingerprint: fingerprintState(damaged),
          injection: { afterWriteCount: 2 },
        }),
      InjectedCrash,
    );
    const first = resumeRepairBatch(storage);
    assert.ok(first);
    const stateAfterFirst = loadWorkspaceEnvelope(storage)!.state;
    const second = resumeRepairBatch(storage);
    assert.equal(second, null);
    assert.deepEqual(loadWorkspaceEnvelope(storage)!.state, stateAfterFirst);
  });
});

describe("rollbackRepairBatch — 写入边界故障注入", () => {
  it("回滚工作区写入后崩溃：重启恢复仍收敛到修复前状态", () => {
    const storage = new MemoryStorage();
    const damaged = workspaceWithGhosts(2);
    seedWorkspace(storage, damaged);
    const plans = plansFor(damaged);
    // 创建会话后崩溃（第 1 次写入后），保证有一个活动会话可回滚
    assert.throws(
      () =>
        startRepairBatch(storage, plans, {
          expectedFingerprint: fingerprintState(damaged),
          injection: { afterWriteCount: 1 },
        }),
      InjectedCrash,
    );
    assert.ok(loadRepairArchive(storage).active);

    // 回滚的第一次写入（工作区）后崩溃
    assert.throws(
      () => rollbackRepairBatch(storage, { injection: { afterWriteCount: 1 } }),
      InjectedCrash,
    );
    // 活动会话仍在；再次回滚（幂等）
    const journal = rollbackRepairBatch(storage);
    assert.ok(journal);
    assert.equal(journal.outcome, "rolled-back");
    assert.deepEqual(loadWorkspaceEnvelope(storage)?.state, damaged);
    assert.equal(loadRepairArchive(storage).active, null);
    // 历史保留回滚记录
    assert.equal(loadRepairArchive(storage).history[0].outcome, "rolled-back");
  });
});

describe("startRepairBatch — 关联损坏", () => {
  it("多个关联损坏在同一批次中全部消解", () => {
    const storage = new MemoryStorage();
    const damaged = makeState({
      accessions: [],
      benches: [
        makeBench({ id: "b1", code: "B-1", assignedIds: ["ghost-1"], status: "assigned" }),
        makeBench({ id: "b2", code: "B-2", assignedIds: ["ghost-2", "ghost-3"], status: "assigned" }),
      ],
    });
    seedWorkspace(storage, damaged);
    const plans = plansFor(damaged);
    assert.ok(plans.length >= 2);
    startRepairBatch(storage, plans, {
      expectedFingerprint: fingerprintState(damaged),
    });
    const state = loadWorkspaceEnvelope(storage)!.state;
    assert.deepEqual(
      state.benches.map((bench) => bench.assignedIds),
      [[], []],
    );
  });
});
