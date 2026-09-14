import { useMemo } from "react";
import type { AccessionLabelImpact } from "../../domain/labels";
import { useWorkspace } from "../../state/store";

interface ImpactPreviewProps {
  affected: AccessionLabelImpact[];
  emptyText?: string;
}

function renderLabels(labels: string[], highlight?: boolean) {
  if (labels.length === 0) {
    return <span className="label-chip label-chip-empty">无标签</span>;
  }
  return (
    <span className="label-chip-row">
      {labels.map((label) => (
        <span
          className={`label-chip ${highlight ? "label-chip-highlight" : ""}`}
          key={label}
        >
          {label}
        </span>
      ))}
    </span>
  );
}

/** 执行前预览：逐条展示受影响材料的标签变化，标签是唯一变更字段。 */
export function ImpactPreview({ affected, emptyText = "没有受影响的材料。" }: ImpactPreviewProps) {
  const { state } = useWorkspace();
  const rows = useMemo(() => {
    return affected.map((impact) => {
      const trial = state.trials.find(
        (item) => item.id === impact.accession.trialId,
      );
      return { impact, trialCode: trial?.code ?? "未知试验" };
    });
  }, [affected, state.trials]);

  if (rows.length === 0) {
    return <p className="muted-copy">{emptyText}</p>;
  }
  return (
    <div className="impact-preview" data-testid="impact-preview">
      <div className="impact-preview-head">
        <span>材料编号</span>
        <span>当前标签</span>
        <span>执行后</span>
      </div>
      <ul className="impact-list">
        {rows.map(({ impact, trialCode }) => (
          <li
            className="impact-row"
            key={impact.accession.id}
            data-testid={`impact-row-${impact.accession.id}`}
          >
            <div className="impact-id">
              <strong>{impact.accession.accessionNo}</strong>
              <span>
                {trialCode} · {impact.accession.cultivar}
                {impact.cosmeticOnly ? " · 仅标准化" : ""}
              </span>
            </div>
            <div>{renderLabels(impact.before)}</div>
            <div>{renderLabels(impact.after, true)}</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
