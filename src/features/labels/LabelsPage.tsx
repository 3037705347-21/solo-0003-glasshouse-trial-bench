import { useMemo, useState } from "react";
import { Tags, Plus, Eraser, GitMerge, Wand2 } from "lucide-react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { PageHeader } from "../../components/PageHeader";
import { SearchInput } from "../../components/SearchInput";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import {
  buildNormalizeLabelsPlan,
  dirtyAccessions,
  labelSummaries,
  type LabelChangePlan,
  type LabelSummary,
} from "../../domain/labels";
import { normalizeLabels } from "../../domain/rules";
import { useWorkspace } from "../../state/store";
import {
  AddLabelsDialog,
  MergeLabelsDialog,
  RemoveLabelsDialog,
  RenameLabelDialog,
} from "./LabelDialogs";

type DialogState =
  | { kind: "add" }
  | { kind: "remove" }
  | { kind: "merge" }
  | { kind: "rename"; summary: LabelSummary }
  | { kind: "normalize" }
  | null;

export function LabelsPage() {
  const { state, dispatch } = useWorkspace();
  const [trialId, setTrialId] = useState(() => state.trials[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [checked, setChecked] = useState<string[]>([]);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  };

  const trial = state.trials.find((item) => item.id === trialId);
  const trialAccessions = useMemo(
    () => state.accessions.filter((accession) => accession.trialId === trialId),
    [state.accessions, trialId],
  );
  const summaries = useMemo(
    () => labelSummaries(state, trialId),
    [state, trialId],
  );
  const dirty = useMemo(
    () => dirtyAccessions(state, trialId),
    [state, trialId],
  );

  const filtered = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) {
      return summaries;
    }
    return summaries.filter(
      (summary) =>
        summary.label.includes(term) ||
        summary.variants.some((variant) =>
          variant.value.toLowerCase().includes(term),
        ),
    );
  }, [summaries, query]);

  const checkedSummaries = summaries.filter((summary) =>
    checked.includes(summary.label),
  );

  const switchTrial = (nextTrialId: string) => {
    setTrialId(nextTrialId);
    setChecked([]);
  };

  const toggleLabel = (label: string) => {
    setChecked((current) =>
      current.includes(label)
        ? current.filter((item) => item !== label)
        : [...current, label],
    );
  };

  const allVisibleChecked =
    filtered.length > 0 && filtered.every((summary) => checked.includes(summary.label));

  const toggleAllVisible = () => {
    setChecked((current) => {
      if (allVisibleChecked) {
        const visible = new Set(filtered.map((summary) => summary.label));
        return current.filter((label) => !visible.has(label));
      }
      return Array.from(
        new Set([...current, ...filtered.map((summary) => summary.label)]),
      );
    });
  };

  const closeDialog = () => setDialog(null);

  const handleApplied = (
    plan: LabelChangePlan,
    successTitle: string,
  ) => {
    const changed = plan.affected.filter((impact) => !impact.cosmeticOnly).length;
    const cosmetic = plan.affected.length - changed;
    closeDialog();
    setChecked([]);
    const parts = [
      changed > 0
        ? `已更新 ${changed} 个材料的标签。`
        : `${plan.affected.length} 个材料的标签已处理。`,
      cosmetic > 0 ? `其中 ${cosmetic} 个顺带完成了大小写、空白或去重标准化。` : "",
      "可到材料登记页核对。",
    ];
    pushToast({
      tone: "success",
      title: successTitle,
      message: parts.filter(Boolean).join(""),
    });
  };

  const handleNormalize = () => {
    const result = buildNormalizeLabelsPlan(state, trialId);
    if (!result.ok) {
      pushToast({
        tone: "info",
        title: "无需标准化",
        message: result.errors[0]?.message,
      });
      return;
    }
    dispatch({
      type: "accession/labels-applied",
      accessions: result.value.updatedAccessions,
    });
    handleApplied(result.value, "标签已标准化");
  };

  const totalOccurrences = trialAccessions.reduce(
    (sum, accession) => sum + normalizeLabels(accession.labels).length,
    0,
  );

  return (
    <div className="page">
      <PageHeader
        eyebrow="数据治理"
        title="标签治理"
        description="按试验汇总散落在材料记录中的标签，批量添加、移除、重命名与合并，执行前先预览受影响材料。"
        actions={
          <Button onClick={() => setDialog({ kind: "add" })} data-testid="open-add-labels">
            <Plus size={16} />
            批量添加标签
          </Button>
        }
      />
      <section className="control-strip">
        <select
          className="compact-select"
          value={trialId}
          onChange={(event) => switchTrial(event.target.value)}
          aria-label="按试验筛选"
          data-testid="labels-trial-filter"
        >
          {state.trials.map((item) => (
            <option value={item.id} key={item.id}>
              {item.code} - {item.cropFamily}
            </option>
          ))}
        </select>
        <SearchInput
          placeholder="搜索标签或历史拼写"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          data-testid="label-search"
        />
        <Button
          tone="secondary"
          size="sm"
          onClick={() => setDialog({ kind: "remove" })}
          disabled={checked.length === 0}
          data-testid="open-bulk-remove"
        >
          <Eraser size={15} />
          批量移除{checked.length > 0 ? `（${checked.length}）` : ""}
        </Button>
        <Button
          tone="secondary"
          size="sm"
          onClick={() => setDialog({ kind: "merge" })}
          disabled={checked.length < 2}
          data-testid="open-bulk-merge"
        >
          <GitMerge size={15} />
          合并所选{checked.length > 0 ? `（${checked.length}）` : ""}
        </Button>
        <Button
          tone="secondary"
          size="sm"
          onClick={handleNormalize}
          disabled={dirty.length === 0}
          data-testid="normalize-labels"
        >
          <Wand2 size={15} />
          标准化脏标签{dirty.length > 0 ? `（${dirty.length} 个材料）` : ""}
        </Button>
      </section>

      {dirty.length > 0 ? (
        <div className="dirty-banner" data-testid="dirty-banner">
          <strong>发现 {dirty.length} 个材料的标签未按标准存储</strong>
          <span>
            存在大小写或首尾空格混用、空值或重复值。这些标签已按同名汇总；执行任意治理操作时会顺带标准化，也可一键标准化。
          </span>
        </div>
      ) : null}

      <section className="metric-grid">
        <div className="metric-card metric-card-neutral">
          <span className="metric-card-label">试验材料</span>
          <span className="metric-card-value">{trialAccessions.length}</span>
          <span className="metric-card-detail">{trial?.code ?? "—"}</span>
        </div>
        <div className="metric-card metric-card-positive">
          <span className="metric-card-label">去重后标签</span>
          <span className="metric-card-value">{summaries.length}</span>
          <span className="metric-card-detail">共出现 {totalOccurrences} 次</span>
        </div>
        <div className="metric-card metric-card-warning">
          <span className="metric-card-label">大小写混用标签</span>
          <span className="metric-card-value">
            {summaries.filter((summary) => summary.isCaseMixed).length}
          </span>
          <span className="metric-card-detail">
            {dirty.length} 个材料标签待标准化
          </span>
        </div>
      </section>

      <section className="content-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-title">{trial?.code ?? "试验"} 的标签清单</span>
            <span className="panel-subtitle">
              共 {summaries.length} 个标签，当前显示 {filtered.length} 个；标签直接派生自材料记录，移除最后一个关联后即消失。
            </span>
          </div>
          <Tags size={20} className="panel-icon" aria-hidden="true" />
        </div>
        <div className="data-table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th className="label-check-col">
                  <input
                    type="checkbox"
                    checked={allVisibleChecked}
                    onChange={toggleAllVisible}
                    aria-label="全选当前显示的标签"
                    data-testid="label-select-all"
                  />
                </th>
                <th>标签（标准化名）</th>
                <th>关联材料</th>
                <th>材料编号</th>
                <th>历史拼写</th>
                <th className="label-action-col"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="data-table-empty">
                    该试验下没有标签。使用“批量添加标签”为材料打标。
                  </td>
                </tr>
              ) : (
                filtered.map((summary) => (
                  <tr key={summary.label} data-testid={`label-row-${summary.label}`}>
                    <td>
                      <input
                        type="checkbox"
                        checked={checked.includes(summary.label)}
                        onChange={() => toggleLabel(summary.label)}
                        aria-label={`选择标签 ${summary.label}`}
                        data-testid={`label-check-${summary.label}`}
                      />
                    </td>
                    <td>
                      <span className="label-chip label-chip-strong">
                        {summary.label}
                      </span>
                    </td>
                    <td data-testid={`label-count-${summary.label}`}>
                      <strong>{summary.materials}</strong> 个
                    </td>
                    <td>
                      <span className="label-chip-row">
                        {summary.accessionIds
                          .map(
                            (id) =>
                              state.accessions.find(
                                (accession) => accession.id === id,
                              )?.accessionNo ?? id,
                          )
                          .join("、")}
                      </span>
                    </td>
                    <td>
                      {summary.isCaseMixed ? (
                        <span
                          className="variant-note"
                          data-testid={`label-variants-${summary.label}`}
                        >
                          {summary.variants
                            .map((variant) =>
                              variant.value === summary.label
                                ? variant.value
                                : `${variant.value}×${variant.count}`,
                            )
                            .join(" / ")}
                        </span>
                      ) : (
                        <span className="muted-copy">—</span>
                      )}
                    </td>
                    <td>
                      <Button
                        tone="ghost"
                        size="sm"
                        onClick={() => setDialog({ kind: "rename", summary })}
                        data-testid={`rename-label-${summary.label}`}
                      >
                        重命名
                      </Button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog
        open={dialog !== null}
        title={
          dialog?.kind === "add"
            ? "批量添加标签"
            : dialog?.kind === "remove"
              ? "批量移除标签"
              : dialog?.kind === "merge"
                ? "合并标签"
                : dialog?.kind === "rename"
                  ? "重命名标签"
                  : "标签治理"
        }
        onClose={closeDialog}
        wide
      >
        {dialog?.kind === "add" ? (
          <AddLabelsDialog
            trialId={trialId}
            trialAccessions={trialAccessions}
            onClose={closeDialog}
            onApplied={(plan) => handleApplied(plan, "标签已批量添加")}
          />
        ) : null}
        {dialog?.kind === "remove" ? (
          <RemoveLabelsDialog
            trialId={trialId}
            summaries={summaries}
            initialLabels={checked}
            onClose={closeDialog}
            onApplied={(plan) => handleApplied(plan, "标签已批量移除")}
          />
        ) : null}
        {dialog?.kind === "merge" ? (
          <MergeLabelsDialog
            trialId={trialId}
            summaries={summaries}
            initialLabels={checked}
            onClose={closeDialog}
            onApplied={(plan) => handleApplied(plan, "标签已合并")}
          />
        ) : null}
        {dialog?.kind === "rename" ? (
          <RenameLabelDialog
            trialId={trialId}
            summary={dialog.summary}
            onClose={closeDialog}
            onApplied={(plan) => handleApplied(plan, "标签已重命名")}
          />
        ) : null}
      </Dialog>
      <ToastRegion
        messages={toasts}
        onDismiss={(id) =>
          setToasts((current) => current.filter((item) => item.id !== id))
        }
      />
    </div>
  );
}
