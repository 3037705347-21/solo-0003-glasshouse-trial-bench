import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { NotebookPen, Plus } from "lucide-react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import {
  openFlagsForTrial,
  passesForTrial,
} from "../../state/selectors";
import { useWorkspace } from "../../state/store";
import { FlagPanel } from "./FlagPanel";
import { PassForm } from "./PassForm";

export function ObservationPage() {
  const { state } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const trialParam = searchParams.get("trial");
  const passParam = searchParams.get("pass");
  const accessionParam = searchParams.get("accession");
  const [trialId, setTrialId] = useState(() =>
    trialParam && state.trials.some((trial) => trial.id === trialParam)
      ? trialParam
      : state.trials[0]?.id ?? "",
  );
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const passes = passesForTrial(state, trialId);
  const flags = openFlagsForTrial(state, trialId);

  // 从标记工作台的溯源链接跳回时，选中对应试验。
  useEffect(() => {
    if (trialParam && trialParam !== trialId) {
      setTrialId(trialParam);
    }
  }, [trialParam, trialId]);

  const selectTrial = (next: string) => {
    setTrialId(next);
    const params = new URLSearchParams(searchParams);
    params.delete("pass");
    params.delete("accession");
    params.set("trial", next);
    setSearchParams(params, { replace: true });
  };

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
          <>
            <Link
              to={`/flags?trial=${encodeURIComponent(trialId)}`}
              className="button button-secondary button-md"
              data-testid="open-flag-workbench"
            >
              <NotebookPen size={16} />
              标记工作台
            </Link>
            <Button onClick={() => setDialogOpen(true)} data-testid="open-observation-form">
              <Plus size={16} />
              新建观测
            </Button>
          </>
        }
      />
      <section className="control-strip">
        <select
          className="compact-select"
          value={trialId}
          onChange={(event) => selectTrial(event.target.value)}
          aria-label="选择试验"
          data-testid="observation-trial-select"
        >
          {state.trials.map((trial) => (
            <option value={trial.id} key={trial.id}>
              {trial.code} - {trial.cropFamily}
            </option>
          ))}
        </select>
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
              {passes.map((pass) => (
                <article
                  className={`pass-card ${pass.id === passParam ? "pass-card-highlight" : ""}`}
                  key={pass.id}
                  data-testid={`pass-${pass.id}`}
                >
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
                      const isSource = entry.accessionId === accessionParam;
                      return (
                        <StatusBadge
                          tone={isSource ? "critical" : "neutral"}
                          key={entry.accessionId}
                        >
                          {isSource
                            ? `受影响材料 · ${accession?.accessionNo ?? entry.accessionId}`
                            : accession?.accessionNo ?? entry.accessionId}
                        </StatusBadge>
                      );
                    })}
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
        <FlagPanel flags={flags} />
      </div>
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
      <ToastRegion
        messages={toasts}
        onDismiss={(id) =>
          setToasts((current) => current.filter((item) => item.id !== id))
        }
      />
    </div>
  );
}
