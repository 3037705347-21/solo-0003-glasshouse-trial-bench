import { ArrowRight, ListPlus } from "lucide-react";
import { SelectField } from "../../components/fields";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import type { Accession, WorkspaceState } from "../../domain/types";
import { accessionStatus } from "../../state/selectors";
import { compatibleBenchesFor } from "./compatibility";

interface AssignmentPanelProps {
  state: WorkspaceState;
  accessions: Accession[];
  selectedAccession?: Accession;
  selectedAccessionId: string;
  onSelectAccession: (accessionId: string) => void;
}

export function AssignmentPanel({
  state,
  accessions,
  selectedAccession,
  selectedAccessionId,
  onSelectAccession,
}: AssignmentPanelProps) {
  const compatibleBenches = compatibleBenchesFor(
    state.benches,
    selectedAccession,
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
            {accession.accessionNo} - {accession.cultivar}
          </option>
        ))}
      </SelectField>
      {selectedAccession ? (
        <div className="assignment-selected">
          <span className="assignment-cultivar">{selectedAccession.cultivar}</span>
          <div className="assignment-details">
            <span>{selectedAccession.accessionNo}</span>
            <StatusBadge tone={statusTone(accessionStatus(state, selectedAccession))}>
              {accessionStatus(state, selectedAccession) === "assigned"
                ? "已分配"
                : accessionStatus(state, selectedAccession) === "blocked"
                  ? "受限"
                  : "未分配"}
            </StatusBadge>
          </div>
          <p>{selectedAccession.genotypeNote}</p>
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
