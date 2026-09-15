import type {
  Accession,
  AccessionMergeRecord,
  Bench,
  ClearanceSnapshot,
  Flag,
  ObservationEntry,
  ObservationPass,
  Trial,
  WorkspaceState,
} from "../domain/types";
import {
  isAccessionMerged,
  isAccessionRetired,
  latestRetirementRecord,
  resolveAccessionId,
} from "../domain/accession";

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

/** 可进入新分配、新观测的在用材料（不含停用、不含合并墓碑）。 */
export function activeAccessionsForTrial(
  state: WorkspaceState,
  trialId: string,
): Accession[] {
  return accessionsForTrial(state, trialId).filter(
    (accession) =>
      !isAccessionRetired(accession) && !isAccessionMerged(accession),
  );
}

export function replacementForAccession(
  state: WorkspaceState,
  accession: Accession,
): Accession | undefined {
  const replacementId =
    accession.replacementId ?? latestRetirementRecord(accession)?.replacementId;
  if (!replacementId) {
    return undefined;
  }
  return state.accessions.find(
    (item) => item.id === resolveAccessionId(state, replacementId),
  );
}

export function replacedByAccessions(
  state: WorkspaceState,
  accessionId: string,
): Accession[] {
  const survivorId = resolveAccessionId(state, accessionId);
  return state.accessions.filter((accession) => {
    const latest = latestRetirementRecord(accession);
    const target = accession.replacementId ?? latest?.replacementId;
    return Boolean(target) && resolveAccessionId(state, target!) === survivorId;
  });
}

/** 旧 id 经合并别名解析到当前存活材料；传入存活 id 时原样返回。 */
export function accessionById(
  state: WorkspaceState,
  accessionId: string,
): Accession | undefined {
  const resolved = resolveAccessionId(state, accessionId);
  return state.accessions.find((accession) => accession.id === resolved);
}

export function tombstoneById(
  state: WorkspaceState,
  accessionId: string,
): Accession | undefined {
  return state.accessions.find(
    (accession) => accession.id === accessionId && isAccessionMerged(accession),
  );
}

export function mergeRecordForAccession(
  state: WorkspaceState,
  accessionId: string,
): AccessionMergeRecord | undefined {
  const accession = state.accessions.find((item) => item.id === accessionId);
  if (!accession?.mergeRecordId) {
    return undefined;
  }
  return state.mergeRecords.find(
    (record) => record.id === accession.mergeRecordId,
  );
}

export function mergeRecordsForSurvivor(
  state: WorkspaceState,
  survivorId: string,
): AccessionMergeRecord[] {
  return state.mergeRecords.filter(
    (record) => record.survivorId === survivorId,
  );
}

export function benchForAccession(
  state: WorkspaceState,
  accessionId: string,
): Bench | undefined {
  const survivorId = resolveAccessionId(state, accessionId);
  return state.benches.find((bench) => bench.assignedIds.includes(survivorId));
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
): "assigned" | "unassigned" | "blocked" | "retired" | "merged" {
  if (isAccessionMerged(accession)) {
    return "merged";
  }
  if (isAccessionRetired(accession)) {
    return "retired";
  }
  const bench = benchForAccession(state, accession.id);
  if (!bench) {
    return "unassigned";
  }
  return bench.status === "blocked" || bench.status === "quarantine"
    ? "blocked"
    : "assigned";
}

/** 以某批次（含墓碑）为来源的全部观测条目，按日期倒序。 */
export function observationRowsForAccession(
  state: WorkspaceState,
  accessionId: string,
): Array<{
  passId: string;
  observedOn: string;
  observer: string;
  entry: ObservationEntry;
}> {
  const survivorId = resolveAccessionId(state, accessionId);
  const ownId = accessionId;
  return state.observationPasses
    .flatMap((pass) =>
      pass.entries
        .filter(
          (entry) =>
            entry.accessionId === survivorId &&
            (entry.sourceAccessionId ?? entry.accessionId) === ownId,
        )
        .map((entry) => ({
          passId: pass.id,
          observedOn: pass.observedOn,
          observer: pass.observer,
          entry,
        })),
    )
    .sort((left, right) => right.observedOn.localeCompare(left.observedOn));
}
