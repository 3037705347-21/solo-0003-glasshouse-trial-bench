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
  "retire-accession-replacement": retireAccessionReplacement,
  "track-consumption-ledger": trackConsumptionLedger,
  "merge-accession-batches": mergeAccessionBatches,
};

const scenarioPaths = {
  "curate-accession-roster": "/roster",
  "assign-accession-bench": "/layout",
  "record-observation-pass": "/observations",
  "advance-trial-clearance": "/clearance",
  "retire-accession-replacement": "/roster",
  "track-consumption-ledger": "/accessions/acc-tom-01/history",
  "merge-accession-batches": "/accessions/acc-bee-03/history",
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

async function curateAccessionRoster(page) {
  await page.getByTestId("open-create-accession").click();
  await page.getByTestId("cultivar-input").fill("Stupice");
  await page.getByLabel("来源").fill("Glasshouse Exchange");
  await page.getByLabel("繁殖日期").fill("2026-02-21");
  await page.getByLabel("数量").fill("72");
  await page.locator("textarea").first().fill("Compact heirloom line with uniform early habit.");
  await page.getByTestId("save-accession-button").click();
  await page.getByText("Stupice", { exact: true }).first().waitFor();
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

async function assertCount(locator, expected, label) {
  const actual = await locator.count();
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

async function retireAccessionReplacement(page) {
  await page.goto(`${baseUrl}/#/clearance`, { waitUntil: "networkidle" });
  await page.getByTestId("generate-clearance").click();
  await page.getByText("放行被阻止", { exact: true }).waitFor();
  const savedSnapshot = page
    .locator(".clearance-preview")
    .nth(1)
    .getByTestId("clearance-snapshot");
  const savedSnapshotBefore = await savedSnapshot.innerText();

  await page.goto(`${baseUrl}/#/roster`, { waitUntil: "networkidle" });
  await page.getByTestId("retire-accession-acc-tom-03").click();
  await page.getByTestId("retire-replacement-select").selectOption("acc-tom-02");
  await page
    .getByTestId("retire-accession-reason")
    .fill("批次已完成，剩余苗株不再继续观测。");
  await page.getByTestId("confirm-retire-accession").click();
  await page.getByText("材料已停用", { exact: true }).waitFor();

  const unassignedRow = page.locator("tr").filter({ hasText: "ACC-0003" });
  await unassignedRow.getByText("已停用", { exact: true }).waitFor();
  await unassignedRow.getByText("ACC-0002 - Micro Tom", { exact: true }).waitFor();

  await page.goto(`${baseUrl}/#/layout`, { waitUntil: "networkidle" });
  await assertCount(
    page.getByTestId("assignment-accession-select").locator('option[value="acc-tom-03"]'),
    0,
    "retired unassigned material in assignment selector",
  );

  await page.goto(`${baseUrl}/#/observations`, { waitUntil: "networkidle" });
  await page.getByTestId("open-observation-form").click();
  await assertCount(
    page.locator(".entry-row").first().locator('option[value="acc-tom-03"]'),
    0,
    "retired unassigned material in observation selector",
  );
  await page.getByRole("button", { name: "取消" }).click();

  await page.goto(`${baseUrl}/#/roster`, { waitUntil: "networkidle" });
  await page.getByTestId("retire-accession-acc-tom-01").click();
  await page.getByTestId("retire-replacement-select").selectOption("acc-tom-02");
  await page
    .getByTestId("retire-accession-reason")
    .fill("本批材料已完成采样，转入历史记录。");
  await page.getByTestId("confirm-retire-accession").click();
  await page.getByText("材料已停用", { exact: true }).waitFor();

  await page.goto(`${baseUrl}/#/layout`, { waitUntil: "networkidle" });
  const eastOne = page.getByTestId("bench-card-bench-east-1");
  await eastOne.getByText("Tiny Tim", { exact: true }).waitFor();
  await eastOne.getByText("ACC-0001 · 已停用", { exact: true }).waitFor();
  await assertCount(
    page.getByTestId("assignment-accession-select").locator('option[value="acc-tom-01"]'),
    0,
    "retired assigned material in assignment selector",
  );

  await page.goto(
    `${baseUrl}/#/accessions/acc-tom-01/history`,
    { waitUntil: "networkidle" },
  );
  await page.getByTestId("accession-history-page").waitFor();
  await page.getByText("本批材料已完成采样，转入历史记录。", { exact: true }).waitFor();
  await page.getByText("E-1", { exact: true }).waitFor();
  await page.getByText("株高 58 mm", { exact: true }).waitFor();
  await page.getByText("Tiny Tim 低于 60 毫米生长阈值", { exact: true }).waitFor();
  await page.getByText("放行快照", { exact: true }).waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("ACC-0001 · Tiny Tim", { exact: true }).waitFor();

  await page.goto(
    `${baseUrl}/#/accessions/acc-tom-02/history`,
    { waitUntil: "networkidle" },
  );
  await page.getByText("被替代材料", { exact: true }).waitFor();
  await page.locator(".relation-list").getByText("ACC-0001", { exact: false }).waitFor();
  await page.locator(".relation-list").getByText("ACC-0003", { exact: false }).waitFor();

  await page.goto(`${baseUrl}/#/roster`, { waitUntil: "networkidle" });
  await page.getByTestId("restore-accession-acc-tom-01").click();
  await page.getByTestId("confirm-restore-accession").click();
  await page
    .getByText("请先确认已重新检查台架和光照条件", { exact: true })
    .waitFor();
  await page.getByTestId("restore-bench-conditions").check();
  await page.getByTestId("confirm-restore-accession").click();
  await page.getByText("材料已恢复", { exact: true }).waitFor();
  const restoredRow = page.locator("tr").filter({ hasText: "ACC-0001" });
  await restoredRow.getByText("已分配", { exact: true }).waitFor();
  await page.goto(
    `${baseUrl}/#/accessions/acc-tom-01/history`,
    { waitUntil: "networkidle" },
  );
  await page.getByText("曾停用后恢复", { exact: true }).waitFor();

  await page.goto(`${baseUrl}/#/layout`, { waitUntil: "networkidle" });
  await assertCount(
    page.getByTestId("assignment-accession-select").locator('option[value="acc-tom-01"]'),
    1,
    "restored material in assignment selector",
  );

  await page.goto(`${baseUrl}/#/observations`, { waitUntil: "networkidle" });
  await page.getByTestId("open-observation-form").click();
  await assertCount(
    page.locator(".entry-row").first().locator('option[value="acc-tom-01"]'),
    1,
    "restored material in observation selector",
  );
  await page.getByRole("button", { name: "取消" }).click();

  await page.goto(`${baseUrl}/#/roster`, { waitUntil: "networkidle" });
  await page.getByTestId("retire-accession-acc-tom-02").click();
  await assertCount(
    page.getByTestId("retire-replacement-select").locator('option[value="acc-tom-02"]'),
    0,
    "self replacement option",
  );
  await assertCount(
    page.getByTestId("retire-replacement-select").locator('option[value="acc-tom-01"]'),
    0,
    "cycle-producing replacement option",
  );
  await page.getByRole("button", { name: "取消" }).click();

  await page.goto(`${baseUrl}/#/clearance`, { waitUntil: "networkidle" });
  const savedSnapshotAfter = await page
    .locator(".clearance-preview")
    .nth(1)
    .getByTestId("clearance-snapshot")
    .innerText();
  if (savedSnapshotAfter !== savedSnapshotBefore) {
    throw new Error("saved clearance snapshot changed after material retirement");
  }
}

async function trackConsumptionLedger(page) {
  // 1. 示例流水与派生余量：ACC-0001 登记 96，净耗用 12（-12、-4、更正 +2），余量 82。
  await page.getByTestId("accession-history-page").waitFor();
  await page.getByTestId("history-remaining").getByText("82", { exact: true }).waitFor();
  await page.getByText("耗用流水", { exact: true }).waitFor();
  await page.getByText("复核监控记录", { exact: false }).waitFor();
  await page.getByText("已更正", { exact: true }).waitFor();

  // 2. 登记一次新耗用 10，余量应从 82 变为 72。
  await page.getByTestId("open-consumption-dialog").click();
  await page.getByTestId("consumption-quantity-input").fill("10");
  await page.getByTestId("consumption-recorded-by").fill("K. Sato");
  await page.getByTestId("consumption-destination-select").selectOption("activity");
  await page.getByTestId("consumption-ref-input").fill("开放日展示取苗");
  await page.getByTestId("consumption-note-input").fill("开放日现场展示取苗，剩余回库。");
  await page.getByTestId("confirm-consumption").click();
  await page.getByText("耗用已登记", { exact: true }).waitFor();
  await page.getByTestId("history-remaining").getByText("72", { exact: true }).waitFor();

  // 3. 超量耗用必须被拒绝，余量不能变成负数。
  await page.getByTestId("open-consumption-dialog").click();
  await page.getByTestId("consumption-quantity-input").fill("73");
  await page.getByTestId("consumption-recorded-by").fill("K. Sato");
  await page.getByTestId("consumption-destination-select").selectOption("waste");
  await page.getByTestId("consumption-ref-input").fill("模拟超量损耗");
  await page.getByTestId("consumption-note-input").fill("尝试登记超过余量的耗用以验证拦截。");
  await page.getByTestId("confirm-consumption").click();
  await page.getByText("会造成负数余量", { exact: false }).waitFor();
  await page.getByRole("button", { name: "取消" }).first().click();
  await page.getByTestId("history-remaining").getByText("72", { exact: true }).waitFor();

  // 4. 更正刚登记的 10 为 6：原始记录保留并标注已更正，只追加冲销 +4，余量变为 76。
  await page
    .locator('[data-testid^="ledger-entry-use_"]')
    .filter({ hasText: "开放日展示取苗" })
    .getByRole("button", { name: "更正" })
    .click();
  await page.getByTestId("correction-quantity-input").fill("6");
  await page.getByTestId("correction-recorded-by").fill("K. Sato");
  await page.getByTestId("correction-note-input").fill("现场复核实际取苗 6 株，冲销差额。");
  await page.getByTestId("confirm-correction").click();
  await page.getByText("更正已留痕", { exact: true }).waitFor();
  await page.getByTestId("history-remaining").getByText("76", { exact: true }).waitFor();
  const openDayEntries = page
    .locator('[data-testid^="ledger-entry-"]')
    .filter({ hasText: "开放日展示取苗" });
  await openDayEntries.filter({ hasText: "已更正" }).waitFor();
  await openDayEntries.filter({ hasText: "+4" }).waitFor();

  // 5. 跨试验复制：复制 20 到 BRA-03 并重新编号，源批次余量变为 56，流水留在源批次。
  await page.getByTestId("open-copy-dialog").click();
  await page.getByTestId("copy-target-trial-select").selectOption("trial-bra-03");
  await page.getByTestId("copy-accession-no").fill("ACC-0099");
  await page.getByTestId("copy-quantity-input").fill("20");
  await page.getByTestId("copy-recorded-by").fill("K. Sato");
  await page.getByTestId("copy-note-input").fill("羽衣甘蓝季需要同基因型对照，跨试验复制。");
  await page.getByTestId("confirm-copy-accession").click();
  await page.getByText("已跨试验复制", { exact: true }).waitFor();
  await page.getByTestId("history-remaining").getByText("56", { exact: true }).waitFor();
  await page.getByText("跨试验复制而来", { exact: false }).waitFor();

  // 6. 计划流程提示：在布局页选择 ACC-0002（示例余量 96），计划 120 超量时按钮禁用并给出警告。
  await page.goto(`${baseUrl}/#/layout`, { waitUntil: "networkidle" });
  await page.getByTestId("layout-trial-select").selectOption("trial-sol-01");
  await page.getByTestId("assignment-accession-select").selectOption("acc-tom-02");
  await page.getByTestId("assignment-stock-badge").getByText("余量 96").waitFor();
  const eastTwoAssign = page.getByTestId("assign-bench-bench-east-2");
  if ((await eastTwoAssign.isDisabled()) !== false) {
    throw new Error("assign button should be enabled within stock");
  }
  await page.getByTestId("assignment-planned-quantity").fill("120");
  await page.getByTestId("assignment-stock-warning").waitFor();
  await eastTwoAssign.isDisabled().then((disabled) => {
    if (!disabled) {
      throw new Error("assign button should stay disabled when plan exceeds stock");
    }
  });
  // 台架状态未被自动改写：E-2 仍为空。
  await page.getByTestId("bench-card-bench-east-2").getByText("暂无分配材料。").waitFor();
  // 调减计划后分配恢复可用，分配成功但余量不被扣减。
  await page.getByTestId("assignment-planned-quantity").fill("20");
  await eastTwoAssign.isDisabled().then((disabled) => {
    if (disabled) {
      throw new Error("assign button should re-enable after reducing plan");
    }
  });
  await eastTwoAssign.click();
  await page.getByText("台架分配成功", { exact: true }).waitFor();
  await page.getByText("余量 96 未被扣减", { exact: false }).waitFor();

  // 7. 零余量进入放行阻止项：用尽 ACC-0003（示例余量 20），快照列出 STOCK_EXHAUSTED。
  await page.goto(`${baseUrl}/#/accessions/acc-tom-03/history`, { waitUntil: "networkidle" });
  await page.getByTestId("history-remaining").getByText("20", { exact: true }).waitFor();
  await page.getByTestId("open-consumption-dialog").click();
  await page.getByTestId("consumption-quantity-input").fill("20");
  await page.getByTestId("consumption-recorded-by").fill("M. Ikeda");
  await page.getByTestId("consumption-destination-select").selectOption("activity");
  await page.getByTestId("consumption-ref-input").fill("展示区全部用苗");
  await page.getByTestId("consumption-note-input").fill("剩余苗株全部用于展示区定植。");
  await page.getByTestId("confirm-consumption").click();
  await page.getByTestId("history-remaining").getByText("0", { exact: true }).waitFor();
  await page.getByText("余量为零", { exact: true }).waitFor();
  await page.goto(`${baseUrl}/#/clearance`, { waitUntil: "networkidle" });
  await page.getByTestId("clearance-trial-select").selectOption("trial-sol-01");
  await page.getByTestId("generate-clearance").click();
  await page.getByText("STOCK_EXHAUSTED", { exact: true }).first().waitFor();
  await page.getByText("ACC-0003 当前余量为 0", { exact: false }).first().waitFor();
}

async function mergeAccessionBatches(page) {
  // ACC-0006 (Chioggia) 登记 90、已用 8，余量 82。
  await page.getByTestId("accession-history-page").waitFor();
  await page.getByTestId("history-remaining").getByText("82", { exact: true }).waitFor();

  await page.getByTestId("open-merge-dialog").click();
  await page.getByTestId("merge-target-select").selectOption("acc-bee-02");
  await page.getByText("合并后为 202", { exact: false }).waitFor();
  await page.getByTestId("merge-recorded-by").fill("R. Ono");
  await page.getByTestId("merge-note-input").fill("条纹甜菜批次数量不足，并入同试验相邻批次统一管理。");
  await page.getByTestId("confirm-merge").click();
  await page.getByText("批次已合并", { exact: true }).waitFor();

  // 源批次余量归零、处于停用状态，转出流水与停用原因留痕。
  await page.getByTestId("history-remaining").getByText("0", { exact: true }).waitFor();
  await page.getByText("已停用", { exact: true }).first().waitFor();
  await page.getByText("转出", { exact: true }).waitFor();
  await page.getByText("合并至 ACC-0005", { exact: false }).first().waitFor();
  // 历史耗用仍然归属源批次，没有被转移或改写。
  await page.getByText("限水处理组取样", { exact: false }).waitFor();

  // 目标批次余量 202（120 + 82），含一条配对转入流水。
  await page.goto(`${baseUrl}/#/accessions/acc-bee-02/history`, { waitUntil: "networkidle" });
  await page.getByTestId("history-remaining").getByText("202", { exact: true }).waitFor();
  await page.getByText("转入", { exact: true }).waitFor();
  await page.getByText("接收自 ACC-0006", { exact: false }).waitFor();

  // 合并后的源批次不能再登记耗用。
  await page.goto(`${baseUrl}/#/roster`, { waitUntil: "networkidle" });
  await assertCount(
    page.getByTestId("consume-accession-acc-bee-03"),
    0,
    "consume button on retired merged source",
  );

  // 刷新后归属关系仍然成立（持久化）。
  await page.reload({ waitUntil: "networkidle" });
  await page.goto(`${baseUrl}/#/accessions/acc-bee-02/history`, { waitUntil: "networkidle" });
  await page.getByTestId("history-remaining").getByText("202", { exact: true }).waitFor();
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
