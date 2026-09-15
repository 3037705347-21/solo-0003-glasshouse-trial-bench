import { ArrowLeft, History, Wrench } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import type { BenchMaintenanceRecord } from "../../domain/types";
import { useWorkspace } from "../../state/store";

function displayDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function outcomeLabel(record: BenchMaintenanceRecord): string {
  if (!record.outcome) {
    return record.startedAt ? "维护中" : "待疏散";
  }
  return record.outcome === "completed" ? "维护完成" : "已取消";
}

function outcomeTone(record: BenchMaintenanceRecord): "positive" | "warning" | "info" | "critical" {
  if (record.outcome === "completed") {
    return "positive";
  }
  if (record.outcome === "cancelled") {
    return "info";
  }
  return record.startedAt ? "critical" : "warning";
}

export function BenchHistoryPage() {
  const { benchId = "" } = useParams();
  const navigate = useNavigate();
  const { state } = useWorkspace();
  const bench = state.benches.find((item) => item.id === benchId);

  if (!bench) {
    return (
      <div className="page">
        <EmptyState
          icon={History}
          title="台架不存在"
          description="该台架可能已被移除，维护历史无法继续显示。"
        />
        <Button tone="secondary" onClick={() => navigate("/layout")}>
          <ArrowLeft size={16} />
          返回台架布局
        </Button>
      </div>
    );
  }

  const lightLabel =
    bench.lightProfile === "full-sun"
      ? "全日照"
      : bench.lightProfile === "partial-shade"
        ? "半阴"
        : "遮阴";

  return (
    <div className="page" data-testid="bench-history-page">
      <PageHeader
        eyebrow="台架历史"
        title={`${bench.code} · ${bench.sector}`}
        description="回看台架临时维护的申请、疏散迁移、取消与完成结论；维护结束后旧操作仍然可追溯。"
        actions={
          <Button tone="secondary" onClick={() => navigate("/layout")}>
            <ArrowLeft size={16} />
            返回台架布局
          </Button>
        }
      />

      <section className="history-summary-grid">
        <article className="history-summary-card">
          <span>容量与光照</span>
          <strong>{bench.capacity} 槽位</strong>
          <small>
            {lightLabel} · 管路 {bench.irrigationLine}
          </small>
        </article>
        <article className="history-summary-card">
          <span>当前状态</span>
          <strong>{bench.status}</strong>
          <small>当前占用 {bench.assignedIds.length} 个材料</small>
        </article>
        <article className="history-summary-card">
          <span>维护次数</span>
          <strong>{bench.maintenanceHistory.length}</strong>
          <small>每次维护的迁移与结论均追加保留</small>
        </article>
        <article className="history-summary-card">
          <span>累计迁移</span>
          <strong>
            {bench.maintenanceHistory.reduce(
              (sum, record) => sum + record.relocations.length,
              0,
            )}
          </strong>
          <small>维护疏散产生的材料迁移条目</small>
        </article>
      </section>

      <section className="content-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-title">维护记录</span>
            <span className="panel-subtitle">
              申请时间、原因、每次疏散迁移以及取消/完成结论
            </span>
          </div>
          <Wrench size={20} className="panel-icon" aria-hidden="true" />
        </div>
        {bench.maintenanceHistory.length === 0 ? (
          <p className="history-empty">该台架还没有维护记录。</p>
        ) : (
          <div className="lifecycle-timeline">
            {[...bench.maintenanceHistory].reverse().map((record) => (
              <article className="lifecycle-entry" key={record.id}>
                <StatusBadge tone={outcomeTone(record)}>
                  {outcomeLabel(record)}
                </StatusBadge>
                <dl>
                  <div>
                    <dt>申请时间</dt>
                    <dd>{displayDateTime(record.requestedAt)}</dd>
                  </div>
                  <div>
                    <dt>开始维护</dt>
                    <dd>
                      {record.startedAt
                        ? displayDateTime(record.startedAt)
                        : "未正式开始（过渡态取消）"}
                    </dd>
                  </div>
                  <div>
                    <dt>结束时间</dt>
                    <dd>
                      {record.endedAt ? displayDateTime(record.endedAt) : "尚未结束"}
                    </dd>
                  </div>
                  <div>
                    <dt>申请前状态</dt>
                    <dd>{record.previousStatus}</dd>
                  </div>
                </dl>
                <p>{record.reason}</p>
                {record.endNote ? <p>结论备注：{record.endNote}</p> : null}
                {record.relocations.length > 0 ? (
                  <div className="history-list">
                    {record.relocations.map((relocation) => {
                      const accession = state.accessions.find(
                        (item) => item.id === relocation.accessionId,
                      );
                      const target = state.benches.find(
                        (item) => item.id === relocation.toBenchId,
                      );
                      return (
                        <div className="history-list-row" key={relocation.id}>
                          <div>
                            <strong>
                              {accession
                                ? `${accession.accessionNo} · ${accession.cultivar}`
                                : relocation.accessionId}
                            </strong>
                            <span>
                              {bench.code} → {target?.code ?? relocation.toBenchId}
                            </span>
                          </div>
                          <span>
                            {displayDateTime(relocation.relocatedAt)}
                            {relocation.note ? ` · ${relocation.note}` : ""}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
