import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "../../components/Button";
import { SelectField, TextField } from "../../components/fields";
import { StatusBadge } from "../../components/StatusBadge";
import type { ObservationEntry } from "../../domain/types";
import type { FieldError } from "../../domain/result";
import {
  commitSession,
  createObservationSession,
  isSessionComplete,
  openSessionEntry,
  reconcileSession,
  sessionBlocker,
  sessionEntryCounts,
  type ObservationSession,
  type SessionEntryStatus,
} from "../../domain/observationSession";
import {
  findOpenSessionForTrial,
  removeObservationSession,
  saveObservationSession,
} from "../../state/observationSessions";
import { activeAccessionsForTrial } from "../../state/selectors";
import { useWorkspace } from "../../state/store";

interface PassFormProps {
  trialId: string;
  onSaved: () => void;
  onCancel: () => void;
}

const ENTRY_STATUS_LABEL: Record<SessionEntryStatus, string> = {
  open: "待提交",
  skipped: "已跳过",
  stale: "已失效",
  committed: "已提交",
};

const ENTRY_STATUS_TONE: Record<
  SessionEntryStatus,
  "neutral" | "positive" | "warning" | "critical" | "info"
> = {
  open: "info",
  skipped: "warning",
  stale: "critical",
  committed: "positive",
};

function formatSessionTime(iso: string): string {
  const parsed = new Date(iso);
  return Number.isNaN(parsed.getTime())
    ? iso
    : parsed.toLocaleString("zh-CN", { hour12: false });
}

export function PassForm({ trialId, onSaved, onCancel }: PassFormProps) {
  const { state, dispatch } = useWorkspace();
  const accessions = activeAccessionsForTrial(state, trialId);
  const [initial] = useState(() => {
    const existing = findOpenSessionForTrial(trialId);
    return existing
      ? { session: reconcileSession(existing, state), resumed: true }
      : {
          session: createObservationSession(trialId, accessions[0]?.id ?? ""),
          resumed: false,
        };
  });
  const [session, setSession] = useState<ObservationSession>(initial.session);
  const [resumed] = useState(initial.resumed);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  // 每次变更都落盘，巡场途中关闭对话框或刷新页面都不会丢失。
  useEffect(() => {
    saveObservationSession(session);
  }, [session]);

  // 工作区状态变化（材料停用/恢复、其他页面写入观测等）时重新对账，
  // 让失效行立刻显形，而不是假装仍然有效。
  useEffect(() => {
    setSession((current) => reconcileSession(current, state));
  }, [state]);

  const counts = sessionEntryCounts(session);
  const blocker = sessionBlocker(session, state);
  const locked = session.commitSeq > 0;
  const nonCommitted = counts.open + counts.skipped + counts.stale;

  const errorFor = (field: string): string | undefined => {
    return errors.find((error) => error.field === field)?.message;
  };

  const touch = (
    updater: (current: ObservationSession) => ObservationSession,
  ) => {
    setSession((current) => ({
      ...updater(current),
      updatedAt: new Date().toISOString(),
    }));
  };

  const updateEntry = (
    index: number,
    key: keyof ObservationEntry,
    value: string | number,
  ) => {
    touch((current) => ({
      ...current,
      entries: current.entries.map((entry, entryIndex) =>
        entryIndex === index && entry.status === "open"
          ? {
              ...entry,
              [key]:
                key === "accessionId" || key === "notes"
                  ? value
                  : Number(value),
            }
          : entry,
      ),
    }));
  };

  const addEntry = () => {
    const used = new Set(
      session.entries
        .filter((entry) => entry.status !== "committed")
        .map((entry) => entry.accessionId),
    );
    const fallback =
      accessions.find((accession) => !used.has(accession.id)) ?? accessions[0];
    touch((current) => ({
      ...current,
      entries: [...current.entries, openSessionEntry(fallback?.id ?? "")],
    }));
  };

  const skipEntry = (index: number) => {
    touch((current) => ({
      ...current,
      entries: current.entries.map((entry, entryIndex) =>
        entryIndex === index && entry.status === "open"
          ? { ...entry, status: "skipped" }
          : entry,
      ),
    }));
  };

  const resumeEntry = (index: number) => {
    touch((current) =>
      reconcileSession(
        {
          ...current,
          entries: current.entries.map((entry, entryIndex) =>
            entryIndex === index && entry.status === "skipped"
              ? { ...entry, status: "open" as const }
              : entry,
          ),
        },
        state,
      ),
    );
  };

  const removeEntry = (index: number) => {
    const next: ObservationSession = {
      ...session,
      entries: session.entries.filter(
        (_, entryIndex) => entryIndex !== index,
      ),
      updatedAt: new Date().toISOString(),
    };
    if (next.entries.length === 0 || isSessionComplete(next)) {
      // 没有未提交内容可留恋：清空会话并结束，已提交内容留在观测历史中。
      removeObservationSession(session.id);
      onCancel();
      return;
    }
    setSession(next);
  };

  const discardSession = () => {
    removeObservationSession(session.id);
    onCancel();
  };

  const handleSubmit = () => {
    const result = commitSession(session, state);
    if (!result.ok) {
      setErrors(result.errors);
      setNotice(null);
      return;
    }
    const { pass, flags, session: nextSession, committedCount } = result.value;
    dispatch({ type: "observation/recorded", pass, flags });
    setErrors([]);
    if (isSessionComplete(nextSession)) {
      removeObservationSession(nextSession.id);
      onSaved();
      return;
    }
    const remaining = sessionEntryCounts(nextSession);
    setSession(nextSession);
    setNotice(
      `已提交 ${committedCount} 条测量记录（观测编号 ${pass.id}）；` +
        `${remaining.skipped} 条已跳过、${remaining.stale} 条已失效仍归属本会话，可稍后继续。`,
    );
  };

  const trialLabel = useMemo(
    () =>
      state.trials.find((trial) => trial.id === trialId)?.code ?? "当前试验",
    [state.trials, trialId],
  );

  const accessionLabel = (accessionId: string): string => {
    const accession = state.accessions.find((item) => item.id === accessionId);
    return accession
      ? `${accession.accessionNo} - ${accession.cultivar}`
      : accessionId || "未选择";
  };

  const discardCopy =
    nonCommitted > 0
      ? `未提交的 ${nonCommitted} 条内容将被丢弃；已提交的 ${counts.committed} 条保留在观测历史中。`
      : "所有内容均已提交，仅清除会话占位。";

  return (
    <form
      className="editor-form"
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
      data-testid="observation-form"
    >
      <div className="session-banner" data-testid="session-banner">
        <div className="session-banner-copy">
          <strong>
            {resumed ? "已恢复未完成的录入会话" : "新的录入会话"}
          </strong>
          <span>
            会话 {session.id} · 创建于 {formatSessionTime(session.createdAt)}
            {session.commitSeq > 0 ? ` · 已写入 ${session.commitSeq} 次` : ""}
          </span>
          <span className="session-counts">
            <StatusBadge tone="info">{`待提交 ${counts.open}`}</StatusBadge>
            <StatusBadge tone="warning">{`已跳过 ${counts.skipped}`}</StatusBadge>
            <StatusBadge tone="critical">{`已失效 ${counts.stale}`}</StatusBadge>
            <StatusBadge tone="positive">{`已提交 ${counts.committed}`}</StatusBadge>
          </span>
        </div>
        <Button
          tone="ghost"
          size="sm"
          onClick={() => setConfirmingDiscard(true)}
          data-testid="discard-session-button"
        >
          放弃会话
        </Button>
      </div>
      {confirmingDiscard ? (
        <div className="session-discard-confirm">
          <span>{discardCopy}</span>
          <Button
            tone="danger"
            size="sm"
            onClick={discardSession}
            data-testid="confirm-discard-session"
          >
            确认放弃
          </Button>
          <Button
            tone="secondary"
            size="sm"
            onClick={() => setConfirmingDiscard(false)}
          >
            取消
          </Button>
        </div>
      ) : null}
      {blocker ? (
        <p className="form-level-error" data-testid="session-blocker">
          {blocker}
        </p>
      ) : null}
      {notice ? (
        <p className="session-notice" data-testid="session-notice">
          {notice}
        </p>
      ) : null}
      <div className="form-grid">
        <TextField label="试验" value={trialLabel} readOnly />
        <TextField
          label="观测日期"
          type="date"
          value={session.observedOn}
          readOnly={locked}
          onChange={(event) =>
            touch((current) => ({
              ...current,
              observedOn: event.target.value,
            }))
          }
          error={errorFor("observedOn")}
          hint={locked ? "会话已部分提交，观测日期已锁定归属" : undefined}
        />
        <TextField
          label="观测人"
          value={session.observer}
          readOnly={locked}
          onChange={(event) =>
            touch((current) => ({ ...current, observer: event.target.value }))
          }
          error={errorFor("observer")}
          hint={locked ? "会话已部分提交，观测人已锁定归属" : undefined}
          data-testid="observer-input"
        />
      </div>
      <div className="entry-editor">
        <div className="entry-editor-heading">
          <h3>测量记录</h3>
          <Button tone="secondary" size="sm" onClick={addEntry} type="button">
            <Plus size={15} />
            添加行
          </Button>
        </div>
        {session.entries.map((entry, index) => {
          const editable = entry.status === "open";
          const removeDisabled =
            nonCommitted === 1 && counts.committed === 0;
          return (
            <div
              className={`entry-row entry-row-${entry.status}`}
              key={`${index}-${entry.accessionId}`}
            >
              <div className="entry-row-head">
                <StatusBadge tone={ENTRY_STATUS_TONE[entry.status]}>
                  {ENTRY_STATUS_LABEL[entry.status]}
                </StatusBadge>
                {entry.status === "stale" && entry.staleReason ? (
                  <span className="entry-stale-reason">
                    {entry.staleReason}
                  </span>
                ) : null}
                {entry.status === "committed" && entry.committedPassId ? (
                  <span className="entry-committed-ref">
                    已写入观测记录 {entry.committedPassId}
                  </span>
                ) : null}
                <span className="entry-row-actions">
                  {entry.status === "open" ? (
                    <Button
                      tone="ghost"
                      size="sm"
                      onClick={() => skipEntry(index)}
                      aria-label={`跳过第 ${index + 1} 行`}
                    >
                      跳过
                    </Button>
                  ) : null}
                  {entry.status === "skipped" ? (
                    <Button
                      tone="ghost"
                      size="sm"
                      onClick={() => resumeEntry(index)}
                      aria-label={`恢复第 ${index + 1} 行`}
                    >
                      恢复填写
                    </Button>
                  ) : null}
                  {entry.status !== "committed" ? (
                    <Button
                      tone="ghost"
                      size="sm"
                      className="icon-button entry-remove"
                      onClick={() => removeEntry(index)}
                      disabled={removeDisabled}
                      aria-label={`移除第 ${index + 1} 行`}
                    >
                      <Trash2 size={16} />
                    </Button>
                  ) : null}
                </span>
              </div>
              <div className="entry-row-fields">
                {editable ? (
                  <SelectField
                    label="材料"
                    value={entry.accessionId}
                    onChange={(event) =>
                      updateEntry(index, "accessionId", event.target.value)
                    }
                    error={errorFor(`entries.${index}.accessionId`)}
                  >
                    <option value="">请选择材料</option>
                    {accessions.map((accession) => (
                      <option value={accession.id} key={accession.id}>
                        {accession.accessionNo} - {accession.cultivar}
                      </option>
                    ))}
                  </SelectField>
                ) : (
                  <div className="field">
                    <span className="field-label">材料</span>
                    <span className="entry-static-value">
                      {accessionLabel(entry.accessionId)}
                    </span>
                  </div>
                )}
                <TextField
                  label="株高（毫米）"
                  type="number"
                  value={entry.heightMm}
                  disabled={!editable}
                  onChange={(event) =>
                    updateEntry(index, "heightMm", event.target.value)
                  }
                  error={editable ? errorFor(`entries.${index}.heightMm`) : undefined}
                />
                <TextField
                  label="叶片数"
                  type="number"
                  value={entry.leafCount}
                  disabled={!editable}
                  onChange={(event) =>
                    updateEntry(index, "leafCount", event.target.value)
                  }
                  error={editable ? errorFor(`entries.${index}.leafCount`) : undefined}
                />
                <TextField
                  label="电导率 mS/cm"
                  type="number"
                  step="0.1"
                  value={entry.ecMs}
                  disabled={!editable}
                  onChange={(event) =>
                    updateEntry(index, "ecMs", event.target.value)
                  }
                  error={editable ? errorFor(`entries.${index}.ecMs`) : undefined}
                />
                <TextField
                  label="备注"
                  value={entry.notes}
                  disabled={!editable}
                  onChange={(event) =>
                    updateEntry(index, "notes", event.target.value)
                  }
                />
              </div>
            </div>
          );
        })}
        {errorFor("entries") ? (
          <p className="form-level-error">{errorFor("entries")}</p>
        ) : null}
        {errorFor("session") ? (
          <p className="form-level-error">{errorFor("session")}</p>
        ) : null}
      </div>
      <div className="editor-actions">
        <Button tone="secondary" onClick={onCancel}>
          取消
        </Button>
        <Button
          type="submit"
          data-testid="save-observation-button"
          disabled={Boolean(blocker)}
        >
          {counts.open > 0 ? `提交观测（${counts.open}）` : "提交观测"}
        </Button>
      </div>
    </form>
  );
}
