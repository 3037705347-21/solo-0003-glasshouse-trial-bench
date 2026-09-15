import type {
  Accession,
  Bench,
  ClearanceSnapshot,
  Flag,
  ObservationPass,
  ReinterpretationRecord,
  RuleSet,
  Trial,
  WorkspaceState,
} from "../domain/types";
import {
  isAccessionRetired,
  latestRetirementRecord,
} from "../domain/accession";
import { resolveRuleSet } from "../domain/ruleset";
import { todayDateOnly } from "../domain/rules";

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

export function closedFlagsForTrial(
  state: WorkspaceState,
  trialId: string,
): Flag[] {
  return state.flags
    .filter((flag) => flag.trialId === trialId && flag.state !== "open")
    .sort((left, right) => right.createdOn.localeCompare(left.createdOn));
}

export function ruleSetForTrialOnDate(
  state: WorkspaceState,
  trialId: string,
  onDate: string,
): RuleSet {
  const trial = state.trials.find((item) => item.id === trialId);
  return resolveRuleSet(state.ruleSets, trial, onDate);
}

export function currentRuleSetForTrial(
  state: WorkspaceState,
  trialId: string,
): RuleSet {
  return ruleSetForTrialOnDate(state, trialId, todayDateOnly());
}

export function ruleSetLabel(
  state: WorkspaceState,
  ruleSetId: string,
): string {
  const ruleSet = state.ruleSets.find((item) => item.id === ruleSetId);
  return ruleSet ? `${ruleSet.name} v${ruleSet.version}` : "未知规则版本";
}

export function reinterpretationsForPass(
  state: WorkspaceState,
  passId: string,
): ReinterpretationRecord[] {
  return state.reinterpretations
    .filter((record) => record.passId === passId)
    .sort((left, right) => right.createdOn.localeCompare(left.createdOn));
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
