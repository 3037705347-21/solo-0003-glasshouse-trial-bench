import { isAccessionRetired } from "../domain/accession";
import { canAssignAccession } from "../domain/bench";
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
import { createId } from "../domain/id";
import { canTransitionTrial } from "../domain/trial";

export interface TrialCreatedCommand {
  type: "trial/created";
  trial: Trial;
}

export interface TrialTransitionedCommand {
  type: "trial/transitioned";
  trialId: string;
  state: TrialState;
}

export interface AccessionCreatedCommand {
  type: "accession/created";
  accession: Accession;
}

export interface AccessionEditedCommand {
  type: "accession/edited";
  before: Accession;
  after: Accession;
}

export interface AccessionRetiredCommand {
  type: "accession/retired";
  before: Accession;
  after: Accession;
}

export interface AccessionRestoredCommand {
  type: "accession/restored";
  before: Accession;
  after: Accession;
}

export interface BenchAssignedCommand {
  type: "bench/assigned";
  accessionId: string;
  benchId: string;
}

export interface BenchReleasedCommand {
  type: "bench/released";
  accessionId: string;
  benchId: string;
}

export interface ObservationRecordedCommand {
  type: "observation/recorded";
  pass: ObservationPass;
  flags: Flag[];
}

export interface FlagTransitionedCommand {
  type: "flag/transitioned";
  before: Flag;
  after: Flag;
}

export interface ClearanceGeneratedCommand {
  type: "clearance/generated";
  snapshot: ClearanceSnapshot;
  fromState: TrialState;
  cleared: boolean;
}

export type HistoryCommand =
  | TrialCreatedCommand
  | TrialTransitionedCommand
  | AccessionCreatedCommand
  | AccessionEditedCommand
  | AccessionRetiredCommand
  | AccessionRestoredCommand
  | BenchAssignedCommand
  | BenchReleasedCommand
  | ObservationRecordedCommand
  | FlagTransitionedCommand
  | ClearanceGeneratedCommand;

export interface HistoryEnvelope {
  id: string;
  at: string;
  label: string;
  reversible: boolean;
  command: HistoryCommand;
}

export interface HistoryState {
  entries: HistoryEnvelope[];
  undoStack: string[];
  redoStack: string[];
}

export interface CommandResult {
  ok: boolean;
  error?: string;
}

export const emptyHistory: HistoryState = {
  entries: [],
  undoStack: [],
  redoStack: [],
};

function fail(message: string): CommandResult {
  return { ok: false, error: message };
}

function success(): CommandResult {
  return { ok: true };
}

export function describeCommand(command: HistoryCommand): string {
  switch (command.type) {
    case "trial/created":
      return `创建试验 ${command.trial.code}`;
    case "trial/transitioned":
      return `变更试验状态为 ${command.state}`;
    case "accession/created":
      return `创建材料 ${command.accession.accessionNo}`;
    case "accession/edited":
      return `编辑材料 ${command.after.accessionNo}`;
    case "accession/retired":
      return `停用材料 ${command.after.accessionNo}`;
    case "accession/restored":
      return `恢复材料 ${command.after.accessionNo}`;
    case "bench/assigned":
      return "分配台架";
    case "bench/released":
      return "移出台架";
    case "observation/recorded":
      return `记录观测 ${command.pass.id}`;
    case "flag/transitioned":
      return `处理标记 ${command.after.code}`;
    case "clearance/generated":
      return command.cleared ? "放行试验" : "生成受阻放行快照";
  }
}

export function createEnvelope(
  command: HistoryCommand,
  state: WorkspaceState,
): HistoryEnvelope {
  return {
    id: createId("his"),
    at: new Date().toISOString(),
    label: describeCommand(command),
    reversible: isReversibleCommand(command, state),
    command,
  };
}

export function isReversibleCommand(
  command: HistoryCommand,
  state: WorkspaceState,
): boolean {
  switch (command.type) {
    case "observation/recorded":
    case "accession/restored":
      return false;
    case "trial/transitioned": {
      const trial = state.trials.find((item) => item.id === command.trialId);
      return !(trial?.state === "draft" && command.state === "active");
    }
    case "clearance/generated":
      return command.cleared;
    default:
      return true;
  }
}

function replaceAccession(
  state: WorkspaceState,
  accession: Accession,
): WorkspaceState {
  return {
    ...state,
    accessions: state.accessions.map((item) =>
      item.id === accession.id ? accession : item,
    ),
  };
}

function replaceTrial(state: WorkspaceState, trial: Trial): WorkspaceState {
  return {
    ...state,
    trials: state.trials.map((item) => (item.id === trial.id ? trial : item)),
  };
}

function replaceFlag(state: WorkspaceState, flag: Flag): WorkspaceState {
  return {
    ...state,
    flags: state.flags.map((item) => (item.id === flag.id ? flag : item)),
  };
}

function replaceBench(state: WorkspaceState, bench: Bench): WorkspaceState {
  return {
    ...state,
    benches: state.benches.map((item) => (item.id === bench.id ? bench : item)),
  };
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (
    typeof left !== "object" ||
    typeof right !== "object" ||
    left === null ||
    right === null
  ) {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => sameValue(item, right[index]));
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  const rightKeys = Object.keys(rightRecord);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every((key) => sameValue(leftRecord[key], rightRecord[key]))
  );
}

function benchHoldingAccession(
  state: WorkspaceState,
  accessionId: string,
): Bench | undefined {
  return state.benches.find((bench) => bench.assignedIds.includes(accessionId));
}

function trialHasReferences(state: WorkspaceState, trialId: string): boolean {
  const accessionIds = new Set(
    state.accessions
      .filter((accession) => accession.trialId === trialId)
      .map((accession) => accession.id),
  );
  return (
    accessionIds.size > 0 ||
    state.observationPasses.some((pass) => pass.trialId === trialId) ||
    state.flags.some((flag) => flag.trialId === trialId) ||
    state.clearanceSnapshots.some(
      (snapshot) => snapshot.trialId === trialId,
    ) ||
    state.benches.some((bench) =>
      bench.assignedIds.some((accessionId) => accessionIds.has(accessionId)),
    )
  );
}

function accessionHasReferences(
  state: WorkspaceState,
  accessionId: string,
): boolean {
  return (
    state.benches.some((bench) => bench.assignedIds.includes(accessionId)) ||
    state.observationPasses.some((pass) =>
      pass.entries.some((entry) => entry.accessionId === accessionId),
    ) ||
    state.flags.some((flag) => flag.accessionId === accessionId) ||
    state.clearanceSnapshots.some((snapshot) =>
      snapshot.blockers.some((blocker) => blocker.accessionId === accessionId),
    ) ||
    state.accessions.some(
      (accession) =>
        accession.replacementId === accessionId ||
        accession.retirementHistory.some(
          (record) => record.replacementId === accessionId,
        ),
    )
  );
}

function commandTouchesTrial(
  state: WorkspaceState,
  command: HistoryCommand,
  trialId: string,
): boolean {
  switch (command.type) {
    case "trial/created":
      return command.trial.id === trialId;
    case "trial/transitioned":
      return command.trialId === trialId;
    case "observation/recorded":
      return command.pass.trialId === trialId;
    case "clearance/generated":
      return command.snapshot.trialId === trialId;
    case "accession/created":
    case "accession/edited":
    case "accession/retired":
    case "accession/restored": {
      const accession =
        command.type === "accession/created"
          ? command.accession
          : command.after;
      return accession.trialId === trialId;
    }
    case "flag/transitioned":
      return command.after.trialId === trialId;
    case "bench/assigned":
    case "bench/released": {
      const accession = state.accessions.find(
        (item) => item.id === command.accessionId,
      );
      return accession?.trialId === trialId;
    }
  }
}

function commandTouchesAccession(
  state: WorkspaceState,
  command: HistoryCommand,
  accessionId: string,
): boolean {
  switch (command.type) {
    case "accession/created":
      return command.accession.id === accessionId;
    case "accession/edited":
    case "accession/retired":
    case "accession/restored":
      return command.after.id === accessionId;
    case "observation/recorded":
      return command.pass.entries.some(
        (entry) => entry.accessionId === accessionId,
      );
    case "flag/transitioned":
      return command.after.accessionId === accessionId;
    case "bench/assigned":
    case "bench/released": {
      if (command.accessionId !== accessionId) {
        return false;
      }
      const accession = state.accessions.find(
        (item) => item.id === accessionId,
      );
      return Boolean(accession);
    }
    default:
      return false;
  }
}

function commandsAfterEnvelope(
  history: HistoryState,
  envelope: HistoryEnvelope,
): HistoryEnvelope[] {
  const index = history.entries.findIndex((item) => item.id === envelope.id);
  if (index < 0) {
    return [];
  }
  const undone = new Set(history.redoStack);
  return history.entries
    .slice(index + 1)
    .filter((item) => !undone.has(item.id));
}

function hasLaterTrialCommand(
  state: WorkspaceState,
  history: HistoryState,
  envelope: HistoryEnvelope,
  trialId: string,
): boolean {
  return commandsAfterEnvelope(history, envelope).some((item) =>
    commandTouchesTrial(state, item.command, trialId),
  );
}

function commandTrialIds(
  state: WorkspaceState,
  command: HistoryCommand,
): Set<string> {
  const trialIds = new Set<string>();
  switch (command.type) {
    case "trial/created":
      trialIds.add(command.trial.id);
      break;
    case "trial/transitioned":
      trialIds.add(command.trialId);
      break;
    case "clearance/generated":
      trialIds.add(command.snapshot.trialId);
      break;
    case "observation/recorded":
      trialIds.add(command.pass.trialId);
      break;
    case "accession/created":
      trialIds.add(command.accession.trialId);
      break;
    case "accession/edited":
    case "accession/retired":
    case "accession/restored":
      trialIds.add(command.after.trialId);
      break;
    case "flag/transitioned":
      trialIds.add(command.after.trialId);
      break;
    case "bench/assigned":
    case "bench/released": {
      const accession = state.accessions.find(
        (item) => item.id === command.accessionId,
      );
      if (accession) {
        trialIds.add(accession.trialId);
      }
    }
  }
  return trialIds;
}

function hasPermanentCommandAfterEnvelope(
  state: WorkspaceState,
  history: HistoryState,
  envelope: HistoryEnvelope,
): boolean {
  const undone = new Set(history.redoStack);
  const affectedTrialIds = commandTrialIds(state, envelope.command);
  return commandsAfterEnvelope(history, envelope).some(
    (item) =>
      !item.reversible &&
      Array.from(commandTrialIds(state, item.command)).some((trialId) =>
        affectedTrialIds.has(trialId),
      ),
  );
}

function hasLaterAccessionCommand(
  state: WorkspaceState,
  history: HistoryState,
  envelope: HistoryEnvelope,
  accessionId: string,
): boolean {
  return commandsAfterEnvelope(history, envelope).some((item) =>
    commandTouchesAccession(state, item.command, accessionId),
  );
}

function historyContainsClearanceAfter(
  state: WorkspaceState,
  history: HistoryState,
  envelope: HistoryEnvelope,
  trialId: string,
): boolean {
  const knownSnapshotIds = new Set(state.clearanceSnapshots.map((item) => item.id));
  return commandsAfterEnvelope(history, envelope).some((item) => {
    if (item.command.type !== "clearance/generated") {
      return false;
    }
    return (
      item.command.snapshot.trialId === trialId &&
      knownSnapshotIds.has(item.command.snapshot.id)
    );
  });
}

function compensatedRestoredAccession(accession: Accession): Accession {
  const lastIndex = accession.retirementHistory.length - 1;
  return {
    ...accession,
    lifecycleStatus: "active",
    retiredAt: undefined,
    retirementReason: undefined,
    replacementId: undefined,
    retirementHistory: accession.retirementHistory.map((record, index) =>
      index === lastIndex && !record.restoredAt
        ? { ...record, restoredAt: new Date().toISOString() }
        : record,
    ),
  };
}

function retirementCoreState(
  accession: Accession,
): Omit<
  Accession,
  | "lifecycleStatus"
  | "retiredAt"
  | "retirementReason"
  | "replacementId"
  | "retirementHistory"
> {
  const {
    lifecycleStatus: _lifecycleStatus,
    retiredAt: _retiredAt,
    retirementReason: _retirementReason,
    replacementId: _replacementId,
    retirementHistory: _retirementHistory,
    ...business
  } = accession;
  return business;
}

function sameRetirementCore(left: Accession, right: Accession): boolean {
  return sameValue(retirementCoreState(left), retirementCoreState(right));
}

function recordRepresents(
  current: Accession["retirementHistory"][number],
  expected: Accession["retirementHistory"][number],
): boolean {
  return (
    current.retiredAt === expected.retiredAt &&
    current.reason === expected.reason &&
    current.replacementId === expected.replacementId
  );
}

function currentRetirementMatchesCommand(
  current: Accession,
  expectedRetired: Accession,
): boolean {
  if (
    current.lifecycleStatus !== "retired" ||
    current.retiredAt !== expectedRetired.retiredAt ||
    current.retirementReason !== expectedRetired.retirementReason ||
    current.replacementId !== expectedRetired.replacementId
  ) {
    return false;
  }
  const expectedHistory = expectedRetired.retirementHistory;
  if (sameValue(current, expectedRetired)) {
    return true;
  }
  const expectedRecord = expectedHistory[expectedHistory.length - 1];
  if (
    current.retirementHistory.length < expectedHistory.length ||
    !expectedRecord
  ) {
    return false;
  }
  const prefixMatches = current.retirementHistory
    .slice(0, expectedHistory.length)
    .every((record, index) =>
      recordRepresents(record, expectedHistory[index]),
    );
  if (!prefixMatches) {
    return false;
  }
  return current.retirementHistory
    .slice(expectedHistory.length)
    .every((record, index, appended) => {
      const isLast = index === appended.length - 1;
      return (
        recordRepresents(record, expectedRecord) &&
        (isLast ? !record.restoredAt : Boolean(record.restoredAt))
      );
    });
}

function reRetiredAccession(
  state: WorkspaceState,
  retired: Accession,
): Accession | undefined {
  const retiredRecord = retired.retirementHistory.reduce<
    Accession["retirementHistory"][number] | undefined
  >((candidate, record) => (record.restoredAt ? undefined : candidate), undefined);
  const sourceRecord =
    retiredRecord ??
    retired.retirementHistory[retired.retirementHistory.length - 1];
  const replacement = sourceRecord?.replacementId
    ? state.accessions.find((item) => item.id === sourceRecord.replacementId)
    : undefined;
  if (
    !sourceRecord ||
    (sourceRecord.replacementId && !replacement) ||
    replacement?.id === retired.id
  ) {
    return undefined;
  }
  if (
    replacement &&
    (isAccessionRetired(replacement) ||
      replacement.trialId !== retired.trialId)
  ) {
    return undefined;
  }
  return {
    ...retired,
    lifecycleStatus: "retired",
    retiredAt: sourceRecord.retiredAt,
    retirementReason: sourceRecord.reason,
    replacementId: sourceRecord.replacementId,
    retirementHistory: [
      ...retired.retirementHistory,
      {
        id: createId("retire"),
        retiredAt: sourceRecord.retiredAt,
        reason: sourceRecord.reason,
        replacementId: sourceRecord.replacementId,
      },
    ],
  };
}

export function applyWorkspaceCommand(
  state: WorkspaceState,
  command: HistoryCommand,
): CommandResult {
  switch (command.type) {
    case "trial/created": {
      if (state.trials.some((trial) => trial.id === command.trial.id)) {
        return fail("该试验已经存在，不能重复重做");
      }
      if (state.trials.some((trial) => trial.code === command.trial.code)) {
        return fail("已经存在相同编号的试验，重做会覆盖无关修改");
      }
      return success();
    }
    case "trial/transitioned": {
      const trial = state.trials.find((item) => item.id === command.trialId);
      if (!trial) {
        return fail("试验已不存在，不能重做该状态变更");
      }
      if (!canTransitionTrial(trial.state, command.state)) {
        return fail(`试验当前不能从 ${trial.state} 变更为 ${command.state}`);
      }
      return success();
    }
    case "accession/created": {
      if (state.accessions.some((item) => item.id === command.accession.id)) {
        return fail("该材料已经存在，不能重复重做");
      }
      if (
        state.accessions.some(
          (item) => item.accessionNo === command.accession.accessionNo,
        )
      ) {
        return fail("已经存在相同材料编号，重做会产生冲突");
      }
      if (
        !state.trials.some((trial) => trial.id === command.accession.trialId)
      ) {
        return fail("所属试验已不存在，不能重做创建材料");
      }
      return success();
    }
    case "accession/edited": {
      const current = state.accessions.find(
        (item) => item.id === command.after.id,
      );
      if (!current) {
        return fail("材料已不存在，不能重做编辑");
      }
      if (!sameValue(current, command.before)) {
        return fail("材料在撤销后已发生变化，不能覆盖后续修改");
      }
      if (
        state.accessions.some(
          (item) =>
            item.id !== command.after.id &&
            item.accessionNo === command.after.accessionNo,
        )
      ) {
        return fail("材料编号已被其他记录使用");
      }
      return success();
    }
    case "accession/retired": {
      const current = state.accessions.find(
        (item) => item.id === command.after.id,
      );
      if (!current || !sameRetirementCore(current, command.before)) {
        return fail("材料在撤销停用后已被修改，不能覆盖后续编辑");
      }
      const retired = reRetiredAccession(state, command.after);
      return retired ? success() : fail("替代材料已不可用，不能重做停用");
    }
    case "accession/restored":
      return fail("恢复操作是新的生命周期事实，不支持撤销或重做");
    case "bench/assigned": {
      const accession = state.accessions.find(
        (item) => item.id === command.accessionId,
      );
      const bench = state.benches.find((item) => item.id === command.benchId);
      if (!accession || !bench) {
        return fail("材料或台架已不存在");
      }
      if (benchHoldingAccession(state, accession.id)) {
        return fail("材料已分配到台架，不能重复分配");
      }
      if (!canAssignAccession(accession, bench)) {
        return fail("当前容量、光照或台架状态不允许重做分配");
      }
      return success();
    }
    case "bench/released": {
      const bench = state.benches.find((item) => item.id === command.benchId);
      if (!bench?.assignedIds.includes(command.accessionId)) {
        return fail("材料当前不在该台架上，不能重做移出");
      }
      return success();
    }
    case "observation/recorded":
      return fail("观测记录是历史事实，只能更正或追加，不能撤销");
    case "flag/transitioned": {
      const current = state.flags.find(
        (item) => item.id === command.after.id,
      );
      if (!current || !sameValue(current, command.before)) {
        return fail("标记状态已变化，不能重做处理");
      }
      return success();
    }
    case "clearance/generated": {
      if (!command.cleared) {
        return fail("受阻快照是历史记录，不支持撤销或重做");
      }
      const trial = state.trials.find(
        (item) => item.id === command.snapshot.trialId,
      );
      if (!trial) {
        return fail("试验已不存在");
      }
      if (trial.state !== command.fromState) {
        return fail("试验状态已变化，不能重做放行");
      }
      if (
        !state.clearanceSnapshots.some(
          (snapshot) => snapshot.id === command.snapshot.id,
        )
      ) {
        return fail("原放行快照已不存在");
      }
      return success();
    }
  }
}

function assertNoLaterTrialDependency(
  state: WorkspaceState,
  history: HistoryState,
  envelope: HistoryEnvelope,
  trialId: string,
): CommandResult {
  if (hasLaterTrialCommand(state, history, envelope, trialId)) {
    return fail("该试验之后又发生了业务操作；请先处理后续操作，不能跨历史事实回退");
  }
  return success();
}

export function invertWorkspaceCommand(
  state: WorkspaceState,
  history: HistoryState,
  envelope: HistoryEnvelope,
): CommandResult {
  const command = envelope.command;
  if (hasPermanentCommandAfterEnvelope(state, history, envelope)) {
    return fail("之后存在不可撤销的历史事实；不能跨过它回退较早操作");
  }
  switch (command.type) {
    case "trial/created": {
      if (hasLaterTrialCommand(state, history, envelope, command.trial.id)) {
        return fail("试验创建后又发生了业务操作，不能删除已形成的历史");
      }
      if (trialHasReferences(state, command.trial.id)) {
        return fail("试验已被材料、观测、标记、台架或放行快照引用，不能删除");
      }
      return success();
    }
    case "trial/transitioned": {
      const trial = state.trials.find((item) => item.id === command.trialId);
      if (!trial) {
        return fail("试验已不存在");
      }
      if (trial.state !== command.state) {
        return fail("试验当前状态与该操作完成时不同，不能覆盖后续修改");
      }
      if (!canTransitionTrial(trial.state, trial.state === "paused" ? "active" : "draft")) {
        // The common draft -> active activation is deliberately permanent.
        return fail("当前生命周期不允许逆向转换");
      }
      const dependency = assertNoLaterTrialDependency(
        state,
        history,
        envelope,
        command.trialId,
      );
      return dependency;
    }
    case "accession/created": {
      if (
        hasLaterAccessionCommand(
          state,
          history,
          envelope,
          command.accession.id,
        )
      ) {
        return fail("材料创建后又发生了业务操作，不能删除已形成的历史");
      }
      if (accessionHasReferences(state, command.accession.id)) {
        return fail("材料已被观测、标记、台架、替代关系或放行快照引用，不能删除");
      }
      return success();
    }
    case "accession/edited": {
      const current = state.accessions.find(
        (item) => item.id === command.after.id,
      );
      if (!current) {
        return fail("材料已不存在");
      }
      if (!sameValue(current, command.after)) {
        return fail("材料在编辑后又被修改，撤销会覆盖无关字段");
      }
      if (
        hasLaterAccessionCommand(
          state,
          history,
          envelope,
          command.after.id,
        )
      ) {
        return fail("编辑之后已产生观测、台架或生命周期等依赖操作");
      }
      return success();
    }
    case "accession/retired": {
      const current = state.accessions.find(
        (item) => item.id === command.after.id,
      );
      if (!current || !currentRetirementMatchesCommand(current, command.after)) {
        return fail("停用后又发生生命周期变化，不能撤销该停用操作");
      }
      if (
        hasLaterAccessionCommand(
          state,
          history,
          envelope,
          command.after.id,
        )
      ) {
        return fail("停用后已有新观测或其他依赖操作；请先追加更正记录");
      }
      const bench = benchHoldingAccession(state, current.id);
      if (bench?.status === "blocked" || bench?.status === "quarantine") {
        return fail(`台架 ${bench.code} 当前不可用，不能恢复材料`);
      }
      return success();
    }
    case "accession/restored":
      return fail("恢复材料会保留为生命周期事实，不支持撤销");
    case "bench/assigned": {
      const bench = state.benches.find((item) => item.id === command.benchId);
      if (!bench?.assignedIds.includes(command.accessionId)) {
        return fail("材料当前不在目标台架上，台架可能已被其他操作改变");
      }
      const trialId = state.accessions.find(
        (accession) => accession.id === command.accessionId,
      )?.trialId;
      if (
        trialId &&
        historyContainsClearanceAfter(state, history, envelope, trialId)
      ) {
        return fail("该分配之后已生成放行快照，不能撤回快照所依据的台架事实");
      }
      return success();
    }
    case "bench/released": {
      const accession = state.accessions.find(
        (item) => item.id === command.accessionId,
      );
      const bench = state.benches.find((item) => item.id === command.benchId);
      if (!accession || !bench) {
        return fail("材料或台架已不存在");
      }
      if (bench.assignedIds.includes(accession.id)) {
        return fail("台架当前已包含该材料，不能重复恢复分配");
      }
      if (benchHoldingAccession(state, accession.id)) {
        return fail("材料已分配到其他台架，不能恢复旧分配");
      }
      if (!canAssignAccession(accession, bench)) {
        return fail("当前容量、光照、材料生命周期或台架状态不允许恢复分配");
      }
      return success();
    }
    case "observation/recorded":
      return fail("观测记录一经入库即为历史事实，不支持撤销");
    case "flag/transitioned": {
      const current = state.flags.find((item) => item.id === command.after.id);
      if (!current || !sameValue(current, command.after)) {
        return fail("标记状态与处理完成时不同，不能覆盖后续处理");
      }
      if (
        historyContainsClearanceAfter(
          state,
          history,
          envelope,
          command.after.trialId,
        )
      ) {
        return fail("处理结果已进入后续放行快照，不能改变历史依据");
      }
      return success();
    }
    case "clearance/generated": {
      if (!command.cleared) {
        return fail("受阻快照是不可变历史记录");
      }
      const trial = state.trials.find(
        (item) => item.id === command.snapshot.trialId,
      );
      if (!trial || trial.state !== "cleared") {
        return fail("试验当前不是已放行状态");
      }
      return assertNoLaterTrialDependency(
        state,
        history,
        envelope,
        trial.id,
      );
    }
  }
}

export function executeCommand(
  state: WorkspaceState,
  command: HistoryCommand,
): WorkspaceState {
  switch (command.type) {
    case "trial/created":
      return { ...state, trials: [...state.trials, command.trial] };
    case "trial/transitioned":
      return {
        ...state,
        trials: state.trials.map((trial) =>
          trial.id === command.trialId
            ? { ...trial, state: command.state }
            : trial,
        ),
      };
    case "accession/created":
      return {
        ...state,
        accessions: [...state.accessions, command.accession],
      };
    case "accession/edited":
      return replaceAccession(state, command.after);
    case "accession/retired": {
      const current = state.accessions.find(
        (item) => item.id === command.after.id,
      );
      if (!current) {
        return state;
      }
      if (sameValue(current, command.before)) {
        return replaceAccession(state, command.after);
      }
      const retired = reRetiredAccession(state, current);
      return retired ? replaceAccession(state, retired) : state;
    }
    case "accession/restored":
      return replaceAccession(state, command.after);
    case "bench/assigned": {
      const bench = state.benches.find((item) => item.id === command.benchId);
      if (!bench) {
        return state;
      }
      return replaceBench(state, {
        ...bench,
        assignedIds: [...bench.assignedIds, command.accessionId],
        status: "assigned",
      });
    }
    case "bench/released": {
      const bench = state.benches.find((item) => item.id === command.benchId);
      if (!bench) {
        return state;
      }
      const assignedIds = bench.assignedIds.filter(
        (id) => id !== command.accessionId,
      );
      return replaceBench(state, {
        ...bench,
        assignedIds,
        status:
          assignedIds.length > 0
            ? "assigned"
            : bench.status === "quarantine"
              ? "quarantine"
              : bench.status === "blocked"
                ? "blocked"
                : "available",
      });
    }
    case "observation/recorded":
      return {
        ...state,
        observationPasses: [...state.observationPasses, command.pass],
        flags: [...state.flags, ...command.flags],
      };
    case "flag/transitioned":
      return replaceFlag(state, command.after);
    case "clearance/generated": {
      if (!command.cleared) {
        return {
          ...state,
          clearanceSnapshots: [...state.clearanceSnapshots, command.snapshot],
        };
      }
      const alreadyStored = state.clearanceSnapshots.some(
        (snapshot) => snapshot.id === command.snapshot.id,
      );
      return {
        ...state,
        clearanceSnapshots: alreadyStored
          ? state.clearanceSnapshots
          : [...state.clearanceSnapshots, command.snapshot],
        trials: state.trials.map((trial) =>
          trial.id === command.snapshot.trialId
            ? { ...trial, state: "cleared" }
            : trial,
        ),
      };
    }
  }
}

export function undoCommand(
  state: WorkspaceState,
  envelope: HistoryEnvelope,
): WorkspaceState {
  const command = envelope.command;
  switch (command.type) {
    case "trial/created":
      return {
        ...state,
        trials: state.trials.filter((trial) => trial.id !== command.trial.id),
      };
    case "trial/transitioned": {
      const fromState =
        command.state === "paused" ? "active" : command.state === "cleared"
          ? "active"
          : "draft";
      return {
        ...state,
        trials: state.trials.map((trial) =>
          trial.id === command.trialId
            ? { ...trial, state: fromState as TrialState }
            : trial,
        ),
      };
    }
    case "accession/created":
      return {
        ...state,
        accessions: state.accessions.filter(
          (accession) => accession.id !== command.accession.id,
        ),
      };
    case "accession/edited":
      return replaceAccession(state, command.before);
    case "accession/retired": {
      const current = state.accessions.find(
        (item) => item.id === command.after.id,
      );
      return current
        ? replaceAccession(
            state,
            compensatedRestoredAccession(current),
          )
        : state;
    }
    case "accession/restored":
      return state;
    case "bench/assigned": {
      const bench = state.benches.find((item) => item.id === command.benchId);
      if (!bench) {
        return state;
      }
      const assignedIds = bench.assignedIds.filter(
        (id) => id !== command.accessionId,
      );
      return replaceBench(state, {
        ...bench,
        assignedIds,
        status:
          assignedIds.length > 0
            ? "assigned"
            : bench.status === "quarantine"
              ? "quarantine"
              : bench.status === "blocked"
                ? "blocked"
                : "available",
      });
    }
    case "bench/released": {
      const bench = state.benches.find((item) => item.id === command.benchId);
      if (!bench) {
        return state;
      }
      return replaceBench(state, {
        ...bench,
        assignedIds: [...bench.assignedIds, command.accessionId],
        status: "assigned",
      });
    }
    case "observation/recorded":
      return state;
    case "flag/transitioned":
      return replaceFlag(state, command.before);
    case "clearance/generated": {
      const trial = state.trials.find(
        (item) => item.id === command.snapshot.trialId,
      );
      return trial
        ? replaceTrial(state, { ...trial, state: command.fromState })
        : state;
    }
  }
}

export function isValidHistory(value: unknown): value is HistoryState {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<HistoryState>;
  if (
    !Array.isArray(candidate.entries) ||
    !Array.isArray(candidate.undoStack) ||
    !Array.isArray(candidate.redoStack)
  ) {
    return false;
  }
  const entries = candidate.entries;
  return (
    candidate.undoStack.every(
      (id) => typeof id === "string" && entries.some((entry) => entry.id === id),
    ) &&
    candidate.redoStack.every(
      (id) => typeof id === "string" && entries.some((entry) => entry.id === id),
    )
  );
}
