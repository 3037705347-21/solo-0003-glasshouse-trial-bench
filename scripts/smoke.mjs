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
  "duplicate-trial-from-template": duplicateTrialFromTemplate,
  "register-accession-lineage": registerAccessionLineage,
};

const scenarioPaths = {
  "curate-accession-roster": "/roster",
  "assign-accession-bench": "/layout",
  "record-observation-pass": "/observations",
  "advance-trial-clearance": "/clearance",
  "duplicate-trial-from-template": "/templates",
  "register-accession-lineage": "/lineage",
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

async function duplicateTrialFromTemplate(page) {
  await page.getByTestId("copy-from-trial-sol-01").click();
  await page.getByTestId("copy-trial-dialog").waitFor();

  // 跳过第三个材料，验证预览中的跳过项与编号重排。
  await page.getByTestId("copy-accession-acc-tom-03").uncheck();
  // 重置两个材料字段，验证默认值提示。
  await page.getByTestId("copy-field-source").uncheck();
  await page.getByTestId("copy-field-labels").uncheck();
  await page.getByTestId("copy-new-code").fill("SOL-04");
  await page.getByTestId("copy-start-date").fill("2026-08-17");
  await page.getByTestId("copy-end-date").fill("2026-11-20");

  await page.getByTestId("copy-preview-button").click();
  await page.getByTestId("copy-preview").waitFor();
  await page.getByTestId("copy-copied-count").getByText("2").waitFor();
  await page.getByTestId("copy-skipped-count").getByText("1").waitFor();
  await page.getByTestId("copy-skipped-list").getByText("ACC-0003").waitFor();
  await page.getByTestId("copy-new-no-acc-tom-01").getByText("ACC-0009").waitFor();
  await page.getByTestId("copy-new-no-acc-tom-02").getByText("ACC-0010").waitFor();

  // 已分配源材料必须提示重新分配。
  await page.getByText("新材料需要重新分配", { exact: false }).first().waitFor();

  await page.getByTestId("copy-commit-button").click();
  await page.getByText("新试验 SOL-04 已创建", { exact: true }).waitFor();

  // 新试验与新材料是独立身份：观测和标记没有混入。
  await page.goto(`${baseUrl}/#/observations`, { waitUntil: "networkidle" });
  const trialOptions = await page
    .locator("select")
    .first()
    .locator("option")
    .allInnerTexts();
  if (!trialOptions.some((label) => label.includes("SOL-04"))) {
    throw new Error("新试验 SOL-04 未出现在试验选择中");
  }

  // 同一复制请求不能产生第二套试验：复制记录只有一条。
  await page.goto(`${baseUrl}/#/templates`, { waitUntil: "networkidle" });
  const recordCount = await page
    .getByText("SOL-01 → SOL-04", { exact: true })
    .count();
  if (recordCount !== 1) {
    throw new Error(`期望恰好一条复制记录，实际 ${recordCount}`);
  }
}

async function registerAccessionLineage(page) {
  await page.getByTestId("open-create-lineage").click();
  await page.getByTestId("lineage-parent-input").selectOption("acc-tom-01");
  await page.getByTestId("lineage-child-input").selectOption("acc-tom-02");
  await page.getByTestId("lineage-note-input").fill("S1 代自交留种批次，母本编号一致。");
  await page.getByTestId("save-lineage-button").click();
  await page.getByText("亲缘关系已登记", { exact: true }).waitFor();
  await page.getByText("自交后代").first().waitFor();
  await page.getByText("ACC-0002 · Micro Tom").first().waitFor();
  await page.getByText("ACC-0001 · Tiny Tim").first().waitFor();
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
