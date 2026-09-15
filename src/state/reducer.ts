import type { WorkspaceState } from "../domain/types";
import {
  appendAuditEntry,
  buildAccessionCreatedEntry,
  buildAccessionUpdatedEntry,
  buildBatchReleaseEntry,
  buildBenchAssignedEntry,
  buildBenchReleasedEntry,
  buildClearanceEntry,
  buildFlagTransitionedEntry,
  buildObservationEntry,
  buildTrialCreatedEntry,
  buildTrialTransitionedEntry,
  buildWorkspaceReplacedEntry,
  type AuditEntry,
} from "../domain/audit";
import type { WorkspaceAction } from "./types";

export interface AppState {
  workspace: WorkspaceState;
  audit: AuditEntry[];
}

function applyWorkspaceAction(
  state: WorkspaceState,
  action: WorkspaceAction,
): WorkspaceState {
  switch (action.type) {
    case "hydrate":
      return action.state;
    case "workspace/replaced":
      return action.state;
    case "trial/created":
      return { ...state, trials: [...state.trials, action.trial] };
    case "trial/transitioned":
      return {
        ...state,
        trials: state.trials.map((trial) =>
          trial.id === action.trialId
            ? { ...trial, state: action.state }
            : trial,
        ),
      };
    case "accession/created":
      return {
        ...state,
        accessions: [...state.accessions, action.accession],
      };
    case "accession/updated":
      return {
        ...state,
        accessions: state.accessions.map((accession) =>
          accession.id === action.accession.id ? action.accession : accession,
        ),
      };
    case "bench/assigned":
    case "bench/released":
      return {
        ...state,
        benches: state.benches.map((bench) =>
          bench.id === action.bench.id ? action.bench : bench,
        ),
      };
    case "bench/batch-released":
      return {
        ...state,
        benches: state.benches.map((bench) => {
          const updated = action.benches.find((item) => item.id === bench.id);
          return updated ?? bench;
        }),
      };
    case "observation/recorded":
      return {
        ...state,
        observationPasses: [...state.observationPasses, action.pass],
        flags: [...state.flags, ...action.flags],
      };
    case "flag/transitioned":
      return {
        ...state,
        flags: state.flags.map((flag) =>
          flag.id === action.flag.id ? action.flag : flag,
        ),
      };
    case "clearance/generated":
      return {
        ...state,
        clearanceSnapshots: [...state.clearanceSnapshots, action.snapshot],
        trials: action.trials,
      };
    default:
      return state;
  }
}

/**
 * 为已成功通过领域校验的动作构建审计条目。
 * 失败操作在 UI 层就不会 dispatch，因此这里构建的条目只对应真实落库的变更。
 */
function auditEntryFor(
  before: WorkspaceState,
  after: WorkspaceState,
  action: WorkspaceAction,
): AuditEntry | undefined {
  switch (action.type) {
    case "workspace/replaced":
      return buildWorkspaceReplacedEntry(
        before,
        after,
        action.source,
        action.sourceLabel,
      );
    case "trial/created":
      return buildTrialCreatedEntry(action.trial);
    case "trial/transitioned": {
      const trial = before.trials.find((item) => item.id === action.trialId);
      return trial ? buildTrialTransitionedEntry(trial, action.state) : undefined;
    }
    case "accession/created":
      return buildAccessionCreatedEntry(action.accession);
    case "accession/updated": {
      const previous = before.accessions.find(
        (accession) => accession.id === action.accession.id,
      );
      return previous
        ? buildAccessionUpdatedEntry(previous, action.accession)
        : undefined;
    }
    case "bench/assigned": {
      const previous = before.benches.find(
        (bench) => bench.id === action.bench.id,
      );
      const accession = before.accessions.find((candidate) =>
        action.bench.assignedIds.includes(candidate.id) &&
        !previous?.assignedIds.includes(candidate.id),
      );
      return previous && accession
        ? buildBenchAssignedEntry(before, previous, action.bench, accession)
        : undefined;
    }
    case "bench/released": {
      const previous = before.benches.find(
        (bench) => bench.id === action.bench.id,
      );
      const removedId = previous?.assignedIds.find(
        (id) => !action.bench.assignedIds.includes(id),
      );
      const accession = before.accessions.find(
        (candidate) => candidate.id === removedId,
      );
      return previous && accession
        ? buildBenchReleasedEntry(before, previous, action.bench, accession)
        : undefined;
    }
    case "bench/batch-released":
      return buildBatchReleaseEntry(
        before,
        action.benches,
        action.accessionIds,
        action.trialId,
      );
    case "observation/recorded":
      return buildObservationEntry(action.pass, action.flags);
    case "flag/transitioned": {
      const previous = before.flags.find(
        (flag) => flag.id === action.flag.id,
      );
      return previous
        ? buildFlagTransitionedEntry(previous, action.flag)
        : undefined;
    }
    case "clearance/generated":
      return buildClearanceEntry(before, action.snapshot, action.trials);
    case "hydrate":
      // 初次载入不产生审计条目。
      return undefined;
    default:
      return undefined;
  }
}

export function appReducer(
  state: AppState,
  action: WorkspaceAction,
): AppState {
  const nextWorkspace = applyWorkspaceAction(state.workspace, action);
  const entry = auditEntryFor(state.workspace, nextWorkspace, action);
  if (!entry) {
    return { ...state, workspace: nextWorkspace };
  }
  return {
    workspace: nextWorkspace,
    audit: appendAuditEntry(state.audit, entry),
  };
}
