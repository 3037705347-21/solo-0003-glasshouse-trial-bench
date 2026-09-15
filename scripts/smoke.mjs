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
  "follow-up-flag-lifecycle": followUpFlagLifecycle,
};

const scenarioPaths = {
  "curate-accession-roster": "/roster",
  "assign-accession-bench": "/layout",
  "record-observation-pass": "/observations",
  "advance-trial-clearance": "/clearance",
  "retire-accession-replacement": "/roster",
  "follow-up-flag-lifecycle": "/observations",
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

async function followUpFlagLifecycle(page) {
  const selectTrial = async (trialId) => {
    await page.getByTestId("observation-trial-select").selectOption(trialId);
  };

  // --- 原处理被推翻：示例中 flag-tom-01 已被重开，流水保留了解决与重开记录 ---
  await selectTrial("trial-sol-01");
  await page.getByTestId("flag-flag-tom-01").click();
  await page
    .getByTestId("flag-history")
    .getByText("处理为解决")
    .first()
    .waitFor();
  await page
    .getByTestId("flag-history")
    .getByText("原处理结论不成立")
    .waitFor();

  // 重复操作语义：open -> resolved，旧结论进入只追加流水
  await page.getByTestId("flag-resolution-note").fill("补光后复测仍低于阈值，安排换盆并准备继续跟踪。");
  await page.getByTestId("resolve-flag").click();
  await page.getByTestId("flag-flag-tom-01").waitFor();

  // --- 复发：同代码同材料再次命中已关闭标记时生成复发跟进，不覆盖原标记 ---
  await page.getByTestId("open-observation-form").click();
  await page.getByTestId("observer-input").fill("K. Sato");
  await page
    .locator(".entry-row")
    .first()
    .locator('input[type="number"]')
    .nth(0)
    .fill("54");
  await page.getByTestId("save-observation-button").click();
  await page
    .getByText("复发跟进", { exact: false })
    .first()
    .waitFor();
  const recurrenceBadges = await page
    .locator('[data-testid^="flag-flg_"]')
    .filter({ hasText: "复发跟进" })
    .count();
  if (recurrenceBadges !== 1) {
    throw new Error(`expected one recurrence flag, got ${recurrenceBadges}`);
  }

  // 再录一次同条件观测：开放标记只追加“再次命中”，不重复建标
  const openFlagsBefore = await page
    .locator(".flag-list .flag-list-item")
    .count();
  await page.getByTestId("open-observation-form").click();
  await page.getByTestId("observer-input").fill("K. Sato");
  await page
    .locator(".entry-row")
    .first()
    .locator('input[type="number"]')
    .nth(0)
    .fill("53");
  await page.getByTestId("save-observation-button").click();
  await page.getByText("再次命中", { exact: false }).first().waitFor();
  const openFlagsAfter = await page
    .locator(".flag-list .flag-list-item")
    .count();
  if (openFlagsAfter !== openFlagsBefore) {
    throw new Error("open flag duplicated while a matching flag was already open");
  }
  // 原结论仍在原标记的流水里，复发跟进保持开放
  await page.getByRole("tab", { name: /已处理/ }).click();
  await page.getByTestId("flag-flag-tom-01").click();
  await page
    .getByTestId("flag-history")
    .getByText("处理为解决")
    .first()
    .waitFor();

  // --- 原处理被推翻：重开原标记，验证 resolved -> open 且流水继续追加 ---
  await page.getByTestId("flag-reopen-note").fill("换盆后一周复测依旧低于阈值，原处理结论被推翻。");
  await page.getByTestId("reopen-flag").click();
  await page.getByRole("tab", { name: /未处理/ }).click();
  await page.getByTestId("flag-flag-tom-01").waitFor();
  // 重新关闭，为后面的升级准备 closed 前置状态
  await page.getByTestId("flag-flag-tom-01").click();
  await page.getByTestId("flag-resolution-note").fill("重新关闭该标记，准备扩大处理范围。");
  await page.getByTestId("resolve-flag").click();

  // --- 处理范围扩大：把原标记升级为全试验跟进（需要它处于已关闭状态） ---
  await page.getByRole("tab", { name: /已处理/ }).click();
  await page.getByTestId("flag-flag-tom-01").click();
  await page.getByTestId("escalate-flag").click();
  await page.getByTestId("escalate-severity").selectOption("critical");
  await page
    .getByTestId("escalate-note")
    .fill("怀疑东翼补光和灌溉整体异常，扩大到全试验排查。");
  await page.getByTestId("confirm-escalate-flag").click();
  await page
    .locator('[data-testid^="flag-flg_"]')
    .filter({ hasText: "升级跟进" })
    .first()
    .waitFor();
  await page.getByRole("tab", { name: /已处理/ }).click();
  await page.getByTestId("flag-flag-tom-01").click();
  await page.getByText("已被", { exact: false }).waitFor();
  // 已取代标记不允许重开或再次升级
  await assertCount(page.getByTestId("reopen-flag"), 0, "reopen on superseded flag");
  await assertCount(page.getByTestId("escalate-flag"), 0, "repeat escalation on superseded flag");

  // 示例数据中 AMA-02 预置了 豁免 -> 升级 的完整链，旧结论保留在流水里
  await selectTrial("trial-ama-02");
  await page.getByRole("tab", { name: /已处理/ }).click();
  await page.getByTestId("flag-flag-bee-01").click();
  await page.getByText("已随升级关闭").waitFor();
  await page.getByTestId("flag-history").getByText("处理为豁免").waitFor();
  await page.getByTestId("flag-history").getByText("扩大处理范围").waitFor();
  // 已取代标记可以跳到全试验跟进标记
  await page.getByTestId("jump-flag-flag-bee-02").click();
  await page
    .getByTestId("flag-flag-bee-02")
    .filter({ hasText: "升级跟进" })
    .waitFor();

  // --- 当前放行判断可信：试验级跟进即使在材料级筛选下仍阻止放行 ---
  await page.goto(`${baseUrl}/#/clearance`, { waitUntil: "networkidle" });
  await page.getByTestId("clearance-trial-select").selectOption("trial-ama-02");
  await page
    .getByTestId("clearance-snapshot")
    .first()
    .getByText("阻止", { exact: true })
    .waitFor();
  await page
    .getByText("升级为全试验范围", { exact: false })
    .first()
    .waitFor();
  // 已保存的旧快照保持不变（本场景开始时未生成过快照，先生成一份再制造变化）
  await page.getByTestId("generate-clearance").click();
  const savedBefore = await page
    .locator(".clearance-preview")
    .nth(1)
    .getByTestId("clearance-snapshot")
    .innerText();

  // SOL-01 刚刚升级产生新的试验级开放标记，实时视图必然新增阻止项
  await page.getByTestId("clearance-trial-select").selectOption("trial-sol-01");
  await page
    .getByTestId("clearance-snapshot")
    .first()
    .getByText("阻止", { exact: true })
    .waitFor();
  await page.getByTestId("clearance-trial-select").selectOption("trial-ama-02");
  const savedAfter = await page
    .locator(".clearance-preview")
    .nth(1)
    .getByTestId("clearance-snapshot")
    .innerText();
  if (savedAfter !== savedBefore) {
    throw new Error("saved clearance snapshot changed after new follow-up flags");
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
