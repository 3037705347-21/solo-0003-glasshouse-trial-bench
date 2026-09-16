import type {
  Accession,
  Bench,
  BenchInspection,
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
  blockingInspectionsForBench,
  compareInspections,
  inspectionsForBench,
  isBlockingBenchInspection,
  isOpenBenchInspection,
  openInspectionsForBench,
} from "../domain/benchInspection";

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

export function benchById(
  state: WorkspaceState,
  benchId: string,
): Bench | undefined {
  return state.benches.find((bench) => bench.id === benchId);
}

export function allBenchInspections(
  state: WorkspaceState,
): BenchInspection[] {
  return [...(state.benchInspections ?? [])].sort(compareInspections);
}

export function inspectionsForBenchState(
  state: WorkspaceState,
  benchId: string,
): BenchInspection[] {
  return inspectionsForBench(state.benchInspections ?? [], benchId);
}

export function openInspectionsForBenchState(
  state: WorkspaceState,
  benchId: string,
): BenchInspection[] {
  return openInspectionsForBench(state.benchInspections ?? [], benchId);
}

export function blockingInspectionsForBenchState(
  state: WorkspaceState,
  benchId: string,
): BenchInspection[] {
  return blockingInspectionsForBench(state.benchInspections ?? [], benchId);
}

export function openInspectionMap(
  state: WorkspaceState,
): Map<string, BenchInspection[]> {
  const map = new Map<string, BenchInspection[]>();
  (state.benchInspections ?? [])
    .filter(isOpenBenchInspection)
    .forEach((inspection) => {
      const list = map.get(inspection.benchId) ?? [];
      list.push(inspection);
      map.set(inspection.benchId, list);
    });
  map.forEach((list) => list.sort(compareInspections));
  return map;
}

export function benchesWithOpenInspections(
  state: WorkspaceState,
): Array<{ bench: Bench; inspections: BenchInspection[]; blocking: boolean }> {
  const map = openInspectionMap(state);
  return state.benches
    .filter((bench) => (map.get(bench.id)?.length ?? 0) > 0)
    .sort((left, right) => left.code.localeCompare(right.code))
    .map((bench) => {
      const inspections = map.get(bench.id) ?? [];
      return {
        bench,
        inspections,
        blocking: inspections.some(isBlockingBenchInspection),
      };
    });
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
): "assigned" | "unassigned" | "blocked" | "retired" {
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
