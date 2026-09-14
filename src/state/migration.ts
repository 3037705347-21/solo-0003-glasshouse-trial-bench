import type {
  Bench,
  BenchStatusRecord,
  PreferredLight,
  WorkspaceState,
} from "../domain/types";
import { LIGHT_PROFILES } from "../domain/rules";

/**
 * 对从持久化存储读取的工作区做确定性规范化，保证旧版本数据
 * （没有 statusNote / statusHistory、状态非法等）可以继续使用。
 */
export function normalizeWorkspaceState(state: WorkspaceState): WorkspaceState {
  return {
    ...state,
    benches: state.benches.map(normalizeBench),
  };
}

function normalizeBench(raw: Bench): Bench {
  const capacity =
    Number.isFinite(raw.capacity) && raw.capacity > 0
      ? Math.floor(raw.capacity)
      : 1;
  const assignedIds = Array.isArray(raw.assignedIds)
    ? Array.from(new Set(raw.assignedIds.filter((id) => typeof id === "string")))
    : [];
  const lightProfile: PreferredLight = LIGHT_PROFILES.includes(
    raw.lightProfile,
  )
    ? raw.lightProfile
    : "full-sun";
  const status = normalizeStatus(raw.status);
  const statusNote =
    typeof raw.statusNote === "string" && raw.statusNote.trim()
      ? raw.statusNote.trim()
      : typeof raw.blockedReason === "string" && raw.blockedReason.trim()
        ? raw.blockedReason.trim()
        : undefined;
  const statusHistory = Array.isArray(raw.statusHistory)
    ? raw.statusHistory.filter(isStatusRecord)
    : [];
  const bench: Bench = {
    ...raw,
    code: typeof raw.code === "string" ? raw.code : "",
    sector: typeof raw.sector === "string" ? raw.sector : "",
    capacity,
    assignedIds,
    lightProfile,
    irrigationLine:
      typeof raw.irrigationLine === "string" ? raw.irrigationLine : "",
    status,
    statusNote:
      status === "blocked" || status === "quarantine" ? statusNote : undefined,
  };
  if (statusHistory.length > 0) {
    bench.statusHistory = statusHistory;
  }
  return bench;
}

function normalizeStatus(status: Bench["status"]): Bench["status"] {
  if (
    status === "available" ||
    status === "assigned" ||
    status === "blocked" ||
    status === "quarantine"
  ) {
    return status;
  }
  return "available";
}

function isStatusRecord(value: unknown): value is BenchStatusRecord {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<BenchStatusRecord>;
  return (
    typeof candidate.id === "string" &&
    (candidate.from === "available" ||
      candidate.from === "blocked" ||
      candidate.from === "quarantine") &&
    (candidate.to === "available" ||
      candidate.to === "blocked" ||
      candidate.to === "quarantine") &&
    typeof candidate.reason === "string" &&
    typeof candidate.changedOn === "string"
  );
}
