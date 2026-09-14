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
  "reserve-bench-capacity": reserveBenchCapacity,
  "record-observation-pass": recordObservationPass,
  "advance-trial-clearance": advanceTrialClearance,
};

const scenarioPaths = {
  "curate-accession-roster": "/roster",
  "assign-accession-bench": "/layout",
  "reserve-bench-capacity": "/reservations",
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

async function assignAccessionBench(page) {
  await page.getByTestId("assignment-accession-select").selectOption("acc-tom-03");
  await page.getByTestId("assign-bench-bench-east-2").click();
  await page.getByText("台架分配成功", { exact: true }).waitFor();
  await page.getByTestId("bench-card-bench-east-2").getByText("Yellow Pear").waitFor();
}

async function reserveBenchCapacity(page) {
  // 为 SOL-01 在 E-2（全日照、容量 4）预留 3 个跨期槽位。
  await page.getByTestId("open-create-reservation").click();
  await page.getByTestId("reservation-trial-select").selectOption("trial-sol-01");
  await page.getByTestId("reservation-bench-select").selectOption("bench-east-2");
  await page.getByTestId("reservation-start-input").fill("2026-03-01");
  await page.getByTestId("reservation-end-input").fill("2026-06-30");
  await page.getByTestId("reservation-slots-input").fill("3");
  await page.getByTestId("save-reservation-button").click();
  await page.getByText("预留已登记", { exact: false }).first().waitFor();
  await page.getByText("RSV-0007", { exact: true }).first().waitFor();

  // 计划期最少可分配空间应显示为 1（容量 4 - 持有 3）。
  const planCard = page.getByTestId("capacity-card-bench-east-2");
  await planCard.getByText("最少可分配").waitFor();

  // 再登记一个与 RSV-0007 同窗口同容量、再要 3 槽位的竞争预留，必须判为冲突。
  await page.getByTestId("open-create-reservation").click();
  await page.getByTestId("reservation-trial-select").selectOption("trial-sol-01");
  await page.getByTestId("reservation-bench-select").selectOption("bench-east-2");
  await page.getByTestId("reservation-start-input").fill("2026-03-01");
  await page.getByTestId("reservation-end-input").fill("2026-06-30");
  await page.getByTestId("reservation-slots-input").fill("3");
  await page.getByTestId("save-reservation-button").click();
  await page.getByText("存在冲突", { exact: false }).first().waitFor();

  // 仅看冲突预留并展开：必须指出与 RSV-0007 重叠。
  await page.getByRole("tab", { name: /冲突/ }).click();
  await page.getByTestId(/^expand-reservation-/).first().click();
  await page.getByTestId("reservation-conflicts").getByText("RSV-0007").waitFor();

  // 取消冲突预留：不能影响任何已实际分配的材料。
  await page.getByTestId(/^cancel-reservation-/).first().click();
  await page.getByText("预留已取消", { exact: true }).waitFor();

  // 把 E-2 转入维护停用，旧预留 RSV-0007 应重新判定为失效。
  await page.getByTestId("maintain-bench-bench-east-2").click();
  await page.getByTestId("bench-status-select").selectOption("blocked");
  await page.getByTestId("save-bench-button").click();
  await page.getByText("台架已更新", { exact: true }).waitFor();
  await page.getByRole("tab", { name: /失效/ }).click();
  await page.getByTestId(/^expand-reservation-/).first().click();
  await page.getByTestId("reservation-invalid-reasons").waitFor();
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
