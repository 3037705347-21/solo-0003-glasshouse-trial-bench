import { useMemo, useState } from "react";
import { AlertTriangle, History } from "lucide-react";
import type { Bench, BenchOperationalStatus } from "../../domain/types";
import {
  benchOccupancy,
  benchOperationalStatus,
  benchStatusNote,
  changeBenchStatus,
  validateBenchReady,
} from "../../domain/bench";
import { Button } from "../../components/Button";
import { TextAreaField } from "../../components/fields";
import type { FieldError } from "../../domain/result";
import { useWorkspace } from "../../state/store";

interface BenchStatusDialogProps {
  bench: Bench;
  target: BenchOperationalStatus;
  onSaved: () => void;
  onCancel: () => void;
}

const STATUS_LABEL: Record<BenchOperationalStatus, string> = {
  available: "可用",
  blocked: "受限",
  quarantine: "隔离",
};

export function BenchStatusDialog({
  bench,
  target,
  onSaved,
  onCancel,
}: BenchStatusDialogProps) {
  const { state, dispatch } = useWorkspace();
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldError[]>([]);

  const readyIssues = useMemo(
    () => (target === "available" ? validateBenchReady(bench, state) : []),
    [bench, state, target],
  );

  const errorFor = (field: string): string | undefined =>
    errors.find((error) => error.field === field)?.message;

  const occupancy = benchOccupancy(bench);
  const current = benchOperationalStatus(bench);

  const handleSubmit = () => {
    const result = changeBenchStatus(bench, target, reason, state);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    dispatch({ type: "bench/statusChanged", bench: result.value });
    onSaved();
  };

  return (
    <form
      className="editor-form"
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
      data-testid="bench-status-form"
    >
      <p className="muted-copy">
        将 <strong>{bench.code}</strong>（{bench.sector}，占用 {occupancy}/
        {bench.capacity}）从「{STATUS_LABEL[current]}」切换为「
        {STATUS_LABEL[target]}」。
      </p>

      {target === "available" ? (
        readyIssues.length > 0 ? (
          <div className="status-check status-check-blocked" data-testid="bench-ready-blocked">
            <AlertTriangle size={18} aria-hidden="true" />
            <div>
              <strong>恢复前校验未通过</strong>
              <ul className="status-issue-list">
                {readyIssues.map((issue, index) => (
                  <li key={`${issue.code}-${index}`}>{issue.message}</li>
                ))}
              </ul>
              <p className="muted-copy">
                请先在编辑或布局页面处理上述问题，再恢复台架。
              </p>
            </div>
          </div>
        ) : (
          <div className="status-check status-check-ready" data-testid="bench-ready-ok">
            <AlertTriangle size={18} aria-hidden="true" />
            <div>
              <strong>恢复前校验通过</strong>
              <p className="muted-copy">
                {occupancy > 0
                  ? `台上 ${occupancy} 个材料仍与当前光照兼容，容量充足。`
                  : "台架空置，可立即恢复使用。"}
              </p>
            </div>
          </div>
        )
      ) : (
        <TextAreaField
          label={target === "quarantine" ? "隔离原因" : "受限原因"}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          error={errorFor("reason")}
          hint={
            target === "quarantine"
              ? "例如：发现疑似病虫害，隔离待检"
              : "例如：滴灌管路维修中"
          }
          rows={3}
          data-testid="bench-status-reason"
        />
      )}

      {target === "available" ? (
        <TextAreaField
          label="处理说明（可选）"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          hint="会写入该台架的维护记录"
          rows={2}
          data-testid="bench-restore-note"
        />
      ) : null}

      {bench.statusHistory && bench.statusHistory.length > 0 ? (
        <details className="status-history">
          <summary>
            <History size={14} aria-hidden="true" />
            维护记录（{bench.statusHistory.length}）
          </summary>
          <ul className="status-history-list">
            {bench.statusHistory.slice(0, 6).map((record) => (
              <li key={record.id}>
                <span>
                  {STATUS_LABEL[record.from]} → {STATUS_LABEL[record.to]}
                </span>
                <p>{record.reason || "（未记录说明）"}</p>
                <time>{new Date(record.changedOn).toLocaleString()}</time>
              </li>
            ))}
          </ul>
        </details>
      ) : null}

      {benchStatusNote(bench) && current !== "available" ? (
        <p className="muted-copy">当前原因：{benchStatusNote(bench)}</p>
      ) : null}

      {errorFor("status") ? (
        <p className="form-level-error">{errorFor("status")}</p>
      ) : null}

      <div className="editor-actions">
        <Button tone="secondary" onClick={onCancel}>
          取消
        </Button>
        <Button
          type="submit"
          tone={target === "available" ? "primary" : "danger"}
          disabled={readyIssues.length > 0}
          data-testid="confirm-bench-status"
        >
          切换为{STATUS_LABEL[target]}
        </Button>
      </div>
    </form>
  );
}
