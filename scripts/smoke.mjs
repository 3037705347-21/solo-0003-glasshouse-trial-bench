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
  "resume-observation-session": resumeObservationSession,
  "advance-trial-clearance": advanceTrialClearance,
  "retire-accession-replacement": retireAccessionReplacement,
};

const scenarioPaths = {
  "curate-accession-roster": "/roster",
  "assign-accession-bench": "/layout",
  "record-observation-pass": "/observations",
  "resume-observation-session": "/observations",
  "advance-trial-clearance": "/clearance",
  "retire-accession-replacement": "/roster",
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

async function resumeObservationSession(page) {
  // 开始录入会话：填写观测人和第一行，再添加第二行选择另一份材料。
  await page.getByTestId("open-observation-form").click();
  await page.getByTestId("session-banner").getByText("新的录入会话").waitFor();
  await page.getByTestId("observer-input").fill("A. Linden");
  await page
    .locator(".entry-row")
    .nth(0)
    .locator('input[type="number"]')
    .nth(0)
    .fill("54");
  await page.getByRole("button", { name: "添加行" }).click();
  await page.locator(".entry-row").nth(1).locator("select").selectOption("acc-tom-02");
  await page
    .locator(".entry-row")
    .nth(1)
    .locator('input[type="number"]')
    .nth(0)
    .fill("66");

  // 关闭对话框并刷新页面：会话应原样恢复。
  await page.getByRole("button", { name: "取消" }).click();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("继续观测录入").first().waitFor();
  await page.getByTestId("open-observation-form").click();
  await page
    .getByTestId("session-banner")
    .getByText("已恢复未完成的录入会话")
    .waitFor();
  const observer = await page.getByTestId("observer-input").inputValue();
  if (observer !== "A. Linden") {
    throw new Error(`session observer not restored: "${observer}"`);
  }
  await assertCount(page.locator(".entry-row"), 2, "resumed entry rows");

  // 巡场期间，第二行的材料在登记页被停用。
  await page.getByRole("button", { name: "取消" }).click();
  await page.goto(`${baseUrl}/#/roster`, { waitUntil: "networkidle" });
  await page.getByTestId("retire-accession-acc-tom-02").click();
  await page.getByTestId("retire-replacement-select").selectOption("acc-tom-01");
  await page
    .getByTestId("retire-accession-reason")
    .fill("巡场期间该批次被替换停用。");
  await page.getByTestId("confirm-retire-accession").click();
  await page.getByText("材料已停用", { exact: true }).waitFor();

  // 恢复会话：第二行必须标记失效并说明原因，而不是假装仍然有效。
  await page.goto(`${baseUrl}/#/observations`, { waitUntil: "networkidle" });
  await page.getByTestId("open-observation-form").click();
  const staleRow = page.locator(".entry-row").nth(1);
  await staleRow.getByText("已失效", { exact: true }).waitFor();
  await staleRow
    .getByText("ACC-0002 已停用，不能进入新观测", { exact: true })
    .waitFor();

  // 部分提交：只写入有效行，会话保持打开并明确归属。
  await page.getByTestId("save-observation-button").click();
  await page.getByTestId("session-notice").waitFor();
  await page
    .locator(".entry-row")
    .nth(0)
    .getByText("已提交", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "取消" }).click();
  await assertCount(
    page.locator('[data-testid^="pass-"]'),
    2,
    "passes after partial commit",
  );
  const firstPass = page.locator('[data-testid^="pass-"]').first();
  await firstPass.getByText("1 条测量记录", { exact: true }).waitFor();
  if ((await firstPass.innerText()).includes("ACC-0002")) {
    throw new Error("stale entry leaked into committed pass");
  }

  // 刷新后恢复：已提交与已失效的归属保留，重复提交被拒绝且不重复写入。
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("open-observation-form").click();
  await page
    .locator(".entry-row")
    .nth(0)
    .getByText("已提交", { exact: true })
    .waitFor();
  await page
    .locator(".entry-row")
    .nth(1)
    .getByText("已失效", { exact: true })
    .waitFor();
  await page.getByTestId("save-observation-button").click();
  await page.getByText("没有可提交的测量记录").first().waitFor();
  await page.getByRole("button", { name: "取消" }).click();
  await assertCount(
    page.locator('[data-testid^="pass-"]'),
    2,
    "passes after rejected resubmit",
  );

  // 移除失效行后会话完成并清除，入口回到新会话状态。
  await page.getByTestId("open-observation-form").click();
  await page.getByRole("button", { name: "移除第 2 行" }).click();
  await page.getByText("新建观测", { exact: true }).waitFor();
  await page.getByTestId("open-observation-form").click();
  await page.getByTestId("session-banner").getByText("新的录入会话").waitFor();
  await assertCount(page.locator(".entry-row"), 1, "fresh session entry rows");
  await page.getByRole("button", { name: "取消" }).click();
  await assertCount(
    page.locator('[data-testid^="pass-"]'),
    2,
    "passes after session completion",
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
