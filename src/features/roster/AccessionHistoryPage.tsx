import { useMemo } from "react";
import { ArrowLeft, GitMerge, History, Link2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge } from "../../components/StatusBadge";
import {
  isAccessionMerged,
  isAccessionRetired,
} from "../../domain/accession";
import type {
  Accession,
  AccessionMergeRecord,
  AccessionRetirementRecord,
} from "../../domain/types";
import {
  benchForAccession,
  mergeRecordForAccession,
  mergeRecordsForSurvivor,
  observationRowsForAccession,
  replacedByAccessions,
  replacementForAccession,
  trialById,
} from "../../state/selectors";
import { useWorkspace } from "../../state/store";

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

  const observationRows = useMemo(
    () => (accession ? observationRowsForAccession(state, accession.id) : []),
    [accession, state],
  );

  const relatedFlags = useMemo(() => {
    if (!accession) {
      return [];
    }
    return state.flags.filter(
      (flag) => (flag.sourceAccessionId ?? flag.accessionId) === accession.id,
    );
  }, [accession, state.flags]);

  const relatedSnapshots = useMemo(() => {
    if (!accession) {
      return [];
    }
    // 已保存快照不可变：即使其 blocker 指向旧 id，这里也能解释原始来源。
    return state.clearanceSnapshots.filter((snapshot) =>
      snapshot.blockers.some(
        (blocker) => blocker.accessionId === accession.id,
      ),
    );
  }, [accession, state.clearanceSnapshots]);

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
  const replacement = replacementForAccession(state, accession);
  const replacedBy = replacedByAccessions(state, accession.id);
  const retired = isAccessionRetired(accession);
  const merged = isAccessionMerged(accession);
  const survivor = merged
    ? state.accessions.find((item) => item.id === accession.mergedIntoId)
    : undefined;
  const ownMergeRecord = merged
    ? mergeRecordForAccession(state, accession.id)
    : undefined;
  const survivorMergeRecords =
    !merged && accession
      ? mergeRecordsForSurvivor(state, accession.id)
      : [];
  // 哪些墓碑与当前存活者共享身份（含自身）。
  const identitySources: Accession[] = state.accessions.filter(
    (item) => item.mergedIntoId === accession.id,
  );

  const renderProvenanceTag = (sourceId?: string) => {
    if (!sourceId || sourceId === accession.id) {
      return null;
    }
    const source = state.accessions.find((item) => item.id === sourceId);
    return (
      <StatusBadge tone="info">
        {`原始来源 ${source?.accessionNo ?? sourceId}`}
      </StatusBadge>
    );
  };

  return (
    <div className="page" data-testid="accession-history-page">
      <PageHeader
        eyebrow={merged ? "合并墓碑" : "材料历史"}
        title={`${accession.accessionNo} · ${accession.cultivar}`}
        description={
          merged
            ? "该批次已合并入存活批次，此页保留其原始身份与全部来源记录。"
            : "回看材料生命周期、合并溯源、停用与替代关系，以及仍然关联的观测、标记、台架和放行引用。"
        }
        actions={
          <Button tone="secondary" onClick={() => navigate("/roster")}>
            <ArrowLeft size={16} />
            返回材料登记
          </Button>
        }
      />

      {merged ? (
        <section className="content-panel merge-tombstone-banner">
          <div className="panel-heading">
            <div>
              <span className="panel-title">身份已合并</span>
              <span className="panel-subtitle">
                合并后当前操作唯一归属于存活批次，旧 id 永久保留用于解释历史
              </span>
            </div>
            <GitMerge size={20} className="panel-icon" aria-hidden="true" />
          </div>
          <div className="merge-tombstone-body">
            <StatusBadge tone="info">已合并墓碑</StatusBadge>
            {survivor ? (
              <Button
                tone="ghost"
                size="sm"
                onClick={() =>
                  navigate(`/accessions/${survivor.id}/history`)
                }
                data-testid="tombstone-survivor-link"
              >
                跳转到存活者 {survivor.accessionNo} · {survivor.cultivar}
              </Button>
            ) : (
              <span className="muted-copy">存活者记录缺失</span>
            )}
            {ownMergeRecord ? (
              <p className="merge-reason-text">
                合并于 {displayDateTime(ownMergeRecord.mergedOn)}：
                {ownMergeRecord.reason}
              </p>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="history-summary-grid">
        <article className="history-summary-card">
          <span>生命周期</span>
          <strong>{merged ? "已合并" : retired ? "已停用" : "在用"}</strong>
          <StatusBadge tone={merged || retired ? "warning" : "positive"}>
            {merged
              ? "历史只读"
              : retired
                ? "保留历史引用"
                : "可进入新流程"}
          </StatusBadge>
        </article>
        <article className="history-summary-card">
          <span>所属试验</span>
          <strong>{trial ? `${trial.code} · ${trial.cropFamily}` : "未知试验"}</strong>
          <small>{trial?.objective ?? "缺少试验信息"}</small>
        </article>
        <article className="history-summary-card">
          <span>台架{merged ? "（存活者当前位置）" : "历史记录"}</span>
          <strong>{bench ? bench.code : "未分配"}</strong>
          <small>
            {bench
              ? `${bench.sector} · ${bench.lightProfile === "full-sun" ? "全日照" : bench.lightProfile === "partial-shade" ? "半阴" : "遮阴"}`
              : "没有当前台架占用记录"}
          </small>
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

      {identitySources.length > 0 ? (
        <section className="content-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-title">合并来源</span>
              <span className="panel-subtitle">
                以下批次的当前操作已重写到本存活者，原始身份保留为墓碑
              </span>
            </div>
            <GitMerge size={20} className="panel-icon" aria-hidden="true" />
          </div>
          <div className="relation-list">
            {identitySources.map((item) => (
              <Button
                key={item.id}
                tone="ghost"
                onClick={() => navigate(`/accessions/${item.id}/history`)}
                data-testid={`identity-source-${item.id}`}
              >
                {item.accessionNo} · {item.cultivar}
                <StatusBadge tone="info">已合并</StatusBadge>
              </Button>
            ))}
          </div>
        </section>
      ) : null}

      {survivorMergeRecords.length > 0 ? (
        <section className="content-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-title">合并审计记录</span>
              <span className="panel-subtitle">
                字段裁决、台架位置裁决与丢弃测量值均可在此追溯
              </span>
            </div>
          </div>
          <div className="lifecycle-timeline">
            {survivorMergeRecords.map((record) => (
              <MergeRecordDetail key={record.id} record={record} state={state} />
            ))}
          </div>
        </section>
      ) : null}

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
                当前材料{merged ? "（经身份别名）" : ""}被其他批次指定为替代对象
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
                  {isAccessionRetired(item)
                    ? "已停用"
                    : isAccessionMerged(item)
                      ? "已合并"
                      : "在用"}
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
                {observationRows.length} 条{merged ? "原始录入" : "与材料关联"}的测量记录
              </span>
            </div>
          </div>
          {observationRows.length === 0 ? (
            <p className="history-empty">暂无历史观测。</p>
          ) : (
            <div className="history-list">
              {observationRows.map((row, index) => (
                <div
                  className="history-list-row"
                  key={`${row.passId}-${index}`}
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
                  {renderProvenanceTag(row.entry.sourceAccessionId)}
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
                    {renderProvenanceTag(flag.sourceAccessionId)}
                  </div>
                  <span>{flag.message}</span>
                </div>
              ))}
              {relatedSnapshots.map((snapshot) => (
                <div className="history-list-row" key={snapshot.id}>
                  <div>
                    <strong>放行快照</strong>
                    <StatusBadge tone={snapshot.status === "ready" ? "positive" : "critical"}>
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

function MergeRecordDetail({
  record,
  state,
}: {
  record: AccessionMergeRecord;
  state: ReturnType<typeof useWorkspace>["state"];
}) {
  const nameFor = (id: string) => {
    const accession = state.accessions.find((item) => item.id === id);
    return accession ? accession.accessionNo : id;
  };
  const benchName = (id?: string) =>
    state.benches.find((bench) => bench.id === id)?.code ?? "未分配";
  return (
    <article className="lifecycle-entry merge-record-entry" data-testid={`merge-record-${record.id}`}>
      <StatusBadge tone="positive">已合并</StatusBadge>
      <dl>
        <div>
          <dt>合并时间</dt>
          <dd>{displayDateTime(record.mergedOn)}</dd>
        </div>
        <div>
          <dt>存活者</dt>
          <dd>{nameFor(record.survivorId)}</dd>
        </div>
        <div>
          <dt>被合并批次</dt>
          <dd>{record.mergedIds.map(nameFor).join("、")}</dd>
        </div>
      </dl>
      <p>{record.reason}</p>
      <div className="merge-record-detail">
        <div>
          <h5>字段裁决</h5>
          <ul>
            {record.fieldResolutions.map((resolution) => (
              <li key={resolution.field}>
                {resolution.field}：
                {resolution.strategy === "sum"
                  ? "数量求和"
                  : resolution.strategy === "custom"
                    ? "自定义数量"
                    : `取自 ${nameFor(resolution.chosenSourceId)}`}
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h5>台架裁决</h5>
          <ul>
            {record.benchResolutions.map((resolution, index) => (
              <li key={`${resolution.sourceId}-${index}`}>
                {nameFor(resolution.sourceId)}：{benchName(resolution.fromBenchId)} →{" "}
                {resolution.action === "kept" ? "保留占用" : "移除占用"}
              </li>
            ))}
          </ul>
        </div>
        {record.discardedObservations.length > 0 ? (
          <div>
            <h5>同次观测碰撞中留档的测量值</h5>
            <ul>
              {record.discardedObservations.map((entry, index) => (
                <li key={`${entry.passId}-${index}`}>
                  {entry.observedOn} {entry.observer}：株高 {entry.heightMm}mm ·
                  叶片 {entry.leafCount} · EC {entry.ecMs}
                  {entry.notes ? `（${entry.notes}）` : ""}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    </article>
  );
}
