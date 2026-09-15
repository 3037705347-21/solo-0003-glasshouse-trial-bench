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
  "quality-rollback-crash": qualityRollbackCrash,
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
  "quality-rollback-crash": "/quality",
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
  await page.getByTestId("select-fix-q-B-ASSIGN-MISSING-01@bench:bench-east-2_accession:acc-ghost@acc-ghost").waitFor();

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

  await page.getByText("整批修复已完成并持久化").waitFor();
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
  const findingId = "q-B-ASSIGN-MISSING-01@bench:bench-east-2_accession:acc-ghost@acc-ghost";
  const buildJournal = (id, stateBefore) => ({
    id,
    startedAt: "2026-03-01T08:00:00.000Z",
    updatedAt: "2026-03-01T08:00:00.000Z",
    status: "in_progress",
    stateBefore,
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
  });

  // 场景 1：启动时自动对账续跑（不需要用户点击）
  await page.evaluate(
    ({ key, journal }) =>
      window.localStorage.setItem(key, JSON.stringify({ active: journal, history: [] })),
    { key: REPAIR_ARCHIVE_KEY, journal: buildJournal("rpr_interrupted", damaged) },
  );
  await page.reload({ waitUntil: "networkidle" });

  // 活动会话被自动续跑并归档：工作区已修复、无恢复横幅
  await page.waitForFunction(
    (key) => {
      const archive = JSON.parse(window.localStorage.getItem(key));
      return archive.active === null && archive.history[0]?.outcome === "applied";
    },
    REPAIR_ARCHIVE_KEY,
  );
  let state = await loadWorkspaceState(page);
  assert.deepEqual(
    state.benches.find((b) => b.id === "bench-east-2").assignedIds,
    [],
    "启动自动续跑必须完成 pending 修复",
  );
  await page
    .locator("[data-testid='recovery-notice']", {
      hasText: "未完成的整批修复已自动续跑",
    })
    .waitFor();

  // 场景 2：两边内容不一致（预演后外部写入）：冲突横幅 + 人工整批回滚
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  const damaged2 = await injectDamage(page, (workspace) => {
    const e2 = workspace.benches.find((bench) => bench.id === "bench-east-2");
    e2.assignedIds = ["acc-ghost"];
    return workspace;
  });

  // 外部写入：工作区既不是修复前，也不是任何修复前缀（多出一个台架）
  const tampered = structuredClone(damaged2);
  tampered.benches.push({
    id: "bench-foreign",
    code: "B-F",
    sector: "外部",
    capacity: 2,
    assignedIds: ["foreign-write"],
    lightProfile: "full-sun",
    irrigationLine: "i",
    status: "assigned",
  });
  await saveWorkspaceState(page, tampered);

  await page.evaluate(
    ({ key, journal }) =>
      window.localStorage.setItem(key, JSON.stringify({ active: journal, history: [] })),
    { key: REPAIR_ARCHIVE_KEY, journal: buildJournal("rpr_conflict", damaged2) },
  );
  await page.reload({ waitUntil: "networkidle" });

  await page.getByTestId("repair-recovery-banner").waitFor();
  await page
    .getByTestId("repair-recovery-banner")
    .getByText("修复会话与当前工作区冲突")
    .waitFor();
  // 冲突时不提供“继续执行”，只能回滚或放弃
  assert.equal(await page.getByTestId("resume-repair").count(), 0);

  // 工作区保持外部写入后的状态，没有被部分修复
  state = await loadWorkspaceState(page);
  assert.equal(state.benches.find((b) => b.id === "bench-foreign") !== undefined, true);

  // 人工整批回滚：恢复修复前快照（悬空引用的损坏工作区）并归档
  await page.getByTestId("rollback-repair").click();
  await page.locator(".toast", { hasText: "已整批回滚" }).waitFor();
  const rolledBackState = await page.evaluate(
    (key) => JSON.parse(window.localStorage.getItem(key)).state,
    WORKSPACE_KEY,
  );
  assert.deepEqual(
    rolledBackState.benches.find((b) => b.id === "bench-east-2").assignedIds,
    ["acc-ghost"],
    "回滚必须恢复修复前快照",
  );
  const archiveAfterRollback = await page.evaluate(
    (key) => JSON.parse(window.localStorage.getItem(key)),
    REPAIR_ARCHIVE_KEY,
  );
  assert.equal(archiveAfterRollback.active, null);
  assert.equal(archiveAfterRollback.history[0].outcome, "rolled-back");

  // 场景 3：放弃会话：当前数据保持不变
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  const damaged3 = await injectDamage(page, (workspace) => {
    const e2 = workspace.benches.find((bench) => bench.id === "bench-east-2");
    e2.assignedIds = ["acc-ghost"];
    return workspace;
  });
  const tampered3 = structuredClone(damaged3);
  const east1 = tampered3.benches.find((b) => b.id === "bench-east-1");
  east1.assignedIds = ["acc-tom-01", "acc-tom-02", "foreign-x"];
  await saveWorkspaceState(page, tampered3);
  await page.evaluate(
    ({ key, journal }) =>
      window.localStorage.setItem(key, JSON.stringify({ active: journal, history: [] })),
    { key: REPAIR_ARCHIVE_KEY, journal: buildJournal("rpr_abandon", damaged3) },
  );
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("repair-recovery-banner").waitFor();
  await page.getByTestId("abandon-repair").click();
  await page.locator(".toast", { hasText: "修复会话已关闭" }).waitFor();
  const abandonedState = await loadWorkspaceState(page);
  assert.deepEqual(
    abandonedState.benches.find((b) => b.id === "bench-east-1").assignedIds,
    ["acc-tom-01", "acc-tom-02", "foreign-x"],
    "放弃会话必须保留当前数据",
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

async function qualityRollbackCrash(page) {
  // 构造“修复已执行到工作区终态、用户选择回滚，但只写回了修复前工作区、归档未完成”的崩溃现场。
  // 关键点：工作区 == 修复前状态，active 会话已携带 intent=rollback。
  const damaged = await injectDamage(page, (state) => {
    const e2 = state.benches.find((bench) => bench.id === "bench-east-2");
    e2.assignedIds = ["acc-ghost"];
    return state;
  });

  const journalId = "rpr_rollback_crash";
  await page.evaluate(
    ({ key, journal }) =>
      window.localStorage.setItem(key, JSON.stringify({ active: journal, history: [] })),
    {
      key: REPAIR_ARCHIVE_KEY,
      journal: {
        id: journalId,
        version: 2,
        startedAt: "2026-03-01T08:00:00.000Z",
        updatedAt: "2026-03-01T08:05:00.000Z",
        status: "in_progress",
        intent: "rollback",
        stateBefore: damaged,
        stateBeforeFingerprint: undefined,
        stateAfter: damaged,
        items: [
          {
            findingId: "ghost-fix",
            ruleCode: "B-ASSIGN-MISSING-01",
            severity: "blocking",
            title: "台架引用了已消失的材料",
            action: "移除悬空引用",
            status: "applied",
            changes: ["曾执行修复"],
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
          },
        ],
        recoveryLog: [
          { at: "2026-03-01T08:00:00.000Z", event: "created" },
          { at: "2026-03-01T08:05:00.000Z", event: "rollback-intent" },
        ],
      },
    },
  );
  await page.reload({ waitUntil: "networkidle" });

  // 启动恢复必须完成回滚（此处工作区已写回修复前，只需补归档），而不是重新应用修复
  await page
    .locator("[data-testid='recovery-notice']", { hasText: "回滚已在启动时归档" })
    .waitFor();

  const state = await loadWorkspaceState(page);
  assert.deepEqual(
    state.benches.find((b) => b.id === "bench-east-2").assignedIds,
    ["acc-ghost"],
    "回滚中断重启后必须停在修复前状态（悬空引用原样保留），不能重新应用修复",
  );
  const archive = await page.evaluate(
    (key) => JSON.parse(window.localStorage.getItem(key)),
    REPAIR_ARCHIVE_KEY,
  );
  assert.equal(archive.active, null, "活动会话必须清空");
  assert.equal(archive.history[0].outcome, "rolled-back");

  // 再刷新一次：没有活动会话，也不会重新修复或重新回滚
  await page.reload({ waitUntil: "networkidle" });
  const state2 = await loadWorkspaceState(page);
  assert.deepEqual(
    state2.benches.find((b) => b.id === "bench-east-2").assignedIds,
    ["acc-ghost"],
  );

  // 第二个分支：工作区停在修复终态、回滚意图已落盘但工作区未写回。
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  const damagedForIntent = await injectDamage(page, (workspace) => {
    workspace.benches.find((b) => b.id === "bench-east-2").assignedIds = ["acc-ghost"];
    return workspace;
  });
  // 工作区手工回到修复终态（悬空引用已解除），会话却携带回滚意图
  const terminalState = structuredClone(damagedForIntent);
  terminalState.benches.find((b) => b.id === "bench-east-2").assignedIds = [];
  await saveWorkspaceState(page, terminalState);
  await page.evaluate(
    ({ key, journal }) =>
      window.localStorage.setItem(key, JSON.stringify({ active: journal, history: [] })),
    {
      key: REPAIR_ARCHIVE_KEY,
      journal: {
        id: "rpr_rollback_crash_terminal",
        version: 2,
        startedAt: "2026-03-02T08:00:00.000Z",
        updatedAt: "2026-03-02T08:05:00.000Z",
        status: "in_progress",
        intent: "rollback",
        stateBefore: damagedForIntent,
        stateAfter: terminalState,
        items: [
          {
            findingId: "ghost-fix",
            ruleCode: "B-ASSIGN-MISSING-01",
            severity: "blocking",
            title: "台架引用了已消失的材料",
            action: "移除悬空引用",
            status: "applied",
            changes: ["曾执行修复"],
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
          },
        ],
        recoveryLog: [
          { at: "2026-03-02T08:00:00.000Z", event: "created" },
          { at: "2026-03-02T08:05:00.000Z", event: "rollback-intent" },
        ],
      },
    },
  );
  await page.reload({ waitUntil: "networkidle" });

  // 启动必须按回滚意图把终态写回修复前状态，而不是认为修复已完成
  await page
    .locator("[data-testid='recovery-notice']", { hasText: "中断的回滚已在启动时完成" })
    .waitFor();
  const rolledBack = await loadWorkspaceState(page);
  assert.deepEqual(
    rolledBack.benches.find((b) => b.id === "bench-east-2").assignedIds,
    ["acc-ghost"],
    "终态工作区 + 回滚意图：必须恢复到修复前状态",
  );
  assert.equal(
    JSON.parse(await page.evaluate((k) => window.localStorage.getItem(k), REPAIR_ARCHIVE_KEY))
      .active,
    null,
  );
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
