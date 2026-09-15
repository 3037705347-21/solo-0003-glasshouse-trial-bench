import { useMemo, useState } from "react";
import { AlertTriangle, GitMerge, RotateCcw } from "lucide-react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { TextAreaField } from "../../components/fields";
import { StatusBadge } from "../../components/StatusBadge";
import {
  isAccessionMerged,
  isAccessionOperational,
  isAccessionRetired,
  restoreAccession,
} from "../../domain/accession";
import {
  analyzeMerge,
  commitAccessionMerge,
  formatFieldValue,
  MERGE_QUANTITY_MAX,
  MERGE_REASON_MIN_LENGTH,
  type MergeFieldResolution,
  type MergeRequest,
} from "../../domain/merge";
import { BENCH_LIGHT_COMPATIBILITY } from "../../domain/rules";
import type {
  Accession,
  MergeFieldKey,
  PreferredLight,
} from "../../domain/types";
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

const LIGHT_LABEL: Record<PreferredLight, string> = {
  "full-sun": "全日照",
  "partial-shade": "半阴",
  shade: "遮阴",
};

export function MergeAccessionsDialog({
  pairIds,
  initialSurvivorId,
  onClose,
  onMerged,
}: MergeDialogProps) {
  const { state, dispatch } = useWorkspace();

  const pairAccessions = useMemo(
    () =>
      pairIds
        .map((id) => state.accessions.find((item) => item.id === id))
        .filter((item): item is Accession => Boolean(item)),
    [state.accessions, pairIds],
  );

  // 任何候选都必须能选出一个合规存活者：默认选中对里第一个在用批次，
  // 而不是盲信初始 id（它可能已经停用）。
  const defaultSurvivor =
    pairAccessions.find((accession) => accession.id === initialSurvivorId && isAccessionOperational(accession)) ??
    pairAccessions.find((accession) => isAccessionOperational(accession)) ??
    pairAccessions[0];
  const [survivorId, setSurvivorId] = useState(defaultSurvivor?.id ?? initialSurvivorId);
  const memberIds = pairIds.filter((id) => id !== survivorId);
  const [fieldChoices, setFieldChoices] = useState<
    Partial<Record<MergeFieldKey, string>>
  >({});
  const [quantityMode, setQuantityMode] = useState<"keep" | "sum" | "custom">(
    "keep",
  );
  const [quantitySource, setQuantitySource] = useState(survivorId);
  const [customQuantity, setCustomQuantity] = useState<number>(72);
  const [targetBenchId, setTargetBenchId] = useState<string>("");
  const [reason, setReason] = useState("");
  const [mergedOn] = useState(localDateTimeValue);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [restoreConfirm, setRestoreConfirm] = useState<Record<string, boolean>>({});

  const analysisResult = useMemo(
    () => analyzeMerge(state, survivorId, memberIds),
    [state, survivorId, memberIds],
  );
  const analysisOk = analysisResult.ok;
  const analysis = analysisOk ? analysisResult.value : undefined;

  const errorFor = (field: string) =>
    errors.find((error) => error.field === field)?.message;

  const selectSurvivor = (id: string) => {
    setSurvivorId(id);
    setQuantitySource(id);
    setQuantityMode("keep");
    setTargetBenchId("");
    // 字段冲突按当前成员重新计算，清掉指向上一组成员的裁决，
    // 避免残留 sourceId 让提交静默失败。
    setFieldChoices({});
    setErrors([]);
  };

  const handleRestoreAndSelect = (accession: Accession) => {
    const confirmed = restoreConfirm[accession.id] ?? false;
    const result = restoreAccession(accession, state, confirmed);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    dispatch({ type: "accession/updated", accession: result.value });
    setErrors([]);
    selectSurvivor(accession.id);
  };

  const survivor = analysis?.survivor;
  const members = analysis?.members ?? [];
  const allMembers = survivor ? [survivor, ...members] : pairAccessions;
  const fieldConflicts = analysis?.fieldConflicts ?? [];
  const occupiedBenches = analysis?.occupiedBenches ?? [];
  const passCollisions = analysis?.passCollisions ?? [];
  const retiredMemberIds = analysis?.retiredMemberIds ?? [];

  const totalQuantity = allMembers.reduce(
    (total, member) => total + member.quantity,
    0,
  );
  const sumExceedsMax = totalQuantity > MERGE_QUANTITY_MAX;

  // 依据当前字段裁决推算合并后的光照，用于在台架选项上即时提示不兼容。
  const resolvedLightSourceId =
    fieldChoices.preferredLight ?? survivor?.id;
  const resolvedLight: PreferredLight | undefined = allMembers.find(
    (member) => member.id === resolvedLightSourceId,
  )?.preferredLight;

  const singleBench = occupiedBenches.length === 1 ? occupiedBenches[0] : undefined;
  const effectiveBenchChoice =
    targetBenchId === "" && singleBench ? singleBench.benchId : targetBenchId;

  const memberLabel = (accession: Accession) =>
    `${accession.accessionNo} · ${accession.cultivar}`;

  const handleSubmit = () => {
    if (!analysis || !survivor) {
      return;
    }
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
      targetBenchId:
        occupiedBenches.length === 0
          ? "unassigned"
          : effectiveBenchChoice || "unassigned",
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

  const benchStatusLabel: Record<string, string> = {
    available: "可用",
    assigned: "已分配",
    blocked: "停用中",
    quarantine: "隔离中",
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
            disabled={!analysisOk}
            data-testid="confirm-merge-accessions"
          >
            <GitMerge size={16} />
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
          <h3>1. 选择存活批次（唯一当前归属，必须在用）</h3>
          <div className="merge-member-grid" data-testid="merge-survivor-choices">
            {pairAccessions.map((accession) => {
              const operational = isAccessionOperational(accession);
              return (
                <div
                  key={accession.id}
                  className={`merge-member-card ${survivorId === accession.id ? "merge-member-card-selected" : ""}`}
                  data-testid={`merge-survivor-${accession.id}`}
                >
                  <button
                    type="button"
                    className="merge-member-select"
                    onClick={() => selectSurvivor(accession.id)}
                    disabled={!operational}
                    aria-label={`选择 ${accession.accessionNo} 为存活批次`}
                  >
                    <strong>{memberLabel(accession)}</strong>
                    <span>{accession.source}</span>
                    <span>
                      数量 {accession.quantity} · {accession.propagatedOn}
                    </span>
                    {operational ? (
                      survivorId === accession.id ? (
                        <StatusBadge tone="positive">存活者</StatusBadge>
                      ) : (
                        <StatusBadge tone="neutral">将成为墓碑</StatusBadge>
                      )
                    ) : (
                      <StatusBadge tone="warning">
                        {isAccessionMerged(accession) ? "已合并，不可用" : "已停用，不能作为存活者"}
                      </StatusBadge>
                    )}
                  </button>
                  {!operational && isAccessionRetired(accession) ? (
                    <div className="merge-restore-box">
                      <label className="checkbox-field">
                        <input
                          type="checkbox"
                          checked={restoreConfirm[accession.id] ?? false}
                          onChange={(event) =>
                            setRestoreConfirm((current) => ({
                              ...current,
                              [accession.id]: event.target.checked,
                            }))
                          }
                          data-testid={`merge-restore-confirm-${accession.id}`}
                        />
                        <span>已重新检查台架状态与光照兼容性</span>
                      </label>
                      <Button
                        tone="secondary"
                        size="sm"
                        onClick={() => handleRestoreAndSelect(accession)}
                        data-testid={`merge-restore-${accession.id}`}
                      >
                        <RotateCcw size={14} />
                        恢复后选为存活者
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
          {!analysisOk ? (
            <div className="merge-errors">
              {analysisResult.errors.map((error) => (
                <p
                  key={`${error.field}-${error.code}`}
                  className="form-level-error"
                  data-testid={`merge-analysis-error-${error.code}`}
                >
                  {error.code === "retired"
                    ? "该候选已停用：请选择另一个在用批次，或用下方“恢复后选为存活者”先恢复。"
                    : error.message}
                </p>
              ))}
            </div>
          ) : null}
          {errorFor("survivorId") ? (
            <p className="form-level-error">{errorFor("survivorId")}</p>
          ) : null}
        </section>

        {analysis && survivor ? (
          <>
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
                <label
                  className="merge-option"
                  title={sumExceedsMax ? `求和 ${totalQuantity} 超过单批次上限 ${MERGE_QUANTITY_MAX}` : undefined}
                >
                  <input
                    type="radio"
                    checked={quantityMode === "sum"}
                    onChange={() => setQuantityMode("sum")}
                    disabled={sumExceedsMax}
                    data-testid="merge-quantity-sum"
                  />
                  <span>
                    数量求和（{totalQuantity}）
                    {sumExceedsMax
                      ? `：超过 ${MERGE_QUANTITY_MAX} 上限，不可用`
                      : ""}
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
                  max={MERGE_QUANTITY_MAX}
                  value={customQuantity}
                  disabled={quantityMode !== "custom"}
                  onChange={(event) => setCustomQuantity(Number(event.target.value))}
                  data-testid="merge-quantity-custom"
                />
              </div>
              {errorFor("quantity") ? (
                <p className="form-level-error" data-testid="merge-quantity-error">
                  {errorFor("quantity")}
                </p>
              ) : null}
            </section>

            <section className="merge-section">
              <h3>4. 台架位置裁决</h3>
              {occupiedBenches.length === 0 ? (
                <p className="merge-muted">来源当前都不占台架，合并后为未分配。</p>
              ) : (
                <>
                  {occupiedBenches.length > 1 ? (
                    <p className="merge-warning">
                      来源分布在多个台架，物理位置必须唯一；未选中的占用将被移除并留档。
                    </p>
                  ) : null}
                  <div className="merge-bench-options">
                    <label
                      className={`merge-option ${effectiveBenchChoice === "unassigned" ? "merge-option-selected" : ""}`}
                    >
                      <input
                        type="radio"
                        name="merge-target-bench"
                        checked={effectiveBenchChoice === "unassigned"}
                        onChange={() => setTargetBenchId("unassigned")}
                        data-testid="merge-target-bench-unassigned"
                      />
                      <span>合并后不分配台架</span>
                    </label>
                    {occupiedBenches.map((entry) => {
                      const bench = state.benches.find(
                        (item) => item.id === entry.benchId,
                      );
                      const incompatible =
                        resolvedLight && bench
                          ? !BENCH_LIGHT_COMPATIBILITY[resolvedLight].includes(
                              bench.lightProfile,
                            )
                          : false;
                      const unavailable =
                        bench?.status === "blocked" || bench?.status === "quarantine";
                      return (
                        <label
                          key={entry.benchId}
                          className={`merge-option ${effectiveBenchChoice === entry.benchId ? "merge-option-selected" : ""}`}
                        >
                          <input
                            type="radio"
                            name="merge-target-bench"
                            checked={effectiveBenchChoice === entry.benchId}
                            onChange={() => setTargetBenchId(entry.benchId)}
                            data-testid={`merge-target-bench-${entry.benchId}`}
                          />
                          <span>
                            {entry.code}（{benchStatusLabel[bench?.status ?? ""]}
                            {resolvedLight
                              ? ` · ${LIGHT_LABEL[bench?.lightProfile ?? resolvedLight]}`
                              : ""}
                            ：
                            {entry.sourceIds
                              .map((id) => allMembers.find((m) => m.id === id)?.accessionNo)
                              .join("、")}
                            ）
                          </span>
                          {unavailable ? (
                            <StatusBadge tone="critical">
                              {bench?.status === "blocked" ? "停用中，不可选" : "隔离中，不可选"}
                            </StatusBadge>
                          ) : incompatible ? (
                            <StatusBadge tone="warning">
                              {`与合并后光照（${resolvedLight ? LIGHT_LABEL[resolvedLight] : ""}）不兼容`}
                            </StatusBadge>
                          ) : null}
                        </label>
                      );
                    })}
                  </div>
                </>
              )}
              {errorFor("targetBenchId") ? (
                <p className="form-level-error" data-testid="merge-bench-error">
                  {errorFor("targetBenchId")}
                </p>
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
          </>
        ) : (
          <section className="merge-section">
            <p className="merge-warning">
              请先在上方选择一个在用的存活批次；若候选都已停用，可勾选确认后就地恢复其中一个。
            </p>
          </section>
        )}
      </form>
    </Dialog>
  );
}
