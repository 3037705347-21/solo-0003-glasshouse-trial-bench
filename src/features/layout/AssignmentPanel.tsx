import { ArrowRight, ListPlus, TriangleAlert } from "lucide-react";
import { SelectField } from "../../components/fields";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import type { Accession, WorkspaceState } from "../../domain/types";
import { accessionStatus, benchForAccession } from "../../state/selectors";
import { canAssignAccession } from "../../domain/bench";
import { isBenchCompatible, lightProfileLabel } from "../../domain/rules";

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
    ? state.benches.filter((bench) => canAssignAccession(selected, bench))
    : [];
  const selectedBench = selected
    ? benchForAccession(state, selected.id)
    : undefined;
  const selectedHasConflict = Boolean(
    selected && selectedBench && !isBenchCompatible(selected, selectedBench),
  );

  const statusLabel = (status: ReturnType<typeof accessionStatus>): string => {
    if (status === "assigned") {
      return "已分配";
    }
    if (status === "blocked") {
      return "受限";
    }
    if (status === "light-conflict") {
      return "光照冲突";
    }
    return "未分配";
  };

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
              {statusLabel(accessionStatus(state, selected))}
            </StatusBadge>
          </div>
          <p>{selected.genotypeNote}</p>
          {selectedHasConflict && selectedBench ? (
            <div
              className="assignment-conflict"
              role="alert"
              data-testid="assignment-conflict"
            >
              <TriangleAlert size={16} aria-hidden="true" />
              <div>
                <strong>
                  仍在 {selectedBench.code}（
                  {lightProfileLabel(selectedBench.lightProfile)}）上
                </strong>
                <p>
                  材料需要{lightProfileLabel(selected.preferredLight)}
                  光照，与当前台架不兼容。请先在右侧台架卡片上把它移出
                  {selectedBench.code}，再重新分配。
                </p>
              </div>
            </div>
          ) : null}
          <div className="assignment-compatible">
            <ArrowRight size={16} aria-hidden="true" />
            <span>
              {selectedHasConflict
                ? `移出后可分配到 ${compatibleBenches.length} 个兼容台架`
                : `可分配到 ${compatibleBenches.length} 个台架`}
            </span>
          </div>
        </div>
      ) : (
        <p className="muted-copy">选择材料后查看可分配的台架。</p>
      )}
    </aside>
  );
}
