import { test } from "node:test";
import assert from "node:assert/strict";
import {
  loadWorkspace,
  saveWorkspace,
  restoreFromBackup,
  resetToSample,
  WORKSPACE_STORAGE_KEY,
  type StorageBackend,
} from "../persistence";
import { CURRENT_SCHEMA_VERSION } from "./types";
import type { WorkspaceState } from "../../domain/types";

const NOW = "2026-09-15T00:00:00.000Z";
const SAMPLE_MARKER = "__sample_workspace__";

function makeSample(): WorkspaceState {
  // 用带标记的空工作区充当“示例”，便于断言有没有被示例顶替
  return {
    trials: [{ id: SAMPLE_MARKER } as unknown as WorkspaceState["trials"][number]],
    accessions: [],
    benches: [],
    observationPasses: [],
    flags: [],
    clearanceSnapshots: [],
  };
}

function memoryBackend(initial: Record<string, string> = {}): StorageBackend & {
  dump: () => Record<string, string>;
} {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    dump: () => Object.fromEntries(map),
  };
}

function v1Workspace(): unknown {
  return {
    trials: [{ id: "t-1", code: "REAL-1", state: "active" }],
    accessions: [],
    benches: [],
    observationPasses: [],
    flags: [],
    clearanceSnapshots: [],
  };
}

test("v1 旧工作区升级：主键被替换为新版本，旧载荷逐字进入备份与快照，绝不返回示例", () => {
  const rawV1 = JSON.stringify({ version: 1, savedAt: NOW, state: v1Workspace() });
  const storage = memoryBackend({ [WORKSPACE_STORAGE_KEY]: rawV1 });

  const outcome = loadWorkspace({ storage, now: NOW, createSample: makeSample });
  assert.equal(outcome.kind, "ready");
  if (outcome.kind !== "ready") throw new Error("expected ready");
  assert.equal(outcome.isSample, false);
  assert.equal(outcome.upgraded, true);
  assert.equal(outcome.schemaVersion, CURRENT_SCHEMA_VERSION);
  // 真实历史事实保留
  assert.equal(outcome.state.trials[0].id, "t-1");
  assert.equal(outcome.state.trials[0].code, "REAL-1");

  const stored = JSON.parse(storage.getItem(WORKSPACE_STORAGE_KEY) as string);
  assert.equal(stored.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(stored.state.trials[0].id, "t-1");
  // 升级前快照逐字保留旧信封
  assert.deepEqual(stored.preMigrationSnapshot, JSON.parse(rawV1));

  // 备份键存在且包含逐字旧载荷
  const backup = JSON.parse((storage as any).dump()["glasshouse-trial-bench:workspace:backup"]);
  assert.equal(backup.source, rawV1);
});

test("损坏数据进入恢复模式并写入隔离键，主键原样不动、绝不用示例顶替", () => {
  const corrupt = "{ broken json";
  const storage = memoryBackend({ [WORKSPACE_STORAGE_KEY]: corrupt });

  const outcome = loadWorkspace({ storage, now: NOW, createSample: makeSample });
  assert.equal(outcome.kind, "recovery");
  if (outcome.kind !== "recovery") throw new Error("expected recovery");
  assert.equal(outcome.reasonCode, "invalid_json");
  assert.equal(outcome.raw, corrupt);

  // 主键保持原样（没有被示例覆盖）
  assert.equal(storage.getItem(WORKSPACE_STORAGE_KEY), corrupt);
  // 隔离键已写入，可事后排查/导出
  const quarantine = JSON.parse(
    (storage as any).dump()["glasshouse-trial-bench:workspace:quarantine"],
  );
  assert.equal(quarantine.cause, "invalid_json");
  assert.equal(quarantine.raw, corrupt);
});

test("未来版本拒绝加载为恢复模式，主键不被改写", () => {
  const future = JSON.stringify({
    schemaVersion: CURRENT_SCHEMA_VERSION + 5,
    state: v1Workspace(),
  });
  const storage = memoryBackend({ [WORKSPACE_STORAGE_KEY]: future });
  const outcome = loadWorkspace({ storage, now: NOW, createSample: makeSample });
  assert.equal(outcome.kind, "recovery");
  if (outcome.kind !== "recovery") throw new Error("expected recovery");
  assert.equal(outcome.reasonCode, "unsupported_future_version");
  assert.equal(storage.getItem(WORKSPACE_STORAGE_KEY), future);
});

test("存储为空才返回示例工作区（首次使用）", () => {
  const storage = memoryBackend();
  const outcome = loadWorkspace({ storage, now: NOW, createSample: makeSample });
  assert.equal(outcome.kind, "empty");
  if (outcome.kind !== "empty") throw new Error("expected empty");
  assert.equal(outcome.isSample, true);
  assert.equal(outcome.state.trials[0].id, SAMPLE_MARKER);
});

test("备份写失败时中止升级，主键仍是旧数据（失败不伪装成功）", () => {
  const rawV1 = JSON.stringify({ version: 1, savedAt: NOW, state: v1Workspace() });
  const failing = memoryBackend({ [WORKSPACE_STORAGE_KEY]: rawV1 });
  const originalSet = failing.setItem.bind(failing);
  failing.setItem = (key, value) => {
    if (key === "glasshouse-trial-bench:workspace:backup") {
      throw new Error("quota exceeded");
    }
    originalSet(key, value);
  };

  const outcome = loadWorkspace({ storage: failing, now: NOW, createSample: makeSample });
  assert.equal(outcome.kind, "recovery");
  if (outcome.kind !== "recovery") throw new Error("expected recovery");
  assert.equal(outcome.reasonCode, "write_failed");
  // 旧数据完好
  assert.equal(failing.getItem(WORKSPACE_STORAGE_KEY), rawV1);
});

test("回滚备份后主键恢复为升级前载荷，可重新尝试升级", () => {
  const rawV1 = JSON.stringify({ version: 1, savedAt: NOW, state: v1Workspace() });
  const storage = memoryBackend({ [WORKSPACE_STORAGE_KEY]: rawV1 });
  loadWorkspace({ storage, now: NOW, createSample: makeSample });
  // 此时主键已是 v2
  assert.notEqual(storage.getItem(WORKSPACE_STORAGE_KEY), rawV1);

  const rolled = restoreFromBackup(storage);
  assert.equal(rolled.ok, true);
  assert.equal(storage.getItem(WORKSPACE_STORAGE_KEY), rawV1);

  // 重新加载会再次升级
  const again = loadWorkspace({ storage, now: NOW, createSample: makeSample });
  assert.equal(again.kind, "ready");
});

test("日常保存写后读回校验失败时返回显式错误", () => {
  const storage = memoryBackend();
  storage.setItem = () => {
    // 模拟写入静默失败：什么都不写
  };
  const state = v1Workspace() as WorkspaceState;
  const result = saveWorkspace(state, [], [], { storage, now: NOW });
  assert.equal(result.ok, false);
  assert.ok(result.message);
});

test("显式重置才写入示例工作区", () => {
  const storage = memoryBackend({
    [WORKSPACE_STORAGE_KEY]: "{ corrupt",
  });
  const sample = resetToSample(makeSample, storage);
  assert.equal(sample.trials[0].id, SAMPLE_MARKER);
  const stored = JSON.parse(storage.getItem(WORKSPACE_STORAGE_KEY) as string);
  assert.equal(stored.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.equal(stored.state.trials[0].id, SAMPLE_MARKER);
});

test("人工处理状态在保存后重新加载时保留（含已忽略问题）", () => {
  const state = {
    trials: [{ id: "t1" }],
    accessions: [],
    benches: [],
    observationPasses: [],
    flags: [
      {
        id: "f1",
        trialId: "t1",
        accessionId: "ghost",
        observationPassId: "p1",
      },
    ],
    clearanceSnapshots: [],
  } as unknown as WorkspaceState;

  // 第一次加载：发现悬空问题
  const first = loadWorkspace({
    storage: memoryBackend({
      [WORKSPACE_STORAGE_KEY]: JSON.stringify({
        schemaVersion: CURRENT_SCHEMA_VERSION,
        state,
      }),
    }),
    now: NOW,
    createSample: makeSample,
  });
  assert.equal(first.kind, "ready");
  if (first.kind !== "ready") throw new Error("expected ready");
  assert.ok(first.issues.some((i) => i.field === "accessionId" && i.status === "open"));

  // 用户选择“保留并知悉”
  const keptIssues = first.issues.map((i) =>
    i.field === "accessionId"
      ? { ...i, status: "ignored" as const, resolvedAt: NOW, resolutionNote: "人工保留" }
      : i,
  );
  const backend = memoryBackend();
  const save = saveWorkspace(state, keptIssues, [], { storage: backend, now: NOW });
  assert.equal(save.ok, true);

  // 重新加载：悬空事实仍在，但问题应保留为 ignored
  const second = loadWorkspace({ storage: backend, now: NOW, createSample: makeSample });
  assert.equal(second.kind, "ready");
  if (second.kind !== "ready") throw new Error("expected ready");
  const issue = second.issues.find((i) => i.field === "accessionId");
  assert.ok(issue);
  assert.equal(issue!.status, "ignored");
  assert.equal(issue!.resolutionNote, "人工保留");
});

test("迁移历史在升级后保存、再次加载时被保留", () => {
  const rawV1 = JSON.stringify({ version: 1, savedAt: NOW, state: v1Workspace() });
  const storage = memoryBackend({ [WORKSPACE_STORAGE_KEY]: rawV1 });
  const first = loadWorkspace({ storage, now: NOW, createSample: makeSample });
  assert.equal(first.kind, "ready");
  if (first.kind !== "ready") throw new Error("expected ready");
  assert.equal(first.history.length, 1);
  assert.equal(first.history[0].fromVersion, 1);
  assert.equal(first.history[0].toVersion, CURRENT_SCHEMA_VERSION);

  // 再次加载（当前版本）：历史应仍从信封读出
  const second = loadWorkspace({ storage, now: NOW, createSample: makeSample });
  assert.equal(second.kind, "ready");
  if (second.kind !== "ready") throw new Error("expected ready");
  assert.equal(second.history.length, 1);
});
