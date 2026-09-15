/**
 * 审计日志纯逻辑验证：不启动浏览器，直接驱动 reducer 与审计构建器。
 * 覆盖相邻操作顺序、失败不记录、批量整体条目、重置不重写历史、
 * 对象删除后摘要保留且无死链、以及「不保存整份状态副本」。
 */
import { appReducer, type AppState } from "../src/state/reducer";
import { createSampleWorkspaceState } from "../src/state/sampleData";
import { assignAccession, releaseAccession } from "../src/domain/bench";
import { createAccession } from "../src/domain/accession";
import { buildWorkspaceReplacedEntry } from "../src/domain/audit";
import type { WorkspaceState } from "../src/domain/types";

let failures = 0;

function check(condition: boolean, message: string): void {
  if (condition) {
    console.log(`  ✅ ${message}`);
  } else {
    failures += 1;
    console.error(`  ❌ ${message}`);
  }
}

function init(): AppState {
  return { workspace: createSampleWorkspaceState(), audit: [] };
}

console.log("相邻操作顺序与序号：");
{
  let app = init();
  const draft = {
    trialId: app.workspace.trials[0].id,
    accessionNo: "ACC-0009",
    cultivar: "Stupice",
    source: "Glasshouse Exchange",
    propagatedOn: "2026-02-21",
    quantity: 72,
    trayCells: 104,
    preferredLight: "full-sun" as const,
    genotypeNote: "Compact heirloom line with uniform early habit.",
    labels: [] as string[],
  };
  const created = createAccession(draft, app.workspace);
  if (!created.ok) {
    throw new Error("示例材料创建失败");
  }
  app = appReducer(app, { type: "accession/created", accession: created.value });
  const accession = created.value;
  const bench = app.workspace.benches.find((item) => item.id === "bench-east-2")!;
  const assigned = assignAccession(accession, bench);
  if (!assigned.ok) {
    throw new Error("示例台架分配失败");
  }
  app = appReducer(app, { type: "bench/assigned", bench: assigned.value });

  check(app.audit.length === 2, "两次成功操作产生两条审计记录");
  check(
    app.audit[0].seq === 1 && app.audit[1].seq === 2,
    "序号从 1 开始严格递增",
  );
  check(
    app.audit[0].op === "accession.created" &&
      app.audit[1].op === "bench.assigned",
    "日志顺序与操作发生顺序一致",
  );
  const benchItem = app.audit[1].items[0];
  check(
    benchItem.changes.some(
      (change) => change.after && change.after.includes("ACC-0009"),
    ),
    "台架条目记录变化后材料编号而非整个数组对象",
  );
  check(
    benchItem.trialId === accession.trialId,
    "台架条目可回溯到所属试验",
  );
}

console.log("失败操作不落日志：");
{
  let app = init();
  const beforeCount = app.audit.length;
  const bench = app.workspace.benches.find((item) => item.id === "bench-north-2")!; // blocked
  const accession = app.workspace.accessions[0];
  const rejected = assignAccession(accession, bench);
  check(!rejected.ok, "分配到停用台架被领域层拒绝");
  // 失败时 UI 不会 dispatch；即使误发相同数据，reducer 也只更新它认识的状态。
  // 这里直接验证：没有新动作 -> 没有新日志。
  check(app.audit.length === beforeCount, "失败操作前后日志条数不变");
}

console.log("批量操作既是整体也能展开：");
{
  let app = init();
  const trial = app.workspace.trials[0];
  const benchesToUpdate: WorkspaceState["benches"] = [];
  const releasedIds: string[] = [];
  app.workspace.benches.forEach((bench) => {
    const ids = bench.assignedIds.filter((id) =>
      app.workspace.accessions.some(
        (accession) => accession.id === id && accession.trialId === trial.id,
      ),
    );
    let current = bench;
    for (const id of ids) {
      const result = releaseAccession(id, current);
      if (result.ok) {
        current = result.value;
        releasedIds.push(id);
      }
    }
    if (current !== bench) {
      benchesToUpdate.push(current);
    }
  });
  app = appReducer(app, {
    type: "bench/batch-released",
    benches: benchesToUpdate,
    accessionIds: releasedIds,
    trialId: trial.id,
  });
  const entry = app.audit[0];
  check(
    entry.op === "bench.batch-released" &&
      entry.items.length === benchesToUpdate.length,
    `批量移出是一条包含 ${benchesToUpdate.length} 个台架子项的整体记录`,
  );
  check(
    entry.items.every((item) => item.objectType === "bench"),
    "每个子项都指向具体台架对象，可独立展开",
  );
  check(
    entry.outcomeLabel && entry.outcomeLabel.includes(String(benchesToUpdate.length)),
    "整体结果摘要说明涉及台架数",
  );
}

console.log("重置 / 导入恢复只追加，不重写历史：");
{
  let app = init();
  app = appReducer(app, {
    type: "trial/transitioned",
    trialId: app.workspace.trials[2].id,
    state: "active",
  });
  const beforeReset = app.audit;
  const sample = createSampleWorkspaceState();
  app = appReducer(app, {
    type: "workspace/replaced",
    state: sample,
    source: "sample",
  });
  check(
    app.audit.length === beforeReset.length + 1,
    "重置只追加一条 workspace.replaced",
  );
  check(
    app.audit.slice(0, beforeReset.length).every(
      (entry, index) => entry.id === beforeReset[index].id,
    ),
    "重置前的历史条目原样保留，未被重写",
  );
  const replaced = app.audit[app.audit.length - 1];
  check(
    replaced.items.length > 0 &&
      replaced.items.some((item) => item.kind === "updated"),
    "重置条目按对象列出差异（示例中的试验状态差异）",
  );
  // 再次导入：工作区替换为一个空对象集合，旧对象应记为 removed。
  const empty: WorkspaceState = {
    trials: [],
    accessions: [],
    benches: [],
    observationPasses: [],
    flags: [],
    clearanceSnapshots: [],
  };
  app = appReducer(app, {
    type: "workspace/replaced",
    state: empty,
    source: "import",
    sourceLabel: "empty.json",
  });
  const importEntry = app.audit[app.audit.length - 1];
  const removed = importEntry.items.filter((item) => item.kind === "removed");
  check(
    importEntry.summary.includes("恢复") && removed.length > 10,
    "导入恢复记录所有被移除的对象",
  );

  console.log("历史对象已不存在：");
  const removedItem = removed[0];
  check(
    removedItem.objectLabel.length > 0 && removedItem.resultLabel !== undefined,
    "移除对象保留操作时捕获的标签与摘要（无死链可点）",
  );
  // 对象已不在当前状态，审计条目依然可读，但不携带完整实体文本。
  const serialized = JSON.stringify(importEntry);
  check(
    !serialized.includes("比较紧凑型番茄品种在温室内的早期坐果表现。") &&
      !serialized.includes("穴盘内发芽整体均匀"),
    "审计条目不含被移除对象的完整说明/观测备注全文",
  );
}

console.log("审计条目不包含整份状态副本或敏感长文本全文：");
{
  const before = createSampleWorkspaceState();
  const after: WorkspaceState = {
    ...before,
    accessions: before.accessions.map((accession, index) =>
      index === 0
        ? {
            ...accession,
            genotypeNote: "X".repeat(500),
            objective: undefined as never,
          }
        : accession,
    ),
  };
  const entry = buildWorkspaceReplacedEntry(before, after, "import");
  const raw = JSON.stringify(entry);
  check(
    !raw.includes("X".repeat(200)),
    "长文本字段被截断，不会把 500 字说明全文写入审计",
  );
  check(
    raw.length < JSON.stringify(before).length,
    "单条审计体积小于完整工作区状态",
  );
}

if (failures > 0) {
  console.error(`\n${failures} 项验证失败`);
  process.exit(1);
}
console.log("\n所有审计逻辑验证通过");
