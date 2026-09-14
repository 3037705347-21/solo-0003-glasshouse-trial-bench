import { useMemo, useState } from "react";
import { FileText, Plus, Sprout } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "../../components/Button";
import { DataTable, type DataColumn } from "../../components/DataTable";
import { Dialog } from "../../components/Dialog";
import { PageHeader } from "../../components/PageHeader";
import { SearchInput } from "../../components/SearchInput";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import {
  accessionMatchesQuery,
  nextAccessionNumber,
} from "../../domain/accession";
import type { Accession } from "../../domain/types";
import {
  accessionById,
  accessionsForTrial,
  accessionStatus,
  benchForAccession,
} from "../../state/selectors";
import { useWorkspace } from "../../state/store";
import { RosterForm } from "./RosterForm";

type RosterSegment = "all" | "assigned" | "unassigned";

export function RosterPage() {
  const { state } = useWorkspace();
  const [trialFilter, setTrialFilter] = useState(() => state.trials[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState<RosterSegment>("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingAccession, setEditingAccession] = useState<Accession | undefined>();
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  };

  const filtered = useMemo(() => {
    return state.accessions
      .filter((accession) =>
        accessionMatchesQuery(accession, query, trialFilter),
      )
      .filter((accession) => {
        const status = accessionStatus(state, accession);
        if (segment === "assigned") {
          return status === "assigned";
        }
        if (segment === "unassigned") {
          return status === "unassigned";
        }
        return true;
      });
  }, [state, query, trialFilter, segment]);

  const columns: Array<DataColumn<Accession>> = [
    {
      key: "accessionNo",
      header: "材料编号",
      render: (accession) => (
        <Link
          to={`/accessions/${accession.id}`}
          className="table-primary table-link"
          data-testid={`accession-dossier-link-${accession.id}`}
        >
          {accession.accessionNo}
        </Link>
      ),
    },
    {
      key: "cultivar",
      header: "品种",
      render: (accession) => accession.cultivar,
    },
    {
      key: "source",
      header: "来源",
      render: (accession) => accession.source,
    },
    {
      key: "trial",
      header: "试验",
      render: (accession) =>
        state.trials.find((trial) => trial.id === accession.trialId)?.code ??
        "未知",
    },
    {
      key: "light",
      header: "光照",
      render: (accession) =>
        accession.preferredLight === "full-sun"
          ? "全日照"
          : accession.preferredLight === "partial-shade"
            ? "半阴"
            : "遮阴",
    },
    {
      key: "bench",
      header: "台架",
      render: (accession) => {
        const bench = benchForAccession(state, accession.id);
        return bench ? bench.code : "未分配";
      },
    },
    {
      key: "status",
      header: "状态",
      render: (accession) => {
        const status = accessionStatus(state, accession);
        const label =
          status === "assigned"
            ? "已分配"
            : status === "blocked"
              ? "受限"
              : "未分配";
        return <StatusBadge tone={statusTone(label)}>{label}</StatusBadge>;
      },
    },
    {
      key: "actions",
      header: "",
      render: (accession) => (
        <div className="row-actions">
          <Link
            to={`/accessions/${accession.id}`}
            className="button button-ghost button-sm"
            data-testid={`open-dossier-${accession.id}`}
          >
            <FileText size={14} />
            档案
          </Link>
          <Button
            tone="ghost"
            size="sm"
            onClick={() => {
              setEditingAccession(accession);
              setEditorOpen(true);
            }}
            data-testid={`edit-accession-${accession.id}`}
          >
            编辑
          </Button>
        </div>
      ),
    },
  ];

  const openCreate = () => {
    setEditingAccession(undefined);
    setEditorOpen(true);
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="试验材料"
        title="材料登记"
        description="维护将进入观测和台架分配流程的植物品系。"
        actions={
          <Button onClick={openCreate} data-testid="open-create-accession">
            <Plus size={16} />
            新建材料
          </Button>
        }
      />
      <section className="control-strip">
        <SearchInput
          placeholder="搜索材料编号、品种、来源"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          data-testid="accession-search"
        />
        <select
          className="compact-select"
          value={trialFilter}
          onChange={(event) => setTrialFilter(event.target.value)}
          aria-label="按试验筛选"
          data-testid="trial-filter"
        >
          {state.trials.map((trial) => (
            <option value={trial.id} key={trial.id}>
              {trial.code} - {trial.cropFamily}
            </option>
          ))}
        </select>
        <SegmentedTabs
          label="按材料状态筛选"
          value={segment}
          options={[
            { value: "all", label: "全部" },
            { value: "assigned", label: "已分配" },
            { value: "unassigned", label: "未分配" },
          ]}
          onChange={setSegment}
        />
      </section>
      <section className="content-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-title">材料清单</span>
            <span className="panel-subtitle">
              {state.accessions.length} 个材料中显示 {filtered.length} 个
            </span>
          </div>
          <Sprout size={20} className="panel-icon" aria-hidden="true" />
        </div>
        <DataTable
          columns={columns}
          rows={filtered}
          rowKey={(accession) => accession.id}
          emptyMessage="当前视图下没有匹配材料。"
        />
      </section>
      <Dialog
        open={editorOpen}
        title={editingAccession ? "编辑材料" : "新建材料"}
        onClose={() => setEditorOpen(false)}
        wide
      >
        {trialFilter ? (
          <RosterForm
            trialId={trialFilter}
            nextAccessionNo={nextAccessionNumber(state)}
            accession={editingAccession}
            onCancel={() => setEditorOpen(false)}
            onSaved={() => {
              setEditorOpen(false);
              pushToast({
                tone: "success",
                title: editingAccession
                  ? "材料已更新"
                  : "材料已创建",
                message: editingAccession
                  ? `${editingAccession.accessionNo} 已更新。`
                  : "该材料现在可以分配到台架。",
              });
            }}
          />
        ) : (
          <p>请先创建试验，再添加材料。</p>
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
