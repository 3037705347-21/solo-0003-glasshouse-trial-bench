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
  "review-today-workbench": reviewTodayWorkbench,
};

const scenarioPaths = {
  "curate-accession-roster": "/roster",
  "assign-accession-bench": "/layout",
  "record-observation-pass": "/observations",
  "advance-trial-clearance": "/clearance",
  "retire-accession-replacement": "/roster",
  "review-today-workbench": "/workbench",
};

const WORKSPACE_STORAGE_KEY = "glasshouse-trial-bench:workspace:v1";

async function seedWorkspace(page, mutate) {
  const stored = await page.evaluate((key) => {
    const raw = window.localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  }, WORKSPACE_STORAGE_KEY);
  if (!stored || !stored.state) {
    throw new Error("workspace state missing from local storage");
  }
  mutate(stored.state);
  stored.savedAt = new Date().toISOString();
  await page.evaluate(
    ({ key, value }) => window.localStorage.setItem(key, JSON.stringify(value)),
    { key: WORKSPACE_STORAGE_KEY, value: stored },
  );
}

function isoInDays(days) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

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

async function reviewTodayWorkbench(page) {
  // 1. 预置数据：SOL-01 放行节点临近；同一材料 acc-tom-01 同时命中两个开放标记。
  await seedWorkspace(page, (state) => {
    const sol = state.trials.find((trial) => trial.id === "trial-sol-01");
    sol.endDate = isoInDays(5);
    state.flags.push({
      id: "flag-tom-dup",
      trialId: "trial-sol-01",
      accessionId: "acc-tom-01",
      observationPassId: "obs-tom-01",
      code: "LEAF_LOW",
      message: "Tiny Tim 的真叶数少于 5 片",
      severity: "warning",
      state: "open",
      createdOn: "2026-02-26T09:05:00.000Z",
    });
  });
  await page.reload({ waitUntil: "networkidle" });

  await page.getByText("今日待办", { exact: false }).first().waitFor();
  await page.getByTestId("workbench-item-wb-flag-flag-tom-01").waitFor();
  await page.getByTestId("workbench-item-wb-flag-flag-tom-dup").waitFor();
  await page
    .getByTestId("workbench-group-accession-acc-tom-01")
    .getByText("同一对象 2 条提醒", { exact: true })
    .waitFor();
  // 临近放行事项（结束日期被推到 5 天后）。
  await page.getByTestId("workbench-item-wb-clearance-trial-sol-01").waitFor();
  // 逾期的观测计划（最近观测远早于今天）。
  await page
    .getByTestId("workbench-item-wb-observation-trial-sol-01")
    .getByText("已逾期", { exact: true })
    .waitFor();

  // 2. 按试验 + 对象类型筛选。
  await page.getByTestId("workbench-trial-filter").selectOption("trial-ama-02");
  await page.getByTestId("workbench-item-wb-flag-flag-bee-01").waitFor();
  await assertCount(
    page.getByTestId(/workbench-item-wb-flag-flag-tom/),
    0,
    "other trial flags hidden by trial filter",
  );
  await page.getByTestId("workbench-trial-filter").selectOption("all");
  await page.getByTestId("workbench-object-filter").selectOption("bench");
  await page.getByTestId("workbench-item-wb-bench-bench-north-2").waitFor();
  await assertCount(
    page.getByTestId(/workbench-item-wb-flag/),
    0,
    "flags hidden by bench object filter",
  );
  await page.getByTestId("workbench-object-filter").selectOption("all");
  await page.getByTestId("workbench-status-filter").selectOption("overdue");
  await page
    .getByTestId("workbench-item-wb-observation-trial-sol-01")
    .waitFor();
  // 临近放行不属于逾期，状态筛选下应被隐藏。
  await assertCount(
    page.getByTestId("workbench-item-wb-clearance-trial-sol-01"),
    0,
    "upcoming clearance hidden by overdue filter",
  );
  await page.getByTestId("workbench-status-filter").selectOption("all");

  // 3. 点击开放标记深链跳回观测工作流，处理后工作台立即反映（无需另存副本）。
  await page
    .getByTestId("workbench-item-wb-flag-flag-tom-dup")
    .click();
  await page.waitForURL(/\/observations/);
  await page.getByTestId("flag-panel").waitFor();
  await page
    .getByTestId("flag-resolution-note")
    .fill("已补充真叶计数并复核，该标记解除。");
  await page.getByTestId("resolve-flag").click();
  await page.goto(`${baseUrl}/#/workbench`, { waitUntil: "networkidle" });
  await assertCount(
    page.getByTestId("workbench-item-wb-flag-flag-tom-dup"),
    0,
    "resolved flag removed from workbench",
  );
  const group = page.getByTestId("workbench-group-accession-acc-tom-01");
  await group.getByTestId("workbench-item-wb-flag-flag-tom-01").waitFor();
  await assertCount(
    group.getByText("同一对象 2 条提醒", { exact: true }),
    0,
    "multi-reminder count clears after one item resolved",
  );

  // 4. 暂停试验：旧提醒保留但冻结为“已暂停”，不再显示逾期。
  await page
    .getByTestId("workbench-item-wb-observation-trial-sol-01")
    .click();
  await page.waitForURL(/\/clearance|\/observations/);
  await page.goto(`${baseUrl}/#/clearance?trial=trial-sol-01`, {
    waitUntil: "networkidle",
  });
  await page.getByTestId("toggle-trial-pause").click();
  await page.getByText("试验已暂停", { exact: true }).waitFor();
  await page.goto(`${baseUrl}/#/workbench`, { waitUntil: "networkidle" });
  const pausedObservation = page.getByTestId(
    "workbench-item-wb-observation-trial-sol-01",
  );
  await pausedObservation.getByText("已暂停", { exact: true }).waitFor();
  await assertCount(
    pausedObservation.getByText("已逾期", { exact: true }),
    0,
    "paused trial observation is not overdue",
  );
  const pausedFlag = page.getByTestId(
    "workbench-item-wb-flag-flag-tom-01",
  );
  await pausedFlag.getByText("已暂停", { exact: true }).waitFor();
  // 其他试验的提醒不受暂停影响。
  await page
    .getByTestId("workbench-item-wb-flag-flag-bee-01")
    .getByText("待处理", { exact: true })
    .waitFor();

  // 5. 恢复试验后提醒重新按截止状态汇总。
  await page.goto(`${baseUrl}/#/clearance?trial=trial-sol-01`, {
    waitUntil: "networkidle",
  });
  await page.getByTestId("toggle-trial-pause").click();
  await page.getByText("试验已恢复", { exact: true }).waitFor();
  await page.goto(`${baseUrl}/#/workbench`, { waitUntil: "networkidle" });
  await page
    .getByTestId("workbench-item-wb-observation-trial-sol-01")
    .getByText("已逾期", { exact: true })
    .waitFor();

  // 6. 处理完成后再点“重新汇总”，已完成事项不会回流。
  await page.getByTestId("workbench-refresh").click();
  await assertCount(
    page.getByTestId("workbench-item-wb-flag-flag-tom-dup"),
    0,
    "resolved item stays gone after manual refresh",
  );

  // 7. 没有到期事项时展示空状态（清空全部工作区记录）。
  await page.evaluate((key) => {
    const empty = {
      version: 1,
      savedAt: new Date().toISOString(),
      state: {
        trials: [],
        accessions: [],
        benches: [],
        observationPasses: [],
        flags: [],
        clearanceSnapshots: [],
      },
    };
    window.localStorage.setItem(key, JSON.stringify(empty));
  }, WORKSPACE_STORAGE_KEY);
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText("今天没有到期事项", { exact: true }).waitFor();
  await assertCount(page.locator(".workbench-item"), 0, "empty workbench rows");
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
