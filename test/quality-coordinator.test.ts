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
  saveRepairArchive,
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

describe("rollbackRepairBatch — 回滚意图持久化与逐边界故障注入", () => {
  it("三个回滚写入边界任意中断，重启都恢复到修复前状态并清空活动会话", () => {
    for (const boundary of [1, 2, 3]) {
      const storage = new MemoryStorage();
      const damaged = workspaceWithGhosts(2);
      seedWorkspace(storage, structuredClone(damaged));
      const plans = plansFor(damaged);
      // 修复执行到一半后崩溃（第 1 项工作区已写，会话未写）
      assert.throws(
        () =>
          startRepairBatch(storage, plans, {
            expectedFingerprint: fingerprintState(damaged),
            injection: { afterWriteCount: 2 },
          }),
        InjectedCrash,
      );

      // 用户选择回滚，在第 boundary 次写入后中断：
      // 1=回滚意图落盘后；2=工作区写回后；3=归档后（无 crash，正常完成）
      const throwing = boundary < 3;
      if (throwing) {
        assert.throws(
          () =>
            rollbackRepairBatch(storage, {
              injection: { afterWriteCount: boundary },
            }),
          InjectedCrash,
        );
      } else {
        rollbackRepairBatch(storage, { injection: { afterWriteCount: 99 } });
      }

      // 模拟真实重启：全新读取存储并自动恢复
      const result = resumeRepairBatch(storage);
      if (boundary < 3) {
        assert.ok(result, `边界 ${boundary}：活动会话必须被恢复处理`);
        assert.ok(
          result.phase === "rollback-resumed" ||
            result.phase === "rollback-completed",
          `边界 ${boundary}：必须完成回滚（实际 ${result?.phase}），不能重新应用修复`,
        );
      }

      // 最终状态始终是修复前快照
      assert.deepEqual(
        loadWorkspaceEnvelope(storage)?.state,
        damaged,
        `边界 ${boundary}：工作区必须回到修复前状态`,
      );
      const archive = loadRepairArchive(storage);
      assert.equal(archive.active, null, `边界 ${boundary}：活动会话必须清空`);
      assert.equal(
        archive.history[0]?.outcome,
        "rolled-back",
        `边界 ${boundary}：历史必须记录回滚`,
      );

      // 再次“重启”是 no-op，不会重新应用修复
      const second = resumeRepairBatch(storage);
      assert.equal(second, null);
      assert.deepEqual(loadWorkspaceEnvelope(storage)?.state, damaged);
    }
  });

  it("回滚意图先于工作区写入落盘：意图落盘即崩溃，重启绝不重新应用修复", () => {
    const storage = new MemoryStorage();
    const damaged = workspaceWithGhosts(1);
    seedWorkspace(storage, structuredClone(damaged));
    const plans = plansFor(damaged);
    // 修复已经全部完成：工作区是终态（无悬空引用），但用户随后选择回滚。
    startRepairBatch(storage, plans, {
      expectedFingerprint: fingerprintState(damaged),
    });
    const fixed = loadWorkspaceEnvelope(storage)!.state;
    assert.ok(isRepaired(fixed));

    // 新活动会话不存在了；手工构造一个终态 active 会话 + 回滚意图（只写意图后崩溃）
    const active = loadRepairArchive(storage).history[0];
    assert.ok(active);
    saveRepairArchive(storage, {
      active: {
        ...active,
        status: "in_progress",
        outcome: undefined,
        intent: "rollback",
        completedAt: undefined,
      },
      history: [],
    });
    // 此时工作区仍是修复终态，但 intent=rollback
    const result = resumeRepairBatch(storage);
    assert.equal(result?.phase, "rollback-resumed");
    assert.deepEqual(loadWorkspaceEnvelope(storage)?.state, damaged);
    assert.equal(loadRepairArchive(storage).active, null);
  });
});

describe("真实重启恢复（存储往返）", () => {
  it("序列化-反序列化后恢复，不依赖任何内存状态", () => {
    const storage = new MemoryStorage();
    const damaged = workspaceWithGhosts(2);
    seedWorkspace(storage, structuredClone(damaged));
    const plans = plansFor(damaged);

    assert.throws(
      () =>
        startRepairBatch(storage, plans, {
          expectedFingerprint: fingerprintState(damaged),
          injection: { afterWriteCount: 3 },
        }),
      InjectedCrash,
    );

    // 模拟真实重启：序列化全部存储内容到 JSON，再灌入一个全新的 MemoryStorage
    const exported = Object.fromEntries(storage.keys().map((key) => [key, storage.getItem(key)]));
    const fresh = new MemoryStorage();
    for (const [key, value] of Object.entries(exported)) {
      fresh.setItem(key, value as string);
    }

    const result = resumeRepairBatch(fresh);
    assert.ok(result);
    assert.notEqual(result.phase, "conflict");
    const state = loadWorkspaceEnvelope(fresh)!.state;
    assert.ok(isRepaired(state));
    assert.equal(loadRepairArchive(fresh).active, null);
    assert.equal(loadRepairArchive(fresh).history[0].outcome, "applied");

    // 再重启一次：幂等 no-op
    assert.equal(resumeRepairBatch(fresh), null);
  });
});

describe("completed active 会话归档", () => {
  it("completed 状态但仍在 active 的会话（终态工作区）在恢复时被归档清除", () => {
    const storage = new MemoryStorage();
    const damaged = workspaceWithGhosts(1);
    seedWorkspace(storage, structuredClone(damaged));
    const plans = plansFor(damaged);
    // 跑到终态工作区已写、会话归档未完成（第 4 次写入后崩溃）
    assert.throws(
      () =>
        startRepairBatch(storage, plans, {
          expectedFingerprint: fingerprintState(damaged),
          injection: { afterWriteCount: 4 },
        }),
      InjectedCrash,
    );
    const activeAfterCrash = loadRepairArchive(storage).active;
    assert.ok(activeAfterCrash);
    assert.ok(isRepaired(loadWorkspaceEnvelope(storage)!.state));

    // 第一次恢复：already-applied（补写归档）
    const first = resumeRepairBatch(storage);
    assert.ok(first);
    assert.equal(loadRepairArchive(storage).active, null);

    // 构造 completed active 直接验证 phase
    const completedActive = {
      ...activeAfterCrash!,
      status: "completed" as const,
      outcome: "applied" as const,
    };
    saveRepairArchive(storage, { active: completedActive, history: [] });
    const second = resumeRepairBatch(storage);
    assert.equal(second?.phase, "completed");
    assert.equal(loadRepairArchive(storage).active, null);
    // 工作区没有被再次写入/改动
    assert.ok(isRepaired(loadWorkspaceEnvelope(storage)!.state));

    // 第三次恢复：没有活动会话
    assert.equal(resumeRepairBatch(storage), null);
  });
});

describe("多窗口写入冲突", () => {
  it("预演确认后另一个窗口改变工作区：整批拒绝，不应用部分修复", () => {
    const storage = new MemoryStorage();
    const damaged = workspaceWithGhosts(2);
    seedWorkspace(storage, structuredClone(damaged));
    const plans = plansFor(damaged);
    const previewFingerprint = fingerprintState(damaged);

    // 另一窗口直接改写工作区（新增台架占用）
    const foreign = structuredClone(damaged);
    foreign.benches.push(
      makeBench({ id: "foreign", code: "B-F", assignedIds: ["other-data"] }),
    );
    seedWorkspace(storage, foreign);

    // 本窗口确认修复：指纹不匹配，必须整体拒绝
    assert.throws(
      () =>
        startRepairBatch(storage, plans, {
          expectedFingerprint: previewFingerprint,
        }),
      /预演后/,
    );
    // 工作区保持外部写入原样，没有任何部分修复，没有遗留活动会话
    assert.deepEqual(loadWorkspaceEnvelope(storage)?.state, foreign);
    assert.equal(loadRepairArchive(storage).active, null);
  });

  it("修复进行中另一窗口写入无法识别的状态：恢复判冲突并保持该状态", () => {
    const storage = new MemoryStorage();
    const damaged = workspaceWithGhosts(2);
    seedWorkspace(storage, structuredClone(damaged));
    const plans = plansFor(damaged);
    assert.throws(
      () =>
        startRepairBatch(storage, plans, {
          expectedFingerprint: fingerprintState(damaged),
          injection: { afterWriteCount: 1 },
        }),
      InjectedCrash,
    );
    const foreign = structuredClone(damaged);
    foreign.benches[0].code = "RENAMED-BY-OTHER-WINDOW";
    seedWorkspace(storage, foreign);

    const result = resumeRepairBatch(storage);
    assert.equal(result?.phase, "conflict");
    assert.deepEqual(loadWorkspaceEnvelope(storage)?.state, foreign);
    assert.equal(loadRepairArchive(storage).active?.status, "conflicted");
    // 冲突后人工回滚仍然可以恢复到修复前快照
    rollbackRepairBatch(storage);
    assert.deepEqual(loadWorkspaceEnvelope(storage)?.state, damaged);
    assert.equal(loadRepairArchive(storage).active, null);
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
