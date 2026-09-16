import {
  composeAccessionNumber,
  createNumberRule,
  planGeneratedNumbers,
  previewNextNumbers,
  selectNumberRule,
  updateNumberRule,
  countRuleUsage,
  ruleCanDelete,
} from "../src/domain/numbering";
import {
  createAccession,
  updateAccession,
} from "../src/domain/accession";
import {
  planAccessionImport,
  commitAccessionImport,
  rowsFromTsv,
} from "../src/domain/importAccessions";
import {
  planTrialCopy,
  commitTrialCopy,
} from "../src/domain/trialCopy";
import { createSampleWorkspaceState } from "../src/state/sampleData";
import type { NumberRule, WorkspaceState } from "../src/domain/types";

let failures = 0;
function check(label: string, condition: boolean, detail?: unknown) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL: ${label}`, detail ?? "");
  } else {
    console.log(`ok: ${label}`);
  }
}

let state: WorkspaceState = createSampleWorkspaceState();
check("sample state seeds with empty numberRules", Array.isArray(state.numberRules) && state.numberRules.length === 0);

// 1. Create a trial-scoped rule with date + global sequence.
const ruleResult = createNumberRule(
  {
    name: "茄科日序号",
    scopeType: "trial",
    scopeValue: "trial-sol-01",
    prefix: "SOL",
    datePart: "yearMonthDay",
    sequencePadding: 3,
    sequenceScope: "global",
    nextSequence: 1,
    status: "active",
  },
  state,
);
check("create rule ok", ruleResult.ok);
if (!ruleResult.ok) throw new Error("rule creation failed");
const rule = ruleResult.value;
state = { ...state, numberRules: [...state.numberRules, rule] };

// 2. Rule matches by trial; preview shows the rule's pattern.
const matched = selectNumberRule(state, {
  trialId: "trial-sol-01",
  source: "Anything",
  propagatedOn: "2026-09-16",
});
check("rule matched for trial", matched?.id === rule.id);

const preview = previewNextNumbers(
  state,
  { trialId: "trial-sol-01", source: "X", propagatedOn: "2026-09-16" },
  3,
);
check(
  "preview lists three unique numbers",
  preview.items.map((i) => i.accessionNo).join(",") ===
    "SOL-20260916-001,SOL-20260916-002,SOL-20260916-003",
  preview.items,
);
check("preview without rule gives blocked issue", () => {
  const p = previewNextNumbers(
    state,
    { trialId: "trial-ama-02", source: "X", propagatedOn: "2026-09-16" },
    1,
  );
  return p.items.length === 0 && p.issues.some((i) => i.code === "blocked_no_rule");
});

// 3. Simulate creating one accession from the generator; counter bump.
const plan1 = planGeneratedNumbers(state, [
  { trialId: "trial-sol-01", source: "X", propagatedOn: "2026-09-16" },
]);
check("single plan number", plan1.entries[0].accessionNo === "SOL-20260916-001");
check("bumped nextSequence = 2", plan1.bumpedRules[0].nextSequence === 2);

const created = createAccession(
  {
    trialId: "trial-sol-01",
    accessionNo: "SOL-20260916-001",
    numberRuleId: rule.id,
    cultivar: "Stupice",
    source: "Glasshouse Exchange",
    propagatedOn: "2026-09-16",
    quantity: 72,
    trayCells: 104,
    preferredLight: "full-sun",
    genotypeNote: "Compact heirloom line tested here.",
    labels: [],
  },
  state,
);
check("create accession with rule-generated number ok", created.ok);
if (created.ok) {
  state = {
    ...state,
    accessions: [...state.accessions, created.value],
    numberRules: state.numberRules.map((r) =>
      r.id === rule.id ? { ...r, nextSequence: 2 } : r,
    ),
  };
}

// Next preview must continue at 2 (persisted counter) and never reuse 1.
const previewAfter = previewNextNumbers(
  state,
  { trialId: "trial-sol-01", source: "X", propagatedOn: "2026-09-16" },
  1,
);
check(
  "counter advanced after commit",
  previewAfter.items[0]?.accessionNo === "SOL-20260916-002",
  previewAfter.items,
);

// 4. Existing accession number cannot be rewritten on edit.
if (created.ok) {
  const forbidden = updateAccession(
    created.value,
    {
      trialId: created.value.trialId,
      accessionNo: "SOL-20260916-999",
      numberRuleId: created.value.numberRuleId,
      cultivar: created.value.cultivar,
      source: created.value.source,
      propagatedOn: created.value.propagatedOn,
      quantity: created.value.quantity,
      trayCells: created.value.trayCells,
      preferredLight: created.value.preferredLight,
      genotypeNote: created.value.genotypeNote,
      labels: created.value.labels,
    },
    state,
  );
  check("editing an existing number is rejected", !forbidden.ok);
  const same = updateAccession(
    created.value,
    {
      trialId: created.value.trialId,
      accessionNo: created.value.accessionNo,
      numberRuleId: created.value.numberRuleId,
      cultivar: "Stupice II",
      source: created.value.source,
      propagatedOn: created.value.propagatedOn,
      quantity: created.value.quantity,
      trayCells: created.value.trayCells,
      preferredLight: created.value.preferredLight,
      genotypeNote: created.value.genotypeNote,
      labels: created.value.labels,
    },
    state,
  );
  check("keeping the same number still allows other edits", same.ok);
}

// 5. Rule usage blocks deletion; stopping frees the signature but keeps history.
check("rule usage counted", countRuleUsage(state, rule.id) === 1);
check("used rule cannot be deleted", !ruleCanDelete(state, rule));

const stopped = updateNumberRule(
  rule,
  {
    name: rule.name,
    scopeType: rule.scopeType,
    scopeValue: rule.scopeValue,
    prefix: rule.prefix,
    datePart: rule.datePart,
    sequencePadding: rule.sequencePadding,
    sequenceScope: rule.sequenceScope,
    nextSequence: rule.nextSequence,
    status: "inactive",
  },
  state,
);
check("stopping used rule ok", stopped.ok);
if (stopped.ok) {
  state = {
    ...state,
    numberRules: state.numberRules.map((r) =>
      r.id === rule.id ? stopped.value : r,
    ),
  };
}
check(
  "stopped rule no longer matches",
  selectNumberRule(state, {
    trialId: "trial-sol-01",
    source: "X",
    propagatedOn: "2026-09-16",
  }) === undefined,
);
// Reactivating for remaining tests.
state = {
  ...state,
  numberRules: state.numberRules.map((r) =>
    r.id === rule.id ? { ...r, status: "active" } : r,
  ),
};

// 6. Two different sources with identical signature must conflict while both active.
const sourceRule = createNumberRule(
  {
    name: "Pioneer 来源",
    scopeType: "source",
    scopeValue: "Pioneer Seed Lab",
    prefix: "PSL",
    datePart: "yearMonth",
    sequencePadding: 3,
    sequenceScope: "global",
    nextSequence: 1,
    status: "active",
  },
  state,
);
check("first source rule ok", sourceRule.ok);
if (sourceRule.ok) {
  state = { ...state, numberRules: [...state.numberRules, sourceRule.value] };
}
const conflictRule = createNumberRule(
  {
    name: "Other Source",
    scopeType: "source",
    scopeValue: "Other Source Co",
    prefix: "psl",
    datePart: "yearMonth",
    sequencePadding: 3,
    sequenceScope: "global",
    nextSequence: 1,
    status: "active",
  },
  state,
);
check("same-prefix second active rule rejected", !conflictRule.ok);
if (conflictRule.ok) throw new Error("conflict accepted");
check(
  "conflict error mentions prefix collision",
  conflictRule.errors.some((e) => e.code === "conflicting_rule"),
);

// 7. perDate sequence resets by date and bumps counters per date independently.
const perDate = createNumberRule(
  {
    name: "按日序号",
    scopeType: "source",
    scopeValue: "Daily Nursery",
    prefix: "DN",
    datePart: "yearMonthDay",
    sequencePadding: 3,
    sequenceScope: "perDate",
    nextSequence: 1,
    status: "active",
  },
  state,
);
check("perDate rule created", perDate.ok);
if (perDate.ok) {
  state = { ...state, numberRules: [...state.numberRules, perDate.value] };
}
const mixedPlan = planGeneratedNumbers(state, [
  { trialId: "trial-bra-03", source: "Daily Nursery", propagatedOn: "2026-09-16" },
  { trialId: "trial-bra-03", source: "Daily Nursery", propagatedOn: "2026-09-16" },
  { trialId: "trial-bra-03", source: "Daily Nursery", propagatedOn: "2026-09-17" },
]);
check(
  "perDate numbering resets each date",
  mixedPlan.entries.map((e) => e.accessionNo).join(",") ===
    "DN-20260916-001,DN-20260916-002,DN-20260917-001",
  mixedPlan.entries,
);

// 8. Length guard: prefix + date + padding beyond 24 rejected.
const tooLong = createNumberRule(
  {
    name: "超长",
    scopeType: "trial",
    scopeValue: "trial-sol-01",
    prefix: "LONGLONG",
    datePart: "yearMonthDay",
    sequencePadding: 6,
    sequenceScope: "global",
    nextSequence: 1,
    status: "active",
  },
  state,
);
// LONGLONG-20260916-000001 = 21 chars -> allowed. Try larger padding instead.
const tooLong2 = createNumberRule(
  {
    name: "超长",
    scopeType: "trial",
    scopeValue: "trial-sol-01",
    prefix: "LONGLONG",
    datePart: "yearMonthDay",
    sequencePadding: 6,
    sequenceScope: "global",
    nextSequence: 10 ** 6,
    status: "active",
  },
  state,
);
check(
  "21-char pattern accepted",
  tooLong.ok,
);
check(
  "starting sequence at max+1 rejected",
  !tooLong2.ok,
);

// 9. Manual number validation: duplicates and case-insensitive collisions.
const manualDup = createAccession(
  {
    trialId: "trial-sol-01",
    accessionNo: "sol-20260916-001",
    cultivar: "Manual Dup",
    source: "Manual Source Co",
    propagatedOn: "2026-09-16",
    quantity: 10,
    trayCells: 72,
    preferredLight: "full-sun",
    genotypeNote: "Case-insensitive duplicate must be rejected here.",
    labels: [],
  },
  state,
);
check("case-insensitive duplicate manual number rejected", !manualDup.ok);
const manualOk = createAccession(
  {
    trialId: "trial-bra-03",
    accessionNo: "MANUAL-X-01",
    cultivar: "Manual One",
    source: "Manual Source Co",
    propagatedOn: "2026-09-16",
    quantity: 10,
    trayCells: 72,
    preferredLight: "full-sun",
    genotypeNote: "A manually specified number without a rule.",
    labels: [],
  },
  state,
);
check("valid manual number accepted", manualOk.ok);
if (manualOk.ok) {
  state = { ...state, accessions: [...state.accessions, manualOk.value] };
}
const manualLong = createAccession(
  {
    trialId: "trial-sol-01",
    accessionNo: "X".repeat(25),
    cultivar: "Manual Long",
    source: "Manual Source Co",
    propagatedOn: "2026-09-16",
    quantity: 10,
    trayCells: 72,
    preferredLight: "full-sun",
    genotypeNote: "Overlong manual numbers must be rejected outright.",
    labels: [],
  },
  state,
);
check("overlong manual number rejected", !manualLong.ok);

// 10. Import batch: mixed auto/manual, duplicate, no-rule rows and counter advance.
const geRuleResult = createNumberRule(
  {
    name: "交换来源",
    scopeType: "source",
    scopeValue: "Glasshouse Exchange",
    prefix: "GE",
    datePart: "yearMonthDay",
    sequencePadding: 3,
    sequenceScope: "global",
    nextSequence: 1,
    status: "active",
  },
  state,
);
check("GE source rule created", geRuleResult.ok);
if (geRuleResult.ok) {
  state = { ...state, numberRules: [...state.numberRules, geRuleResult.value] };
}

const tsv = [
  ["Auto One", "Glasshouse Exchange", "2026-09-16", "72", "104", "全日照", "自动编号的第一行用于导入预览。", "a,b", ""].join("\t"),
  ["Auto Two", "Glasshouse Exchange", "2026-09-16", "72", "104", "full-sun", "自动编号的第二行用于导入预览。", "", ""].join("\t"),
  ["Manual One", "Manual Source Co", "2026-09-16", "10", "72", "全日照", "手工指定编号的导入行。", "", "MANUAL-X-09"].join("\t"),
  ["No Rule", "Mystery Supplier", "2026-09-16", "10", "72", "全日照", "没有匹配规则且没有手工编号。", "", ""].join("\t"),
  ["Dup Manual", "Manual Source Co", "2026-09-16", "10", "72", "全日照", "与已存在手工编号重复。", "", "MANUAL-X-01"].join("\t"),
  ["Bad", "Bad", "bad-date", "9999", "999", "暮光", "短", "", ""].join("\t"),
].join("\n");
// Import targets the draft brassica trial, which has no trial-scoped rule:
// only source rules (GE) match, so other sources genuinely have no rule.
const importPlan = planAccessionImport(state, "trial-bra-03", rowsFromTsv(tsv));
check("import planned six rows", importPlan.rows.length === 6);
check(
  "auto rows got consecutive numbers",
  importPlan.rows[0].plannedNo === "GE-20260916-001" &&
    importPlan.rows[1].plannedNo === "GE-20260916-002",
  importPlan.rows.map((r) => r.plannedNo),
);
check("manual import row keeps its number", importPlan.rows[2].plannedNo === "MANUAL-X-09");
check("no-rule import row errors", importPlan.rows[3].errors.some((e) => e.code === "blocked_no_rule"));
check("duplicate manual import row errors", importPlan.rows[4].errors.some((e) => e.code === "duplicate"));
check("invalid field import row errors", importPlan.rows[5].errors.length >= 4);
check("three rows valid (two rule-generated, one manual)", importPlan.validRows.length === 3);
const commitWithErrors = commitAccessionImport(state, importPlan);
check("commit blocked while errors exist", !commitWithErrors.ok);

// Reduce to valid rows only and commit; counters must move.
const cleanTsv = [
  ["Auto One", "Glasshouse Exchange", "2026-09-16", "72", "104", "全日照", "自动编号的第一行用于导入预览。", "", ""].join("\t"),
  ["Auto Two", "Glasshouse Exchange", "2026-09-16", "72", "104", "全日照", "自动编号的第二行用于导入预览。", "", ""].join("\t"),
].join("\n");
const cleanPlan = planAccessionImport(state, "trial-bra-03", rowsFromTsv(cleanTsv));
const commit = commitAccessionImport(state, cleanPlan);
check("clean import commits", commit.ok);
if (commit.ok) {
  state = {
    ...state,
    accessions: [...state.accessions, ...commit.value.accessions],
    numberRules: commit.value.numberRules,
  };
}
// Re-planning the same import must produce the next numbers, no collisions.
const secondPlan = planAccessionImport(state, "trial-bra-03", rowsFromTsv(cleanTsv));
check(
  "repeated import continues sequence without collision",
  secondPlan.rows[0].plannedNo === "GE-20260916-003" &&
    secondPlan.rows[1].plannedNo === "GE-20260916-004",
  secondPlan.rows.map((r) => r.plannedNo),
);
// Commit the second import so trial copy sees the full set.
const secondCommit = commitAccessionImport(state, secondPlan);
if (secondCommit.ok) {
  state = {
    ...state,
    accessions: [...state.accessions, ...secondCommit.value.accessions],
    numberRules: secondCommit.value.numberRules,
  };
}

// 11. Trial copy uses the same rules without collision.
const copyDraft = {
  code: "SOL-09",
  cropFamily: "茄科",
  objective: "复制番茄批次并在秋季复测坐果表现与整齐度。",
  season: "秋季",
  startDate: "2026-09-16",
  endDate: "2026-12-16",
};

// With the provenance rule stopped, its materials are explicitly skipped and
// nothing silently falls through to a different prefix.
state = {
  ...state,
  numberRules: state.numberRules.map((r) =>
    r.id === rule.id ? { ...r, status: "inactive" as const } : r,
  ),
};
const stoppedPlan = planTrialCopy(state, "trial-sol-01", copyDraft);
check(
  "provenance rule stopped -> its rows skip with rule_inactive",
  stoppedPlan.rows.some(
    (r) =>
      r.skipped &&
      r.sourceAccession.numberRuleId === rule.id &&
      r.reason?.includes("已停用"),
  ),
  stoppedPlan.rows.map((r) => r.reason),
);
state = {
  ...state,
  numberRules: state.numberRules.map((r) =>
    r.id === rule.id ? { ...r, status: "active" as const } : r,
  ),
};

const copyPlan = planTrialCopy(state, "trial-sol-01", copyDraft);
check("copy plan produces rows", copyPlan.rows.length > 0);
const copiedNumbers = copyPlan.rows.filter((r) => !r.skipped).map((r) => r.accessionNo);
check(
  "copy numbers continue the rule sequence and stay unique against existing data",
  new Set(copiedNumbers).size === copiedNumbers.length &&
    copiedNumbers.length === copyPlan.rows.length &&
    !copiedNumbers.some((n) =>
      state.accessions.some((a) => a.accessionNo === n),
    ),
  copiedNumbers,
);
const copyCommit = commitTrialCopy(state, copyPlan);
check("trial copy commits", copyCommit.ok);
if (copyCommit.ok) {
  const beforeCount = state.accessions.length;
  state = {
    ...state,
    trials: [...state.trials, copyCommit.value.trial],
    accessions: [...state.accessions, ...copyCommit.value.accessions],
    numberRules: copyCommit.value.numberRules,
  };
  check("copy increased accessions", state.accessions.length === beforeCount + copyCommit.value.accessions.length);
  // Copying again with the same rule must not produce any collision.
  const copyAgain = planTrialCopy(
    state,
    "trial-sol-01",
    {
      code: "SOL-10",
      cropFamily: "茄科",
      objective: "再次复制番茄批次用于冬季复测坐果表现。",
      season: "冬季",
      startDate: "2026-09-16",
      endDate: "2026-12-20",
    },
  );
  const secondCopyNumbers = copyAgain.rows.filter((r) => !r.skipped).map((r) => r.accessionNo);
  check(
    "second copy produces fresh non-colliding numbers",
    secondCopyNumbers.every((n) => !state.accessions.some((a) => a.accessionNo === n)) &&
      new Set(secondCopyNumbers).size === secondCopyNumbers.length,
    secondCopyNumbers,
  );
  // Source legacy materials were never re-numbered.
  check(
    "source trial keeps original ACC numbers",
    ["ACC-0001", "ACC-0002", "ACC-0003"].every((no) =>
      state.accessions.some((a) => a.accessionNo === no && a.trialId === "trial-sol-01"),
    ),
  );
}

// 12. Pattern helper sanity.
check(
  "compose joins parts",
  composeAccessionNumber("AB", "2026", 1, 3) === "AB-2026-001",
);
check(
  "compose omits empty date",
  composeAccessionNumber("AB", "", 1, 3) === "AB-001",
);


// 13. Crop-family rules match trials in that family; scope precedence works.
const familyRuleResult = createNumberRule(
  {
    name: "苋科通用",
    scopeType: "cropFamily",
    scopeValue: "苋科",
    prefix: "AMA",
    datePart: "year",
    sequencePadding: 3,
    sequenceScope: "global",
    nextSequence: 1,
    status: "active",
  },
  state,
);
check("crop family rule created", familyRuleResult.ok);
if (familyRuleResult.ok) {
  state = { ...state, numberRules: [...state.numberRules, familyRuleResult.value] };
  const famMatch = selectNumberRule(state, {
    trialId: "trial-ama-02",
    source: "Unknown Source",
    propagatedOn: "2026-09-16",
  });
  check("family rule matches family trial", famMatch?.id === familyRuleResult.value.id);

  // Trial-scoped rule still wins over family rule.
  const trialBeatsFamily = selectNumberRule(state, {
    trialId: "trial-sol-01",
    source: "Unknown Source",
    propagatedOn: "2026-09-16",
  });
  check("trial rule outranks family rule", trialBeatsFamily?.id === rule.id);

  // Family numbering itself works and bumps counters.
  const famPlan = planGeneratedNumbers(state, [
    { trialId: "trial-ama-02", source: "X", propagatedOn: "2026-09-16" },
  ]);
  check("family rule generates AMA-2026-001", famPlan.entries[0].accessionNo === "AMA-2026-001");
}

// 14. Editing a rule changes future numbers only; provenance on existing data is untouched.
if (familyRuleResult.ok) {
  const edited = updateNumberRule(
    familyRuleResult.value,
    {
      name: "苋科通用改",
      scopeType: "cropFamily",
      scopeValue: "苋科",
      prefix: "AMANEW",
      datePart: "year",
      sequencePadding: 4,
      sequenceScope: "global",
      nextSequence: 9,
      status: "active",
    },
    state,
  );
  check("rule edit ok", edited.ok);
  if (edited.ok) {
    const state2 = {
      ...state,
      numberRules: state.numberRules.map((r) =>
        r.id === edited.value.id ? edited.value : r,
      ),
    };
    const future = planGeneratedNumbers(state2, [
      { trialId: "trial-ama-02", source: "X", propagatedOn: "2026-09-16" },
    ]);
    check("future number uses new prefix/padding", future.entries[0].accessionNo === "AMANEW-2026-0009");
    check("old accessions keep their original numbers", state2.accessions.some((a) => a.accessionNo === "ACC-0004"));
  }
}

// 15. Deleted-rule provenance is explicitly skipped and reported.
{
  const orphan = {
    id: "acc-orphan",
    trialId: "trial-sol-01",
    accessionNo: "GONE-2026-001",
    numberRuleId: "rule-does-not-exist",
    cultivar: "Orphan",
    source: "Orphan Source",
    propagatedOn: "2026-09-16",
    quantity: 1,
    trayCells: 72,
    preferredLight: "full-sun" as const,
    genotypeNote: "Material whose provenance rule was deleted.",
    labels: [],
    lifecycleStatus: "active" as const,
    retirementHistory: [],
  };
  const orphanState = { ...state, accessions: [...state.accessions, orphan] };
  const orphanCopy = planTrialCopy(
    orphanState,
    "trial-sol-01",
    { ...copyDraft, code: "SOL-11", objective: "测试已删除规则的材料会被跳过不复制。" },
  );
  check(
    "deleted provenance rule reported",
    orphanCopy.rows.some((r) => r.skipped && r.reason?.includes("已被删除")),
  );
  const orphanCommit = commitTrialCopy(orphanState, orphanCopy);
  check("copy with skipped rows still commits the rest", orphanCommit.ok);
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nAll numbering checks passed");
