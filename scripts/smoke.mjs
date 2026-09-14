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
  "batch-import-accessions": batchImportAccessions,
};

const scenarioPaths = {
  "curate-accession-roster": "/roster",
  "assign-accession-bench": "/layout",
  "record-observation-pass": "/observations",
  "advance-trial-clearance": "/clearance",
  "batch-import-accessions": "/roster",
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

async function batchImportAccessions(page) {
  const defaultNote = "批量导入统一批次说明";
  const openDialog = async () => {
    await page.getByTestId("open-batch-import").click();
    await page.getByTestId("batch-import-input").waitFor();
  };
  const fillAndPrecheck = async (text) => {
    await page.getByTestId("batch-default-note").fill(defaultNote);
    await page.getByTestId("batch-import-input").fill(text);
    await page.getByTestId("batch-precheck-button").click();
    await page.getByTestId("batch-preview-summary").waitFor();
  };

  // 1. 正常批量：三行显式编号加一行自动补号，全部导入
  await openDialog();
  await fillAndPrecheck(
    [
      "试验\t材料编号\t品种\t来源\t繁殖日期\t数量\t穴盘规格\t光照\t标签",
      "SOL-01\tACC-0101\tBatch Alpha\tSeed Vault North\t2026-03-01\t48\t72\t全日照\t批量",
      "SOL-01\tACC-0102\tBatch Beta\tSeed Vault North\t2026-03-01\t48\t72\t全日照\t批量",
      "SOL-01\tACC-0103\tBatch Gamma\tSeed Vault North\t2026-03-02\t36\t104\t半阴\t批量",
      "SOL-01\t\tBatch Delta\tSeed Vault North\t2026-03-02\t40\t72\t全日照\t批量",
    ].join("\n"),
  );
  await page.getByText("有效 4", { exact: true }).waitFor();
  await page.getByText("需修正 0", { exact: true }).waitFor();
  await page.getByText("ACC-0009 自动", { exact: false }).first().waitFor();
  await page.getByTestId("batch-submit-button").click();
  await page.getByText("批量导入完成", { exact: true }).first().waitFor();
  await page.getByText("ACC-0101", { exact: true }).first().waitFor();

  // 2. 含错误行：重复编号、未知试验、字段越界、跨行冲突逐行呈现，只提交有效行
  await openDialog();
  await page
    .getByTestId("import-batch-history")
    .getByText("导入 4 条 / 共 4 行，跳过 0 行")
    .waitFor();
  await fillAndPrecheck(
    [
      "试验\t材料编号\t品种\t来源\t繁殖日期\t数量\t穴盘规格\t光照\t标签",
      "SOL-01\tACC-0104\tDelta Ok\tSeed Vault North\t2026-03-03\t24\t72\t全日照\t批量",
      "SOL-01\tACC-0101\tEcho Dup\tSeed Vault North\t2026-03-03\t24\t72\t全日照\t批量",
      "NOPE-99\tACC-0106\tFoxtrot Trial\tSeed Vault North\t2026-03-03\t24\t72\t全日照\t批量",
      "SOL-01\tACC-0107\tGolf Range\tSeed Vault North\t2026-03-03\t9999\t72\t全日照\t批量",
      "SOL-01\tACC-0108\tHotel First\tSeed Vault North\t2026-03-03\t24\t72\t全日照\t批量",
      "SOL-01\tACC-0108\tIndia Second\tSeed Vault North\t2026-03-03\t24\t72\t全日照\t批量",
    ].join("\n"),
  );
  await page.getByText("有效 2", { exact: true }).waitFor();
  await page.getByText("需修正 4", { exact: true }).waitFor();
  await page
    .getByTestId("batch-row-issues-2")
    .filter({ hasText: "该材料编号已被使用" })
    .waitFor();
  await page
    .getByTestId("batch-row-issues-3")
    .filter({ hasText: "未知试验：NOPE-99" })
    .waitFor();
  await page
    .getByTestId("batch-row-issues-4")
    .filter({ hasText: "数量必须在 1 到 500 之间" })
    .waitFor();
  await page
    .getByTestId("batch-row-issues-6")
    .filter({ hasText: "跨行冲突：与第 5 行编号重复" })
    .waitFor();
  await page.getByTestId("batch-submit-button").click();
  await page
    .getByText("已导入 2 条材料，跳过 4 行。", { exact: true })
    .first()
    .waitFor();
  await page.getByText("ACC-0104", { exact: true }).first().waitFor();
  await page.getByText("ACC-0108", { exact: true }).first().waitFor();

  // 3. 全部重复：提交被禁用，整批放弃后工作区不变
  await openDialog();
  await fillAndPrecheck(
    [
      "试验\t材料编号\t品种\t来源\t繁殖日期\t数量\t穴盘规格\t光照\t标签",
      "SOL-01\tACC-0001\tRepeat One\tSeed Vault North\t2026-03-04\t24\t72\t全日照\t批量",
      "SOL-01\tACC-0002\tRepeat Two\tSeed Vault North\t2026-03-04\t24\t72\t全日照\t批量",
    ].join("\n"),
  );
  await page.getByText("有效 0", { exact: true }).waitFor();
  await page.getByText("需修正 2", { exact: true }).waitFor();
  if (await page.getByTestId("batch-submit-button").isEnabled()) {
    throw new Error("全部重复时提交按钮必须处于禁用状态");
  }
  await page.getByTestId("batch-discard-button").click();
  await page.getByTestId("open-batch-import").waitFor();
  if ((await page.getByText("Repeat One").count()) !== 0) {
    throw new Error("整批放弃后不应写入任何材料");
  }

  // 4. 大量记录：120 行一次预检、一次提交
  const bulkLines = [
    "试验\t材料编号\t品种\t来源\t繁殖日期\t数量\t穴盘规格\t光照\t标签",
  ];
  for (let index = 1; index <= 120; index += 1) {
    bulkLines.push(
      `SOL-01\tACC-0${300 + index}\tBulk Cultivar ${index}\tSeed Vault North\t2026-03-05\t30\t72\t全日照\t批量`,
    );
  }
  await openDialog();
  await fillAndPrecheck(bulkLines.join("\n"));
  await page.getByText("有效 120", { exact: true }).waitFor();
  await page.getByTestId("batch-submit-button").click();
  await page
    .getByText("已导入 120 条材料，跳过 0 行。", { exact: true })
    .first()
    .waitFor();
  await page.getByText("ACC-0420", { exact: true }).first().waitFor();
  await page.getByText("134 个材料中显示", { exact: false }).waitFor();

  // 5. 持久化失败：提交前预写失败时不产生部分导入，恢复后可正常重试
  await page.evaluate(() => {
    window.__originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException("quota exceeded", "QuotaExceededError");
    };
  });
  await openDialog();
  await fillAndPrecheck(
    [
      "试验\t材料编号\t品种\t来源\t繁殖日期\t数量\t穴盘规格\t光照\t标签",
      "SOL-01\tACC-0500\tPersist Check\tSeed Vault North\t2026-03-06\t20\t72\t全日照\t批量",
    ].join("\n"),
  );
  await page.getByText("有效 1", { exact: true }).waitFor();
  await page.getByTestId("batch-submit-button").click();
  await page.getByTestId("batch-commit-error").waitFor();
  await page.getByText("浏览器存储写入失败", { exact: false }).waitFor();
  await page.getByText("134 个材料中显示", { exact: false }).waitFor();
  await page.evaluate(() => {
    Storage.prototype.setItem = window.__originalSetItem;
  });
  await page.getByTestId("batch-submit-button").click();
  await page.getByText("批量导入完成", { exact: true }).first().waitFor();
  await page.getByText("ACC-0500", { exact: true }).first().waitFor();
  await page.getByText("135 个材料中显示", { exact: false }).waitFor();
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
