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
  "govern-accession-labels": governAccessionLabels,
};

const scenarioPaths = {
  "curate-accession-roster": "/roster",
  "assign-accession-bench": "/layout",
  "record-observation-pass": "/observations",
  "advance-trial-clearance": "/clearance",
  "govern-accession-labels": "/labels",
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

async function governAccessionLabels(page) {
  // 示例数据中 SOL-01 存在大小写混用（Early / EARLY）、首尾空格（矮化␠）。
  await page.getByTestId("dirty-banner").waitFor();
  await page
    .getByTestId("label-variants-early")
    .getByText("EARLY×1")
    .waitFor();

  // 重命名：早熟 -> early-maturity，执行前预览影响 1 个材料。
  await page.getByTestId("rename-label-早熟").click();
  await page.getByTestId("rename-label-input").fill("early-maturity");
  await page.getByTestId("impact-count").getByText("1 个材料").waitFor();
  await page.getByTestId("impact-row-acc-tom-01").waitFor();
  await page.getByTestId("apply-label-operation").click();
  await page.getByText("标签已重命名", { exact: true }).waitFor();

  // 合并：矮化 + early（含大小写混用）统一为 compact，影响 2 个材料。
  await page.getByTestId("label-check-矮化").check();
  await page.getByTestId("label-check-early").check();
  await page.getByTestId("open-bulk-merge").click();
  await page.getByTestId("merge-target-input").fill("compact");
  await page.getByTestId("impact-count").getByText("2 个材料").waitFor();
  await page.getByTestId("apply-label-operation").click();
  await page.getByText("标签已合并", { exact: true }).waitFor();
  await page.waitForFunction(
    () => document.querySelectorAll('[data-testid="dirty-banner"]').length === 0,
  );

  // 批量添加：为试验内全部 3 个材料追加“抗病”。
  await page.getByTestId("open-add-labels").click();
  await page.getByTestId("add-labels-input").fill("抗病");
  await page.getByTestId("impact-count").getByText("3 个材料").waitFor();
  await page.getByTestId("apply-label-operation").click();
  await page.getByText("标签已批量添加", { exact: true }).waitFor();

  // 回到材料列表核对落库结果，治理结果必须与材料记录一致。
  await page.goto(`${baseUrl}/#/roster`, { waitUntil: "networkidle" });
  await page.getByTestId("accession-search").fill("抗病");
  await page.waitForFunction(
    () => document.querySelectorAll("table.data-table tbody tr").length === 3,
  );
  await page.getByTestId("accession-search").fill("early-maturity");
  await page.waitForFunction(
    () => document.querySelectorAll("table.data-table tbody tr").length === 1,
  );
  await page.getByText("compact", { exact: true }).first().waitFor();
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
