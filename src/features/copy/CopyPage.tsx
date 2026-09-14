import { useMemo, useState } from "react";
import { Copy, History, ScrollText } from "lucide-react";
import { Button } from "../../components/Button";
import { DataTable, type DataColumn } from "../../components/DataTable";
import { Dialog } from "../../components/Dialog";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import type { Trial, TrialCopyRecord } from "../../domain/types";
import {
  copyRecordsForTrial,
  trialById,
} from "../../state/selectors";
import { useWorkspace } from "../../state/store";
import { CopyTrialDialog } from "./CopyTrialDialog";

function describeState(state: Trial["state"]): string {
  if (state === "draft") {
    return "草稿";
  }
  if (state === "active") {
    return "进行中";
  }
  if (state === "paused") {
    return "已暂停";
  }
  return "已放行";
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate(),
  )} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function CopyPage() {
  const { state } = useWorkspace();
  const [sourceTrialId, setSourceTrialId] = useState<string | undefined>();
  const [detailTrialId, setDetailTrialId] = useState<string | undefined>();
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 5200);
  };

  const allRecords = useMemo(
    () =>
      [...state.trialCopyRecords].sort((left, right) =>
        right.createdOn.localeCompare(left.createdOn),
      ),
    [state.trialCopyRecords],
  );

  const detailRecords = useMemo<TrialCopyRecord[]>(
    () => (detailTrialId ? copyRecordsForTrial(state, detailTrialId) : []),
    [state, detailTrialId],
  );
  const detailTrial = detailTrialId
    ? trialById(state, detailTrialId)
    : undefined;

  const trialColumns: Array<DataColumn<Trial>> = [
    {
      key: "code",
      header: "编号",
      render: (trial) => <span className="table-primary">{trial.code}</span>,
    },
    { key: "cropFamily", header: "作物科属", render: (trial) => trial.cropFamily },
    { key: "season", header: "季节", render: (trial) => trial.season },
    {
      key: "dates",
      header: "日期范围",
      render: (trial) => (
        <span>
          {trial.startDate} 至 {trial.endDate}
        </span>
      ),
    },
    {
      key: "state",
      header: "状态",
      render: (trial) => {
        const label = describeState(trial.state);
        return <StatusBadge tone={statusTone(label)}>{label}</StatusBadge>;
      },
    },
    {
      key: "accessions",
      header: "材料",
      render: (trial) =>
        state.accessions.filter((accession) => accession.trialId === trial.id)
          .length,
    },
    {
      key: "actions",
      header: "",
      render: (trial) => (
        <div className="copy-row-actions">
          <Button
            tone="ghost"
            size="sm"
            onClick={() => setDetailTrialId(trial.id)}
            data-testid={`copy-history-${trial.id}`}
          >
            <History size={15} />
            复制记录
          </Button>
          <Button
            size="sm"
            onClick={() => setSourceTrialId(trial.id)}
            data-testid={`copy-from-${trial.id}`}
          >
            <Copy size={15} />
            复制为新试验
          </Button>
        </div>
      ),
    },
  ];

  const recordColumns: Array<DataColumn<TrialCopyRecord>> = [
    {
      key: "createdOn",
      header: "复制时间",
      render: (record) => formatDateTime(record.createdOn),
    },
    {
      key: "flow",
      header: "模板 → 新试验",
      render: (record) => (
        <span>
          <span className="table-primary">{record.sourceTrialCode}</span>
          {" → "}
          <span className="table-primary">{record.newTrialCode}</span>
        </span>
      ),
    },
    {
      key: "counts",
      header: "复制 / 跳过",
      render: (record) =>
        `${record.copiedAccessionCount} / ${record.skippedAccessionCount}`,
    },
    {
      key: "revision",
      header: "模板修订",
      render: (record) => (
        <span className="muted-copy" data-testid={`copy-revision-${record.id}`}>
          {record.templateRevision}
        </span>
      ),
    },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="模板滚动"
        title="试验复制"
        description="选择一个已有试验作为下一轮模板：挑选字段、跳过材料、重排编号并生成独立的新试验。"
      />
      <section className="content-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-title">可复制的试验</span>
            <span className="panel-subtitle">
              复制结果是全新草稿试验与新材料身份，历史观测、标记、放行和台架分配都不会带入
            </span>
          </div>
          <Copy size={20} className="panel-icon" aria-hidden="true" />
        </div>
        {state.trials.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="还没有可复制的试验"
            description="先在放行流程中维护至少一个试验，再将其滚动为下一轮模板。"
          />
        ) : (
          <DataTable
            columns={trialColumns}
            rows={state.trials}
            rowKey={(trial) => trial.id}
            emptyMessage="暂无可复制的试验。"
          />
        )}
      </section>

      <section className="content-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-title">最近复制记录</span>
            <span className="panel-subtitle">
              记录用于重复提交去重：同一复制请求重试不会产生第二套试验
            </span>
          </div>
        </div>
        {allRecords.length === 0 ? (
          <EmptyState
            icon={History}
            title="尚无复制记录"
            description="完成一次试验复制后，来源、编号和模板修订会记录在这里。"
          />
        ) : (
          <DataTable
            columns={recordColumns}
            rows={allRecords}
            rowKey={(record) => record.id}
            emptyMessage="尚无复制记录。"
          />
        )}
      </section>

      <Dialog
        open={sourceTrialId !== undefined}
        title="从模板复制试验"
        onClose={() => setSourceTrialId(undefined)}
        wide
      >
        {sourceTrialId ? (
          <CopyTrialDialog
            sourceTrialId={sourceTrialId}
            onClose={() => setSourceTrialId(undefined)}
            onCommitted={(newCode, copiedCount) => {
              setSourceTrialId(undefined);
              pushToast({
                tone: "success",
                title: `新试验 ${newCode} 已创建`,
                message: `复制了 ${copiedCount} 个独立材料；观测、标记、放行与台架分配均未带入。`,
              });
            }}
          />
        ) : null}
      </Dialog>

      <Dialog
        open={detailTrialId !== undefined}
        title={detailTrial ? `${detailTrial.code} 的复制记录` : "复制记录"}
        onClose={() => setDetailTrialId(undefined)}
      >
        {detailRecords.length === 0 ? (
          <p className="muted-copy" data-testid="copy-history-empty">
            该试验还没有作为模板或复制目标参与过复制。
          </p>
        ) : (
          <DataTable
            columns={recordColumns}
            rows={detailRecords}
            rowKey={(record) => record.id}
          />
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
