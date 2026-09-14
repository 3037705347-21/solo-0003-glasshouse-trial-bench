import { useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Copy,
  RefreshCw,
} from "lucide-react";
import { Button } from "../../components/Button";
import {
  SelectField,
  TextAreaField,
  TextField,
} from "../../components/fields";
import {
  COPYABLE_ACCESSION_FIELDS,
  COPYABLE_FIELD_LABELS,
  commitTrialCopy,
  isTemplateStale,
  planTrialCopy,
  type CopyConflict,
  type CopyPreviewItem,
  type CopyableAccessionField,
  type TrialCopyPlan,
  type TrialCopyRequest,
} from "../../domain/copy";
import { TRIAL_SEASONS } from "../../domain/rules";
import type { FieldError } from "../../domain/result";
import type { Accession, Trial } from "../../domain/types";
import { accessionsForTrial } from "../../state/selectors";
import { useWorkspace } from "../../state/store";

interface CopyTrialDialogProps {
  sourceTrialId: string;
  onClose: () => void;
  onCommitted: (newTrialCode: string, copiedCount: number) => void;
}

type Step = "configure" | "preview";

function suggestCode(code: string): string {
  const match = /^([A-Z]{2,4})-(\d+)$/.exec(code.trim().toUpperCase());
  if (!match) {
    return "";
  }
  return `${match[1]}-${String(Number(match[2]) + 1).padStart(match[2].length, "0")}`;
}

function shiftSeason(season: string): string {
  const index = TRIAL_SEASONS.indexOf(season);
  if (index < 0) {
    return TRIAL_SEASONS[0];
  }
  return TRIAL_SEASONS[(index + 1) % TRIAL_SEASONS.length];
}

interface FormState {
  sourceTrialId: string;
  newCode: string;
  season: string;
  startDate: string;
  endDate: string;
  objective: string;
  includeFields: CopyableAccessionField[];
  skippedIds: string[];
  shiftPropagation: boolean;
}

function initialForm(trials: Trial[], sourceTrialId: string): FormState {
  const source =
    trials.find((trial) => trial.id === sourceTrialId) ?? trials[0];
  if (!source) {
    return {
      sourceTrialId: "",
      newCode: "",
      season: TRIAL_SEASONS[0],
      startDate: "",
      endDate: "",
      objective: "",
      includeFields: [...COPYABLE_ACCESSION_FIELDS],
      skippedIds: [],
      shiftPropagation: true,
    };
  }
  return {
    sourceTrialId: source.id,
    newCode: suggestCode(source.code),
    season: shiftSeason(source.season),
    startDate: "",
    endDate: "",
    objective: source.objective,
    includeFields: [...COPYABLE_ACCESSION_FIELDS],
    skippedIds: [],
    shiftPropagation: true,
  };
}

function conflictTone(conflict: CopyConflict): string {
  return conflict.blocking ? "conflict-blocking" : "conflict-warning";
}

export function CopyTrialDialog({
  sourceTrialId,
  onClose,
  onCommitted,
}: CopyTrialDialogProps) {
  const { state, dispatch } = useWorkspace();
  const [idempotencyKey] = useState(() =>
    `copy-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  );
  const [step, setStep] = useState<Step>("configure");
  const [form, setForm] = useState<FormState>(() =>
    initialForm(state.trials, sourceTrialId),
  );
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [plan, setPlan] = useState<TrialCopyPlan | undefined>();
  const [submitting, setSubmitting] = useState(false);

  const source = useMemo(
    () => state.trials.find((trial) => trial.id === form.sourceTrialId),
    [state.trials, form.sourceTrialId],
  );
  const sourceAccessions = useMemo(
    () => (source ? accessionsForTrial(state, source.id) : []),
    [state, source],
  );

  const errorFor = (field: string): string | undefined =>
    errors.find((error) => error.field === field)?.message;

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const switchSource = (nextSourceId: string) => {
    const next = state.trials.find((trial) => trial.id === nextSourceId);
    if (!next) {
      return;
    }
    setForm((current) => ({
      ...current,
      sourceTrialId: next.id,
      newCode: suggestCode(next.code),
      season: shiftSeason(next.season),
      objective: next.objective,
      skippedIds: [],
    }));
    setPlan(undefined);
    setErrors([]);
  };

  const toggleField = (field: CopyableAccessionField) => {
    setForm((current) => ({
      ...current,
      includeFields: current.includeFields.includes(field)
        ? current.includeFields.filter((item) => item !== field)
        : [...current.includeFields, field],
    }));
  };

  const toggleSkip = (accessionId: string) => {
    setForm((current) => ({
      ...current,
      skippedIds: current.skippedIds.includes(accessionId)
        ? current.skippedIds.filter((id) => id !== accessionId)
        : [...current.skippedIds, accessionId],
    }));
  };

  const buildRequest = (expectedRevision: string): TrialCopyRequest => ({
    idempotencyKey,
    sourceTrialId: form.sourceTrialId,
    newCode: form.newCode,
    season: form.season,
    startDate: form.startDate,
    endDate: form.endDate,
    objective: form.objective,
    includeFields: form.includeFields,
    skippedAccessionIds: form.skippedIds,
    shiftPropagation: form.shiftPropagation,
    expectedRevision,
  });

  const handlePreview = () => {
    const revision = plan?.revision ?? "";
    const request = buildRequest(revision || "preview");
    // 首次预览先拿到修订号；规划函数不依赖 expectedRevision 做计算。
    const result = planTrialCopy(state, request);
    if (!result.ok) {
      setErrors(result.errors);
      setStep("configure");
      return;
    }
    setErrors([]);
    setPlan(result.value);
    setStep("preview");
  };

  const handleCommit = () => {
    if (!plan || submitting) {
      return;
    }
    setSubmitting(true);
    const request = buildRequest(plan.revision);
    const result = commitTrialCopy(state, request);
    if (!result.ok) {
      setSubmitting(false);
      setErrors(result.errors);
      const stale = isTemplateStale(state, request);
      if (stale || result.errors.some((error) => error.field === "template")) {
        setPlan(undefined);
      }
      setStep("configure");
      return;
    }
    if (result.value.created) {
      dispatch({
        type: "trial/copied",
        trial: result.value.trial,
        accessions: result.value.accessions,
        record: result.value.record,
      });
    }
    setSubmitting(false);
    onCommitted(result.value.trial.code, result.value.accessions.length);
  };

  const assignedBenchCode = new Map<string, string>();
  state.benches.forEach((bench) => {
    bench.assignedIds.forEach((id) => assignedBenchCode.set(id, bench.code));
  });

  return (
    <div className="copy-wizard" data-testid="copy-trial-dialog">
      {step === "configure" ? (
        <div className="copy-step">
          <div className="copy-notice">
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>
              复制只创建新的草稿试验和新材料身份；观测、标记、放行快照、台架分配和材料亲缘关系都不会带入。
            </span>
          </div>
          <div className="form-grid">
            <SelectField
              label="模板试验"
              value={form.sourceTrialId}
              onChange={(event) => switchSource(event.target.value)}
              data-testid="copy-source-trial"
            >
              {state.trials.map((trial) => (
                <option value={trial.id} key={trial.id}>
                  {trial.code} - {trial.cropFamily}（
                  {trial.state === "draft"
                    ? "草稿"
                    : trial.state === "active"
                      ? "进行中"
                      : trial.state === "paused"
                        ? "已暂停"
                        : "已放行"}
                  ）
                </option>
              ))}
            </SelectField>
            <TextField
              label="新试验编号"
              value={form.newCode}
              onChange={(event) => update("newCode", event.target.value)}
              error={errorFor("newCode")}
              placeholder="例如 SOL-04"
              data-testid="copy-new-code"
            />
            <SelectField
              label="季节"
              value={form.season}
              onChange={(event) => update("season", event.target.value)}
              error={errorFor("season")}
              data-testid="copy-season"
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
              value={form.startDate}
              onChange={(event) => update("startDate", event.target.value)}
              error={errorFor("startDate")}
              data-testid="copy-start-date"
            />
            <TextField
              label="结束日期"
              type="date"
              value={form.endDate}
              onChange={(event) => update("endDate", event.target.value)}
              error={errorFor("endDate")}
              data-testid="copy-end-date"
            />
            <TextAreaField
              label="试验目标"
              value={form.objective}
              onChange={(event) => update("objective", event.target.value)}
              error={errorFor("objective")}
              className="field-span-2"
              rows={3}
              data-testid="copy-objective"
            />
          </div>

          <section className="copy-section">
            <div className="copy-section-heading">
              <h3>要复制的材料字段</h3>
              <p>未勾选的字段会写入登记默认值，创建后请在材料登记中补全。</p>
            </div>
            <div className="copy-field-grid" data-testid="copy-field-grid">
              {COPYABLE_ACCESSION_FIELDS.map((field) => (
                <label
                  className={`copy-toggle ${
                    form.includeFields.includes(field) ? "copy-toggle-on" : ""
                  }`}
                  key={field}
                >
                  <input
                    type="checkbox"
                    checked={form.includeFields.includes(field)}
                    onChange={() => toggleField(field)}
                    data-testid={`copy-field-${field}`}
                  />
                  <span>{COPYABLE_FIELD_LABELS[field]}</span>
                </label>
              ))}
            </div>
          </section>

          <section className="copy-section">
            <div className="copy-section-heading">
              <h3>选择并跳过材料</h3>
              <p>
                {source ? `模板 ${source.code} 共 ${sourceAccessions.length} 个材料。` : "请先选择模板试验。"}
                台架分配不会复制，已分配材料会在预览中标注。
              </p>
            </div>
            <label className="copy-check-row">
              <input
                type="checkbox"
                checked={form.shiftPropagation}
                onChange={(event) =>
                  update("shiftPropagation", event.target.checked)
                }
                data-testid="copy-shift-propagation"
              />
              <span>繁殖日期落在新日期窗口外时，自动平移到新试验开始日</span>
            </label>
            <div className="copy-accession-list" data-testid="copy-accession-list">
              {sourceAccessions.length === 0 ? (
                <p className="muted-copy">该模板没有可复制的材料。</p>
              ) : (
                sourceAccessions.map((accession) => {
                  const skipped = form.skippedIds.includes(accession.id);
                  const benchCode = assignedBenchCode.get(accession.id);
                  return (
                    <label
                      className={`copy-accession-row ${
                        skipped ? "copy-accession-skip" : ""
                      }`}
                      key={accession.id}
                    >
                      <input
                        type="checkbox"
                        checked={!skipped}
                        onChange={() => toggleSkip(accession.id)}
                        data-testid={`copy-accession-${accession.id}`}
                      />
                      <span className="copy-accession-main">
                        <strong>{accession.accessionNo}</strong>
                        <span>{accession.cultivar}</span>
                      </span>
                      <span className="copy-accession-meta">
                        {benchCode ? `台架 ${benchCode} · ` : "未分配 · "}
                        {accession.preferredLight === "full-sun"
                          ? "全日照"
                          : accession.preferredLight === "partial-shade"
                            ? "半阴"
                            : "遮阴"}
                      </span>
                    </label>
                  );
                })
              )}
            </div>
            {errorFor("skippedAccessionIds") ? (
              <p className="field-error" data-testid="copy-skip-error">
                {errorFor("skippedAccessionIds")}
              </p>
            ) : null}
          </section>

          {errors.length > 0 ? (
            <div className="copy-error-banner" data-testid="copy-config-errors">
              <AlertTriangle size={16} aria-hidden="true" />
              <ul>
                {errors.map((error) => (
                  <li key={`${error.field}-${error.code}`}>{error.message}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="copy-actions">
            <Button tone="secondary" onClick={onClose}>
              取消
            </Button>
            <Button
              onClick={handlePreview}
              disabled={!source}
              data-testid="copy-preview-button"
            >
              <RefreshCw size={16} />
              预览复制
            </Button>
          </div>
        </div>
      ) : (
        <CopyPreview
          plan={plan as TrialCopyPlan}
          sourceAccessions={sourceAccessions}
          submitting={submitting}
          onBack={() => setStep("configure")}
          onCommit={handleCommit}
          templateStale={
            source ? isTemplateStale(state, buildRequest(plan?.revision ?? "")) : false
          }
        />
      )}
    </div>
  );
}

interface CopyPreviewProps {
  plan: TrialCopyPlan;
  sourceAccessions: Accession[];
  submitting: boolean;
  onBack: () => void;
  onCommit: () => void;
  templateStale: boolean;
}

function CopyPreview({
  plan,
  sourceAccessions,
  submitting,
  onBack,
  onCommit,
  templateStale,
}: CopyPreviewProps) {
  const sourceById = new Map(
    sourceAccessions.map((accession) => [accession.id, accession]),
  );
  const globalConflicts = plan.conflicts;

  return (
    <div className="copy-step" data-testid="copy-preview">
      <div className="copy-summary-grid">
        <div className="copy-summary-card">
          <span className="copy-summary-label">复制</span>
          <strong data-testid="copy-copied-count">{plan.copiedCount}</strong>
          <span>个材料</span>
        </div>
        <div className="copy-summary-card">
          <span className="copy-summary-label">跳过</span>
          <strong data-testid="copy-skipped-count">{plan.skippedCount}</strong>
          <span>个材料</span>
        </div>
        <div className="copy-summary-card copy-summary-trial">
          <span className="copy-summary-label">新试验</span>
          <strong>
            {plan.trialDraft.code}
            <ArrowRight size={14} aria-hidden="true" />
          </strong>
          <span>
            {plan.trialDraft.season} · {plan.trialDraft.startDate} 至{" "}
            {plan.trialDraft.endDate}
          </span>
        </div>
      </div>

      {templateStale ? (
        <div className="copy-conflict copy-conflict-blocking" data-testid="copy-template-stale">
          <AlertTriangle size={16} aria-hidden="true" />
          <span>模板自预览后已更新，请返回配置重新预览后再提交。</span>
        </div>
      ) : null}

      {globalConflicts.length > 0 ? (
        <section className="copy-section">
          <div className="copy-section-heading">
            <h3>日期与分配提示</h3>
            <p>以下为非阻断冲突，提交前请确认季节节奏和重新分配安排。</p>
          </div>
          <ul className="copy-conflict-list" data-testid="copy-conflict-list">
            {globalConflicts.map((conflict, index) => (
              <li
                className={`copy-conflict ${conflictTone(conflict)}`}
                key={`${conflict.code}-${conflict.accessionId ?? index}`}
              >
                <AlertTriangle size={15} aria-hidden="true" />
                <span>{conflict.message}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="copy-section">
        <div className="copy-section-heading">
          <h3>编号重排</h3>
          <p>新材料获得全局连续编号，不与既有材料冲突。</p>
        </div>
        <div className="copy-number-list" data-testid="copy-number-list">
          {plan.items.map((item) => (
            <PreviewRow key={item.sourceAccessionId} item={item} />
          ))}
        </div>
      </section>

      {plan.skipped.length > 0 ? (
        <section className="copy-section">
          <div className="copy-section-heading">
            <h3>跳过项</h3>
            <p>这些材料不会出现在新试验中。</p>
          </div>
          <ul className="copy-skipped-list" data-testid="copy-skipped-list">
            {plan.skipped.map((item) => (
              <li key={item.sourceAccessionId}>
                <span className="table-primary">{item.sourceAccessionNo}</span>
                <span>{item.cultivar}</span>
                {item.assignedBenchCode ? (
                  <span className="muted-copy">台架 {item.assignedBenchCode}</span>
                ) : null}
                <span className="muted-copy">{item.reason}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="copy-notice copy-notice-soft">
        <Copy size={16} aria-hidden="true" />
        <span>
          提交后新试验为草稿状态；观测、标记、放行快照不会复制，材料亲缘关系需要在谱系页面单独建立。
        </span>
      </div>

      <div className="copy-actions">
        <Button tone="secondary" onClick={onBack} data-testid="copy-back-button">
          返回修改
        </Button>
        <Button
          onClick={onCommit}
          disabled={submitting || templateStale}
          data-testid="copy-commit-button"
        >
          <Copy size={16} />
          {submitting ? "创建中…" : `创建 ${plan.trialDraft.code}`}
        </Button>
      </div>
    </div>
  );
}

function PreviewRow({ item }: { item: CopyPreviewItem }) {
  return (
    <div className="copy-number-row">
      <div className="copy-number-pair">
        <span className="muted-copy">{item.sourceAccessionNo}</span>
        <ArrowRight size={14} aria-hidden="true" />
        <span className="table-primary" data-testid={`copy-new-no-${item.sourceAccessionId}`}>
          {item.newAccessionNo}
        </span>
      </div>
      <div className="copy-number-copy">
        <strong>{item.cultivar}</strong>
        {item.assignedBenchCode ? (
          <span className="muted-copy">源分配：{item.assignedBenchCode}（不复制）</span>
        ) : (
          <span className="muted-copy">源材料未分配</span>
        )}
      </div>
      <div className="copy-number-notes">
        {item.resetFields.length > 0 ? (
          <span className="copy-chip copy-chip-reset">
            重置 {item.resetFields.length} 项：
            {item.resetFields.map((field) => COPYABLE_FIELD_LABELS[field]).join("、")}
          </span>
        ) : null}
        {item.warnings.map((warning) => (
          <span className="copy-chip copy-chip-warning" key={warning.code}>
            {warning.message}
          </span>
        ))}
      </div>
    </div>
  );
}
