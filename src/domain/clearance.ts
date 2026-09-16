import type {
  ClearanceBlocker,
  ClearanceCheckKey,
  ClearanceCheckRecord,
  ClearanceMetric,
  ClearanceSnapshot,
  Trial,
  WorkspaceState,
} from "./types";
import { createId } from "./id";
import { isAccessionRetired } from "./accession";
import { fail, fieldError, ok, type Result } from "./result";

export interface ClearanceCheckDefinition {
  key: ClearanceCheckKey;
  title: string;
  description: string;
}

export const CLEARANCE_CHECK_DEFINITIONS: ClearanceCheckDefinition[] = [
  {
    key: "material-identity",
    title: "材料身份",
    description: "核对现场材料的编号、品种与登记信息一致，无混苗或错牌。",
  },
  {
    key: "bench-placement",
    title: "台架位置",
    description: "确认材料实际摆放的台架与系统记录一致，无临时挪动。",
  },
  {
    key: "observation-completeness",
    title: "观测完整性",
    description: "确认计划内的观测均已记录，缺失数据已说明原因。",
  },
  {
    key: "label-handling",
    title: "标签处理",
    description: "确认旧标签已回收或更新，放行材料的新标签已就位。",
  },
];

export function clearanceCheckDefinition(
  key: ClearanceCheckKey,
): ClearanceCheckDefinition {
  return (
    CLEARANCE_CHECK_DEFINITIONS.find((definition) => definition.key === key) ?? {
      key,
      title: key,
      description: "",
    }
  );
}

export function checkContextSignature(
  state: WorkspaceState,
  trialId: string,
  key: ClearanceCheckKey,
): string {
  const trialAccessions = state.accessions.filter(
    (accession) => accession.trialId === trialId,
  );
  const accessionIdentity = trialAccessions
    .map(
      (accession) =>
        `${accession.id}:${accession.accessionNo}:${accession.cultivar}:${accession.source}:${accession.lifecycleStatus}`,
    )
    .sort()
    .join("|");
  const accessionLabels = trialAccessions
    .map((accession) => `${accession.id}:${accession.labels.join(",")}`)
    .sort()
    .join("|");
  const trialAccessionIds = new Set(
    trialAccessions.map((accession) => accession.id),
  );
  const benchPlacement = state.benches
    .map(
      (bench) =>
        `${bench.id}:${bench.code}:${bench.status}:${bench.assignedIds
          .filter((id) => trialAccessionIds.has(id))
          .sort()
          .join("+")}`,
    )
    .sort()
    .join("|");
  const observationTrail = [
    ...state.observationPasses
      .filter((pass) => pass.trialId === trialId)
      .map((pass) => `${pass.id}:${pass.observedOn}:${pass.entries.length}`),
    ...state.flags
      .filter((flag) => flag.trialId === trialId)
      .map((flag) => `${flag.id}:${flag.state}`),
  ]
    .sort()
    .join("|");
  switch (key) {
    case "material-identity":
      return accessionIdentity;
    case "bench-placement":
      return benchPlacement;
    case "observation-completeness":
      return observationTrail;
    case "label-handling":
      return accessionLabels;
  }
}

export interface ClearanceCheckInput {
  status: "confirmed" | "not-applicable";
  note: string;
  confirmedBy: string;
}

export function confirmClearanceCheck(
  state: WorkspaceState,
  trialId: string,
  key: ClearanceCheckKey,
  input: ClearanceCheckInput,
): Result<ClearanceCheckRecord> {
  if (!state.trials.some((trial) => trial.id === trialId)) {
    return fail([fieldError("trialId", "unknown", "未找到对应试验")]);
  }
  const note = input.note.trim();
  if (note.length > 200) {
    return fail([
      fieldError("note", "too_long", "备注不能超过 200 个字符"),
    ]);
  }
  const confirmedBy = input.confirmedBy.trim();
  if (confirmedBy.length > 40) {
    return fail([
      fieldError("confirmedBy", "too_long", "确认人姓名不能超过 40 个字符"),
    ]);
  }
  return ok({
    key,
    status: input.status,
    note,
    confirmedBy,
    confirmedAt: new Date().toISOString(),
    contextSignature: checkContextSignature(state, trialId, key),
    stale: false,
  });
}

export function isCheckRecordStale(
  state: WorkspaceState,
  trialId: string,
  record: ClearanceCheckRecord,
): boolean {
  return (
    record.contextSignature !== checkContextSignature(state, trialId, record.key)
  );
}

export function buildClearanceChecks(
  state: WorkspaceState,
  trialId: string,
): ClearanceCheckRecord[] {
  const draft = state.clearanceCheckDrafts.find(
    (item) => item.trialId === trialId,
  );
  return CLEARANCE_CHECK_DEFINITIONS.map((definition) => {
    const record = draft?.records.find(
      (item) => item.key === definition.key,
    );
    if (!record) {
      return {
        key: definition.key,
        status: "unconfirmed",
        note: "",
        confirmedBy: "",
        confirmedAt: "",
        contextSignature: "",
        stale: false,
      };
    }
    return { ...record, stale: isCheckRecordStale(state, trialId, record) };
  });
}

export interface ClearanceCheckSummary {
  confirmed: number;
  notApplicable: number;
  unconfirmed: number;
}

export function summarizeChecks(
  checks: ClearanceCheckRecord[],
): ClearanceCheckSummary {
  return {
    confirmed: checks.filter((check) => check.status === "confirmed").length,
    notApplicable: checks.filter((check) => check.status === "not-applicable")
      .length,
    unconfirmed: checks.filter((check) => check.status === "unconfirmed")
      .length,
  };
}

export function describeCheckStatus(
  status: ClearanceCheckRecord["status"],
): string {
  if (status === "confirmed") {
    return "已确认";
  }
  if (status === "not-applicable") {
    return "不适用";
  }
  return "未确认";
}

export function buildClearanceSnapshot(
  state: WorkspaceState,
  trialId: string,
): ClearanceSnapshot {
  const trial = state.trials.find((item) => item.id === trialId);
  const accessions = state.accessions.filter(
    (accession) => accession.trialId === trialId,
  );
  const activeAccessions = accessions.filter(
    (accession) => !isAccessionRetired(accession),
  );
  const activeAccessionIds = new Set(
    activeAccessions.map((accession) => accession.id),
  );
  const assignedIds = new Set(
    state.benches.flatMap((bench) => bench.assignedIds),
  );
  const openFlags = state.flags.filter(
    (flag) =>
      flag.trialId === trialId &&
      flag.state === "open" &&
      activeAccessionIds.has(flag.accessionId),
  );
  const blockers: ClearanceBlocker[] = [];
  activeAccessions.forEach((accession) => {
    if (!assignedIds.has(accession.id)) {
      blockers.push({
        code: "UNASSIGNED",
        message: `${accession.accessionNo} has no bench assignment`,
        accessionId: accession.id,
      });
    }
  });
  state.benches
    .filter((bench) => bench.status === "blocked" || bench.status === "quarantine")
    .forEach((bench) => {
      blockers.push({
        code: bench.status === "blocked" ? "BENCH_BLOCKED" : "BENCH_QUARANTINE",
        message: `Bench ${bench.code} is not available`,
        benchId: bench.id,
      });
    });
  openFlags.forEach((flag) => {
    blockers.push({
      code: `FLAG_${flag.code}`,
      message: flag.message,
      accessionId: flag.accessionId,
    });
  });
  if (activeAccessions.length === 0) {
    blockers.push({
      code: "NO_ACCESSIONS",
        message: "该试验没有材料",
    });
  }
  if (trial?.state === "draft") {
    blockers.push({
      code: "TRIAL_DRAFT",
      message: "请先将试验转为进行中，再申请放行",
    });
  }
  const metrics: ClearanceMetric[] = [
    {
      label: "材料数",
      value: accessions.length,
      detail: "该试验中的材料总数",
    },
    {
      label: "在用材料",
      value: activeAccessions.length,
      detail: "仍参与新分配和新观测的材料数",
    },
    {
      label: "已分配",
      value: activeAccessions.filter((item) => assignedIds.has(item.id)).length,
      detail: "已放置到台架的在用材料数",
    },
    {
      label: "未处理标记",
      value: openFlags.length,
      detail: "未解决的观测标记",
    },
    {
      label: "在用台架",
      value: state.benches.filter(
        (bench) =>
          bench.status === "assigned" &&
          bench.assignedIds.some((id) => activeAccessionIds.has(id)),
      ).length,
      detail: "至少有一个在用材料的台架数",
    },
  ];
  return {
    id: createId("clr"),
    trialId,
    generatedOn: new Date().toISOString(),
    status: blockers.length === 0 ? "ready" : "blocked",
    metrics,
    blockers,
    checks: buildClearanceChecks(state, trialId),
  };
}

export function canClearTrial(
  state: WorkspaceState,
  trialId: string,
): { ready: boolean; snapshot: ClearanceSnapshot } {
  const snapshot = buildClearanceSnapshot(state, trialId);
  return { ready: snapshot.status === "ready", snapshot };
}

export function applyClearance(
  state: WorkspaceState,
  snapshot: ClearanceSnapshot,
): Trial[] {
  if (snapshot.status !== "ready") {
    return state.trials;
  }
  return state.trials.map((trial) =>
    trial.id === snapshot.trialId ? { ...trial, state: "cleared" } : trial,
  );
}

export function snapshotForTrial(
  snapshots: ClearanceSnapshot[],
  trialId: string,
): ClearanceSnapshot | undefined {
  return [...snapshots]
    .filter((snapshot) => snapshot.trialId === trialId)
    .sort((left, right) => right.generatedOn.localeCompare(left.generatedOn))[0];
}

export function blockerCount(snapshot: ClearanceSnapshot): number {
  return snapshot.blockers.length;
}
