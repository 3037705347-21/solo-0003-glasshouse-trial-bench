import type {
  Accession,
  AccessionLineage,
  Bench,
  ClearanceSnapshot,
  Flag,
  ObservationPass,
  Trial,
  TrialCopyRecord,
  TrialState,
  WorkspaceState,
} from "../domain/types";

export type WorkspaceAction =
  | { type: "hydrate"; state: WorkspaceState }
  | { type: "reset"; state: WorkspaceState }
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
    }
  | {
      // 试验复制必须原子落库：失败时不派发该动作，避免半创建状态。
      type: "trial/copied";
      trial: Trial;
      accessions: Accession[];
      record: TrialCopyRecord;
    }
  | { type: "lineage/created"; link: AccessionLineage };

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

/**
 * 旧版本工作区没有谱系和复制记录集合；加载时补空数组，
 * 让新模块可以安全读取持久化数据。
 */
export function normalizeWorkspaceState(
  state: WorkspaceState,
): WorkspaceState {
  return {
    ...state,
    accessionLineage: Array.isArray(state.accessionLineage)
      ? state.accessionLineage
      : [],
    trialCopyRecords: Array.isArray(state.trialCopyRecords)
      ? state.trialCopyRecords
      : [],
  };
}
