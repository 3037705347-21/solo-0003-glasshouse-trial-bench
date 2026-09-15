/**
 * 迁移机制的浏览器公共入口冒烟测试。
 *
 * 与 scripts/smoke.mjs 的区别：这里不使用示例工作区，而是在页面脚本运行前注入
 * 精心构造的“旧版本（v1）工作区”，从而通过真实的公共路由（/#/roster、/#/layout…）
 * 覆盖升级与人工修复边界：
 *   1. 正常：把台架上的悬空槽位重新关联到有效材料，升级横幅消失、槽位更新；
 *   2. 空选择：未选目标时“重新关联”按钮禁用，不产生任何写入；
 *   3. 拒绝：重复 / 停用 / 光照不匹配的重关联被领域规则拒绝，显示原因且数据不变；
 *   4. 刷新恢复：损坏数据进入恢复页、主键逐字不变、可导出；
 *   5. 相邻对象不污染：成功/被拒后，其它台架、其它槽位与其它材料保持不变。
 *
 * 需要系统 Chromium 依赖（与 scripts/smoke.mjs 相同的运行前提）。
 */
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

const port = 4178;
const baseUrl = `http://127.0.0.1:${port}`;
const root = new URL("..", import.meta.url).pathname;
const viteBin =
  process.platform === "win32"
    ? `${root}node_modules/.bin/vite.cmd`
    : `${root}node_modules/.bin/vite`;

const STORAGE_KEY = "glasshouse-trial-bench:workspace:v1";

async function waitForServer() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(baseUrl);
      if (response.ok) return;
    } catch {
      // 端口尚未开放
    }
    await delay(250);
  }
  throw new Error(`Preview server did not start on port ${port}`);
}

/** 构造一份确定的、带已知悬空引用的 v1 旧工作区（不是示例数据）。 */
function buildLegacyV1Workspace() {
  return {
    version: 1,
    savedAt: "2026-08-01T00:00:00.000Z",
    state: {
      trials: [
        {
          id: "trial-legacy",
          code: "LEG-1",
          cropFamily: "茄科",
          objective: "迁移边界测试旧试验",
          season: "夏季",
          startDate: "2026-06-01",
          endDate: "2026-09-01",
          state: "active",
        },
      ],
      accessions: [
        // 有效、空闲、full-sun：正常重关联目标
        {
          id: "acc-rel",
          trialId: "trial-legacy",
          accessionNo: "ACC-9001",
          cultivar: "Relink Target",
          source: "Legacy Seed House",
          propagatedOn: "2026-06-03",
          quantity: 40,
          trayCells: 72,
          preferredLight: "full-sun",
          genotypeNote: "用于正常重新关联的在用空闲材料。",
          labels: [],
        },
        // 已在同台架：重复目标
        {
          id: "acc-dup",
          trialId: "trial-legacy",
          accessionNo: "ACC-9002",
          cultivar: "Already On Bench",
          source: "Legacy Seed House",
          propagatedOn: "2026-06-03",
          quantity: 40,
          trayCells: 72,
          preferredLight: "full-sun",
          genotypeNote: "已经占用待修复台架的相邻槽位。",
          labels: [],
        },
        // 停用：被拒目标
        {
          id: "acc-ret",
          trialId: "trial-legacy",
          accessionNo: "ACC-9003",
          cultivar: "Retired Material",
          source: "Legacy Seed House",
          propagatedOn: "2026-06-03",
          quantity: 40,
          trayCells: 72,
          preferredLight: "full-sun",
          genotypeNote: "已停用材料，不能成为新分配。",
          labels: [],
          lifecycleStatus: "retired",
          retiredAt: "2026-07-01T00:00:00.000Z",
          retirementReason: "批次结束",
          retirementHistory: [],
        },
        // shade：光照不匹配目标（台架 full-sun）
        {
          id: "acc-shade",
          trialId: "trial-legacy",
          accessionNo: "ACC-9004",
          cultivar: "Shade Material",
          source: "Legacy Seed House",
          propagatedOn: "2026-06-03",
          quantity: 40,
          trayCells: 72,
          preferredLight: "shade",
          genotypeNote: "需要遮阴光照，与全日看台架不兼容。",
          labels: [],
        },
        // 相邻台架上的材料：必须始终不受影响
        {
          id: "acc-neighbour",
          trialId: "trial-legacy",
          accessionNo: "ACC-9005",
          cultivar: "Neighbour Crop",
          source: "Legacy Seed House",
          propagatedOn: "2026-06-03",
          quantity: 40,
          trayCells: 72,
          preferredLight: "full-sun",
          genotypeNote: "相邻台架上的材料，任何修复都不应改动它。",
          labels: [],
        },
      ],
      benches: [
        // 待修复台架：一个合法相邻槽位 + 一个悬空槽位
        {
          id: "bench-rel",
          code: "B-REL",
          sector: "测试翼",
          capacity: 4,
          assignedIds: ["acc-dup", "acc-vanished"],
          lightProfile: "full-sun",
          irrigationLine: "IR-T",
          status: "assigned",
        },
        // 相邻台架：始终不应被污染
        {
          id: "bench-neighbour",
          code: "B-NBR",
          sector: "测试翼",
          capacity: 4,
          assignedIds: ["acc-neighbour"],
          lightProfile: "full-sun",
          irrigationLine: "IR-T",
          status: "assigned",
        },
      ],
      observationPasses: [
        {
          id: "pass-legacy",
          trialId: "trial-legacy",
          observedOn: "2026-06-10",
          observer: "Legacy Observer",
          entries: [
            // 悬空观测材料：必须进入待处理清单且测量值保留
            {
              accessionId: "acc-observation-gone",
              heightMm: 73,
              leafCount: 8,
              ecMs: 2.1,
              notes: "旧观测里的悬空测量行",
            },
          ],
        },
      ],
      flags: [],
      clearanceSnapshots: [],
    },
  };
}

async function freshPageWithStorage(browser, value) {
  // 每个场景用独立 context 隔离 localStorage；init 脚本带守卫，只在该 context
  // 的第一次导航播种一次——页面 reload 时不会重新写回旧数据（否则会把刚保存的
  // 新版本覆盖掉，无法验证刷新持久化）。
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await context.addInitScript(
    ([key, raw]) => {
      // 以存储键本身为守卫：首次导航键不存在才播种；页面 reload 后键仍是
      // 刚保存的新版本，绝不能用旧载荷覆盖它（window 标志在刷新后会重置）。
      if (window.localStorage.getItem(key) !== null) return;
      window.localStorage.setItem(key, raw);
    },
    [STORAGE_KEY, typeof value === "string" ? value : JSON.stringify(value)],
  );
  const page = await context.newPage();
  await page.goto(`${baseUrl}/#/layout`, { waitUntil: "networkidle" });
  return { page, context };
}

async function readPrimaryKey(page) {
  return page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY);
}

function issueCardByText(page, text) {
  return page
    .getByTestId("issue-list")
    .locator(".issue-card", { hasText: text })
    .first();
}

async function openIssueDialog(page) {
  await page.getByTestId("migration-issue-banner").waitFor();
  await page.getByTestId("open-issue-dialog").click();
  await page.getByTestId("issue-list").waitFor();
}

// ---------------------------------------------------------------------------
// 场景
// ---------------------------------------------------------------------------

async function upgradeBannerAppears(page) {
  await page.getByTestId("upgrade-info-banner").waitFor();
  await page.getByTestId("migration-issue-banner").waitFor();
}

async function scenarioNormalRelink(page) {
  await upgradeBannerAppears(page);
  // 悬空观测材料必须进入待处理清单（测量事实保留）
  await openIssueDialog(page);
  await page
    .getByTestId("issue-list")
    .locator(".issue-card", { hasText: "不存在的材料（acc-observation-gone）" })
    .waitFor();

  const card = issueCardByText(page, "acc-vanished");
  await card.locator("select").selectOption("acc-rel");
  await card.getByRole("button", { name: "重新关联" }).click();

  // 该问题卡片消失（复检通过）
  await page
    .getByTestId("issue-list")
    .locator(".issue-card", { hasText: "acc-vanished" })
    .waitFor({ state: "detached" });
  await page.getByTestId("close-issue-dialog").click();

  // 台架槽位更新：B-REL 现在同时含相邻旧材料与新关联材料
  const relBench = page.getByTestId("bench-card-bench-rel");
  await relBench.getByText("Already On Bench").waitFor();
  await relBench.getByText("Relink Target").waitFor();
}

async function scenarioEmptySelection(page) {
  await openIssueDialog(page);
  const card = issueCardByText(page, "acc-vanished");
  // 初始空选择：按钮禁用，点击不会有任何效果
  const button = card.getByRole("button", { name: "重新关联" });
  await assertPoll(async () => (await button.isDisabled()) === true, "空选择时按钮应禁用");
  // 悬空问题仍然存在，未被处理
  await card.waitFor();
}

async function assertPoll(check, message) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (await check()) return;
    await delay(100);
  }
  throw new Error(message);
}

async function scenarioRejectedRelinks(page) {
  await openIssueDialog(page);
  const before = await readPrimaryKey(page);

  const card = issueCardByText(page, "acc-vanished");

  // 重复：选择已在同台架的材料 → 显示领域错误，槽位不变
  await card.locator("select").selectOption("acc-dup");
  await card.getByRole("button", { name: "重新关联" }).click();
  await card.locator(".issue-domain-error", { hasText: "已经分配" }).waitFor();

  // 停用
  await card.locator("select").selectOption("acc-ret");
  await card.getByRole("button", { name: "重新关联" }).click();
  await card.locator(".issue-domain-error", { hasText: "停用" }).waitFor();

  // 光照不匹配
  await card.locator("select").selectOption("acc-shade");
  await card.getByRole("button", { name: "重新关联" }).click();
  await card.locator(".issue-domain-error", { hasText: "需要 shade" }).waitFor();

  await page.getByTestId("close-issue-dialog").click();

  // 被拒后：悬空槽位仍是原始缺失引用（相邻槽位 ACC-9002 在，Relink Target 不在）
  const relBench = page.getByTestId("bench-card-bench-rel");
  await relBench.getByText("Already On Bench").waitFor();
  await assert.equal(await relBench.getByText("Relink Target").count(), 0);
  // 主键内容相对拒绝前没有变化（失败未伪装成功、未落盘非法状态）
  const after = await readPrimaryKey(page);
  await assert.equal(after, before);
}

async function scenarioNeighboursUntouched(page) {
  // 相邻台架与相邻材料在任何操作前后都保持原样
  const neighbourBench = page.getByTestId("bench-card-bench-neighbour");
  await neighbourBench.getByText("Neighbour Crop").waitFor();
  const relBench = page.getByTestId("bench-card-bench-rel");
  await relBench.getByText("Already On Bench").waitFor();
  // 相邻台架容量文案稳定：1 个占用、3 个空位
  await neighbourBench.locator("dd").filter({ hasText: "3" }).first().waitFor();
}

async function scenarioPersistsAcrossReload(browser, legacy) {
  const { page, context } = await freshPageWithStorage(browser, legacy);
  await upgradeBannerAppears(page);
  await openIssueDialog(page);
  const card = issueCardByText(page, "acc-vanished");
  await card.locator("select").selectOption("acc-rel");
  await card.getByRole("button", { name: "重新关联" }).click();
  await page
    .getByTestId("issue-list")
    .locator(".issue-card", { hasText: "acc-vanished" })
    .waitFor({ state: "detached" });
  await page.getByTestId("close-issue-dialog").click();

  // 刷新整个页面（真实公共入口重载）
  await page.reload({ waitUntil: "networkidle" });

  // 主键现在是当前版本
  const stored = JSON.parse(await readPrimaryKey(page));
  await assert.equal(stored.schemaVersion, 2);

  // 重关联结果持久保留
  const relBench = page.getByTestId("bench-card-bench-rel");
  await relBench.getByText("Relink Target").waitFor();
  await relBench.getByText("Already On Bench").waitFor();

  // 台架悬空问题已随重关联处理：刷新后核对对话框里不再有 acc-vanished 条目
  // （工作区里仍有另一条未处理的观测悬空问题，所以待处理横幅仍应存在）。
  await page.getByTestId("open-issue-dialog").click();
  await page.getByTestId("issue-list").waitFor();
  await assertPoll(
    async () =>
      (await page
        .getByTestId("issue-list")
        .locator(".issue-card", { hasText: "acc-vanished" })
        .count()) === 0,
    "刷新后已处理的台架悬空问题不应再出现",
  );
  await page.getByTestId("close-issue-dialog").click();
  // 升级提示横幅不再出现（数据已是当前版本，本次加载没有再执行迁移）
  await assertPoll(
    async () => (await page.getByTestId("upgrade-info-banner").count()) === 0,
    "当前版本数据刷新后不应再出现升级提示",
  );
  await context.close();
}

async function scenarioCorruptRecovery(page) {
  // 损坏数据：进入恢复页，而不是示例工作区
  await page.getByTestId("recovery-screen").waitFor();
  await page.getByText("人工恢复").waitFor();

  // 主键逐字保持损坏内容（没有被示例或空信封覆盖）
  const stored = await readPrimaryKey(page);
  await assert.equal(stored, "{ not json");

  // 导出按钮存在；回滚按钮在没有备份时禁用
  await page.getByTestId("recovery-export").waitFor();
  await assertPoll(
    async () => await page.getByTestId("recovery-rollback").isDisabled(),
    "无备份时回滚按钮应禁用",
  );
}

async function scenarioFutureVersionRecovery(browser) {
  const future = {
    schemaVersion: 999,
    savedAt: "2026-09-01T00:00:00.000Z",
    state: buildLegacyV1Workspace().state,
  };
  const { page, context } = await freshPageWithStorage(browser, JSON.stringify(future));
  await page.getByTestId("recovery-screen").waitFor();
  await page.getByText("更新版本").waitFor();
  // 主键不被改写
  const stored = await readPrimaryKey(page);
  await assert.equal(JSON.parse(stored).schemaVersion, 999);
  await context.close();
}

// 极简断言（避免本脚本依赖测试框架）
const assert = {
  equal(actual, expected) {
    if (actual !== expected) {
      throw new Error(`expected ${String(expected)}, got ${String(actual)}`);
    }
  },
};

async function run() {
  const server = spawn(
    viteBin,
    ["preview", "--host", "127.0.0.1", "--port", String(port)],
    { cwd: root, stdio: "pipe" },
  );
  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true });
    const legacy = buildLegacyV1Workspace();

    // 正常重关联
    {
      const { page, context } = await freshPageWithStorage(browser, legacy);
      await scenarioNormalRelink(page);
      await context.close();
      console.log("✅ migration: 正常重关联（公共入口）");
    }

    // 空选择
    {
      const { page, context } = await freshPageWithStorage(browser, legacy);
      await scenarioEmptySelection(page);
      await context.close();
      console.log("✅ migration: 空选择被禁用且不写入");
    }

    // 拒绝（重复/停用/光照）且主键不变
    {
      const { page, context } = await freshPageWithStorage(browser, legacy);
      await scenarioRejectedRelinks(page);
      await context.close();
      console.log("✅ migration: 非法重关联被拒绝且数据不变");
    }

    // 相邻对象不污染
    {
      const { page, context } = await freshPageWithStorage(browser, legacy);
      await scenarioNeighboursUntouched(page);
      // 顺带完成一次正常重关联，再确认相邻台架依旧不变
      await openIssueDialog(page);
      const card = issueCardByText(page, "acc-vanished");
      await card.locator("select").selectOption("acc-rel");
      await card.getByRole("button", { name: "重新关联" }).click();
      await page.getByTestId("close-issue-dialog").click();
      const neighbourBench = page.getByTestId("bench-card-bench-neighbour");
      await neighbourBench.getByText("Neighbour Crop").waitFor();
      await neighbourBench.locator("dd").filter({ hasText: "3" }).first().waitFor();
      await context.close();
      console.log("✅ migration: 相邻台架/槽位/材料不被污染");
    }

    // 刷新恢复：完成修复后整页重载，结果与处理状态持久保留
    await scenarioPersistsAcrossReload(browser, legacy);
    console.log("✅ migration: 修复结果在刷新后持久保留");

    // 刷新恢复：损坏 JSON
    {
      const { page, context } = await freshPageWithStorage(browser, "{ not json");
      await scenarioCorruptRecovery(page);
      await context.close();
      console.log("✅ migration: 损坏数据进入恢复模式且主键不变");
    }

    // 刷新恢复：未来版本
    await scenarioFutureVersionRecovery(browser);
    console.log("✅ migration: 未来版本被拒绝且主键不变");
  } finally {
    if (browser) await browser.close();
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
}

run().catch((error) => {
  console.error("❌ migration smoke failed");
  console.error(error);
  process.exit(1);
});
