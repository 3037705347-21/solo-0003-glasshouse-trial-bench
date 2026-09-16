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
  "confirm-clearance-checklist": confirmClearanceChecklist,
};

const scenarioPaths = {
  "curate-accession-roster": "/roster",
  "assign-accession-bench": "/layout",
  "record-observation-pass": "/observations",
  "advance-trial-clearance": "/clearance",
  "retire-accession-replacement": "/roster",
  "confirm-clearance-checklist": "/clearance",
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

async function confirmClearanceChecklist(page) {
  const checklist = page.getByTestId("clearance-checklist");
  await checklist.waitFor();
  await assertCount(
    checklist.locator('[data-testid^="checklist-item-"]'),
    4,
    "checklist items",
  );
  await page
    .getByTestId("checklist-summary")
    .filter({ hasText: "未确认 4 项" })
    .waitFor();

  await page.getByTestId("checklist-confirmer").fill("K. Sato");
  await page
    .getByTestId("checklist-note-material-identity")
    .fill("已核对穴盘标签与登记册。");
  await page.getByTestId("checklist-confirm-material-identity").click();
  const materialItem = page.getByTestId("checklist-item-material-identity");
  await materialItem.getByText("已确认", { exact: true }).waitFor();

  // 重复确认：更新备注后再次确认，仍只保留一条结论
  await page
    .getByTestId("checklist-note-material-identity")
    .fill("复核无误，标签一致。");
  await page.getByTestId("checklist-confirm-material-identity").click();
  await materialItem
    .getByText("复核无误，标签一致。", { exact: false })
    .waitFor();
  await assertCount(
    materialItem.getByText("已确认", { exact: true }),
    1,
    "duplicate confirmation keeps single record",
  );
  await assertCount(
    page.getByText("已核对穴盘标签与登记册。", { exact: false }),
    0,
    "superseded note removed",
  );

  await page.getByTestId("checklist-na-label-handling").click();
  await page
    .getByTestId("checklist-item-label-handling")
    .locator(".status-badge")
    .filter({ hasText: "不适用" })
    .waitFor();

  // 未确认项不影响自动阻止项，但必须在放行结果中说明
  await page.getByTestId("generate-clearance").click();
  await page.getByText("放行被阻止", { exact: true }).waitFor();
  const savedSnapshot = page
    .locator(".clearance-preview")
    .nth(1)
    .getByTestId("clearance-snapshot");
  await savedSnapshot.getByText("人工确认清单", { exact: true }).waitFor();
  const unconfirmedNote = savedSnapshot.getByTestId(
    "snapshot-unconfirmed-note",
  );
  await unconfirmedNote.filter({ hasText: "台架位置" }).waitFor();
  await unconfirmedNote.filter({ hasText: "观测完整性" }).waitFor();
  await savedSnapshot
    .getByTestId("snapshot-check-material-identity")
    .getByText("已确认", { exact: true })
    .waitFor();

  // 刷新后确认结果仍然保留
  await page.reload({ waitUntil: "networkidle" });
  await page
    .getByTestId("checklist-item-material-identity")
    .getByText("已确认", { exact: true })
    .waitFor();

  // 确认后台架发生变化 → 清单提示已变化
  await page.getByTestId("checklist-confirm-bench-placement").click();
  const benchItem = page.getByTestId("checklist-item-bench-placement");
  await benchItem.getByText("已确认", { exact: true }).waitFor();

  // 其他试验调整台架分配 → 不应影响当前试验的确认
  await page.goto(`${baseUrl}/#/layout`, { waitUntil: "networkidle" });
  await page.getByTestId("layout-trial-select").selectOption("trial-ama-02");
  await page
    .getByRole("button", { name: "将 Chioggia 从台架 W-2 移出" })
    .click();
  await page.getByText("材料已移出", { exact: true }).waitFor();
  await page.goto(`${baseUrl}/#/clearance`, { waitUntil: "networkidle" });
  await assertCount(
    benchItem.getByText("已变化", { exact: true }),
    0,
    "cross-trial bench change must not mark stale",
  );
  await benchItem.getByText("已确认", { exact: true }).waitFor();

  // 当前试验自己的台架变化 → 清单提示已变化
  await page.goto(`${baseUrl}/#/layout`, { waitUntil: "networkidle" });
  await page
    .getByTestId("assignment-accession-select")
    .selectOption("acc-tom-03");
  await page.getByTestId("assign-bench-bench-east-2").click();
  await page.getByText("台架分配成功", { exact: true }).waitFor();
  await page.goto(`${baseUrl}/#/clearance`, { waitUntil: "networkidle" });
  await benchItem.getByText("已变化", { exact: true }).waitFor();

  // 重新确认后已变化标记消除
  await page.getByTestId("checklist-confirm-bench-placement").click();
  await benchItem.getByText("已确认", { exact: true }).waitFor();
  await assertCount(
    benchItem.getByText("已变化", { exact: true }),
    0,
    "stale badge cleared after re-confirmation",
  );

  // 同一试验第二次生成快照 → 历史列表保留两份
  await page.getByTestId("generate-clearance").click();
  await page.getByTestId("snapshot-history").waitFor();
  await assertCount(
    page.locator('[data-testid^="snapshot-history-"]'),
    2,
    "snapshot history rows",
  );
  const latestSaved = page
    .locator(".clearance-preview")
    .nth(1)
    .getByTestId("clearance-snapshot");
  await latestSaved
    .getByTestId("snapshot-check-bench-placement")
    .getByText("已确认", { exact: true })
    .waitFor();

  // 回看第一份快照：确认结论保持冻结，不受后续变化影响
  await page.locator('[data-testid^="snapshot-history-"]').nth(1).click();
  const firstSnapshot = page
    .locator(".clearance-preview")
    .nth(1)
    .getByTestId("clearance-snapshot");
  await firstSnapshot
    .getByTestId("snapshot-check-bench-placement")
    .getByText("未确认", { exact: true })
    .waitFor();
  await firstSnapshot
    .getByText("复核无误，标签一致。", { exact: false })
    .waitFor();
  await firstSnapshot
    .getByTestId("snapshot-unconfirmed-note")
    .filter({ hasText: "台架位置" })
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
