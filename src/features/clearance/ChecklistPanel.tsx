import { useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { Button } from "../../components/Button";
import { StatusBadge } from "../../components/StatusBadge";
import type { ToastMessage } from "../../components/Toast";
import {
  CLEARANCE_CHECK_DEFINITIONS,
  clearanceCheckDefinition,
  confirmClearanceCheck,
  describeCheckStatus,
  isCheckRecordStale,
  summarizeChecks,
  buildClearanceChecks,
} from "../../domain/clearance";
import type {
  ClearanceCheckKey,
  ClearanceCheckStatus,
} from "../../domain/types";
import { checkDraftForTrial } from "../../state/selectors";
import { useWorkspace } from "../../state/store";

interface ChecklistPanelProps {
  trialId: string;
  onToast: (toast: Omit<ToastMessage, "id">) => void;
}

function statusBadgeTone(status: ClearanceCheckStatus) {
  if (status === "confirmed") {
    return "positive" as const;
  }
  if (status === "not-applicable") {
    return "info" as const;
  }
  return "warning" as const;
}

function displayDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function ChecklistPanel({ trialId, onToast }: ChecklistPanelProps) {
  const { state, dispatch } = useWorkspace();
  const draft = checkDraftForTrial(state, trialId);
  const checks = buildClearanceChecks(state, trialId);
  const summary = summarizeChecks(checks);

  const [confirmer, setConfirmer] = useState(
    () =>
      draft?.records.find((record) => record.confirmedBy)?.confirmedBy ?? "",
  );
  const [notes, setNotes] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {};
    draft?.records.forEach((record) => {
      initial[record.key] = record.note;
    });
    return initial;
  });
  const [error, setError] = useState<string | null>(null);

  const recordFor = (key: ClearanceCheckKey) =>
    draft?.records.find((record) => record.key === key);

  const handleDecide = (
    key: ClearanceCheckKey,
    status: "confirmed" | "not-applicable",
  ) => {
    const result = confirmClearanceCheck(state, trialId, key, {
      status,
      note: notes[key] ?? "",
      confirmedBy: confirmer,
    });
    if (!result.ok) {
      setError(result.errors[0]?.message ?? "确认失败");
      return;
    }
    setError(null);
    dispatch({ type: "clearance-check/saved", trialId, record: result.value });
    onToast({
      tone: "success",
      title: status === "confirmed" ? "检查项已确认" : "已标记为不适用",
      message: `${clearanceCheckDefinition(key).title}的处理结果已保存，将随下一份快照固定。`,
    });
  };

  const handleClear = (key: ClearanceCheckKey) => {
    dispatch({ type: "clearance-check/cleared", trialId, key });
    setError(null);
    onToast({
      tone: "info",
      title: "已撤销确认",
      message: `${clearanceCheckDefinition(key).title}恢复为未确认。`,
    });
  };

  return (
    <section className="content-panel" data-testid="clearance-checklist">
      <div className="panel-heading">
        <div>
          <span className="panel-title">放行前确认清单</span>
          <span className="panel-subtitle">
            人工确认项不会计入自动阻止项，但会随下一份放行快照固定留痕
          </span>
        </div>
        <ClipboardCheck size={20} className="panel-icon" aria-hidden="true" />
      </div>
      <div className="checklist-body">
        <label className="field checklist-confirmer" htmlFor="checklist-confirmer">
          <span className="field-label">确认人</span>
          <input
            id="checklist-confirmer"
            className="field-input"
            value={confirmer}
            onChange={(event) => setConfirmer(event.target.value)}
            placeholder="填写确认人姓名（可选）"
            data-testid="checklist-confirmer"
          />
        </label>
        <ul className="checklist-items">
          {CLEARANCE_CHECK_DEFINITIONS.map((definition) => {
            const record = recordFor(definition.key);
            const status: ClearanceCheckStatus = record
              ? record.status
              : "unconfirmed";
            const stale = record
              ? isCheckRecordStale(state, trialId, record)
              : false;
            const noteValue = notes[definition.key] ?? "";
            const noteDirty = record ? noteValue !== record.note : false;
            return (
              <li
                className="checklist-item"
                key={definition.key}
                data-testid={`checklist-item-${definition.key}`}
              >
                <div className="checklist-item-main">
                  <div className="checklist-item-head">
                    <strong>{definition.title}</strong>
                    <StatusBadge tone={statusBadgeTone(status)}>
                      {describeCheckStatus(status)}
                    </StatusBadge>
                    {stale ? (
                      <StatusBadge tone="warning">已变化</StatusBadge>
                    ) : null}
                  </div>
                  <p>{definition.description}</p>
                  {record ? (
                    <small className="checklist-item-meta">
                      由 {record.confirmedBy || "未署名"} 于{" "}
                      {displayDateTime(record.confirmedAt)} 记录
                      {record.note ? ` · 备注：${record.note}` : ""}
                    </small>
                  ) : null}
                  {stale ? (
                    <small className="checklist-stale-hint">
                      确认后现场信息已变化，请重新确认后再生成快照。
                    </small>
                  ) : null}
                  <input
                    className="field-input checklist-note-input"
                    value={noteValue}
                    onChange={(event) =>
                      setNotes((current) => ({
                        ...current,
                        [definition.key]: event.target.value,
                      }))
                    }
                    placeholder="备注（可选，随确认一起保存）"
                    aria-label={`${definition.title}备注`}
                    data-testid={`checklist-note-${definition.key}`}
                  />
                  {noteDirty ? (
                    <small className="checklist-stale-hint">
                      备注已修改，再次点击确认或不适用后保存。
                    </small>
                  ) : null}
                </div>
                <div className="checklist-item-actions">
                  <Button
                    size="sm"
                    onClick={() => handleDecide(definition.key, "confirmed")}
                    data-testid={`checklist-confirm-${definition.key}`}
                  >
                    确认
                  </Button>
                  <Button
                    size="sm"
                    tone="secondary"
                    onClick={() => handleDecide(definition.key, "not-applicable")}
                    data-testid={`checklist-na-${definition.key}`}
                  >
                    不适用
                  </Button>
                  {record ? (
                    <Button
                      size="sm"
                      tone="ghost"
                      onClick={() => handleClear(definition.key)}
                      data-testid={`checklist-clear-${definition.key}`}
                    >
                      撤销
                    </Button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        {error ? <p className="form-level-error">{error}</p> : null}
        <p className="checklist-summary" data-testid="checklist-summary">
          已确认 {summary.confirmed} 项 · 不适用 {summary.notApplicable} 项 ·
          未确认 {summary.unconfirmed} 项；未确认项不会阻止放行，但会在放行结果中说明。
        </p>
      </div>
    </section>
  );
}
