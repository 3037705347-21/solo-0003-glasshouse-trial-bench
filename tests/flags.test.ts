import { describe, expect, it } from "vitest";
import {
  deriveFlags,
  latestObservationForAccession,
  transitionFlag,
} from "../src/domain/observation";
import type { Flag, ObservationPass } from "../src/domain/types";
import {
  expectFailure,
  findError,
  makeAccession,
  makeEntry,
  makePass,
} from "./helpers";

function flagsFor(values: {
  heightMm: number;
  leafCount: number;
  ecMs: number;
}): Flag[] {
  const accession = makeAccession({ id: 1, cultivar: "Tiny Tim" });
  const pass = makePass({
    id: 1,
    entries: [
      makeEntry({
        accessionId: accession.id,
        heightMm: values.heightMm,
        leafCount: values.leafCount,
        ecMs: values.ecMs,
      }),
    ],
  });
  return deriveFlags(pass, [accession]);
}

function codes(flags: Flag[]): string[] {
  return flags.map((flag) => flag.code);
}

describe("生长标记派生 - 株高阈值", () => {
  it("株高低于 60 毫米派生 HT_UNDER 警告，边界值 59 触发", () => {
    const flags = flagsFor({ heightMm: 59, leafCount: 8, ecMs: 1.8 });
    expect(codes(flags)).toEqual(["HT_UNDER"]);
    expect(flags[0]?.severity).toBe("warning");
    expect(flags[0]?.state).toBe("open");
  });

  it("株高恰好为 60 毫米不派生偏矮标记", () => {
    expect(codes(flagsFor({ heightMm: 60, leafCount: 8, ecMs: 1.8 }))).toEqual([]);
  });

  it("株高达到或超过 420 毫米派生 HT_OVER 严重标记", () => {
    expect(codes(flagsFor({ heightMm: 420, leafCount: 8, ecMs: 1.8 }))).toEqual([
      "HT_OVER",
    ]);
    expect(flagsFor({ heightMm: 500, leafCount: 8, ecMs: 1.8 })[0]?.severity).toBe(
      "critical",
    );
  });

  it("株高 419 毫米不派生超高标记", () => {
    expect(codes(flagsFor({ heightMm: 419, leafCount: 8, ecMs: 1.8 }))).toEqual([]);
  });
});

describe("生长标记派生 - 叶片数阈值", () => {
  it("真叶数少于 5 片派生 LEAF_LOW 警告", () => {
    expect(codes(flagsFor({ heightMm: 100, leafCount: 4, ecMs: 1.8 }))).toEqual([
      "LEAF_LOW",
    ]);
  });

  it("真叶数恰好 5 片不派生叶片标记", () => {
    expect(codes(flagsFor({ heightMm: 100, leafCount: 5, ecMs: 1.8 }))).toEqual([]);
  });
});

describe("生长标记派生 - 电导率阈值", () => {
  it("电导率达到 3.5 mS/cm 派生 EC_HIGH 严重标记", () => {
    const flags = flagsFor({ heightMm: 100, leafCount: 8, ecMs: 3.5 });
    expect(codes(flags)).toEqual(["EC_HIGH"]);
    expect(flags[0]?.severity).toBe("critical");
  });

  it("电导率 3.4 mS/cm 不派生电导率标记", () => {
    expect(codes(flagsFor({ heightMm: 100, leafCount: 8, ecMs: 3.4 }))).toEqual([]);
  });
});

describe("生长标记派生 - 组合行为", () => {
  it("健康测量不派生任何标记", () => {
    expect(codes(flagsFor({ heightMm: 200, leafCount: 12, ecMs: 2.0 }))).toEqual([]);
  });

  it("同一条记录可以同时派生多个标记", () => {
    const flags = flagsFor({ heightMm: 30, leafCount: 3, ecMs: 4.0 });
    expect(codes(flags).sort()).toEqual(
      ["EC_HIGH", "HT_UNDER", "LEAF_LOW"].sort(),
    );
  });

  it("多条记录各自派生标记，并引用正确的观测次和材料", () => {
    const short = makeAccession({ id: 1, cultivar: "Short One" });
    const tall = makeAccession({ id: 2, cultivar: "Tall One" });
    const pass = makePass({
      id: 1,
      trialId: "trl-1",
      entries: [
        makeEntry({ accessionId: short.id, heightMm: 40, leafCount: 8, ecMs: 1.8 }),
        makeEntry({ accessionId: tall.id, heightMm: 500, leafCount: 10, ecMs: 1.8 }),
      ],
    });
    const flags = deriveFlags(pass, [short, tall]);
    expect(codes(flags)).toEqual(["HT_UNDER", "HT_OVER"]);
    expect(flags[0]?.accessionId).toBe(short.id);
    expect(flags[1]?.accessionId).toBe(tall.id);
    expect(flags.every((flag) => flag.observationPassId === pass.id)).toBe(true);
    expect(flags.every((flag) => flag.trialId === "trl-1")).toBe(true);
  });

  it("引用未知材料的记录被跳过而不是抛错", () => {
    const pass = makePass({
      entries: [makeEntry({ accessionId: "acc-ghost", heightMm: 10 })],
    });
    expect(deriveFlags(pass, [])).toEqual([]);
  });

  it("所有新派生标记都以 open 状态开始并带创建时间", () => {
    const flags = flagsFor({ heightMm: 10, leafCount: 0, ecMs: 9 });
    expect(flags.length).toBeGreaterThan(0);
    for (const flag of flags) {
      expect(flag.state).toBe("open");
      expect(flag.resolutionNote).toBeUndefined();
      expect(flag.resolvedOn).toBeUndefined();
      expect(flag.createdOn).toBeTruthy();
    }
  });
});

function makeFlag(overrides: Partial<Flag> = {}): Flag {
  return {
    id: "flg-1",
    trialId: "trl-1",
    accessionId: "acc-1",
    observationPassId: "obs-1",
    code: "HT_UNDER",
    message: "测试标记",
    severity: "warning",
    state: "open",
    createdOn: "2026-03-10T08:00:00.000Z",
    ...overrides,
  };
}

describe("标记处理 - 说明要求与生命周期", () => {
  it("没有处理说明不能解决标记", () => {
    const failure = expectFailure(transitionFlag(makeFlag(), "resolved", ""));
    expect(findError(failure, "resolutionNote")?.code).toBe("too_short");
  });

  it("处理说明少于 8 个字符不能解决或豁免", () => {
    const shortNote = "已浇水";
    const resolvedFailure = expectFailure(
      transitionFlag(makeFlag(), "resolved", shortNote),
    );
    expect(findError(resolvedFailure, "resolutionNote")?.code).toBe("too_short");
    const waivedFailure = expectFailure(
      transitionFlag(makeFlag(), "waived", shortNote),
    );
    expect(findError(waivedFailure, "resolutionNote")?.code).toBe("too_short");
  });

  it("恰好 8 个字符的说明允许解决标记", () => {
    const result = transitionFlag(makeFlag(), "resolved", "12345678");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.state).toBe("resolved");
      expect(result.value.resolutionNote).toBe("12345678");
      expect(result.value.resolvedOn).toBeTruthy();
    }
  });

  it("提供充分说明可以豁免标记", () => {
    const result = transitionFlag(
      makeFlag(),
      "waived",
      "品种遗传特性，经负责人确认豁免",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.state).toBe("waived");
      expect(result.value.resolutionNote).toBe("品种遗传特性，经负责人确认豁免");
    }
  });

  it("说明两端空白会被裁剪，纯空白说明被拒绝", () => {
    const failure = expectFailure(transitionFlag(makeFlag(), "resolved", "        "));
    expect(findError(failure, "resolutionNote")?.code).toBe("too_short");
  });

  it("已解决的标记不能再次处理", () => {
    const resolved = makeFlag({ state: "resolved" });
    const failure = expectFailure(
      transitionFlag(resolved, "waived", "再次尝试处理该标记"),
    );
    expect(findError(failure, "state")?.code).toBe("not_open");
  });

  it("已豁免的标记不能改为解决", () => {
    const waived = makeFlag({ state: "waived" });
    const failure = expectFailure(
      transitionFlag(waived, "resolved", "尝试重新处理该标记"),
    );
    expect(findError(failure, "state")?.code).toBe("not_open");
  });
});

describe("最近观测查询", () => {
  it("按观测日期返回材料最近一次测量，即使观测次录入顺序相反", () => {
    const passes: ObservationPass[] = [
      makePass({
        id: 2,
        observedOn: "2026-03-20",
        entries: [makeEntry({ accessionId: "acc-1", heightMm: 200 })],
      }),
      makePass({
        id: 1,
        observedOn: "2026-03-10",
        entries: [makeEntry({ accessionId: "acc-1", heightMm: 100 })],
      }),
    ];
    const latest = latestObservationForAccession(passes, "acc-1");
    expect(latest?.heightMm).toBe(200);
  });

  it("没有任何观测时返回 undefined", () => {
    expect(latestObservationForAccession([], "acc-1")).toBeUndefined();
  });
});
