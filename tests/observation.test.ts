import { describe, expect, it } from "vitest";
import {
  createObservationPass,
  validateObservationDraft,
} from "../src/domain/observation";
import { todayDateOnly } from "../src/domain/rules";
import type { WorkspaceState } from "../src/domain/types";
import {
  errorCodes,
  expectFailure,
  findError,
  makeAccession,
  makeEntry,
  makeState,
  makeTrial,
  makeTrialWorkspace,
  validObservationDraft,
} from "./helpers";

function activeWorkspace(): WorkspaceState {
  const { state } = makeTrialWorkspace();
  return state;
}

describe("观测录入 - 试验状态", () => {
  it("进行中试验允许录入观测", () => {
    const result = validateObservationDraft(
      validObservationDraft(),
      activeWorkspace(),
    );
    expect(result.ok).toBe(true);
  });

  it.each(["paused", "cleared"] as const)(
    "%s 状态的试验不能录入观测",
    (trialState) => {
      const { state } = makeTrialWorkspace();
      const workspace: WorkspaceState = {
        ...state,
        trials: [makeTrial({ id: 1, state: trialState })],
      };
      const failure = expectFailure(
        validateObservationDraft(validObservationDraft(), workspace),
      );
      expect(findError(failure, "trialId")?.code).toBe("trial_state");
    },
  );

  it("未知试验被拒绝", () => {
    const failure = expectFailure(
      validateObservationDraft(
        validObservationDraft({ trialId: "trl-missing" }),
        activeWorkspace(),
      ),
    );
    expect(findError(failure, "trialId")?.code).toBe("unknown");
  });
});

describe("观测录入 - 观测日期", () => {
  it("接受今天及过去的合法日期", () => {
    const state = activeWorkspace();
    expect(
      validateObservationDraft(
        validObservationDraft({ observedOn: todayDateOnly() }),
        state,
      ).ok,
    ).toBe(true);
    expect(
      validateObservationDraft(
        validObservationDraft({ observedOn: "2020-01-01" }),
        state,
      ).ok,
    ).toBe(true);
  });

  it("拒绝晚于今天的未来日期", () => {
    const failure = expectFailure(
      validateObservationDraft(
        validObservationDraft({ observedOn: "2999-01-01" }),
        activeWorkspace(),
      ),
    );
    expect(findError(failure, "observedOn")?.code).toBe("future");
  });

  it.each(["", "2026/03/10", "03-10-2026", "not-a-date"])(
    "拒绝格式错误的观测日期 %j",
    (observedOn) => {
      const failure = expectFailure(
        validateObservationDraft(validObservationDraft({ observedOn }), activeWorkspace()),
      );
      expect(findError(failure, "observedOn")?.code).toBe("invalid_date");
    },
  );

  it("拒绝不存在的日历日期", () => {
    const failure = expectFailure(
      validateObservationDraft(
        validObservationDraft({ observedOn: "2026-02-30" }),
        activeWorkspace(),
      ),
    );
    expect(findError(failure, "observedOn")).toBeDefined();
  });
});

describe("观测录入 - 观测人", () => {
  it("观测人少于 3 个字符时拒绝", () => {
    const failure = expectFailure(
      validateObservationDraft(
        validObservationDraft({ observer: "AB" }),
        activeWorkspace(),
      ),
    );
    expect(findError(failure, "observer")?.code).toBe("required");
  });

  it("观测人两侧空白会被裁剪后再校验", () => {
    const failure = expectFailure(
      validateObservationDraft(
        validObservationDraft({ observer: "  AB  " }),
        activeWorkspace(),
      ),
    );
    expect(findError(failure, "observer")?.code).toBe("required");
  });
});

describe("观测录入 - 测量记录与材料身份", () => {
  it("没有任何测量记录时拒绝", () => {
    const failure = expectFailure(
      validateObservationDraft(
        validObservationDraft({ entries: [] }),
        activeWorkspace(),
      ),
    );
    expect(findError(failure, "entries")?.code).toBe("empty");
  });

  it("引用不存在的材料时拒绝", () => {
    const failure = expectFailure(
      validateObservationDraft(
        validObservationDraft({
          entries: [makeEntry({ accessionId: "acc-ghost" })],
        }),
        activeWorkspace(),
      ),
    );
    expect(findError(failure, "entries.0.accessionId")?.code).toBe("unknown");
  });

  it("引用其他试验的材料时必须拒绝", () => {
    const otherTrial = makeTrial({ id: 9, code: "OTH-09" });
    const foreign = makeAccession({
      id: 9,
      trialId: otherTrial.id,
      accessionNo: "ACC-9999",
    });
    const state = makeState({
      trials: [makeTrial({ id: 1 }), otherTrial],
      accessions: [makeAccession({ id: 1, trialId: "trl-1" }), foreign],
    });
    const failure = expectFailure(
      validateObservationDraft(
        validObservationDraft({
          trialId: "trl-1",
          entries: [makeEntry({ accessionId: foreign.id })],
        }),
        state,
      ),
    );
    expect(findError(failure, "entries.0.accessionId")).toBeDefined();
  });

  it("单次观测中同一材料出现多行时，第二行标记为 duplicate", () => {
    const { state, accessions } = makeTrialWorkspace();
    const accession = accessions[0]!;
    const failure = expectFailure(
      validateObservationDraft(
        validObservationDraft({
          entries: [
            makeEntry({ accessionId: accession.id }),
            makeEntry({ accessionId: accession.id, heightMm: 120 }),
          ],
        }),
        state,
      ),
    );
    expect(findError(failure, "entries.1.accessionId")?.code).toBe("duplicate");
  });

  it("同一观测可以包含多个不同材料的记录", () => {
    const { state, accessions } = makeTrialWorkspace();
    const result = validateObservationDraft(
      validObservationDraft({
        entries: [
          makeEntry({ accessionId: accessions[0]!.id }),
          makeEntry({ accessionId: accessions[1]!.id }),
        ],
      }),
      state,
    );
    expect(result.ok).toBe(true);
  });
});

describe("观测录入 - 测量边界", () => {
  it.each([1, 800, 400])(
    "株高 %i 毫米在允许范围内",
    (heightMm) => {
      const result = validateObservationDraft(
        validObservationDraft({ entries: [makeEntry({ heightMm })] }),
        activeWorkspace(),
      );
      expect(result.ok).toBe(true);
    },
  );

  it.each([0, -10, 801])(
    "株高 %i 毫米越界时拒绝",
    (heightMm) => {
      const failure = expectFailure(
        validateObservationDraft(
          validObservationDraft({ entries: [makeEntry({ heightMm })] }),
          activeWorkspace(),
        ),
      );
      expect(findError(failure, "entries.0.heightMm")?.code).toBe("range");
    },
  );

  it.each([0, 100, 50])(
    "叶片数 %i 在允许范围内",
    (leafCount) => {
      const result = validateObservationDraft(
        validObservationDraft({ entries: [makeEntry({ leafCount })] }),
        activeWorkspace(),
      );
      expect(result.ok).toBe(true);
    },
  );

  it.each([-1, 101])(
    "叶片数 %i 越界时拒绝",
    (leafCount) => {
      const failure = expectFailure(
        validateObservationDraft(
          validObservationDraft({ entries: [makeEntry({ leafCount })] }),
          activeWorkspace(),
        ),
      );
      expect(findError(failure, "entries.0.leafCount")?.code).toBe("range");
    },
  );

  it.each([0.1, 12, 6.4])(
    "电导率 %f mS/cm 在允许范围内",
    (ecMs) => {
      const result = validateObservationDraft(
        validObservationDraft({ entries: [makeEntry({ ecMs })] }),
        activeWorkspace(),
      );
      expect(result.ok).toBe(true);
    },
  );

  it.each([0.09, 0, -1, 12.1])(
    "电导率 %f mS/cm 越界时拒绝",
    (ecMs) => {
      const failure = expectFailure(
        validateObservationDraft(
          validObservationDraft({ entries: [makeEntry({ ecMs })] }),
          activeWorkspace(),
        ),
      );
      expect(findError(failure, "entries.0.ecMs")?.code).toBe("range");
    },
  );

  it("多个越界字段会分别报错，并带上行号", () => {
    const failure = expectFailure(
      validateObservationDraft(
        validObservationDraft({
          entries: [
            makeEntry({ heightMm: 0 }),
            makeEntry({ accessionId: "acc-2", ecMs: 99 }),
          ],
        }),
        activeWorkspace(),
      ),
    );
    expect(errorCodes(failure)).toEqual(
      expect.arrayContaining(["range", "range"]),
    );
    expect(findError(failure, "entries.0.heightMm")).toBeDefined();
    expect(findError(failure, "entries.1.ecMs")).toBeDefined();
  });
});

describe("观测实体创建", () => {
  it("通过校验的草稿生成观测次实体，条目被复制而不是共享引用", () => {
    const { state, accessions } = makeTrialWorkspace();
    const entry = makeEntry({ accessionId: accessions[0]!.id });
    const result = createObservationPass(
      validObservationDraft({ entries: [entry] }),
      state,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBeTruthy();
      expect(result.value.entries[0]).not.toBe(entry);
      expect(result.value.entries[0]).toEqual(entry);
    }
  });
});
