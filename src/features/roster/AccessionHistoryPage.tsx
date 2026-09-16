import { useMemo, useState } from "react";
import {
  ArrowLeft,
  ClipboardPlus,
  Copy,
  History,
  Link2,
  Merge,
  PencilLine,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import { isAccessionRetired } from "../../domain/accession";
import {
  destinationLabel,
  effectiveUsedQuantity,
  stockLevelLabel,
  suggestedCopyAccessionNumber,
} from "../../domain/consumption";
import type {
  AccessionRetirementRecord,
  ConsumptionEvent,
  ObservationEntry,
} from "../../domain/types";
import {
  accessionStock,
  benchForAccession,
  consumptionEventsFor,
  replacedByAccessions,
  replacementForAccession,
  trialById,
} from "../../state/selectors";
import { useWorkspace } from "../../state/store";
import { RecordConsumptionDialog } from "./RecordConsumptionDialog";
import { CorrectConsumptionDialog } from "./CorrectConsumptionDialog";
import { MergeAccessionsDialog } from "./MergeAccessionsDialog";
import { CopyAccessionDialog } from "./CopyAccessionDialog";

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

function eventKindLabel(event: ConsumptionEvent): string {
  if (event.kind === "use") {
    return "耗用";
  }
  if (event.kind === "correction") {
    return "更正";
  }
  return event.delta < 0 ? "转出" : "转入";
}

function eventTone(event: ConsumptionEvent): "critical" | "positive" | "info" | "neutral" {
  if (event.kind === "correction") {
    return "info";
  }
  if (event.kind === "transfer") {
    return "neutral";
  }
  return "critical";
}

export function AccessionHistoryPage() {
  const { accessionId = "" } = useParams();
  const navigate = useNavigate();
  const { state } = useWorkspace();
  const accession = state.accessions.find((item) => item.id === accessionId);
  const [consumeOpen, setConsumeOpen] = useState(false);
  const [correctingEvent, setCorrectingEvent] = useState<
    ConsumptionEvent | undefined
  >();
  const [mergeOpen, setMergeOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  };

  const consumptionEvents = useMemo(
    () => (accession ? consumptionEventsFor(state, accession.id) : []),
    [state, accession],
  );

  // 被后续更正冲销的原始耗用 id，用于在流水中标注「已更正」。
  const supersededIds = useMemo(
    () =>
      new Set(
        consumptionEvents
          .map((event) => event.supersedesId)
          .filter((id): id is string => Boolean(id)),
      ),
    [consumptionEvents],
  );

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
  const replacement = replacementForAccession(state, accession);
  const replacedBy = replacedByAccessions(state, accession.id);
  const retired = isAccessionRetired(accession);
  const stock = accessionStock(state, accession);
  const mergeCandidates = state.accessions.filter(
    (item) =>
      item.id !== accession.id &&
      item.trialId === accession.trialId &&
      !isAccessionRetired(item),
  );

  return (
    <div className="page" data-testid="accession-history-page">
      <PageHeader
        eyebrow="材料历史"
        title={`${accession.accessionNo} · ${accession.cultivar}`}
        description="回看批次耗用流水、生命周期、停用与替代关系，以及仍然关联的观测、标记、台架和放行引用。"
        actions={
          <div className="page-header-actions">
            {!retired ? (
              <>
                <Button
                  tone="secondary"
                  onClick={() => setConsumeOpen(true)}
                  data-testid="open-consumption-dialog"
                >
                  <ClipboardPlus size={16} />
                  登记耗用
                </Button>
                <Button
                  tone="secondary"
                  onClick={() => setMergeOpen(true)}
                  disabled={mergeCandidates.length === 0 || stock.remaining <= 0}
                  data-testid="open-merge-dialog"
                >
                  <Merge size={16} />
                  合并批次
                </Button>
              </>
            ) : null}
            <Button
              tone="secondary"
              onClick={() => setCopyOpen(true)}
              data-testid="open-copy-dialog"
            >
              <Copy size={16} />
              跨试验复制
            </Button>
            <Button tone="secondary" onClick={() => navigate("/roster")}>
              <ArrowLeft size={16} />
              返回
            </Button>
          </div>
        }
      />

      {accession.copiedFromAccessionNo ? (
        <section className="content-panel provenance-banner">
          <Copy size={16} aria-hidden="true" />
          <span>
            本批次由 {accession.copiedFromTrialCode ?? "其他试验"} 的{" "}
            {accession.copiedFromAccessionNo} 跨试验复制而来；复制后的耗用归属本批次，
            原批次流水不随之复制。
          </span>
        </section>
      ) : null}

      <section className="history-summary-grid">
        <article className="history-summary-card">
          <span>当前余量</span>
          <strong
            className={
              stock.level === "empty" || stock.level === "negative"
                ? "stock-number-critical"
                : stock.level === "low"
                  ? "stock-number-warning"
                  : undefined
            }
            data-testid="history-remaining"
          >
            {stock.remaining}
          </strong>
          <StatusBadge
            tone={
              stock.level === "in-stock"
                ? "positive"
                : stock.level === "low"
                  ? "warning"
                  : "critical"
            }
          >
            {stockLevelLabel(stock.level)}
          </StatusBadge>
        </article>
        <article className="history-summary-card">
          <span>登记数量</span>
          <strong>{stock.registered}</strong>
          <small>批次登记的初始数量</small>
        </article>
        <article className="history-summary-card">
          <span>净耗用 / 损耗</span>
          <strong>{stock.consumed}</strong>
          <small>
            转入 {stock.transferredIn} · 转出 {stock.transferredOut}
          </small>
        </article>
        <article className="history-summary-card">
          <span>生命周期</span>
          <strong>{retired ? "已停用" : "在用"}</strong>
          <StatusBadge tone={retired ? "warning" : "positive"}>
            {retired ? "保留历史引用" : "可进入新流程"}
          </StatusBadge>
        </article>
        <article className="history-summary-card">
          <span>所属试验</span>
          <strong>{trial ? trial.code : "未知试验"}</strong>
          <small>{trial ? `${trial.cropFamily} · ${trial.objective}` : "缺少试验信息"}</small>
        </article>
        <article className="history-summary-card">
          <span>台架历史记录</span>
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

      <section className="content-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-title">耗用流水</span>
            <span className="panel-subtitle">
              每次使用的数量、去向、日期、登记人和说明；更正以冲销流水追加，不覆盖原始记录
            </span>
          </div>
          <ClipboardPlus size={20} className="panel-icon" aria-hidden="true" />
        </div>
        {consumptionEvents.length === 0 ? (
          <p className="history-empty" data-testid="consumption-empty">
            该批次还没有耗用记录，余量等于登记数量 {stock.registered}。
          </p>
        ) : (
          <div className="ledger-list" data-testid="consumption-ledger">
            {consumptionEvents.map((event) => {
              const superseded = supersededIds.has(event.id);
              const originalEvent = event.supersedesId
                ? consumptionEvents.find((item) => item.id === event.supersedesId)
                : undefined;
              return (
                <article
                  className={`ledger-entry ledger-entry-${event.kind}${
                    superseded ? " ledger-entry-superseded" : ""
                  }`}
                  key={event.id}
                  data-testid={`ledger-entry-${event.id}`}
                >
                  <div className="ledger-entry-main">
                    <div className="ledger-entry-heading">
                      <StatusBadge tone={eventTone(event)}>
                        {eventKindLabel(event)}
                      </StatusBadge>
                      {superseded ? (
                        <StatusBadge tone="neutral">已更正</StatusBadge>
                      ) : null}
                      <strong>{event.usedOn}</strong>
                      <span className="ledger-destination">
                        {destinationLabel(event.destination)} · {event.ref.label}
                        {event.ref.trialCode ? `（${event.ref.trialCode}）` : ""}
                      </span>
                    </div>
                    <p>{event.note}</p>
                    <dl className="ledger-meta">
                      <div>
                        <dt>登记人</dt>
                        <dd>{event.recordedBy}</dd>
                      </div>
                      <div>
                        <dt>入账时间</dt>
                        <dd>{displayDateTime(event.recordedAt)}</dd>
                      </div>
                      {event.kind === "use" && !superseded ? (
                        <div>
                          <dt>当前有效耗用</dt>
                          <dd>{effectiveUsedQuantity(event, consumptionEvents)}</dd>
                        </div>
                      ) : null}
                      {event.transferPairAccessionNo ? (
                        <div>
                          <dt>配对批次</dt>
                          <dd>{event.transferPairAccessionNo}</dd>
                        </div>
                      ) : null}
                    </dl>
                    {originalEvent ? (
                      <p className="ledger-correction-ref">
                        更正对象：{originalEvent.usedOn} 登记的耗用（原数量{" "}
                        {-originalEvent.delta}，去向 {originalEvent.ref.label}）
                      </p>
                    ) : null}
                  </div>
                  <div className="ledger-entry-aside">
                    <span
                      className={`ledger-delta ledger-delta-${
                        event.delta < 0 ? "out" : "in"
                      }`}
                    >
                      {event.delta < 0 ? "" : "+"}
                      {event.delta}
                    </span>
                    {event.kind === "use" && !superseded ? (
                      <Button
                        tone="ghost"
                        size="sm"
                        onClick={() => setCorrectingEvent(event)}
                        data-testid={`correct-consumption-${event.id}`}
                      >
                        <PencilLine size={14} />
                        更正
                      </Button>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
        )}
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

      {consumeOpen ? (
        <RecordConsumptionDialog
          accession={accession}
          state={state}
          onCancel={() => setConsumeOpen(false)}
          onSaved={(event) => {
            setConsumeOpen(false);
            pushToast({
              tone: "success",
              title: "耗用已登记",
              message: `${accession.accessionNo} 记录 ${-event.delta} 单位耗用，余量已按流水更新。`,
            });
          }}
        />
      ) : null}
      {correctingEvent ? (
        <CorrectConsumptionDialog
          accession={accession}
          event={correctingEvent}
          state={state}
          onCancel={() => setCorrectingEvent(undefined)}
          onSaved={(event) => {
            setCorrectingEvent(undefined);
            pushToast({
              tone: "success",
              title: "更正已留痕",
              message: `已追加 ${event.delta > 0 ? "+" : ""}${event.delta} 的冲销流水，原始记录保留未改。`,
            });
          }}
        />
      ) : null}
      {mergeOpen ? (
        <MergeAccessionsDialog
          accession={accession}
          state={state}
          onCancel={() => setMergeOpen(false)}
          onSaved={(_events, target) => {
            setMergeOpen(false);
            pushToast({
              tone: "success",
              title: "批次已合并",
              message: `${accession.accessionNo} 余量已转入 ${target.accessionNo} 并停用，台架与观测状态未改动。`,
            });
          }}
        />
      ) : null}
      {copyOpen ? (
        <CopyAccessionDialog
          accession={accession}
          state={state}
          suggestedAccessionNo={suggestedCopyAccessionNumber(state)}
          onCancel={() => setCopyOpen(false)}
          onSaved={(newAccession) => {
            setCopyOpen(false);
            pushToast({
              tone: "success",
              title: "已跨试验复制",
              message: `${accession.accessionNo} 的 ${newAccession.quantity} 单位转入新批次 ${newAccession.accessionNo}。`,
            });
            navigate(`/accessions/${newAccession.id}/history`);
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
