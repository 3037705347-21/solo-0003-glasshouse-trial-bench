import type {
  Accession,
  Bench,
  BenchMaintenanceRecord,
  ClearanceSnapshot,
  Flag,
  ObservationPass,
  Trial,
  WorkspaceState,
} from "../domain/types";
import {
  isAccessionRetired,
  latestRetirementRecord,
} from "../domain/accession";
import {
  isBenchInMaintenanceFlow,
  latestMaintenanceRecord,
} from "../domain/benchMaintenance";

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

export function activeAccessionsForTrial(
  state: WorkspaceState,
  trialId: string,
): Accession[] {
  return accessionsForTrial(state, trialId).filter(
    (accession) => !isAccessionRetired(accession),
  );
}

export function replacementForAccession(
  state: WorkspaceState,
  accession: Accession,
): Accession | undefined {
  const replacementId =
    accession.replacementId ?? latestRetirementRecord(accession)?.replacementId;
  return replacementId
    ? state.accessions.find((item) => item.id === replacementId)
    : undefined;
}

export function replacedByAccessions(
  state: WorkspaceState,
  accessionId: string,
): Accession[] {
  return state.accessions.filter((accession) => {
    const latest = latestRetirementRecord(accession);
    return (
      accession.replacementId === accessionId ||
      latest?.replacementId === accessionId
    );
  });
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

export function benchMaintenanceRecord(
  bench: Bench,
): BenchMaintenanceRecord | undefined {
  if (!isBenchInMaintenanceFlow(bench)) {
    return undefined;
  }
  return latestMaintenanceRecord(bench);
}

/** 跨所有台架的维护迁移记录（用于材料历史页展示材料去向轨迹）。 */
export function relocationsForAccession(
  state: WorkspaceState,
  accessionId: string,
): Array<{ record: BenchMaintenanceRecord["relocations"][number]; bench: Bench }> {
  return state.benches
    .flatMap((bench) =>
      bench.maintenanceHistory.flatMap((maintenance) =>
        maintenance.relocations
          .filter((relocation) => relocation.accessionId === accessionId)
          .map((record) => ({ record, bench })),
      ),
    )
    .sort((left, right) =>
      right.record.relocatedAt.localeCompare(left.record.relocatedAt),
    );
}

export function accessionStatus(
  state: WorkspaceState,
  accession: Accession,
): "assigned" | "unassigned" | "blocked" | "maintenance" | "retired" {
  if (isAccessionRetired(accession)) {
    return "retired";
  }
  const bench = benchForAccession(state, accession.id);
  if (!bench) {
    return "unassigned";
  }
  if (bench.status === "blocked" || bench.status === "quarantine") {
    return "blocked";
  }
  if (isBenchInMaintenanceFlow(bench)) {
    return "maintenance";
  }
  return "assigned";
}
