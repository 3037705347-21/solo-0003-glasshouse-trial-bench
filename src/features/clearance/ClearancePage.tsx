import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { History, Play, ShieldCheck } from "lucide-react";
import { Button } from "../../components/Button";
import { PageHeader } from "../../components/PageHeader";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import {
  buildClearanceSnapshot,
  createClearanceSnapshot,
} from "../../domain/clearance";
import { transitionTrial } from "../../domain/trial";
import { latestSnapshotForTrial } from "../../state/selectors";
import { useWorkspace } from "../../state/store";
import { SnapshotCard } from "./SnapshotCard";

export function ClearancePage() {
  const { state, dispatch } = useWorkspace();
  const [trialId, setTrialId] = useState(() => state.trials[0]?.id ?? "");
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
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
    const { snapshot, trials } = createClearanceSnapshot(state, trialId);
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
            <Button onClick={handleGenerate} data-testid="generate-clearance">
              <ShieldCheck size={16} />
              生成快照
            </Button>
          )
        }
      />
      <section className="control-strip">
        <select
          className="compact-select"
          value={trialId}
          onChange={(event) => setTrialId(event.target.value)}
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
        <SnapshotCard snapshot={liveSnapshot} heading="实时约束预览（未保存）" />
      </section>
      {latest ? (
        <section className="clearance-preview">
          <div className="panel-heading">
            <div>
              <span className="panel-title">已保存快照</span>
              <span className="panel-subtitle">最近生成的放行快照</span>
            </div>
            <Link className="ledger-link" to="/clearance/ledger">
              <History size={15} aria-hidden="true" />
              查看快照台账（{state.clearanceSnapshots.length}）
            </Link>
          </div>
          <SnapshotCard snapshot={latest} heading="最近一次已保存快照" />
        </section>
      ) : (
        <section className="clearance-preview ledger-empty-preview">
          <Link to="/clearance/ledger">
            <History size={15} aria-hidden="true" />
            打开放行快照台账
          </Link>
        </section>
      )}
      <ToastRegion
        messages={toasts}
        onDismiss={(id) =>
          setToasts((current) => current.filter((item) => item.id !== id))
        }
      />
    </div>
  );
}
