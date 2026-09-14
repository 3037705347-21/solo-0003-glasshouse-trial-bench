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
  "maintain-bench-ledger": maintainBenchLedger,
  "assign-accession-bench": assignAccessionBench,
  "record-observation-pass": recordObservationPass,
  "advance-trial-clearance": advanceTrialClearance,
};

const scenarioPaths = {
  "curate-accession-roster": "/roster",
  "maintain-bench-ledger": "/benches",
  "assign-accession-bench": "/layout",
  "record-observation-pass": "/observations",
  "advance-trial-clearance": "/clearance",
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

async function maintainBenchLedger(page) {
  // 新建台架：重复编号会被拒绝，改用新编号后创建成功
  await page.getByTestId("open-create-bench").click();
  await page.getByTestId("bench-code-input").fill("E-1");
  await page.getByTestId("bench-sector-input").fill("东翼扩建区");
  await page.getByTestId("bench-capacity-input").fill("6");
  await page.getByTestId("bench-irrigation-input").fill("IR-4");
  await page.getByTestId("save-bench-button").click();
  await page.getByText("该台架编号已被使用").waitFor();
  await page.getByTestId("bench-code-input").fill("E-9");
  await page.getByTestId("save-bench-button").click();
  await page.getByText("台架已创建", { exact: true }).waitFor();
  await page.getByText("E-9", { exact: true }).first().waitFor();

  // 新台架立即出现在布局页
  await page.goto(`${baseUrl}/#/layout`, { waitUntil: "networkidle" });
  await page.getByText("东翼扩建区").first().waitFor();

  // 回到台账，把在用台架 E-1 受限：必须填写原因
  await page.goto(`${baseUrl}/#/benches`, { waitUntil: "networkidle" });
  await page.getByTestId("block-bench-bench-east-1").click();
  await page.getByTestId("bench-status-reason").fill("维修滴灌管路");
  await page.getByTestId("confirm-bench-status").click();
  await page.getByText("台架已受限", { exact: true }).waitFor();

  // 布局页的 E-1 立即显示受限且不再能分配
  await page.goto(`${baseUrl}/#/layout`, { waitUntil: "networkidle" });
  const east1Card = page.getByTestId("bench-card-bench-east-1");
  await east1Card.getByText("受限").first().waitFor();
  await east1Card.getByText("维修滴灌管路").waitFor();

  // 放行页立即出现该台架阻止项
  await page.goto(`${baseUrl}/#/clearance`, { waitUntil: "networkidle" });
  await page.getByText("E-1").first().waitFor();

  // 恢复：原因清除，台架回到已占用
  await page.goto(`${baseUrl}/#/benches`, { waitUntil: "networkidle" });
  await page.getByTestId("restore-bench-bench-east-1").click();
  await page.getByTestId("bench-ready-ok").waitFor();
  await page.getByTestId("confirm-bench-status").click();
  await page.getByText("台架已恢复", { exact: true }).waitFor();
  await page.getByTestId("edit-bench-bench-east-1").waitFor();
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
