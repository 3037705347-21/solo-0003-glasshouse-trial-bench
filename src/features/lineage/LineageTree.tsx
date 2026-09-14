import { ArrowDown, CornerDownRight, HelpCircle, Users } from "lucide-react";
import type { Accession } from "../../domain/types";
import type { LineageView } from "../../domain/lineage";

interface LineageTreeProps {
  view: LineageView;
  selectedId: string;
  mergedNames: Record<string, string>;
  onSelect: (accessionId: string) => void;
}

interface NodeCardProps {
  accession: Accession;
  isFocus: boolean;
  isUntracedRoot: boolean;
  isMerged: boolean;
  mergedLabel?: string;
  onSelect: (accessionId: string) => void;
  trailingMark?: "cohort" | null;
}

function NodeCard({
  accession,
  isFocus,
  isUntracedRoot,
  isMerged,
  mergedLabel,
  onSelect,
  trailingMark,
}: NodeCardProps) {
  return (
    <button
      type="button"
      className={`lineage-node ${isFocus ? "lineage-node-focus" : ""} ${
        isMerged ? "lineage-node-merged" : ""
      }`}
      onClick={() => onSelect(accession.id)}
      data-testid={`lineage-node-${accession.id}`}
    >
      <span className="lineage-node-no">{accession.accessionNo}</span>
      <span className="lineage-node-cultivar">{accession.cultivar}</span>
      <span className="lineage-node-meta">
        {accession.source} · 繁殖 {accession.propagatedOn}
      </span>
      <span className="lineage-node-badges">
        {isFocus ? <span className="lineage-chip lineage-chip-focus">当前焦点</span> : null}
        {isMerged ? (
          <span
            className="lineage-chip lineage-chip-merged"
            title={mergedLabel ? `已合并到 ${mergedLabel}` : "已合并归档"}
          >
            已归档
          </span>
        ) : null}
        {isUntracedRoot ? (
          <span
            className="lineage-chip lineage-chip-untraced"
            title="源数据中没有记录该材料的父代，谱系在此无法继续向上追溯"
          >
            <HelpCircle size={11} aria-hidden="true" />
            追溯终止
          </span>
        ) : null}
        {trailingMark === "cohort" ? (
          <span className="lineage-chip lineage-chip-cohort">
            <Users size={11} aria-hidden="true" />
            同批
          </span>
        ) : null}
      </span>
    </button>
  );
}

export function LineageTree({
  view,
  selectedId,
  mergedNames,
  onSelect,
}: LineageTreeProps) {
  const isUntraced = (accessionId: string): boolean =>
    view.untracedRootIds.includes(accessionId);

  const mergedLabel = (accession: Accession): string | undefined =>
    accession.mergedIntoId ? mergedNames[accession.id] : undefined;

  const cohortIds = new Set(view.cohorts.map((accession) => accession.id));

  return (
    <div className="lineage-tree" data-testid="lineage-tree">
      <div className="lineage-column">
        <span className="lineage-column-label">
          祖先（向上追溯 {view.ancestorLevels.length} 层）
        </span>
        {view.ancestorLevels.length === 0 ? (
          <div className="lineage-untraced-banner">
            <HelpCircle size={15} aria-hidden="true" />
            <span>
              当前材料没有记录父代：源数据不完整，无法继续向上追溯。
            </span>
          </div>
        ) : (
          [...view.ancestorLevels]
            .reverse()
            .map((level) => (
              <div className="lineage-level" key={`ancestor-${level.depth}`}>
                <span className="lineage-depth-tag">
                  上 {level.depth} 代
                </span>
                <div className="lineage-level-nodes">
                  {level.accessions.map((accession) => (
                    <NodeCard
                      key={accession.id}
                      accession={accession}
                      isFocus={false}
                      isUntracedRoot={isUntraced(accession.id)}
                      isMerged={Boolean(accession.mergedIntoId)}
                      mergedLabel={mergedLabel(accession)}
                      onSelect={onSelect}
                      trailingMark={cohortIds.has(accession.id) ? "cohort" : null}
                    />
                  ))}
                </div>
                <ArrowDown size={16} className="lineage-arrow" aria-hidden="true" />
              </div>
            ))
        )}
      </div>

      <div className="lineage-level lineage-focus-level">
        <span className="lineage-depth-tag">当前材料</span>
        <div className="lineage-level-nodes">
          <NodeCard
            accession={view.focus}
            isFocus
            isUntracedRoot={isUntraced(view.focus.id)}
            isMerged={Boolean(view.focus.mergedIntoId)}
            mergedLabel={mergedLabel(view.focus)}
            onSelect={onSelect}
          />
          {view.cohorts.length > 0 ? (
            <div className="lineage-cohort-rail">
              <span className="lineage-cohort-label">
                <CornerDownRight size={14} aria-hidden="true" />
                同批衍生
              </span>
              {view.cohorts.map((accession) => (
                <NodeCard
                  key={accession.id}
                  accession={accession}
                  isFocus={accession.id === selectedId}
                  isUntracedRoot={isUntraced(accession.id)}
                  isMerged={Boolean(accession.mergedIntoId)}
                  mergedLabel={mergedLabel(accession)}
                  onSelect={onSelect}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      <div className="lineage-column">
        {view.descendantLevels.length > 0 ? (
          <>
            <ArrowDown size={16} className="lineage-arrow" aria-hidden="true" />
            <span className="lineage-column-label">
              子代（向下延续 {view.descendantLevels.length} 层）
            </span>
            {view.descendantLevels.map((level) => (
              <div className="lineage-level" key={`descendant-${level.depth}`}>
                <span className="lineage-depth-tag">下 {level.depth} 代</span>
                <div className="lineage-level-nodes">
                  {level.accessions.map((accession) => (
                    <NodeCard
                      key={accession.id}
                      accession={accession}
                      isFocus={false}
                      isUntracedRoot={false}
                      isMerged={Boolean(accession.mergedIntoId)}
                      mergedLabel={mergedLabel(accession)}
                      onSelect={onSelect}
                      trailingMark={cohortIds.has(accession.id) ? "cohort" : null}
                    />
                  ))}
                </div>
                <ArrowDown size={16} className="lineage-arrow" aria-hidden="true" />
              </div>
            ))}
          </>
        ) : (
          <div className="lineage-terminal-banner">
            <span>该材料暂无已登记的子代。</span>
          </div>
        )}
      </div>
    </div>
  );
}
