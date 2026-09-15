import { useMemo, useState } from "react";
import { AlertTriangle, GitMerge } from "lucide-react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { TextAreaField } from "../../components/fields";
import { StatusBadge } from "../../components/StatusBadge";
import {
  isAccessionRetired,
} from "../../domain/accession";
import {
  analyzeMerge,
  commitAccessionMerge,
  formatFieldValue,
  MERGE_REASON_MIN_LENGTH,
  type MergeFieldResolution,
  type MergeRequest,
} from "../../domain/merge";
import type { Accession, MergeFieldKey } from "../../domain/types";
import type { FieldError } from "../../domain/result";
import { useWorkspace } from "../../state/store";

interface MergeDialogProps {
  pairIds: string[];
  initialSurvivorId: string;
  onClose: () => void;
  onMerged: (survivor: Accession) => void;
}

function localDateTimeValue(): string {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 16);
}

const FIELD_LABELS: Record<MergeFieldKey, string> = {
  accessionNo: "材料编号",
  cultivar: "品种",
  source: "来源",
  propagatedOn: "繁殖日期",
  trayCells: "穴盘规格",
  preferredLight: "适宜光照",
  genotypeNote: "基因型 / 批次说明",
};

export function MergeAccessionsDialog({
  pairIds,
  initialSurvivorId,
  onClose,
  onMerged,
}: MergeDialogProps) {
  const { state, dispatch } = useWorkspace();
  const [survivorId, setSurvivorId] = useState(initialSurvivorId);
  const memberIds = pairIds.filter((id) => id !== survivorId);
  const [fieldChoices, setFieldChoices] = useState<
    Partial<Record<MergeFieldKey, string>>
  >({});
  const [quantityMode, setQuantityMode] = useState<"keep" | "sum" | "custom">(
    "keep",
  );
  const [quantitySource, setQuantitySource] = useState(initialSurvivorId);
  const [customQuantity, setCustomQuantity] = useState<number>(72);
  const [targetBenchId, setTargetBenchId] = useState<string>("");
  const [reason, setReason] = useState("");
  const [mergedOn, setMergedOn] = useState(localDateTimeValue);
  const [errors, setErrors] = useState<FieldError[]>([]);

  const analysisResult = useMemo(
    () => analyzeMerge(state, survivorId, memberIds),
    [state, survivorId, memberIds],
  );

  const errorFor = (field: string) =>
    errors.find((error) => error.field === field)?.message;

  if (!analysisResult.ok) {
    return (
      <Dialog open title="无法合并这些批次" onClose={onClose} wide>
        <div className="merge-errors">
          {analysisResult.errors.map((error) => (
            <p key={`${error.field}-${error.code}`} className="form-level-error">
              {error.message}
            </p>
          ))}
        </div>
        <div className="editor-actions">
          <Button tone="secondary" onClick={onClose}>
            关闭
          </Button>
        </div>
      </Dialog>
    );
  }

  const analysis = analysisResult.value;
  const { survivor, members, fieldConflicts, occupiedBenches, passCollisions, retiredMemberIds } =
    analysis;
  const allMembers = [survivor, ...members];

  const memberLabel = (accession: Accession) =>
    `${accession.accessionNo} · ${accession.cultivar}`;

  const handleSubmit = () => {
    const scalarResolutions: MergeFieldResolution[] = fieldConflicts.map(
      (conflict) => ({
        field: conflict.field,
        chosenSourceId: fieldChoices[conflict.field] ?? survivor.id,
        strategy: "keep",
      }),
    );
    const quantityResolution: MergeFieldResolution =
      quantityMode === "sum"
        ? { field: "quantity", chosenSourceId: survivor.id, strategy: "sum" }
        : quantityMode === "custom"
          ? {
              field: "quantity",
              chosenSourceId: survivor.id,
              strategy: "custom",
              customQuantity,
            }
          : {
              field: "quantity",
              chosenSourceId: quantitySource,
              strategy: "keep",
            };
    const request: MergeRequest = {
      survivorId,
      memberIds,
      reason,
      mergedOn,
      fieldResolutions: [...scalarResolutions, quantityResolution],
      targetBenchId: occupiedBenches.length > 1 ? (targetBenchId || "unassigned") : (occupiedBenches[0]?.benchId ?? "unassigned"),
    };
    const result = commitAccessionMerge(state, request);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    dispatch({
      type: "accession/merged",
      state: result.value.state,
      record: result.value.record,
    });
    onMerged(result.value.survivor);
  };

  return (
    <Dialog
      open
      title="合并重复批次"
      onClose={onClose}
      wide
      footer={
        <>
          <Button tone="secondary" onClick={onClose}>
            取消
          </Button>
          <Button
            onClick={handleSubmit}
            tone="danger"
            data-testid="confirm-merge-accessions"
          >            <GitMerge size={16} />
            确认合并（不可逆）
          </Button>
        </>
      }
    >
      <form
        className="editor-form"
        onSubmit={(event) => {
          event.preventDefault();
          handleSubmit();
        }}
        data-testid="merge-accessions-form"
      >
        <div className="merge-callout">
          <AlertTriangle size={18} aria-hidden="true" />
          <span>
            合并后所有当前台架占用、观测、标记和替代关系只归属于存活批次；
            其他批次转为只读墓碑，旧快照保持不变。该操作不可逆。
          </span>
        </div>

        <section className="merge-section">
          <h3>1. 选择存活批次（唯一当前归属）</h3>
          <div className="merge-member-grid" data-testid="merge-survivor-choices">
            {allMembers.map((accession) => {
              return (
                <button
                  type="button"
                  key={accession.id}
                  className={`merge-member-card ${survivorId === accession.id ? "merge-member-card-selected" : ""}`}
                  onClick={() => {
                    if (!isAccessionRetired(accession)) {
                      setSurvivorId(accession.id);
                      setQuantitySource(accession.id);
                    }
                  }}
                  disabled={isAccessionRetired(accession)}
                  data-testid={`merge-survivor-${accession.id}`}
                >
                  <strong>{memberLabel(accession)}</strong>
                  <span>{accession.source}</span>
                  <span>
                    数量 {accession.quantity} · {accession.propagatedOn}
                  </span>
                  {isAccessionRetired(accession) ? (
                    <StatusBadge tone="warning">已停用，不能作为存活者</StatusBadge>
                  ) : survivorId === accession.id ? (
                    <StatusBadge tone="positive">存活者</StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">将成为墓碑</StatusBadge>
                  )}
                </button>
              );
            })}
          </div>
          {errorFor("survivorId") ? (
            <p className="form-level-error">{errorFor("survivorId")}</p>
          ) : null}
        </section>

        <section className="merge-section">
          <h3>2. 逐字段裁决冲突</h3>
          {fieldConflicts.length === 0 ? (
            <p className="merge-muted">两个批次的核心字段一致，无需逐字段选择。</p>
          ) : (
            <div className="merge-conflict-list">
              {fieldConflicts.map((conflict) => (
                <div className="merge-conflict-row" key={conflict.field}>
                  <span className="merge-conflict-field">
                    {FIELD_LABELS[conflict.field]}
                  </span>
                  <div className="merge-conflict-options">
                    {conflict.values.map((option) => {
                      const owner = allMembers.find(
                        (member) => member.id === option.sourceId,
                      );
                      return (
                        <label
                          key={option.sourceId}
                          className={`merge-option ${fieldChoices[conflict.field] === option.sourceId ? "merge-option-selected" : ""}`}
                        >
                          <input
                            type="radio"
                            name={`conflict-${conflict.field}`}
                            checked={
                              (fieldChoices[conflict.field] ?? survivor.id) ===
                              option.sourceId
                            }
                            onChange={() =>
                              setFieldChoices((current) => ({
                                ...current,
                                [conflict.field]: option.sourceId,
                              }))
                            }
                          />
                          <span>{formatFieldValue(conflict.field, option.value)}</span>
                          <small>{owner?.accessionNo}</small>
                        </label>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
          {fieldConflicts.some((conflict) => errorFor(`field.${conflict.field}`)) ? (
            <p className="form-level-error">仍有字段未选择保留来源。</p>
          ) : null}
        </section>

        <section className="merge-section">
          <h3>3. 合并后数量</h3>
          <div className="merge-quantity-row">
            <label className="merge-option">
              <input
                type="radio"
                checked={quantityMode === "keep"}
                onChange={() => setQuantityMode("keep")}
              />
              <span>保留某一批次数量</span>
            </label>
            <select
              className="compact-select"
              value={quantitySource}
              disabled={quantityMode !== "keep"}
              onChange={(event) => setQuantitySource(event.target.value)}
              data-testid="merge-quantity-source"
            >
              {allMembers.map((accession) => (
                <option value={accession.id} key={accession.id}>
                  {accession.accessionNo}（{accession.quantity}）
                </option>
              ))}
            </select>
            <label className="merge-option">
              <input
                type="radio"
                checked={quantityMode === "sum"}
                onChange={() => setQuantityMode("sum")}
                data-testid="merge-quantity-sum"
              />
              <span>
                数量求和（
                {allMembers.reduce((total, member) => total + member.quantity, 0)}）
              </span>
            </label>
            <label className="merge-option">
              <input
                type="radio"
                checked={quantityMode === "custom"}
                onChange={() => setQuantityMode("custom")}
              />
              <span>自定义</span>
            </label>
            <input
              className="field-input merge-quantity-input"
              type="number"
              min={1}
              max={500}
              value={customQuantity}
              disabled={quantityMode !== "custom"}
              onChange={(event) => setCustomQuantity(Number(event.target.value))}
              data-testid="merge-quantity-custom"
            />
          </div>
          {errorFor("quantity") ? (
            <p className="form-level-error">{errorFor("quantity")}</p>
          ) : null}
        </section>

        <section className="merge-section">
          <h3>4. 台架位置裁决</h3>
          {occupiedBenches.length === 0 ? (
            <p className="merge-muted">来源当前都不占台架，合并后为未分配。</p>
          ) : occupiedBenches.length === 1 ? (
            <p className="merge-muted">
              来源均在台架 <strong>{occupiedBenches[0].code}</strong>，
              合并后存活批次继续占用该台架。
            </p>
          ) : (
            <>
              <p className="merge-warning">
                来源分布在多个台架，物理位置必须唯一；未选中的占用将被移除并留档。
              </p>
              <div className="merge-bench-options">
                <label
                  className={`merge-option ${targetBenchId === "unassigned" ? "merge-option-selected" : ""}`}
                >
                  <input
                    type="radio"
                    name="merge-target-bench"
                    checked={targetBenchId === "unassigned"}
                    onChange={() => setTargetBenchId("unassigned")}
                  />
                  <span>合并后不分配台架</span>
                </label>
                {occupiedBenches.map((entry) => (
                  <label
                    key={entry.benchId}
                    className={`merge-option ${targetBenchId === entry.benchId ? "merge-option-selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="merge-target-bench"
                      checked={targetBenchId === entry.benchId}
                      onChange={() => setTargetBenchId(entry.benchId)}
                      data-testid={`merge-target-bench-${entry.benchId}`}
                    />
                    <span>
                      {entry.code}（
                      {entry.sourceIds
                        .map((id) => allMembers.find((m) => m.id === id)?.accessionNo)
                        .join("、")}
                      ）
                    </span>
                  </label>
                ))}
              </div>
            </>
          )}
          {errorFor("targetBenchId") ? (
            <p className="form-level-error">{errorFor("targetBenchId")}</p>
          ) : null}
        </section>

        {passCollisions.length > 0 ? (
          <section className="merge-section">
            <h3>5. 同次观测碰撞</h3>
            <p className="merge-warning">
              存活者与被合并来源在 {passCollisions.length} 个观测批次中同时有条目。
              每次只保留存活者的测量值，被丢弃的测量值会完整写入合并审计记录。
            </p>
          </section>
        ) : null}

        {retiredMemberIds.length > 0 ? (
          <section className="merge-section">
            <h3>停用来源</h3>
            <p className="merge-muted">
              {retiredMemberIds
                .map((id) => allMembers.find((member) => member.id === id)?.accessionNo)
                .join("、")}
              已停用，其停用历史会随墓碑保留，不会进入存活者的停用时间线。
            </p>
          </section>
        ) : null}

        <section className="merge-section">
          <h3>合并依据</h3>
          <TextAreaField
            label={`判断为同一批次的理由（至少 ${MERGE_REASON_MIN_LENGTH} 个字符）`}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            error={errorFor("reason")}
            rows={3}
            data-testid="merge-reason-input"
          />
        </section>
      </form>
    </Dialog>
  );
}
