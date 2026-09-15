import type {
  Accession,
  Flag,
  FlagHistoryEntry,
  FlagScope,
  FlagSeverity,
  FlagState,
  ObservationPass,
} from "./types";
import { createId } from "./id";
import { fail, fieldError, ok, type Result } from "./result";

const SEVERITY_RANK: Record<FlagSeverity, number> = {
  info: 0,
  warning: 1,
  critical: 2,
};

export const MIN_HANDLING_NOTE_LENGTH = 8;

export function isFlagOpen(flag: Flag): boolean {
  return flag.state === "open";
}

export function isFlagClosed(flag: Flag): boolean {
  return flag.state === "resolved" || flag.state === "waived";
}

export function isFlagSuperseded(flag: Flag): boolean {
  return flag.state === "superseded";
}

/**
 * 当前是否会阻止放行：开放的材料级标记只在材料仍在用时阻断；
 * 升级为试验级的跟进标记即使源材料已停用也继续阻断整个试验。
 */
export function isBlockingFlag(
  flag: Flag,
  activeAccessionIds: Set<string>,
): boolean {
  if (flag.state !== "open") {
    return false;
  }
  if (flag.scope === "trial") {
    return true;
  }
  return activeAccessionIds.has(flag.accessionId);
}

export function flagStateLabel(flag: Flag): string {
  if (flag.state === "open") {
    return "未处理";
  }
  if (flag.state === "resolved") {
    return "已解决";
  }
  if (flag.state === "waived") {
    return "已豁免";
  }
  return "已取代";
}

export function flagActionLabel(action: FlagHistoryEntry["action"]): string {
  switch (action) {
    case "created":
      return "标记创建";
    case "resolved":
      return "处理为解决";
    case "waived":
      return "处理为豁免";
    case "reopened":
      return "重新打开";
    case "escalated":
      return "扩大处理范围";
    case "recurrence-observed":
      return "再次命中";
  }
}

function appendHistory(
  flag: Flag,
  action: FlagHistoryEntry["action"],
  note: string,
  extra?: Partial<FlagHistoryEntry>,
): Flag {
  const entry: FlagHistoryEntry = {
    id: createId("flh"),
    at: new Date().toISOString(),
    action,
    note,
    ...extra,
  };
  return { ...flag, history: [...flag.history, entry] };
}

function validateHandlingNote(note: string, field: string): string | undefined {
  if (note.trim().length < MIN_HANDLING_NOTE_LENGTH) {
    return `请填写至少 ${MIN_HANDLING_NOTE_LENGTH} 个字符的处理说明`;
  }
  return undefined;
}

/**
 * open -> resolved | waived。旧结论保留在 history 中，
 * 因此标记可以被反复重开而不丢失任何一次处理。
 */
export function closeFlag(
  flag: Flag,
  next: "resolved" | "waived",
  note: string,
): Result<Flag> {
  if (flag.state !== "open") {
    return fail([
      fieldError("state", "not_open", "只有未处理的标记可以变更"),
    ]);
  }
  const noteError = validateHandlingNote(note, "resolutionNote");
  if (noteError) {
    return fail([fieldError("resolutionNote", "too_short", noteError)]);
  }
  const resolvedOn = new Date().toISOString();
  const closed = appendHistory(
    {
      ...flag,
      state: next,
      resolvedOn,
      resolutionNote: note.trim(),
    },
    next,
    note.trim(),
    { at: resolvedOn },
  );
  return ok(closed);
}

/**
 * resolved | waived -> open，表示原处理结论被推翻（问题仍然存在）。
 * 结论字段被清空，但完整结论和时间保留在 history 中。
 * 已取代的标记不能重开：跟进必须在代表扩大范围的新标记上进行。
 */
export function reopenFlag(flag: Flag, note: string): Result<Flag> {
  if (flag.state === "open") {
    return fail([
      fieldError("state", "not_closed", "该标记尚未关闭，无需重新打开"),
    ]);
  }
  if (flag.state === "superseded") {
    return fail([
      fieldError(
        "state",
        "superseded",
        "该标记已被升级取代，请在跟进标记上继续处理",
      ),
    ]);
  }
  const noteError = validateHandlingNote(note, "reopenNote");
  if (noteError) {
    return fail([fieldError("reopenNote", "too_short", noteError)]);
  }
  const reopened = appendHistory(
    {
      ...flag,
      state: "open",
      resolvedOn: undefined,
      resolutionNote: undefined,
    },
    "reopened",
    note.trim(),
  );
  return ok(reopened);
}

export interface FlagEscalationDraft {
  severity: FlagSeverity;
  note: string;
}

export interface FlagEscalation {
  superseded: Flag;
  followUp: Flag;
}

/**
 * 处理范围扩大：原标记不被推翻也不被重开，而是作为历史定论保留，
 * 另生成一条开放的试验级跟进标记，承接扩大后的排查与放行约束。
 */
export function escalateFlag(
  flag: Flag,
  draft: FlagEscalationDraft,
): Result<FlagEscalation> {
  if (flag.state === "open") {
    return fail([
      fieldError(
        "state",
        "not_closed",
        "请先完成解决或豁免，再扩大处理范围",
      ),
    ]);
  }
  if (flag.state === "superseded") {
    return fail([
      fieldError(
        "state",
        "already_escalated",
        "该标记已经升级过，请在跟进标记上继续处理",
      ),
    ]);
  }
  const noteError = validateHandlingNote(draft.note, "escalationNote");
  if (noteError) {
    return fail([fieldError("escalationNote", "too_short", noteError)]);
  }
  if (SEVERITY_RANK[draft.severity] < SEVERITY_RANK[flag.severity]) {
    return fail([
      fieldError(
        "severity",
        "downgrade",
        "扩大处理范围时不能降低严重程度",
      ),
    ]);
  }
  const now = new Date().toISOString();
  const followUpId = createId("flg");
  const note = draft.note.trim();
  const followUp: Flag = {
    id: followUpId,
    trialId: flag.trialId,
    accessionId: flag.accessionId,
    observationPassId: flag.observationPassId,
    code: flag.code,
    message: flag.message,
    severity: draft.severity,
    state: "open",
    scope: "trial",
    createdOn: now,
    followUpOfId: flag.id,
    followUpType: "escalation",
    escalationNote: note,
    history: [
      {
        id: createId("flh"),
        at: now,
        action: "created",
        note: `扩大处理范围：${note}`,
      },
    ],
  };
  const superseded = appendHistory(
    {
      ...flag,
      state: "superseded",
      supersededById: followUpId,
    },
    "escalated",
    note,
    { at: now, followUpFlagId: followUpId },
  );
  return ok({ superseded, followUp });
}

interface FlagSeed {
  trialId: string;
  accessionId: string;
  observationPassId: string;
  code: string;
  message: string;
  severity: FlagSeverity;
}

function buildFlagSeeds(
  pass: ObservationPass,
  accessions: Accession[],
): FlagSeed[] {
  const accessionById = new Map(
    accessions.map((accession) => [accession.id, accession]),
  );
  const seeds: FlagSeed[] = [];
  const push = (
    entry: ObservationPass["entries"][number],
    seed: Omit<FlagSeed, "trialId" | "accessionId" | "observationPassId">,
  ) => {
    seeds.push({
      trialId: pass.trialId,
      accessionId: entry.accessionId,
      observationPassId: pass.id,
      ...seed,
    });
  };
  pass.entries.forEach((entry) => {
    const accession = accessionById.get(entry.accessionId);
    if (!accession) {
      return;
    }
    if (entry.heightMm < 60) {
      push(entry, {
        code: "HT_UNDER",
        message: `${accession.cultivar} 低于 60 毫米生长阈值`,
        severity: "warning",
      });
    }
    if (entry.heightMm >= 420) {
      push(entry, {
        code: "HT_OVER",
        message: `${accession.cultivar} 高于 420 毫米生长阈值`,
        severity: "critical",
      });
    }
    if (entry.leafCount < 5) {
      push(entry, {
        code: "LEAF_LOW",
        message: `${accession.cultivar} 的真叶数少于 5 片`,
        severity: "warning",
      });
    }
    if (entry.ecMs >= 3.5) {
      push(entry, {
        code: "EC_HIGH",
        message: `${accession.cultivar} 的基质电导率偏高`,
        severity: "critical",
      });
    }
  });
  return seeds;
}

function makeFlag(seed: FlagSeed, createdOn: string): Flag {
  return {
    ...seed,
    id: createId("flg"),
    state: "open",
    scope: "accession",
    createdOn,
    history: [
      {
        id: createId("flh"),
        at: createdOn,
        action: "created",
        note: "标记由观测数据派生。",
      },
    ],
  };
}

function makeRecurrenceFlag(
  seed: FlagSeed,
  parent: Flag,
  createdOn: string,
  pass: ObservationPass,
): Flag {
  return {
    ...makeFlag(seed, createdOn),
    // 复发属于扩大后范围的一部分时，沿用跟进标记的约束范围。
    scope: parent.scope,
    observationPassId: pass.id,
    followUpOfId: parent.id,
    followUpType: "recurrence",
    history: [
      {
        id: createId("flh"),
        at: createdOn,
        action: "created",
        note: `${pass.observedOn} 的观测再次命中，前次处理已关闭，按复发重新建标。`,
      },
    ],
  };
}

export interface RecordedFlagsOutcome {
  /** 新追加的标记（全新问题或复发跟进）。 */
  flags: Flag[];
  /** 已开放标记被再次命中，只追加流水、不重复建标。 */
  updatedFlags: Flag[];
}

/**
 * 记录一次观测派生出的标记，重复操作语义：
 * - 同代码同材料已有开放标记：不建重复标记，只追加一条 recurrence-observed；
 * - 前次处理已关闭后再次命中：新建开放的复发跟进标记，链接到原标记；
 * - 其余情况：新建普通标记。
 */
export function recordObservationFlags(
  pass: ObservationPass,
  accessions: Accession[],
  existingFlags: Flag[],
): RecordedFlagsOutcome {
  const createdOn = new Date().toISOString();
  const sameKey = (flag: Flag, seed: FlagSeed) =>
    flag.trialId === seed.trialId &&
    flag.accessionId === seed.accessionId &&
    flag.code === seed.code;
  const flags: Flag[] = [];
  const updatedFlags: Flag[] = [];
  buildFlagSeeds(pass, accessions).forEach((seed) => {
    const active = existingFlags.find(
      (flag) => flag.state === "open" && sameKey(flag, seed),
    );
    if (active) {
      updatedFlags.push(
        appendHistory(
          active,
          "recurrence-observed",
          `${pass.observedOn} 的观测再次命中该标记，沿用当前开放标记，不重复建标。`,
        ),
      );
      return;
    }
    const latestClosed = existingFlags
      .filter((flag) => isFlagClosed(flag) && sameKey(flag, seed))
      .sort((left, right) => right.createdOn.localeCompare(left.createdOn))[0];
    if (latestClosed) {
      flags.push(makeRecurrenceFlag(seed, latestClosed, createdOn, pass));
    } else {
      flags.push(makeFlag(seed, createdOn));
    }
  });
  return { flags, updatedFlags };
}

export function displayDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function escalatableSeverities(flag: Flag): FlagSeverity[] {
  return (["warning", "critical"] as FlagSeverity[]).filter(
    (severity) => SEVERITY_RANK[severity] >= SEVERITY_RANK[flag.severity],
  );
}

export type { FlagScope, FlagState };
