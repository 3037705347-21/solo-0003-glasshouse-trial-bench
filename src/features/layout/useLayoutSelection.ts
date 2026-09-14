import { useState } from "react";
import type { WorkspaceState } from "../../domain/types";
import { accessionById, accessionsForTrial } from "../../state/selectors";

export function useLayoutSelection(state: WorkspaceState) {
  const [trialId, setTrialId] = useState(() => state.trials[0]?.id ?? "");
  const [selectedAccessionId, setSelectedAccessionId] = useState("");

  const selectTrial = (nextTrialId: string) => {
    setTrialId(nextTrialId);
    setSelectedAccessionId("");
  };

  const accessions = accessionsForTrial(state, trialId);
  const selectedAccession = accessionById(state, selectedAccessionId);

  return {
    trialId,
    selectTrial,
    accessions,
    selectedAccessionId,
    selectedAccession,
    selectAccession: setSelectedAccessionId,
  };
}
