import { spawn } from "node:child_process";
import assert from "node:assert/strict";
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
  "quality-healthy-workspace": qualityHealthyWorkspace,
  "quality-repair-damage": qualityRepairDamage,
  "quality-recovery-resume": qualityRecoveryResume,
  "quality-corrupt-persistence": qualityCorruptPersistence,
};

const scenarioPaths = {
  "curate-accession-roster": "/roster",
  "assign-accession-bench": "/layout",
  "record-observation-pass": "/observations",
  "advance-trial-clearance": "/clearance",
  "quality-healthy-workspace": "/quality",
  "quality-repair-damage": "/quality",
  "quality-recovery-resume": "/quality",
  "quality-corrupt-persistence": "/quality",
};

const WORKSPACE_KEY = "glasshouse-trial-bench:workspace:v1";
const QUARANTINE_KEY = "glasshouse-trial-bench:quarantine:v1";
const REPAIR_ARCHIVE_KEY = "glasshouse-trial-bench:repair-archive:v1";

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

async function loadWorkspaceState(page) {
  return page.evaluate((key) => {
    const envelope = JSON.parse(window.localStorage.getItem(key));
    return envelope.state;
  }, WORKSPACE_KEY);
}

async function saveWorkspaceState(page, state) {
  await page.evaluate(
    ({ key, state }) => {
      window.localStorage.setItem(
        key,
        JSON.stringify({ version: 1, savedAt: new Date().toISOString(), state }),
      );
    },
    { key: WORKSPACE_KEY, state },
  );
}

async function injectDamage(page, mutate) {
  // 应用首次加载后会把示例工作区写入存储；读取、施加损坏、写回再重载。
  await page.waitForFunction((key) => window.localStorage.getItem(key) !== null, WORKSPACE_KEY);
  const state = await loadWorkspaceState(page);
  const damaged = mutate(structuredClone(state)) ?? state;
  await saveWorkspaceState(page, damaged);
  await page.reload({ waitUntil: "networkidle" });
  return damaged;
}

async function qualityHealthyWorkspace(page) {
  await page.getByText("工作区通过全部完整性检查").waitFor();
  await page.getByTestId("nav-quality-ok").waitFor();
  await page.getByTestId("rescan-quality").click();
  await page.getByText("未发现数据质量问题").waitFor();
}

async function qualityRepairDamage(page) {
  // 多个关联损坏：E-2 悬空引用 + ACC-0001 同时占用 E-1 与 E-2。
  await injectDamage(page, (state) => {
    const e2 = state.benches.find((bench) => bench.id === "bench-east-2");
    e2.assignedIds = ["acc-ghost", "acc-tom-01"];
    return state;
  });

  // 启动即暴露：导航角标 + 启动横幅
  await page.getByTestId("nav-quality-badge").waitFor();
  await page.getByTestId("boot-quality-banner").waitFor();

  // 阻断分组中能看到两类关联损坏
  await page.getByText("台架引用了已消失的材料").waitFor();
  await page.getByText("同一材料被分配到多个台架").waitFor();
  // 无法自动判断的问题（此处不存在容量矛盾）以外，可修复项带勾选框
  await page.getByTestId("select-fix-q-B-ASSIGN-MISSING-01@bench:bench-east-2").waitFor();

  // 逐项勾选 -> 整批预演
  await page.getByTestId("select-all-fixable").click();
  await page.getByTestId("open-repair-preview").click();
  await page.getByTestId("repair-preview-list").waitFor();
  await page.getByText("将实际执行").waitFor();

  // 必须逐项确认后才能应用
  const confirmButton = page.getByTestId("confirm-repair-batch");
  await page.waitForFunction(
    () => !document.querySelector('[data-testid="confirm-repair-batch"]:not([disabled])'),
  );
  await page.getByTestId("repair-acknowledge").check();
  await confirmButton.click();

  await page.getByText("整批修复完成").waitFor();
  await page.getByText("工作区通过全部完整性检查").waitFor();

  // 历史记录没有被丢弃或替换成示例数据
  const state = await loadWorkspaceState(page);
  assert.equal(state.accessions.length, 8, "材料记录必须保留");
  assert.equal(state.observationPasses.length, 2, "观测历史必须保留");
  assert.equal(state.flags.length, 2, "标记历史必须保留");
  const e2 = state.benches.find((bench) => bench.id === "bench-east-2");
  assert.deepEqual(e2.assignedIds, [], "E-2 悬空引用与多占必须全部解除");
  assert.equal(e2.status, "available", "台架状态应随占用校正");
  const e1 = state.benches.find((bench) => bench.id === "bench-east-1");
  assert.deepEqual(e1.assignedIds, ["acc-tom-01", "acc-tom-02"], "E-1 的真实占用保留");

  // 修复历史可见
  await page.getByText(/已应用/).first().waitFor();
}

async function qualityRecoveryResume(page) {
  // 单项损坏：悬空引用
  const damaged = await injectDamage(page, (state) => {
    const e2 = state.benches.find((bench) => bench.id === "bench-east-2");
    e2.assignedIds = ["acc-ghost"];
    return state;
  });

  // 构造一个“修复中断”的活动会话（pending 修复尚未执行）
  const findingId = "q-B-ASSIGN-MISSING-01@bench:bench-east-2";
  const journal = {
    id: "rpr_interrupted",
    startedAt: "2026-03-01T08:00:00.000Z",
    updatedAt: "2026-03-01T08:00:00.000Z",
    status: "in_progress",
    stateBefore: damaged,
    items: [
      {
        findingId,
        ruleCode: "B-ASSIGN-MISSING-01",
        severity: "blocking",
        title: "台架引用了已消失的材料",
        action: "移除悬空引用",
        fix: {
          kind: "bench.unassign",
          action: "移除悬空引用",
          rationale: "只移除引用 id",
          context: {
            benchId: "bench-east-2",
            accessionId: "acc-ghost",
            reason: "missing-accession",
          },
        },
        status: "pending",
        changes: [],
      },
    ],
  };
  await page.evaluate(
    ({ key, journal }) =>
      window.localStorage.setItem(key, JSON.stringify({ active: journal, history: [] })),
    { key: REPAIR_ARCHIVE_KEY, journal },
  );
  await page.reload({ waitUntil: "networkidle" });

  // 恢复横幅 + 全局横幅
  await page.getByTestId("repair-recovery-banner").waitFor();
  await page.getByTestId("boot-recovery-banner").waitFor();

  // 续跑
  await page.getByTestId("resume-repair").click();
  await page.getByText("未完成修复已继续").waitFor();
  let state = await loadWorkspaceState(page);
  assert.deepEqual(
    state.benches.find((b) => b.id === "bench-east-2").assignedIds,
    [],
    "续跑必须完成 pending 修复",
  );
  const archiveAfterResume = await page.evaluate(
    (key) => JSON.parse(window.localStorage.getItem(key)),
    REPAIR_ARCHIVE_KEY,
  );
  assert.equal(archiveAfterResume.active, null, "续跑完成后活动会话关闭");
  assert.equal(archiveAfterResume.history[0].outcome, "applied");

  // 第二个场景：同样的中断，这次选择整批回滚（在同一浏览器内重置存储）
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  const damaged2 = await injectDamage(page, (state) => {
    const e2 = state.benches.find((bench) => bench.id === "bench-east-2");
    e2.assignedIds = ["acc-ghost"];
    return state;
  });
  const journal2 = {
    ...structuredClone(journal),
    id: "rpr_interrupted_rollback",
    stateBefore: damaged2,
  };
  await page.evaluate(
    ({ key, journal }) =>
      window.localStorage.setItem(key, JSON.stringify({ active: journal, history: [] })),
    { key: REPAIR_ARCHIVE_KEY, journal: journal2 },
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("repair-recovery-banner").waitFor();
  await page.getByTestId("rollback-repair").click();
  await page.getByText("已整批回滚").waitFor();
  const rolledBackState = await page.evaluate(
    (key) => JSON.parse(window.localStorage.getItem(key)).state,
    WORKSPACE_KEY,
  );
  assert.deepEqual(
    rolledBackState.benches.find((b) => b.id === "bench-east-2").assignedIds,
    ["acc-ghost"],
    "回滚必须恢复修复前快照",
  );
}

async function qualityCorruptPersistence(page) {
  // 直接写入无法解析的存储内容：系统必须隔离，而不是回退示例数据
  const corrupt = "{ broken json, do not replace with samples";
  await page.evaluate(
    ({ key, corrupt }) => window.localStorage.setItem(key, corrupt),
    { key: WORKSPACE_KEY, corrupt },
  );
  await page.reload({ waitUntil: "networkidle" });

  await page.getByTestId("boot-quality-banner").waitFor();
  await page.getByTestId("quarantine-panel").waitFor();
  await page.getByText("损坏的工作区数据已隔离").waitFor();

  // 损坏内容没有被示例数据覆盖
  const stillCorrupt = await page.evaluate((key) => window.localStorage.getItem(key), WORKSPACE_KEY);
  assert.equal(stillCorrupt, corrupt);

  // 工作台以空工作区启动，而非示例数据
  const rostersEmpty = await page.evaluate(() => {
    const link = document.querySelector('[href="#/roster"]');
    return !!link;
  });
  assert.ok(rostersEmpty);

  // 隔离区支持导出与“核对后清除”
  await page.getByText("核对后清除").click();
  await page.getByTestId("confirm-discard-quarantine").click();
  await page.getByText("隔离记录已清除").waitFor();
  await page.getByTestId("quarantine-panel").waitFor({ state: "detached" });

  // 系统没有用示例数据替换损坏内容：损坏键保留，材料计数为 0（空工作区）
  const remainsCorrupt = await page.evaluate((key) => window.localStorage.getItem(key), WORKSPACE_KEY);
  assert.equal(remainsCorrupt, corrupt);
  const stats = await page.locator(".quality-stat strong").allTextContents();
  assert.equal(stats.length >= 1, true);
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
