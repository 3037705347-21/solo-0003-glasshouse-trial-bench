import { useEffect, useMemo, useState } from "react";
import { Pause, Play, ShieldCheck } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { Button } from "../../components/Button";
import { PageHeader } from "../../components/PageHeader";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import {
  applyClearance,
  buildClearanceSnapshot,
} from "../../domain/clearance";
import { transitionTrial } from "../../domain/trial";
import { latestSnapshotForTrial } from "../../state/selectors";
import { useWorkspace } from "../../state/store";
import { SnapshotCard } from "./SnapshotCard";

export function ClearancePage() {
  const { state, dispatch } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const trialFromUrl = searchParams.get("trial");
  const [trialId, setTrialId] = useState(() =>
    trialFromUrl && state.trials.some((trial) => trial.id === trialFromUrl)
      ? trialFromUrl
      : (state.trials[0]?.id ?? ""),
  );
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  // 今日工作台“临近放行”跳回时预选对应试验。
  useEffect(() => {
    const nextTrial = searchParams.get("trial");
    if (nextTrial && state.trials.some((trial) => trial.id === nextTrial)) {
      setTrialId(nextTrial);
    }
  }, [searchParams, state.trials]);

  const handleTrialChange = (next: string) => {
    setTrialId(next);
    const nextParams = new URLSearchParams(searchParams);
    nextParams.set("trial", next);
    setSearchParams(nextParams, { replace: true });
  };

  const latest = latestSnapshotForTrial(state, trialId);
  const trial = state.trials.find((item) => item.id === trialId);

  const liveSnapshot = useMemo(
    () => buildClearanceSnapshot(state, trialId),
    [state, trialId],
  );

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  };

  const handleGenerate = () => {
    const snapshot = buildClearanceSnapshot(state, trialId);
    const trials = applyClearance(state, snapshot);
    dispatch({ type: "clearance/generated", snapshot, trials });
    pushToast({
      tone: snapshot.status === "ready" ? "success" : "warning",
      title: snapshot.status === "ready" ? "试验已放行" : "放行被阻止",
      message:
        snapshot.status === "ready"
          ? "试验状态已更新为已放行。"
          : `仍有 ${snapshot.blockers.length} 个阻止项。`,
    });
  };

  const handleActivate = () => {
    if (!trial) {
      return;
    }
    const result = transitionTrial(trial, "active");
    if (!result.ok) {
      pushToast({
        tone: "error",
        title: "启动失败",
        message: result.errors[0]?.message,
      });
      return;
    }
    dispatch({
      type: "trial/transitioned",
      trialId: trial.id,
      state: result.value.state,
    });
    pushToast({
      tone: "success",
      title: "试验已启动",
      message: `${trial.code} 已进入进行中状态。`,
    });
  };

  const handlePauseToggle = () => {
    if (!trial) {
      return;
    }
    const next = trial.state === "paused" ? "active" : "paused";
    const result = transitionTrial(trial, next);
    if (!result.ok) {
      pushToast({
        tone: "error",
        title: next === "paused" ? "暂停失败" : "恢复失败",
        message: result.errors[0]?.message,
      });
      return;
    }
    dispatch({
      type: "trial/transitioned",
      trialId: trial.id,
      state: result.value.state,
    });
    pushToast({
      tone: next === "paused" ? "info" : "success",
      title: next === "paused" ? "试验已暂停" : "试验已恢复",
      message:
        next === "paused"
          ? `${trial.code} 的今日工作台旧提醒会保留，但不再升级为逾期。`
          : `${trial.code} 的提醒重新按截止状态汇总。`,
    });
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="试验放行"
        title="放行检查"
        description="检查跨模块约束，并生成一次不可变的放行快照。"
        actions={
          trial?.state === "draft" ? (
            <Button onClick={handleActivate}>
              <Play size={16} />
              启动试验
            </Button>
          ) : (
            <>
              {trial?.state === "active" || trial?.state === "paused" ? (
                <Button
                  tone="secondary"
                  onClick={handlePauseToggle}
                  data-testid="toggle-trial-pause"
                >
                  {trial.state === "paused" ? (
                    <>
                      <Play size={16} />
                      恢复试验
                    </>
                  ) : (
                    <>
                      <Pause size={16} />
                      暂停试验
                    </>
                  )}
                </Button>
              ) : null}
              <Button onClick={handleGenerate} data-testid="generate-clearance">
                <ShieldCheck size={16} />
                生成快照
              </Button>
            </>
          )
        }
      />
      <section className="control-strip">
        <select
          className="compact-select"
          value={trialId}
          onChange={(event) => handleTrialChange(event.target.value)}
          aria-label="选择试验"
          data-testid="clearance-trial-select"
        >
          {state.trials.map((item) => (
            <option value={item.id} key={item.id}>
              {item.code} - {item.cropFamily}（
              {item.state === "draft"
                ? "草稿"
                : item.state === "active"
                  ? "进行中"
                  : item.state === "paused"
                    ? "已暂停"
                    : "已放行"}
              ）
            </option>
          ))}
        </select>
      </section>
      <section className="clearance-preview">
        <div className="panel-heading">
          <div>
            <span className="panel-title">实时约束视图</span>
            <span className="panel-subtitle">
              根据当前材料、台架和标记重新计算
            </span>
          </div>
          <ShieldCheck size={20} className="panel-icon" aria-hidden="true" />
        </div>
        <SnapshotCard snapshot={liveSnapshot} />
      </section>
      {latest ? (
        <section className="clearance-preview">
          <div className="panel-heading">
            <div>
              <span className="panel-title">已保存快照</span>
              <span className="panel-subtitle">最近生成的放行快照</span>
            </div>
          </div>
          <SnapshotCard snapshot={latest} />
        </section>
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
