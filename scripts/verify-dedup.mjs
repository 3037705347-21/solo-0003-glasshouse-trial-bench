/**
 * 观测去重终态一致性的独立验证。
 *
 * 与 scripts/smoke.mjs 的区别：四条路径都不依赖 toast / 徽章等页面提示，
 * 而是操作真实 UI 后直接读取 localStorage 中持久化的工作区状态做断言，
 * 并在裁决后刷新页面再次读取，验证不只是内存态。
 *
 * 覆盖：
 *   1. 恰好等于 0.3 容差（|3.7-3.4| 原始浮点差为 0.30000000000000027）→ withinTolerance=true，建议收敛
 *   2. 刚超出容差（EC Δ=0.4）→ withinTolerance=false，建议保留重测
 *   3. 人工整条收敛 → 失败方 open 标记全部 withdrawn 并持久化，保留方不受影响
 *   4. 人工部分收敛 → 仅共同材料标记 withdrawn，同次观测的其他材料保持 open
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
const TRIAL = "trial-sol-01";
const ACC1 = "acc-tom-01";
const ACC2 = "acc-tom-02";
const ACC3 = "acc-tom-03";
const OBSERVER = "M. Ikeda";

let failures = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✅ ${message}`);
  } else {
    failures += 1;
    console.error(`  ❌ ${message}`);
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

async function freshPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 1000 } });
  await page.goto(`${baseUrl}/#/observations`, { waitUntil: "networkidle" });
  await page.evaluate((key) => window.localStorage.clear(key), STORAGE_KEY);
  await page.reload({ waitUntil: "networkidle" });
  return page;
}

/** 直接读取已持久化的工作区状态（而不是页面元素）。 */
async function persistedState(page) {
  return page.evaluate((key) => {
    const stored = JSON.parse(window.localStorage.getItem(key));
    return stored.state;
  }, STORAGE_KEY);
}

async function waitForPersisted(page, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await persistedState(page);
    if (predicate(last)) {
      return last;
    }
    await delay(100);
  }
  throw new Error("持久化状态未在时限内满足断言条件");
}

async function fillEntryRow(row, { accessionId, height, leaf, ec }) {
  if (accessionId) {
    await row.locator("select").first().selectOption(accessionId);
  }
  const numbers = row.locator('input[type="number"]');
  await numbers.nth(0).fill(String(height));
  await numbers.nth(1).fill(String(leaf));
  await numbers.nth(2).fill(String(ec));
}

async function savePass(page, entries) {
  await page.getByTestId("open-observation-form").click();
  await page.getByTestId("observer-input").fill(OBSERVER);
  for (let index = 0; index < entries.length; index += 1) {
    if (index > 0) {
      await page.getByRole("button", { name: "添加行" }).click();
    }
    await fillEntryRow(page.locator(".entry-row").nth(index), entries[index]);
  }
  await page.getByTestId("save-observation-button").click();
  // 对话框关闭即保存动作完成（review / 收敛 / 普通保存都会关闭）。
  await page.getByTestId("observation-form").waitFor({ state: "detached" });
}

function flagsOf(state, passId, accessionId) {
  return state.flags.filter(
    (flag) =>
      flag.observationPassId === passId &&
      flag.accessionId === accessionId,
  );
}

async function adjudicateConverge(page, note) {
  await page.getByTestId("verdict-converge").first().check();
  await page.getByTestId("review-decided-by").fill("L. Tanaka");
  await page.getByTestId("review-note").fill(note);
  await page.getByTestId("submit-review").click();
  await page.getByTestId("review-queue").waitFor({ state: "detached" });
}

// 路径 1：EC 业务差值恰好等于容差 0.3（原始浮点差为 0.30000000000000027，略大于 0.3）。
async function pathExactTolerance(page) {
  console.log("路径 1：恰好等于容差（EC 3.4 vs 3.7）");
  const rawArtifact = await page.evaluate(() => Math.abs(3.7 - 3.4));
  assert(rawArtifact > 0.3, `原始浮点差 ${rawArtifact} 确实大于 0.3（缺陷前提成立）`);

  await savePass(page, [{ accessionId: ACC2, height: 50, leaf: 4, ec: 3.4 }]);
  await savePass(page, [{ accessionId: ACC2, height: 50, leaf: 4, ec: 3.7 }]);

  const state = await waitForPersisted(
    page,
    (current) =>
      current.duplicateReviews.some(
        (review) => review.trialId === TRIAL && review.status === "pending",
      ),
  );
  const review = state.duplicateReviews
    .filter((item) => item.trialId === TRIAL)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const diff = review.differences.find((item) => item.accessionId === ACC2);
  assert(diff.ecDelta === 0.3, `业务精度差值记为 ${diff.ecDelta}（不是浮点原值 ${rawArtifact}）`);
  assert(diff.withinTolerance === true, "恰好等于容差判定为容差内，不被误判为合理重测");
  assert(review.suggestion === "converge", "工单建议为收敛");
}

// 路径 2：EC 差值刚超出一个业务步长（3.3 vs 3.7 = 0.4）。
async function pathJustOverTolerance(page) {
  console.log("路径 2：刚超出容差（EC 3.3 vs 3.7，Δ=0.4）");
  await savePass(page, [{ accessionId: ACC2, height: 50, leaf: 4, ec: 3.3 }]);
  await savePass(page, [{ accessionId: ACC2, height: 50, leaf: 4, ec: 3.7 }]);

  const state = await waitForPersisted(
    page,
    (current) =>
      current.duplicateReviews.some(
        (review) => review.trialId === TRIAL && review.status === "pending",
      ),
  );
  const review = state.duplicateReviews
    .filter((item) => item.trialId === TRIAL)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  const diff = review.differences.find((item) => item.accessionId === ACC2);
  assert(diff.ecDelta === 0.4, `业务精度差值记为 ${diff.ecDelta}`);
  assert(diff.withinTolerance === false, "刚超出容差判定为容差外");
  assert(review.suggestion === "keep_both", "工单建议为两次都保留（合理重测）");
}

// 路径 3：人工整条收敛——失败方标记 withdrawn 且持久化，保留方不变。
async function pathWholeConvergence(page) {
  console.log("路径 3：人工整条收敛后标记终态与持久化");
  await savePass(page, [{ accessionId: ACC2, height: 50, leaf: 4, ec: 3.4 }]);
  const afterFirst = await waitForPersisted(
    page,
    (current) =>
      current.observationPasses.some(
        (pass) =>
          pass.entries.some((entry) => entry.accessionId === ACC2) &&
          pass.observer === OBSERVER,
      ),
  );
  const existingPassId = afterFirst.observationPasses
    .filter((pass) => pass.observer === OBSERVER)
    .sort((left, right) => right.recordedAt.localeCompare(left.recordedAt))[0].id;

  await savePass(page, [{ accessionId: ACC2, height: 50, leaf: 4, ec: 3.7 }]);
  const beforeReview = await waitForPersisted(
    page,
    (current) =>
      current.duplicateReviews.some(
        (review) => review.trialId === TRIAL && review.status === "pending",
      ),
  );
  const candidatePassId = beforeReview.duplicateReviews
    .filter((review) => review.trialId === TRIAL)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0]
    .candidatePassId;

  // 裁决前双方各有 3 个 open 标记（HT_UNDER / LEAF_LOW / EC_HIGH）。
  assert(
    flagsOf(beforeReview, candidatePassId, ACC2).every((flag) => flag.state === "open") &&
      flagsOf(beforeReview, candidatePassId, ACC2).length === 3,
    "裁决前失败方的 3 个标记均为 open",
  );

  await adjudicateConverge(page, "EC 业务差值恰好 0.3 落在重测容差内，按重复录入收敛到先一次记录。");

  let state = await waitForPersisted(
    page,
    (current) =>
      current.observationPasses.find((pass) => pass.id === candidatePassId)
        ?.dedupStatus === "converged",
  );

  const candidate = state.observationPasses.find((pass) => pass.id === candidatePassId);
  const existing = state.observationPasses.find((pass) => pass.id === existingPassId);
  assert(candidate.dedupStatus === "converged", "失败方观测整次标记为 converged");
  assert(candidate.canonicalPassId === existingPassId, "失败方指向权威观测");
  assert(
    JSON.stringify(candidate.convergedAccessionIds) === JSON.stringify([ACC2]),
    "收敛材料集合为共同材料",
  );
  assert(existing.dedupStatus === "canonical", "保留方仍为 canonical，不受收敛影响");

  const loserFlags = flagsOf(state, candidatePassId, ACC2);
  assert(loserFlags.length === 3, "失败方 3 个标记都还在（不物理删除）");
  assert(
    loserFlags.every((flag) => flag.state === "withdrawn"),
    "失败方共同材料的未处理标记全部进入 withdrawn",
  );
  assert(
    loserFlags.every((flag) => /去重裁决/.test(flag.resolutionNote ?? "")),
    "撤回标记写明收敛去向审计 id",
  );
  const survivorFlags = flagsOf(state, existingPassId, ACC2);
  assert(
    survivorFlags.every((flag) => flag.state === "open"),
    "保留方标记保持 open，不被收敛改写",
  );
  const review = state.duplicateReviews.find(
    (item) => item.candidatePassId === candidatePassId,
  );
  assert(review.status === "resolved" && review.verdict === "converge", "工单记录为已裁决收敛");
  assert(
    state.dedupAudits.some(
      (audit) =>
        audit.kind === "manual" &&
        audit.candidatePassId === candidatePassId &&
        audit.canonicalPassId === existingPassId,
    ),
    "人工裁决写入 manual 审计",
  );

  // 刷新后再次直接读取持久化状态。
  await page.reload({ waitUntil: "networkidle" });
  state = await persistedState(page);
  const reloadedCandidate = state.observationPasses.find((pass) => pass.id === candidatePassId);
  const reloadedLoserFlags = flagsOf(state, candidatePassId, ACC2);
  assert(
    reloadedCandidate.dedupStatus === "converged" &&
      reloadedCandidate.canonicalPassId === existingPassId,
    "刷新后收敛终态仍然持久化",
  );
  assert(
    reloadedLoserFlags.every((flag) => flag.state === "withdrawn"),
    "刷新后失败方标记仍为 withdrawn（真正写入存储而非仅内存）",
  );
}

// 路径 4：人工部分收敛——失败方仅共同材料撤回，同次观测其他材料保持 open。
async function pathPartialConvergence(page) {
  console.log("路径 4：人工部分收敛（共同材料撤回，其他材料不受影响）");
  await savePass(page, [
    { accessionId: ACC1, height: 50, leaf: 4, ec: 3.4 },
    { accessionId: ACC2, height: 50, leaf: 4, ec: 3.4 },
  ]);
  await savePass(page, [
    { accessionId: ACC1, height: 50, leaf: 4, ec: 3.7 }, // 共同材料，恰好容差边界
    { accessionId: ACC3, height: 50, leaf: 4, ec: 3.7 }, // 失败方独有的新材料
  ]);

  const pending = await waitForPersisted(
    page,
    (current) =>
      current.duplicateReviews.some(
        (review) => review.trialId === TRIAL && review.status === "pending",
      ),
  );
  const review = pending.duplicateReviews
    .filter((item) => item.trialId === TRIAL)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
  assert(
    JSON.stringify(review.sharedAccessionIds) === JSON.stringify([ACC1]),
    "工单共同材料只含 ACC1（ACC3 是失败方独有，不参与收敛）",
  );
  const candidatePassId = review.candidatePassId;
  const existingPassId = review.existingPassId;

  await adjudicateConverge(page, "仅共同材料在容差内收敛；ACC3 是另一个材料的独立测量，保留。");

  let state = await waitForPersisted(
    page,
    (current) =>
      current.observationPasses.find((pass) => pass.id === candidatePassId)
        ?.dedupStatus === "partially_converged",
  );
  const candidate = state.observationPasses.find((pass) => pass.id === candidatePassId);
  assert(
    candidate.dedupStatus === "partially_converged",
    "失败方仅部分材料收敛，状态为 partially_converged",
  );
  assert(
    JSON.stringify(candidate.convergedAccessionIds) === JSON.stringify([ACC1]),
    "convergedAccessionIds 只含共同材料 ACC1",
  );

  const sharedFlags = flagsOf(state, candidatePassId, ACC1);
  assert(
    sharedFlags.length === 3 &&
      sharedFlags.every((flag) => flag.state === "withdrawn"),
    "共同材料 ACC1 的 3 个 open 标记全部 withdrawn",
  );
  const otherFlags = flagsOf(state, candidatePassId, ACC3);
  assert(
    otherFlags.length === 3 &&
      otherFlags.every((flag) => flag.state === "open"),
    "同次观测的其他材料 ACC3 标记保持 open，不受收敛影响",
  );
  assert(
    flagsOf(state, existingPassId, ACC1).every((flag) => flag.state === "open") &&
      flagsOf(state, existingPassId, ACC2).every((flag) => flag.state === "open"),
    "保留方两份材料（ACC1/ACC2）的标记都保持 open",
  );

  await page.reload({ waitUntil: "networkidle" });
  state = await persistedState(page);
  const reloaded = state.observationPasses.find((pass) => pass.id === candidatePassId);
  assert(
    reloaded.dedupStatus === "partially_converged" &&
      JSON.stringify(reloaded.convergedAccessionIds) === JSON.stringify([ACC1]) &&
      flagsOf(state, candidatePassId, ACC1).every((flag) => flag.state === "withdrawn") &&
      flagsOf(state, candidatePassId, ACC3).every((flag) => flag.state === "open"),
    "刷新后部分收敛与标记撤回终态仍然持久化",
  );
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

    for (const scenario of [
      pathExactTolerance,
      pathJustOverTolerance,
      pathWholeConvergence,
      pathPartialConvergence,
    ]) {
      const page = await freshPage(browser);
      try {
        await scenario(page);
      } finally {
        await page.close();
      }
    }

    if (failures > 0) {
      throw new Error(`${failures} 项去重终态断言失败`);
    }
    console.log("\n✅ 去重终态一致性四条路径全部通过（断言基于持久化状态）");
  } finally {
    if (browser) {
      await browser.close();
    }
    server.kill("SIGTERM");
    await new Promise((resolve) => server.once("exit", resolve));
  }
}

run().catch((error) => {
  console.error("\n❌ 去重验证失败");
  console.error(error);
  process.exit(1);
});
