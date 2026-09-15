import { Settings2 } from "lucide-react";
import type { PlanningPolicy, PriorityOverride, Trial } from "../../domain/types";
import { effectivePriority, describePriority } from "../../domain/planner";

interface PlanningControlsProps {
  trials: Trial[];
  policy: PlanningPolicy;
  onChange: (policy: PlanningPolicy) => void;
  onGenerate: () => void;
}

const PRIORITY_OPTIONS: Array<{ value: "" | PriorityOverride; label: string }> = [
  { value: "", label: "按试验状态" },
  { value: "high", label: "高优先级" },
  { value: "normal", label: "常规" },
  { value: "low", label: "低优先级" },
];

const STATE_LABEL: Record<Trial["state"], string> = {
  draft: "草稿",
  active: "进行中",
  paused: "已暂停",
  cleared: "已放行",
};

export function PlanningControls({
  trials,
  policy,
  onChange,
  onGenerate,
}: PlanningControlsProps) {
  const toggleTrial = (trialId: string) => {
    const has = policy.scopeTrialIds.includes(trialId);
    onChange({
      ...policy,
      scopeTrialIds: has
        ? policy.scopeTrialIds.filter((id) => id !== trialId)
        : [...policy.scopeTrialIds, trialId].sort(),
    });
  };

  const setOverride = (trialId: string, value: "" | PriorityOverride) => {
    const overrides = { ...policy.priorityOverrides };
    if (value === "") {
      delete overrides[trialId];
    } else {
      overrides[trialId] = value;
    }
    onChange({ ...policy, priorityOverrides: overrides });
  };

  return (
    <section className="content-panel planning-controls" data-testid="planning-controls">
      <div className="panel-heading">
        <Settings2 size={18} aria-hidden="true" className="panel-icon" />
        <div>
          <h2 className="panel-title">规划范围与策略</h2>
          <p className="panel-subtitle">
            规划器只产出可解释建议，不直接改动现场；硬约束（光照、物理容量、停用/隔离/维修台架）永远不会被越过。
          </p>
        </div>
      </div>

      <div className="planning-form-grid">
        <label className="field">
          <span className="field-label">规划期开始</span>
          <input
            className="field-input"
            type="date"
            value={policy.horizonFrom}
            onChange={(event) =>
              onChange({ ...policy, horizonFrom: event.target.value })
            }
            data-testid="planning-horizon-from"
          />
        </label>
        <label className="field">
          <span className="field-label">规划期结束</span>
          <input
            className="field-input"
            type="date"
            value={policy.horizonTo}
            onChange={(event) =>
              onChange({ ...policy, horizonTo: event.target.value })
            }
            data-testid="planning-horizon-to"
          />
        </label>
        <label className="field field-checkbox planning-toggle">
          <input
            type="checkbox"
            checked={policy.reservedSlotsEnabled}
            onChange={(event) =>
              onChange({
                ...policy,
                reservedSlotsEnabled: event.target.checked,
              })
            }
            data-testid="planning-reserved-toggle"
          />
          <span className="field-label">
            保留台架预留缓冲
            <small>默认不动用缓冲槽位，占用时逐条预警</small>
          </span>
        </label>
        <label className="field field-checkbox planning-toggle">
          <input
            type="checkbox"
            checked={policy.relocateFromMaintenance}
            onChange={(event) =>
              onChange({
                ...policy,
                relocateFromMaintenance: event.target.checked,
              })
            }
            data-testid="planning-maintenance-toggle"
          />
          <span className="field-label">
            维修期提前迁移在场材料
            <small>关闭则维修台架不接收新材料，但保留既有占用</small>
          </span>
        </label>
      </div>

      <div className="data-table-wrap">
        <table className="data-table planning-trial-table">
          <thead>
            <tr>
              <th className="planning-check-col">纳入</th>
              <th>试验批次</th>
              <th>状态</th>
              <th>周期</th>
              <th>生效优先级</th>
              <th>优先级覆盖</th>
            </tr>
          </thead>
          <tbody>
            {trials.map((trial) => {
              const included = policy.scopeTrialIds.includes(trial.id);
              return (
                <tr key={trial.id}>
                  <td>
                    <input
                      type="checkbox"
                      checked={included}
                      onChange={() => toggleTrial(trial.id)}
                      aria-label={`将 ${trial.code} 纳入规划`}
                      data-testid={`planning-scope-${trial.id}`}
                    />
                  </td>
                  <td>
                    <strong>{trial.code}</strong>
                    <span className="planning-trial-family">
                      {" "}
                      · {trial.cropFamily}
                    </span>
                  </td>
                  <td>{STATE_LABEL[trial.state]}</td>
                  <td className="muted-copy">
                    {trial.startDate} ~ {trial.endDate}
                  </td>
                  <td>{describePriority(effectivePriority(trial, policy))}</td>
                  <td>
                    <select
                      className="compact-select"
                      value={policy.priorityOverrides[trial.id] ?? ""}
                      onChange={(event) =>
                        setOverride(
                          trial.id,
                          event.target.value as "" | PriorityOverride,
                        )
                      }
                      disabled={!included}
                      data-testid={`planning-priority-${trial.id}`}
                    >
                      {PRIORITY_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="editor-actions">
        <button
          type="button"
          className="button button-primary button-md"
          onClick={onGenerate}
          disabled={
            policy.scopeTrialIds.length === 0 ||
            policy.horizonFrom > policy.horizonTo
          }
          data-testid="generate-plan"
        >
          生成离线分配建议
        </button>
        {policy.scopeTrialIds.length === 0 ? (
          <span className="field-error">请至少勾选一个试验批次</span>
        ) : policy.horizonFrom > policy.horizonTo ? (
          <span className="field-error">规划期开始不能晚于结束</span>
        ) : null}
      </div>
    </section>
  );
}
