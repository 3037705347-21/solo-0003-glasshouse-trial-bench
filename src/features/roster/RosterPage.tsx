import { useMemo, useState } from "react";
import {
  Ban,
  Copy,
  History,
  ListPlus,
  Plus,
  RotateCcw,
  Settings2,
  Sprout,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
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
  isAccessionRetired,
} from "../../domain/accession";
import { accessionNumberRuleFor } from "../../domain/numbering";
import type { Accession } from "../../domain/types";
import {
  accessionStatus,
  benchForAccession,
  replacementForAccession,
} from "../../state/selectors";
import { useWorkspace } from "../../state/store";
import {
  RestoreAccessionDialog,
  RetireAccessionDialog,
} from "./AccessionLifecycleDialogs";
import { CopyTrialDialog } from "./CopyTrialDialog";
import { ImportAccessionsDialog } from "./ImportAccessionsDialog";
import { NumberRulesDialog } from "./NumberRulesDialog";
import { RosterForm } from "./RosterForm";

type RosterSegment = "all" | "active" | "assigned" | "unassigned" | "retired";

export function RosterPage() {
  const { state } = useWorkspace();
  const navigate = useNavigate();
  const [trialFilter, setTrialFilter] = useState(() => state.trials[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [segment, setSegment] = useState<RosterSegment>("all");
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingAccession, setEditingAccession] = useState<Accession | undefined>();
  const [retiringAccession, setRetiringAccession] = useState<Accession | undefined>();
  const [restoringAccession, setRestoringAccession] = useState<Accession | undefined>();
  const [rulesOpen, setRulesOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [copyOpen, setCopyOpen] = useState(false);
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
        if (segment === "active") {
          return !isAccessionRetired(accession);
        }
        if (segment === "retired") {
          return isAccessionRetired(accession);
        }
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
        <span className="table-primary">{accession.accessionNo}</span>
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
      key: "numberRule",
      header: "编号来源",
      render: (accession) => {
        const rule = accessionNumberRuleFor(state, accession);
        if (rule) {
          return rule.status === "inactive" ? (
            <span title="规则已停用，历史编号保留">
              {rule.name} · 已停用
            </span>
          ) : (
            rule.name
          );
        }
        return <span className="muted-copy">手工编号</span>;
      },
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
          status === "retired"
            ? "已停用"
            : status === "assigned"
              ? "已分配"
              : status === "blocked"
                ? "受限"
                : "未分配";
        return (
          <StatusBadge tone={status === "retired" ? "warning" : statusTone(label)}>
            {label}
          </StatusBadge>
        );
      },
    },
    {
      key: "replacement",
      header: "替代材料",
      render: (accession) => {
        const replacement = replacementForAccession(state, accession);
        return replacement
          ? `${replacement.accessionNo} - ${replacement.cultivar}`
          : "未指定";
      },
    },
    {
      key: "actions",
      header: "",
      render: (accession) => (
        <div className="table-actions">
          <Button
            tone="ghost"
            size="sm"
            onClick={() =>
              navigate(`/accessions/${accession.id}/history`)
            }
            data-testid={`history-accession-${accession.id}`}
          >
            <History size={15} />
            历史
          </Button>
          {isAccessionRetired(accession) ? (
            <Button
              tone="ghost"
              size="sm"
              onClick={() => setRestoringAccession(accession)}
              data-testid={`restore-accession-${accession.id}`}
            >
              <RotateCcw size={15} />
              恢复
            </Button>
          ) : (
            <>
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
              <Button
                tone="ghost"
                size="sm"
                onClick={() => setRetiringAccession(accession)}
                data-testid={`retire-accession-${accession.id}`}
              >
                <Ban size={15} />
                停用
              </Button>
            </>
          )}
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
          <div className="page-actions">
            <Button
              tone="secondary"
              onClick={() => setRulesOpen(true)}
              data-testid="open-number-rules"
            >
              <Settings2 size={16} />
              编号规则
            </Button>
            <Button
              tone="secondary"
              onClick={() => setCopyOpen(true)}
              data-testid="open-copy-trial"
            >
              <Copy size={16} />
              复制试验
            </Button>
            <Button
              tone="secondary"
              onClick={() => setImportOpen(true)}
              data-testid="open-import-accessions"
            >
              <ListPlus size={16} />
              批量导入
            </Button>
            <Button onClick={openCreate} data-testid="open-create-accession">
              <Plus size={16} />
              新建材料
            </Button>
          </div>
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
            { value: "active", label: "在用" },
            { value: "assigned", label: "已分配" },
            { value: "unassigned", label: "未分配" },
            { value: "retired", label: "已停用" },
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
      <NumberRulesDialog
        open={rulesOpen}
        trialId={trialFilter}
        onClose={() => setRulesOpen(false)}
      />
      <ImportAccessionsDialog
        open={importOpen}
        trialId={trialFilter}
        onClose={() => setImportOpen(false)}
        onImported={(count) => {
          setImportOpen(false);
          pushToast({
            tone: "success",
            title: "批量导入完成",
            message: `已导入 ${count} 条材料，编号计数器已推进，重复导入不会重号。`,
          });
        }}
      />
      <CopyTrialDialog
        open={copyOpen}
        sourceTrialId={trialFilter}
        onClose={() => setCopyOpen(false)}
        onCopied={(code, count) => {
          setCopyOpen(false);
          pushToast({
            tone: "success",
            title: `试验 ${code} 已创建`,
            message: `${count} 个材料已按编号规则重新编号并复制到新试验。`,
          });
        }}
      />
      {retiringAccession ? (
        <RetireAccessionDialog
          accession={retiringAccession}
          state={state}
          onCancel={() => setRetiringAccession(undefined)}
          onSaved={(accession) => {
            setRetiringAccession(undefined);
            pushToast({
              tone: "success",
              title: "材料已停用",
              message: `${accession.accessionNo} 已移出新分配和新观测的可选范围。`,
            });
          }}
        />
      ) : null}
      {restoringAccession ? (
        <RestoreAccessionDialog
          accession={restoringAccession}
          state={state}
          onCancel={() => setRestoringAccession(undefined)}
          onSaved={(accession) => {
            setRestoringAccession(undefined);
            pushToast({
              tone: "success",
              title: "材料已恢复",
              message: `${accession.accessionNo} 已重新进入在用范围。`,
            });
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
