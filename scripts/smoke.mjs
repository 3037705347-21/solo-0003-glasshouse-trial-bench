import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
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
  "backup-restore-workspace": backupRestoreWorkspace,
};

const scenarioPaths = {
  "curate-accession-roster": "/roster",
  "assign-accession-bench": "/layout",
  "record-observation-pass": "/observations",
  "advance-trial-clearance": "/clearance",
  "backup-restore-workspace": "/backup",
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

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

async function uploadBackup(page, payload, name = "workspace-backup.json") {
  const buffer = Buffer.from(
    typeof payload === "string" ? payload : JSON.stringify(payload),
  );
  await page
    .getByTestId("backup-file-input")
    .setInputFiles({ name, mimeType: "application/json", buffer });
}

async function confirmImport(page) {
  const preview = page.getByRole("dialog", { name: "导入预览" });
  await preview.waitFor();
  await preview.getByText("格式版本", { exact: true }).waitFor();
  await preview.getByText("v1", { exact: true }).waitFor();
  await preview.getByTestId("confirm-import-button").click();
  await page.getByText("工作区已恢复", { exact: true }).waitFor();
}

async function goTo(page, label) {
  await page.getByRole("link", { name: label }).click();
}

async function backupRestoreWorkspace(page) {
  // 导出：文件带版本、导出时间和内容摘要
  const downloadPromise = page.waitForEvent("download");
  await page.getByTestId("export-backup-button").click();
  const download = await downloadPromise;
  const exported = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.equal(exported.kind, "glasshouse-trial-bench/workspace-backup");
  assert.equal(exported.version, 1);
  assert.ok(!Number.isNaN(Date.parse(exported.exportedAt)));
  assert.equal(exported.summary.trials, 3);
  assert.equal(exported.summary.accessions, 8);
  assert.deepEqual(exported.summary.trialCodes, ["SOL-01", "AMA-02", "BRA-03"]);

  // 有效导入：预览后整批替换，所有页面切换到新数据
  const restoredCultivar = "Restored Tim";
  const modified = clone(exported);
  modified.state.accessions.find((item) => item.id === "acc-tom-01").cultivar =
    restoredCultivar;
  await uploadBackup(page, modified);
  await confirmImport(page);
  await goTo(page, "材料登记");
  await page.getByText(restoredCultivar, { exact: true }).first().waitFor();
  await page.reload({ waitUntil: "networkidle" });
  await page.getByText(restoredCultivar, { exact: true }).first().waitFor();

  // 损坏文件：整批拒绝，当前数据保持不动
  await goTo(page, "备份恢复");
  await uploadBackup(page, "{ 这不是有效的 JSON");
  await page.getByTestId("import-error-list").getByText(/已损坏/).waitFor();
  await page.getByText("导入已拒绝", { exact: true }).waitFor();

  // 版本过旧：拒绝并说明所需版本
  await uploadBackup(page, { ...modified, version: 0 });
  await page.getByTestId("import-error-list").getByText(/过旧/).waitFor();

  // 引用断裂：材料指向不存在的试验
  const broken = clone(modified);
  broken.state.accessions[0].trialId = "trial-missing";
  await uploadBackup(page, broken);
  await page
    .getByTestId("import-error-list")
    .getByText(/不存在的试验/)
    .waitFor();

  // 冲突记录：材料编号重复
  const conflicting = clone(modified);
  conflicting.state.accessions.push({
    ...clone(conflicting.state.accessions[0]),
    id: "acc-duplicate",
  });
  conflicting.summary.accessions = conflicting.state.accessions.length;
  await uploadBackup(page, conflicting);
  await page.getByTestId("import-error-list").getByText(/冲突/).waitFor();

  // 不完整文件：缺少标记集合
  const incomplete = clone(modified);
  delete incomplete.state.flags;
  incomplete.summary.flags = 0;
  await uploadBackup(page, incomplete);
  await page
    .getByTestId("import-error-list")
    .getByText(/缺少生长标记集合/)
    .waitFor();

  // 多次拒绝后当前数据仍然可用
  await goTo(page, "材料登记");
  await page.getByText(restoredCultivar, { exact: true }).first().waitFor();

  // 空工作区：合法备份，可以整批导入
  const empty = {
    kind: exported.kind,
    version: 1,
    exportedAt: new Date().toISOString(),
    summary: {
      trials: 0,
      accessions: 0,
      benches: 0,
      observationPasses: 0,
      flags: 0,
      clearanceSnapshots: 0,
      trialCodes: [],
    },
    state: {
      trials: [],
      accessions: [],
      benches: [],
      observationPasses: [],
      flags: [],
      clearanceSnapshots: [],
    },
  };
  await goTo(page, "备份恢复");
  await uploadBackup(page, empty);
  await confirmImport(page);
  await goTo(page, "材料登记");
  await page.getByText("当前视图下没有匹配材料。").waitFor();

  // 恢复点：回滚到导入前的状态
  await goTo(page, "备份恢复");
  await page.getByTestId("restore-preimport-button").click();
  await page.getByTestId("confirm-restore-button").click();
  await page.getByText("已恢复导入前状态", { exact: true }).waitFor();
  await goTo(page, "材料登记");
  await page.getByText(restoredCultivar, { exact: true }).first().waitFor();

  // 重复导入：同一文件再次导入仍然成功且不产生重复记录
  await goTo(page, "备份恢复");
  await uploadBackup(page, modified);
  await confirmImport(page);
  await uploadBackup(page, modified);
  await confirmImport(page);
  await goTo(page, "材料登记");
  await page.getByText(restoredCultivar, { exact: true }).first().waitFor();
  await page.getByText(/8 个材料中显示/).waitFor();
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
