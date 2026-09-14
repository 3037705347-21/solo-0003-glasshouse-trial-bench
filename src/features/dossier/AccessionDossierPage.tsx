import { useMemo, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarDays,
  CircleCheck,
  CircleX,
  ClipboardCheck,
  Eye,
  Flag,
  LayoutGrid,
  NotebookPen,
  Sprout,
  Tags,
} from "lucide-react";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { ProgressBar } from "../../components/ProgressBar";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import {
  buildAccessionDossier,
  preferredLightLabel,
  type DossierNotice,
} from "../../domain/dossier";
import type { Flag as DomainFlag, TrialState } from "../../domain/types";
import { useWorkspace } from "../../state/store";

const trialStateLabels: Record<TrialState, string> = {
  draft: "草稿",
  active: "进行中",
  paused: "已暂停",
  cleared: "已放行",
};

const severityLabels = {
  critical: "严重",
  warning: "警告",
  info: "提示",
} as const;

const flagStateLabels = {
  open: "未处理",
  resolved: "已解决",
  waived: "已豁免",
} as const;

export function AccessionDossierPage() {
  const { accessionId = "" } = useParams();
  const { state } = useWorkspace();

  // 档案不持有任何独立数据：每次渲染都直接从当前工作区状态派生，
  // 刷新或通过地址直接打开时由路由参数重新定位同一材料。
  const dossier = useMemo(
    () => buildAccessionDossier(state, accessionId),
    [state, accessionId],
  );

  if (!dossier) {
    return (
      <div className="page">
        <PageHeader
          eyebrow="材料档案"
          title="找不到该材料"
          description="地址中的材料编号在当前工作区中不存在，可能已被删除或链接不完整。"
        />
        <section className="content-panel" data-testid="dossier-not-found">
          <EmptyState
            icon={Sprout}
            title="未找到材料档案"
            description={`编号 ${accessionId || "（空）"} 不在当前本地工作区中。请回到材料登记选择一个材料。`}
            action={
              <Link className="button button-secondary button-md" to="/roster">
                <ArrowLeft size={16} />
                返回材料登记
              </Link>
            }
          />
        </section>
      </div>
    );
  }

  const { accession, trial, bench, benchOccupancy, benchMates } = dossier;

  return (
    <div className="page" data-testid={`dossier-${accession.id}`}>
      <PageHeader
        eyebrow="材料档案 · 只读视图"
        title={`${accession.accessionNo} · ${accession.cultivar}`}
        description="本页所有内容实时派生自材料、台架、观测和放行记录，不保存独立档案数据，也不能在此修改材料或台架。"
        actions={
          <Link
            className="button button-secondary button-md"
            to="/roster"
            data-testid="dossier-back-roster"
          >
            <ArrowLeft size={16} />
            返回材料登记
          </Link>
        }
      />

      <NoticeList notices={dossier.notices} />

      <div className="dossier-grid">
        <section className="dossier-card" data-testid="dossier-identity">
          <div className="dossier-section-heading">
            <div>
              <span className="panel-title">试验归属与来源</span>
              <span className="panel-subtitle">
                事实来源：材料登记记录
              </span>
            </div>
            <Sprout size={18} className="panel-icon" aria-hidden="true" />
          </div>
          <dl className="dossier-facts">
            <Fact label="材料编号" value={accession.accessionNo} />
            <Fact label="品种" value={accession.cultivar} />
            <Fact
              label="所属试验"
              value={
                trial ? (
                  <span className="dossier-trial">
                    <Link
                      to="/clearance"
                      className="dossier-link"
                      data-testid="dossier-trial-link"
                    >
                      {trial.code}
                    </Link>
                    <StatusBadge tone={statusTone(trial.state)}>
                      {trialStateLabels[trial.state]}
                    </StatusBadge>
                  </span>
                ) : (
                  <StatusBadge tone="critical">归属试验缺失</StatusBadge>
                )
              }
            />
            <Fact label="作物科属" value={trial?.cropFamily ?? "—"} />
            <Fact label="试验季节" value={trial ? `${trial.season}季` : "—"} />
            <Fact
              label="试验周期"
              value={
                trial ? `${trial.startDate} 至 ${trial.endDate}` : "—"
              }
            />
            <Fact label="来源" value={accession.source} />
            <Fact label="繁殖日期" value={accession.propagatedOn} />
            <Fact label="数量" value={`${accession.quantity} 株`} />
            <Fact label="穴盘规格" value={`${accession.trayCells} 孔`} />
            <Fact
              label="适宜光照"
              value={preferredLightLabel(accession.preferredLight)}
            />
          </dl>
          <p className="dossier-note">{accession.genotypeNote}</p>
          <div className="dossier-labels-block">
            <div className="dossier-subhead">
              <Tags size={14} aria-hidden="true" />
              <span>标签</span>
            </div>
            {accession.labels.length === 0 ? (
              <p className="muted-copy">该材料没有标签。</p>
            ) : (
              <div className="dossier-labels">
                {accession.labels.map((label) => (
                  <StatusBadge key={label} tone="neutral">
                    {label}
                  </StatusBadge>
                ))}
              </div>
            )}
          </div>
        </section>

        <section className="dossier-card" data-testid="dossier-bench">
          <div className="dossier-section-heading">
            <div>
              <span className="panel-title">当前台架与占用状态</span>
              <span className="panel-subtitle">
                事实来源：台架布局的分配名单与台架状态
              </span>
            </div>
            <LayoutGrid size={18} className="panel-icon" aria-hidden="true" />
          </div>
          {!bench || !benchOccupancy ? (
            <div className="dossier-empty-line" data-testid="dossier-no-bench">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>当前没有任何台架分配该材料（未占用槽位）。</span>
            </div>
          ) : (
            <>
              <div className="dossier-bench-top">
                <div>
                  <span className="bench-code">{bench.code}</span>
                  <strong className="dossier-bench-sector">
                    {bench.sector}
                  </strong>
                </div>
                <StatusBadge tone={statusTone(bench.status)}>
                  {bench.status === "assigned"
                    ? "已分配"
                    : bench.status === "blocked"
                      ? "受限"
                      : bench.status === "quarantine"
                        ? "隔离"
                        : "可用"}
                </StatusBadge>
              </div>
              <dl className="dossier-facts">
                <Fact
                  label="台架光照"
                  value={
                    <span className="dossier-trial">
                      {preferredLightLabel(bench.lightProfile)}
                      {dossier.lightCompatible === false ? (
                        <StatusBadge tone="warning">与材料光照不兼容</StatusBadge>
                      ) : (
                        <StatusBadge tone="positive">光照兼容</StatusBadge>
                      )}
                    </span>
                  }
                />
                <Fact label="灌溉管路" value={bench.irrigationLine} />
                <Fact
                  label="占用槽位"
                  value={`${benchOccupancy.used} / ${benchOccupancy.capacity}`}
                />
              </dl>
              <ProgressBar
                value={benchOccupancy.used}
                max={benchOccupancy.capacity}
                tone={
                  benchOccupancy.used >= benchOccupancy.capacity
                    ? "critical"
                    : benchOccupancy.capacity - benchOccupancy.used === 1
                      ? "warning"
                      : "positive"
                }
              />
              {bench.blockedReason ? (
                <p className="bench-reason">停用原因：{bench.blockedReason}</p>
              ) : null}
              <div className="dossier-labels-block">
                <div className="dossier-subhead">
                  <Sprout size={14} aria-hidden="true" />
                  <span>同架材料（{benchMates.length}）</span>
                </div>
                {benchMates.length === 0 ? (
                  <p className="muted-copy">该台架上只有此材料。</p>
                ) : (
                  <ul className="dossier-mate-list">
                    {benchMates.map((mate) => (
                      <li key={mate.id}>
                        <Link
                          to={`/accessions/${mate.id}`}
                          className="dossier-link"
                          data-testid={`dossier-mate-${mate.id}`}
                        >
                          {mate.accessionNo} · {mate.cultivar}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
          <p className="dossier-source-line">
            需要调整分配或移出材料，请前往
            <Link className="dossier-link" to="/layout">
              台架布局
            </Link>
            操作。
          </p>
        </section>

        <section
          className="dossier-card dossier-card-wide"
          data-testid="dossier-observations"
        >
          <div className="dossier-section-heading">
            <div>
              <span className="panel-title">历次观测测量</span>
              <span className="panel-subtitle">
                事实来源：所有观测批次中该材料的测量条目（{dossier.observations.length}{" "}
                次）
              </span>
            </div>
            <NotebookPen size={18} className="panel-icon" aria-hidden="true" />
          </div>
          {dossier.observations.length === 0 ? (
            <div className="dossier-empty-line" data-testid="dossier-no-observations">
              <AlertTriangle size={16} aria-hidden="true" />
              <span>
                该材料还没有测量记录；可在生长观测页为其所属试验录入观测。
              </span>
            </div>
          ) : (
            <div className="data-table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>观测日期</th>
                    <th>观测人</th>
                    <th>株高 (mm)</th>
                    <th>叶片数</th>
                    <th>电导率 (mS/cm)</th>
                    <th>派生标记</th>
                    <th>备注</th>
                  </tr>
                </thead>
                <tbody>
                  {dossier.observations.map((record) => (
                    <tr key={record.passId} data-testid={`dossier-obs-${record.passId}`}>
                      <td>
                        <span className="table-primary">{record.observedOn}</span>
                      </td>
                      <td>{record.observer}</td>
                      <td>{record.entry.heightMm}</td>
                      <td>{record.entry.leafCount}</td>
                      <td>{record.entry.ecMs}</td>
                      <td>
                        {record.flags.length === 0 ? (
                          <span className="muted-copy">无</span>
                        ) : (
                          <span className="dossier-flag-codes">
                            {record.flags.map((flag) => (
                              <StatusBadge
                                key={flag.id}
                                tone={statusTone(flag.severity)}
                              >
                                {flag.code}
                              </StatusBadge>
                            ))}
                          </span>
                        )}
                      </td>
                      <td className="dossier-notes-cell">
                        {record.entry.notes || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section
          className="dossier-card dossier-card-wide"
          data-testid="dossier-flags"
        >
          <div className="dossier-section-heading">
            <div>
              <span className="panel-title">派生标记及处理结果</span>
              <span className="panel-subtitle">
                事实来源：观测入库时派生的标记及其生命周期状态（
                {dossier.openFlags.length} 个未处理）
              </span>
            </div>
            <Flag size={18} className="panel-icon" aria-hidden="true" />
          </div>
          {dossier.flags.length === 0 ? (
            <p className="muted-copy">
              历次观测均未为该材料派生出株高、叶片数或电导率标记。
            </p>
          ) : (
            <ul className="dossier-flag-list">
              {dossier.flags.map((flag) => (
                <FlagRow key={flag.id} flag={flag} />
              ))}
            </ul>
          )}
        </section>

        <section
          className="dossier-card dossier-card-wide"
          data-testid="dossier-clearance"
        >
          <div className="dossier-section-heading">
            <div>
              <span className="panel-title">相关放行记录</span>
              <span className="panel-subtitle">
                事实来源：所属试验
                {trial ? ` ${trial.code} ` : ""}
                的不可变放行快照；仅列出生成时涉及该材料或其台架的阻止项
              </span>
            </div>
            <ClipboardCheck
              size={18}
              className="panel-icon"
              aria-hidden="true"
            />
          </div>
          {dossier.snapshots.length === 0 ? (
            <div className="dossier-empty-line">
              <Eye size={16} aria-hidden="true" />
              <span>
                所属试验还没有生成过放行快照；可在
                <Link className="dossier-link" to="/clearance">
                  试验放行
                </Link>
                页查看实时约束。
              </span>
            </div>
          ) : (
            <ul className="dossier-clearance-list">
              {dossier.snapshots.map(({ snapshot, relatedBlockers, namesAccession }) => (
                <li
                  key={snapshot.id}
                  className="dossier-clearance-item"
                  data-testid={`dossier-snapshot-${snapshot.id}`}
                >
                  <div className="dossier-clearance-top">
                    <span className="dossier-clearance-date">
                      <CalendarDays size={14} aria-hidden="true" />
                      {formatDateTime(snapshot.generatedOn)}
                    </span>
                    {snapshot.status === "ready" ? (
                      <StatusBadge tone="positive">就绪</StatusBadge>
                    ) : (
                      <StatusBadge tone="critical">阻止</StatusBadge>
                    )}
                  </div>
                  <p className="muted-copy">
                    快照生成时共 {snapshot.blockers.length} 个阻止项，其中{" "}
                    <strong>{relatedBlockers.length}</strong>{" "}
                    个涉及该材料
                    {bench ? "或其所在台架" : ""}
                    {namesAccession ? "（含直接点名该材料的阻止项）" : ""}。
                  </p>
                  {relatedBlockers.length > 0 ? (
                    <ul className="blocker-list">
                      {relatedBlockers.map((blocker, index) => (
                        <li key={`${blocker.code}-${index}`}>
                          <code>{blocker.code}</code>
                          <span>{blocker.message}</span>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="clearance-ready">
                      该快照没有涉及此材料或其台架的阻止项。
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function NoticeList({ notices }: { notices: DossierNotice[] }) {
  if (notices.length === 0) {
    return (
      <section className="dossier-notice dossier-notice-ok" data-testid="dossier-no-notices">
        <CircleCheck size={18} aria-hidden="true" />
        <div>
          <strong>当前没有需要关注的异常</strong>
          <p>材料已分配、台架可用、观测与标记状态正常。以下各分区仍实时反映原始记录。</p>
        </div>
      </section>
    );
  }
  return (
    <section className="dossier-notice-region" data-testid="dossier-notices">
      {notices.map((notice) => (
        <article
          key={notice.code}
          className={`dossier-notice dossier-notice-${notice.tone}`}
          data-testid={`dossier-notice-${notice.code}`}
        >
          {notice.tone === "info" ? (
            <CircleCheck size={18} aria-hidden="true" />
          ) : (
            <CircleX size={18} aria-hidden="true" />
          )}
          <div>
            <strong>{notice.title}</strong>
            <p>
              <span className="dossier-fact-label">事实来源：</span>
              {notice.factSource}
            </p>
            <p>
              <span className="dossier-fact-label">当前影响：</span>
              {notice.impact}
            </p>
          </div>
        </article>
      ))}
    </section>
  );
}

function Fact({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="dossier-fact">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function FlagRow({ flag }: { flag: DomainFlag }) {
  return (
    <li className="dossier-flag-item" data-testid={`dossier-flag-${flag.id}`}>
      <div className="dossier-flag-top">
        <code>{flag.code}</code>
        <StatusBadge tone={statusTone(flag.severity)}>
          {severityLabels[flag.severity]}
        </StatusBadge>
        <StatusBadge tone={statusTone(flag.state)}>
          {flagStateLabels[flag.state]}
        </StatusBadge>
      </div>
      <p className="dossier-flag-message">{flag.message}</p>
      <p className="dossier-flag-meta">
        派生时间 {formatDateTime(flag.createdOn)}
        {flag.resolvedOn
          ? ` · 处理时间 ${formatDateTime(flag.resolvedOn)}`
          : " · 尚未处理"}
      </p>
      {flag.resolutionNote ? (
        <p className="dossier-flag-note">处理说明：{flag.resolutionNote}</p>
      ) : null}
    </li>
  );
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString();
}
