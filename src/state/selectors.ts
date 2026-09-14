import type {
  Accession,
  Bench,
  ClearanceSnapshot,
  Flag,
  ObservationPass,
  Trial,
  TrialCopyRecord,
  WorkspaceState,
} from "../domain/types";

export function trialById(
  state: WorkspaceState,
  trialId: string,
): Trial | undefined {
  return state.trials.find((trial) => trial.id === trialId);
}

export function accessionsForTrial(
  state: WorkspaceState,
  trialId: string,
): Accession[] {
  return state.accessions.filter(
    (accession) => accession.trialId === trialId,
  );
}

export function accessionById(
  state: WorkspaceState,
  accessionId: string,
): Accession | undefined {
  return state.accessions.find((accession) => accession.id === accessionId);
}

export function benchForAccession(
  state: WorkspaceState,
  accessionId: string,
): Bench | undefined {
  return state.benches.find((bench) =>
    bench.assignedIds.includes(accessionId),
  );
}

export function openFlagsForTrial(
  state: WorkspaceState,
  trialId: string,
): Flag[] {
  return state.flags.filter(
    (flag) => flag.trialId === trialId && flag.state === "open",
  );
}

export function passesForTrial(
  state: WorkspaceState,
  trialId: string,
): ObservationPass[] {
  return state.observationPasses
    .filter((pass) => pass.trialId === trialId)
    .sort((left, right) => right.observedOn.localeCompare(left.observedOn));
}

export function latestSnapshotForTrial(
  state: WorkspaceState,
  trialId: string,
): ClearanceSnapshot | undefined {
  return [...state.clearanceSnapshots]
    .filter((snapshot) => snapshot.trialId === trialId)
    .sort((left, right) => right.generatedOn.localeCompare(left.generatedOn))[0];
}

export function benchUtilization(
  bench: Bench,
): { used: number; capacity: number; percent: number } {
  const percent =
    bench.capacity === 0
      ? 0
      : Math.round((bench.assignedIds.length / bench.capacity) * 100);
  return {
    used: bench.assignedIds.length,
    capacity: bench.capacity,
    percent,
  };
}

export function accessionStatus(
  state: WorkspaceState,
  accession: Accession,
): "assigned" | "unassigned" | "blocked" {
  const bench = benchForAccession(state, accession.id);
  if (!bench) {
    return "unassigned";
  }
  return bench.status === "blocked" || bench.status === "quarantine"
    ? "blocked"
    : "assigned";
}

export function copyRecordsForTrial(
  state: WorkspaceState,
  trialId: string,
): TrialCopyRecord[] {
  return state.trialCopyRecords
    .filter(
      (record) =>
        record.sourceTrialId === trialId || record.newTrialId === trialId,
    )
    .sort((left, right) => right.createdOn.localeCompare(left.createdOn));
}

export function copyRecordByKey(
  state: WorkspaceState,
  idempotencyKey: string,
): TrialCopyRecord | undefined {
  return state.trialCopyRecords.find(
    (record) => record.idempotencyKey === idempotencyKey,
  );
}

export function lineageLinksForAccession(
  state: WorkspaceState,
  accessionId: string,
): {
  parents: Array<{ link: WorkspaceState["accessionLineage"][number]; accession: Accession | undefined }>;
  children: Array<{ link: WorkspaceState["accessionLineage"][number]; accession: Accession | undefined }>;
} {
  const accessionById = new Map(
    state.accessions.map((accession) => [accession.id, accession]),
  );
  const decorate = (link: WorkspaceState["accessionLineage"][number], otherId: string) => ({
    link,
    accession: accessionById.get(otherId),
  });
  return {
    parents: state.accessionLineage
      .filter((link) => link.childAccessionId === accessionId)
      .map((link) => decorate(link, link.parentAccessionId)),
    children: state.accessionLineage
      .filter((link) => link.parentAccessionId === accessionId)
      .map((link) => decorate(link, link.childAccessionId)),
  };
}

export function trialCodeById(
  state: WorkspaceState,
  trialId: string,
): string | undefined {
  return trialById(state, trialId)?.code;
}
