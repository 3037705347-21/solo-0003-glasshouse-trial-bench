import type { AuditItem } from "../../domain/audit";
import type { WorkspaceState } from "../../domain/types";

export interface AuditTarget {
  /** 对象在当前工作区中是否仍存在；不存在时不提供跳转链接。 */
  exists: boolean;
  path: string;
}

function existsIn(state: WorkspaceState, item: AuditItem): boolean {
  switch (item.objectType) {
    case "trial":
      return state.trials.some((trial) => trial.id === item.objectId);
    case "accession":
      return state.accessions.some(
        (accession) => accession.id === item.objectId,
      );
    case "bench":
      return state.benches.some((bench) => bench.id === item.objectId);
    case "observation":
      return state.observationPasses.some((pass) => pass.id === item.objectId);
    case "flag":
      return state.flags.some((flag) => flag.id === item.objectId);
    case "snapshot":
      return state.clearanceSnapshots.some(
        (snapshot) => snapshot.id === item.objectId,
      );
    case "workspace":
      return true;
    default:
      return false;
  }
}

/**
 * 把审计条目解析为跳转目标。对象在后续操作中被删除时返回 exists=false，
 * UI 显示「对象已不存在」而不是给出死链。
 */
export function resolveAuditTarget(
  state: WorkspaceState,
  item: AuditItem,
): AuditTarget | undefined {
  if (!existsIn(state, item)) {
    return { exists: false, path: "" };
  }
  const query = (...parts: string[]) => parts.filter(Boolean).join("&");
  const trial = item.trialId
    ? `trial=${encodeURIComponent(item.trialId)}`
    : "";
  switch (item.objectType) {
    case "trial":
      return { exists: true, path: `/clearance?${query(trial)}` };
    case "accession": {
      const accession = state.accessions.find(
        (candidate) => candidate.id === item.objectId,
      );
      const q = accession
        ? `q=${encodeURIComponent(accession.accessionNo)}`
        : "";
      return { exists: true, path: `/roster?${query(trial, q)}` };
    }
    case "bench":
      return {
        exists: true,
        path: `/layout?${query(trial, `bench=${encodeURIComponent(item.objectId)}`)}`,
      };
    case "observation":
      return { exists: true, path: `/observations?${query(trial)}` };
    case "flag":
      return {
        exists: true,
        path: `/observations?${query(trial, `flag=${encodeURIComponent(item.objectId)}`)}`,
      };
    case "snapshot":
      return { exists: true, path: `/clearance?${query(trial)}` };
    default:
      return undefined;
  }
}
