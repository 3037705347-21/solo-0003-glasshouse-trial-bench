import { useState } from "react";
import { Wrench } from "lucide-react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { TextAreaField } from "../../components/fields";
import {
  BENCH_IMPACT_LABELS,
  BENCH_LIGHT_LABELS,
  BENCH_STATUS_LABELS,
  benchInspectionCategoryLabel,
  benchMaintenanceActionLabel,
  benchStatusChangedSinceInspection,
  completeBenchInspectionFollowUp,
  resolveBenchInspection,
} from "../../domain/benchInspection";
import type { FieldError } from "../../domain/result";
import type { Bench, BenchInspection } from "../../domain/types";
import { useWorkspace } from "../../state/store";

interface InspectionDialogProps {
  inspection: BenchInspection;
  bench?: Bench;
  onCancel: () => void;
  onSaved: (inspection: BenchInspection) => void;
}

function formatDateTime(value?: string): string {
  if (!value) {
    return "尚未登记";
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function ResolveInspectionDialog({
  inspection,
  bench,
  onCancel,
  onSaved,
}: InspectionDialogProps) {
  const { dispatch } = useWorkspace();
  const [note, setNote] = useState("");
  const [rechecked, setRechecked] = useState(false);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const errorFor = (field: string) =>
    errors.find((error) => error.field === field)?.message;

  const statusChanged =
    bench !== undefined &&
    benchStatusChangedSinceInspection(inspection, bench);

  const handleSubmit = () => {
    const result = resolveBenchInspection(
      inspection,
      bench,
      note,
      rechecked,
    );
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    dispatch({ type: "benchInspection/resolved", inspection: result.value });
    onSaved(result.value);
  };

  return (
    <Dialog open title="解除巡检异常" onClose={onCancel} wide>
      <form
        className="editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
        data-testid="resolve-inspection-form"
      >
        <div className="lifecycle-callout">
          <strong>
            {bench ? `${bench.code} · ` : ""}
            {benchInspectionCategoryLabel(inspection.category)}
          </strong>
          <span>{inspection.anomalyDescription}</span>
          <span>
            影响：{BENCH_IMPACT_LABELS[inspection.impact]} · 处置建议：
            {inspection.handlingSuggestion}
          </span>
        </div>
        {statusChanged ? (
          <div className="inspection-status-drift" data-testid="inspection-status-drift">
            <strong>台架状态在巡检后已经变化</strong>
            <dl>
              <div>
                <dt>巡检时</dt>
                <dd>
                  {BENCH_STATUS_LABELS[inspection.benchStatusAtInspection]}
                  {" · "}
                  {BENCH_LIGHT_LABELS[inspection.lightProfileAtInspection]}
                  {inspection.blockedReasonAtInspection
                    ? ` · ${inspection.blockedReasonAtInspection}`
                    : ""}
                </dd>
              </div>
              <div>
                <dt>当前</dt>
                <dd>
                  {bench ? BENCH_STATUS_LABELS[bench.status] : "台架已不存在"}
                  {" · "}
                  {bench ? BENCH_LIGHT_LABELS[bench.lightProfile] : "—"}
                  {bench?.blockedReason ? ` · ${bench.blockedReason}` : ""}
                </dd>
              </div>
            </dl>
            <label className="checkbox-field">
              <input
                type="checkbox"
                checked={rechecked}
                onChange={(event) => setRechecked(event.target.checked)}
                data-testid="inspection-recheck-confirm"
              />
              <span>
                我已按当前台架情况重新核对，异常确已解除，不会影响在架材料
              </span>
            </label>
          </div>
        ) : null}
        <TextAreaField
          label="解除说明"
          rows={4}
          value={note}
          onChange={(event) => setNote(event.target.value)}
          error={errorFor("resolutionNote")}
          hint="记录实际处置结果和复检结论；解除后记录仍保留在历史中"
          data-testid="inspection-resolution-note"
        />
        {errorFor("statusRechecked") ? (
          <p className="form-level-error">{errorFor("statusRechecked")}</p>
        ) : null}
        <div className="editor-actions">
          <Button tone="secondary" type="button" onClick={onCancel}>
            取消
          </Button>
          <Button type="submit" data-testid="confirm-resolve-inspection">
            确认解除
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

export function FollowUpInspectionDialog({
  inspection,
  bench,
  onCancel,
  onSaved,
}: InspectionDialogProps) {
  const { dispatch } = useWorkspace();
  const [errors, setErrors] = useState<FieldError[]>([]);

  const handleSubmit = () => {
    const result = completeBenchInspectionFollowUp(inspection);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    dispatch({
      type: "benchInspection/followUpCompleted",
      inspection: result.value,
    });
    onSaved(result.value);
  };

  return (
    <Dialog open title="登记维护完成" onClose={onCancel}>
      <form
        className="editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
        data-testid="followup-inspection-form"
      >
        <div className="lifecycle-callout">
          <strong>
            <Wrench size={15} aria-hidden="true" />{" "}
            {benchMaintenanceActionLabel(inspection.maintenanceAction)}
          </strong>
          <span>
            {bench ? `${bench.code} · ` : ""}
            {benchInspectionCategoryLabel(inspection.category)}：
            {inspection.anomalyDescription || "本次巡检正常"}
          </span>
          <span>
            当前完成时间：
            {formatDateTime(inspection.followUpCompletedAt)}
          </span>
        </div>
        <p className="muted-copy">
          登记维护完成只记录后续动作的执行情况，不会自动解除异常。异常是否解除需要单独确认。
        </p>
        {errors[0] ? (
          <p className="form-level-error">{errors[0].message}</p>
        ) : null}
        <div className="editor-actions">
          <Button tone="secondary" type="button" onClick={onCancel}>
            取消
          </Button>
          <Button type="submit" data-testid="confirm-followup-inspection">
            登记维护完成
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
