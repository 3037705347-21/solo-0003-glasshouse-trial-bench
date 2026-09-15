import { useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ClipboardList,
  Download,
  History,
  RotateCcw,
  Upload,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { SearchInput } from "../../components/SearchInput";
import { StatusBadge } from "../../components/StatusBadge";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import {
  objectTypeLabel,
  type AuditEntry,
  type AuditItem,
  type AuditObjectType,
  type AuditOpType,
} from "../../domain/audit";
import type { WorkspaceState } from "../../domain/types";
import { isWorkspaceState } from "../../state/types";
import { useWorkspace } from "../../state/store";
import { resolveAuditTarget } from "./targets";

const opLabels: Record<AuditOpType, string> = {
  "trial.created": "创建试验",
  "trial.transitioned": "试验状态变更",
  "accession.created": "新建材料",
  "accession.updated": "更新材料",
  "bench.assigned": "台架分配",
  "bench.released": "移出台架",
  "bench.batch-released": "批量移出",
  "observation.recorded": "记录观测",
  "flag.transitioned": "标记处理",
  "clearance.generated": "生成放行快照",
  "workspace.replaced": "重置 / 导入恢复",
};

const kindLabels: Record<AuditItem["kind"], string> = {
  created: "新建",
  updated: "更新",
  removed: "移除",
};

const kindTone: Record<
  AuditItem["kind"],
  "positive" | "warning" | "critical"
> = {
  created: "positive",
  updated: "warning",
  removed: "critical",
};

const BATCH_THRESHOLD = 1;

const typeFilters: Array<{ value: AuditObjectType | "all"; label: string }> = [
  { value: "all", label: "全部对象" },
  { value: "trial", label: "试验" },
  { value: "accession", label: "材料" },
  { value: "bench", label: "台架" },
  { value: "observation", label: "观测" },
  { value: "flag", label: "标记" },
  { value: "snapshot", label: "快照" },
  { value: "workspace", label: "工作区" },
];

function formatTime(at: string): string {
  const date = new Date(at);
  return Number.isNaN(date.getTime()) ? at : date.toLocaleString();
}

function AuditItemRow({
  item,
  state,
}: {
  item: AuditItem;
  state: WorkspaceState;
}) {
  const target = resolveAuditTarget(state, item);
  return (
    <li className="audit-item" data-testid={`audit-item-${item.objectId}`}>
      <div className="audit-item-head">
        <StatusBadge tone="neutral">{objectTypeLabel[item.objectType]}</StatusBadge>
        <StatusBadge tone={kindTone[item.kind]}>
          {kindLabels[item.kind]}
        </StatusBadge>
        <strong className="audit-item-label">{item.objectLabel}</strong>
        {target?.exists ? (
          <Link
            className="audit-item-link"
            to={target.path}
            data-testid={`audit-item-link-${item.objectId}`}
          >
            跳回对象
            <ArrowRight size={13} aria-hidden="true" />
          </Link>
        ) : (
          <span
            className="audit-item-missing"
            data-testid={`audit-item-missing-${item.objectId}`}
            title="该对象已被后续操作移除，历史摘要仍保留"
          >
            对象已不存在
          </span>
        )}
      </div>
      {item.changes.length > 0 ? (
        <dl className="audit-changes">
          {item.changes.map((changeItem) => (
            <div className="audit-change" key={changeItem.field}>
              <dt>{changeItem.label}</dt>
              <dd>
                {changeItem.before !== undefined ? (
                  <span className="audit-before">{changeItem.before}</span>
                ) : (
                  <span className="audit-before audit-before-empty">—</span>
                )}
                <ArrowRight size={12} aria-hidden="true" />
                <span className="audit-after">{changeItem.after}</span>
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {item.resultLabel ? (
        <p className="audit-item-result">{item.resultLabel}</p>
      ) : null}
    </li>
  );
}

function AuditEntryCard({
  entry,
  state,
}: {
  entry: AuditEntry;
  state: WorkspaceState;
}) {
  const isBatch = entry.items.length > BATCH_THRESHOLD;
  const [expanded, setExpanded] = useState(!isBatch);
  const visibleItems = expanded ? entry.items : entry.items.slice(0, 1);

  return (
    <article className="audit-card" data-testid={`audit-entry-${entry.id}`}>
      <header className="audit-card-head">
        <div className="audit-card-title">
          <span className="audit-seq">#{entry.seq}</span>
          <StatusBadge tone={isBatch ? "info" : "neutral"}>
            {isBatch ? `整体操作 · ${entry.items.length} 个对象` : opLabels[entry.op]}
          </StatusBadge>
          <strong>{entry.summary}</strong>
        </div>
        <time className="audit-time" dateTime={entry.at}>
          {formatTime(entry.at)}
        </time>
      </header>
      {entry.outcomeLabel ? (
        <p className="audit-outcome" data-testid={`audit-outcome-${entry.id}`}>
          {entry.outcomeLabel}
        </p>
      ) : null}
      <ul className="audit-items">
        {visibleItems.map((item) => (
          <AuditItemRow
            key={`${item.objectType}-${item.objectId}`}
            item={item}
            state={state}
          />
        ))}
      </ul>
      {isBatch ? (
        <Button
          tone="ghost"
          size="sm"
          className="audit-expand"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          data-testid={`audit-expand-${entry.id}`}
        >
          {expanded
            ? "收起对象明细"
            : `展开全部 ${entry.items.length} 个对象（另有 ${entry.items.length - visibleItems.length} 个）`}
        </Button>
      ) : null}
    </article>
  );
}

export function AuditPage() {
  const { state, audit, resetWorkspace, importWorkspace } = useWorkspace();
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<AuditObjectType | "all">("all");
  const [batchOnly, setBatchOnly] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  };

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    return [...audit]
      .sort((left, right) => right.seq - left.seq)
      .filter((entry) => {
        if (batchOnly && entry.items.length <= BATCH_THRESHOLD) {
          return false;
        }
        if (typeFilter !== "all") {
          if (typeFilter === "workspace") {
            if (entry.op !== "workspace.replaced") {
              return false;
            }
          } else if (
            !entry.items.some((item) => item.objectType === typeFilter)
          ) {
            return false;
          }
        }
        if (!keyword) {
          return true;
        }
        const haystack = [
          entry.summary,
          entry.outcomeLabel ?? "",
          opLabels[entry.op],
          ...entry.items.map(
            (item) =>
              `${item.objectLabel} ${item.resultLabel ?? ""} ${item.changes
                .map((changeItem) => `${changeItem.label} ${changeItem.before ?? ""} ${changeItem.after ?? ""}`)
                .join(" ")}`,
          ),
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(keyword);
      });
  }, [audit, query, typeFilter, batchOnly]);

  const handleExport = () => {
    const payload = {
      version: 1 as const,
      exportedAt: new Date().toISOString(),
      state,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `glasshouse-workspace-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    pushToast({ tone: "success", title: "已导出备份", message: "审计历史不会包含在备份文件中。" });
  };

  const handleImportFile = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) {
      return;
    }
    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as
        | WorkspaceState
        | { state: WorkspaceState };
      const candidate =
        "state" in parsed && isWorkspaceState((parsed as { state: unknown }).state)
          ? (parsed as { state: WorkspaceState }).state
          : parsed;
      if (!isWorkspaceState(candidate)) {
        pushToast({
          tone: "error",
          title: "导入被拒绝",
          message: "文件不是有效的工作区备份，工作区未发生变化。",
        });
        return;
      }
      importWorkspace(candidate, file.name);
      pushToast({
        tone: "success",
        title: "工作区已恢复",
        message: `已从 ${file.name} 恢复，差异已作为一条整体操作记入审计日志。`,
      });
    } catch {
      pushToast({
        tone: "error",
        title: "导入失败",
        message: "无法解析该文件，请确认导出的是 JSON 备份。",
      });
    }
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="工作区审计"
        title="审计日志"
        description="只追加的关键变更记录：操作时间、对象、变化前后摘要与结果。刷新或后续操作都不会重写历史。"
        actions={
          <div className="audit-actions">
            <Button
              tone="secondary"
              onClick={handleExport}
              data-testid="export-workspace-button"
            >
              <Download size={15} />
              导出备份
            </Button>
            <Button
              tone="secondary"
              onClick={() => fileInputRef.current?.click()}
              data-testid="import-workspace-button"
            >
              <Upload size={15} />
              导入恢复
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              hidden
              onChange={handleImportFile}
              data-testid="import-workspace-input"
            />
            <Button
              tone="danger"
              onClick={() => setConfirmReset(true)}
              data-testid="reset-workspace-button"
            >
              <RotateCcw size={15} />
              重置示例
            </Button>
          </div>
        }
      />
      <section className="control-strip">
        <SearchInput
          placeholder="搜索操作、对象、变化值"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          data-testid="audit-search"
        />
        <select
          className="compact-select"
          value={typeFilter}
          onChange={(event) =>
            setTypeFilter(event.target.value as AuditObjectType | "all")
          }
          aria-label="按对象类型筛选"
          data-testid="audit-type-filter"
        >
          {typeFilters.map((option) => (
            <option value={option.value} key={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <label className="audit-batch-toggle">
          <input
            type="checkbox"
            checked={batchOnly}
            onChange={(event) => setBatchOnly(event.target.checked)}
            data-testid="audit-batch-only"
          />
          仅看批量 / 重置 / 导入
        </label>
      </section>
      {filtered.length === 0 ? (
        <section className="content-panel">
          <EmptyState
            icon={audit.length === 0 ? History : ClipboardList}
            title={audit.length === 0 ? "还没有审计记录" : "没有匹配的操作"}
            description={
              audit.length === 0
                ? "在其他页面执行的创建、编辑、分配、观测和放行操作都会只追加地记录在这里。"
                : "尝试调整搜索关键字或对象类型筛选。"
            }
          />
        </section>
      ) : (
        <div className="audit-list" data-testid="audit-list">
          {filtered.map((entry) => (
            <AuditEntryCard key={entry.id} entry={entry} state={state} />
          ))}
        </div>
      )}
      <Dialog
        open={confirmReset}
        title="重置为示例工作区？"
        onClose={() => setConfirmReset(false)}
        footer={
          <>
            <Button tone="secondary" onClick={() => setConfirmReset(false)}>
              取消
            </Button>
            <Button
              tone="danger"
              onClick={() => {
                resetWorkspace();
                setConfirmReset(false);
                pushToast({
                  tone: "warning",
                  title: "工作区已重置",
                  message: "示例数据已恢复；审计历史保留并追加了一条重置记录。",
                });
              }}
              data-testid="confirm-reset-button"
            >
              确认重置
            </Button>
          </>
        }
      >
        <p>
          当前材料、台架、观测、标记和快照会被示例数据替换。审计日志不会被清空，
          本次重置会作为一条包含全部对象差异的整体操作追加到日志末尾。
        </p>
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
