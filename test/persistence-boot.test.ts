import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  REPAIR_ARCHIVE_STORAGE_KEY,
  WORKSPACE_STORAGE_KEY,
  bootWorkspace,
  discardQuarantineEntry,
  emptyWorkspaceState,
  loadRepairArchive,
  makeQuarantineEntry,
  persistenceFindings,
  saveActiveRepair,
  saveWorkspaceState,
  type QuarantineEntry,
  type StorageLike,
} from "../src/state/persistence";
import { createSampleWorkspaceState } from "../src/state/sampleData";
import { createRepairJournal } from "../src/domain/quality";
import { makeState } from "./fixtures";

class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }
}

describe("bootWorkspace — 持久化版本与损坏隔离", () => {
  it("无存储时进入示例工作区，且没有质量问题", () => {
    const boot = bootWorkspace(new MemoryStorage());
    assert.equal(boot.kind, "sample");
    assert.equal(boot.state.trials.length, createSampleWorkspaceState().trials.length);
    assert.deepEqual(boot.findings, []);
  });

  it("损坏的 JSON 被隔离：空工作区启动、原始内容完整保留、绝不回退示例数据", () => {
    const storage = new MemoryStorage();
    const corrupt = "{ not valid json";
    storage.setItem(WORKSPACE_STORAGE_KEY, corrupt);

    const boot = bootWorkspace(storage);
    assert.equal(boot.kind, "empty");
    assert.deepEqual(boot.state, emptyWorkspaceState());
    assert.equal(boot.quarantine.length, 1);
    assert.equal(boot.quarantine[0].raw, corrupt, "原始字节必须原样进入隔离区");
    assert.equal(boot.quarantine[0].reason, "parse-error");
    assert.equal(boot.findings[0].ruleCode, "P-QUARANTINE-01");
    assert.equal(boot.findings[0].severity, "blocking");

    // 损坏内容没有被覆盖
    assert.equal(storage.getItem(WORKSPACE_STORAGE_KEY), corrupt);
  });

  it("结构不符（缺集合）被隔离，而不是静默替换为示例数据", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({ version: 1, savedAt: new Date().toISOString(), state: { trials: [] } }),
    );
    const boot = bootWorkspace(storage);
    assert.equal(boot.kind, "empty");
    assert.equal(boot.quarantine[0].reason, "schema-mismatch");
  });

  it("未知持久化版本被隔离并记录版本号证据", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      WORKSPACE_STORAGE_KEY,
      JSON.stringify({ version: 99, state: makeState() }),
    );
    const boot = bootWorkspace(storage);
    assert.equal(boot.kind, "empty");
    assert.equal(boot.quarantine[0].reason, "version-unknown");
    assert.equal(boot.quarantine[0].envelopeVersion, 99);
    assert.ok(boot.findings[0].evidence.some((item) => item.value === "99"));
  });

  it("隔离记录在下次引导时仍然存在（跨会话可追溯），直到人工显式清除", () => {
    const storage = new MemoryStorage();
    const corrupt = "@@@";
    storage.setItem(WORKSPACE_STORAGE_KEY, corrupt);
    const first = bootWorkspace(storage);
    assert.equal(first.quarantine.length, 1);

    const second = bootWorkspace(storage);
    assert.equal(second.quarantine.length, 1, "同一损坏内容不得重复隔离");
    assert.equal(second.kind, "empty");

    discardQuarantineEntry(storage, first.quarantine[0].id);
    // 仅清除隔离记录：损坏的工作区键仍在，再次引导会重新隔离（安全默认）。
    const reboots = bootWorkspace(storage);
    assert.equal(reboots.quarantine.length, 1);

    // 人工恢复：清除损坏的工作区键后，引导回到干净的示例工作区。
    storage.removeItem(WORKSPACE_STORAGE_KEY);
    discardQuarantineEntry(storage, reboots.quarantine[0].id);
    const clean = bootWorkspace(storage);
    assert.equal(clean.quarantine.length, 0);
    assert.equal(clean.findings.length, 0);
    assert.equal(clean.kind, "sample");
  });

  it("缺少 savedAt 的封装给出 info 提示，数据本身正常加载", () => {
    const storage = new MemoryStorage();
    saveWorkspaceState(makeState(), storage);
    const raw = JSON.parse(storage.getItem(WORKSPACE_STORAGE_KEY) as string);
    delete raw.savedAt;
    storage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(raw));

    const boot = bootWorkspace(storage);
    assert.equal(boot.kind, "loaded");
    assert.ok(boot.findings.some((item) => item.ruleCode === "P-ENVELOPE-01"));
    assert.equal(boot.state.trials.length, 1);
  });

  it("隔离区与有效工作区可以同时存在：隔离问题作为持久化 finding 参与扫描", () => {
    const storage = new MemoryStorage();
    // 先保存一个有效工作区
    saveWorkspaceState(makeState(), storage);
    // 手工追加一条历史隔离记录
    const entry: QuarantineEntry = makeQuarantineEntry(
      "parse-error",
      "历史损坏",
      "old-raw",
    );
    storage.setItem(
      "glasshouse-trial-bench:quarantine:v1",
      JSON.stringify([entry]),
    );

    const boot = bootWorkspace(storage);
    assert.equal(boot.kind, "loaded");
    assert.equal(boot.quarantine.length, 1);
    assert.equal(
      boot.findings.some((item) => item.ruleCode === "P-QUARANTINE-01"),
      true,
    );
  });
});

describe("修复会话归档", () => {
  it("活动会话跨存储往返保持完整，可用于中断恢复", () => {
    const storage = new MemoryStorage();
    const state = makeState();
    const journal = createRepairJournal({
      stateBefore: state,
      plans: [],
      now: "2026-03-01T00:00:00.000Z",
    });
    saveActiveRepair(storage, journal);

    const archive = loadRepairArchive(storage);
    assert.ok(archive.active);
    assert.equal(archive.active?.id, journal.id);
    assert.equal(archive.active?.status, "in_progress");
    assert.deepEqual(archive.active?.stateBefore, state);
    assert.equal(storage.getItem(REPAIR_ARCHIVE_STORAGE_KEY) !== null, true);
  });

  it("归档 JSON 损坏时安全降级为空归档，不影响工作区引导", () => {
    const storage = new MemoryStorage();
    storage.setItem(REPAIR_ARCHIVE_STORAGE_KEY, "not-json");
    const archive = loadRepairArchive(storage);
    assert.equal(archive.active, null);
    assert.deepEqual(archive.history, []);
    const boot = bootWorkspace(storage);
    assert.equal(boot.kind, "sample");
  });

  it("归档中结构不符的活动会话被忽略，避免损坏恢复数据导致页面崩溃", () => {
    const storage = new MemoryStorage();
    storage.setItem(
      REPAIR_ARCHIVE_STORAGE_KEY,
      JSON.stringify({
        active: { id: "bad", status: "in_progress" },
        history: [{ id: "bad2", status: "completed" }],
      }),
    );
    const archive = loadRepairArchive(storage);
    assert.equal(archive.active, null);
    assert.deepEqual(archive.history, []);
  });
});

describe("persistenceFindings", () => {
  it("隔离区清空后阻断 finding 消解", () => {
    const entry = makeQuarantineEntry("parse-error", "x", "raw");
    assert.equal(persistenceFindings([entry]).length, 1);
    assert.deepEqual(persistenceFindings([]), []);
  });
});
