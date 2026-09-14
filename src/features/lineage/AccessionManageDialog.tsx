import { useMemo, useState } from "react";
import { ArrowRightLeft, Trash2 } from "lucide-react";
import { Button } from "../../components/Button";
import { SelectField } from "../../components/fields";
import {
  accessionDisplayName,
  planAccessionDelete,
  planAccessionMerge,
} from "../../domain/lineage";
import { activeAccessionsForTrial } from "../../state/selectors";
import { useWorkspace } from "../../state/store";

interface AccessionManageDialogProps {
  sourceId: string;
  onClose: () => void;
  onMerged: (targetName: string) => void;
  onDeleted: () => void;
  onError: (message: string) => void;
}

export function AccessionManageDialog({
  sourceId,
  onClose,
  onMerged,
  onDeleted,
  onError,
}: AccessionManageDialogProps) {
  const { state, dispatch } = useWorkspace();
  const source = state.accessions.find((item) => item.id === sourceId);
  const [targetId, setTargetId] = useState("");

  const targets = useMemo(
    () =>
      activeAccessionsForTrial(state, source?.trialId ?? "").filter(
        (accession) => accession.id !== sourceId,
      ),
    [state, source?.trialId, sourceId],
  );

  if (!source) {
    return null;
  }

  const observationCount = state.observationPasses.filter((pass) =>
    pass.entries.some((entry) => entry.accessionId === sourceId),
  ).length;
  const flagCount = state.flags.filter(
    (flag) => flag.accessionId === sourceId,
  ).length;
  const relationCount = state.lineageRelations.filter(
    (relation) =>
      relation.endpointAId === sourceId || relation.endpointBId === sourceId,
  ).length;
  const bench = state.benches.find((item) =>
    item.assignedIds.includes(sourceId),
  );

  const deletePlan = planAccessionDelete(state, sourceId);
  const mergePlan = targetId
    ? planAccessionMerge(state, sourceId, targetId)
    : undefined;

  const handleMerge = () => {
    if (!targetId || !mergePlan || !mergePlan.ok) {
      return;
    }
    const target = targets.find((item) => item.id === targetId);
    dispatch({
      type: "accession/merge-requested",
      sourceId,
      targetId,
      mergedOn: mergePlan.value.mergedOn,
      relations: mergePlan.value.relations,
      benchReleaseIds: mergePlan.value.benchReleaseIds,
    });
    onMerged(target ? accessionDisplayName(target) : targetId);
  };

  const handleDelete = () => {
    if (!deletePlan.ok) {
      onError(deletePlan.errors[0]?.message ?? "无法删除该材料");
      return;
    }
    dispatch({
      type: "accession/delete-requested",
      accessionId: sourceId,
      relationIds: deletePlan.value.relationIdsRemoved,
      benchReleaseIds: deletePlan.value.benchReleaseIds,
    });
    onDeleted();
  };

  return (
    <div className="manage-dialog-body" data-testid="manage-accession-dialog">
      <section className="manage-impact">
        <h3>关联数据</h3>
        <ul className="impact-list">
          <li>历史观测批次：<strong>{observationCount}</strong></li>
          <li>生长标记：<strong>{flagCount}</strong></li>
          <li>谱系关系：<strong>{relationCount}</strong></li>
          <li>台架分配：<strong>{bench ? bench.code : "未分配"}</strong></li>
        </ul>
      </section>

      <section className="manage-section">
        <div className="manage-section-heading">
          <ArrowRightLeft size={16} aria-hidden="true" />
          <h3>合并到其他材料（推荐）</h3>
        </div>
        <p className="muted-copy">
          合并后该材料归档为历史记录：历史观测与标记仍保留发生时的材料身份，谱系边会改接到目标材料，台架分配自动移出；无法改接而形成自环、重复或环的关系会被移除。
        </p>
        <div className="manage-merge-row">
          <SelectField
            label="合并目标"
            value={targetId}
            onChange={(event) => setTargetId(event.target.value)}
            data-testid="merge-target-select"
          >
            <option value="">请选择目标材料</option>
            {targets.map((accession) => (
              <option value={accession.id} key={accession.id}>
                {accessionDisplayName(accession)}
              </option>
            ))}
          </SelectField>
          <Button
            onClick={handleMerge}
            disabled={
              !targetId ||
              !mergePlan ||
              !mergePlan.ok
            }
            data-testid="confirm-merge-button"
          >
            合并
          </Button>
        </div>
        {mergePlan && !mergePlan.ok ? (
          <p className="form-level-error">{mergePlan.errors[0]?.message}</p>
        ) : null}
        {mergePlan?.ok ? (
          <p className="merge-impact-copy" data-testid="merge-impact">
            将移除 {mergePlan.value.relationIdsRemoved.length} 条无法改接的谱系关系
            {mergePlan.value.benchReleaseIds.length > 0
              ? "，并从台架移出该材料"
              : ""}
            。
          </p>
        ) : null}
      </section>

      <section className="manage-section">
        <div className="manage-section-heading">
          <Trash2 size={16} aria-hidden="true" />
          <h3>彻底删除</h3>
        </div>
        {deletePlan.ok ? (
          <>
            <p className="muted-copy">
              该材料没有被历史记录引用，删除会同时清理其谱系关系和台架分配，此操作不可撤销。
            </p>
            <Button
              tone="danger"
              onClick={handleDelete}
              data-testid="confirm-delete-button"
            >
              删除材料
            </Button>
          </>
        ) : (
          <p className="form-level-error" data-testid="delete-blocked-message">
            {deletePlan.errors[0]?.message}
          </p>
        )}
      </section>

      <div className="editor-actions">
        <Button tone="secondary" onClick={onClose}>
          关闭
        </Button>
      </div>
    </div>
  );
}
