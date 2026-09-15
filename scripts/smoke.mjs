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
  "evolve-rules-reinterpret": evolveRulesReinterpret,
};

const scenarioPaths = {
  "curate-accession-roster": "/roster",
  "assign-accession-bench": "/layout",
  "record-observation-pass": "/observations",
  "advance-trial-clearance": "/clearance",
  "retire-accession-replacement": "/roster",
  "evolve-rules-reinterpret": "/rules",
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

function todayDateOnly() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

async function publishRuleSet(page, { name, note, thresholdValue }) {
  await page.getByTestId("open-publish-ruleset").click();
  await page.getByTestId("ruleset-name").fill(name);
  await page.getByTestId("ruleset-effective-from").fill(todayDateOnly());
  await page.getByTestId("ruleset-note").fill(note);
  await page.getByTestId("threshold-value-0").fill(thresholdValue);
  await page.getByTestId("publish-ruleset-button").click();
  await page.getByText("规则版本已发布", { exact: true }).waitFor();
}

async function reinterpretPass(page, { created, superseded, carried, note }) {
  await page.getByTestId("reinterpret-obs-tom-01").click();
  await page.getByTestId("reinterpret-dialog").waitFor();
  const stats = {
    created: page.getByTestId("reinterpret-created"),
    superseded: page.getByTestId("reinterpret-superseded"),
    carried: page.getByTestId("reinterpret-carried"),
  };
  for (const [key, expected] of Object.entries({ created, superseded, carried })) {
    const text = await stats[key].innerText();
    if (!text.startsWith(String(expected))) {
      throw new Error(`reinterpret ${key}: expected ${expected}, got "${text}"`);
    }
  }
  await page.getByTestId("reinterpret-note").fill(note);
  await page.getByTestId("confirm-reinterpret").click();
  await page.getByText("重新解释完成", { exact: true }).waitFor();
}

async function evolveRulesReinterpret(page) {
  // 基线规则由迁移生成，历史观测与标记都盖有基线溯源。
  await page.getByTestId("ruleset-ruleset-baseline-v1").waitFor();
  await page.getByText("基线规则 v1", { exact: true }).waitFor();

  // 发布 v2：株高下限阈值 60 → 70，今日生效（试验中途生效）。
  await publishRuleSet(page, {
    name: "春季复核阈值",
    note: "春季复核后收紧株高判定阈值。",
    thresholdValue: "70",
  });
  await page.getByText("春季复核阈值 v2", { exact: true }).waitFor();

  // 放行快照记录生成时的规则版本。
  await page.goto(`${baseUrl}/#/clearance`, { waitUntil: "networkidle" });
  await page.getByTestId("generate-clearance").click();
  await page.getByText("放行被阻止", { exact: true }).waitFor();
  const savedSnapshot = page
    .locator(".clearance-preview")
    .nth(1)
    .getByTestId("clearance-snapshot");
  await savedSnapshot.getByText("判定依据：春季复核阈值 v2").waitFor();

  // 历史观测仍归属基线规则；按当前规则重新解释后新增一个标记。
  await page.goto(`${baseUrl}/#/observations`, { waitUntil: "networkidle" });
  await page
    .getByTestId("pass-obs-tom-01")
    .getByText("基线规则 v1", { exact: true })
    .waitFor();
  await reinterpretPass(page, {
    created: 1,
    superseded: 0,
    carried: 1,
    note: "按春季复核阈值重新判定历史观测。",
  });
  await assertCount(page.locator(".flag-list-item"), 2, "open flags after reinterpret");

  // 人工解决其中一个标记：该决定属于人工结论，后续重新解释必须保留。
  await page.getByTestId("flag-resolution-note").fill("已复核，该材料已恢复生长。");
  await page.getByTestId("resolve-flag").click();
  await page
    .getByTestId("flag-history-flag-tom-01")
    .getByText("已解决", { exact: true })
    .waitFor();

  // 发布 v3：株高阈值放宽到 50。
  await page.goto(`${baseUrl}/#/rules`, { waitUntil: "networkidle" });
  await publishRuleSet(page, {
    name: "苗期放宽阈值",
    note: "苗期数据复核后放宽株高判定。",
    thresholdValue: "50",
  });
  await page.getByText("苗期放宽阈值 v3", { exact: true }).waitFor();

  // 已保存快照不随规则变化改写，但会提示判定规则已更新。
  await page.goto(`${baseUrl}/#/clearance`, { waitUntil: "networkidle" });
  await page.getByText("规则已更新，建议重新生成", { exact: true }).waitFor();
  await savedSnapshot.getByText("判定依据：春季复核阈值 v2").waitFor();

  // 再次重新解释：未处理标记被取代，人工已解决的结论原样保留。
  await page.goto(`${baseUrl}/#/observations`, { waitUntil: "networkidle" });
  await reinterpretPass(page, {
    created: 0,
    superseded: 1,
    carried: 0,
    note: "按苗期放宽阈值重新判定。",
  });
  const flagHistory = page.getByTestId("flag-history");
  await flagHistory.getByText("已被规则取代", { exact: true }).waitFor();
  await page
    .getByTestId("flag-history-flag-tom-01")
    .getByText("已解决", { exact: true })
    .waitFor();

  // 更正：已解决的标记可以带说明重开，原结论留在修订历史中。
  await page.getByTestId("correct-flag-flag-tom-01").click();
  await page.getByTestId("correct-flag-note").fill("复核后发现处理结论有误，重新打开。");
  await page.getByTestId("confirm-correct-flag").click();
  await assertCount(page.locator(".flag-list-item"), 1, "open flags after correction");

  // 旧版本工作区（无规则版本数据）加载时迁移到基线规则，行为不变。
  const legacyState = {
    trials: [
      {
        id: "trl-legacy",
        code: "LEG-01",
        cropFamily: "茄科",
        objective: "旧版本工作区迁移验证试验。",
        season: "春季",
        startDate: "2026-02-01",
        endDate: "2026-06-01",
        state: "active",
      },
    ],
    accessions: [
      {
        id: "acc-legacy",
        trialId: "trl-legacy",
        accessionNo: "ACC-9001",
        cultivar: "Legacy",
        source: "Old Lab",
        propagatedOn: "2026-02-02",
        quantity: 24,
        trayCells: 72,
        preferredLight: "full-sun",
        genotypeNote: "旧格式材料记录。",
        labels: [],
        lifecycleStatus: "active",
        retirementHistory: [],
      },
    ],
    benches: [],
    observationPasses: [
      {
        id: "obs-legacy",
        trialId: "trl-legacy",
        observedOn: "2026-03-01",
        observer: "Old Observer",
        entries: [
          { accessionId: "acc-legacy", heightMm: 55, leafCount: 6, ecMs: 1.5, notes: "" },
        ],
      },
    ],
    flags: [
      {
        id: "flag-legacy",
        trialId: "trl-legacy",
        accessionId: "acc-legacy",
        observationPassId: "obs-legacy",
        code: "HT_UNDER",
        message: "Legacy 低于 60 毫米生长阈值",
        severity: "warning",
        state: "open",
        createdOn: "2026-03-01T09:00:00.000Z",
      },
    ],
    clearanceSnapshots: [],
  };
  await page.evaluate((payload) => {
    window.localStorage.setItem(
      "glasshouse-trial-bench:workspace:v1",
      JSON.stringify({
        version: 1,
        savedAt: new Date().toISOString(),
        state: payload,
      }),
    );
  }, legacyState);
  // 必须整页重载：应用只在启动时读取本地存储并执行迁移。
  await page.reload({ waitUntil: "networkidle" });
  await page.goto(`${baseUrl}/#/rules`, { waitUntil: "networkidle" });
  await page.getByTestId("ruleset-ruleset-baseline-v1").waitFor();
  await page.goto(`${baseUrl}/#/observations`, { waitUntil: "networkidle" });
  await page
    .getByTestId("pass-obs-legacy")
    .getByText("基线规则 v1", { exact: true })
    .waitFor();
  await page.getByTestId("flag-flag-legacy").waitFor();
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
