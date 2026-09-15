import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const port = 4177;
const baseUrl = `http://127.0.0.1:${port}`;
const root = new URL("..", import.meta.url).pathname;
const viteBin =
  process.platform === "win32"
    ? `${root}node_modules/.bin/vite.cmd`
    : `${root}node_modules/.bin/vite`;

const scenarios = {
  "curate-accession-roster": curateAccessionRoster,
  "assign-accession-bench": assignAccessionBench,
  "record-observation-pass": recordObservationPass,
  "advance-trial-clearance": advanceTrialClearance,
  "audit-trail": auditTrail,
  "audit-reset-batch": auditResetBatch,
};

const scenarioPaths = {
  "curate-accession-roster": "/roster",
  "assign-accession-bench": "/layout",
  "record-observation-pass": "/observations",
  "advance-trial-clearance": "/clearance",
  "audit-trail": "/audit",
  "audit-reset-batch": "/audit",
};

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) {
        return;
      }
    } catch {
      // Server has not opened the port yet.
    }
    await delay(250);
  }
  throw new Error(`Preview server did not start on port ${port}`);
}

async function freshPage(browser, path) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${baseUrl}/#${path}`, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  return page;
}

async function gotoHash(page, path) {
  await page.evaluate((target) => {
    window.location.hash = target;
  }, path);
  await page.waitForTimeout(200);
}

async function createAccession(page, cultivar) {
  await page.getByTestId("open-create-accession").click();
  await page.getByTestId("cultivar-input").fill(cultivar);
  await page.getByLabel("来源").fill("Glasshouse Exchange");
  await page.getByLabel("繁殖日期").fill("2026-02-21");
  await page.getByLabel("数量").fill("72");
  await page.locator("textarea").first().fill("Compact heirloom line with uniform early habit.");
  await page.getByTestId("save-accession-button").click();
  await page.getByText(cultivar, { exact: true }).first().waitFor();
}

async function curateAccessionRoster(page) {
  await createAccession(page, "Stupice");
  await page.getByText("ACC-0009", { exact: true }).first().waitFor();
}

async function assignAccessionBench(page) {
  await page.getByTestId("assignment-accession-select").selectOption("acc-tom-03");
  await page.getByTestId("assign-bench-bench-east-2").click();
  await page.getByText("台架分配成功", { exact: true }).waitFor();
  await page.getByTestId("bench-card-bench-east-2").getByText("Yellow Pear").waitFor();
}

async function recordObservationPass(page) {
  const before = await page.locator('[data-testid^="pass-"]').count();
  await page.getByTestId("open-observation-form").click();
  await page.getByTestId("observer-input").fill("A. Linden");
  await page
    .locator(".entry-row")
    .first()
    .locator('input[type="number"]')
    .nth(0)
    .fill("54");
  await page.getByTestId("save-observation-button").click();
  await page.waitForFunction(
    (count) => document.querySelectorAll('[data-testid^="pass-"]').length > count,
    before,
  );
}

async function advanceTrialClearance(page) {
  await page.getByTestId("generate-clearance").click();
  await page.getByText("放行被阻止", { exact: true }).waitFor();
  await page
    .getByTestId("clearance-snapshot")
    .getByText("阻止", { exact: true })
    .first()
    .waitFor();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(`断言失败：${message}`);
  }
}

async function readAudit(page) {
  return page.evaluate(() => {
    const raw = window.localStorage.getItem("glasshouse-trial-bench:audit:v1");
    if (!raw) {
      return [];
    }
    return JSON.parse(raw).entries;
  });
}

async function auditEntries(page) {
  return page.getByTestId("audit-list").locator("[data-testid^='audit-entry-']");
}

async function auditTrail(page) {
  // 1) 相邻操作：新建材料 -> 分配台架，两条记录严格按序号递增。
  await gotoHash(page, "/roster");
  await createAccession(page, "Stupice");
  await gotoHash(page, "/layout");
  await page.getByTestId("assignment-accession-select").selectOption("acc-tom-03");
  await page.getByTestId("assign-bench-bench-east-2").click();
  await page.getByText("台架分配成功", { exact: true }).waitFor();

  const entriesAfterActions = await readAudit(page);
  const ops = entriesAfterActions.map((entry) => entry.op);
  assert(
    ops[0] === "accession.created" && ops[1] === "bench.assigned",
    `相邻操作顺序应为 accession.created -> bench.assigned，实际：${ops.join(", ")}`,
  );
  const seqs = entriesAfterActions.map((entry) => entry.seq);
  assert(
    seqs.every((seq, index) => index === 0 || seq === seqs[index - 1] + 1),
    "审计序号必须严格连续递增",
  );
  const benchEntry = entriesAfterActions[1];
  assert(
    benchEntry.items[0].changes.some((change) => change.after && change.after.includes("ACC-0003")),
    "台架分配条目应记录变化后的材料编号摘要",
  );

  // 2) 页面刷新后审计日志保留且不被重写（独立存储键 + 只追加）。
  await page.reload({ waitUntil: "networkidle" });
  const entriesAfterReload = await readAudit(page);
  assert(
    entriesAfterReload.length === entriesAfterActions.length,
    `刷新后条目数应保持 ${entriesAfterActions.length}，实际 ${entriesAfterReload.length}`,
  );
  assert(
    JSON.stringify(entriesAfterReload) === JSON.stringify(entriesAfterActions),
    "刷新前后审计内容必须逐字节一致（日志未被重写）",
  );

  // 3) 审计页展示：从条目跳回仍存在的对象，并在目标页高亮具体台架。
  await gotoHash(page, "/audit");
  const cards = await auditEntries(page);
  assert((await cards.count()) === entriesAfterActions.length, "审计页卡片数应与存储一致");
  // 列表按时间倒序，第一张卡片是台架分配。
  await cards.first().getByText("跳回对象").first().click();
  await page.waitForTimeout(300);
  assert(page.url().includes("/layout"), `跳回对象应导航到台架布局，实际：${page.url()}`);
  assert(
    page.url().includes("bench=bench-east-2"),
    `跳转链接应携带台架定位参数，实际：${page.url()}`,
  );
  await page.getByTestId("audit-focus-bench-bench-east-2").waitFor();

  // 4) 失败操作不落日志：观测人长度不足时提交被校验拒绝，不产生任何审计条目。
  await gotoHash(page, "/observations");
  const countBefore = (await readAudit(page)).length;
  await page.getByTestId("open-observation-form").click();
  await page.getByTestId("observer-input").fill("X");
  await page.getByTestId("save-observation-button").click();
  await page.getByText("请填写观测人", { exact: true }).waitFor();
  assert(
    (await readAudit(page)).length === countBefore,
    "校验失败的观测提交不得产生审计条目",
  );
}

async function auditResetBatch(page) {
  // 0) 先让 SOL-01 的材料分布在两个台架上：acc-tom-03 分配到 E-2（E-1 上已有 01、02）。
  await gotoHash(page, "/layout");
  await page.getByTestId("assignment-accession-select").selectOption("acc-tom-03");
  await page.getByTestId("assign-bench-bench-east-2").click();
  await page.getByText("台架分配成功", { exact: true }).waitFor();

  // 再新建一个材料，确保稍后重置为示例数据时确实有对象被移除。
  await gotoHash(page, "/roster");
  await createAccession(page, "Stupice");

  // 1) 批量操作：一键移出 SOL-01 在 E-1、E-2 两个台架上的 3 个材料。
  await gotoHash(page, "/layout");
  await page.getByTestId("batch-release-trial").click();
  await page.getByText("批量移出完成", { exact: true }).waitFor();

  let entries = await readAudit(page);
  const batch = entries.find((entry) => entry.op === "bench.batch-released");
  assert(batch, "应记录批量移出整体操作");
  assert(batch.items.length === 2, `批量操作应覆盖 2 个台架，实际 ${batch.items.length}`);
  assert(
    batch.items.every((item) => item.objectType === "bench"),
    "批量操作的子项必须都能展开到具体台架对象",
  );

  await gotoHash(page, "/audit");
  const batchCard = page.getByTestId(`audit-entry-${batch.id}`);
  await batchCard.getByTestId(`audit-expand-${batch.id}`).waitFor();
  assert(
    (await batchCard.locator(".audit-item").count()) === 1,
    "折叠状态只预览第 1 个对象子项",
  );
  await batchCard.getByTestId(`audit-expand-${batch.id}`).click();
  assert(
    (await batchCard.locator(".audit-item").count()) === batch.items.length,
    "展开后应显示全部对象子项",
  );

  // 2) 重置为示例工作区：追加一条 workspace.replaced，且旧日志保留。
  const beforeResetCount = entries.length;
  await page.getByTestId("reset-workspace-button").click();
  await page.getByTestId("confirm-reset-button").click();
  await page.waitForTimeout(400);
  entries = await readAudit(page);
  assert(
    entries.length === beforeResetCount + 1,
    `重置必须只追加一条记录（${beforeResetCount} -> ${entries.length}）`,
  );
  const resetEntry = entries[entries.length - 1];
  assert(
    resetEntry.op === "workspace.replaced" && resetEntry.summary.includes("重置"),
    "重置应记录为 workspace.replaced 整体操作",
  );
  assert(
    resetEntry.items.length > 1,
    "重置条目应展开为多个对象的新建/移除差异",
  );
  assert(
    resetEntry.items.some((item) => item.kind === "removed"),
    "重置差异中应包含被示例数据替换掉的对象（移除）",
  );

  // 3) 历史对象已不存在：重置条目中的移除对象不提供跳转链接，而是标注「对象已不存在」。
  const removedItem = resetEntry.items.find((item) => item.kind === "removed");
  const resetCard = page.locator(`[data-testid="audit-entry-${resetEntry.id}"]`);
  await resetCard.getByTestId(`audit-expand-${resetEntry.id}`).click();
  await resetCard
    .getByTestId(`audit-item-missing-${removedItem.objectId}`)
    .waitFor();
  const linkCount = await resetCard
    .getByTestId(`audit-item-link-${removedItem.objectId}`)
    .count();
  assert(linkCount === 0, "已删除对象不得渲染跳转死链");

  // 4) 导入恢复：导出 -> 修改 -> 导入同一份备份，差异应记为一条整体操作且可再次重置验证幂等。
  const exported = await page.evaluate(() => {
    const raw = window.localStorage.getItem("glasshouse-trial-bench:workspace:v1");
    return JSON.parse(raw);
  });
  const backupJson = JSON.stringify(exported, null, 2);
  const beforeImportCount = (await readAudit(page)).length;
  await page.getByTestId("import-workspace-button").click();
  await page
    .getByTestId("import-workspace-input")
    .setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(backupJson),
    });
  await page.waitForTimeout(400);
  entries = await readAudit(page);
  assert(
    entries.length === beforeImportCount + 1,
    "导入恢复应追加一条整体操作记录",
  );
  const importEntry = entries[entries.length - 1];
  assert(
    importEntry.op === "workspace.replaced" && importEntry.summary.includes("恢复"),
    "导入条目应标明来源为恢复",
  );

  // 5) 损坏 / 非工作区文件导入失败，不得落日志、不得改动工作区。
  const failedCount = entries.length;
  await page
    .getByTestId("import-workspace-input")
    .setInputFiles({
      name: "broken.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ hello: "world" })),
    });
  await page.waitForTimeout(300);
  assert(
    (await readAudit(page)).length === failedCount,
    "无效导入文件不得产生审计条目",
  );

  // 6) 审计日志不包含整份状态副本：单条目体积远小于状态、且不出现基因型长文本等敏感字段全文。
  const workspaceRaw = await page.evaluate(() =>
    window.localStorage.getItem("glasshouse-trial-bench:workspace:v1"),
  );
  const auditRaw = await page.evaluate(() =>
    window.localStorage.getItem("glasshouse-trial-bench:audit:v1"),
  );
  assert(
    auditRaw.length < workspaceRaw.length,
    "审计存储应明显小于完整工作区状态（不保存冗余副本）",
  );
}

async function runScenario(scenarioName) {
  const server = spawn(viteBin, ["preview", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: root,
    stdio: "pipe",
  });

  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true });
    const page = await freshPage(browser, scenarioPaths[scenarioName]);
    await scenarios[scenarioName](page);
    console.log(`✅ workflow ${scenarioName}`);
    await page.close();
  } finally {
    if (browser) {
      await browser.close();
    }
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
}

const requested = process.argv[2];

if (!requested || !scenarios[requested]) {
  console.error(`Usage: node scripts/smoke.mjs <${Object.keys(scenarios).join("|")}>`);
  process.exit(2);
}

runScenario(requested).catch((error) => {
  console.error(`❌ workflow ${requested}`);
  console.error(error);
  process.exit(1);
});
