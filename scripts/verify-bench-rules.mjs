// 台架台账领域规则的快速校验（不依赖浏览器）。
// 运行：node scripts/verify-bench-rules.mjs
import { rolldown } from "rolldown";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const ENTRY = `
export * from "${root}/src/domain/bench.ts";
export { normalizeWorkspaceState } from "${root}/src/state/migration.ts";
export { buildClearanceSnapshot } from "${root}/src/domain/clearance.ts";
export { createSampleWorkspaceState } from "${root}/src/state/sampleData.ts";
export {
  WORKSPACE_STORAGE_KEY,
  loadWorkspaceState,
  saveWorkspaceState,
} from "${root}/src/state/persistence.ts";
`;

const bundle = await rolldown({
  input: "entry",
  plugins: [
    {
      name: "virtual-entry",
      resolveId(id) {
        return id === "entry" ? "\0entry" : null;
      },
      load(id) {
        return id === "\0entry" ? ENTRY : null;
      },
    },
  ],
});
const generated = await bundle.generate({ format: "esm" });
await bundle.close();
const code = generated.output[0].code;
const dataUrl =
  "data:text/javascript;base64," + Buffer.from(code, "utf8").toString("base64");
const mod = await import(dataUrl);

let passed = 0;
const failures = [];

function check(name, condition, detail = "") {
  if (condition) {
    passed += 1;
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
  }
}

const baseState = mod.createSampleWorkspaceState();

// 1. 创建台架：正常 / 重复编号 / 无效容量 / 缺字段
const created = mod.createBench(
  {
    code: "E-9",
    sector: "东翼",
    capacity: 6,
    lightProfile: "full-sun",
    irrigationLine: "IR-1",
    status: "available",
    statusNote: "",
  },
  baseState,
);
check("创建台架成功", created.ok);
const stateWithNew = { ...baseState, benches: [...baseState.benches, created.value] };

const dup = mod.createBench(
  {
    code: "e-9",
    sector: "东翼",
    capacity: 6,
    lightProfile: "full-sun",
    irrigationLine: "IR-1",
    status: "available",
    statusNote: "",
  },
  stateWithNew,
);
check("重复编号（大小写不敏感）被拒绝", !dup.ok && dup.errors[0].code === "duplicate");

const badCapacity = mod.createBench(
  {
    code: "E-10",
    sector: "东翼",
    capacity: 0,
    lightProfile: "full-sun",
    irrigationLine: "IR-1",
    status: "available",
    statusNote: "",
  },
  stateWithNew,
);
check("容量 0 被拒绝", !badCapacity.ok);

const decimalCapacity = mod.createBench(
  {
    code: "E-12",
    sector: "东翼",
    capacity: 2.5,
    lightProfile: "full-sun",
    irrigationLine: "IR-1",
    status: "available",
    statusNote: "",
  },
  stateWithNew,
);
check("非整数容量被拒绝", !decimalCapacity.ok);

const missingReason = mod.createBench(
  {
    code: "E-11",
    sector: "东翼",
    capacity: 4,
    lightProfile: "full-sun",
    irrigationLine: "IR-1",
    status: "quarantine",
    statusNote: "",
  },
  stateWithNew,
);
check("新建隔离台架缺原因被拒绝", !missingReason.ok);

const badCode = mod.createBench(
  {
    code: "EAST",
    sector: "东翼",
    capacity: 4,
    lightProfile: "full-sun",
    irrigationLine: "IR-1",
    status: "available",
    statusNote: "",
  },
  stateWithNew,
);
check("非法编号格式被拒绝", !badCode.ok && badCode.errors.some((e) => e.field === "code"));

// 2. 容量不能压到低于真实占用：E-1 占用 2
const east1 = baseState.benches.find((b) => b.code === "E-1");
const shrink = mod.updateBench(
  east1,
  {
    code: east1.code,
    sector: east1.sector,
    capacity: 1,
    lightProfile: east1.lightProfile,
    irrigationLine: east1.irrigationLine,
    status: "available",
    statusNote: "",
  },
  baseState,
);
check("容量低于真实占用被拒绝", !shrink.ok && shrink.errors.some((e) => e.code === "below_occupancy"));

const keepCapacity = mod.updateBench(
  east1,
  {
    code: east1.code,
    sector: east1.sector,
    capacity: 2,
    lightProfile: east1.lightProfile,
    irrigationLine: east1.irrigationLine,
    status: "available",
    statusNote: "",
  },
  baseState,
);
check("容量等于真实占用允许", keepCapacity.ok);

// 3. 修改光照：有材料时避免冲突（同一套兼容性矩阵）
const toShade = mod.updateBenchLight(east1, "shade", baseState);
check("光照改成与台上材料冲突被拒绝", !toShade.ok && toShade.errors[0].code === "light_conflict");
const toPartial = mod.updateBenchLight(east1, "partial-shade", baseState);
check("半阴对全日照材料仍算冲突", !toPartial.ok);
check("冲突错误点出材料名称", toShade.errors[0].message.includes("Tiny Tim"));

const west1 = baseState.benches.find((b) => b.code === "W-1");
// shade 台架比 partial-shade 更严格：partial-shade 材料不能放进 shade 台架
const westToShade = mod.updateBenchLight(west1, "shade", baseState);
check("收紧光照与台上 partial-shade 材料冲突时被拒绝", !westToShade.ok);
// 反方向放宽：shade 台架改 partial-shade 时，shade 偏好材料仍然兼容
const north1 = baseState.benches.find((b) => b.code === "N-1");
const northToPartial = mod.updateBenchLight(north1, "partial-shade", baseState);
check("空台架放宽光照允许", northToPartial.ok);

const east2 = baseState.benches.find((b) => b.code === "E-2");
check("空台架改光照允许", mod.updateBenchLight(east2, "shade", baseState).ok);
check("相同光照无操作返回原值", mod.updateBenchLight(east2, east2.lightProfile, baseState).value === east2);

// 4. 已占用台架状态变化
const block = mod.changeBenchStatus(east1, "blocked", "维修滴灌", baseState);
check("占用台架可受限（记录原因）", block.ok && block.value.statusNote === "维修滴灌");
check("受限不影响已分配材料", block.ok && block.value.assignedIds.length === 2);
check("受限写入维护记录", block.ok && block.value.statusHistory.length === 1);

const blockNoReason = mod.changeBenchStatus(east1, "blocked", "  ", baseState);
check("受限缺原因被拒绝", !blockNoReason.ok);

const tom3 = baseState.accessions.find((a) => a.id === "acc-tom-03");
const assignBlocked = mod.assignAccession(tom3, block.value);
check("受限台架拒绝新分配", !assignBlocked.ok);

const toQuarantine = mod.changeBenchStatus(block.value, "quarantine", "疑似虫害", baseState);
check("受限转隔离需要原因且通过", toQuarantine.ok && toQuarantine.value.status === "quarantine");
check("维护记录逐条累加", toQuarantine.ok && toQuarantine.value.statusHistory.length === 2);

// 5. 恢复台架重新校验现场适配
const restore = mod.changeBenchStatus(block.value, "available", "维修完成", baseState);
check("恢复可用通过且占用态为 assigned", restore.ok && restore.value.status === "assigned");
check("恢复后清空原因", restore.ok && restore.value.statusNote === undefined);

const conflicting = {
  ...east1,
  status: "quarantine",
  statusNote: "隔离",
  lightProfile: "shade",
};
const restoreConflict = mod.changeBenchStatus(conflicting, "available", "", baseState);
check("光照冲突时恢复被拒绝", !restoreConflict.ok && restoreConflict.errors.some((e) => e.code === "light_conflict"));

const overCapacity = { ...east1, status: "blocked", statusNote: "维修", capacity: 1 };
const restoreOver = mod.changeBenchStatus(overCapacity, "available", "", baseState);
check("超容量占用时恢复被拒绝", !restoreOver.ok && restoreOver.errors.some((e) => e.code === "below_occupancy"));

const stateMissing = {
  ...baseState,
  accessions: baseState.accessions.filter((a) => a.id !== "acc-tom-01"),
};
const dangling = { ...east1, status: "blocked", statusNote: "维修" };
const restoreDangling = mod.changeBenchStatus(dangling, "available", "", stateMissing);
check("材料缺失（悬空分配）时恢复被拒绝", !restoreDangling.ok && restoreDangling.errors.some((e) => e.code === "missing_accession"));

const north2 = baseState.benches.find((b) => b.code === "N-2");
check("空受限台架可直接恢复", mod.changeBenchStatus(north2, "available", "维修完成", baseState).ok);
check(
  "空台架恢复后状态为 available",
  mod.changeBenchStatus(north2, "available", "维修完成", baseState).value.status === "available",
);

// 6. 移出材料不应把受限/隔离台架悄悄恢复
const releasedFromBlocked = mod.releaseAccession("acc-tom-01", block.value);
const releaseSecond = mod.releaseAccession("acc-tom-02", releasedFromBlocked.value);
check("清空受限台架后仍保持受限", releaseSecond.value.status === "blocked");
const releasedAvail = mod.releaseAccession("acc-bee-01", west1);
const releasedAvail2 = mod.releaseAccession("acc-bee-02", releasedAvail.value);
check("清空正常台架恢复 available", releasedAvail2.value.status === "available");

// 7. 旧数据兼容
const legacyState = {
  ...baseState,
  benches: [
    {
      id: "legacy-1",
      code: "L-1",
      sector: "旧翼",
      capacity: 3,
      assignedIds: ["x", "x", 42],
      lightProfile: "weird",
      irrigationLine: "IR-9",
      status: "strange",
      blockedReason: "老原因",
    },
  ],
};
const migrated = mod.normalizeWorkspaceState(legacyState);
check("非法状态归位 available 后清空原因", migrated.benches[0].status === "available" && migrated.benches[0].statusNote === undefined);
const legacyBlocked = mod.normalizeWorkspaceState({
  ...baseState,
  benches: [
    {
      id: "legacy-2",
      code: "L-2",
      sector: "旧翼",
      capacity: 3,
      assignedIds: ["x"],
      lightProfile: "shade",
      irrigationLine: "IR-9",
      status: "blocked",
      blockedReason: "老原因",
    },
  ],
});
check("受限旧台架保留迁移后的原因", legacyBlocked.benches[0].statusNote === "老原因");
check("非法光照回退 full-sun", migrated.benches[0].lightProfile === "full-sun");
check("assignedIds 去重并过滤非字符串", JSON.stringify(migrated.benches[0].assignedIds) === '["x"]');
check("损坏容量回退 1", mod.normalizeWorkspaceState({ ...baseState, benches: [{ ...migrated.benches[0], capacity: -5 }] }).benches[0].capacity === 1);
check("示例数据规范化是幂等的", JSON.stringify(mod.normalizeWorkspaceState(baseState)) === JSON.stringify(baseState));

// 8. 放行页面可见受限/隔离台架（同一规则源），且消息带原因
const snapBlocked = mod.buildClearanceSnapshot(
  {
    ...baseState,
    benches: [
      ...baseState.benches,
      {
        id: "extra-blocked",
        code: "X-9",
        sector: "南翼",
        capacity: 2,
        assignedIds: [],
        lightProfile: "full-sun",
        irrigationLine: "IR-5",
        status: "blocked",
        statusNote: "管路爆裂",
      },
    ],
  },
  "trial-sol-01",
);
const blocker = snapBlocked.blockers.find((b) => b.benchId === "extra-blocked");
check("放行快照包含新增受限台架的阻止项", Boolean(blocker));
check("阻止项带出台架原因", blocker?.message.includes("管路爆裂"));
const quarantineSnap = mod.buildClearanceSnapshot(
  {
    ...baseState,
    benches: [
      ...baseState.benches,
      {
        id: "extra-quarantine",
        code: "Q-1",
        sector: "南翼",
        capacity: 2,
        assignedIds: [],
        lightProfile: "full-sun",
        irrigationLine: "IR-6",
        status: "quarantine",
        statusNote: "疑似虫害",
      },
    ],
  },
  "trial-sol-01",
);
check(
  "隔离台架产生 BENCH_QUARANTINE 阻止项",
  quarantineSnap.blockers.some(
    (b) => b.code === "BENCH_QUARANTINE" && b.message.includes("疑似虫害"),
  ),
);

// 9. 编辑台账不能偷改运维状态
const updated = mod.updateBench(
  { ...east1, status: "quarantine", statusNote: "隔离中" },
  {
    code: east1.code,
    sector: "新翼",
    capacity: 4,
    lightProfile: east1.lightProfile,
    irrigationLine: "IR-2",
    status: "available",
    statusNote: "",
  },
  baseState,
);
check("编辑台账不改变隔离状态", updated.ok && updated.value.status === "quarantine" && updated.value.statusNote === "隔离中");

// 10. 相同状态切换被拒绝
check(
  "重复状态切换被拒绝",
  !mod.changeBenchStatus({ ...east1, status: "blocked", statusNote: "x" }, "blocked", "x", baseState).ok,
);

// 11. 同一份持久化工作区：保存 / 读取往返，并对旧存储做迁移
function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

const storage = memoryStorage();
globalThis.window = { localStorage: storage };
const roundtrip = mod.createBench(
  {
    code: "S-1",
    sector: "南翼",
    capacity: 3,
    lightProfile: "shade",
    irrigationLine: "IR-7",
    status: "quarantine",
    statusNote: "新隔离",
  },
  baseState,
);
const savedState = { ...baseState, benches: [...baseState.benches, roundtrip.value] };
mod.saveWorkspaceState(savedState);
const loaded = mod.loadWorkspaceState();
const loadedBench = loaded.benches.find((b) => b.code === "S-1");
check("新台架持久化后可读回", Boolean(loadedBench) && loadedBench.status === "quarantine");
check("原因随持久化保留", loadedBench?.statusNote === "新隔离");
check("维护记录随持久化保留", loadedBench?.statusHistory?.length === 1);
check("存储使用统一命名空间", storage.getItem(mod.WORKSPACE_STORAGE_KEY) !== null);

// 模拟 v1 旧格式（只有 blockedReason，没有 statusNote / statusHistory）
storage.setItem(
  mod.WORKSPACE_STORAGE_KEY,
  JSON.stringify({
    version: 1,
    savedAt: new Date().toISOString(),
    state: {
      ...baseState,
      benches: [
        {
          id: "old-1",
          code: "O-1",
          sector: "旧翼",
          capacity: 4,
          assignedIds: [],
          lightProfile: "full-sun",
          irrigationLine: "IR-0",
          status: "blocked",
          blockedReason: "旧版原因",
        },
      ],
    },
  }),
);
const migratedLoad = mod.loadWorkspaceState();
const oldBench = migratedLoad.benches.find((b) => b.code === "O-1");
check("旧版存储可加载并迁移原因", oldBench?.statusNote === "旧版原因");

// 损坏存储回退示例工作区
storage.setItem(mod.WORKSPACE_STORAGE_KEY, "{not-json");
check("损坏存储回退到示例数据", mod.loadWorkspaceState().benches.length === baseState.benches.length);

console.log(`通过 ${passed} 项检查`);
if (failures.length > 0) {
  console.error("失败：");
  failures.forEach((f) => console.error(` - ${f}`));
  process.exit(1);
}
console.log("✅ 台架台账领域规则全部通过");
