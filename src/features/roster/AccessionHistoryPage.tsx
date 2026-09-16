import { useMemo } from "react";
import { ArrowLeft, History, Link2, TriangleAlert } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import { isAccessionRetired } from "../../domain/accession";
import type {
  AccessionRetirementRecord,
  ObservationEntry,
} from "../../domain/types";
import {
  benchForAccession,
  openInspectionsForBenchState,
  replacedByAccessions,
  replacementForAccession,
  trialById,
} from "../../state/selectors";
import { useWorkspace } from "../../state/store";

interface ObservationHistoryRow {
  passId: string;
  observedOn: string;
  observer: string;
  entry: ObservationEntry;
}

function displayDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function lifecycleTone(record: AccessionRetirementRecord) {
  return record.restoredAt ? "neutral" : "warning";
}

export function AccessionHistoryPage() {
  const { accessionId = "" } = useParams();
  const navigate = useNavigate();
  const { state } = useWorkspace();
  const accession = state.accessions.find((item) => item.id === accessionId);

  const observationRows = useMemo<ObservationHistoryRow[]>(() => {
    if (!accession) {
      return [];
    }
    return state.observationPasses
      .filter((pass) => pass.trialId === accession.trialId)
      .flatMap((pass) =>
        pass.entries
          .filter((entry) => entry.accessionId === accession.id)
          .map((entry) => ({
            passId: pass.id,
            observedOn: pass.observedOn,
            observer: pass.observer,
            entry,
          })),
      )
      .sort((left, right) => right.observedOn.localeCompare(left.observedOn));
  }, [accession, state.observationPasses]);

  const relatedFlags = useMemo(
    () =>
      accession
        ? state.flags.filter((flag) => flag.accessionId === accession.id)
        : [],
    [accession, state.flags],
  );

  const relatedSnapshots = useMemo(
    () =>
      accession
        ? state.clearanceSnapshots.filter((snapshot) =>
            snapshot.blockers.some(
              (blocker) => blocker.accessionId === accession.id,
            ),
          )
        : [],
    [accession, state.clearanceSnapshots],
  );

  if (!accession) {
    return (
      <div className="page">
        <EmptyState
          icon={History}
          title="材料不存在"
          description="该材料可能已被移除，历史页面无法继续显示。"
        />
        <Button tone="secondary" onClick={() => navigate("/roster")}>
          <ArrowLeft size={16} />
          返回材料登记
        </Button>
      </div>
    );
  }

  const trial = trialById(state, accession.trialId);
  const bench = benchForAccession(state, accession.id);
  const benchOpenInspections = bench
    ? openInspectionsForBenchState(state, bench.id)
    : [];
  const replacement = replacementForAccession(state, accession);
  const replacedBy = replacedByAccessions(state, accession.id);
  const retired = isAccessionRetired(accession);

  return (
    <div className="page" data-testid="accession-history-page">
      <PageHeader
        eyebrow="材料历史"
        title={`${accession.accessionNo} · ${accession.cultivar}`}
        description="回看材料生命周期、停用与替代关系，以及仍然关联的观测、标记、台架和放行引用。"
        actions={
          <Button tone="secondary" onClick={() => navigate("/roster")}>
            <ArrowLeft size={16} />
            返回材料登记
          </Button>
        }
      />

      <section className="history-summary-grid">
        <article className="history-summary-card">
          <span>生命周期</span>
          <strong>{retired ? "已停用" : "在用"}</strong>
          <StatusBadge tone={retired ? "warning" : "positive"}>
            {retired ? "保留历史引用" : "可进入新流程"}
          </StatusBadge>
        </article>
        <article className="history-summary-card">
          <span>所属试验</span>
          <strong>{trial ? `${trial.code} · ${trial.cropFamily}` : "未知试验"}</strong>
          <small>{trial?.objective ?? "缺少试验信息"}</small>
        </article>
        <article className="history-summary-card">
          <span>台架历史记录</span>
          <strong>{bench ? bench.code : "未分配"}</strong>
          <small>
            {bench
              ? `${bench.sector} · ${bench.lightProfile === "full-sun" ? "全日照" : bench.lightProfile === "partial-shade" ? "半阴" : "遮阴"}`
              : "没有当前台架占用记录"}
          </small>
          {benchOpenInspections.length > 0 ? (
            <button
              type="button"
              className="inspection-inline-link"
              onClick={() =>
                navigate(`/benches/${bench!.id}/inspections`)
              }
              data-testid="accession-history-bench-inspections"
            >
              <TriangleAlert size={14} aria-hidden="true" />
              {benchOpenInspections.length} 项巡检异常未解除
            </button>
          ) : null}
        </article>
        <article className="history-summary-card">
          <span>替代关系</span>
          <strong>{replacement ? replacement.accessionNo : "未指定"}</strong>
          <small>
            {replacement
              ? `当前替代材料：${replacement.cultivar}`
              : "没有记录替代材料"}
          </small>
        </article>
      </section>

      <section className="content-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-title">停用与恢复记录</span>
            <span className="panel-subtitle">
              每次停用都保留时间、原因和替代对象
            </span>
          </div>
          <History size={20} className="panel-icon" aria-hidden="true" />
        </div>
        {accession.retirementHistory.length === 0 ? (
          <p className="history-empty">该材料还没有停用记录。</p>
        ) : (
          <div className="lifecycle-timeline">
            {[...accession.retirementHistory]
              .reverse()
              .map((record) => {
                const recordReplacement = state.accessions.find(
                  (item) => item.id === record.replacementId,
                );
                return (
                  <article className="lifecycle-entry" key={record.id}>
                    <StatusBadge tone={lifecycleTone(record)}>
                      {record.restoredAt ? "曾停用后恢复" : "停用中"}
                    </StatusBadge>
                    <dl>
                      <div>
                        <dt>停用时间</dt>
                        <dd>{displayDateTime(record.retiredAt)}</dd>
                      </div>
                      <div>
                        <dt>替代材料</dt>
                        <dd>
                          {recordReplacement
                            ? `${recordReplacement.accessionNo} · ${recordReplacement.cultivar}`
                            : "未指定"}
                        </dd>
                      </div>
                      <div>
                        <dt>恢复时间</dt>
                        <dd>
                          {record.restoredAt
                            ? displayDateTime(record.restoredAt)
                            : "尚未恢复"}
                        </dd>
                      </div>
                    </dl>
                    <p>{record.reason}</p>
                  </article>
                );
              })}
          </div>
        )}
      </section>

      {replacedBy.length > 0 ? (
        <section className="content-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-title">被替代材料</span>
              <span className="panel-subtitle">
                当前材料被其他批次指定为替代对象
              </span>
            </div>
            <Link2 size={20} className="panel-icon" aria-hidden="true" />
          </div>
          <div className="relation-list">
            {replacedBy.map((item) => (
              <Button
                key={item.id}
                tone="ghost"
                onClick={() => navigate(`/accessions/${item.id}/history`)}
              >
                {item.accessionNo} · {item.cultivar}
                <StatusBadge tone={isAccessionRetired(item) ? "warning" : "positive"}>
                  {isAccessionRetired(item) ? "已停用" : "在用"}
                </StatusBadge>
              </Button>
            ))}
          </div>
        </section>
      ) : null}

      <section className="history-two-column">
        <article className="content-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-title">历史观测</span>
              <span className="panel-subtitle">
                {observationRows.length} 条与材料关联的测量记录
              </span>
            </div>
          </div>
          {observationRows.length === 0 ? (
            <p className="history-empty">暂无历史观测。</p>
          ) : (
            <div className="history-list">
              {observationRows.map((row) => (
                <div
                  className="history-list-row"
                  key={`${row.passId}-${accession.id}`}
                >
                  <div>
                    <strong>{row.observedOn}</strong>
                    <span>{row.observer}</span>
                  </div>
                  <div>
                    <span>株高 {row.entry.heightMm} mm</span>
                    <span>叶片 {row.entry.leafCount}</span>
                    <span>EC {row.entry.ecMs}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="content-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-title">标记与放行引用</span>
              <span className="panel-subtitle">
                {relatedFlags.length} 个标记，{relatedSnapshots.length} 份快照引用
              </span>
            </div>
          </div>
          {relatedFlags.length === 0 && relatedSnapshots.length === 0 ? (
            <p className="history-empty">暂无标记或放行引用。</p>
          ) : (
            <div className="history-list">
              {relatedFlags.map((flag) => (
                <div className="history-list-row" key={flag.id}>
                  <div>
                    <strong>{flag.code}</strong>
                    <StatusBadge tone={statusTone(flag.severity)}>
                      {flag.severity}
                    </StatusBadge>
                  </div>
                  <span>{flag.message}</span>
                </div>
              ))}
              {relatedSnapshots.map((snapshot) => (
                <div className="history-list-row" key={snapshot.id}>
                  <div>
                    <strong>放行快照</strong>
                    <StatusBadge tone={statusTone(snapshot.status)}>
                      {snapshot.status === "ready" ? "就绪" : "阻止"}
                    </StatusBadge>
                  </div>
                  <span>{displayDateTime(snapshot.generatedOn)}</span>
                </div>
              ))}
            </div>
          )}
        </article>
      </section>
    </div>
  );
}
