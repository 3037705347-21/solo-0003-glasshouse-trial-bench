import { describe, expect, it } from "vitest";
import { workspaceReducer } from "../src/state/reducer";
import {
  assignAccession,
  benchUtilization,
  canAssignAccession,
  releaseAccession,
  updateBenchLight,
  validateBenchAssignment,
} from "../src/domain/bench";
import type { WorkspaceState } from "../src/domain/types";
import {
  errorCodes,
  expectFailure,
  findError,
  makeAccession,
  makeBench,
  makeTrialWorkspace,
} from "./helpers";

describe("台架分配 - 光照兼容", () => {
  const accession = (preferredLight: "full-sun" | "partial-shade" | "shade") =>
    makeAccession({ id: 1, preferredLight });

  it("全日照材料只能放入全日照台架", () => {
    expect(canAssignAccession(accession("full-sun"), makeBench({ lightProfile: "full-sun" }))).toBe(true);
    expect(canAssignAccession(accession("full-sun"), makeBench({ lightProfile: "partial-shade" }))).toBe(false);
    expect(canAssignAccession(accession("full-sun"), makeBench({ lightProfile: "shade" }))).toBe(false);
  });

  it("半阴材料可以放入半阴或全日照台架，但不能放入遮阴台架", () => {
    expect(canAssignAccession(accession("partial-shade"), makeBench({ lightProfile: "partial-shade" }))).toBe(true);
    expect(canAssignAccession(accession("partial-shade"), makeBench({ lightProfile: "full-sun" }))).toBe(true);
    expect(canAssignAccession(accession("partial-shade"), makeBench({ lightProfile: "shade" }))).toBe(false);
  });

  it("遮阴材料可以放入遮阴或半阴台架，但不能放入全日照台架", () => {
    expect(canAssignAccession(accession("shade"), makeBench({ lightProfile: "shade" }))).toBe(true);
    expect(canAssignAccession(accession("shade"), makeBench({ lightProfile: "partial-shade" }))).toBe(true);
    expect(canAssignAccession(accession("shade"), makeBench({ lightProfile: "full-sun" }))).toBe(false);
  });

  it("光照不匹配时返回 light_mismatch 错误", () => {
    const failure = expectFailure(
      validateBenchAssignment(
        accession("full-sun"),
        makeBench({ id: 2, code: "H-1", lightProfile: "shade" }),
      ),
    );
    expect(findError(failure, "benchId")?.code).toBe("light_mismatch");
  });
});

describe("台架分配 - 容量边界", () => {
  it("容量内允许分配，台架状态变为已分配", () => {
    const accession = makeAccession({ id: 1 });
    const bench = makeBench({ id: 1, capacity: 1 });
    const result = assignAccession(accession, bench);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.assignedIds).toEqual([accession.id]);
      expect(result.value.status).toBe("assigned");
    }
  });

  it("恰好达到容量时最后一个槽位仍可分配", () => {
    const existing = makeAccession({ id: 1 });
    const incoming = makeAccession({ id: 2 });
    const bench = makeBench({
      id: 1,
      capacity: 2,
      assignedIds: [existing.id],
      status: "assigned",
    });
    const result = assignAccession(incoming, bench);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.assignedIds).toHaveLength(2);
    }
  });

  it("满位台架拒绝新的材料", () => {
    const incoming = makeAccession({ id: 2 });
    const bench = makeBench({
      id: 1,
      capacity: 1,
      assignedIds: [makeAccession({ id: 1 }).id],
      status: "assigned",
    });
    const failure = expectFailure(validateBenchAssignment(incoming, bench));
    expect(findError(failure, "benchId")?.code).toBe("capacity");
  });

  it("利用率按已分配数除以容量计算并取整", () => {
    expect(benchUtilization(makeBench({ capacity: 4, assignedIds: [] }))).toBe(0);
    expect(
      benchUtilization(makeBench({ capacity: 4, assignedIds: ["a", "b", "c"] })),
    ).toBe(75);
    expect(
      benchUtilization(makeBench({ capacity: 3, assignedIds: ["a", "b"] })),
    ).toBe(67);
  });
});

describe("台架分配 - 停用与隔离状态", () => {
  const accession = makeAccession({ id: 1 });

  it("停用台架拒绝分配并返回 blocked 错误", () => {
    const bench = makeBench({
      id: 1,
      status: "blocked",
      blockedReason: "滴灌维修",
    });
    const failure = expectFailure(validateBenchAssignment(accession, bench));
    expect(findError(failure, "benchId")?.code).toBe("blocked");
    expect(failure.errors[0]?.message).toContain("滴灌维修");
  });

  it("隔离中台架拒绝分配并返回 quarantine 错误", () => {
    const bench = makeBench({ id: 1, status: "quarantine" });
    const failure = expectFailure(validateBenchAssignment(accession, bench));
    expect(findError(failure, "benchId")?.code).toBe("quarantine");
  });

  it("停用或隔离台架即使光照兼容、有空位也不可分配", () => {
    expect(
      canAssignAccession(accession, makeBench({ id: 1, status: "blocked" })),
    ).toBe(false);
    expect(
      canAssignAccession(accession, makeBench({ id: 2, status: "quarantine" })),
    ).toBe(false);
  });

  it("可用台架和已分配但有空位的台架都可继续分配", () => {
    expect(
      canAssignAccession(accession, makeBench({ id: 1, status: "available" })),
    ).toBe(true);
    expect(
      canAssignAccession(
        accession,
        makeBench({ id: 2, status: "assigned", assignedIds: ["other-acc"], capacity: 4 }),
      ),
    ).toBe(true);
  });
});

describe("台架分配 - 同台面重复", () => {
  it("同一材料重复分配到同一台架时拒绝", () => {
    const accession = makeAccession({ id: 1 });
    const bench = makeBench({
      id: 1,
      capacity: 4,
      assignedIds: [accession.id],
      status: "assigned",
    });
    const failure = expectFailure(validateBenchAssignment(accession, bench));
    expect(findError(failure, "benchId")?.code).toBe("duplicate");
  });
});

describe("台架分配 - 移出", () => {
  const accession = makeAccession({ id: 1 });

  it("移出未分配在该台架的材料时返回 not_assigned", () => {
    const failure = expectFailure(releaseAccession(accession.id, makeBench({ id: 1 })));
    expect(errorCodes(failure)).toContain("not_assigned");
  });

  it("移出最后一个材料后台架恢复可用，且不影响其他材料", () => {
    const other = makeAccession({ id: 2 });
    const bench = makeBench({
      id: 1,
      capacity: 4,
      assignedIds: [accession.id, other.id],
      status: "assigned",
    });
    const first = releaseAccession(accession.id, bench);
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.assignedIds).toEqual([other.id]);
      expect(first.value.status).toBe("assigned");
    }
    const second = releaseAccession(other.id, first.ok ? first.value : bench);
    expect(second.ok).toBe(true);
    if (second.ok) {
      expect(second.value.assignedIds).toEqual([]);
      expect(second.value.status).toBe("available");
    }
  });
});

describe("台架光照修改", () => {
  it("台架上有材料时不能修改光照类型", () => {
    const bench = makeBench({ id: 1, assignedIds: ["acc-1"], status: "assigned" });
    const failure = expectFailure(updateBenchLight(bench, "shade"));
    expect(findError(failure, "lightProfile")?.code).toBe("assigned");
  });

  it("空台架允许修改光照类型", () => {
    const result = updateBenchLight(makeBench({ id: 1 }), "shade");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.lightProfile).toBe("shade");
    }
  });
});

describe("台架分配 - 业务不变量：同一材料不得同时位于多个台架", () => {
  /**
   * Mirror the public workflow used by LayoutPage: look up the current
   * entities, call assignAccession, and fold the result through the reducer.
   * Returns the raw result so callers can assert acceptance or rejection.
   */
  function runAssign(
    state: WorkspaceState,
    accessionId: string,
    benchId: string,
  ): { ok: boolean; code?: string; state: WorkspaceState } {
    const accession = state.accessions.find((item) => item.id === accessionId);
    const bench = state.benches.find((item) => item.id === benchId);
    if (!accession || !bench) {
      throw new Error("fixture missing accession or bench");
    }
    const result = assignAccession(accession, bench);
    if (!result.ok) {
      return { ok: false, code: result.errors[0]?.code, state };
    }
    return {
      ok: true,
      state: workspaceReducer(state, {
        type: "bench/assigned",
        bench: result.value,
      }),
    };
  }

  it("材料已在其他台架时，再分配到第二个台架必须被拒绝", () => {
    const { state, accessions, benches } = makeTrialWorkspace();
    const [accession] = accessions;
    const [sunBench, shadeBench] = benches;

    // First placement succeeds.
    const first = runAssign(state, accession.id, sunBench.id);
    expect(first.ok).toBe(true);

    // The second bench is empty, has capacity, and accepts full-sun
    // material (partial-shade bench). The only rule that should stop this
    // assignment is the single-placement business invariant.
    const second = runAssign(first.state, accession.id, shadeBench.id);
    expect(second.ok).toBe(false);
    expect(second.code).toBe("duplicate");

    const benchesHoldingAccession = second.state.benches.filter((bench) =>
      bench.assignedIds.includes(accession.id),
    );
    expect(benchesHoldingAccession).toHaveLength(1);
  });

  it("先移出再分配到新台架是允许的，且材料最终只在新台架上", () => {
    const { state: initial, accessions, benches } = makeTrialWorkspace();
    const [accession, secondAccession] = accessions;
    const [sunBench, shadeBench] = benches;

    let state = runAssign(initial, accession.id, sunBench.id).state;
    state = runAssign(state, secondAccession.id, shadeBench.id).state;

    // Release from the first bench, then place on the second bench.
    const firstBenchNow = state.benches.find((bench) => bench.id === sunBench.id)!;
    const released = releaseAccession(accession.id, firstBenchNow);
    expect(released.ok).toBe(true);
    if (released.ok) {
      state = workspaceReducer(state, {
        type: "bench/released",
        bench: released.value,
      });
    }

    const moved = runAssign(state, accession.id, shadeBench.id);
    expect(moved.ok).toBe(true);

    const benchesHoldingAccession = moved.state.benches.filter((bench) =>
      bench.assignedIds.includes(accession.id),
    );
    expect(benchesHoldingAccession).toHaveLength(1);
    expect(benchesHoldingAccession[0]?.id).toBe(shadeBench.id);
    expect(
      moved.state.benches.find((bench) => bench.id === sunBench.id)?.assignedIds,
    ).toEqual([]);
  });
});
