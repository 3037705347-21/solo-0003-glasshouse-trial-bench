import { useMemo, useState } from "react";
import { ClipboardList, Plus, Wrench } from "lucide-react";
import { Button } from "../../components/Button";
import { DataTable, type DataColumn } from "../../components/DataTable";
import { Dialog } from "../../components/Dialog";
import { PageHeader } from "../../components/PageHeader";
import { SearchInput } from "../../components/SearchInput";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import type { Bench, BenchOperationalStatus } from "../../domain/types";
import {
  benchMatchesQuery,
  benchOccupancy,
  benchOperationalStatus,
  benchStatusNote,
} from "../../domain/bench";
import { useWorkspace } from "../../state/store";
import { BenchForm, LIGHT_LABEL, OPERATIONAL_STATUS_LABEL } from "./BenchForm";
import { BenchStatusDialog } from "./BenchStatusDialog";

type BenchSegment = "all" | "available" | "blocked" | "quarantine";

const SEGMENT_OPTIONS: Array<{ value: BenchSegment; label: string }> = [
  { value: "all", label: "全部" },
  { value: "available", label: "可用" },
  { value: "blocked", label: "受限" },
  { value: "quarantine", label: "隔离" },
];

export function BenchesPage() {
  const { state } = useWorkspace();
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState<BenchSegment>("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingBench, setEditingBench] = useState<Bench | undefined>();
  const [statusTarget, setStatusTarget] = useState<
    { bench: Bench; target: BenchOperationalStatus } | undefined
  >();
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  };

  const nextBenchCode = useMemo(() => {
    const largest = state.benches.reduce((max, bench) => {
      const match = /^([A-Z]+)-(\d+)$/.exec(bench.code.trim().toUpperCase());
      return match ? Math.max(max, Number(match[2])) : max;
    }, 0);
    return `B-${String(largest + 1).padStart(2, "0")}`;
  }, [state.benches]);

  const filtered = useMemo(
    () =>
      [...state.benches]
        .sort((left, right) => left.code.localeCompare(right.code))
        .filter((bench) => benchMatchesQuery(bench, query))
        .filter((bench) => {
          if (segment === "all") {
            return true;
          }
          if (benchOperationalStatus(bench) !== segment) {
            return false;
          }
          // “可用”视图只展示空置台架；已占用但运维可用的台架在“全部”中查看。
          return segment !== "available" || bench.assignedIds.length === 0;
        }),
    [state.benches, query, segment],
  );

  const openCreate = () => {
    setEditingBench(undefined);
    setEditorOpen(true);
  };

  const openEdit = (bench: Bench) => {
    setEditingBench(bench);
    setEditorOpen(true);
  };

  const columns: Array<DataColumn<Bench>> = [
    {
      key: "code",
      header: "台架编号",
      render: (bench) => <span className="table-primary">{bench.code}</span>,
    },
    { key: "sector", header: "区域", render: (bench) => bench.sector },
    {
      key: "capacity",
      header: "占用 / 容量",
      render: (bench) => {
        const occupancy = benchOccupancy(bench);
        return (
          <span className={occupancy > bench.capacity ? "bench-overflow" : ""}>
            {occupancy} / {bench.capacity}
          </span>
        );
      },
    },
    {
      key: "light",
      header: "光照",
      render: (bench) => LIGHT_LABEL[bench.lightProfile],
    },
    { key: "irrigation", header: "灌溉管路", render: (bench) => bench.irrigationLine },
    {
      key: "status",
      header: "运行状态",
      render: (bench) => {
        const operational = benchOperationalStatus(bench);
        const label =
          operational === "available"
            ? bench.assignedIds.length > 0
              ? "已占用"
              : "可用"
            : OPERATIONAL_STATUS_LABEL[operational];
        return (
          <StatusBadge tone={statusTone(label)}>
            {label}
          </StatusBadge>
        );
      },
    },
    {
      key: "note",
      header: "原因 / 备注",
      render: (bench) => (
        <span className="bench-note-cell">
          {benchStatusNote(bench) || "—"}
        </span>
      ),
    },
    {
      key: "actions",
      header: "",
      render: (bench) => {
        const operational = benchOperationalStatus(bench);
        return (
          <div className="bench-row-actions">
            <Button
              tone="ghost"
              size="sm"
              onClick={() => openEdit(bench)}
              data-testid={`edit-bench-${bench.id}`}
            >
              <Wrench size={14} />
              编辑
            </Button>
            {operational !== "blocked" ? (
              <Button
                tone="ghost"
                size="sm"
                onClick={() => setStatusTarget({ bench, target: "blocked" })}
                data-testid={`block-bench-${bench.id}`}
              >
                受限
              </Button>
            ) : null}
            {operational !== "quarantine" ? (
              <Button
                tone="ghost"
                size="sm"
                onClick={() => setStatusTarget({ bench, target: "quarantine" })}
                data-testid={`quarantine-bench-${bench.id}`}
              >
                隔离
              </Button>
            ) : null}
            {operational !== "available" ? (
              <Button
                tone="ghost"
                size="sm"
                onClick={() => setStatusTarget({ bench, target: "available" })}
                data-testid={`restore-bench-${bench.id}`}
              >
                恢复
              </Button>
            ) : null}
          </div>
        );
      },
    },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="现场台账"
        title="台架台账与维护"
        description="创建台架并维护编号、区域、容量、光照、灌溉管路和运行状态；受限与隔离必须记录原因，恢复前会重新校验现场适配。"
        actions={
          <Button onClick={openCreate} data-testid="open-create-bench">
            <Plus size={16} />
            新建台架
          </Button>
        }
      />
      <section className="control-strip">
        <SearchInput
          placeholder="搜索台架编号、区域、管路、原因"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          data-testid="bench-search"
        />
        <SegmentedTabs
          label="按运行状态筛选"
          value={segment}
          options={SEGMENT_OPTIONS}
          onChange={setSegment}
        />
      </section>
      <section className="content-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-title">台架清单</span>
            <span className="panel-subtitle">
              共 {state.benches.length} 个台架，当前显示 {filtered.length} 个
            </span>
          </div>
          <ClipboardList size={20} className="panel-icon" aria-hidden="true" />
        </div>
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(bench) => bench.id}
          emptyMessage="当前视图下没有匹配台架。"
        />
      </section>
      <Dialog
        open={editorOpen}
        title={editingBench ? `编辑台架 ${editingBench.code}` : "新建台架"}
        onClose={() => setEditorOpen(false)}
      >
        <BenchForm
          bench={editingBench}
          defaultCode={nextBenchCode}
          onCancel={() => setEditorOpen(false)}
          onSaved={() => {
            setEditorOpen(false);
            pushToast({
              tone: "success",
              title: editingBench ? "台架已更新" : "台架已创建",
              message: editingBench
                ? `${editingBench.code} 的台账信息已保存。`
                : "新台架已进入布局与放行检查。",
            });
          }}
        />
      </Dialog>
      <Dialog
        open={Boolean(statusTarget)}
        title={
          statusTarget
            ? `切换 ${statusTarget.bench.code} 的运行状态`
            : "切换运行状态"
        }
        onClose={() => setStatusTarget(undefined)}
      >
        {statusTarget ? (
          <BenchStatusDialog
            bench={statusTarget.bench}
            target={statusTarget.target}
            onCancel={() => setStatusTarget(undefined)}
            onSaved={() => {
              const { bench, target } = statusTarget;
              setStatusTarget(undefined);
              pushToast({
                tone: target === "available" ? "success" : "warning",
                title: `台架已${target === "available" ? "恢复" : target === "blocked" ? "受限" : "隔离"}`,
                message: `${bench.code} 的状态变更已记录，并同步到布局与放行页面。`,
              });
            }}
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
