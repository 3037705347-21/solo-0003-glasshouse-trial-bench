import { ArrowRight, ListPlus } from "lucide-react";
import { SelectField } from "../../components/fields";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import type { Accession } from "../../domain/types";
import { accessionStatus } from "../../state/selectors";
import type { WorkspaceState } from "../../domain/types";
import { canAssignAccessionToBench } from "../../domain/reservation";

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
  const accessions = state.accessions.filter(
    (accession) => accession.trialId === trialId,
  );
  const selected = accessions.find(
    (accession) => accession.id === selectedAccessionId,
  );
  const compatibleBenches = selected
    ? state.benches.filter((bench) =>
        canAssignAccessionToBench(state, selected.id, bench.id),
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
        </div>
      ) : (
        <p className="muted-copy">选择材料后查看可分配的台架。</p>
      )}
    </aside>
  );
}
