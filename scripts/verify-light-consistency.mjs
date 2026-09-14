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

let failures = 0;

function check(name, condition, detail = "") {
  if (condition) {
    console.log(`  ✅ ${name}`);
  } else {
    failures += 1;
    console.error(`  ❌ ${name}${detail ? ` — ${detail}` : ""}`);
  }
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
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.goto(`${baseUrl}/#${path}`, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  return page;
}

async function run() {
  const server = spawn(viteBin, ["preview", "--host", "127.0.0.1", "--port", String(port)], {
    cwd: root,
    stdio: "pipe",
  });

  let browser;
  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true });

    // ----------------------------------------------------------------
    // 场景 1：已分配材料改成【不兼容】光照（Tiny Tim：E-1 全日照 -> 遮阴）
    // ----------------------------------------------------------------
    console.log("场景 1：已分配 -> 不兼容光照");
    const page = await freshPage(browser, "/roster");

    await page.getByTestId(`edit-accession-acc-tom-01`).click();
    const editDialog = page.getByRole("dialog");
    // 打开时原光照（全日照）与 E-1 兼容，显示兼容提示
    await editDialog.getByTestId("light-compatible-notice").waitFor({ timeout: 2000 });
    await editDialog.getByLabel("适宜光照").selectOption("shade");
    // 切换后、保存前实时变为冲突警告
    await editDialog.getByTestId("light-conflict-notice").waitFor({ timeout: 2000 });
    check(
      "保存前表单实时警告：保存后将冲突并需移出 E-1",
      (await editDialog.getByTestId("light-conflict-notice").textContent()).includes(
        "E-1",
      ),
    );

    await page.getByTestId("save-accession-button").click();
    await page.waitForTimeout(150);

    await page
      .getByText("材料已更新，但与台架光照冲突", { exact: true })
      .waitFor({ timeout: 3000 });
    check("保存成功后出现冲突警告 toast", true);

    // 材料清单：状态列变为“光照冲突”，台架列明确提示需移出
    const conflictBadge = page.getByText("光照冲突", { exact: true }).first();
    check("材料清单状态显示“光照冲突”", await conflictBadge.isVisible());
    await page
      .getByTestId("bench-conflict-acc-tom-01")
      .getByText("光照冲突，需移出")
      .waitFor({ timeout: 2000 });
    check("台架列明确提示“光照冲突，需移出”", true);

    // “已分配”筛选段仍包含该材料（物理上仍占用台架）
    await page.getByRole("tab", { name: "已分配" }).click();
    check(
      "冲突材料仍出现在“已分配”筛选中",
      await page.getByTestId("edit-accession-acc-tom-01").isVisible(),
    );
    await page.getByRole("tab", { name: "全部" }).click();

    // 刷新后冲突仍然存在（状态由持久化数据派生，不依赖内存）
    await page.reload({ waitUntil: "networkidle" });
    check(
      "刷新后材料清单仍显示“光照冲突”",
      await page
        .getByTestId("bench-conflict-acc-tom-01")
        .getByText("光照冲突，需移出")
        .isVisible(),
    );

    // 布局页：横幅 + 台架卡片冲突标记
    await page.goto(`${baseUrl}/#/layout`, { waitUntil: "networkidle" });
    await page.getByTestId("layout-conflict-banner").waitFor({ timeout: 3000 });
    const bannerText = await page
      .getByTestId("layout-conflict-banner")
      .textContent();
    check(
      "布局页横幅点名 Tiny Tim / E-1 / 移出",
      bannerText.includes("ACC-0001") &&
        bannerText.includes("E-1") &&
        bannerText.includes("移出台架"),
      bannerText,
    );
    const e1Card = page.getByTestId("bench-card-bench-east-1");
    await e1Card
      .getByTestId("bench-light-conflict-acc-tom-01")
      .waitFor({ timeout: 2000 });
    const conflictRowText = await e1Card
      .getByTestId("bench-light-conflict-acc-tom-01")
      .textContent();
    check(
      "E-1 卡片行内显示光照冲突并要求移出",
      conflictRowText.includes("光照冲突") && conflictRowText.includes("移出"),
      conflictRowText,
    );
    check(
      "E-1 卡片底部有冲突汇总",
      await e1Card.getByTestId("bench-conflict-summary-bench-east-1").isVisible(),
    );

    // 分配面板选中 Tiny Tim 时显示冲突指引
    await page.getByTestId("assignment-accession-select").selectOption("acc-tom-01");
    await page.getByTestId("assignment-conflict").waitFor({ timeout: 2000 });
    const panelText = await page.getByTestId("assignment-conflict").textContent();
    check(
      "分配面板提示先移出 E-1",
      panelText.includes("E-1") && panelText.includes("移出"),
      panelText,
    );
    // 遮阴的 Tiny Tim 不能再被分配到全日照台架（原有分配规则仍生效）
    check(
      "全日照 E-2 的分配按钮保持禁用（光照不兼容）",
      await page.getByTestId("assign-bench-bench-east-2").isDisabled(),
    );

    // 放行检查：出现 LIGHT_CONFLICT 阻止项，且指标计入冲突、不计入已分配
    await page.goto(`${baseUrl}/#/clearance`, { waitUntil: "networkidle" });
    const snapshot = page.getByTestId("clearance-snapshot").first();
    await snapshot.getByText("LIGHT_CONFLICT").waitFor({ timeout: 2000 });
    const snapText = await snapshot.textContent();
    check("放行阻止项包含 LIGHT_CONFLICT", snapText.includes("LIGHT_CONFLICT"));
    check(
      "阻止消息指出需要移出 E-1",
      snapText.includes("请将其移出台架后重新分配") && snapText.includes("E-1"),
    );
    const metricLabels = await snapshot.locator(".metric-card").allTextContents();
    const conflictMetric = metricLabels.find((text) =>
      text.includes("光照冲突"),
    );
    check(
      "“光照冲突”指标计数为 1",
      Boolean(conflictMetric && conflictMetric.includes("1")),
      conflictMetric,
    );
    const assignedMetric = metricLabels.find((text) =>
      text.trim().startsWith("已分配"),
    );
    check(
      "“已分配”指标不再把冲突材料算作已分配（3 个材料中仅 Micro Tim 兼容在架 = 1）",
      Boolean(assignedMetric && assignedMetric.includes("1")),
      assignedMetric,
    );

    // 恢复流程：在布局页把 Tiny Tim 移出 E-1
    await page.goto(`${baseUrl}/#/layout`, { waitUntil: "networkidle" });
    await page
      .getByTestId("bench-card-bench-east-1")
      .getByRole("button", { name: /将 Tiny Tim 从台架 E-1 移出/ })
      .click();
    await page.getByText("材料已移出", { exact: true }).waitFor({ timeout: 2000 });
    check(
      "冲突材料可以通过原“移出”流程撤出台架",
      await page.getByTestId("layout-conflict-banner").isHidden().catch(() => true),
    );
    check(
      "移出后冲突横幅消失",
      !(await page.locator('[data-testid="layout-conflict-banner"]').count()),
    );

    await page.close();

    // ----------------------------------------------------------------
    // 场景 2：已分配材料改成【兼容】光照（Micro Tim：E-1 全日照 -> 半阴）
    // 说明：半阴允许 full-sun 与 partial-shade 台架，E-1 为全日照 => 兼容
    // ----------------------------------------------------------------
    console.log("场景 2：已分配 -> 兼容光照");
    const page2 = await freshPage(browser, "/roster");
    await page2.getByTestId(`edit-accession-acc-tom-02`).click();
    const dialog2 = page2.getByRole("dialog");
    await dialog2.getByLabel("适宜光照").selectOption("partial-shade");
    // 保存前表单内出现兼容提示
    await page2.getByTestId("light-compatible-notice").waitFor({ timeout: 2000 });
    check(
      "编辑表单实时提示“保存后无需移动”",
      (await page2.getByTestId("light-compatible-notice").textContent()).includes(
        "无需移动",
      ),
    );
    await page2.getByTestId("save-accession-button").click();
    const compatibleToast = page2.getByText("光照与台架 E-1 保持兼容，无需移动。", {
      exact: true,
    });
    await compatibleToast.waitFor({ timeout: 3000 });
    check("保存 toast 明确说明无需移动", true);

    // 状态仍是“已分配”，没有冲突标记
    check(
      "材料清单没有光照冲突标记",
      await page2.locator('[data-testid="bench-conflict-acc-tom-02"]').count() ===
        0,
    );
    await page2.goto(`${baseUrl}/#/layout`, { waitUntil: "networkidle" });
    check(
      "布局页没有冲突横幅",
      (await page2.locator('[data-testid="layout-conflict-banner"]').count()) === 0,
    );
    check(
      "Micro Tom 仍在 E-1 卡片上",
      await page2
        .getByTestId("bench-card-bench-east-1")
        .getByText("Micro Tom")
        .isVisible(),
    );
    await page2.goto(`${baseUrl}/#/clearance`, { waitUntil: "networkidle" });
    const snap2 = page2.getByTestId("clearance-snapshot").first();
    const snap2Text = await snap2.textContent();
    check(
      "放行检查没有 LIGHT_CONFLICT",
      !snap2Text.includes("LIGHT_CONFLICT"),
    );
    await page2.close();

    // ----------------------------------------------------------------
    // 场景 3：未分配材料编辑光照（Yellow Pear，本来未分配）
    // ----------------------------------------------------------------
    console.log("场景 3：未分配 -> 修改光照");
    const page3 = await freshPage(browser, "/roster");
    await page3.getByTestId(`edit-accession-acc-tom-03`).click();
    const dialog3 = page3.getByRole("dialog");
    check(
      "未分配材料的表单不显示任何台架一致性横幅",
      (await dialog3.locator('[data-testid="light-conflict-notice"]').count()) ===
        0 &&
        (await dialog3
          .locator('[data-testid="light-compatible-notice"]')
          .count()) === 0,
    );
    await dialog3.getByLabel("适宜光照").selectOption("shade");
    check(
      "切换光照后仍不出现冲突横幅（因为未分配）",
      (await page3.locator('[data-testid="light-conflict-notice"]').count()) === 0,
    );
    await page3.getByTestId("save-accession-button").click();
    await page3
      .getByText("ACC-0003 已更新。", { exact: true })
      .waitFor({ timeout: 3000 });
    check("保存成功且走普通更新 toast", true);
    await page3.goto(`${baseUrl}/#/layout`, { waitUntil: "networkidle" });
    check(
      "布局页没有冲突横幅",
      (await page3.locator('[data-testid="layout-conflict-banner"]').count()) === 0,
    );
    // 改成遮阴后只能分配到 N-1（shade 可用）；N-2 blocked
    await page3.getByTestId("assignment-accession-select").selectOption("acc-tom-03");
    check(
      "遮阴材料可分配到 N-1（兼容台架）",
      await page3.getByTestId("assign-bench-bench-north-1").isEnabled(),
    );
    await page3.getByTestId("assign-bench-bench-north-1").click();
    await page3.getByText("台架分配成功", { exact: true }).waitFor({ timeout: 2000 });
    check("未分配材料的原分配流程仍然成功", true);
    await page3.close();

    // ----------------------------------------------------------------
    // 场景 4：未分配材料新建流程不受影响
    // ----------------------------------------------------------------
    console.log("场景 4：新建材料不受影响");
    const page4 = await freshPage(browser, "/roster");
    await page4.getByTestId("open-create-accession").click();
    await page4.getByTestId("cultivar-input").fill("Stupice");
    await page4.getByLabel("来源").fill("Glasshouse Exchange");
    await page4.getByLabel("繁殖日期").fill("2026-02-21");
    await page4.getByLabel("数量").fill("72");
    await page4
      .locator("textarea")
      .first()
      .fill("Compact heirloom line with uniform early habit.");
    const createDialog = page4.getByRole("dialog");
    check(
      "新建表单不显示台架一致性横幅",
      (await createDialog
        .locator('[data-testid="light-conflict-notice"], [data-testid="light-compatible-notice"]')
        .count()) === 0,
    );
    await page4.getByTestId("save-accession-button").click();
    await page4.getByText("Stupice", { exact: true }).first().waitFor();
    await page4.getByText("ACC-0009", { exact: true }).first().waitFor();
    check("新材料正常创建", true);
    await page4.close();
  } finally {
    if (browser) {
      await browser.close();
    }
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }

  if (failures > 0) {
    console.error(`\n❌ ${failures} 项验证失败`);
    process.exit(1);
  }
  console.log("\n✅ 全部一致性验证通过");
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
