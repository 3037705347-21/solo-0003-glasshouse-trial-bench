import { describe, expect, it } from "vitest";
import {
  canTransitionTrial,
  createTrial,
  transitionTrial,
  validateTrialDraft,
} from "../src/domain/trial";
import {
  errorCodes,
  expectFailure,
  findError,
  makeTrial,
} from "./helpers";

describe("试验状态转换", () => {
  it("显式转换表规定的合法转换全部允许", () => {
    expect(canTransitionTrial("draft", "active")).toBe(true);
    expect(canTransitionTrial("active", "paused")).toBe(true);
    expect(canTransitionTrial("active", "cleared")).toBe(true);
    expect(canTransitionTrial("paused", "active")).toBe(true);
  });

  it("转换表之外的跳转全部拒绝", () => {
    expect(canTransitionTrial("draft", "paused")).toBe(false);
    expect(canTransitionTrial("draft", "cleared")).toBe(false);
    expect(canTransitionTrial("paused", "cleared")).toBe(false);
    expect(canTransitionTrial("paused", "draft")).toBe(false);
    expect(canTransitionTrial("cleared", "active")).toBe(false);
    expect(canTransitionTrial("cleared", "paused")).toBe(false);
  });

  it("已放行是终态，不能再转到任何其他状态", () => {
    const trial = makeTrial({ id: 1, state: "cleared" });
    for (const target of ["draft", "active", "paused"] as const) {
      const failure = expectFailure(transitionTrial(trial, target));
      expect(findError(failure, "state")?.code).toBe("invalid_transition");
    }
  });

  it("暂停试验不能直接放行", () => {
    const failure = expectFailure(
      transitionTrial(makeTrial({ id: 1, state: "paused" }), "cleared"),
    );
    expect(findError(failure, "state")?.code).toBe("invalid_transition");
  });

  it("转换到当前状态返回 unchanged 错误", () => {
    const failure = expectFailure(
      transitionTrial(makeTrial({ id: 1, state: "active" }), "active"),
    );
    expect(findError(failure, "state")?.code).toBe("unchanged");
  });

  it("合法转换返回带新状态的试验对象", () => {
    const draft = makeTrial({ id: 1, state: "draft" });
    const result = transitionTrial(draft, "active");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.state).toBe("active");
      expect(result.value.id).toBe(draft.id);
    }
  });

  it("暂停后可以恢复为进行中", () => {
    const result = transitionTrial(
      makeTrial({ id: 1, state: "paused" }),
      "active",
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.state).toBe("active");
    }
  });
});

describe("试验草稿校验", () => {
  const validDraft = {
    code: "AUR-04",
    cropFamily: "茄科作物",
    objective: "比较紧凑型番茄品种的早期坐果表现。",
    season: "春季",
    startDate: "2026-02-16",
    endDate: "2026-05-18",
  };

  it("合法草稿通过校验并生成状态为草稿的试验", () => {
    const result = createTrial(validDraft);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.state).toBe("draft");
      expect(result.value.code).toBe("AUR-04");
    }
  });

  it.each(["A-1", "AURUM-01", "aur-04", "TOOLONG", "123-01", "", "AUR04"])(
    "拒绝格式错误的编号 %j",
    (code) => {
      const failure = expectFailure(validateTrialDraft({ ...validDraft, code }));
      expect(findError(failure, "code")?.code).toBe("invalid_code");
    },
  );

  it("作物科属过短时拒绝", () => {
    const failure = expectFailure(
      validateTrialDraft({ ...validDraft, cropFamily: "茄" }),
    );
    expect(findError(failure, "cropFamily")?.code).toBe("required");
  });

  it("试验目标少于 12 个字符时拒绝", () => {
    const failure = expectFailure(
      validateTrialDraft({ ...validDraft, objective: "太短的目标" }),
    );
    expect(findError(failure, "objective")?.code).toBe("too_short");
  });

  it("未选择季节时拒绝", () => {
    const failure = expectFailure(
      validateTrialDraft({ ...validDraft, season: "" }),
    );
    expect(findError(failure, "season")?.code).toBe("required");
  });

  it("开始日期无效时拒绝", () => {
    const failure = expectFailure(
      validateTrialDraft({ ...validDraft, startDate: "2026-02-30" }),
    );
    expect(findError(failure, "startDate")).toBeDefined();
  });

  it("结束日期无效时拒绝", () => {
    const failure = expectFailure(
      validateTrialDraft({ ...validDraft, endDate: "not-a-date" }),
    );
    expect(findError(failure, "endDate")?.code).toBe("invalid_date");
  });

  it("结束日期早于开始日期时拒绝", () => {
    const failure = expectFailure(
      validateTrialDraft({
        ...validDraft,
        startDate: "2026-05-18",
        endDate: "2026-02-16",
      }),
    );
    expect(findError(failure, "endDate")?.code).toBe("date_sequence");
  });

  it("开始日期与结束日期相同是允许的", () => {
    const result = validateTrialDraft({
      ...validDraft,
      startDate: "2026-05-18",
      endDate: "2026-05-18",
    });
    expect(result.ok).toBe(true);
  });

  it("多个字段错误会同时返回", () => {
    const failure = expectFailure(
      validateTrialDraft({
        ...validDraft,
        code: "bad",
        cropFamily: "",
        objective: "",
        season: "",
      }),
    );
    expect(errorCodes(failure)).toEqual(
      expect.arrayContaining([
        "invalid_code",
        "required",
        "too_short",
      ]),
    );
  });
});
