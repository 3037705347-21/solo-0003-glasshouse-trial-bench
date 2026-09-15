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
  "plan-multi-batch-allocation": planMultiBatchAllocation,
  "record-observation-pass": recordObservationPass,
  "advance-trial-clearance": advanceTrialClearance,
  "retire-accession-replacement": retireAccessionReplacement,
};

const scenarioPaths = {
  "curate-accession-roster": "/roster",
  "assign-accession-bench": "/layout",
  "plan-multi-batch-allocation": "/planning",
  "record-observation-pass": "/observations",
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

async function planMultiBatchAllocation(page) {
  // 1. Generate an offline plan over all three batches (default horizon covers
  //    the W-2 maintenance window 2026-09-28..2026-10-02).
  await page.getByTestId("generate-plan").click();
  const planPanel = page.locator('[data-testid^="plan-panel-"]').first();
  await planPanel.waitFor();
  await planPanel.getByText("PLAN-001").waitFor();

  // 2. Explainable suggestions: Chioggia (acc-bee-03) is forced off W-2 by
  //    maintenance and grouped with its batch on W-1.
  const beeRow = page.getByTestId("plan-item-acc-bee-03");
  await beeRow.getByText("迁移").waitFor();
  await beeRow.getByText(/维修/).waitFor();
  await beeRow.locator("select").selectOption("bench-west-1");
  await beeRow.getByText("人工钉选").waitFor();

  // 3. Revalidation: pinning Chioggia back onto W-2 (under maintenance) is a
  //    hard conflict; apply must be disabled.
  await beeRow.locator("select").selectOption("bench-west-2");
  await beeRow.getByText("已失效").waitFor();
  const applyButton = planPanel.getByTestId(/plan-apply-/);
  await applyButton.isDisabled().then((disabled) => {
    if (!disabled) throw new Error("apply should stay disabled on hard conflict");
  });

  // 4. Restore planner suggestion; the plan becomes applicable and explains it.
  await planPanel.getByTestId(/plan-clear-edits-/).click();
  await page.getByText("已恢复规划器建议", { exact: true }).waitFor();
  await page.getByText("全部建议当前仍有效，可直接应用").waitFor();

  // 5. Discard this draft: it enters a terminal, read-only state with no
  //    apply or edit controls, and must not be able to touch the field.
  await planPanel.getByTestId(/plan-discard-/).click();
  await planPanel.getByText("已废弃 · 终态只读").waitFor();
  await assertCount(planPanel.getByTestId(/plan-apply-/), 0, "apply control on discarded");
  await assertCount(planPanel.locator("select"), 0, "editable targets on discarded");

  // 6. Toggle off "relocate before maintenance" and regenerate. Chioggia,
  //    physically on the maintenance bench W-2, is retained in place and the
  //    plan remains applicable; W-2 still must not accept new placement.
  await page.getByTestId("planning-maintenance-toggle").uncheck();
  await page.getByTestId("generate-plan").click();
  const retainedPanel = page.locator('[data-testid^="plan-panel-"]').first();
  await retainedPanel.getByText("PLAN-002").waitFor();
  const retainedRow = page.getByTestId("plan-item-acc-bee-03");
  await retainedRow.getByText("保持原位").waitFor();
  await retainedRow.getByText(/已关闭“维修期提前迁移”/).waitFor();
  const retainedApply = retainedPanel.getByTestId(/plan-apply-/);
  await retainedApply.isEnabled().then((enabled) => {
    if (!enabled) throw new Error("retained-on-maintenance plan must still apply");
  });
  // W-2 is offered in the selector only as the in-place retention for Chioggia,
  // never as a feasible target for the other partial-shade accessions.
  const kaleTarget = page
    .getByTestId("plan-item-acc-kale-01")
    .locator("select option[value='bench-west-2']");
  await assertCount(kaleTarget, 0, "maintenance bench offered as fresh target");

  // 7. Apply the retained plan: Chioggia stays on W-2, occupancy stays within
  //    capacity, and the live layout confirms the field was not disrupted.
  await retainedPanel.getByTestId(/plan-apply-/).click();
  await page.getByText("计划已应用到现场", { exact: true }).waitFor();
  await page.goto(`${baseUrl}/#/layout`, { waitUntil: "networkidle" });
  const westTwo = page.getByTestId("bench-card-bench-west-2");
  await westTwo.getByText("Chioggia").waitFor();
  const freeAfter = await westTwo.locator("dd").nth(2).innerText();
  if (freeAfter !== "4") {
    throw new Error(`W-2 free slots should be 4 after retained apply, got ${freeAfter}`);
  }
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
