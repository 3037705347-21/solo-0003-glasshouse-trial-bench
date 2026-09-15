import { useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Wrench } from "lucide-react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { TextAreaField, TextField } from "../../components/fields";
import type { FieldError } from "../../domain/result";
import type { Accession, Bench, WorkspaceState } from "../../domain/types";
import {
  cancelBenchMaintenance,
  canStartBenchMaintenance,
  completeBenchMaintenance,
  relocateForMaintenance,
  relocationTargetCandidates,
  requestBenchMaintenance,
  startBenchMaintenance,
} from "../../domain/benchMaintenance";
import { isAccessionRetired } from "../../domain/accession";
import { useWorkspace } from "../../state/store";

function localDateTimeValue(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

interface MaintenanceDialogProps {
  bench: Bench;
  onClose: () => void;
  onSaved: (bench: Bench, message: string) => void;
}

/* ---------------- 申请维护 ---------------- */

export function RequestMaintenanceDialog({
  bench,
  onClose,
  onSaved,
}: MaintenanceDialogProps) {
  const { dispatch } = useWorkspace();
  const [requestedAt, setRequestedAt] = useState(localDateTimeValue);
  const [reason, setReason] = useState("");
  const [errors, setErrors] = useState<FieldError[]>([]);
  const errorFor = (field: string) =>
    errors.find((error) => error.field === field)?.message;

  const handleSubmit = () => {
    const result = requestBenchMaintenance(bench, { requestedAt, reason });
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    dispatch({ type: "bench/maintenance-requested", bench: result.value });
    onSaved(result.value, `台架 ${bench.code} 已进入待疏散状态，请为材料指定去处`);
  };

  return (
    <Dialog
      open
      wide
      title={`申请维护 ${bench.code}`}
      onClose={onClose}
    >
      <form
        className="editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
        data-testid="request-maintenance-form"
      >
        <div className="lifecycle-callout">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>
            申请后台架进入“待疏散”过渡态：新分配与直接移出会被冻结，
            台架上 {bench.assignedIds.length} 个材料需要逐个迁移到其他台架；
            全部清空后才会正式开始维护。取消申请可随时恢复使用。
          </span>
        </div>
        <div className="form-grid">
          <TextField
            label="申请时间"
            type="datetime-local"
            value={requestedAt}
            onChange={(event) => setRequestedAt(event.target.value)}
            error={errorFor("requestedAt")}
            data-testid="maintenance-request-date"
          />
          <TextAreaField
            label="维护原因"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            error={errorFor("reason")}
            className="field-span-2"
            rows={3}
            data-testid="maintenance-request-reason"
          />
        </div>
        <div className="editor-actions">
          <Button tone="secondary" type="button" onClick={onClose}>
            取消
          </Button>
          <Button type="submit" tone="danger" data-testid="confirm-request-maintenance">
            申请维护
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

/* ---------------- 待疏散 / 维护中 控制台 ---------------- */

interface PendingRowProps {
  accession: Accession;
  bench: Bench;
  state: WorkspaceState;
  onRelocated: (source: Bench, target: Bench) => void;
}

function PendingAccessionRow({
  accession,
  bench,
  state,
  onRelocated,
}: PendingRowProps) {
  const { dispatch } = useWorkspace();
  const candidates = useMemo(
    () => relocationTargetCandidates(state, accession, bench),
    [state, accession, bench],
  );
  const [targetId, setTargetId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>();
  const retired = isAccessionRetired(accession);

  const handleRelocate = () => {
    if (!targetId) {
      setError("请选择接收台架");
      return;
    }
    const result = relocateForMaintenance(
      state,
      bench.id,
      accession.id,
      targetId,
      note,
    );
    if (!result.ok) {
      setError(result.errors[0]?.message);
      return;
    }
    dispatch({
      type: "bench/maintenance-relocated",
      sourceBench: result.value.sourceBench,
      targetBench: result.value.targetBench,
    });
    onRelocated(result.value.sourceBench, result.value.targetBench);
  };

  return (
    <div className="evacuation-row" data-testid={`evacuation-row-${accession.id}`}>
      <div className="evacuation-accession">
        <strong>{accession.cultivar}</strong>
        <span>
          {accession.accessionNo}
          {retired ? " · 已停用（历史引用随材料保留）" : ""}
        </span>
      </div>
      <select
        className="compact-select"
        aria-label={`为 ${accession.accessionNo} 选择接收台架`}
        value={targetId}
        onChange={(event) => {
          setTargetId(event.target.value);
          setError(undefined);
        }}
        data-testid={`relocation-target-${accession.id}`}
      >
        <option value="">选择接收台架</option>
        {candidates.map((candidate) => (
          <option value={candidate.id} key={candidate.id}>
            {candidate.code} · {candidate.sector} ·{" "}
            {candidate.lightProfile === "full-sun"
              ? "全日照"
              : candidate.lightProfile === "partial-shade"
                ? "半阴"
                : "遮阴"}{" "}
            · 空位 {Math.max(0, candidate.capacity - candidate.assignedIds.length)}
          </option>
        ))}
      </select>
      <input
        className="field-input evacuation-note"
        type="text"
        placeholder="迁移备注（可选）"
        value={note}
        onChange={(event) => setNote(event.target.value)}
        aria-label={`${accession.accessionNo} 迁移备注`}
      />
      <Button
        tone="secondary"
        size="sm"
        onClick={handleRelocate}
        disabled={candidates.length === 0}
        data-testid={`relocate-accession-${accession.id}`}
      >
        <ArrowRight size={15} />
        迁移
      </Button>
      {error ? <p className="field-error evacuation-error">{error}</p> : null}
      {candidates.length === 0 && !error ? (
        <p className="field-error evacuation-error">
          没有光照兼容且有空位的接收台架
        </p>
      ) : null}
    </div>
  );
}

export function MaintenanceConsoleDialog({
  bench: initialBench,
  onClose,
  onSaved,
}: MaintenanceDialogProps) {
  const { state, dispatch } = useWorkspace();
  const bench = state.benches.find((item) => item.id === initialBench.id) ?? initialBench;
  const [endNote, setEndNote] = useState("");
  const [errors, setErrors] = useState<FieldError[]>([]);
  const errorFor = (field: string) =>
    errors.find((error) => error.field === field)?.message;

  const occupants = bench.assignedIds
    .map((id) => state.accessions.find((accession) => accession.id === id))
    .filter((accession): accession is Accession => Boolean(accession));
  const record = bench.maintenanceHistory[bench.maintenanceHistory.length - 1];
  const relocated = record?.relocations ?? [];
  const inMaintenance = bench.status === "maintenance";
  const startable = canStartBenchMaintenance(bench);

  const benchLabel = (id: string) => {
    const found = state.benches.find((item) => item.id === id);
    return found ? found.code : id;
  };

  const handleStart = () => {
    const result = startBenchMaintenance(bench);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    dispatch({ type: "bench/maintenance-started", bench: result.value });
    onSaved(result.value, `台架 ${bench.code} 已正式开始维护`);
  };

  const handleComplete = () => {
    const result = completeBenchMaintenance(bench, endNote);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    dispatch({ type: "bench/maintenance-completed", bench: result.value });
    onSaved(result.value, `台架 ${bench.code} 维护完成，已恢复可用`);
  };

  const handleCancel = () => {
    const result = cancelBenchMaintenance(bench, endNote);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    dispatch({ type: "bench/maintenance-cancelled", bench: result.value });
    const movedCount = record?.relocations.length ?? 0;
    onSaved(
      result.value,
      movedCount > 0
        ? `维护已取消：${movedCount} 次迁移记录保留，台架状态按当前占用恢复`
        : `维护已取消：台架已恢复申请前状态`,
    );
  };

  return (
    <Dialog
      open
      wide
      title={`维护流程 ${bench.code}`}
      onClose={onClose}
    >
      <div className="maintenance-console" data-testid="maintenance-console">
        <div className="lifecycle-callout">
          <Wrench size={18} aria-hidden="true" />
          <span>
            {record?.reason}
            {"　"}
            已迁移 {relocated.length} 个材料
            {inMaintenance ? "，台架正在维护中。" : `，尚待疏散 ${occupants.length} 个。`}
          </span>
        </div>

        {!inMaintenance ? (
          <section className="content-panel">
            <div className="panel-heading">
              <div>
                <span className="panel-title">待疏散材料</span>
                <span className="panel-subtitle">
                  每个材料必须明确迁移到兼容且有空位的台架
                </span>
              </div>
            </div>
            {occupants.length === 0 ? (
              <p className="history-empty">台架已清空，可以正式开始维护。</p>
            ) : (
              <div className="evacuation-list">
                {occupants.map((accession) => (
                  <PendingAccessionRow
                    key={accession.id}
                    accession={accession}
                    bench={bench}
                    state={state}
                    onRelocated={(source) => {
                      setErrors([]);
                      if (source.assignedIds.length === 0) {
                        onSaved(
                          source,
                          `台架 ${bench.code} 已清空，可以开始维护`,
                        );
                      }
                    }}
                  />
                ))}
              </div>
            )}
          </section>
        ) : null}

        {relocated.length > 0 ? (
          <section className="content-panel">
            <div className="panel-heading">
              <div>
                <span className="panel-title">本次维护迁移记录</span>
                <span className="panel-subtitle">
                  取消或完成维护后这些记录仍保留在台架与材料历史中
                </span>
              </div>
            </div>
            <div className="history-list">
              {relocated.map((relocation) => {
                const accession = state.accessions.find(
                  (item) => item.id === relocation.accessionId,
                );
                return (
                  <div className="history-list-row" key={relocation.id}>
                    <div>
                      <strong>
                        {accession
                          ? `${accession.accessionNo} · ${accession.cultivar}`
                          : relocation.accessionId}
                      </strong>
                      <span>
                        {benchLabel(relocation.fromBenchId)}
                        <ArrowRight
                          size={13}
                          style={{ margin: "0 4px", display: "inline" }}
                        />
                        {benchLabel(relocation.toBenchId)}
                      </span>
                    </div>
                    <span>{relocation.note || "已随维护疏散到新台架"}</span>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {errorFor("assignedIds") || errorFor("status") ? (
          <p className="form-level-error">
            {errorFor("assignedIds") ?? errorFor("status")}
          </p>
        ) : null}

        <TextAreaField
          label={inMaintenance ? "维护结论备注（可选）" : "取消/结束备注（可选）"}
          value={endNote}
          onChange={(event) => setEndNote(event.target.value)}
          rows={2}
          data-testid="maintenance-end-note"
        />

        <div className="editor-actions">
          <Button tone="secondary" type="button" onClick={onClose}>
            关闭
          </Button>
          {!inMaintenance ? (
            <>
              <Button
                tone="secondary"
                type="button"
                onClick={handleCancel}
                data-testid="cancel-maintenance"
              >
                取消维护申请
              </Button>
              <Button
                tone="danger"
                type="button"
                onClick={handleStart}
                disabled={!startable}
                data-testid="start-maintenance"
              >
                清空并开始维护
              </Button>
            </>
          ) : (
            <>
              <Button
                tone="secondary"
                type="button"
                onClick={handleCancel}
                data-testid="cancel-active-maintenance"
              >
                中止维护并恢复
              </Button>
              <Button
                type="button"
                onClick={handleComplete}
                data-testid="complete-maintenance"
              >
                维护完成，恢复可用
              </Button>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
