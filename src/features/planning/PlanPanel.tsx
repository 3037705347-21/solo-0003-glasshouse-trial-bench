import { useMemo } from "react";
import { AlertTriangle, CheckCircle2, Pin, RotateCcw, Send } from "lucide-react";
import { Button } from "../../components/Button";
import { MetricCard } from "../../components/MetricCard";
import { StatusBadge } from "../../components/StatusBadge";
import type {
  Accession,
  AllocationPlan,
  Bench,
  PlanItemStatus,
  WorkspaceState,
} from "../../domain/types";
import {
  isBenchServicable,
  isLightCompatible,
  benchUnderMaintenance,
  validatePlan,
  type ItemVerdict,
} from "../../domain/planner";

interface PlanPanelProps {
  state: WorkspaceState;
  plan: AllocationPlan;
  onRetarget: (accessionId: string, targetBenchId: string) => void;
  onClearEdits: () => void;
  onApply: () => void;
  onDiscard: () => void;
}

const STATUS_LABEL: Record<PlanItemStatus, string> = {
  stays: "保持原位",
  moved: "迁移",
  new: "新分配",
  unplaced: "未放置",
  excluded: "已停用",
};

const VERDICT_LABEL: Record<ItemVerdict, string> = {
  valid: "仍然有效",
  suboptimal: "合法但偏离策略",
  invalid: "已失效",
  incomplete: "待人工放置",
  ignored: "不参与",
};

const VERDICT_CLASS: Record<ItemVerdict, string> = {
  valid: "plan-verdict-valid",
  suboptimal: "plan-verdict-suboptimal",
  invalid: "plan-verdict-invalid",
  incomplete: "plan-verdict-incomplete",
  ignored: "plan-verdict-ignored",
};

function lightLabel(profile: Bench["lightProfile"]): string {
  if (profile === "full-sun") {
    return "全日照";
  }
  if (profile === "partial-shade") {
    return "半阴";
  }
  return "遮阴";
}

function verdictTone(verdict: ItemVerdict): "positive" | "warning" | "critical" | "neutral" | "info" {
  if (verdict === "valid") {
    return "positive";
  }
  if (verdict === "suboptimal") {
    return "info";
  }
  if (verdict === "invalid") {
    return "critical";
  }
  if (verdict === "incomplete") {
    return "warning";
  }
  return "neutral";
}

export function PlanPanel({
  state,
  plan,
  onRetarget,
  onClearEdits,
  onApply,
  onDiscard,
}: PlanPanelProps) {
  const report = useMemo(() => validatePlan(state, plan), [state, plan]);
  const verdictByAccession = useMemo(
    () => new Map(report.items.map((item) => [item.accessionId, item])),
    [report],
  );

  const benchById = new Map(state.benches.map((bench) => [bench.id, bench]));
  const accessionById = new Map(
    state.accessions.map((accession) => [accession.id, accession]),
  );
  const trialById = new Map(state.trials.map((trial) => [trial.id, trial]));

  const counts = {
    moved: plan.items.filter((item) => item.status === "moved").length,
    created: plan.items.filter((item) => item.status === "new").length,
    unplaced: plan.unplaced.length,
    excluded: plan.items.filter((item) => item.status === "excluded").length,
    pinned: plan.items.filter((item) => item.pinned).length,
  };

  const readOnly = plan.lifecycle !== "draft";
  const applied = plan.lifecycle === "applied";
  const discarded = plan.lifecycle === "discarded";

  const benchOptions = (accession: Accession): Bench[] =>
    state.benches
      .filter(
        (bench) =>
          isBenchServicable(bench) &&
          isLightCompatible(accession, bench) &&
          !benchUnderMaintenance(bench, plan.policy).active,
      )
      .sort((a, b) => a.code.localeCompare(b.code));

  const renderTarget = (item: AllocationPlan["items"][number]) => {
    if (item.status === "excluded") {
      return <span className="muted-copy">—</span>;
    }
    const accession = accessionById.get(item.accessionId);
    const feasibleOptions = accession ? benchOptions(accession) : [];
    // 当前目标（如关闭提前迁移后留在维修台架上）即便不可作为新目标，
    // 也必须出现在下拉中以正确回显；选项标注“仅原位保留”。
    const currentTarget = item.targetBenchId
      ? benchById.get(item.targetBenchId)
      : undefined;
    const options =
      currentTarget &&
      accession &&
      !feasibleOptions.some((bench) => bench.id === currentTarget.id) &&
      isLightCompatible(accession, currentTarget)
        ? [...feasibleOptions, currentTarget]
        : feasibleOptions;
    const validation = verdictByAccession.get(item.accessionId);

    if (readOnly) {
      const target = item.targetBenchId ? benchById.get(item.targetBenchId) : undefined;
      return (
        <span>
          {target
            ? `${target.code}（${target.sector}）`
            : item.status === "unplaced"
              ? "未放置"
              : "—"}
          {item.status === "stays" && target ? (
            <span className="muted-copy"> · 原位</span>
          ) : null}
        </span>
      );
    }

    return (
      <div className="plan-target-cell">
        <select
          className="compact-select"
          value={item.targetBenchId ?? ""}
          onChange={(event) => onRetarget(item.accessionId, event.target.value)}
          data-testid={`plan-target-${item.accessionId}`}
          aria-label={`为 ${accession?.accessionNo ?? ""} 选择目标台架`}
        >
          <option value="">未放置（交人工裁决）</option>
          {options.map((bench) => {
            const maintenanceOnly = benchUnderMaintenance(bench, plan.policy).active;
            return (
              <option key={bench.id} value={bench.id}>
                {bench.code} · {bench.sector} · 光照 {lightLabel(bench.lightProfile)}
                {maintenanceOnly ? " · 维修中（仅原位保留，不接收迁入）" : ""}
              </option>
            );
          })}
        </select>
        {item.pinned ? (
          <span className="plan-pin" title="人工修改：规划器重算时保留该选择">
            <Pin size={13} aria-hidden="true" /> 人工钉选
          </span>
        ) : null}
        {validation && validation.verdict !== "valid" && validation.verdict !== "ignored" ? (
          <span className={`plan-verdict ${VERDICT_CLASS[validation.verdict]}`}>
            {VERDICT_LABEL[validation.verdict]}
          </span>
        ) : null}
      </div>
    );
  };

  return (
    <section className="content-panel plan-panel" data-testid={`plan-panel-${plan.id}`}>
      <div className="panel-heading plan-panel-heading">
        <div>
          <h2 className="panel-title">
            {plan.code}
            <StatusBadge
              tone={
                applied
                  ? "positive"
                  : plan.lifecycle === "discarded"
                    ? "neutral"
                    : "warning"
              }
            >
              {applied ? "已应用" : plan.lifecycle === "discarded" ? "已废弃" : "建议草稿"}
            </StatusBadge>
          </h2>
          <p className="panel-subtitle">
            算法 v{plan.algorithmVersion} · 生成于 {plan.createdAt.slice(0, 10)} ·
            规划期 {plan.policy.horizonFrom} 至 {plan.policy.horizonTo} ·
            输入指纹 <code>{plan.inputFingerprint}</code>
          </p>
        </div>
        {!readOnly ? (
          <div className="plan-heading-actions">
            <Button tone="ghost" size="sm" onClick={onClearEdits} data-testid={`plan-clear-edits-${plan.id}`}>
              <RotateCcw size={14} /> 恢复规划器建议
            </Button>
            <Button tone="secondary" size="sm" onClick={onDiscard} data-testid={`plan-discard-${plan.id}`}>
              废弃
            </Button>
            <Button
              tone="primary"
              size="sm"
              onClick={onApply}
              disabled={!report.applicable}
              data-testid={`plan-apply-${plan.id}`}
            >
              <Send size={14} /> 应用到现场
            </Button>
          </div>
        ) : applied && plan.appliedAt ? (
          <span className="muted-copy">应用于 {plan.appliedAt.slice(0, 10)}</span>
        ) : discarded ? (
          <span className="plan-terminal-note" data-testid={`plan-terminal-${plan.id}`}>
            已废弃 · 终态只读，不能再应用或改动现场
          </span>
        ) : null}
      </div>

      <div className="metric-grid">
        <MetricCard label="迁移" value={counts.moved} detail="因维修/隔离等硬原因改架" accent="warning" />
        <MetricCard label="新分配" value={counts.created} detail="此前未在场的材料" />
        <MetricCard
          label="未放置"
          value={counts.unplaced}
          detail="硬约束内放不下，待人工裁决"
          accent={counts.unplaced > 0 ? "critical" : "neutral"}
        />
        <MetricCard
          label="人工钉选"
          value={counts.pinned}
          detail="重算时保留的人工修改"
          accent="neutral"
        />
      </div>

      {!readOnly && report.summary.length > 0 ? (
        <div
          className={`plan-revalidation ${
            report.applicable
              ? report.invalidCount > 0
                ? "plan-revalidation-error"
                : "plan-revalidation-ok"
              : "plan-revalidation-error"
          }`}
          data-testid={`plan-revalidation-${plan.id}`}
        >
          {report.applicable ? (
            <CheckCircle2 size={18} aria-hidden="true" />
          ) : (
            <AlertTriangle size={18} aria-hidden="true" />
          )}
          <ul>
            {report.summary.map((note) => (
              <li key={note.code}>
                <strong>{note.code}</strong>：{note.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {plan.tradeoffs.length > 0 ? (
        <div className="plan-tradeoffs" data-testid={`plan-tradeoffs-${plan.id}`}>
          <h3>
            <AlertTriangle size={15} aria-hidden="true" /> 冲突取舍说明（规划器如何裁决）
          </h3>
          <ul>
            {plan.tradeoffs.map((tradeoff) => (
              <li key={tradeoff.code}>
                <strong>{tradeoff.code}</strong>：{tradeoff.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="data-table-wrap">
        <table className="data-table plan-items-table">
          <thead>
            <tr>
              <th>材料</th>
              <th>批次 / 优先级</th>
              <th>现状</th>
              <th>建议目标</th>
              <th>动作</th>
              <th>依据与预警</th>
            </tr>
          </thead>
          <tbody>
            {plan.items.map((item) => {
              const accession = accessionById.get(item.accessionId);
              const trial = trialById.get(item.trialId);
              const source = item.sourceBenchId
                ? benchById.get(item.sourceBenchId)
                : undefined;
              const validation = verdictByAccession.get(item.accessionId);
              const isInvalid =
                !readOnly && validation && validation.verdict === "invalid";
              return (
                <tr
                  key={item.accessionId}
                  className={isInvalid ? "plan-row-invalid" : ""}
                  data-testid={`plan-item-${item.accessionId}`}
                >
                  <td>
                    <strong>{accession?.cultivar ?? "（已删除材料）"}</strong>
                    <span className="muted-copy"> {accession?.accessionNo}</span>
                  </td>
                  <td className="muted-copy">
                    {trial?.code}
                    {item.pinned ? (
                      <Pin size={12} aria-label="人工钉选" className="plan-row-pin" />
                    ) : null}
                  </td>
                  <td>
                    {source ? (
                      source.code
                    ) : (
                      <span className="muted-copy">未在场</span>
                    )}
                  </td>
                  <td>{renderTarget(item)}</td>
                  <td>
                    <StatusBadge
                      tone={
                        item.status === "moved"
                          ? "warning"
                          : item.status === "unplaced"
                            ? "critical"
                            : item.status === "excluded"
                              ? "neutral"
                              : "positive"
                      }
                    >
                      {STATUS_LABEL[item.status]}
                    </StatusBadge>
                  </td>
                  <td>
                    <ul className="plan-reason-list">
                      {item.reasons.map((entry) => (
                        <li key={entry.code} className="plan-reason">
                          {entry.message}
                        </li>
                      ))}
                      {item.warnings.map((entry) => (
                        <li key={entry.code} className="plan-warning">
                          ⚠ {entry.message}
                        </li>
                      ))}
                      {!readOnly && validation
                        ? validation.violations.map((entry) => (
                            <li key={`v-${entry.code}`} className="plan-violation">
                              ✕ {entry.message}
                            </li>
                          ))
                        : null}
                      {!readOnly &&
                      validation &&
                      validation.verdict !== "valid" &&
                      validation.verdict !== "ignored" ? (
                        <li className={`plan-verdict ${VERDICT_CLASS[validation.verdict]}`}>
                          {VERDICT_LABEL[validation.verdict]}
                          {validation.suggestionBenchId
                            ? `（建议改至 ${benchById.get(validation.suggestionBenchId)?.code}）`
                            : ""}
                        </li>
                      ) : null}
                    </ul>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
