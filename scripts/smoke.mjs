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
  "bench-maintenance-flow": benchMaintenanceFlow,
};

const scenarioPaths = {
  "curate-accession-roster": "/roster",
  "assign-accession-bench": "/layout",
  "record-observation-pass": "/observations",
  "advance-trial-clearance": "/clearance",
  "retire-accession-replacement": "/roster",
  "bench-maintenance-flow": "/layout",
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

async function benchMaintenanceFlow(page) {
  // 1. 申请维护（E-1 上有 ACC-0001、ACC-0002 两个材料）
  await page.getByTestId("request-maintenance-bench-east-1").click();
  await page
    .getByTestId("maintenance-request-reason")
    .fill("滴灌接头漏水，需要临时停机检修管路。");
  await page.getByTestId("confirm-request-maintenance").click();
  await page.getByTestId("maintenance-console").waitFor();
  await page.getByText("已申请维护", { exact: true }).waitFor();

  // 2. 过渡态：新分配被冻结
  await page.getByTestId("assignment-accession-select").selectOption("acc-tom-03");
  await assertCount(
    page.getByTestId("assign-bench-bench-east-1"),
    0,
    "assign control hidden while pending",
  );

  // 3. 放行实时视图出现维护阻止项
  await page.goto(`${baseUrl}/#/clearance`, { waitUntil: "networkidle" });
  await page.getByTestId("clearance-trial-select").selectOption("trial-sol-01");
  await page.getByText("BENCH_MAINTENANCE_PENDING", { exact: true }).waitFor();

  // 4. 疏散第一个材料到 E-2
  await page.goto(`${baseUrl}/#/layout`, { waitUntil: "networkidle" });
  await page.getByTestId("manage-maintenance-bench-east-1").click();
  await page.getByTestId("maintenance-console").waitFor();
  await page.getByTestId("relocation-target-acc-tom-01").selectOption("bench-east-2");
  await page.getByTestId("relocate-accession-acc-tom-01").click();
  await page.getByTestId("evacuation-row-acc-tom-02").waitFor();
  await assertCount(
    page.getByTestId("evacuation-row-acc-tom-01"),
    0,
    "relocated accession leaves pending list",
  );

  // 5. 材料历史可追溯迁移去向，且历史观测仍在
  await page.goto(
    `${baseUrl}/#/accessions/acc-tom-01/history`,
    { waitUntil: "networkidle" },
  );
  await page.getByText("台架维护迁移记录", { exact: true }).waitFor();
  await page.getByText("株高 58 mm", { exact: true }).waitFor();

  // 6. 取消维护：已发生迁移，状态按占用恢复（E-1 仍有 ACC-0002 → assigned）
  await page.goto(`${baseUrl}/#/layout`, { waitUntil: "networkidle" });
  await page.getByTestId("manage-maintenance-bench-east-1").click();
  await page.getByTestId("maintenance-console").waitFor();
  await page.getByTestId("cancel-maintenance").click();
  await page.getByText("维护已取消", { exact: false }).waitFor();
  const eastOne = page.getByTestId("bench-card-bench-east-1");
  await eastOne.getByText("已分配", { exact: true }).waitFor();
  const eastTwo = page.getByTestId("bench-card-bench-east-2");
  await eastTwo.getByText("Tiny Tim", { exact: true }).waitFor();

  // 7. 取消后历史在台架历史页仍可审计
  await page.goto(
    `${baseUrl}/#/benches/bench-east-1/history`,
    { waitUntil: "networkidle" },
  );
  await page.getByTestId("bench-history-page").waitFor();
  await page.getByText("滴灌接头漏水，需要临时停机检修管路。", { exact: true }).waitFor();
  await page.getByText("已取消", { exact: true }).waitFor();
  await page.getByText("ACC-0001 · Tiny Tim", { exact: true }).waitFor();

  // 8. 再次申请 → 疏散剩余材料 → 正式维护 → 完成
  await page.goto(`${baseUrl}/#/layout`, { waitUntil: "networkidle" });
  await page.getByTestId("request-maintenance-bench-east-1").click();
  await page
    .getByTestId("maintenance-request-reason")
    .fill("第二次停机，更换老化的灌溉分流阀。");
  await page.getByTestId("confirm-request-maintenance").click();
  await page.getByTestId("maintenance-console").waitFor();
  await assertCount(
    page.getByTestId("start-maintenance"),
    1,
    "start button exists",
  );
  // 未清空时开始按钮禁用
  const startDisabled = await page.getByTestId("start-maintenance").isDisabled();
  if (!startDisabled) {
    throw new Error("start maintenance must stay disabled while occupied");
  }
  await page.getByTestId("relocation-target-acc-tom-02").selectOption("bench-east-2");
  await page.getByTestId("relocate-accession-acc-tom-02").click();
  await page.getByText("台架已清空", { exact: false }).waitFor();
  await page.getByTestId("start-maintenance").click();
  await page.getByText("维护中", { exact: true }).first().waitFor();

  // 维护中台架无疏散列表，完成后恢复可用
  await assertCount(
    page.getByTestId("evacuation-row-acc-tom-02"),
    0,
    "no evacuation rows during maintenance",
  );
  await page.getByTestId("complete-maintenance").click();
  await page.getByText("维护完成", { exact: false }).waitFor();
  const finished = page.getByTestId("bench-card-bench-east-1");
  await finished.getByText("可用", { exact: true }).waitFor();

  // 9. 全部结束后台架历史保留两次维护记录
  await page.goto(
    `${baseUrl}/#/benches/bench-east-1/history`,
    { waitUntil: "networkidle" },
  );
  await page.getByText("维护完成", { exact: true }).waitFor();
  await page.getByText("已取消", { exact: true }).waitFor();
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
