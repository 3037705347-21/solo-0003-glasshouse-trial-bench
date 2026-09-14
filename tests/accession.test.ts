import { describe, expect, it } from "vitest";
import {
  createAccession,
  nextAccessionNumber,
  updateAccession,
  validateAccessionDraft,
} from "../src/domain/accession";
import type { WorkspaceState } from "../src/domain/types";
import {
  errorCodes,
  errorFields,
  expectFailure,
  findError,
  makeAccession,
  makeState,
  makeTrial,
  validAccessionDraft,
} from "./helpers";

function stateWithTrial(): WorkspaceState {
  return makeState({ trials: [makeTrial({ id: 1, state: "active" })] });
}

describe("材料登记校验 - 编号格式", () => {
  it("接受符合 ACC-#### 规范的四位编号", () => {
    const state = stateWithTrial();
    const result = validateAccessionDraft(
      validAccessionDraft({ accessionNo: "ACC-1234" }),
      state,
    );
    expect(result.ok).toBe(true);
  });

  it("接受四位以上数字编号", () => {
    const state = stateWithTrial();
    const result = validateAccessionDraft(
      validAccessionDraft({ accessionNo: "ACC-12345" }),
      state,
    );
    expect(result.ok).toBe(true);
  });

  it.each([
    "ACC-123",
    "acc-0001",
    "ACC1234",
    "ACC-001",
    "ACC-000A",
    "XXX-0001",
    "",
    "   ",
  ])(
    "拒绝格式错误的编号 %j",
    (accessionNo) => {
      const failure = expectFailure(
        validateAccessionDraft(validAccessionDraft({ accessionNo }), stateWithTrial()),
      );
      const error = findError(failure, "accessionNo");
      expect(error?.code).toBe("invalid_format");
    },
  );

  it("编号两端空白会被裁剪，因此带空白的合法编号通过校验并规范化", () => {
    const result = validateAccessionDraft(
      validAccessionDraft({ accessionNo: "  ACC-0001  " }),
      stateWithTrial(),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.accessionNo).toBe("ACC-0001");
    }
  });
});

describe("材料登记校验 - 编号重复", () => {
  it("拒绝与现有材料重复的编号", () => {
    const state = makeState({
      trials: [makeTrial({ id: 1 })],
      accessions: [
        makeAccession({ id: 1, trialId: "trl-1", accessionNo: "ACC-0001" }),
      ],
    });
    const failure = expectFailure(
      validateAccessionDraft(validAccessionDraft({ accessionNo: "ACC-0001" }), state),
    );
    expect(findError(failure, "accessionNo")?.code).toBe("duplicate");
  });

  it("编辑材料时允许保留自己原有的编号", () => {
    const existing = makeAccession({ id: 1, trialId: "trl-1", accessionNo: "ACC-0001" });
    const state = makeState({
      trials: [makeTrial({ id: 1 })],
      accessions: [existing],
    });
    const result = updateAccession(
      existing,
      validAccessionDraft({ accessionNo: "ACC-0001", cultivar: "Renamed Cultivar" }),
      state,
    );
    expect(result.ok).toBe(true);
  });

  it("编辑材料时不能占用其他材料的编号", () => {
    const mine = makeAccession({ id: 1, trialId: "trl-1", accessionNo: "ACC-0001" });
    const state = makeState({
      trials: [makeTrial({ id: 1 })],
      accessions: [
        mine,
        makeAccession({ id: 2, trialId: "trl-1", accessionNo: "ACC-0002" }),
      ],
    });
    const failure = expectFailure(
      updateAccession(mine, validAccessionDraft({ accessionNo: "ACC-0002" }), state),
    );
    expect(findError(failure, "accessionNo")?.code).toBe("duplicate");
  });

  it("编号在全局唯一，即使属于其他试验也不能重复", () => {
    const otherTrial = makeTrial({ id: 9, code: "OTH-09" });
    const state = makeState({
      trials: [makeTrial({ id: 1 }), otherTrial],
      accessions: [
        makeAccession({
          id: 1,
          trialId: otherTrial.id,
          accessionNo: "ACC-0001",
        }),
      ],
    });
    const failure = expectFailure(
      validateAccessionDraft(validAccessionDraft({ accessionNo: "ACC-0001" }), state),
    );
    expect(findError(failure, "accessionNo")?.code).toBe("duplicate");
  });
});

describe("材料登记校验 - 品种与来源必填", () => {
  it("品种少于 2 个字符时拒绝", () => {
    const failure = expectFailure(
      validateAccessionDraft(validAccessionDraft({ cultivar: "A" }), stateWithTrial()),
    );
    expect(findError(failure, "cultivar")?.code).toBe("required");
  });

  it("品种为空白时拒绝", () => {
    const failure = expectFailure(
      validateAccessionDraft(validAccessionDraft({ cultivar: "   " }), stateWithTrial()),
    );
    expect(findError(failure, "cultivar")?.code).toBe("required");
  });

  it("来源少于 3 个字符时拒绝", () => {
    const failure = expectFailure(
      validateAccessionDraft(validAccessionDraft({ source: "AB" }), stateWithTrial()),
    );
    expect(findError(failure, "source")?.code).toBe("required");
  });

  it("来源为空白时拒绝", () => {
    const failure = expectFailure(
      validateAccessionDraft(validAccessionDraft({ source: "  " }), stateWithTrial()),
    );
    expect(findError(failure, "source")?.code).toBe("required");
  });
});

describe("材料登记校验 - 繁殖日期", () => {
  it.each(["2026-03-05", "1999-12-31"])(
    "接受合法日期 %s",
    (propagatedOn) => {
      const result = validateAccessionDraft(
        validAccessionDraft({ propagatedOn }),
        stateWithTrial(),
      );
      expect(result.ok).toBe(true);
    },
  );

  it.each(["", "2026-3-5", "2026/03/05", "03-05-2026", "not-a-date"])(
    "拒绝格式错误的日期 %j",
    (propagatedOn) => {
      const failure = expectFailure(
        validateAccessionDraft(validAccessionDraft({ propagatedOn }), stateWithTrial()),
      );
      expect(findError(failure, "propagatedOn")?.code).toBe("invalid_date");
    },
  );

  it("拒绝不存在的日历日期（2026 年非闰年的 2 月 29 日）", () => {
    const failure = expectFailure(
      validateAccessionDraft(
        validAccessionDraft({ propagatedOn: "2026-02-29" }),
        stateWithTrial(),
      ),
    );
    expect(findError(failure, "propagatedOn")?.code).toBe("invalid_date");
  });
});

describe("材料登记校验 - 数量", () => {
  it.each([1, 500, 250])(
    "接受边界内数量 %i",
    (quantity) => {
      const result = validateAccessionDraft(
        validAccessionDraft({ quantity }),
        stateWithTrial(),
      );
      expect(result.ok).toBe(true);
    },
  );

  it.each([0, -1, 501, 1000])(
    "拒绝范围外数量 %i",
    (quantity) => {
      const failure = expectFailure(
        validateAccessionDraft(validAccessionDraft({ quantity }), stateWithTrial()),
      );
      expect(findError(failure, "quantity")?.code).toBe("range");
    },
  );

  it("拒绝非数字数量", () => {
    const failure = expectFailure(
      validateAccessionDraft(
        validAccessionDraft({ quantity: Number.NaN }),
        stateWithTrial(),
      ),
    );
    expect(findError(failure, "quantity")?.code).toBe("range");
  });
});

describe("材料登记校验 - 穴盘规格", () => {
  it.each([32, 50, 72, 104, 128, 200, 288])("接受支持的穴盘规格 %i", (trayCells) => {
    const result = validateAccessionDraft(
      validAccessionDraft({ trayCells }),
      stateWithTrial(),
    );
    expect(result.ok).toBe(true);
  });

  it.each([0, 31, 64, 120, 300])(
    "拒绝不支持的穴盘规格 %i",
    (trayCells) => {
      const failure = expectFailure(
        validateAccessionDraft(validAccessionDraft({ trayCells }), stateWithTrial()),
      );
      expect(findError(failure, "trayCells")?.code).toBe("invalid");
    },
  );
});

describe("材料登记校验 - 其他字段与聚合行为", () => {
  it("基因型说明少于 10 个字符时拒绝", () => {
    const failure = expectFailure(
      validateAccessionDraft(
        validAccessionDraft({ genotypeNote: "太短" }),
        stateWithTrial(),
      ),
    );
    expect(findError(failure, "genotypeNote")?.code).toBe("too_short");
  });

  it("未知试验被拒绝", () => {
    const failure = expectFailure(
      validateAccessionDraft(
        validAccessionDraft({ trialId: "trl-missing" }),
        makeState({ trials: [] }),
      ),
    );
    expect(findError(failure, "trialId")?.code).toBe("unknown");
  });

  it("光照类型不在允许集合内时拒绝", () => {
    const failure = expectFailure(
      validateAccessionDraft(
        // @ts-expect-error 故意构造无效枚举值
        validAccessionDraft({ preferredLight: "moonlight" }),
        stateWithTrial(),
      ),
    );
    expect(findError(failure, "preferredLight")?.code).toBe("invalid");
  });

  it("一次提交会返回所有非法字段，而不是只返回第一个错误", () => {
    const failure = expectFailure(
      validateAccessionDraft(
        validAccessionDraft({
          accessionNo: "BAD",
          cultivar: "A",
          source: "",
          propagatedOn: "nope",
          quantity: 0,
          trayCells: 64,
        }),
        stateWithTrial(),
      ),
    );
    expect(errorFields(failure).sort()).toEqual(
      [
        "accessionNo",
        "cultivar",
        "source",
        "propagatedOn",
        "quantity",
        "trayCells",
      ].sort(),
    );
  });

  it("通过校验时会裁剪文本并规范标签", () => {
    const result = validateAccessionDraft(
      validAccessionDraft({
        accessionNo: "  ACC-0010  ",
        cultivar: "  Space Cultivar  ",
        labels: [" Tall ", "tall", "EARLY", ""],
      }),
      stateWithTrial(),
    );
    if (!result.ok) {
      throw new Error("draft should be valid");
    }
    expect(result.value.accessionNo).toBe("ACC-0010");
    expect(result.value.cultivar).toBe("Space Cultivar");
    expect(result.value.labels).toEqual(["early", "tall"]);
  });
});

describe("材料创建与编号建议", () => {
  it("createAccession 为通过校验的草稿生成材料实体", () => {
    const result = createAccession(validAccessionDraft(), stateWithTrial());
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.id).toBeTruthy();
      expect(result.value.accessionNo).toBe("ACC-0001");
      expect(result.value.labels).toEqual([]);
    }
  });

  it("createAccession 在校验失败时直接返回错误", () => {
    const failure = expectFailure(
      createAccession(validAccessionDraft({ accessionNo: "BAD" }), stateWithTrial()),
    );
    expect(errorCodes(failure)).toContain("invalid_format");
  });

  it("nextAccessionNumber 基于现有最大序号递增", () => {
    const state = makeState({
      accessions: [
        makeAccession({ id: 1, accessionNo: "ACC-0007" }),
        makeAccession({ id: 2, accessionNo: "ACC-0009" }),
        makeAccession({ id: 3, accessionNo: "NO-MATCH" }),
      ],
    });
    expect(nextAccessionNumber(state)).toBe("ACC-0010");
  });

  it("空工作区从 ACC-0001 开始建议编号", () => {
    expect(nextAccessionNumber(makeState())).toBe("ACC-0001");
  });
});
