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
  "follow-observation-plan": followObservationPlan,
};

const scenarioPaths = {
  "curate-accession-roster": "/roster",
  "assign-accession-bench": "/layout",
  "record-observation-pass": "/observations",
  "advance-trial-clearance": "/clearance",
  "follow-observation-plan": "/plans",
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

async function followObservationPlan(page) {
  // 1. 为 SOL-01 建立按日期安排、含两种材料的观测计划。
  await page.getByTestId("open-create-plan").click();
  await page.getByTestId("plan-date-input").fill("2026-06-01");
  await page.getByTestId("plan-assignee-input").fill("A. Linden");
  await page.getByTestId("plan-scope-acc-tom-01").check();
  await page.getByTestId("plan-scope-acc-tom-02").check();
  await page.getByTestId("save-plan-button").click();
  await page.getByText("计划已建立", { exact: true }).waitFor();

  // 2. 进入完成对话框，录入计划范围内的测量并保存。
  await page.getByTestId(/plan-complete-pln_/).first().click();
  await page
    .locator(".entry-row")
    .first()
    .locator('input[type="number"]')
    .nth(0)
    .fill("72");
  await page.getByTestId("save-observation-button").click();
  await page.getByText("计划已完成", { exact: true }).waitFor();

  // 3. 完成后的计划只关联一份观测，且不能再次完成。
  await page.getByTestId(/plan-card-pln_/).first().getByText(/已关联观测/).waitFor();
  if ((await page.getByText(/已关联观测/).count()) !== 1) {
    throw new Error("重复完成生成了多份观测关联");
  }

  // 4. 刷新页面后计划、关联与观测都仍然存在，历史没有被改写。
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("已完成", { exact: true }).first().waitFor();
  if ((await page.getByText(/已关联观测/).count()) !== 1) {
    throw new Error("刷新后观测关联数量发生变化");
  }

  // 该试验的观测历史从 1 条增加到 2 条（计划完成只新增一次）。
  await page.goto(`${baseUrl}/#/observations`, { waitUntil: "networkidle" });
  if ((await page.locator(".pass-card").count()) !== 2) {
    throw new Error("计划完成产生的观测数量不正确");
  }
  await page.getByText(/来自观测计划/).waitFor();

  // 5. 漂移：切到 AMA-02，已有计划因材料移出台架而要求重新确认。
  await page.goto(`${baseUrl}/#/plans`, { waitUntil: "networkidle" });
  await page.getByTestId("plan-trial-select").selectOption("trial-ama-02");
  await page.getByTestId("plan-drift-pln-bee-01").waitFor();
  await page.getByTestId("plan-reconfirm-pln-bee-01").click();
  await page.getByText("计划已重新确认", { exact: true }).waitFor();
  await page.getByTestId("plan-complete-pln-bee-01").waitFor();
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
