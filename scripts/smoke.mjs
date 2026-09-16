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
  "configure-number-rules": configureNumberRules,
  "batch-import-accessions": batchImportAccessions,
  "copy-trial-numbers": copyTrialNumbers,
  "assign-accession-bench": assignAccessionBench,
  "record-observation-pass": recordObservationPass,
  "advance-trial-clearance": advanceTrialClearance,
  "retire-accession-replacement": retireAccessionReplacement,
};

const scenarioPaths = {
  "curate-accession-roster": "/roster",
  "configure-number-rules": "/roster",
  "batch-import-accessions": "/roster",
  "copy-trial-numbers": "/roster",
  "assign-accession-bench": "/layout",
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
  // Configure a trial-scoped number rule, then create a material that gets
  // its number from the rule preview.
  await page.getByTestId("open-number-rules").click();
  await page.getByTestId("open-create-rule").click();
  await page.getByTestId("rule-name-input").fill("茄科日序号");
  await page.getByTestId("rule-prefix").fill("SOL");
  await page.getByTestId("save-number-rule").click();
  await page.getByText("茄科日序号", { exact: true }).waitFor();
  await page.getByTestId("dialog-close").click();

  await page.getByTestId("open-create-accession").click();
  await page.getByTestId("number-rule-hint").getByText("茄科日序号").waitFor();
  await page.getByTestId("cultivar-input").fill("Stupice");
  await page.getByLabel("来源").fill("Glasshouse Exchange");
  await page.getByLabel("繁殖日期").fill("2026-02-21");
  await page.getByLabel("数量").fill("72");
  await page.locator("textarea").first().fill("Compact heirloom line with uniform early habit.");
  await page.getByTestId("save-accession-button").click();
  await page.getByText("Stupice", { exact: true }).first().waitFor();
  await page.getByText("SOL-20260221-001", { exact: true }).first().waitFor();

  // The rule now has history: its delete control must stay disabled.
  await page.getByTestId("open-number-rules").click();
  const usedRuleRow = page.locator('[data-testid^="rule-row-"]', {
    hasText: "茄科日序号",
  });
  const deleteUsed = usedRuleRow.getByTestId(/^delete-rule-/);
  if (!(await deleteUsed.isDisabled())) {
    throw new Error("rule referenced by history should not be deletable");
  }
  await page.getByTestId("dialog-close").click();
}

async function configureNumberRules(page) {
  // Two different sources sharing one prefix must be rejected while both
  // rules are active, but accepted after one is stopped.
  await page.getByTestId("open-number-rules").click();
  await page.getByTestId("open-create-rule").click();
  await page.getByTestId("rule-name-input").fill("来源 A 规则");
  await page.getByTestId("rule-scope-type").selectOption("source");
  await page.getByTestId("rule-scope-value").fill("Pioneer Seed Lab");
  await page.getByTestId("rule-prefix").fill("PSL");
  await page.getByTestId("rule-date-part").selectOption("yearMonth");
  await page.getByTestId("save-number-rule").click();
  await page.getByText("来源 A 规则", { exact: true }).waitFor();

  await page.getByTestId("open-create-rule").click();
  await page.getByTestId("rule-name-input").fill("来源 B 规则");
  await page.getByTestId("rule-scope-type").selectOption("source");
  await page.getByTestId("rule-scope-value").fill("Other Source Co");
  await page.getByTestId("rule-prefix").fill("PSL");
  await page.getByTestId("rule-date-part").selectOption("yearMonth");
  await page.getByTestId("save-number-rule").click();
  await page
    .getByText("已使用相同的前缀、日期和序号组合", { exact: false })
    .waitFor();

  // Stopping rule A frees the signature for rule B.
  await page.getByRole("button", { name: "返回列表" }).click();
  const ruleARow = page.locator('[data-testid^="rule-row-"]', {
    hasText: "来源 A 规则",
  });
  await ruleARow.getByTestId(/^toggle-rule-/).click();
  await ruleARow.getByText("已停用", { exact: false }).waitFor();
  await page.getByTestId("open-create-rule").click();
  await page.getByTestId("rule-name-input").fill("来源 B 规则");
  await page.getByTestId("rule-scope-type").selectOption("source");
  await page.getByTestId("rule-scope-value").fill("Other Source Co");
  await page.getByTestId("rule-prefix").fill("PSL");
  await page.getByTestId("rule-date-part").selectOption("yearMonth");
  await page.getByTestId("save-number-rule").click();
  await page.getByText("来源 B 规则", { exact: true }).waitFor();

  // The stopped, unused rule A can be deleted; history-bound rules cannot.
  await page
    .locator('[data-testid^="rule-row-"]', { hasText: "来源 A 规则" })
    .getByTestId(/^delete-rule-/)
    .click();
  await page.getByTestId("dialog-close").click();
}

async function batchImportAccessions(page) {
  await page.getByTestId("open-import-accessions").click();
  await page.getByTestId("fill-import-template").click();
  // Template row has no rule configured: it must surface the missing-rule
  // problem instead of silently inventing a number.
  await page.getByText("没有匹配的启用编号规则", { exact: false }).waitFor();

  // Configure a source rule matching the template row, then re-preview.
  await page.getByTestId("dialog-close").click();
  await page.getByTestId("open-number-rules").click();
  await page.getByTestId("open-create-rule").click();
  await page.getByTestId("rule-name-input").fill("交换来源");
  await page.getByTestId("rule-scope-type").selectOption("source");
  await page.getByTestId("rule-scope-value").fill("Glasshouse Exchange");
  await page.getByTestId("rule-prefix").fill("GE");
  await page.getByTestId("rule-date-part").selectOption("yearMonthDay");
  await page.getByTestId("save-number-rule").click();
  await page.getByTestId("dialog-close").click();

  await page.getByTestId("open-import-accessions").click();
  await page.getByTestId("import-row-0").getByText("GE-20260916-001").waitFor();
  await page.getByTestId("confirm-import-accessions").click();
  await page.getByText("批量导入完成", { exact: true }).waitFor();
  await page.getByText("GE-20260916-001", { exact: true }).first().waitFor();

  // Re-importing the same line must advance the sequence instead of colliding.
  await page.getByTestId("open-import-accessions").click();
  await page.getByTestId("fill-import-template").click();
  await page.getByTestId("import-row-0").getByText("GE-20260916-002").waitFor();
  await page.getByTestId("dialog-close").click();
}

async function copyTrialNumbers(page) {
  // Give every existing trial-scoped material a common active rule first.
  await page.getByTestId("open-number-rules").click();
  await page.getByTestId("open-create-rule").click();
  await page.getByTestId("rule-name-input").fill("茄科复制规则");
  await page.getByTestId("rule-prefix").fill("SOLC");
  await page.getByTestId("rule-date-part").selectOption("yearMonthDay");
  await page.getByTestId("save-number-rule").click();
  await page.getByTestId("dialog-close").click();

  await page.getByTestId("open-copy-trial").click();
  await page.getByTestId("copy-trial-code").fill("SOL-09");
  await page.getByLabel("试验目标").fill("复制番茄批次并在秋季复测坐果表现。");
  // Legacy accessions without provenance fall back to scope matching.
  await page.getByTestId("copy-trial-preview").getByText("SOLC-20260916-001").waitFor();
  await page.getByRole("button", { name: "取消" }).click();

  // Stop the rule: rows that used it as provenance must be explicitly skipped.
  await page.getByTestId("open-number-rules").click();
  const copyRuleRow = page.locator('[data-testid^="rule-row-"]', {
    hasText: "茄科复制规则",
  });
  await copyRuleRow.getByTestId(/^toggle-rule-/).click();
  await copyRuleRow.getByText("已停用", { exact: false }).waitFor();
  await page.getByTestId("dialog-close").click();

  await page.getByTestId("open-copy-trial").click();
  await page.getByTestId("copy-trial-code").fill("SOL-09");
  await page.getByLabel("试验目标").fill("复制番茄批次并在秋季复测坐果表现。");
  await page.getByText("没有匹配的启用编号规则", { exact: false }).first().waitFor();
  // With every provenance rule stopped, no material is copyable.
  const confirmStopped = page.getByTestId("confirm-copy-trial");
  if (!(await confirmStopped.isDisabled())) {
    throw new Error("copy must be blocked while no material can be renumbered");
  }
  await page.getByText("没有可复制的材料", { exact: false }).waitFor();
  await page.getByRole("button", { name: "取消" }).click();

  // Reactivate and run the real copy with the same rule; no collision allowed.
  await page.getByTestId("open-number-rules").click();
  await copyRuleRow.getByTestId(/^toggle-rule-/).click();
  await page.getByTestId("dialog-close").click();
  await page.getByTestId("open-copy-trial").click();
  await page.getByTestId("copy-trial-code").fill("SOL-09");
  await page.getByLabel("试验目标").fill("复制番茄批次并在秋季复测坐果表现。");
  await page.getByTestId("copy-trial-preview").getByText("SOLC-20260916-001").waitFor();
  await page.getByTestId("copy-trial-preview").getByText("SOLC-20260916-003").waitFor();
  await page.getByTestId("confirm-copy-trial").click();
  await page.getByText("试验 SOL-09 已创建", { exact: true }).waitFor();
  await page.getByTestId("trial-filter").selectOption({ label: /SOL-09/ });
  await page.getByText("SOLC-20260916-001", { exact: true }).waitFor();
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
