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
  "revise-observation-pass": reviseObservationPass,
};

const scenarioPaths = {
  "curate-accession-roster": "/roster",
  "assign-accession-bench": "/layout",
  "record-observation-pass": "/observations",
  "advance-trial-clearance": "/clearance",
  "retire-accession-replacement": "/roster",
  "revise-observation-pass": "/observations",
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

async function reviseObservationPass(page) {
  // 先生成一份放行快照，之后用于验证"快照生成后发生修订"的提示。
  await page.goto(`${baseUrl}/#/clearance`, { waitUntil: "networkidle" });
  await page.getByTestId("generate-clearance").click();
  await page.getByText("放行被阻止", { exact: true }).waitFor();

  await page.goto(`${baseUrl}/#/observations`, { waitUntil: "networkidle" });
  await page.getByTestId("revise-pass-obs-tom-01").click();
  await page.getByTestId("revision-impact").waitFor();
  await page
    .locator(".entry-row")
    .first()
    .locator('input[type="number"]')
    .nth(0)
    .fill("45");
  await page.getByTestId("reviser-input").fill("K. Mori");
  await page
    .getByTestId("revision-reason-input")
    .fill("株高读数誊写错误，按原始记录更正。");
  await page.getByTestId("save-revision-button").click();
  await page.getByText("观测已更正", { exact: true }).waitFor();
  await page.getByText("v2 · 修订版", { exact: true }).waitFor();

  // 更正后旧标记失效、新标记接替，未处理标记仍为 1 个。
  const flagPanel = page.getByTestId("flag-panel");
  await flagPanel.getByText("HT_UNDER", { exact: true }).first().waitFor();

  await page.getByTestId("revision-chain-obs-tom-01").click();
  const chain = page.getByTestId("revision-chain");
  await chain
    .getByTestId("revision-version-1")
    .getByText("v1 · 已被取代", { exact: true })
    .waitFor();
  await chain
    .getByTestId("revision-version-2")
    .getByText("v2 · 当前版本", { exact: true })
    .waitFor();
  await chain.getByText("株高读数誊写错误，按原始记录更正。", { exact: true }).waitFor();
  await chain.getByText("已失效", { exact: true }).first().waitFor();
  await chain.getByText("由 v2 的标记接替", { exact: true }).waitFor();
  await chain.getByText("接替 v1 的同名标记", { exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭对话框" }).click();

  // 重复修订：基于 v2 再更正一次，标记随新数据消失。
  await page.getByTestId("revise-pass-obs-tom-01").click();
  await page
    .locator(".entry-row")
    .first()
    .locator('input[type="number"]')
    .nth(0)
    .fill("120");
  await page.getByTestId("reviser-input").fill("K. Mori");
  await page
    .getByTestId("revision-reason-input")
    .fill("复核原始记录，株高应为 120 毫米。");
  await page.getByTestId("save-revision-button").click();
  await page.getByText("v3 · 修订版", { exact: true }).waitFor();
  await page.getByText("该试验没有未处理的标记。", { exact: true }).waitFor();

  // 重复提交保护：内容没有变化时拒绝产生空修订。
  await page.getByTestId("revise-pass-obs-tom-01").click();
  await page.getByTestId("reviser-input").fill("K. Mori");
  await page
    .getByTestId("revision-reason-input")
    .fill("尝试重复提交相同内容。");
  await page.getByTestId("save-revision-button").click();
  await page
    .getByText("更正内容与当前版本一致，未检测到需要更正的变化", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "取消" }).click();

  // 刷新后版本链仍可追溯（本地持久化往返）。
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("revision-chain-obs-tom-01").click();
  const reloadedChain = page.getByTestId("revision-chain");
  await reloadedChain
    .getByTestId("revision-version-3")
    .getByText("v3 · 当前版本", { exact: true })
    .waitFor();
  await reloadedChain
    .getByTestId("revision-version-2")
    .getByText("v2 · 已被取代", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "关闭对话框" }).click();

  // 旧放行快照保持不可变，但会提示其结论基于修订前的数据。
  await page.goto(`${baseUrl}/#/clearance`, { waitUntil: "networkidle" });
  const banner = page.getByTestId("snapshot-stale-banner");
  await banner.waitFor();
  await banner.getByText("次观测修订生效", { exact: false }).waitFor();
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
