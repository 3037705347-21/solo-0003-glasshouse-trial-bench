import type {
  Accession,
  NumberRule,
  PreferredLight,
  WorkspaceState,
} from "./types";
import { createId } from "./id";
import {
  MAX_ACCESSION_NO_LENGTH,
  TRAY_CELL_OPTIONS,
  normalizeLabels,
  parseDateOnly,
} from "./rules";
import type { FieldError } from "./result";
import {
  applyBumpedRules,
  planGeneratedNumbers,
  type NumberGenerationContext,
  type NumberPlan,
} from "./numbering";
import type { AccessionDraft } from "./accession";

export interface AccessionImportRow {
  cultivar: string;
  source: string;
  propagatedOn: string;
  quantity: string;
  trayCells: string;
  preferredLight: string;
  genotypeNote: string;
  labels: string;
  accessionNo: string;
}

export interface AccessionImportPlannedRow {
  index: number;
  draft: AccessionDraft;
  plannedNo: string;
  rule: NumberRule | undefined;
  manual: boolean;
  errors: FieldError[];
}

export interface AccessionImportPlan {
  rows: AccessionImportPlannedRow[];
  validRows: AccessionImportPlannedRow[];
  bumpedRules: NumberPlan["bumpedRules"];
}

export const IMPORT_TEMPLATE_COLUMNS = [
  "品种",
  "来源",
  "繁殖日期",
  "数量",
  "穴盘规格",
  "光照",
  "基因型说明",
  "标签",
  "材料编号",
];

const LIGHT_ALIASES: Record<string, PreferredLight> = {
  "全日照": "full-sun",
  "full-sun": "full-sun",
  sun: "full-sun",
  "半阴": "partial-shade",
  "partial-shade": "partial-shade",
  partial: "partial-shade",
  "遮阴": "shade",
  shade: "shade",
};

function splitLine(line: string): string[] {
  return line.split("\t").map((cell) => cell.trim());
}

export function parseImportTsv(text: string): {
  headers: string[];
  rows: string[][];
} {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return { headers: IMPORT_TEMPLATE_COLUMNS, rows: [] };
  }
  const firstCells = splitLine(lines[0]).map((cell) => cell.replace(/^#\s*/, ""));
  const looksLikeHeader = firstCells.some((cell) =>
    IMPORT_TEMPLATE_COLUMNS.includes(cell),
  );
  if (looksLikeHeader) {
    const headerIndex = new Map(
      firstCells.map((cell, index) => [cell, index]),
    );
    const rows = lines.slice(1).map((line) => {
      const cells = splitLine(line);
      return IMPORT_TEMPLATE_COLUMNS.map(
        (column) => cells[headerIndex.get(column) ?? -1] ?? "",
      );
    });
    return { headers: IMPORT_TEMPLATE_COLUMNS, rows };
  }
  return {
    headers: IMPORT_TEMPLATE_COLUMNS,
    rows: lines.map(splitLine),
  };
}

function rowFromCells(cells: string[]): AccessionImportRow {
  return {
    cultivar: cells[0] ?? "",
    source: cells[1] ?? "",
    propagatedOn: cells[2] ?? "",
    quantity: cells[3] ?? "",
    trayCells: cells[4] ?? "",
    preferredLight: cells[5] ?? "",
    genotypeNote: cells[6] ?? "",
    labels: cells[7] ?? "",
    accessionNo: cells[8] ?? "",
  };
}

export function rowsFromTsv(text: string): AccessionImportRow[] {
  return parseImportTsv(text).rows.map(rowFromCells);
}

function validateManualNumber(
  value: string,
  state: WorkspaceState,
  taken: Set<string>,
  rowIndex: number,
): FieldError[] {
  const errors: FieldError[] = [];
  const normalized = value.trim();
  const field = (code: string, message: string): FieldError => ({
    field: `rows.${rowIndex}.accessionNo`,
    code,
    message,
  });
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{1,}$/.test(normalized) || normalized.includes("--")) {
    errors.push(field("invalid_format", "编号需为字母、数字和连字符"));
  }
  if (normalized.length > MAX_ACCESSION_NO_LENGTH) {
    errors.push(
      field("too_long", `编号不能超过 ${MAX_ACCESSION_NO_LENGTH} 个字符`),
    );
  }
  const lower = normalized.toLowerCase();
  if (
    state.accessions.some(
      (accession) => accession.accessionNo.toLowerCase() === lower,
    )
  ) {
    errors.push(field("duplicate", `编号 ${normalized} 已在材料清单中存在`));
  }
  if (taken.has(lower)) {
    errors.push(field("duplicate", `编号 ${normalized} 在本次导入中重复`));
  }
  return errors;
}

function validateImportRowFields(
  row: AccessionImportRow,
  trialId: string,
  state: WorkspaceState,
  rowIndex: number,
): { errors: FieldError[]; draftBase: AccessionDraft | null } {
  const errors: FieldError[] = [];
  const field = (name: string, code: string, message: string): FieldError => ({
    field: `rows.${rowIndex}.${name}`,
    code,
    message,
  });

  if (!state.trials.some((trial) => trial.id === trialId)) {
    errors.push(field("trialId", "unknown", "请选择有效试验"));
  }
  if (row.cultivar.trim().length < 2) {
    errors.push(field("cultivar", "required", "品种至少 2 个字符"));
  }
  if (row.source.trim().length < 3) {
    errors.push(field("source", "required", "来源至少 3 个字符"));
  }
  if (!parseDateOnly(row.propagatedOn)) {
    errors.push(field("propagatedOn", "invalid_date", "繁殖日期需为 YYYY-MM-DD"));
  }
  const quantity = Number(row.quantity);
  if (
    row.quantity.trim() === "" ||
    Number.isNaN(quantity) ||
    quantity < 1 ||
    quantity > 500
  ) {
    errors.push(field("quantity", "range", "数量需在 1 到 500 之间"));
  }
  const trayCells = Number(row.trayCells);
  if (!TRAY_CELL_OPTIONS.includes(trayCells)) {
    errors.push(
      field(
        "trayCells",
        "invalid",
        `穴盘规格需为 ${TRAY_CELL_OPTIONS.join("/")} 之一`,
      ),
    );
  }
  const preferredLight =
    LIGHT_ALIASES[row.preferredLight.trim().toLowerCase()] ??
    (["full-sun", "partial-shade", "shade"].includes(row.preferredLight.trim())
      ? (row.preferredLight.trim() as PreferredLight)
      : undefined);
  if (!preferredLight) {
    errors.push(field("preferredLight", "invalid", "光照需为 全日照/半阴/遮阴"));
  }
  if (row.genotypeNote.trim().length < 10) {
    errors.push(field("genotypeNote", "too_short", "基因型说明至少 10 个字符"));
  }

  if (errors.length > 0) {
    return { errors, draftBase: null };
  }
  return {
    errors,
    draftBase: {
      trialId,
      accessionNo: row.accessionNo.trim(),
      cultivar: row.cultivar.trim(),
      source: row.source.trim(),
      propagatedOn: row.propagatedOn.trim(),
      quantity,
      trayCells,
      preferredLight: preferredLight!,
      genotypeNote: row.genotypeNote.trim(),
      labels: normalizeLabels(
        row.labels
          .split(/[,，]/)
          .map((label) => label.trim())
          .filter(Boolean),
      ),
    },
  };
}

/**
 * Previews one import batch without mutating state. Rows left without an
 * explicit accession number get consecutive numbers from the matching rule,
 * and the plan carries the counters that must be persisted on commit so a
 * repeated import (or a trial copy using the same rule) cannot collide.
 */
export function planAccessionImport(
  state: WorkspaceState,
  trialId: string,
  rows: AccessionImportRow[],
): AccessionImportPlan {
  const baseResults = rows.map((row, index) =>
    validateImportRowFields(row, trialId, state, index),
  );

  const autoSlots: Array<{ rowIndex: number; context: NumberGenerationContext }> =
    [];
  rows.forEach((row, index) => {
    const base = baseResults[index];
    if (base.draftBase && !row.accessionNo.trim()) {
      autoSlots.push({
        rowIndex: index,
        context: {
          trialId,
          source: base.draftBase.source,
          propagatedOn: base.draftBase.propagatedOn,
        },
      });
    }
  });

  const autoPlan = planGeneratedNumbers(
    state,
    autoSlots.map((slot) => slot.context),
  );
  const generatedByRow = new Map<number, { no: string; rule: NumberRule }>();
  const generationErrorsByRow = new Map<number, FieldError[]>();
  const bumpedRules: NumberPlan["bumpedRules"] = autoPlan.bumpedRules;
  autoSlots.forEach((slot, order) => {
    const entry = autoPlan.entries[order];
    if (!entry.skipped) {
      generatedByRow.set(slot.rowIndex, {
        no: entry.accessionNo,
        rule: state.numberRules.find((item) => item.id === entry.ruleId)!,
      });
    }
    const rowIssues = autoPlan.issues.filter(
      (issue) => issue.field === `rows.${order}.accessionNo`,
    );
    if (rowIssues.length > 0) {
      generationErrorsByRow.set(
        slot.rowIndex,
        rowIssues.map((issue) => ({
          ...issue,
          field: `rows.${slot.rowIndex}.accessionNo`,
        })),
      );
    }
  });

  const planned: AccessionImportPlannedRow[] = [];
  const taken = new Set<string>();

  rows.forEach((row, index) => {
    const { errors: baseErrors, draftBase } = baseResults[index];
    const errors = [...baseErrors];
    const manual = Boolean(row.accessionNo.trim());
    let plannedNo = "";
    let rule: NumberRule | undefined;

    if (draftBase) {
      if (manual) {
        errors.push(
          ...validateManualNumber(row.accessionNo, state, taken, index),
        );
        plannedNo = row.accessionNo.trim();
        taken.add(plannedNo.toLowerCase());
      } else {
        const generated = generatedByRow.get(index);
        errors.push(...(generationErrorsByRow.get(index) ?? []));
        if (generated) {
          plannedNo = generated.no;
          rule = generated.rule;
          if (taken.has(plannedNo.toLowerCase())) {
            errors.push({
              field: `rows.${index}.accessionNo`,
              code: "duplicate",
              message: `生成编号 ${plannedNo} 在本次导入中冲突`,
            });
          }
          taken.add(plannedNo.toLowerCase());
        }
      }
    }

    const fallbackDraft: AccessionDraft = draftBase ?? {
      trialId,
      accessionNo: row.accessionNo.trim(),
      cultivar: row.cultivar.trim(),
      source: row.source.trim(),
      propagatedOn: row.propagatedOn.trim(),
      quantity: Number(row.quantity) || 0,
      trayCells: Number(row.trayCells) || 0,
      preferredLight: "full-sun",
      genotypeNote: row.genotypeNote.trim(),
      labels: [],
    };

    planned.push({
      index,
      draft: {
        ...fallbackDraft,
        accessionNo: plannedNo,
        numberRuleId: manual ? undefined : rule?.id,
      },
      plannedNo,
      rule,
      manual,
      errors,
    });
  });

  // Manual numbers can still collide with numbers generated for other rows.
  const generatedNumbers = new Set(
    planned
      .filter((item) => !item.manual && item.plannedNo)
      .map((item) => item.plannedNo.toLowerCase()),
  );
  for (const item of planned) {
    if (
      item.manual &&
      item.plannedNo &&
      generatedNumbers.has(item.plannedNo.toLowerCase())
    ) {
      item.errors.push({
        field: `rows.${item.index}.accessionNo`,
        code: "duplicate",
        message: `手工编号 ${item.plannedNo} 与同批自动生成的编号冲突`,
      });
    }
  }

  return {
    rows: planned,
    validRows: planned.filter((row) => row.errors.length === 0),
    bumpedRules,
  };
}

export function commitAccessionImport(
  state: WorkspaceState,
  plan: AccessionImportPlan,
): {
  ok: true;
  value: {
    accessions: Accession[];
    numberRules: WorkspaceState["numberRules"];
  };
} | {
  ok: false;
  errors: FieldError[];
} {
  if (plan.rows.length === 0) {
    return {
      ok: false,
      errors: [
        {
          field: "rows",
          code: "empty",
          message: "没有可导入的行，请粘贴至少一行材料数据",
        },
      ],
    };
  }
  const blocking = plan.rows.flatMap((row) => row.errors);
  if (blocking.length > 0) {
    return { ok: false, errors: blocking };
  }
  const accessions: Accession[] = plan.validRows.map((row) => ({
    id: createId("acc"),
    trialId: row.draft.trialId,
    accessionNo: row.plannedNo,
    numberRuleId: row.manual ? undefined : row.rule?.id,
    cultivar: row.draft.cultivar,
    source: row.draft.source,
    propagatedOn: row.draft.propagatedOn,
    quantity: row.draft.quantity,
    trayCells: row.draft.trayCells,
    preferredLight: row.draft.preferredLight,
    genotypeNote: row.draft.genotypeNote,
    labels: row.draft.labels,
    lifecycleStatus: "active",
    retirementHistory: [],
  }));
  return {
    ok: true,
    value: {
      accessions,
      numberRules: applyBumpedRules(state.numberRules, plan.bumpedRules),
    },
  };
}

