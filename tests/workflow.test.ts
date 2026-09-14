import { describe, expect, it } from "vitest";
import { workspaceReducer } from "../src/state/reducer";
import { createAccession } from "../src/domain/accession";
import { assignAccession } from "../src/domain/bench";
import {
  buildClearanceSnapshot,
  applyClearance,
} from "../src/domain/clearance";
import {
  createObservationPass,
  deriveFlags,
  transitionFlag,
} from "../src/domain/observation";
import { transitionTrial } from "../src/domain/trial";
import { todayDateOnly } from "../src/domain/rules";
import {
  expectFailure,
  makeBench,
  makeState,
  makeTrial,
  validAccessionDraft,
  validObservationDraft,
  makeEntry,
} from "./helpers";

/**
 * Drives the same sequence of public domain calls the UI uses, folding every
 * accepted change through the workspace reducer. This verifies the modules
 * compose into the documented workflow without copying internal logic.
 */
describe("端到端工作流 - 从草稿到放行", () => {
  it("完成 创建材料 → 分配台架 → 记录观测并处理标记 → 放行 的完整流程", () => {
    // --- A trial starts as draft and is activated ---
    let trial = makeTrial({ id: 1, state: "draft" });
    let state = makeState({ trials: [trial] });

    const activated = transitionTrial(trial, "active");
    expect(activated.ok).toBe(true);
    trial = activated.ok ? activated.value : trial;
    state = workspaceReducer(state, {
      type: "trial/transitioned",
      trialId: trial.id,
      state: trial.state,
    });

    // --- Two accessions are created through the public validator ---
    const first = createAccession(
      validAccessionDraft({ accessionNo: "ACC-0001", preferredLight: "full-sun" }),
      state,
    );
    expect(first.ok).toBe(true);
    if (!first.ok) {
      throw new Error("first accession must be created");
    }
    state = workspaceReducer(state, {
      type: "accession/created",
      accession: first.value,
    });

    const second = createAccession(
      validAccessionDraft({ accessionNo: "ACC-0002", preferredLight: "partial-shade" }),
      state,
    );
    expect(second.ok).toBe(true);
    if (!second.ok) {
      throw new Error("second accession must be created");
    }
    state = workspaceReducer(state, {
      type: "accession/created",
      accession: second.value,
    });

    // --- Benches exist; each accession is placed on a compatible bench ---
    const sunBench = makeBench({
      id: 1,
      code: "S-1",
      lightProfile: "full-sun",
      capacity: 4,
    });
    const shadeBench = makeBench({
      id: 2,
      code: "H-1",
      lightProfile: "partial-shade",
      capacity: 4,
    });
    state = { ...state, benches: [sunBench, shadeBench] };

    const placeOne = assignAccession(
      state.accessions[0]!,
      state.benches[0]!,
    );
    expect(placeOne.ok).toBe(true);
    if (placeOne.ok) {
      state = workspaceReducer(state, {
        type: "bench/assigned",
        bench: placeOne.value,
      });
    }
    const placeTwo = assignAccession(
      state.accessions[1]!,
      state.benches[1]!,
    );
    expect(placeTwo.ok).toBe(true);
    if (placeTwo.ok) {
      state = workspaceReducer(state, {
        type: "bench/assigned",
        bench: placeTwo.value,
      });
    }

    // Business invariant: every accession appears on at most one bench.
    for (const accession of state.accessions) {
      const placements = state.benches.filter((bench) =>
        bench.assignedIds.includes(accession.id),
      );
      expect(placements).toHaveLength(1);
    }

    // --- An observation pass with one under-height measurement is recorded ---
    const draft = validObservationDraft({
      trialId: trial.id,
      observedOn: todayDateOnly(),
      observer: "A. Linden",
      entries: [
        makeEntry({
          accessionId: first.value.id,
          heightMm: 40,
          leafCount: 7,
          ecMs: 1.8,
        }),
        makeEntry({
          accessionId: second.value.id,
          heightMm: 120,
          leafCount: 9,
          ecMs: 2.0,
        }),
      ],
    });
    const passResult = createObservationPass(draft, state);
    expect(passResult.ok).toBe(true);
    if (!passResult.ok) {
      throw new Error("observation pass must be accepted");
    }
    const flags = deriveFlags(passResult.value, state.accessions);
    state = workspaceReducer(state, {
      type: "observation/recorded",
      pass: passResult.value,
      flags,
    });
    expect(state.flags).toHaveLength(1);
    expect(state.flags[0]?.code).toBe("HT_UNDER");

    // --- Clearance is blocked while the flag is open ---
    const blockedSnapshot = buildClearanceSnapshot(state, trial.id);
    expect(blockedSnapshot.status).toBe("blocked");
    expect(blockedSnapshot.blockers.map((b) => b.code)).toContain(
      "FLAG_HT_UNDER",
    );
    const blockedTrials = applyClearance(state, blockedSnapshot);
    expect(
      blockedTrials.find((item) => item.id === trial.id)?.state,
    ).toBe("active");

    // --- The flag requires a resolution note before it can be closed ---
    const openFlag = state.flags[0]!;
    const sloppyClose = transitionFlag(openFlag, "resolved", "已处理");
    expect(sloppyClose.ok).toBe(false);
    expectFailure(sloppyClose);

    const resolved = transitionFlag(
      openFlag,
      "resolved",
      "更换补光灯具后复测恢复正常",
    );
    expect(resolved.ok).toBe(true);
    if (resolved.ok) {
      state = workspaceReducer(state, {
        type: "flag/transitioned",
        flag: resolved.value,
      });
    }

    // --- Clearance is now ready and applying it clears the trial ---
    const readySnapshot = buildClearanceSnapshot(state, trial.id);
    expect(readySnapshot.status).toBe("ready");
    expect(readySnapshot.blockers).toEqual([]);
    expect(readySnapshot.metrics.find((m) => m.label === "材料数")?.value).toBe(2);
    expect(readySnapshot.metrics.find((m) => m.label === "已分配")?.value).toBe(2);
    expect(
      readySnapshot.metrics.find((m) => m.label === "未处理标记")?.value,
    ).toBe(0);

    const clearedTrials = applyClearance(state, readySnapshot);
    state = { ...state, trials: clearedTrials };
    expect(
      state.trials.find((item) => item.id === trial.id)?.state,
    ).toBe("cleared");

    // --- A cleared trial is terminal and accepts no further observations ---
    const afterClose = createObservationPass(
      validObservationDraft({ trialId: trial.id }),
      state,
    );
    expect(afterClose.ok).toBe(false);
  });
});
