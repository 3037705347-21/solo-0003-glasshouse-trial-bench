import type {
  Accession,
  Trial,
  TrialState,
  WorkspaceState,
} from "./types";
import { createId } from "./id";
import { parseDateOnly } from "./rules";
import type { FieldError } from "./result";
import {
  applyBumpedRules,
  planGeneratedNumbers,
} from "./numbering";
import { isAccessionRetired } from "./accession";

export interface TrialCopyDraft {
  code: string;
  cropFamily: string;
  objective: string;
  season: string;
  startDate: string;
  endDate: string;
}

export interface TrialCopyPlanRow {
  sourceAccession: Accession;
  accessionNo: string;
  ruleId?: string;
  skipped: boolean;
  reason?: string;
}

export interface TrialCopyPlan {
  trialDraft: TrialCopyDraft;
  rows: TrialCopyPlanRow[];
  issues: FieldError[];
  bumpedRules: ReturnType<typeof planGeneratedNumbers>["bumpedRules"];
}

function validateTrialCopyDraft(
  state: WorkspaceState,
  trialDraft: TrialCopyDraft,
): FieldError[] {
  const issues: FieldError[] = [];
  const code = trialDraft.code.trim().toUpperCase();
  if (!/^[A-Z]{2,4}-\d{2,4}$/.test(code)) {
    issues.push({
      field: "code",
      code: "invalid_code",
      message: "请使用类似 AUR-04 或 TM-12 的新试验编号",
    });
  } else if (state.trials.some((trial) => trial.code === code)) {
    issues.push({
      field: "code",
      code: "duplicate",
      message: `试验编号 ${code} 已被使用`,
    });
  }
  if (trialDraft.cropFamily.trim().length < 1) {
    issues.push({
      field: "cropFamily",
      code: "required",
      message: "请填写作物科属",
    });
  }
  if (trialDraft.objective.trim().length < 12) {
    issues.push({
      field: "objective",
      code: "too_short",
      message: "请用至少 12 个字符描述试验目标",
    });
  }
  if (!trialDraft.season) {
    issues.push({ field: "season", code: "required", message: "请选择季节" });
  }
  const start = parseDateOnly(trialDraft.startDate);
  const end = parseDateOnly(trialDraft.endDate);
  if (!start) {
    issues.push({
      field: "startDate",
      code: "invalid_date",
      message: "开始日期无效",
    });
  }
  if (!end) {
    issues.push({
      field: "endDate",
      code: "invalid_date",
      message: "结束日期无效",
    });
  }
  if (start && end && start.getTime() > end.getTime()) {
    issues.push({
      field: "endDate",
      code: "date_sequence",
      message: "结束日期不能早于开始日期",
    });
  }
  return issues;
}

/**
 * Builds the preview for copying a whole trial into a new draft. Every copied
 * material receives a freshly generated number from the rule matching its own
 * source, so reusing a rule across batches never collides. Materials whose
 * rule is stopped or missing are listed as skipped in the preview rather than
 * silently reusing their old number.
 */
export function planTrialCopy(
  state: WorkspaceState,
  sourceTrialId: string,
  trialDraft: TrialCopyDraft,
  options: { includeRetired: boolean } = { includeRetired: false },
): TrialCopyPlan {
  const sourceTrial = state.trials.find((trial) => trial.id === sourceTrialId);
  const issues: FieldError[] = [];

  if (!sourceTrial) {
    issues.push({
      field: "sourceTrialId",
      code: "unknown",
      message: "请选择要复制的源试验",
    });
  }
  issues.push(...validateTrialCopyDraft(state, trialDraft));

  const sourceAccessions = state.accessions.filter(
    (accession) =>
      accession.trialId === sourceTrialId &&
      (options.includeRetired || !isAccessionRetired(accession)),
  );

  const numberPlan = planGeneratedNumbers(
    state,
    sourceAccessions.map((accession) => ({
      trialId: sourceTrialId,
      source: accession.source,
      propagatedOn: accession.propagatedOn,
      generatedOn: trialDraft.startDate,
      // Follow each material's provenance: a stopped or deleted rule skips
      // this row instead of silently falling back to another rule.
      ruleId: accession.numberRuleId,
    })),
  );

  const rows: TrialCopyPlanRow[] = sourceAccessions.map((accession, index) => {
    const entry = numberPlan.entries[index];
    if (entry.skipped) {
      return {
        sourceAccession: accession,
        accessionNo: "",
        skipped: true,
        reason:
          numberPlan.issues.find(
            (issue) => issue.field === `rows.${index}.accessionNo`,
          )?.message ?? "没有匹配的启用编号规则",
      };
    }
    return {
      sourceAccession: accession,
      accessionNo: entry.accessionNo,
      ruleId: entry.ruleId,
      skipped: false,
    };
  });

  numberPlan.issues.forEach((issue) => {
    const match = /^rows\.(\d+)\./.exec(issue.field);
    const index = match ? Number(match[1]) : -1;
    const source = sourceAccessions[index];
    issues.push({
      ...issue,
      message: source
        ? `${source.accessionNo}: ${issue.message}`
        : issue.message,
    });
  });

  return {
    trialDraft: {
      ...trialDraft,
      code: trialDraft.code.trim().toUpperCase(),
      cropFamily: trialDraft.cropFamily.trim(),
    },
    rows,
    issues,
    bumpedRules: numberPlan.bumpedRules,
  };
}

export function commitTrialCopy(
  state: WorkspaceState,
  plan: TrialCopyPlan,
):
  | {
      ok: true;
      value: {
        trial: Trial;
        accessions: Accession[];
        numberRules: WorkspaceState["numberRules"];
      };
    }
  | { ok: false; errors: FieldError[] } {
  const copyable = plan.rows.filter((row) => !row.skipped);
  // Row-level blocked issues correspond one-to-one with skipped rows: the
  // remaining materials still copy. Only trial-field errors and an empty
  // copyable set prevent the commit.
  const blocking = plan.issues.filter((issue) => !issue.field.startsWith("rows."));
  if (copyable.length === 0) {
    blocking.push({
      field: "rows",
      code: "empty",
      message: "没有可复制的材料：缺少匹配的启用编号规则",
    });
  }
  if (blocking.length > 0) {
    return { ok: false, errors: blocking };
  }

  const newTrial: Trial = {
    id: createId("trl"),
    code: plan.trialDraft.code,
    cropFamily: plan.trialDraft.cropFamily,
    objective: plan.trialDraft.objective.trim(),
    season: plan.trialDraft.season,
    startDate: plan.trialDraft.startDate,
    endDate: plan.trialDraft.endDate,
    state: "draft" as TrialState,
  };

  const accessions: Accession[] = copyable.map((row) => ({
    id: createId("acc"),
    trialId: newTrial.id,
    accessionNo: row.accessionNo,
    numberRuleId: row.ruleId,
    cultivar: row.sourceAccession.cultivar,
    source: row.sourceAccession.source,
    propagatedOn: row.sourceAccession.propagatedOn,
    quantity: row.sourceAccession.quantity,
    trayCells: row.sourceAccession.trayCells,
    preferredLight: row.sourceAccession.preferredLight,
    genotypeNote: row.sourceAccession.genotypeNote,
    labels: [...row.sourceAccession.labels],
    lifecycleStatus: "active",
    retirementHistory: [],
  }));

  return {
    ok: true,
    value: {
      trial: newTrial,
      accessions,
      numberRules: applyBumpedRules(state.numberRules, plan.bumpedRules),
    },
  };
}
