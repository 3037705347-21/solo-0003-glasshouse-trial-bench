import { useMemo, useState } from "react";
import {
  CheckCircle2,
  ClipboardCheck,
  RefreshCw,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { Button } from "../../components/Button";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import {
  DOMAIN_LABELS,
  DOMAIN_ORDER,
  type QualityDomain,
  type QualityFinding,
} from "../../domain/quality";
import { useWorkspace } from "../../state/store";
import { FindingCard } from "./FindingCard";
import { QuarantinePanel } from "./QuarantinePanel";
import { RepairDialog } from "./RepairDialog";
import { RepairRecoveryBanner } from "./RepairRecoveryBanner";
import { useQualityCenter } from "./useQualityCenter";

type DomainFilter = "all" | QualityDomain;

const SEVERITY_GROUPS: Array<{
  key: "blocking" | "warning" | "info";
  title: string;
  description: string;
}> = [
  {
    key: "blocking",
    title: "阻断问题",
    description:
      "引用断裂或核心不变量被破坏，继续登记、分配、观测或放行会让错误扩散。",
  },
  {
    key: "warning",
    title: "需要关注",
    description: "完整性风险或跨状态矛盾，多数需要人工判断。",
  },
  {
    key: "info",
    title: "追溯提示",
    description: "历史记录与当前对象的偏差，不影响继续工作。",
  },
];

export function QualityPage() {
  const {
    report,
    rescan,
    selected,
    toggleSelected,
    selectAllFixable,
    clearSelection,
    fixableById,
    dryRun,
    setDryRun,
    preview,
    applyConfirmed,
    activeRepair,
    resumeRepair,
    rollbackRepair,
    abandonRepair,
    recoveryNotice,
  } = useQualityCenter();
  const { quarantineEntries, discardQuarantineEntry, repairArchive } =
    useWorkspace();
  const [domainFilter, setDomainFilter] = useState<DomainFilter>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 5000);
  };

  const visibleFindings = useMemo(() => {
    if (domainFilter === "all") {
      return report.findings;
    }
    return report.byDomain[domainFilter] ?? [];
  }, [report, domainFilter]);

  const visibleFixable = useMemo(
    () =>
      visibleFindings.filter(
        (finding) => fixableById.has(finding.id) && finding.severity !== "info",
      ),
    [visibleFindings, fixableById],
  );

  const grouped = useMemo(() => {
    const map: Record<"blocking" | "warning" | "info", QualityFinding[]> = {
      blocking: [],
      warning: [],
      info: [],
    };
    visibleFindings.forEach((finding) => map[finding.severity].push(finding));
    return map;
  }, [visibleFindings]);

  const handleRescan = () => {
    const next = rescan();
    pushToast({
      tone: "info",
      title: "检查完成",
      message:
        next.healthy
          ? "未发现数据质量问题。"
          : `发现 ${next.counts.blocking} 个阻断、${next.counts.warning} 个警告、${next.counts.info} 个提示。`,
    });
  };

  const handlePreview = () => {
    const result = preview();
    if (!result) {
      pushToast({
        tone: "warning",
        title: "请先勾选修复项",
        message: "在带“可安全自动修复”标记的问题卡片上勾选后再预演。",
      });
      return;
    }
    setDialogOpen(true);
  };

  const handleConfirm = () => {
    if (!dryRun) {
      return;
    }
    const result = applyConfirmed(dryRun);
    setDialogOpen(false);
    if (!result.ok) {
      setDryRun(null);
      pushToast({
        tone: "error",
        title: "整批修复未执行",
        message: result.reason,
      });
      return;
    }
    clearSelection();
    pushToast({
      tone: "success",
      title: "整批修复已完成并持久化",
      message:
        "修复逐项写入工作区与会话；即使现在关闭页面，审计与恢复状态也已落盘，历史记录完整保留。",
    });
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="数据质量中心"
        title="跨对象与跨版本完整性检查"
        description="在启动时自动运行，也可以随时手动复查。问题按阻断程度分组，展示涉及对象、规则与证据；可安全修复的问题支持逐项确认，无法自动判断的问题只提供人工处理入口。"
        actions={
          <Button onClick={handleRescan} data-testid="rescan-quality">
            <RefreshCw size={16} />
            立即重新检查
          </Button>
        }
      />

      {activeRepair ? (
        <RepairRecoveryBanner
          journal={activeRepair}
          onResume={() => {
            resumeRepair();
            if (activeRepair.status === "conflicted") {
              pushToast({
                tone: "error",
                title: "修复会话与当前数据冲突",
                message:
                  activeRepair.conflictReason ??
                  "工作区相对修复前快照发生变化，自动流程已停止；可整批回滚或放弃后重新扫描。",
              });
              return;
            }
            pushToast({
              tone: "success",
              title: "未完成修复已继续",
              message: "系统按实际进度对账后续跑，已生效的修复没有重复执行。",
            });
          }}
          onRollback={() => {
            rollbackRepair();
            pushToast({
              tone: "warning",
              title: "已整批回滚",
              message: "工作区恢复到修复会话开始前的状态，审计日志已保留。",
            });
          }}
          onAbandon={() => {
            abandonRepair();
            pushToast({
              tone: "info",
              title: "修复会话已关闭",
              message: "当前数据保持不变，会话记录保留在修复历史中。",
            });
          }}
        />
      ) : recoveryNotice ? (
        <section
          className={`recovery-banner ${recoveryNotice.tone === "warning" ? "" : "recovery-banner-success"}`}
          data-testid="recovery-notice"
        >
          <div className="recovery-banner-copy">
            <strong>{recoveryNotice.title}</strong>
            <p>{recoveryNotice.message}</p>
          </div>
        </section>
      ) : null}

      <QuarantinePanel
        entries={quarantineEntries}
        onDiscard={(id) => {
          discardQuarantineEntry(id);
          pushToast({
            tone: "info",
            title: "隔离记录已清除",
            message: "仅在你显式确认后清除，系统不会自动删除隔离数据。",
          });
        }}
      />

      <section className="quality-stat-strip" data-testid="quality-stat-strip">
        <div
          className={`quality-stat quality-stat-blocking${
            report.counts.blocking === 0 ? " quality-stat-zero" : ""
          }`}
        >
          <strong>{report.counts.blocking}</strong>
          <span>阻断</span>
        </div>
        <div
          className={`quality-stat quality-stat-warning${
            report.counts.warning === 0 ? " quality-stat-zero" : ""
          }`}
        >
          <strong>{report.counts.warning}</strong>
          <span>警告</span>
        </div>
        <div
          className={`quality-stat quality-stat-info${
            report.counts.info === 0 ? " quality-stat-zero" : ""
          }`}
        >
          <strong>{report.counts.info}</strong>
          <span>提示</span>
        </div>
        <div className="quality-stat quality-stat-checked">
          <span className="quality-stat-meta">
            上次检查：{new Date(report.scannedAt).toLocaleString()}
          </span>
          <span className="quality-stat-meta">
            {DOMAIN_ORDER.map(
              (domain) =>
                `${DOMAIN_LABELS[domain]} ${(report.byDomain[domain] ?? []).length}`,
            ).join("　·　")}
          </span>
        </div>
      </section>

      <section className="control-strip">
        <SegmentedTabs
          label="按领域过滤问题"
          options={[
            { value: "all", label: `全部（${report.findings.length}）` },
            ...DOMAIN_ORDER.map((domain) => ({
              value: domain,
              label: `${DOMAIN_LABELS[domain]}（${(report.byDomain[domain] ?? []).length}）`,
            })),
          ]}
          value={domainFilter}
          onChange={(value) => setDomainFilter(value as DomainFilter)}
        />
        <div className="quality-batch-actions">
          <span className="muted-copy">
            已选 {selected.size} 项可自动修复
          </span>
          <Button
            size="sm"
            tone="secondary"
            onClick={() => selectAllFixable(visibleFixable)}
            disabled={visibleFixable.length === 0}
            data-testid="select-all-fixable"
          >
            全选当前可修复项
          </Button>
          <Button
            size="sm"
            tone="ghost"
            onClick={clearSelection}
            disabled={selected.size === 0}
          >
            清除选择
          </Button>
          <Button
            size="sm"
            onClick={handlePreview}
            disabled={selected.size === 0}
            data-testid="open-repair-preview"
          >
            <Wrench size={15} />
            整批预演
          </Button>
        </div>
      </section>

      {report.healthy && quarantineEntries.length === 0 ? (
        <EmptyState
          icon={ShieldCheck}
          title="工作区通过全部完整性检查"
          description="六大领域的跨对象引用、跨状态一致性与持久化版本均未发现问题。"
        />
      ) : (
        SEVERITY_GROUPS.map((group) => {
          const findings = grouped[group.key];
          if (findings.length === 0) {
            return null;
          }
          return (
            <section
              className={`quality-group quality-group-${group.key}`}
              key={group.key}
              data-testid={`group-${group.key}`}
            >
              <div className="quality-group-head">
                <div>
                  <h2>
                    {group.title}（{findings.length}）
                  </h2>
                  <p>{group.description}</p>
                </div>
              </div>
              <div className="quality-finding-list">
                {findings.map((finding) => (
                  <FindingCard
                    key={finding.id}
                    finding={finding}
                    selectable={fixableById.has(finding.id)}
                    selected={selected.has(finding.id)}
                    onToggle={toggleSelected}
                  />
                ))}
              </div>
            </section>
          );
        })
      )}

      {report.healthy && quarantineEntries.length === 0 ? (
        <section className="content-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-title">
                <CheckCircle2 size={16} className="panel-icon" /> 修复历史
              </span>
              <span className="panel-subtitle">所有整批修复、回滚与放弃的审计记录都会保留</span>
            </div>
          </div>
          <RepairHistory />
        </section>
      ) : (
        <section className="content-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-title">
                <ClipboardCheck size={16} className="panel-icon" /> 修复历史
              </span>
              <span className="panel-subtitle">
                {repairArchive.history.length === 0
                  ? "尚无修复会话"
                  : `最近 ${repairArchive.history.length} 次修复会话`}
              </span>
            </div>
          </div>
          <RepairHistory />
        </section>
      )}

      <RepairDialog
        open={dialogOpen}
        dryRun={dryRun}
        onClose={() => setDialogOpen(false)}
        onConfirm={handleConfirm}
      />

      <ToastRegion
        messages={toasts}
        onDismiss={(id) =>
          setToasts((current) => current.filter((item) => item.id !== id))
        }
      />
    </div>
  );
}

function RepairHistory() {
  const { repairArchive } = useWorkspace();
  if (repairArchive.history.length === 0) {
    return <p className="muted-copy" style={{ padding: "16px 18px" }}>暂无修复记录。</p>;
  }
  return (
    <ul className="repair-history-list">
      {repairArchive.history.map((journal) => {
        const applied = journal.items.filter((item) => item.status === "applied").length;
        const conflict = journal.items.filter((item) => item.status === "conflict").length;
        const skipped = journal.items.filter(
          (item) => item.status === "already-fixed",
        ).length;
        const outcomeLabels: Record<string, string> = {
          applied: "已应用",
          "rolled-back": "已回滚",
          abandoned: "已放弃",
        };
        return (
          <li key={journal.id} data-testid={`repair-history-${journal.id}`}>
            <div>
              <strong>
                {new Date(journal.startedAt).toLocaleString()}
                {journal.outcome ? ` · ${outcomeLabels[journal.outcome] ?? "已完成"}` : ""}
              </strong>
              <span>
                共 {journal.items.length} 项：执行 {applied}、跳过 {skipped}
                {conflict > 0 ? `、冲突 ${conflict}` : ""}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
