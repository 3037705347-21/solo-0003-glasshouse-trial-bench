import { useMemo, useState } from "react";
import { GitBranch, Plus, Waypoints } from "lucide-react";
import { Button } from "../../components/Button";
import { DataTable, type DataColumn } from "../../components/DataTable";
import { Dialog } from "../../components/Dialog";
import { EmptyState } from "../../components/EmptyState";
import { PageHeader } from "../../components/PageHeader";
import { SelectField, TextField } from "../../components/fields";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import { ToastRegion, type ToastMessage } from "../../components/Toast";
import {
  describeLineageRelation,
  LINEAGE_RELATIONS,
  createLineageLink,
} from "../../domain/lineage";
import type {
  Accession,
  AccessionLineage,
  LineageRelation,
} from "../../domain/types";
import { useWorkspace } from "../../state/store";

interface LineageFormState {
  childAccessionId: string;
  parentAccessionId: string;
  relation: LineageRelation;
  note: string;
}

function describeRelation(relation: LineageRelation): string {
  return describeLineageRelation(relation);
}

function accessionLabel(accession: Accession | undefined): string {
  if (!accession) {
    return "未知材料";
  }
  return `${accession.accessionNo} · ${accession.cultivar}`;
}

export function LineagePage() {
  const { state, dispatch } = useWorkspace();
  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState<LineageFormState>(() => ({
    childAccessionId: state.accessions[0]?.id ?? "",
    parentAccessionId: state.accessions[1]?.id ?? state.accessions[0]?.id ?? "",
    relation: "selfed",
    note: "",
  }));
  const [errors, setErrors] = useState<
    Array<{ field: string; message: string }>
  >([]);
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = (toast: Omit<ToastMessage, "id">) => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setToasts((current) => [...current, { ...toast, id }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((item) => item.id !== id));
    }, 5200);
  };

  const accessionById = useMemo(
    () => new Map(state.accessions.map((accession) => [accession.id, accession])),
    [state.accessions],
  );

  const orderedLinks = useMemo(
    () =>
      [...state.accessionLineage].sort((left, right) =>
        right.createdOn.localeCompare(left.createdOn),
      ),
    [state.accessionLineage],
  );

  const errorFor = (field: string): string | undefined =>
    errors.find((error) => error.field === field)?.message;

  const handleSubmit = () => {
    const result = createLineageLink(form, state);
    if (!result.ok) {
      setErrors(
        result.errors.map((error) => ({
          field: error.field,
          message: error.message,
        })),
      );
      return;
    }
    dispatch({ type: "lineage/created", link: result.value });
    setEditorOpen(false);
    setErrors([]);
    const child = accessionById.get(result.value.childAccessionId);
    pushToast({
      tone: "success",
      title: "亲缘关系已登记",
      message: `${accessionLabel(child)} 的${describeRelation(result.value.relation)}关系已建立。`,
    });
  };

  const columns: Array<DataColumn<AccessionLineage>> = [
    {
      key: "child",
      header: "后代材料",
      render: (link) => (
        <span className="table-primary">
          {accessionLabel(accessionById.get(link.childAccessionId))}
        </span>
      ),
    },
    {
      key: "relation",
      header: "关系",
      render: (link) => (
        <StatusBadge tone={statusTone("info")}>
          {describeRelation(link.relation)}
        </StatusBadge>
      ),
    },
    {
      key: "parent",
      header: "亲本材料",
      render: (link) =>
        accessionLabel(accessionById.get(link.parentAccessionId)),
    },
    {
      key: "trial",
      header: "涉及试验",
      render: (link) => {
        const childTrial = accessionById.get(link.childAccessionId)?.trialId;
        const parentTrial = accessionById.get(link.parentAccessionId)?.trialId;
        const childCode =
          state.trials.find((trial) => trial.id === childTrial)?.code ?? "未知";
        const parentCode =
          state.trials.find((trial) => trial.id === parentTrial)?.code ?? "未知";
        return childCode === parentCode ? childCode : `${parentCode} → ${childCode}`;
      },
    },
    { key: "note", header: "依据", render: (link) => link.note },
  ];

  return (
    <div className="page">
      <PageHeader
        eyebrow="材料身份"
        title="材料谱系"
        description="在独立的材料之间建立自交、杂交或选择亲缘；复制试验不会自动复用或生成任何亲缘关系。"
        actions={
          <Button
            onClick={() => {
              setErrors([]);
              setEditorOpen(true);
            }}
            data-testid="open-create-lineage"
          >
            <Plus size={16} />
            登记亲缘
          </Button>
        }
      />
      <section className="content-panel">
        <div className="panel-heading">
          <div>
            <span className="panel-title">谱系链接</span>
            <span className="panel-subtitle">
              亲缘关系在此显式登记；跨试验的重复材料不会因复制自动相连
            </span>
          </div>
          <GitBranch size={20} className="panel-icon" aria-hidden="true" />
        </div>
        {orderedLinks.length === 0 ? (
          <EmptyState
            icon={Waypoints}
            title="尚未建立谱系"
            description="试验复制只创建新身份。需要把新材料与来源材料关联时，在此登记亲缘关系。"
          />
        ) : (
          <DataTable
            columns={columns}
            rows={orderedLinks}
            rowKey={(link) => link.id}
            emptyMessage="尚无谱系链接。"
          />
        )}
      </section>

      <Dialog
        open={editorOpen}
        title="登记材料亲缘"
        onClose={() => setEditorOpen(false)}
      >
        <form
          className="editor-form"
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
          data-testid="lineage-form"
        >
          <div className="form-grid">
            <SelectField
              label="亲本材料"
              value={form.parentAccessionId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  parentAccessionId: event.target.value,
                }))
              }
              error={errorFor("parentAccessionId")}
              data-testid="lineage-parent-input"
            >
              {state.accessions.map((accession) => (
                <option value={accession.id} key={accession.id}>
                  {accessionLabel(accession)}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="后代材料"
              value={form.childAccessionId}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  childAccessionId: event.target.value,
                }))
              }
              error={errorFor("childAccessionId")}
              data-testid="lineage-child-input"
            >
              {state.accessions.map((accession) => (
                <option value={accession.id} key={accession.id}>
                  {accessionLabel(accession)}
                </option>
              ))}
            </SelectField>
            <SelectField
              label="亲缘关系"
              value={form.relation}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  relation: event.target.value as LineageRelation,
                }))
              }
              error={errorFor("relation")}
              data-testid="lineage-relation-input"
            >
              {LINEAGE_RELATIONS.map((relation) => (
                <option value={relation} key={relation}>
                  {describeRelation(relation)}
                </option>
              ))}
            </SelectField>
            <TextField
              label="关系依据"
              value={form.note}
              onChange={(event) =>
                setForm((current) => ({ ...current, note: event.target.value }))
              }
              error={errorFor("note")}
              hint="例如来源批次、授粉组合或选择代数"
              data-testid="lineage-note-input"
            />
          </div>
          <div className="editor-actions">
            <Button tone="secondary" onClick={() => setEditorOpen(false)}>
              取消
            </Button>
            <Button type="submit" data-testid="save-lineage-button">
              保存亲缘
            </Button>
          </div>
        </form>
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
