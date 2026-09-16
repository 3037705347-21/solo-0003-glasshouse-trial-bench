import { ArrowRight, ListPlus, TriangleAlert } from "lucide-react";
import { SelectField, TextField } from "../../components/fields";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import type { Accession, Bench } from "../../domain/types";
import {
  accessionStatus,
  accessionStock,
  activeAccessionsForTrial,
} from "../../state/selectors";
import type { WorkspaceState } from "../../domain/types";
import { canAssignAccession } from "../../domain/bench";
import { stockLevelLabel } from "../../domain/consumption";

interface AssignmentPanelProps {
  state: WorkspaceState;
  trialId: string;
  selectedAccessionId: string;
  plannedQuantity: number;
  onSelectAccession: (accessionId: string) => void;
  onPlannedQuantityChange: (quantity: number) => void;
}

function optionStockLabel(
  state: WorkspaceState,
  accession: Accession,
): string {
  const stock = accessionStock(state, accession);
  return `${accession.accessionNo} - ${accession.cultivar}（余量 ${stock.remaining}）`;
}

export function AssignmentPanel({
  state,
  trialId,
  selectedAccessionId,
  plannedQuantity,
  onSelectAccession,
  onPlannedQuantityChange,
}: AssignmentPanelProps) {
  const accessions = activeAccessionsForTrial(state, trialId);
  const selected = accessions.find(
    (accession) => accession.id === selectedAccessionId,
  );
  const selectedStock = selected
    ? accessionStock(state, selected)
    : undefined;
  const compatibleBenches = selected
    ? state.benches.filter((bench) => canAssignAccession(selected, bench))
    : [];
  const plannedValid =
    Number.isInteger(plannedQuantity) && plannedQuantity >= 1;
  const overStock = Boolean(
    selectedStock && plannedValid && plannedQuantity > selectedStock.remaining,
  );

  return (
    <aside className="assignment-panel">
      <div className="assignment-panel-heading">
        <ListPlus size={18} aria-hidden="true" />
        <h2>分配材料</h2>
      </div>
      <SelectField
        label="材料"
        value={selectedAccessionId}
        onChange={(event) => onSelectAccession(event.target.value)}
        data-testid="assignment-accession-select"
      >
        <option value="">请选择材料</option>
        {accessions.map((accession) => (
          <option value={accession.id} key={accession.id}>
            {optionStockLabel(state, accession)}
          </option>
        ))}
      </SelectField>
      {selected ? (
        <div className="assignment-selected">
          <span className="assignment-cultivar">{selected.cultivar}</span>
          <div className="assignment-details">
            <span>{selected.accessionNo}</span>
            <StatusBadge tone={statusTone(accessionStatus(state, selected))}>
              {accessionStatus(state, selected) === "assigned"
                ? "已分配"
                : accessionStatus(state, selected) === "blocked"
                  ? "受限"
                  : accessionStatus(state, selected) === "retired"
                    ? "已停用"
                  : "未分配"}
            </StatusBadge>
            <span data-testid="assignment-stock-badge">
              <StatusBadge
                tone={
                  selectedStock!.level === "in-stock"
                    ? "positive"
                    : selectedStock!.level === "low"
                      ? "warning"
                      : "critical"
                }
              >
                {`余量 ${selectedStock!.remaining} · ${stockLevelLabel(selectedStock!.level)}`}
              </StatusBadge>
            </span>
          </div>
          <p>{selected.genotypeNote}</p>
          <TextField
            label="计划使用数量"
            type="number"
            min={1}
            value={Number.isFinite(plannedQuantity) ? String(plannedQuantity) : ""}
            onChange={(event) =>
              onPlannedQuantityChange(Number(event.target.value))
            }
            hint="计划数量只用于余量核对，不会自动登记耗用或改动台架状态"
            data-testid="assignment-planned-quantity"
          />
          {overStock ? (
            <p className="stock-warning" data-testid="assignment-stock-warning" role="alert">
              <TriangleAlert size={15} aria-hidden="true" />
              计划数量 {plannedQuantity} 超过当前余量 {selectedStock!.remaining}，
              请先补充库存、调减计划或合并/改用替代批次，否则不能分配。
            </p>
          ) : null}
          {!overStock && selectedStock && selectedStock.level !== "in-stock" ? (
            <p className="stock-hint">
              当前余量 {selectedStock.remaining}，请确认计划用量后再分配。
            </p>
          ) : null}
          <div className="assignment-compatible">
            <ArrowRight size={16} aria-hidden="true" />
            <span>
              可分配到 {compatibleBenches.length} 个台架
            </span>
          </div>
        </div>
      ) : (
        <p className="muted-copy">选择材料后查看可分配的台架。</p>
      )}
    </aside>
  );
}
