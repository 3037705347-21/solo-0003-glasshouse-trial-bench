import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  ArrowLeft,
  GitBranch,
  List,
  Network,
  Plus,
  Trash2,
  Wrench,
} from "lucide-react";
import { Button } from "../../components/Button";
import { DataTable, type DataColumn } from "../../components/DataTable";
import { Dialog } from "../../components/Dialog";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import {
  accessionDisplayName,
  buildLineageView,
  lineageRelationLabel,
} from "../../domain/lineage";
import type { LineageRelation } from "../../domain/types";
import {
  accessionById,
  activeAccessionsForTrial,
  lineageRelationsForTrial,
} from "../../state/selectors";
import { useWorkspace } from "../../state/store";
import { LineageForm } from "./LineageForm";
import { LineageTree } from "./LineageTree";
import { AccessionManageDialog } from "./AccessionManageDialog";

type PageSegment = "tree" | "list";

export function LineagePage() {
  const { state, dispatch } = useWorkspace();
  const [searchParams, setSearchParams] = useSearchParams();
  const focusParam = searchParams.get("focus") ?? "";
  const trialParam = searchParams.get("trial") ?? "";
  const focusAccessionFromParam = focusParam
    ? state.accessions.find((accession) => accession.id === focusParam)
    : undefined;
  const validTrialParam = state.trials.some((trial) => trial.id === trialParam)
    ? trialParam
    : "";
  const [trialId, setTrialId] = useState(
    () =>
      focusAccessionFromParam?.trialId ||
      validTrialParam ||
      state.trials[0]?.id ||
      "",
  );
  const [segment, setSegment] = useState<PageSegment>(
    searchParams.get("view") === "list" ? "list" : "tree",
  );
  const [focusId, setFocusId] = useState(
    () => focusAccessionFromParam?.id ?? "",
  );
  const [relationOpen, setRelationOpen] = useState(false);
  const [relationSeedId, setRelationSeedId] = useState<string | undefined>();
  const [manageId, setManageId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const trialAccessions = state.accessions.filter(
    (accession) => accession.trialId === trialId,
  );
  const selectableAccessions = activeAccessionsForTrial(state, trialId);
  const effectiveFocusId =
    focusId && trialAccessions.some((item) => item.id === focusId)
      ? focusId
      : selectableAccessions[0]?.id ??
        trialAccessions[0]?.id ??
        "";

  const view = useMemo(
    () =>
      effectiveFocusId
        ? buildLineageView(state, effectiveFocusId)
        : undefined,
    [state, effectiveFocusId],
  );

  const mergedNames = useMemo(() => {
    const names: Record<string, string> = {};
    state.accessions.forEach((accession) => {
      if (accession.mergedIntoId) {
        const target = accessionById(state, accession.mergedIntoId);
        names[accession.id] = target
          ? accessionDisplayName(target)
          : accession.mergedIntoId;
      }
    });
    return names;
  }, [state]);

  const trialRelations = lineageRelationsForTrial(state, trialId);

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 4200);
  };

  const endpointName = (id: string): { name: string; missing: boolean } => {
    const accession = accessionById(state, id);
    if (!accession) {
      return { name: id, missing: true };
    }
    return { name: accessionDisplayName(accession), missing: false };
  };

  const relationColumns: Array<DataColumn<LineageRelation>> = [
    {
      key: "type",
      header: "关系",
      render: (relation) => (
        <StatusBadge tone={statusTone(relation.type === "parent" ? "assigned" : "info")}>
          {lineageRelationLabel(relation.type)}
        </StatusBadge>
      ),
    },
    {
      key: "endpoints",
      header: "两端材料",
      render: (relation) => {
        const left = endpointName(relation.endpointAId);
        const right = endpointName(relation.endpointBId);
        const symbol = relation.type === "parent" ? "→" : "⇄";
        return (
          <span className="relation-endpoints">
            <button
              type="button"
              className="link-button"
              onClick={() => {
                changeSegment("tree");
                changeFocus(relation.endpointAId);
              }}
            >
              {left.missing ? "（已缺失）" : left.name}
            </button>
            <span className="relation-symbol" aria-hidden="true">
              {symbol}
            </span>
            <button
              type="button"
              className="link-button"
              onClick={() => {
                changeSegment("tree");
                changeFocus(relation.endpointBId);
              }}
            >
              {right.missing ? "（已缺失）" : right.name}
            </button>
          </span>
        );
      },
    },
    {
      key: "note",
      header: "说明",
      render: (relation) => relation.note ?? "—",
    },
    {
      key: "createdOn",
      header: "建立时间",
      render: (relation) => relation.createdOn.slice(0, 10),
    },
    {
      key: "actions",
      header: "",
      render: (relation) => (
        <Button
          tone="ghost"
          size="sm"
          onClick={() =>
            dispatch({ type: "lineage/deleted", relationId: relation.id })
          }
          data-testid={`delete-relation-${relation.id}`}
        >
          <Trash2 size={14} />
          移除
        </Button>
      ),
    },
  ];

  const focusAccession = effectiveFocusId
    ? accessionById(state, effectiveFocusId)
    : undefined;

  const changeFocus = (id: string) => {
    setFocusId(id);
    setSearchParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        if (id) {
          next.set("focus", id);
          next.set("trial", trialId);
        } else {
          next.delete("focus");
        }
        return next;
      },
      { replace: true },
    );
  };

  const handleAddRelation = (seedId?: string) => {
    setRelationSeedId(seedId);
    setRelationOpen(true);
  };

  const changeSegment = (next: PageSegment) => {
    setSegment(next);
    setSearchParams(
      (previous) => {
        const params = new URLSearchParams(previous);
        if (next === "list") {
          params.set("view", "list");
        } else {
          params.delete("view");
        }
        return params;
      },
      { replace: true },
    );
  };

  return (
    <div className="page">
      <PageHeader
        eyebrow="材料溯源"
        title="材料谱系"
        description="为材料建立可选的父代、子代与同批衍生关系，从任一材料沿谱系链上下追溯。历史观测与标记保留其发生时的材料身份，不会被谱系调整改写。"
        actions={
          <Link to="/roster" className="button button-secondary button-md back-link">
            <ArrowLeft size={16} />
            返回材料列表
          </Link>
        }
      />
      <section className="control-strip">
        <select
          className="compact-select"
          value={trialId}
          onChange={(event) => {
            setTrialId(event.target.value);
            setFocusId("");
            setSearchParams({}, { replace: true });
          }}
          aria-label="选择试验"
          data-testid="lineage-trial-select"
        >
          {state.trials.map((trial) => (
            <option value={trial.id} key={trial.id}>
              {trial.code} - {trial.cropFamily}
            </option>
          ))}
        </select>
        <SegmentedTabs<PageSegment>
          label="谱系视图切换"
          value={segment}
          onChange={changeSegment}
          options={[
            { value: "tree", label: "谱系链视图" },
            { value: "list", label: "关系列表" },
          ]}
        />
        <Button onClick={() => handleAddRelation(effectiveFocusId)} data-testid="open-create-relation">
          <Plus size={16} />
          新增关系
        </Button>
      </section>

      {segment === "tree" ? (
        trialAccessions.length === 0 ? (
          <section className="content-panel">
            <EmptyState
              icon={Network}
              title="该试验还没有材料"
              description="请先在材料登记中创建材料，再为它们建立谱系关系。"
              action={
                <Link to="/roster" className="button button-primary button-md">
                  前往材料登记
                </Link>
              }
            />
          </section>
        ) : (
          <>
            <section className="content-panel lineage-focus-panel">
              <div className="lineage-focus-controls">
                <label className="field">
                  <span className="field-label">焦点材料</span>
                  <select
                    className="field-input"
                    value={effectiveFocusId}
                    onChange={(event) => changeFocus(event.target.value)}
                    data-testid="lineage-focus-select"
                  >
                    {trialAccessions.map((accession) => (
                      <option value={accession.id} key={accession.id}>
                        {accessionDisplayName(accession)}
                        {accession.mergedIntoId ? "（已归档）" : ""}
                      </option>
                    ))}
                  </select>
                </label>
                {focusAccession?.mergedIntoId ? (
                  <StatusBadge tone="warning">
                    {`已合并到 ${mergedNames[focusAccession.id] ?? "其他材料"}`}
                  </StatusBadge>
                ) : null}
                <div className="lineage-focus-actions">
                  <Button
                    tone="secondary"
                    size="sm"
                    onClick={() => handleAddRelation(effectiveFocusId)}
                    disabled={Boolean(focusAccession?.mergedIntoId)}
                  >
                    <GitBranch size={15} />
                    以此材料建关系
                  </Button>
                  <Button
                    tone="secondary"
                    size="sm"
                    onClick={() => setManageId(effectiveFocusId)}
                    data-testid="open-manage-accession"
                  >
                    <Wrench size={15} />
                    合并 / 删除
                  </Button>
                </div>
              </div>
              {focusAccession ? (
                <p className="muted-copy lineage-focus-note">
                  来源文本：{focusAccession.source} · {focusAccession.genotypeNote}
                </p>
              ) : null}
            </section>

            {view ? (
              <section className="content-panel lineage-canvas-panel">
                <div className="panel-heading">
                  <div>
                    <span className="panel-title">完整谱系链</span>
                    <span className="panel-subtitle">
                      向上 {view.ancestorLevels.length} 层父代 · 向下{" "}
                      {view.descendantLevels.length} 层子代 ·{" "}
                      {view.cohorts.length} 个同批衍生
                    </span>
                  </div>
                  <Network size={20} className="panel-icon" aria-hidden="true" />
                </div>
                <div className="lineage-canvas">
                  <LineageTree
                    view={view}
                    selectedId={effectiveFocusId}
                    mergedNames={mergedNames}
                    onSelect={(id) => changeFocus(id)}
                  />
                </div>
                <div className="lineage-legend">
                  <span className="lineage-chip lineage-chip-untraced">
                    追溯终止
                  </span>
                  <span className="muted-copy">
                    表示源数据未记录该节点的父代，谱系在此无法继续向上追溯。
                  </span>
                </div>
              </section>
            ) : null}
          </>
        )
      ) : (
        <section className="content-panel">
          <div className="panel-heading">
            <div>
              <span className="panel-title">谱系关系列表</span>
              <span className="panel-subtitle">
                共 {trialRelations.length} 条关系，可在此回退到逐条管理
              </span>
            </div>
            <List size={20} className="panel-icon" aria-hidden="true" />
          </div>
          <DataTable
            columns={relationColumns}
            rows={trialRelations}
            rowKey={(relation) => relation.id}
            emptyMessage="该试验还没有谱系关系。使用“新增关系”建立第一条。"
          />
        </section>
      )}

      <Dialog
        open={relationOpen}
        title="新增谱系关系"
        onClose={() => setRelationOpen(false)}
      >
        <LineageForm
          trialId={trialId}
          initialEndpointId={relationSeedId}
          onCancel={() => setRelationOpen(false)}
          onSaved={() => {
            setRelationOpen(false);
            pushToast({
              tone: "success",
              title: "谱系关系已添加",
              message: "刷新后关系仍会保留在本地工作区中。",
            });
          }}
        />
      </Dialog>

      <Dialog
        open={Boolean(manageId)}
        title="合并或删除材料"
        onClose={() => setManageId(null)}
      >
        {manageId ? (
          <AccessionManageDialog
            sourceId={manageId}
            onClose={() => setManageId(null)}
            onMerged={(targetName) => {
              setManageId(null);
              pushToast({
                tone: "success",
                title: "材料已合并归档",
                message: `历史观测与标记保留原材料身份，谱系已改接到 ${targetName}。`,
              });
            }}
            onDeleted={() => {
              setManageId(null);
              setFocusId("");
              pushToast({
                tone: "success",
                title: "材料已删除",
                message: "相关谱系关系和台架分配已一并清理，没有遗留悬空引用。",
              });
            }}
            onError={(message) =>
              pushToast({ tone: "error", title: "操作被拒绝", message })
            }
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
