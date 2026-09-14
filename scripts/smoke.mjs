import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";

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
};

const scenarioPaths = {
  "curate-accession-roster": "/roster",
  "assign-accession-bench": "/layout",
  "record-observation-pass": "/observations",
  "advance-trial-clearance": "/clearance",
};

// Track the preview server currently running so signal handlers can clean it
// up instead of leaving an orphaned process behind.
let activeServer = null;

function killActiveServer() {
  if (activeServer && activeServer.exitCode === null && !activeServer.killed) {
    activeServer.kill("SIGKILL");
  }
}

process.on("SIGINT", () => {
  killActiveServer();
  process.exit(130);
});
process.on("SIGTERM", () => {
  killActiveServer();
  process.exit(143);
});
process.on("exit", killActiveServer);

// Prefer the conventional preview port, but fall back to an ephemeral one so
// a stale process holding 4177 does not break the run.
async function findFreePort(preferred = 4177) {
  const tryPort = (port) =>
    new Promise((resolve) => {
      const probe = net.createServer();
      probe.once("error", () => resolve(null));
      probe.listen(port, "127.0.0.1", () => {
        const { port: assigned } = probe.address();
        probe.close(() => resolve(assigned));
      });
    });
  return (await tryPort(preferred)) ?? (await tryPort(0));
}

async function waitForServer(baseUrl, server) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (server.exitCode !== null) {
      throw new Error(`Preview server exited early with code ${server.exitCode}`);
    }
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
  throw new Error(`Preview server did not start at ${baseUrl}`);
}

async function stopServer(server) {
  if (server.exitCode !== null) {
    return;
  }
  server.kill("SIGTERM");
  const exited = await Promise.race([
    new Promise((resolve) => server.once("exit", () => resolve(true))),
    delay(3000).then(() => false),
  ]);
  if (!exited) {
    server.kill("SIGKILL");
    await new Promise((resolve) => server.once("exit", resolve));
  }
}

async function freshPage(browser, baseUrl, path) {
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

async function runScenario(scenarioName) {
  const port = await findFreePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const server = spawn(
    viteBin,
    ["preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: root, stdio: "pipe" },
  );
  activeServer = server;

  let serverOutput = "";
  server.stderr.on("data", (chunk) => {
    serverOutput += chunk;
  });

  let browser;
  try {
    await waitForServer(baseUrl, server);
    browser = await chromium.launch({ headless: true });
    const page = await freshPage(browser, baseUrl, scenarioPaths[scenarioName]);
    await scenarios[scenarioName](page);
    await page.close();
    console.log(`✅ 场景通过: ${scenarioName}`);
  } catch (error) {
    if (serverOutput) {
      console.error(`--- preview server output ---\n${serverOutput.trim()}\n-----------------------------`);
    }
    throw error;
  } finally {
    if (browser) {
      await browser.close().catch(() => {});
    }
    await stopServer(server);
    activeServer = null;
  }
}

const requested = process.argv[2];
const scenarioNames = Object.keys(scenarios);

if (requested && !scenarios[requested]) {
  console.error(`未知场景: ${requested}`);
  console.error(`用法: npm run smoke -- <${scenarioNames.join("|")}>`);
  console.error("不带参数时依次运行全部场景。");
  process.exit(2);
}

if (!existsSync(`${root}dist/index.html`)) {
  console.error("未找到 dist/index.html,请先运行 npm run build 再执行冒烟检查。");
  process.exit(2);
}

const queue = requested ? [requested] : scenarioNames;
let completed = 0;

for (const name of queue) {
  console.log(`\n[smoke] (${completed + 1}/${queue.length}) 运行场景: ${name}`);
  try {
    await runScenario(name);
  } catch (error) {
    console.error(`❌ 场景失败: ${name}`);
    console.error(error);
    console.error(
      `[smoke] 已通过 ${completed}/${queue.length} 个场景,在「${name}」处停止,后续场景未执行。`,
    );
    process.exit(1);
  }
  completed += 1;
}

console.log(`\n[smoke] 全部 ${queue.length} 个场景通过。`);
