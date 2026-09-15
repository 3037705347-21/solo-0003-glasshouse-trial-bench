import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fingerprintState } from "../src/domain/quality";
import {
  saveWorkspaceState,
  loadWorkspaceEnvelope,
} from "../src/state/persistence";
import type { WorkspaceState } from "../src/domain/types";
import { makeBench, makeState } from "./fixtures";
import { MemoryStorage } from "./memoryStorage";

/**
 * 用与 store 相同的指纹守卫逻辑模拟跨标签页同步，
 * 验证远端更新只会被读取一次，不会被本地再次写回（反复写回）。
 */
class WriteCountingStorage extends MemoryStorage {
  workspaceWrites = 0;
  setItem(key: string, value: string): void {
    if (key === "glasshouse-trial-bench:workspace:v1") {
      this.workspaceWrites += 1;
    }
    super.setItem(key, value);
  }
}

function stateWithCode(code: string): WorkspaceState {
  return makeState({
    accessions: [],
    benches: [makeBench({ code, assignedIds: [] })],
  });
}

describe("跨标签页同步不形成反复写回", () => {
  it("远端 hydrate 后自动保存跳过相同指纹，不会写回第二份副本", () => {
    const storage = new WriteCountingStorage();
    const local = stateWithCode("LOCAL");
    saveWorkspaceState(local, storage);
    const writesAfterLocalSave = storage.workspaceWrites;

    // store 中的守卫：hydrateFromStorage 更新已持久化指纹，自动保存前比对
    let persistedFingerprint = fingerprintState(local);
    let dirty = false;

    // 另一窗口写入新状态
    const remote = stateWithCode("REMOTE");
    saveWorkspaceState(remote, storage);
    const writesAfterRemote = storage.workspaceWrites;
    assert.ok(writesAfterRemote > writesAfterLocalSave);

    // 本窗口收到 storage 事件并 hydrate（不标记 dirty）
    const incoming = loadWorkspaceEnvelope(storage)!.state;
    persistedFingerprint = fingerprintState(incoming);
    dirty = false;

    // 模拟自动保存 effect：无 dirty 不写入；即使错误标记 dirty，指纹相同也跳过
    if (dirty && fingerprintState(incoming) !== persistedFingerprint) {
      saveWorkspaceState(incoming, storage);
    }
    dirty = true; // 防御路径
    if (fingerprintState(incoming) !== persistedFingerprint) {
      saveWorkspaceState(incoming, storage);
    }
    assert.equal(
      storage.workspaceWrites,
      writesAfterRemote,
      "远端同步后不得再把相同内容写回",
    );

    // 本地随后发生真实编辑（指纹变化）才允许写入
    const edited = stateWithCode("LOCAL-EDIT");
    dirty = true;
    if (fingerprintState(edited) !== persistedFingerprint) {
      saveWorkspaceState(edited, storage);
      persistedFingerprint = fingerprintState(edited);
      dirty = false;
    }
    assert.ok(storage.workspaceWrites > writesAfterRemote);
    assert.equal(loadWorkspaceEnvelope(storage)!.state.benches[0].code, "LOCAL-EDIT");
  });

  it("指纹对相同内容稳定、对不同内容敏感", () => {
    const a = stateWithCode("X");
    const aCopy = structuredClone(a);
    const b = stateWithCode("Y");
    assert.equal(fingerprintState(a), fingerprintState(aCopy));
    assert.notEqual(fingerprintState(a), fingerprintState(b));
  });
});
