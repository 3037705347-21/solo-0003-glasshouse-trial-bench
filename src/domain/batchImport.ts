import type {
  Accession,
  ImportBatch,
  PreferredLight,
  WorkspaceState,
} from "./types";
import { validateAccessionDraft, type AccessionDraft } from "./accession";
import { createAccessionNumber, createId } from "./id";
import { normalizeLabels } from "./rules";
import { fail, fieldError, ok, type FieldError, type Result } from "./result";

export type BatchColumnKey =
  | "trial"
  | "accessionNo"
  | "cultivar"
  | "source"
  | "propagatedOn"
  | "quantity"
  | "trayCells"
  | "preferredLight"
  | "labels"
  | "genotypeNote";

export const BATCH_COLUMN_LABELS: Record<BatchColumnKey, string> = {
  trial: "试验",
  accessionNo: "材料编号",
  cultivar: "品种",
  source: "来源",
  propagatedOn: "繁殖日期",
  quantity: "数量",
  trayCells: "穴盘规格",
  preferredLight: "光照",
  labels: "标签",
  genotypeNote: "说明",
};

const COLUMN_ALIASES: Array<{ key: BatchColumnKey; aliases: string[] }> = [
  { key: "trial", aliases: ["试验", "试验编号", "trial", "trialcode"] },
  {
    key: "accessionNo",
    aliases: ["材料编号", "编号", "accessionno", "accession", "no"],
  },
  { key: "cultivar", aliases: ["品种", "cultivar"] },
  { key: "source", aliases: ["来源", "source"] },
  {
    key: "propagatedOn",
    aliases: ["繁殖日期", "日期", "propagatedon", "date"],
  },
  { key: "quantity", aliases: ["数量", "quantity", "qty"] },
  { key: "trayCells", aliases: ["穴盘规格", "穴盘", "traycells", "tray"] },
  {
    key: "preferredLight",
    aliases: ["光照", "适宜光照", "light", "preferredlight"],
  },
  { key: "labels", aliases: ["标签", "labels", "tags"] },
  {
    key: "genotypeNote",
    aliases: ["说明", "基因型说明", "批次说明", "note", "genotypenote"],
  },
];

const DEFAULT_COLUMN_ORDER: BatchColumnKey[] = [
  "accessionNo",
  "cultivar",
  "source",
  "propagatedOn",
  "quantity",
  "trayCells",
  "preferredLight",
  "labels",
  "genotypeNote",
];

const LIGHT_ALIASES: Record<string, PreferredLight> = {
  全日照: "full-sun",
  全光: "full-sun",
  "full-sun": "full-sun",
  fullsun: "full-sun",
  半阴: "partial-shade",
  半遮阴: "partial-shade",
  "partial-shade": "partial-shade",
  partialshade: "partial-shade",
  遮阴: "shade",
  荫蔽: "shade",
  shade: "shade",
};

export interface ParsedBatch {
  rows: string[][];
  headerDetected: boolean;
  delimiter: string;
  columnOrder: BatchColumnKey[];
}

export interface BatchPreviewRow {
  rowNumber: number;
  trialCode: string;
  accessionNo: string;
  autoNumbered: boolean;
  cultivar: string;
  source: string;
  propagatedOn: string;
  quantity: string;
  draft: AccessionDraft;
  issues: FieldError[];
  valid: boolean;
}

export interface BatchPreview {
  rows: BatchPreviewRow[];
  totalRows: number;
  validCount: number;
  invalidCount: number;
  headerDetected: boolean;
}

function normalizeHeaderCell(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_\-/]+/g, "");
}

function detectDelimiter(sample: string): string {
  const candidates = ["\t", ",", ";", "|"];
  let best = "\t";
  let bestCount = 0;
  candidates.forEach((candidate) => {
    const count = sample.split(candidate).length - 1;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  });
  return best;
}

function splitDelimitedLine(line: string, delimiter: string): string[] {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function columnKeyForHeader(cell: string): BatchColumnKey | null {
  const normalized = normalizeHeaderCell(cell);
  if (!normalized) {
    return null;
  }
  for (const column of COLUMN_ALIASES) {
    if (
      column.aliases.some(
        (alias) => normalizeHeaderCell(alias) === normalized,
      )
    ) {
      return column.key;
    }
  }
  return null;
}

export function parseBatchInput(text: string): ParsedBatch {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length === 0) {
    return {
      rows: [],
      headerDetected: false,
      delimiter: "\t",
      columnOrder: DEFAULT_COLUMN_ORDER,
    };
  }
  const delimiter = detectDelimiter(lines[0]);
  const firstCells = splitDelimitedLine(lines[0], delimiter);
  const headerKeys = firstCells.map(columnKeyForHeader);
  const headerHits = headerKeys.filter(Boolean).length;
  if (headerHits >= 2) {
    const seen = new Set<BatchColumnKey>();
    const columnOrder = headerKeys.map((key) => {
      if (key && !seen.has(key)) {
        seen.add(key);
        return key;
      }
      return null;
    });
    return {
      rows: lines
        .slice(1)
        .map((line) => splitDelimitedLine(line, delimiter))
        .map((cells) => mapCellsToColumns(cells, columnOrder)),
      headerDetected: true,
      delimiter,
      columnOrder: columnOrder.map((key) => key ?? "genotypeNote"),
    };
  }
  return {
    rows: lines
      .map((line) => splitDelimitedLine(line, delimiter))
      .map((cells) =>
        mapCellsToColumns(
          cells,
          DEFAULT_COLUMN_ORDER.map((key) => key as BatchColumnKey | null),
        ),
      ),
    headerDetected: false,
    delimiter,
    columnOrder: DEFAULT_COLUMN_ORDER,
  };
}

function mapCellsToColumns(
  cells: string[],
  columnOrder: Array<BatchColumnKey | null>,
): string[] {
  const values: Partial<Record<BatchColumnKey, string>> = {};
  cells.forEach((cell, index) => {
    const key = columnOrder[index];
    if (key && values[key] === undefined) {
      values[key] = cell;
    }
  });
  return COLUMN_ALIASES.map((column) => values[column.key] ?? "");
}

function rowCells(row: string[]): Partial<Record<BatchColumnKey, string>> {
  const cells: Partial<Record<BatchColumnKey, string>> = {};
  COLUMN_ALIASES.forEach((column, index) => {
    cells[column.key] = row[index] ?? "";
  });
  return cells;
}

function normalizeDateInput(raw: string): string {
  const trimmed = raw.trim();
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(trimmed);
  if (!match) {
    return trimmed;
  }
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

function normalizeAccessionNo(raw: string): string {
  const trimmed = raw.trim();
  return /^acc-\d+$/i.test(trimmed) ? trimmed.toUpperCase() : trimmed;
}

function parseLight(raw: string): PreferredLight {
  const normalized = raw.trim().toLowerCase();
  return (
    LIGHT_ALIASES[normalized] ??
    LIGHT_ALIASES[raw.trim()] ??
    (raw.trim() as PreferredLight)
  );
}

function parseLabels(raw: string): string[] {
  return normalizeLabels(raw.split(/[,，、;；]/));
}

function largestAccessionSequence(state: WorkspaceState): number {
  return state.accessions.reduce((max, item) => {
    const match = /^ACC-(\d+)$/.exec(item.accessionNo);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);
}

export interface BatchPreviewOptions {
  defaultTrialId: string;
  defaultGenotypeNote: string;
}

export function buildBatchPreview(
  parsed: ParsedBatch,
  state: WorkspaceState,
  options: BatchPreviewOptions,
): BatchPreview {
  interface MutableRow {
    rowNumber: number;
    cells: Partial<Record<BatchColumnKey, string>>;
    accessionNo: string;
    autoNumbered: boolean;
  }

  const rows: MutableRow[] = parsed.rows.map((row, index) => {
    const cells = rowCells(row);
    const explicit = normalizeAccessionNo(cells.accessionNo ?? "");
    return {
      rowNumber: index + 1,
      cells,
      accessionNo: explicit,
      autoNumbered: false,
    };
  });

  const usedNumbers = new Set(
    state.accessions.map((item) => item.accessionNo),
  );
  rows.forEach((row) => {
    if (row.accessionNo) {
      usedNumbers.add(row.accessionNo);
    }
  });
  let nextSequence = largestAccessionSequence(state) + 1;
  rows.forEach((row) => {
    if (row.accessionNo) {
      return;
    }
    let candidate = createAccessionNumber(nextSequence);
    while (usedNumbers.has(candidate)) {
      nextSequence += 1;
      candidate = createAccessionNumber(nextSequence);
    }
    row.accessionNo = candidate;
    row.autoNumbered = true;
    usedNumbers.add(candidate);
    nextSequence += 1;
  });

  const previewRows: BatchPreviewRow[] = rows.map((row) => {
    const { cells } = row;
    const trialCell = (cells.trial ?? "").trim();
    let trialId = options.defaultTrialId;
    let trialIssue: FieldError | null = null;
    let trialCode =
      state.trials.find((trial) => trial.id === options.defaultTrialId)?.code ??
      "当前试验";
    if (trialCell) {
      const matched = state.trials.find(
        (trial) => trial.code.toLowerCase() === trialCell.toLowerCase(),
      );
      if (matched) {
        trialId = matched.id;
        trialCode = matched.code;
      } else {
        trialIssue = fieldError(
          "trialId",
          "unknown_trial",
          `未知试验：${trialCell}`,
        );
        trialCode = trialCell;
      }
    }
    const noteCell = (cells.genotypeNote ?? "").trim();
    const draft: AccessionDraft = {
      trialId: trialIssue ? "" : trialId,
      accessionNo: row.accessionNo,
      cultivar: cells.cultivar ?? "",
      source: cells.source ?? "",
      propagatedOn: normalizeDateInput(cells.propagatedOn ?? ""),
      quantity: Number((cells.quantity ?? "").trim()),
      trayCells: Number((cells.trayCells ?? "").trim()),
      preferredLight: parseLight(cells.preferredLight ?? ""),
      genotypeNote: noteCell || options.defaultGenotypeNote,
      labels: parseLabels(cells.labels ?? ""),
    };
    const validated = validateAccessionDraft(draft, state);
    let issues: FieldError[] = validated.ok ? [] : validated.errors;
    if (trialIssue) {
      issues = [trialIssue, ...issues.filter((issue) => issue.field !== "trialId")];
    }
    return {
      rowNumber: row.rowNumber,
      trialCode,
      accessionNo: row.accessionNo,
      autoNumbered: row.autoNumbered,
      cultivar: (cells.cultivar ?? "").trim(),
      source: (cells.source ?? "").trim(),
      propagatedOn: draft.propagatedOn,
      quantity: (cells.quantity ?? "").trim(),
      draft,
      issues,
      valid: issues.length === 0,
    };
  });

  const firstSeen = new Map<string, number>();
  previewRows.forEach((row) => {
    const existing = firstSeen.get(row.accessionNo);
    if (existing === undefined) {
      firstSeen.set(row.accessionNo, row.rowNumber);
      return;
    }
    row.issues = [
      ...row.issues,
      fieldError(
        "accessionNo",
        "cross_row_conflict",
        `跨行冲突：与第 ${existing} 行编号重复`,
      ),
    ];
    row.valid = false;
  });

  const validCount = previewRows.filter((row) => row.valid).length;
  return {
    rows: previewRows,
    totalRows: previewRows.length,
    validCount,
    invalidCount: previewRows.length - validCount,
    headerDetected: parsed.headerDetected,
  };
}

export interface BatchImportResult {
  accessions: Accession[];
  batch: ImportBatch;
}

export function createBatchImport(
  preview: BatchPreview,
  state: WorkspaceState,
  options: BatchPreviewOptions,
): Result<BatchImportResult> {
  const validRows = preview.rows.filter((row) => row.valid);
  if (validRows.length === 0) {
    return fail([fieldError("rows", "empty", "没有可提交的有效行")]);
  }
  const accessions: Accession[] = [];
  const committedNumbers = new Set<string>();
  const errors: FieldError[] = [];
  validRows.forEach((row) => {
    const validated = validateAccessionDraft(row.draft, state);
    if (!validated.ok) {
      validated.errors.forEach((error) =>
        errors.push({
          ...error,
          message: `第 ${row.rowNumber} 行：${error.message}`,
        }),
      );
      return;
    }
    if (committedNumbers.has(validated.value.accessionNo)) {
      errors.push(
        fieldError(
          "accessionNo",
          "cross_row_conflict",
          `第 ${row.rowNumber} 行：编号 ${validated.value.accessionNo} 在批次内重复`,
        ),
      );
      return;
    }
    committedNumbers.add(validated.value.accessionNo);
    accessions.push({
      id: createId("acc"),
      trialId: validated.value.trialId,
      accessionNo: validated.value.accessionNo,
      cultivar: validated.value.cultivar,
      source: validated.value.source,
      propagatedOn: validated.value.propagatedOn,
      quantity: validated.value.quantity,
      trayCells: validated.value.trayCells,
      preferredLight: validated.value.preferredLight,
      genotypeNote: validated.value.genotypeNote,
      labels: validated.value.labels,
    });
  });
  if (errors.length > 0) {
    return fail(errors);
  }
  const batch: ImportBatch = {
    id: createId("imp"),
    importedAt: new Date().toISOString(),
    trialId: options.defaultTrialId,
    totalRows: preview.totalRows,
    importedCount: accessions.length,
    skippedCount: preview.totalRows - accessions.length,
    accessionNos: accessions.map((accession) => accession.accessionNo),
  };
  return ok({ accessions, batch });
}
