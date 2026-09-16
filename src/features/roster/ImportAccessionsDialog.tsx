import { useEffect, useMemo, useState } from "react";
import { ClipboardPaste, Upload } from "lucide-react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { SelectField } from "../../components/fields";
import type { FieldError } from "../../domain/result";
import {
  IMPORT_TEMPLATE_COLUMNS,
  commitAccessionImport,
  planAccessionImport,
  rowsFromTsv,
  type AccessionImportPlannedRow,
} from "../../domain/importAccessions";
import { useWorkspace } from "../../state/store";

interface ImportAccessionsDialogProps {
  open: boolean;
  trialId: string;
  onClose: () => void;
  onImported: (count: number) => void;
}

const TEMPLATE = [
  IMPORT_TEMPLATE_COLUMNS.join("\t"),
  [
    "Stupice",
    "Glasshouse Exchange",
    "2026-09-16",
    "72",
    "104",
    "全日照",
    "紧凑型矮化番茄批次，用于秋季坐果比较。",
    "矮化,早熟",
    "",
  ].join("\t"),
].join("\n");

export function ImportAccessionsDialog({
  open,
  trialId,
  onClose,
  onImported,
}: ImportAccessionsDialogProps) {
  const { state, dispatch } = useWorkspace();
  const [selectedTrialId, setSelectedTrialId] = useState(trialId);
  const [text, setText] = useState("");
  const [committed, setCommitted] = useState(false);

  useEffect(() => {
    setSelectedTrialId(trialId);
  }, [trialId, open]);

  const rows = useMemo(() => rowsFromTsv(text), [text]);
  const plan = useMemo(
    () =>
      selectedTrialId
        ? planAccessionImport(state, selectedTrialId, rows)
        : { rows: [], validRows: [], bumpedRules: [] },
    [state, rows, selectedTrialId],
  );

  const reset = () => {
    setText("");
    setCommitted(false);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const fillTemplate = () => {
    setText(TEMPLATE);
    setCommitted(false);
  };

  const errorByField = (
    planned: AccessionImportPlannedRow,
    fieldSuffix: string,
  ): FieldError | undefined =>
    planned.errors.find((error) => error.field.endsWith(`.${fieldSuffix}`));

  const validCount = plan.rows.filter(
    (row) => row.errors.length === 0,
  ).length;
  const errorCount = plan.rows.reduce(
    (sum, row) => sum + row.errors.length,
    0,
  );

  const handleImport = () => {
    const result = commitAccessionImport(state, plan);
    if (!result.ok) {
      return;
    }
    dispatch({
      type: "accessions/imported",
      accessions: result.value.accessions,
      numberRules: result.value.numberRules,
    });
    setCommitted(true);
    onImported(result.value.accessions.length);
    reset();
  };

  return (
    <Dialog
      open={open}
      title="批量导入材料"
      onClose={handleClose}
      wide
      footer={
        <>
          <Button tone="secondary" onClick={handleClose}>
            关闭
          </Button>
          <Button
            onClick={handleImport}
            disabled={plan.rows.length === 0 || errorCount > 0 || validCount === 0}
            data-testid="confirm-import-accessions"
          >
            <Upload size={15} />
            导入 {validCount} 条材料
          </Button>
        </>
      }
    >
      <div className="import-layout">
        <div className="import-controls">
          <SelectField
            label="导入到试验"
            value={selectedTrialId}
            onChange={(event) => setSelectedTrialId(event.target.value)}
            data-testid="import-trial-select"
          >
            <option value="">请选择试验</option>
            {state.trials.map((trial) => (
              <option value={trial.id} key={trial.id}>
                {trial.code} - {trial.cropFamily}
              </option>
            ))}
          </SelectField>
          <div className="field">
            <span className="field-label">粘贴 TSV 数据（从 Excel/表格复制）</span>
            <textarea
              className="field-input import-textarea"
              value={text}
              onChange={(event) => {
                setText(event.target.value);
                setCommitted(false);
              }}
              placeholder={TEMPLATE}
              data-testid="import-textarea"
            />
            <span className="field-hint">
              首行可选列名：{IMPORT_TEMPLATE_COLUMNS.join(" / ")}；材料编号留空时按规则自动生成。
            </span>
          </div>
          <div className="import-toolbar">
            <Button
              tone="secondary"
              size="sm"
              type="button"
              onClick={fillTemplate}
              data-testid="fill-import-template"
            >
              <ClipboardPaste size={14} />
              填入示例行
            </Button>
            <span className="muted-copy" data-testid="import-summary">
              {plan.rows.length > 0
                ? `${plan.rows.length} 行：可导入 ${validCount} 条，问题 ${errorCount} 个`
                : "等待粘贴数据"}
              {committed ? " · 已提交，计数器已推进" : ""}
            </span>
          </div>
        </div>
        <div className="import-preview" data-testid="import-preview">
          {plan.rows.length === 0 ? (
            <p className="muted-copy">
              粘贴或填入示例后，这里会逐行预览生成的材料编号、匹配规则和校验问题。
            </p>
          ) : (
            <div className="data-table-wrap">
              <table className="data-table import-table">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>材料编号</th>
                    <th>品种</th>
                    <th>来源</th>
                    <th>规则</th>
                    <th>问题</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.rows.map((row) => {
                    const numberError = errorByField(row, "accessionNo");
                    return (
                      <tr
                        key={row.index}
                        data-testid={`import-row-${row.index}`}
                        className={row.errors.length > 0 ? "import-row-error" : ""}
                      >
                        <td>{row.index + 1}</td>
                        <td>
                          {row.plannedNo ? (
                            <span className="table-primary">{row.plannedNo}</span>
                          ) : (
                            <span className="muted-copy">—</span>
                          )}
                          {row.manual ? (
                            <small className="import-manual-tag">手工</small>
                          ) : null}
                          {numberError ? (
                            <div className="field-error">
                              {numberError.message}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          {row.draft.cultivar || "—"}
                          {errorByField(row, "cultivar") ? (
                            <div className="field-error">
                              {errorByField(row, "cultivar")?.message}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          {row.draft.source || "—"}
                          {errorByField(row, "source") ? (
                            <div className="field-error">
                              {errorByField(row, "source")?.message}
                            </div>
                          ) : null}
                        </td>
                        <td>
                          {row.manual ? (
                            "手工指定"
                          ) : row.rule ? (
                            row.rule.name
                          ) : (
                            <span className="field-error">无匹配规则</span>
                          )}
                        </td>
                        <td>
                          {row.errors.length === 0 ? (
                            "通过"
                          ) : (
                            <ul className="import-error-list">
                              {row.errors
                                .filter((error) => !error.field.endsWith(".accessionNo"))
                                .filter((error) =>
                                  !["cultivar", "source"].some((suffix) =>
                                    error.field.endsWith(`.${suffix}`),
                                  ),
                                )
                                .map((error) => (
                                  <li key={`${error.field}-${error.code}`}>
                                    {error.message}
                                  </li>
                                ))}
                            </ul>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
