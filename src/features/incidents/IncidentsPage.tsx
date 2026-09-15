import { useMemo, useState } from "react";
import { Plus, ShieldAlert } from "lucide-react";
import { Button } from "../../components/Button";
import { DataTable, type DataColumn } from "../../components/DataTable";
import { Dialog } from "../../components/Dialog";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import {
  incidentKindLabel,
  incidentMatchesQuery,
  incidentStatusLabel,
} from "../../domain/incident";
import type { QualityIncident } from "../../domain/types";
import { useWorkspace } from "../../state/store";
import { IncidentDetail } from "./IncidentDetail";
import { IncidentForm } from "./IncidentForm";

type IncidentSegment = "all" | "active" | "lifted";

export function IncidentsPage() {
  const { state } = useWorkspace();
  const [segment, setSegment] = useState<IncidentSegment>("all");
  const [trialFilter, setTrialFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedIncidentId, setSelectedIncidentId] = useState("");
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  };

  const filtered = useMemo(
    () =>
      state.incidents
        .filter((incident) =>
          incidentMatchesQuery(incident, state, segment, trialFilter),
        )
        .sort((left, right) =>
          right.discoveredOn.localeCompare(left.discoveredOn),
        ),
    [state, segment, trialFilter],
  );

  const accessionLabel = (accessionId: string): string =>
    state.accessions.find((item) => item.id === accessionId)?.accessionNo ??
    accessionId;

  const clueLabel = (incident: QualityIncident): string => {
    const parts: string[] = [];
    if (incident.observationPassId) {
      const pass = state.observationPasses.find(
        (item) => item.id === incident.observationPassId,
      );
      parts.push(`观测 ${pass?.observedOn ?? incident.observationPassId}`);
    }
    if (incident.flagId) {
      const flag = state.flags.find((item) => item.id === incident.flagId);
      parts.push(`标记 ${flag?.code ?? incident.flagId}`);
    }
    return parts.length > 0 ? parts.join(" / ") : "—";
  };

  const columns: Array<DataColumn<QualityIncident>> = [
    {
      key: "status",
      header: "状态",
      render: (incident) => (
        <StatusBadge tone={statusTone(incidentStatusLabel(incident))}>
          {incidentStatusLabel(incident)}
        </StatusBadge>
      ),
    },
    {
      key: "kind",
      header: "类型",
      render: (incident) => incidentKindLabel(incident.kind),
    },
    {
      key: "discoveredOn",
      header: "发现时间",
      render: (incident) => incident.discoveredOn,
    },
    {
      key: "accessions",
      header: "影响材料",
      render: (incident) => (
        <span className="table-primary">
          {incident.accessionIds.map(accessionLabel).join("、")}
        </span>
      ),
    },
    {
      key: "cause",
      header: "原因",
      render: (incident) => (
        <span className="cell-truncate" title={incident.cause}>
          {incident.cause}
        </span>
      ),
    },
    {
      key: "clues",
      header: "线索",
      render: (incident) => clueLabel(incident),
    },
    {
      key: "actions",
      header: "处置",
      render: (incident) =>
        incident.status === "lifted"
          ? `${incident.actions.length} 条 · 已解除`
          : `${incident.actions.length} 条`,
    },
    {
      key: "detail",
      header: "",
      render: (incident) => (
        <Button
          tone="ghost"
          size="sm"
          onClick={() => setSelectedIncidentId(incident.id)}
          data-testid={`open-incident-${incident.id}`}
        >
          详情
        </Button>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="材料质量"
        title="质量事件"
        description="把疑似污染、品质异常和意外损耗关联到具体材料，跟踪处置动作并保留解除结论。"
        actions={
          <Button onClick={() => setCreateOpen(true)} data-testid="open-incident-form">
            <Plus size={16} />
            新建事件
          </Button>
        }
      />
      <section className="control-strip">
        <SegmentedTabs
          label="按事件状态筛选"
          value={segment}
          options={[
            { value: "all", label: "全部" },
            { value: "active", label: "活动中" },
            { value: "lifted", label: "已解除" },
          ]}
          onChange={setSegment}
        />
        <select
          className="compact-select"
          value={trialFilter}
          onChange={(event) => setTrialFilter(event.target.value)}
          aria-label="按试验筛选"
          data-testid="incident-trial-filter"
        >
          <option value="">全部试验</option>
          {state.trials.map((trial) => (
            <option value={trial.id} key={trial.id}>
              {trial.code} - {trial.cropFamily}
            </option>
          ))}
        </select>
      </section>
      <section className="content-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-title">事件清单</span>
            <span className="panel-subtitle">
              {state.incidents.length} 个事件中显示 {filtered.length} 个
            </span>
          </div>
          <ShieldAlert size={20} className="panel-icon" aria-hidden="true" />
        </div>
        {state.incidents.length === 0 ? (
          <EmptyState
            icon={ShieldAlert}
            title="还没有质量事件"
            description="发现疑似污染、品质异常或意外损耗时，创建事件并关联受影响材料。"
          />
        ) : (
          <DataTable
            columns={columns}
            rows={filtered}
            rowKey={(incident) => incident.id}
            emptyMessage="当前视图下没有匹配事件。"
          />
        )}
      </section>
      <Dialog
        open={createOpen}
        title="新建质量事件"
        onClose={() => setCreateOpen(false)}
        wide
      >
        <IncidentForm
          onCancel={() => setCreateOpen(false)}
          onSaved={() => {
            setCreateOpen(false);
            pushToast({
              tone: "success",
              title: "质量事件已记录",
              message: "受影响材料将在观测和放行中提示风险。",
            });
          }}
        />
      </Dialog>
      <Dialog
        open={Boolean(selectedIncidentId)}
        title="事件详情与处理"
        onClose={() => setSelectedIncidentId("")}
        wide
      >
        {selectedIncidentId ? (
          <IncidentDetail
            incidentId={selectedIncidentId}
            notify={pushToast}
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
