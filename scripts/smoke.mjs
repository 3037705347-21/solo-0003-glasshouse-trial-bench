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
  "manage-trial-lifecycle": manageTrialLifecycle,
  "curate-accession-roster": curateAccessionRoster,
  "assign-accession-bench": assignAccessionBench,
  "record-observation-pass": recordObservationPass,
  "advance-trial-clearance": advanceTrialClearance,
};

const scenarioPaths = {
  "manage-trial-lifecycle": "/trials",
  "curate-accession-roster": "/roster",
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

async function manageTrialLifecycle(page) {
  // 重复编号和颠倒的日期顺序都会被拒绝并显示字段级提示
  await page.getByTestId("open-create-trial").click();
  await page.getByTestId("trial-code-input").fill("SOL-01");
  await page.getByTestId("trial-crop-input").fill("葫芦科");
  await page.getByLabel("季节").selectOption("秋季");
  await page.getByLabel("开始日期").fill("2026-09-01");
  await page.getByLabel("结束日期").fill("2026-12-20");
  await page.getByLabel("试验目标").fill("比较黄瓜品系在秋冬茬口的坐果与抗病表现。");
  await page.getByTestId("save-trial-button").click();
  await page.getByText("该试验编号已被使用", { exact: true }).waitFor();
  await page.getByTestId("trial-code-input").fill("CUC-07");
  await page.getByLabel("结束日期").fill("2026-08-01");
  await page.getByTestId("save-trial-button").click();
  await page.getByText("结束日期不能早于开始日期", { exact: true }).waitFor();
  await page.getByLabel("结束日期").fill("2026-12-20");
  await page.getByTestId("save-trial-button").click();
  await page.getByText("试验已创建", { exact: true }).waitFor();
  await page.locator("tr", { hasText: "CUC-07" }).waitFor();

  // 新试验立即出现在其它工作流的试验选择器中
  await page.getByRole("link", { name: "材料登记" }).click();
  await page.getByTestId("trial-filter").selectOption({ label: "CUC-07 - 葫芦科" });
  await page.getByTestId("open-create-accession").click();
  await page.getByTestId("cultivar-input").fill("Greensleeves");
  await page.getByLabel("来源").fill("Glasshouse Exchange");
  await page.getByLabel("繁殖日期").fill("2026-08-14");
  await page.getByLabel("数量").fill("72");
  await page.locator("textarea").first().fill("Crisp slicing line with even node spacing.");
  await page.getByTestId("save-accession-button").click();
  await page.getByText("ACC-0009", { exact: true }).first().waitFor();

  // 编辑试验资料后，已有材料引用保持不变
  await page.getByRole("link", { name: "试验管理" }).click();
  await page
    .locator("tr", { hasText: "CUC-07" })
    .getByRole("button", { name: "编辑" })
    .click();
  await page.getByTestId("trial-code-input").fill("CUC-08");
  await page.getByTestId("save-trial-button").click();
  await page.getByText("试验已更新", { exact: true }).waitFor();
  await page.getByRole("link", { name: "材料登记" }).click();
  await page.getByTestId("trial-filter").selectOption({ label: "CUC-08 - 葫芦科" });
  await page.getByText("Greensleeves", { exact: true }).first().waitFor();

  // 生命周期转换：草稿启动、进行中暂停、暂停恢复
  await page.getByRole("link", { name: "试验管理" }).click();
  const trialRow = page.locator("tr", { hasText: "CUC-08" });
  await trialRow.getByRole("button", { name: "启动" }).click();
  await trialRow.getByText("进行中", { exact: true }).waitFor();
  await trialRow.getByRole("button", { name: "暂停" }).click();
  await trialRow.getByText("已暂停", { exact: true }).waitFor();
  await trialRow.getByRole("button", { name: "恢复" }).click();
  await trialRow.getByText("进行中", { exact: true }).waitFor();

  // 刷新后试验仍然存在，其它选择器也能看到
  await page.reload({ waitUntil: "networkidle" });
  await page.locator("tr", { hasText: "CUC-08" }).waitFor();
  await page.getByRole("link", { name: "生长观测" }).click();
  await page.waitForFunction(() => {
    const select = document.querySelector('[data-testid="observation-trial-select"]');
    return (
      select && [...select.options].some((option) => option.textContent.includes("CUC-08"))
    );
  });
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
