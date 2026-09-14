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
  "review-snapshot-ledger": reviewSnapshotLedger,
};

const scenarioPaths = {
  "curate-accession-roster": "/roster",
  "assign-accession-bench": "/layout",
  "record-observation-pass": "/observations",
  "advance-trial-clearance": "/clearance",
  "review-snapshot-ledger": "/clearance/ledger",
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

const STORAGE_KEY = "glasshouse-trial-bench:workspace:v1";

async function editAccessionSource(page, accessionId, source) {
  await page.goto(`${baseUrl}/#/roster`, { waitUntil: "networkidle" });
  await page.getByTestId(`edit-accession-${accessionId}`).click();
  await page.getByLabel("来源").fill(source);
  await page.getByTestId("save-accession-button").click();
  await page.getByText("材料已更新", { exact: true }).first().waitFor();
}

async function storedWorkspace(page) {
  const raw = await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
  return JSON.parse(raw).state;
}

async function seedWorkspace(page, mutator) {
  const state = await storedWorkspace(page);
  mutator(state);
  await page.evaluate(
    ({ key, state }) =>
      window.localStorage.setItem(
        key,
        JSON.stringify({ version: 1, savedAt: new Date().toISOString(), state }),
      ),
    { key: STORAGE_KEY, state },
  );
  await page.reload({ waitUntil: "networkidle" });
  return state;
}

async function reviewSnapshotLedger(page) {
  // 1. 边界：没有快照时台账显示空状态
  await page.getByText("还没有放行快照").waitFor();
  await page.getByText("共 0 / 0 份快照").waitFor();

  // 2. 同一试验连续生成两份阻止快照
  await page.goto(`${baseUrl}/#/clearance`, { waitUntil: "networkidle" });
  await page.getByTestId("generate-clearance").click();
  await page.getByText("放行被阻止", { exact: true }).first().waitFor();
  await delay(4300); // 等首个 toast 消失，避免后续断言命中多个
  await page.getByTestId("generate-clearance").click();
  await page.getByText("放行被阻止", { exact: true }).waitFor();
  await delay(4300);

  // 3. 处理一个标记后再生成第三份，标记的变化必须让前两份变“已过期”
  await page.goto(`${baseUrl}/#/observations`, { waitUntil: "networkidle" });
  await page.getByTestId("flag-resolution-note").fill("复测已恢复正常。");
  await page.getByTestId("resolve-flag").click();
  await page.getByText("该试验没有未处理的标记。").waitFor();

  // 3b. 回归验证：修改材料来源后，所有历史快照都必须变“已过期”
  await editAccessionSource(page, "acc-tom-01", "Pioneer Seed Lab (2026 更新批次)");
  await page.goto(`${baseUrl}/#/clearance`, { waitUntil: "networkidle" });
  await delay(1100);
  await page.getByTestId("generate-clearance").click();

  // 4. 台账列出全部 3 份，按时间倒序
  await page.goto(`${baseUrl}/#/clearance/ledger`, { waitUntil: "networkidle" });
  await page.getByText("共 3 / 3 份快照").waitFor();
  const rows = page.locator('[data-testid^="ledger-row-"]');
  if ((await rows.count()) !== 3) {
    throw new Error("台账应按时间列出 3 份快照");
  }

  // 5. 按试验筛选（试验切换到 AMA-02 不会有快照）
  await page.getByTestId("ledger-trial-filter").selectOption("trial-ama-02");
  await page.getByText("没有匹配的快照").waitFor();
  await page.getByTestId("ledger-trial-filter").selectOption("trial-sol-01");
  await page.getByText("共 3 / 3 份快照").waitFor();

  // 6. 按结果筛选：三份都是 blocked
  await page.getByTestId("ledger-result-filter").selectOption("ready");
  await page.getByText("没有匹配的快照").waitFor();
  await page.getByTestId("ledger-result-filter").selectOption("all");

  // 7. 按时效筛选：标记处理 + 来源修改后，最早两份必然过期
  await page.getByTestId("ledger-freshness-filter").selectOption("stale");
  const staleCount = await rows.count();
  if (staleCount !== 2) {
    throw new Error(`预期 2 份过期快照，实际 ${staleCount} 份`);
  }
  // 过期原因必须具体到材料来源的变化，而不是笼统标记（两份旧快照都应出现）
  await page
    .getByText(/来源：Pioneer Seed Lab → Pioneer Seed Lab \(2026 更新批次\)/)
    .first()
    .waitFor();
  await page.getByTestId("ledger-freshness-filter").selectOption("all");

  // 8. 打开最早的过期快照，引用关系显示标记与材料来源的当时/当前对比
  await page
    .locator('[data-testid^="ledger-row-"]')
    .last()
    .getByRole("button", { name: "查看引用" })
    .click();
  await page.getByRole("dialog").waitFor();
  const dialog = page.getByRole("dialog");
  await dialog.getByText("当时：未处理").first().waitFor();
  await dialog.getByText("当前：已解决").first().waitFor();
  // 旧快照冻结旧来源，当前来源单独展示，且该行被标记为已变化
  const changedAccession = dialog.locator('[data-testid="ref-材料-acc-tom-01"]');
  await changedAccession.getByText("当时来源：Pioneer Seed Lab；台架 E-1").waitFor();
  await changedAccession.getByText(/当前来源：Pioneer Seed Lab \(2026 更新批次\)/).waitFor();
  await changedAccession.getByText("ACC-0001 · Tiny Tim").waitFor();
  await changedAccession.getByText("已变化", { exact: true }).waitFor();
  // 历史快照内容本身不变：指标仍记录当时的未处理标记数
  await dialog.getByText("未处理标记", { exact: true }).waitFor();

  // 9. 边界：注入一份无 capture 的旧快照与引用对象已消失的快照
  await page.getByRole("button", { name: "关闭对话框" }).click();
  const orphanRefs = await seedWorkspace(page, (state) => {
    const now = new Date("2026-01-05T08:00:00.000Z").toISOString();
    state.clearanceSnapshots.push({
      id: "clr-legacy",
      trialId: "trial-sol-01",
      generatedOn: now,
      status: "blocked",
      metrics: [
        { label: "材料数", value: 3, detail: "" },
        { label: "已分配", value: 2, detail: "" },
        { label: "未处理标记", value: 1, detail: "" },
        { label: "在用台架", value: 2, detail: "" },
      ],
      blockers: [
        { code: "UNASSIGNED", message: "ACC-0003 has no bench assignment", accessionId: "acc-tom-03" },
        { code: "FLAG_HT_UNDER", message: "历史标记", accessionId: "acc-tom-01" },
      ],
    });
    state.clearanceSnapshots.push({
      id: "clr-orphan",
      trialId: "trial-gone-99",
      generatedOn: new Date("2026-01-06T08:00:00.000Z").toISOString(),
      status: "blocked",
      metrics: [],
      blockers: [
        { code: "TRIAL_DRAFT", message: "旧试验" },
        { code: "UNASSIGNED", message: "ghost", accessionId: "acc-gone-1" },
      ],
      capture: {
        schema: 1,
        capturedOn: now,
        trial: {
          id: "trial-gone-99",
          code: "GONE-99",
          cropFamily: "已删除科属",
          objective: "该试验已被删除",
          season: "冬季",
          state: "active",
        },
        accessions: [
          {
            id: "acc-gone-1",
            accessionNo: "ACC-GONE",
            cultivar: "Ghost",
            source: "old",
            quantity: 10,
            preferredLight: "shade",
            labels: [],
          },
        ],
        benches: [
          {
            id: "bench-gone-1",
            code: "X-1",
            sector: "已拆除区",
            capacity: 4,
            assignedIds: [],
            lightProfile: "shade",
            status: "available",
          },
        ],
        flags: [],
        observationPasses: [],
      },
    });
  });
  void orphanRefs;
  await page.getByText("共 5 / 5 份快照").waitFor();

  // 行内直接暴露“试验已不存在”
  await page.getByText("试验已不存在").first().waitFor();

  // 已删除的试验仍可作为筛选条件，筛出孤儿快照
  await page.getByTestId("ledger-trial-filter").selectOption("trial-gone-99");
  await page.getByText("共 1 / 5 份快照").waitFor();
  await page.getByTestId("open-snapshot-clr-orphan").waitFor();
  await page.getByTestId("ledger-trial-filter").selectOption("all");

  // 旧快照标记为无法核对
  await page.getByTestId("ledger-freshness-filter").selectOption("unverifiable");
  await page.getByTestId("ledger-row-clr-legacy").waitFor();
  await page.getByTestId("ledger-freshness-filter").selectOption("all");

  // 10. 打开孤儿快照：冻结标题不变，引用全部标记已不存在，且无任何改写入口
  await page.getByTestId("open-snapshot-clr-orphan").click();
  await page.getByRole("dialog").waitFor();
  const orphanDialog = page.getByRole("dialog");
  await orphanDialog.getByText("GONE-99 · 已删除科属").first().waitFor();
  await orphanDialog.getByText("ACC-GONE · Ghost").waitFor();
  await orphanDialog.getByText("当前：材料已不存在").waitFor();
  await orphanDialog.getByText("当前：台架已不存在").waitFor();
  await orphanDialog.getByText("当前状态：试验已不存在").waitFor();
  const destructiveButtons = await orphanDialog
    .getByRole("button")
    .filter({ hasText: /删除|改写|重新生成/ })
    .count();
  if (destructiveButtons !== 0) {
    throw new Error("台账不得提供删除、改写或重新生成入口");
  }

  // 11. 旧快照详情显示 legacy 提示，仍只读
  await page.getByRole("button", { name: "关闭对话框" }).click();
  await page.getByTestId("open-snapshot-clr-legacy").click();
  await page.getByText(/未冻结引用副本/).waitFor();
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
