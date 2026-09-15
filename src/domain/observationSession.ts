import type {
  Flag,
  ObservationEntry,
  ObservationPass,
  WorkspaceState,
} from "./types";
import { createId } from "./id";
import { fail, fieldError, ok, type FieldError, type Result } from "./result";
import { isAccessionRetired } from "./accession";
import { deriveFlags, validateObservationDraft } from "./observation";
import { todayDateOnly } from "./rules";

/**
 * 现场巡场录入会话。
 *
 * 会话身份：每个会话持有唯一 `sess_*` 编号，同一试验同一时间只有一个
 * 进行中的会话。会话写出的观测记录使用确定性编号
 * `obs_{会话编号}_{提交序号}` 作为幂等键，恢复后重试或重复提交不会产生
 * 重复记录。
 *
 * 归属：每条测量行始终处于四种状态之一——待提交、已跳过、已失效、
 * 已提交。已提交行记录其归属的观测记录编号，不再允许修改或重复写入。
 *
 * 冲突处理：恢复会话、工作区状态变化以及每次提交前都会重新对账，
 * 把已被停用、被移除、跨试验或同日已被其他会话记录的材料行标记为
 * 失效并说明原因；失效原因消失（例如材料恢复使用）时行自动回到
 * 待提交状态。部分提交只写入当前有效的待提交行。
 */
export type SessionEntryStatus = "open" | "skipped" | "stale" | "committed";

export interface ObservationSessionEntry extends ObservationEntry {
  status: SessionEntryStatus;
  staleReason?: string;
  committedPassId?: string;
}

export interface ObservationSession {
  id: string;
  trialId: string;
  observedOn: string;
  observer: string;
  createdAt: string;
  updatedAt: string;
  commitSeq: number;
  entries: ObservationSessionEntry[];
}

export interface SessionEntryCounts {
  open: number;
  skipped: number;
  stale: number;
  committed: number;
}

export function sessionPassId(sessionId: string, commitSeq: number): string {
  return `obs_${sessionId}_${commitSeq}`;
}

export function openSessionEntry(accessionId = ""): ObservationSessionEntry {
  return {
    accessionId,
    heightMm: 80,
    leafCount: 8,
    ecMs: 1.8,
    notes: "",
    status: "open",
  };
}

export function createObservationSession(
  trialId: string,
  accessionId = "",
): ObservationSession {
  const now = new Date().toISOString();
  return {
    id: createId("sess"),
    trialId,
    observedOn: todayDateOnly(),
    observer: "",
    createdAt: now,
    updatedAt: now,
    commitSeq: 0,
    entries: [openSessionEntry(accessionId)],
  };
}

export function isObservationSession(
  value: unknown,
): value is ObservationSession {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<ObservationSession>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.trialId === "string" &&
    typeof candidate.observedOn === "string" &&
    typeof candidate.observer === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.commitSeq === "number" &&
    Array.isArray(candidate.entries)
  );
}

export function sessionEntryCounts(
  session: ObservationSession,
): SessionEntryCounts {
  return session.entries.reduce<SessionEntryCounts>(
    (counts, entry) => ({ ...counts, [entry.status]: counts[entry.status] + 1 }),
    { open: 0, skipped: 0, stale: 0, committed: 0 },
  );
}

export function isSessionComplete(session: ObservationSession): boolean {
  return (
    session.entries.length > 0 &&
    session.entries.every((entry) => entry.status === "committed")
  );
}

export function sessionBlocker(
  session: ObservationSession,
  state: WorkspaceState,
): string | null {
  const trial = state.trials.find((item) => item.id === session.trialId);
  if (!trial) {
    return "试验已不存在，会话无法继续提交";
  }
  if (trial.state !== "active" && trial.state !== "draft") {
    return "试验已暂停或已放行，不再接受新观测";
  }
  return null;
}

function ownPassIds(session: ObservationSession): Set<string> {
  const ids = new Set<string>();
  for (let seq = 0; seq < session.commitSeq; seq += 1) {
    ids.add(sessionPassId(session.id, seq));
  }
  return ids;
}

function staleReasonFor(
  entry: ObservationSessionEntry,
  session: ObservationSession,
  state: WorkspaceState,
): string | null {
  if (!entry.accessionId) {
    return null;
  }
  const accession = state.accessions.find(
    (item) => item.id === entry.accessionId,
  );
  if (!accession) {
    return "材料已不在登记清单中";
  }
  if (accession.trialId !== session.trialId) {
    return "材料不属于当前试验";
  }
  if (isAccessionRetired(accession)) {
    return `${accession.accessionNo} 已停用，不能进入新观测`;
  }
  const own = ownPassIds(session);
  const recordedElsewhere = state.observationPasses.some(
    (pass) =>
      pass.trialId === session.trialId &&
      pass.observedOn === session.observedOn &&
      !own.has(pass.id) &&
      pass.entries.some((item) => item.accessionId === entry.accessionId),
  );
  if (recordedElsewhere) {
    return `${accession.accessionNo} 在该观测日期已有其他观测记录`;
  }
  return null;
}

export function reconcileSession(
  session: ObservationSession,
  state: WorkspaceState,
): ObservationSession {
  let changed = false;
  const entries = session.entries.map((entry) => {
    if (entry.status === "committed" || entry.status === "skipped") {
      return entry;
    }
    const reason = staleReasonFor(entry, session, state);
    if (reason) {
      if (entry.status === "stale" && entry.staleReason === reason) {
        return entry;
      }
      changed = true;
      return { ...entry, status: "stale" as const, staleReason: reason };
    }
    if (entry.status === "open" && !entry.staleReason) {
      return entry;
    }
    changed = true;
    return { ...entry, status: "open" as const, staleReason: undefined };
  });
  return changed ? { ...session, entries } : session;
}

export interface SessionCommit {
  pass: ObservationPass;
  flags: Flag[];
  session: ObservationSession;
  committedCount: number;
}

export function commitSession(
  session: ObservationSession,
  state: WorkspaceState,
): Result<SessionCommit> {
  const blocker = sessionBlocker(session, state);
  if (blocker) {
    return fail([fieldError("session", "blocked", blocker)]);
  }
  const reconciled = reconcileSession(session, state);
  const submittable = reconciled.entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.status === "open");
  if (submittable.length === 0) {
    return fail([
      fieldError(
        "entries",
        "empty",
        "没有可提交的测量记录：剩余行均已跳过或失效",
      ),
    ]);
  }
  const draft = {
    trialId: reconciled.trialId,
    observedOn: reconciled.observedOn,
    observer: reconciled.observer,
    entries: submittable.map(({ entry }) => ({
      accessionId: entry.accessionId,
      heightMm: entry.heightMm,
      leafCount: entry.leafCount,
      ecMs: entry.ecMs,
      notes: entry.notes,
    })),
  };
  const validated = validateObservationDraft(draft, state);
  if (!validated.ok) {
    return fail(
      validated.errors.map((error) => remapEntryError(error, submittable)),
    );
  }
  const passId = sessionPassId(session.id, session.commitSeq);
  const pass: ObservationPass = {
    id: passId,
    trialId: validated.value.trialId,
    observedOn: validated.value.observedOn,
    observer: validated.value.observer,
    entries: validated.value.entries.map((entry) => ({ ...entry })),
  };
  const flags = deriveFlags(pass, state.accessions);
  const committedIndexes = new Set(submittable.map(({ index }) => index));
  const nextSession: ObservationSession = {
    ...reconciled,
    observer: validated.value.observer,
    commitSeq: session.commitSeq + 1,
    updatedAt: new Date().toISOString(),
    entries: reconciled.entries.map((entry, index) =>
      committedIndexes.has(index)
        ? {
            ...entry,
            status: "committed",
            staleReason: undefined,
            committedPassId: passId,
          }
        : entry,
    ),
  };
  return ok({
    pass,
    flags,
    session: nextSession,
    committedCount: submittable.length,
  });
}

function remapEntryError(
  error: FieldError,
  submittable: Array<{ index: number }>,
): FieldError {
  const match = /^entries\.(\d+)\.(.*)$/.exec(error.field);
  if (!match) {
    return error;
  }
  const sessionIndex = submittable[Number(match[1])]?.index;
  return sessionIndex === undefined
    ? error
    : { ...error, field: `entries.${sessionIndex}.${match[2]}` };
}
