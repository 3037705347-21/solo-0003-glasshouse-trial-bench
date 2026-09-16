import { ArrowRight, ListPlus, TriangleAlert } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { SelectField } from "../../components/fields";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import type { Accession, Bench } from "../../domain/types";
import {
  accessionStatus,
  activeAccessionsForTrial,
  blockingInspectionsForBenchState,
} from "../../state/selectors";
import type { WorkspaceState } from "../../domain/types";
import { canAssignAccession } from "../../domain/bench";

interface AssignmentPanelProps {
  state: WorkspaceState;
  trialId: string;
  selectedAccessionId: string;
  onSelectAccession: (accessionId: string) => void;
}

export function AssignmentPanel({
  state,
  trialId,
  selectedAccessionId,
  onSelectAccession,
}: AssignmentPanelProps) {
  const navigate = useNavigate();
  const accessions = activeAccessionsForTrial(state, trialId);
  const selected = accessions.find(
    (accession) => accession.id === selectedAccessionId,
  );
  const compatibleBenches = selected
    ? state.benches.filter((bench) =>
        canAssignAccession(
          selected,
          bench,
          (state.benchInspections ?? []).filter(
            (inspection) => inspection.benchId === bench.id,
          ),
        ),
      )
    : [];
  const blockingBenches: Bench[] = selected
    ? state.benches.filter(
        (bench) =>
          blockingInspectionsForBenchState(state, bench.id).length > 0,
      )
    : [];

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
            {accession.accessionNo} - {accession.cultivar}
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
          </div>
          <p>{selected.genotypeNote}</p>
          <div className="assignment-compatible">
            <ArrowRight size={16} aria-hidden="true" />
            <span>
              可分配到 {compatibleBenches.length} 个台架
            </span>
          </div>
          {blockingBenches.length > 0 ? (
            <div
              className="assignment-inspection-warning"
              data-testid="assignment-inspection-warning"
            >
              <TriangleAlert size={15} aria-hidden="true" />
              <span>
                {blockingBenches.map((bench) => bench.code).join("、")}
                {" "}
                有未解除的影响使用巡检异常，暂时不能分配。
              </span>
              <button
                type="button"
                className="assignment-inspection-link"
                onClick={() =>
                  navigate(
                    `/benches/${blockingBenches[0].id}/inspections`,
                  )
                }
              >
                查看巡检
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <p className="muted-copy">选择材料后查看可分配的台架。</p>
      )}
    </aside>
  );
}
