import type {
  Accession,
  Bench,
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
  isPassSuperseded,
  orderPassSeries,
  passSeries,
  passVersionNumber,
} from "../domain/observation";

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

/**
 * 试验当前生效的观测版本（每条版本链的链头）。
 * 被修订取代的旧版本不出现在该视图中，但仍在版本链里可查询。
 */
export function effectivePassesForTrial(
  state: WorkspaceState,
  trialId: string,
): ObservationPass[] {
  return passesForTrial(state, trialId).filter(
    (pass) => !isPassSuperseded(pass),
  );
}

export function passSeriesVersions(
  state: WorkspaceState,
  seriesId: string,
): ObservationPass[] {
  return orderPassSeries(passSeries(state.observationPasses, seriesId));
}

export function passVersionLabel(
  state: WorkspaceState,
  pass: ObservationPass,
): string {
  const series = passSeries(state.observationPasses, pass.seriesId);
  return `v${passVersionNumber(series, pass)}`;
}

export function flagsForPass(state: WorkspaceState, passId: string): Flag[] {
  return state.flags.filter((flag) => flag.observationPassId === passId);
}

/**
 * 快照生成之后才生效的观测修订。用于解释旧放行结论：
 * 快照本身不可变，但修订列表说明它可能已不反映当前数据。
 */
export function revisionsAfterSnapshot(
  state: WorkspaceState,
  snapshot: ClearanceSnapshot,
): ObservationPass[] {
  return state.observationPasses
    .filter(
      (pass) =>
        pass.trialId === snapshot.trialId &&
        pass.revision !== undefined &&
        pass.revision.revisedOn > snapshot.generatedOn,
    )
    .sort((left, right) =>
      (left.revision?.revisedOn ?? "").localeCompare(
        right.revision?.revisedOn ?? "",
      ),
    );
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
