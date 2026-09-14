import {
  CalendarDays,
  CircleCheck,
  Download,
  Fingerprint,
  Link2,
  ListChecks,
} from "lucide-react";
import { Button } from "../../components/Button";
import { MetricCard } from "../../components/MetricCard";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import { PACKAGE_CHECK_CATEGORY_LABELS } from "../../domain/compliance";
import type {
  CompliancePackage,
  PackageCheckCategory,
} from "../../domain/types";

interface PackageDetailProps {
  pkg: CompliancePackage;
  onExport: (pkg: CompliancePackage) => void;
}

const categoryOrder: PackageCheckCategory[] = [
  "missing-page",
  "broken-ref",
  "duplicate",
  "open-blocker",
];

function formatDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function PackageDetail({ pkg, onExport }: PackageDetailProps) {
  const findingsByCategory = categoryOrder
    .map((category) => ({
      category,
      findings: pkg.checks.filter((check) => check.category === category),
    }))
    .filter((group) => group.findings.length > 0);

  return (
    <div className="package-detail" data-testid="package-detail">
      <section className="content-panel">
        <div className="package-detail-header">
          <div>
            <span className="panel-title">
              {pkg.trialCode} · 第 {pkg.version} 版
            </span>
            <span className="panel-subtitle">
              <CalendarDays size={13} aria-hidden="true" />{" "}
              {formatDateTime(pkg.generatedOn)} 生成，内容已冻结
            </span>
          </div>
          <StatusBadge
            tone={pkg.status === "complete" ? "positive" : "warning"}
          >
            {pkg.status === "complete" ? "完整" : "含排除项"}
          </StatusBadge>
        </div>
        <div className="metric-grid">
          {pkg.inventory.map((entry) => (
            <MetricCard
              key={entry.key}
              label={entry.label}
              value={entry.count}
              detail={entry.detail}
              accent={
                entry.key === "openFlags" && entry.count > 0
                  ? "critical"
                  : entry.count > 0
                    ? "positive"
                    : "neutral"
              }
            />
          ))}
        </div>
        <div className="package-digest-row">
          <Fingerprint size={15} aria-hidden="true" />
          <span>
            版本摘要 <code data-testid="package-digest">{pkg.digest}</code>
            ，导出文件 <code>{pkg.exportFileName}</code>
          </span>
          <Button
            size="sm"
            tone="secondary"
            onClick={() => onExport(pkg)}
            data-testid="export-package"
          >
            <Download size={14} />
            导出文件
          </Button>
        </div>
      </section>

      <section className="content-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-title">导出前检查</span>
            <span className="panel-subtitle">
              缺页、断裂引用、重复对象和未处理阻止项
            </span>
          </div>
          <ListChecks size={20} className="panel-icon" aria-hidden="true" />
        </div>
        <div className="package-section-body">
          {findingsByCategory.length === 0 ? (
            <p className="clearance-ready">
              未发现缺页、断裂引用、重复对象或未处理阻止项。
            </p>
          ) : (
            findingsByCategory.map((group) => (
              <div className="package-check-group" key={group.category}>
                <h3>
                  {PACKAGE_CHECK_CATEGORY_LABELS[group.category]}（
                  {group.findings.length}）
                </h3>
                <ul className="blocker-list">
                  {group.findings.map((finding, index) => (
                    <li key={`${finding.code}-${index}`}>
                      <code>{finding.code}</code>
                      <span>{finding.message}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))
          )}
        </div>
      </section>

      <section className="content-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-title">包含与排除说明</span>
            <span className="panel-subtitle">
              明确哪些结果纳入本包、哪些被排除
            </span>
          </div>
          <CircleCheck size={20} className="panel-icon" aria-hidden="true" />
        </div>
        <div className="package-scope-columns">
          <div className="package-scope-list">
            <h3>已纳入</h3>
            {pkg.included.length === 0 ? (
              <p className="muted-copy">没有可纳入的结果。</p>
            ) : (
              <ul>
                {pkg.included.map((note) => (
                  <li key={note.label}>
                    <strong>{note.label}</strong>
                    <span>{note.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="package-scope-list package-scope-excluded">
            <h3>已排除</h3>
            {pkg.excluded.length === 0 ? (
              <p className="muted-copy">没有被排除的结果。</p>
            ) : (
              <ul>
                {pkg.excluded.map((note) => (
                  <li key={note.label}>
                    <strong>{note.label}</strong>
                    <span>{note.detail}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </section>

      <section className="content-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-title">对象引用</span>
            <span className="panel-subtitle">
              生成时点冻结的记录副本，后续修改不影响本包
            </span>
          </div>
          <Link2 size={20} className="panel-icon" aria-hidden="true" />
        </div>
        <div className="package-section-body">
          <div className="package-ref-group">
            <h3>材料与台架位置（{pkg.accessions.length}）</h3>
            {pkg.accessions.length === 0 ? (
              <p className="muted-copy">该试验在生成时点没有材料记录。</p>
            ) : (
              <div className="data-table-wrap">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>材料编号</th>
                      <th>品种</th>
                      <th>数量</th>
                      <th>台架位置</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pkg.accessions.map((accession) => (
                      <tr key={accession.id}>
                        <td>
                          <span className="table-primary">
                            {accession.accessionNo}
                          </span>
                        </td>
                        <td>{accession.cultivar}</td>
                        <td>{accession.quantity}</td>
                        <td>
                          {accession.benchCode
                            ? `${accession.benchCode}（${accession.benchSector}）`
                            : "未分配"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="package-ref-group">
            <h3>观测记录（{pkg.observations.length}）</h3>
            {pkg.observations.length === 0 ? (
              <p className="muted-copy">该试验在生成时点没有观测记录。</p>
            ) : (
              <ul className="package-ref-list">
                {pkg.observations.map((pass) => (
                  <li key={pass.id}>
                    <strong>{pass.observedOn}</strong>
                    <span>
                      {pass.observer} · {pass.entries.length} 条测量 ·{" "}
                      <code>{pass.id}</code>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="package-ref-group">
            <h3>标记处理结果（{pkg.flags.length}）</h3>
            {pkg.flags.length === 0 ? (
              <p className="muted-copy">该试验在生成时点没有标记。</p>
            ) : (
              <ul className="package-ref-list">
                {pkg.flags.map((flag) => (
                  <li key={flag.id}>
                    <strong>
                      {flag.accessionNo} · {flag.code}
                    </strong>
                    <span>
                      <StatusBadge
                        tone={statusTone(
                          flag.state === "open"
                            ? "未处理"
                            : flag.state === "resolved"
                              ? "已解决"
                              : "已豁免",
                        )}
                      >
                        {flag.state === "open"
                          ? "未处理"
                          : flag.state === "resolved"
                            ? "已解决"
                            : "已豁免"}
                      </StatusBadge>{" "}
                      {flag.resolutionNote ?? flag.message}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="package-ref-group">
            <h3>放行快照</h3>
            {pkg.clearance ? (
              <ul className="package-ref-list">
                <li>
                  <strong>
                    <code>{pkg.clearance.snapshotId}</code>
                  </strong>
                  <span>
                    <StatusBadge tone={statusTone(pkg.clearance.status)}>
                      {pkg.clearance.status === "ready" ? "就绪" : "阻止"}
                    </StatusBadge>{" "}
                    {formatDateTime(pkg.clearance.generatedOn)} ·{" "}
                    {pkg.clearance.blockers.length} 个阻止项
                  </span>
                </li>
              </ul>
            ) : (
              <p className="muted-copy">生成时点尚未保存放行快照。</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
