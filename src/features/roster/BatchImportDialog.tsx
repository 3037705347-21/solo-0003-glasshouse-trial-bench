import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { Button } from "../../components/Button";
import { DataTable, type DataColumn } from "../../components/DataTable";
import { SelectField, TextAreaField, TextField } from "../../components/fields";
import { StatusBadge } from "../../components/StatusBadge";
import {
  buildBatchPreview,
  createBatchImport,
  parseBatchInput,
  type BatchPreview,
  type BatchPreviewRow,
} from "../../domain/batchImport";
import type { ImportBatch } from "../../domain/types";
import { workspaceReducer } from "../../state/reducer";
import { trySaveWorkspaceState } from "../../state/persistence";
import { useWorkspace } from "../../state/store";

interface BatchImportDialogProps {
  defaultTrialId: string;
  onCancel: () => void;
  onImported: (batch: ImportBatch) => void;
}

type ImportStep = "entry" | "preview";

export function BatchImportDialog({
  defaultTrialId,
  onCancel,
  onImported,
}: BatchImportDialogProps) {
  const { state, dispatch } = useWorkspace();
  const [step, setStep] = useState<ImportStep>("entry");
  const [targetTrialId, setTargetTrialId] = useState(defaultTrialId);
  const [defaultNote, setDefaultNote] = useState("");
  const [rawText, setRawText] = useState("");
  const [preview, setPreview] = useState<BatchPreview | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const recentBatches = [...state.importBatches].slice(-5).reverse();

  const handleFile = (file: File | undefined) => {
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setRawText(String(reader.result ?? ""));
    };
    reader.readAsText(file);
  };

  const handlePrecheck = () => {
    const parsed = parseBatchInput(rawText);
    const nextPreview = buildBatchPreview(parsed, state, {
      defaultTrialId: targetTrialId,
      defaultGenotypeNote: defaultNote,
    });
    setPreview(nextPreview);
    setCommitError(null);
    setStep("preview");
  };

  const handleCommit = () => {
    if (!preview) {
      return;
    }
    const result = createBatchImport(preview, state, {
      defaultTrialId: targetTrialId,
      defaultGenotypeNote: defaultNote,
    });
    if (!result.ok) {
      setCommitError(
        `提交前复核未通过，请返回重新预检。${result.errors
          .map((error) => error.message)
          .join("；")}`,
      );
      return;
    }
    const action = {
      type: "accession/batch-imported" as const,
      accessions: result.value.accessions,
      batch: result.value.batch,
    };
    const nextState = workspaceReducer(state, action);
    if (!trySaveWorkspaceState(nextState)) {
      setCommitError(
        "浏览器存储写入失败，本次导入未执行，工作区未发生任何变化。请检查存储空间后重试。",
      );
      return;
    }
    dispatch(action);
    onImported(result.value.batch);
  };

  const previewColumns: Array<DataColumn<BatchPreviewRow>> = [
    {
      key: "rowNumber",
      header: "行号",
      render: (row) => String(row.rowNumber),
    },
    {
      key: "accessionNo",
      header: "材料编号",
      render: (row) => (
        <span className="table-primary">
          {row.accessionNo}
          {row.autoNumbered ? (
            <>
              {" "}
              <StatusBadge tone="info">自动</StatusBadge>
            </>
          ) : null}
        </span>
      ),
    },
    {
      key: "cultivar",
      header: "品种",
      render: (row) => row.cultivar || "—",
    },
    {
      key: "trial",
      header: "试验",
      render: (row) => row.trialCode,
    },
    {
      key: "propagatedOn",
      header: "繁殖日期",
      render: (row) => row.propagatedOn || "—",
    },
    {
      key: "quantity",
      header: "数量",
      render: (row) => row.quantity || "—",
    },
    {
      key: "status",
      header: "状态",
      render: (row) => (
        <span data-testid={`batch-row-status-${row.rowNumber}`}>
          <StatusBadge tone={row.valid ? "positive" : "critical"}>
            {row.valid ? "有效" : "需修正"}
          </StatusBadge>
        </span>
      ),
    },
    {
      key: "issues",
      header: "问题",
      render: (row) => (
        <span
          className="batch-issue-text"
          data-testid={`batch-row-issues-${row.rowNumber}`}
        >
          {row.issues.length > 0
            ? row.issues.map((issue) => issue.message).join("；")
            : "—"}
        </span>
      ),
    },
  ];

  if (step === "preview" && preview) {
    return (
      <div className="batch-import" data-testid="batch-import-preview">
        <div className="batch-summary" data-testid="batch-preview-summary">
          <StatusBadge tone="neutral">{`共 ${preview.totalRows} 行`}</StatusBadge>
          <StatusBadge tone="positive">{`有效 ${preview.validCount}`}</StatusBadge>
          <StatusBadge tone={preview.invalidCount > 0 ? "critical" : "neutral"}>
            {`需修正 ${preview.invalidCount}`}
          </StatusBadge>
          <StatusBadge tone="info">
            {preview.headerDetected ? "已识别表头" : "按默认列顺序解析"}
          </StatusBadge>
        </div>
        <DataTable
          columns={previewColumns}
          rows={preview.rows}
          rowKey={(row) => `batch-row-${row.rowNumber}`}
          rowClassName={(row) => (row.valid ? "" : "batch-row-invalid")}
          emptyMessage="没有可预览的行。"
        />
        {commitError ? (
          <p className="form-level-error" data-testid="batch-commit-error">
            {commitError}
          </p>
        ) : null}
        <div className="editor-actions">
          <Button tone="secondary" onClick={() => setStep("entry")}>
            返回修改
          </Button>
          <Button
            tone="danger"
            onClick={onCancel}
            data-testid="batch-discard-button"
          >
            整批放弃
          </Button>
          <Button
            onClick={handleCommit}
            disabled={preview.validCount === 0}
            data-testid="batch-submit-button"
          >
            {`提交有效行 ${preview.validCount} 条`}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="batch-import" data-testid="batch-import-entry">
      <div className="form-grid">
        <SelectField
          label="目标试验"
          value={targetTrialId}
          onChange={(event) => setTargetTrialId(event.target.value)}
          hint="行内试验列留空时归入该试验"
        >
          {state.trials.map((trial) => (
            <option value={trial.id} key={trial.id}>
              {trial.code} - {trial.cropFamily}
            </option>
          ))}
        </SelectField>
        <TextField
          label="批次说明（基因型 / 批次）"
          value={defaultNote}
          onChange={(event) => setDefaultNote(event.target.value)}
          hint="至少 10 个字符，应用于整批；行内说明列可覆盖"
          data-testid="batch-default-note"
        />
      </div>
      <TextAreaField
        label="批量数据"
        value={rawText}
        onChange={(event) => setRawText(event.target.value)}
        className="batch-paste-field"
        rows={10}
        placeholder={"试验\t材料编号\t品种\t来源\t繁殖日期\t数量\t穴盘规格\t光照\t标签"}
        data-testid="batch-import-input"
      />
      <div className="batch-entry-toolbar">
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv,.tsv,.txt"
          className="batch-file-input"
          data-testid="batch-import-file"
          onChange={(event) => {
            handleFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        <Button
          tone="secondary"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
        >
          <FileUp size={15} />
          从文件导入
        </Button>
        <p className="muted-copy batch-format-hint">
          每行一条材料，按 Tab 或逗号分隔。首行可带表头（试验、材料编号、品种、来源、繁殖日期、数量、穴盘规格、光照、标签、说明）；无表头时按
          材料编号、品种、来源、繁殖日期、数量、穴盘规格、光照、标签、说明
          的顺序解析。材料编号留空时自动补号。
        </p>
      </div>
      {recentBatches.length > 0 ? (
        <section className="batch-history" data-testid="import-batch-history">
          <h3>最近导入记录</h3>
          <ul>
            {recentBatches.map((batch) => (
              <li key={batch.id}>
                <strong>
                  {new Date(batch.importedAt).toLocaleString("zh-CN", {
                    hour12: false,
                  })}
                </strong>
                <span>{`导入 ${batch.importedCount} 条 / 共 ${batch.totalRows} 行，跳过 ${batch.skippedCount} 行`}</span>
                <span className="batch-history-nos">
                  {batch.accessionNos.slice(0, 6).join("、")}
                  {batch.accessionNos.length > 6 ? " …" : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      <div className="editor-actions">
        <Button tone="secondary" onClick={onCancel}>
          取消
        </Button>
        <Button
          onClick={handlePrecheck}
          disabled={!rawText.trim()}
          data-testid="batch-precheck-button"
        >
          预检
        </Button>
      </div>
    </div>
  );
}
