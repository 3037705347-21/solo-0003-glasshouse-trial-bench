import { useMemo, useState } from "react";
import { GitBranch, NotebookPen, Plus } from "lucide-react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import type { ObservationPass } from "../../domain/types";
import { isAccessionRetired } from "../../domain/accession";
import {
  closedFlagsForTrial,
  currentRuleSetForTrial,
  openFlagsForTrial,
  passesForTrial,
  reinterpretationsForPass,
  ruleSetLabel,
} from "../../state/selectors";
import { useWorkspace } from "../../state/store";
import { FlagHistoryPanel } from "./FlagHistoryPanel";
import { FlagPanel } from "./FlagPanel";
import { PassForm } from "./PassForm";
import { ReinterpretDialog } from "./ReinterpretDialog";

export function ObservationPage() {
  const { state } = useWorkspace();
  const [trialId, setTrialId] = useState(() => state.trials[0]?.id ?? "");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [reinterpreting, setReinterpreting] = useState<ObservationPass | undefined>();
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const passes = passesForTrial(state, trialId);
  const flags = openFlagsForTrial(state, trialId);
  const closedFlags = closedFlagsForTrial(state, trialId);
  const currentRuleSet = currentRuleSetForTrial(state, trialId);

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  };

  const latestMetric = useMemo(() => {
    return passes.reduce(
      (summary, pass) => {
        const entries = pass.entries.length;
        const criticalFlags = state.flags.filter(
          (flag) => flag.observationPassId === pass.id && flag.severity === "critical",
        ).length;
        return {
          passes: summary.passes + 1,
          entries: summary.entries + entries,
          criticalFlags: summary.criticalFlags + criticalFlags,
        };
      },
      { passes: 0, entries: 0, criticalFlags: 0 },
    );
  }, [passes, state.flags]);

  return (
    <div className="page">
      <PageHeader
        eyebrow="生长观测"
        title="观测记录"
        description="录入测量数据并呈现放行前需要处理的生长标记。"
        actions={
          <Button onClick={() => setDialogOpen(true)} data-testid="open-observation-form">
            <Plus size={16} />
            新建观测
          </Button>
        }
      />
      <section className="control-strip">
        <select
          className="compact-select"
          value={trialId}
          onChange={(event) => setTrialId(event.target.value)}
          aria-label="选择试验"
          data-testid="observation-trial-select"
        >
          {state.trials.map((trial) => (
            <option value={trial.id} key={trial.id}>
              {trial.code} - {trial.cropFamily}
            </option>
          ))}
        </select>
        <StatusBadge tone="info">
          {`当前判定规则：${ruleSetLabel(state, currentRuleSet.id)}`}
        </StatusBadge>
      </section>
      <div className="observation-workspace">
        <section className="pass-list">
          <div className="pass-list-heading">
            <NotebookPen size={18} aria-hidden="true" />
            <h2>观测历史</h2>
            <span>{latestMetric.passes} 次观测</span>
          </div>
          {passes.length === 0 ? (
            <p className="muted-copy">该试验还没有观测记录。</p>
          ) : (
            <div className="pass-cards">
              {passes.map((pass) => {
                const reinterpretCount = reinterpretationsForPass(
                  state,
                  pass.id,
                ).length;
                return (
                  <article className="pass-card" key={pass.id} data-testid={`pass-${pass.id}`}>
                    <div className="pass-card-top">
                      <strong>{pass.observedOn}</strong>
                      <span>{pass.observer}</span>
                    </div>
                    <p>{pass.entries.length} 条测量记录</p>
                    <div className="pass-card-tags">
                      {pass.entries.map((entry) => {
                        const accession = state.accessions.find(
                          (item) => item.id === entry.accessionId,
                        );
                        return (
                          <StatusBadge
                            tone={
                              accession && isAccessionRetired(accession)
                                ? "warning"
                                : "neutral"
                            }
                            key={entry.accessionId}
                          >
                            {accession
                              ? `${accession.accessionNo}${isAccessionRetired(accession) ? " 已停用" : ""}`
                              : entry.accessionId}
                          </StatusBadge>
                        );
                      })}
                    </div>
                    <div className="pass-card-footer">
                      <StatusBadge tone="info">
                        {ruleSetLabel(state, pass.ruleSetId)}
                      </StatusBadge>
                      {reinterpretCount > 0 ? (
                        <span className="pass-card-reinterpreted">
                          已重新解释 {reinterpretCount} 次
                        </span>
                      ) : null}
                      <Button
                        tone="ghost"
                        size="sm"
                        onClick={() => setReinterpreting(pass)}
                        data-testid={`reinterpret-${pass.id}`}
                      >
                        <GitBranch size={14} />
                        重新解释
                      </Button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
        <FlagPanel flags={flags} />
      </div>
      <FlagHistoryPanel flags={closedFlags} />
      <Dialog
        open={dialogOpen}
        title="记录观测"
        onClose={() => setDialogOpen(false)}
        wide
      >
        {trialId ? (
          <PassForm
            trialId={trialId}
            onCancel={() => setDialogOpen(false)}
            onSaved={() => {
              setDialogOpen(false);
              pushToast({
                tone: "success",
                title: "观测已记录",
                message: "已根据测量数据生成生长标记。",
              });
            }}
          />
        ) : (
          <p>请先创建试验，再录入观测。</p>
        )}
      </Dialog>
      {reinterpreting ? (
        <ReinterpretDialog
          pass={reinterpreting}
          onCancel={() => setReinterpreting(undefined)}
          onSaved={(created, superseded) => {
            setReinterpreting(undefined);
            pushToast({
              tone: "success",
              title: "重新解释完成",
              message: `新增 ${created} 个标记，取代 ${superseded} 个历史结论。`,
            });
          }}
        />
      ) : null}
      <ToastRegion
        messages={toasts}
        onDismiss={(id) =>
          setToasts((current) => current.filter((item) => item.id !== id))
        }
      />
    </div>
  );
}
