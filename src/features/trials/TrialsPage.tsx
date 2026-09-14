import { useMemo, useState } from "react";
import {
  FlaskConical,
  Pause,
  Pencil,
  Play,
  Plus,
  RotateCcw,
} from "lucide-react";
import { Button } from "../../components/Button";
import { DataTable, type DataColumn } from "../../components/DataTable";
import { Dialog } from "../../components/Dialog";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { SearchInput } from "../../components/SearchInput";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import type { Trial, TrialState } from "../../domain/types";
import {
  getLifecycleTransitions,
  transitionTrial,
  trialDaysRemaining,
  trialMatchesQuery,
  trialStateLabel,
  trialTransitionLabel,
} from "../../domain/trial";
import { useWorkspace } from "../../state/store";
import { TrialForm } from "./TrialForm";

type TrialSegment = "all" | TrialState;

function transitionIcon(from: TrialState, to: TrialState) {
  if (to === "paused") {
    return <Pause size={14} aria-hidden="true" />;
  }
  if (from === "paused" && to === "active") {
    return <RotateCcw size={14} aria-hidden="true" />;
  }
  return <Play size={14} aria-hidden="true" />;
}

export function TrialsPage() {
  const { state, dispatch } = useWorkspace();
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState<TrialSegment>("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingTrial, setEditingTrial] = useState<Trial | undefined>();
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  };

  const filtered = useMemo(() => {
    return state.trials
      .filter((trial) => trialMatchesQuery(trial, query))
      .filter((trial) => segment === "all" || trial.state === segment);
  }, [state.trials, query, segment]);

  const handleTransition = (trial: Trial, to: TrialState) => {
    const result = transitionTrial(trial, to);
    if (!result.ok) {
      pushToast({
        tone: "error",
        title: "状态变更失败",
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
      title: `试验已${trialTransitionLabel(trial.state, to)}`,
      message: `${trial.code} 现在处于${trialStateLabel(to)}状态。`,
    });
  };

  const openCreate = () => {
    setEditingTrial(undefined);
    setEditorOpen(true);
  };

  const columns: Array<DataColumn<Trial>> = [
    {
      key: "code",
      header: "编号",
      render: (trial) => <span className="table-primary">{trial.code}</span>,
    },
    {
      key: "cropFamily",
      header: "作物科属",
      render: (trial) => trial.cropFamily,
    },
    {
      key: "objective",
      header: "目标",
      render: (trial) => (
        <span className="cell-clamp" title={trial.objective}>
          {trial.objective}
        </span>
      ),
    },
    {
      key: "season",
      header: "季节",
      render: (trial) => trial.season,
    },
    {
      key: "dates",
      header: "起止日期",
      render: (trial) => (
        <span>
          {trial.startDate} ~ {trial.endDate}
          {trial.state === "active" ? (
            <span className="table-subtext">
              剩余 {trialDaysRemaining(trial)} 天
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: "state",
      header: "状态",
      render: (trial) => {
        const label = trialStateLabel(trial.state);
        return <StatusBadge tone={statusTone(label)}>{label}</StatusBadge>;
      },
    },
    {
      key: "actions",
      header: "",
      render: (trial) => {
        if (trial.state === "cleared") {
          return <span className="muted-copy">已封存</span>;
        }
        return (
          <div className="table-actions">
            {getLifecycleTransitions(trial).map((transition) => (
              <Button
                key={transition.to}
                tone="secondary"
                size="sm"
                onClick={() => handleTransition(trial, transition.to)}
                data-testid={`trial-transition-${transition.to}-${trial.id}`}
              >
                {transitionIcon(transition.from, transition.to)}
                {trialTransitionLabel(transition.from, transition.to)}
              </Button>
            ))}
            <Button
              tone="ghost"
              size="sm"
              onClick={() => {
                setEditingTrial(trial);
                setEditorOpen(true);
              }}
              data-testid={`edit-trial-${trial.id}`}
            >
              <Pencil size={14} aria-hidden="true" />
              编辑
            </Button>
          </div>
        );
      },
    },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="试验管理"
        title="试验总览"
        description="维护试验基本资料，并办理启动、暂停和恢复等生命周期转换。放行仍在放行流程中完成。"
        actions={
          <Button onClick={openCreate} data-testid="open-create-trial">
            <Plus size={16} />
            新建试验
          </Button>
        }
      />
      <section className="control-strip">
        <SearchInput
          placeholder="搜索编号、作物科属、目标"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          data-testid="trial-search"
        />
        <SegmentedTabs
          label="按试验状态筛选"
          value={segment}
          options={[
            { value: "all", label: "全部" },
            { value: "draft", label: "草稿" },
            { value: "active", label: "进行中" },
            { value: "paused", label: "已暂停" },
            { value: "cleared", label: "已放行" },
          ]}
          onChange={setSegment}
        />
      </section>
      <section className="content-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-title">试验清单</span>
            <span className="panel-subtitle">
              {state.trials.length} 个试验中显示 {filtered.length} 个
            </span>
          </div>
          <FlaskConical size={20} className="panel-icon" aria-hidden="true" />
        </div>
        {state.trials.length === 0 ? (
          <EmptyState
            icon={FlaskConical}
            title="还没有试验"
            description="创建第一个试验后，材料登记、台架分配、观测和放行流程才能选择它。"
            action={
              <Button onClick={openCreate}>
                <Plus size={16} />
                新建试验
              </Button>
            }
          />
        ) : (
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(trial) => trial.id}
            emptyMessage="当前筛选下没有匹配试验。"
          />
        )}
      </section>
      <Dialog
        open={editorOpen}
        title={editingTrial ? "编辑试验" : "新建试验"}
        onClose={() => setEditorOpen(false)}
        wide
      >
        <TrialForm
          trial={editingTrial}
          onCancel={() => setEditorOpen(false)}
          onSaved={() => {
            setEditorOpen(false);
            pushToast({
              tone: "success",
              title: editingTrial ? "试验已更新" : "试验已创建",
              message: editingTrial
                ? `${editingTrial.code} 的资料已更新，关联材料和快照保持不变。`
                : "各工作流的试验选择器现在可以选中该试验。",
            });
          }}
        />
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
