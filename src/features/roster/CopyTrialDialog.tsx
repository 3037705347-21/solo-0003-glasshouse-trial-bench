import { useEffect, useMemo, useState } from "react";
import { Copy } from "lucide-react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import {
  SelectField,
  TextField,
} from "../../components/fields";
import type { FieldError } from "../../domain/result";
import { TRIAL_SEASONS } from "../../domain/rules";
import {
  commitTrialCopy,
  planTrialCopy,
  type TrialCopyDraft,
} from "../../domain/trialCopy";
import { useWorkspace } from "../../state/store";

interface CopyTrialDialogProps {
  open: boolean;
  sourceTrialId: string;
  onClose: () => void;
  onCopied: (newTrialCode: string, count: number) => void;
}

function defaultDraft(sourceCode: string): TrialCopyDraft {
  const year = new Date().getFullYear();
  return {
    code: sourceCode.replace(/-\d+$/, "") + "-" + String(Date.now() % 100).padStart(2, "0"),
    cropFamily: "",
    objective: "",
    season: TRIAL_SEASONS[0],
    startDate: `${year}-09-16`,
    endDate: `${year}-12-16`,
  };
}

export function CopyTrialDialog({
  open,
  sourceTrialId,
  onClose,
  onCopied,
}: CopyTrialDialogProps) {
  const { state, dispatch } = useWorkspace();
  const sourceTrial = state.trials.find((trial) => trial.id === sourceTrialId);
  const [draft, setDraft] = useState<TrialCopyDraft>(() =>
    defaultDraft(sourceTrial?.code ?? "NEW-01"),
  );
  const [includeRetired, setIncludeRetired] = useState(false);
  const [submitErrors, setSubmitErrors] = useState<FieldError[]>([]);

  useEffect(() => {
    if (open && sourceTrial) {
      setDraft((current) => ({
        ...defaultDraft(sourceTrial.code),
        cropFamily: sourceTrial.cropFamily,
        objective: sourceTrial.objective,
      }));
      setSubmitErrors([]);
    }
  }, [open, sourceTrial]);

  const plan = useMemo(() => {
    if (!sourceTrial) {
      return { trialDraft: draft, rows: [], issues: [], bumpedRules: [] };
    }
    return planTrialCopy(state, sourceTrialId, draft, { includeRetired });
  }, [state, sourceTrialId, draft, includeRetired, sourceTrial]);

  const update = <K extends keyof TrialCopyDraft>(
    key: K,
    value: TrialCopyDraft[K],
  ) => setDraft((current) => ({ ...current, [key]: value }));

  const errorFor = (field: string) =>
    plan.issues.find((issue) => issue.field === field)?.message ??
    submitErrors.find((issue) => issue.field === field)?.message;

  const copyable = plan.rows.filter((row) => !row.skipped);
  const formFieldNames = [
    "code",
    "cropFamily",
    "objective",
    "season",
    "startDate",
    "endDate",
  ];
  const formIssues = plan.issues.filter((issue) =>
    formFieldNames.includes(issue.field),
  );
  const rowIssues = plan.issues.filter(
    (issue) =>
      !formFieldNames.includes(issue.field) &&
      issue.code === "sequence_overflow",
  );
  const skippedCount = plan.rows.length - copyable.length;
  // Skipped rows (stopped/missing rules) are simply excluded; the rest copy.
  const canCommit = copyable.length > 0 && formIssues.length === 0;

  const handleCopy = () => {
    const result = commitTrialCopy(state, plan);
    if (!result.ok) {
      setSubmitErrors(result.errors);
      return;
    }
    dispatch({
      type: "trial/copied",
      trial: result.value.trial,
      accessions: result.value.accessions,
      numberRules: result.value.numberRules,
    });
    onCopied(result.value.trial.code, result.value.accessions.length);
  };

  return (
    <Dialog
      open={open}
      title={`复制试验 ${sourceTrial?.code ?? ""}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button tone="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={handleCopy}
            disabled={!canCommit}
            data-testid="confirm-copy-trial"
          >
            <Copy size={15} />
            复制 {copyable.length} 个材料到新试验
          </Button>
        </>
      }
    >
      <div className="editor-form">
        <div className="lifecycle-callout">
          <strong>复制后是全新的材料编号</strong>
          <span>
            新试验中的每个材料都会按匹配的启用规则重新生成编号并推进序号计数器；
            台架、观测和停用历史不会复制。规则停用时对应材料会在下方列出并跳过。
          </span>
        </div>
        <div className="form-grid">
          <TextField
            label="新试验编号"
            value={draft.code}
            onChange={(event) => update("code", event.target.value)}
            error={errorFor("code")}
            data-testid="copy-trial-code"
          />
          <TextField
            label="作物科属"
            value={draft.cropFamily}
            onChange={(event) => update("cropFamily", event.target.value)}
            error={errorFor("cropFamily")}
          />
          <SelectField
            label="季节"
            value={draft.season}
            onChange={(event) => update("season", event.target.value)}
            error={errorFor("season")}
          >
            {TRIAL_SEASONS.map((season) => (
              <option value={season} key={season}>
                {season}
              </option>
            ))}
          </SelectField>
          <TextField
            label="开始日期"
            type="date"
            value={draft.startDate}
            onChange={(event) => update("startDate", event.target.value)}
            error={errorFor("startDate")}
          />
          <TextField
            label="结束日期"
            type="date"
            value={draft.endDate}
            onChange={(event) => update("endDate", event.target.value)}
            error={errorFor("endDate")}
          />
          <TextField
            label="试验目标"
            value={draft.objective}
            onChange={(event) => update("objective", event.target.value)}
            error={errorFor("objective")}
            className="field-span-2"
          />
        </div>
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={includeRetired}
            onChange={(event) => setIncludeRetired(event.target.checked)}
            data-testid="copy-include-retired"
          />
          <span>同时复制已停用材料（复制后在新试验中为在用状态）</span>
        </label>
        <div className="copy-preview" data-testid="copy-trial-preview">
          <div className="panel-heading">
            <div>
              <span className="panel-title">编号预览</span>
              <span className="panel-subtitle">
                可复制 {copyable.length} 个，跳过{" "}
                {plan.rows.length - copyable.length} 个
              </span>
            </div>
          </div>
          <div className="data-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>原编号</th>
                  <th>品种</th>
                  <th>来源</th>
                  <th>新编号</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {plan.rows.map((row) => (
                  <tr key={row.sourceAccession.id}>
                    <td>{row.sourceAccession.accessionNo}</td>
                    <td>{row.sourceAccession.cultivar}</td>
                    <td>{row.sourceAccession.source}</td>
                    <td>
                      {row.skipped ? (
                        <span className="muted-copy">—</span>
                      ) : (
                        <span className="table-primary">{row.accessionNo}</span>
                      )}
                    </td>
                    <td>
                      {row.skipped ? (
                        <span className="field-error">{row.reason}</span>
                      ) : (
                        "将复制"
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {skippedCount > 0 ? (
            <p className="field-hint">
              {skippedCount} 个材料因规则停用或缺失已跳过，不会进入新试验。
            </p>
          ) : null}
          {rowIssues.slice(0, 1).map((issue) => (
            <p className="field-hint" key={issue.field}>
              {issue.message}（编号仍唯一，建议之后加宽序号位）
            </p>
          ))}
          {submitErrors.length > 0 ? (
            <ul className="import-error-list">
              {submitErrors.map((issue) => (
                <li key={`${issue.field}-${issue.code}`}>{issue.message}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </Dialog>
  );
}
