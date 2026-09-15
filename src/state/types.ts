import type {
  Accession,
  Bench,
  ClearanceSnapshot,
  Flag,
  ObservationPass,
  Trial,
  TrialState,
  WorkspaceState,
} from "../domain/types";
import type {
  ClearanceGeneratedCommand,
  HistoryCommand,
} from "./history";

export type WorkspaceMutationAction =
  | { type: "trial/created"; trial: Trial }
  | { type: "trial/transitioned"; trialId: string; state: TrialState }
  | { type: "accession/created"; accession: Accession }
  | { type: "accession/updated"; accession: Accession }
  | { type: "bench/assigned"; bench: Bench }
  | { type: "bench/released"; bench: Bench }
  | { type: "observation/recorded"; pass: ObservationPass; flags: Flag[] }
  | { type: "flag/transitioned"; flag: Flag }
  | {
      type: "clearance/generated";
      snapshot: ClearanceSnapshot;
      trials: Trial[];
    };

export type WorkspaceAction =
  | { type: "hydrate"; state: WorkspaceState }
  | { type: "reset"; state: WorkspaceState }
  | WorkspaceMutationAction;

export type RootAction =
  | {
      type: "workspace/command";
      envelopeId: string;
      at: string;
      label: string;
      reversible: boolean;
      command: HistoryCommand;
    }
  | {
      type: "history/undo";
      envelopeId: string;
    }
  | {
      type: "history/redo";
      envelopeId: string;
    }
  | { type: "history/clear-error" }
  | {
      type: "workspace/reset";
      workspace: WorkspaceState;
    }
  | {
      type: "workspace/hydrate";
      workspace: WorkspaceState;
    };

export function isWorkspaceState(value: unknown): value is WorkspaceState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<WorkspaceState>;
  return (
    Array.isArray(candidate.trials) &&
    Array.isArray(candidate.accessions) &&
    Array.isArray(candidate.benches) &&
    Array.isArray(candidate.observationPasses) &&
    Array.isArray(candidate.flags) &&
    Array.isArray(candidate.clearanceSnapshots)
  );
}

export function historyCommandFromAction(
  action: WorkspaceMutationAction,
  previous: WorkspaceState,
): HistoryCommand {
  switch (action.type) {
    case "trial/created":
      return { type: "trial/created", trial: action.trial };
    case "trial/transitioned":
      return {
        type: "trial/transitioned",
        trialId: action.trialId,
        state: action.state,
      };
    case "accession/created":
      return { type: "accession/created", accession: action.accession };
    case "accession/updated": {
      const before = previous.accessions.find(
        (item) => item.id === action.accession.id,
      );
      if (!before) {
        return { type: "accession/created", accession: action.accession };
      }
      return action.accession.lifecycleStatus === "retired" &&
        before.lifecycleStatus !== "retired"
        ? {
            type: "accession/retired",
            before,
            after: action.accession,
          }
        : before.lifecycleStatus === "retired" &&
            action.accession.lifecycleStatus === "active"
          ? {
              type: "accession/restored",
              before,
              after: action.accession,
            }
          : {
              type: "accession/edited",
              before,
              after: action.accession,
            };
    }
    case "bench/assigned": {
      const previousIds = previous.benches.find(
        (bench) => bench.id === action.bench.id,
      )?.assignedIds;
      const accessionId = action.bench.assignedIds.find(
        (id) => !previousIds?.includes(id),
      );
      const fallbackAccessionId =
        action.bench.assignedIds[action.bench.assignedIds.length - 1] ?? "";
      return {
        type: "bench/assigned",
        accessionId: accessionId ?? fallbackAccessionId,
        benchId: action.bench.id,
      };
    }
    case "bench/released": {
      const previousBench = previous.benches.find(
        (bench) => bench.id === action.bench.id,
      );
      const accessionId =
        previousBench?.assignedIds.find(
          (id) => !action.bench.assignedIds.includes(id),
        ) ?? "";
      return {
        type: "bench/released",
        accessionId,
        benchId: action.bench.id,
      };
    }
    case "observation/recorded":
      return {
        type: "observation/recorded",
        pass: action.pass,
        flags: action.flags,
      };
    case "flag/transitioned": {
      const before = previous.flags.find(
        (flag) => flag.id === action.flag.id,
      );
      if (!before) {
        throw new Error("Cannot transition a flag that does not exist");
      }
      return { type: "flag/transitioned", before, after: action.flag };
    }
    case "clearance/generated": {
      const beforeTrial = previous.trials.find(
        (trial) => trial.id === action.snapshot.trialId,
      );
      const afterTrial = action.trials.find(
        (trial) => trial.id === action.snapshot.trialId,
      );
      return {
        type: "clearance/generated",
        snapshot: action.snapshot,
        fromState: beforeTrial?.state ?? "active",
        cleared:
          action.snapshot.status === "ready" &&
          afterTrial?.state === "cleared" &&
          beforeTrial?.state !== "cleared",
      } satisfies ClearanceGeneratedCommand;
    }
  }
}
