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
  "merge-duplicate-accessions": mergeDuplicateAccessions,
  "merge-conflict-guardrails": mergeConflictGuardrails,
};

const scenarioPaths = {
  "curate-accession-roster": "/roster",
  "assign-accession-bench": "/layout",
  "record-observation-pass": "/observations",
  "advance-trial-clearance": "/clearance",
  "retire-accession-replacement": "/roster",
  "merge-duplicate-accessions": "/duplicates",
  "merge-conflict-guardrails": "/duplicates",
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
  await page.getByText("ACC-0011", { exact: true }).first().waitFor();
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

async function assertDisabled(locator, label) {
  if (!(await locator.isDisabled())) {
    throw new Error(`${label}: expected disabled`);
  }
}

async function assertEnabled(locator, label) {
  if (!(await locator.isEnabled())) {
    throw new Error(`${label}: expected enabled`);
  }
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

async function mergeDuplicateAccessions(page) {
  // 其他试验的已保存快照在本次合并前后必须字节不变。
  await page.goto(`${baseUrl}/#/clearance`, { waitUntil: "networkidle" });
  await page.getByTestId("clearance-trial-select").selectOption("trial-ama-02");
  await page.getByTestId("generate-clearance").click();
  const beetSnapshotBefore = await page
    .locator(".clearance-preview")
    .nth(1)
    .getByTestId("clearance-snapshot")
    .innerText();

  // 证据页：系统给出相似依据和区分依据，而不是直接合并。
  await page.goto(`${baseUrl}/#/duplicates`, { waitUntil: "networkidle" });
  await page
    .locator(".duplicate-card")
    .filter({ hasText: "ACC-0002" })
    .filter({ hasText: "ACC-0009" })
    .waitFor();
  const likelyCard = page
    .locator(".duplicate-card")
    .filter({ hasText: "ACC-0002" })
    .filter({ hasText: "ACC-0009" });
  await likelyCard.getByText("品种名完全一致").waitFor();
  await likelyCard.getByText("来源相同").waitFor();

  // “看起来相似但必须保留”的对可以人工排除（切换到甜菜试验）。
  await page.getByTestId("duplicates-trial-filter").selectOption("trial-ama-02");
  const possibleCard = page
    .locator(".duplicate-card")
    .filter({ hasText: "ACC-0004" })
    .filter({ hasText: "ACC-0010" });
  await possibleCard.getByText("可能重复", { exact: true }).waitFor();
  await possibleCard.getByText("繁殖日期相差过大").waitFor();
  await possibleCard.getByRole("button", { name: /是不同批次/ }).click();
  await page.getByText("已标记为不同批次", { exact: true }).waitFor();
  await assertCount(
    possibleCard,
    0,
    "dismissed pair hidden from candidates",
  );

  // 切回番茄试验，发起合并。
  await page.getByTestId("duplicates-trial-filter").selectOption("trial-sol-01");

  // 发起合并：存活者、字段冲突、台架冲突逐项裁决。
  await likelyCard.getByRole("button", { name: /发起合并/ }).click();
  await page.getByTestId("merge-accessions-form").waitFor();
  await page
    .getByTestId("merge-survivor-acc-tom-02")
    .getByText("存活者")
    .waitFor();
  // 基因型说明冲突，显式选择来源。
  const genotypeConflict = page
    .locator(".merge-conflict-row")
    .filter({ hasText: "基因型" });
  await genotypeConflict
    .locator("label")
    .filter({ hasText: "ACC-0009" })
    .click();
  // 数量冲突：选择求和。
  await page.getByTestId("merge-quantity-sum").check();
  // 两个来源在 E-1 与 E-2，必须显式选择唯一台架。
  await page.getByTestId("merge-target-bench-bench-east-1").check();
  await page
    .getByTestId("merge-reason-input")
    .fill("两批实为同一批 Micro Tom，仅编号和标签写法不同。");
  await page.getByTestId("confirm-merge-accessions").click();
  await page.getByText("批次已合并", { exact: true }).waitFor();

  // 当前操作唯一归属：ACC-0009 变成“已合并”墓碑，指向 ACC-0002。
  await page.goto(`${baseUrl}/#/roster`, { waitUntil: "networkidle" });
  const tombstoneRow = page.locator("tr").filter({ hasText: "ACC-0009" });
  await tombstoneRow.getByText("已合并", { exact: true }).waitFor();
  await tombstoneRow.getByText("归属 ACC-0002 - Micro Tom", { exact: true }).waitFor();
  // 编号不可复用：下一个编号仍然跳过 0009/0010。
  await page.getByTestId("open-create-accession").click();
  await page.getByTestId("accession-number-input").waitFor();
  const nextNo = await page.getByTestId("accession-number-input").inputValue();
  if (nextNo === "ACC-0009" || nextNo === "ACC-0010") {
    throw new Error(`merged accession number was reused: ${nextNo}`);
  }
  await page.getByRole("button", { name: "取消" }).click();

  // 台架唯一归属：E-2 不再占用，Micro Tom 在 E-1。
  await page.goto(`${baseUrl}/#/layout`, { waitUntil: "networkidle" });
  await assertCount(
    page.getByTestId("bench-card-bench-east-2").locator(".bench-accession-row"),
    0,
    "source bench cleared after merge",
  );
  await page
    .getByTestId("bench-card-bench-east-1")
    .getByText("ACC-0002", { exact: false })
    .first()
    .waitFor();
  await assertCount(
    page.getByTestId("assignment-accession-select").locator('option[value="acc-tom-04"]'),
    0,
    "tombstone in assignment selector",
  );

  // 观测被重写到存活者，且带来源标签；同 pass 碰撞只保留存活者条目。
  await page.goto(`${baseUrl}/#/observations`, { waitUntil: "networkidle" });
  const collidingPass = page
    .locator('[data-testid^="pass-"]')
    .filter({ hasText: "2026-02-26" });
  await assertCount(
    collidingPass.getByText("ACC-0002", { exact: false }),
    1,
    "duplicate survivor entries after merge",
  );
  const rewrittenPass = page
    .locator('[data-testid^="pass-"]')
    .filter({ hasText: "2026-03-06" });
  await rewrittenPass.getByText("ACC-0002", { exact: false }).waitFor();
  await rewrittenPass.getByText("原 ACC-0009").waitFor();

  // 墓碑历史页仍能解释原始来源。
  await page.goto(
    `${baseUrl}/#/accessions/acc-tom-04/history`,
    { waitUntil: "networkidle" },
  );
  await page.getByText("身份已合并", { exact: true }).waitFor();
  await page.getByTestId("tombstone-survivor-link").click();
  await page
    .getByTestId("accession-history-page")
    .getByText("ACC-0009 · MicroTom", { exact: false })
    .waitFor();
  await page.getByText("合并审计记录", { exact: true }).waitFor();
  await page.getByText("同次观测碰撞中留档的测量值", { exact: true }).waitFor();

  // 持久化：刷新后身份关系仍在。
  await page.reload({ waitUntil: "networkidle" });
  await page
    .getByTestId("accession-history-page")
    .getByText("合并审计记录", { exact: true })
    .waitFor();

  // 已保存快照不可变：其他试验快照的 DOM 内容与合并前一致。
  await page.goto(`${baseUrl}/#/clearance`, { waitUntil: "networkidle" });
  await page.getByTestId("clearance-trial-filter");
  await page.getByTestId("clearance-trial-select").selectOption("trial-ama-02");
  const beetSnapshotAfter = await page
    .locator(".clearance-preview")
    .nth(1)
    .getByTestId("clearance-snapshot")
    .innerText();
  if (beetSnapshotAfter !== beetSnapshotBefore) {
    throw new Error("saved clearance snapshot changed after accession merge");
  }
}

async function createAccessionViaForm(page, values) {
  await page.getByTestId("open-create-accession").click();
  await page.getByTestId("accession-number-input").fill(values.accessionNo);
  await page.getByTestId("cultivar-input").fill(values.cultivar);
  await page.getByLabel("来源").fill(values.source);
  await page.getByLabel("繁殖日期").fill(values.propagatedOn);
  await page.getByLabel("数量").fill(String(values.quantity));
  await page.getByLabel("适宜光照").selectOption(values.preferredLight);
  await page.locator("textarea").first().fill(values.note);
  await page.getByTestId("save-accession-button").click();
  await page
    .locator("tr")
    .filter({ hasText: values.accessionNo })
    .first()
    .waitFor();
}

async function getAccessionId(page, accessionNo) {
  return page.evaluate((no) => {
    const raw = localStorage.getItem("glasshouse-trial-bench:workspace:v1");
    return JSON.parse(raw).state.accessions.find((a) => a.accessionNo === no)?.id;
  }, accessionNo);
}

async function retireRow(page, accessionNo, replacementLabel) {
  const row = page.locator("tr").filter({ hasText: accessionNo }).first();
  await row.getByRole("button", { name: "停用" }).click();
  if (replacementLabel) {
    await page.getByTestId("retire-replacement-select").selectOption({
      label: replacementLabel,
    });
  }
  await page
    .getByTestId("retire-accession-reason")
    .fill("护栏验证用批次，完成后停用。");
  await page.getByTestId("confirm-retire-accession").click();
  await row.getByText("已停用", { exact: true }).waitFor();
}

async function mergeConflictGuardrails(page) {
  // 造两个高数量、光照冲突的“同一品种”批次。
  const pairValues = {
    cultivar: "Guard Ridge",
    source: "Guardrail Seed House",
    propagatedOn: "2026-02-25",
  };
  await page.goto(`${baseUrl}/#/roster`, { waitUntil: "networkidle" });
  await createAccessionViaForm(page, {
    ...pairValues,
    accessionNo: "ACC-0011",
    quantity: 300,
    preferredLight: "full-sun",
    note: "护栏测试批次一，全日照品系，数量较大。",
  });
  await createAccessionViaForm(page, {
    ...pairValues,
    accessionNo: "ACC-0012",
    quantity: 250,
    preferredLight: "shade",
    note: "护栏测试批次二，遮阴品系，数量较大。",
  });
  const id11 = await getAccessionId(page, "ACC-0011");
  const id12 = await getAccessionId(page, "ACC-0012");

  // 分别放到全日照台架 E-2 和遮阴台架 N-1。
  await page.goto(`${baseUrl}/#/layout`, { waitUntil: "networkidle" });
  await page
    .getByTestId("assignment-accession-select")
    .selectOption({ label: "ACC-0011 - Guard Ridge" });
  await page.getByTestId(`assign-bench-bench-east-2`).click();
  await page.getByText("台架分配成功", { exact: true }).first().waitFor();
  await page
    .getByTestId("assignment-accession-select")
    .selectOption({ label: "ACC-0012 - Guard Ridge" });
  await page.getByTestId(`assign-bench-bench-north-1`).click();
  await page.getByText("台架分配成功", { exact: true }).first().waitFor();

  // 两个候选都停用：弹窗不能卡死，确认按钮必须禁用，并支持就地恢复其一。
  await page.goto(`${baseUrl}/#/roster`, { waitUntil: "networkidle" });
  await retireRow(page, "ACC-0011", "ACC-0002 - Micro Tom");
  await retireRow(page, "ACC-0012", "ACC-0002 - Micro Tom");

  await page.goto(`${baseUrl}/#/duplicates`, { waitUntil: "networkidle" });
  const retiredPairCard = page
    .locator(".duplicate-card")
    .filter({ hasText: "ACC-0011" })
    .filter({ hasText: "ACC-0012" });
  await retiredPairCard.getByRole("button", { name: /发起合并/ }).click();
  await page.getByTestId("merge-accessions-form").waitFor();
  // 没有在用存活者时，确认合并不可提交，而不是弹出“无法合并”死路。
  assertDisabled(
    page.getByTestId("confirm-merge-accessions"),
    "confirm button with no operational survivor",
  );
  await page
    .getByTestId(`merge-restore-confirm-${id11}`)
    .check();
  await page.getByTestId(`merge-restore-${id11}`).click();
  await page
    .getByTestId(`merge-survivor-${id11}`)
    .getByText("存活者", { exact: true })
    .waitFor();
  assertEnabled(
    page.getByTestId("confirm-merge-accessions"),
    "confirm button after inline restore",
  );

  // 数量护栏：求和 550 超过 500，单选项必须禁用；自定义 501 也被领域层拒绝。
  const sumRadio = page.getByTestId("merge-quantity-sum");
  await sumRadio.waitFor();
  assertDisabled(sumRadio, "quantity sum over 500");
  await page.getByText(`数量求和（550）：超过 500 上限，不可用`).waitFor();
  await page.locator(".merge-quantity-row input[type=radio]").nth(2).check();
  await page.getByTestId("merge-quantity-custom").fill("501");
  // 光照默认取存活者（全日照）；目标台架选择 E-2。
  await page.getByTestId("merge-target-bench-bench-east-2").check();
  await page
    .getByTestId("merge-reason-input")
    .fill("两批 Guard Ridge 实为同一批重复录入，护栏验证合并。");
  await page.getByTestId("confirm-merge-accessions").click();
  await page
    .getByTestId("merge-quantity-error")
    .getByText("1 到 500")
    .waitFor();
  // 改回保留 300 后通过；N-1 的占用必须被移除，存活者唯一落在 E-2。
  await page.locator(".merge-quantity-row input[type=radio]").first().check();
  await page.getByTestId("confirm-merge-accessions").click();
  await page.getByText("批次已合并", { exact: true }).waitFor();

  const stateAfterFirstMerge = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("glasshouse-trial-bench:workspace:v1")).state,
  );
  const survivor11 = stateAfterFirstMerge.accessions.find((a) => a.id === id11);
  const tombstone12 = stateAfterFirstMerge.accessions.find((a) => a.id === id12);
  if (tombstone12.lifecycleStatus !== "merged" || tombstone12.mergedIntoId !== id11) {
    throw new Error("retired member did not become a tombstone pointing at survivor");
  }
  if (survivor11.quantity !== 300 || survivor11.preferredLight !== "full-sun") {
    throw new Error("survivor quantity/light changed unexpectedly");
  }
  const east2 = stateAfterFirstMerge.benches.find((b) => b.id === "bench-east-2");
  const north1 = stateAfterFirstMerge.benches.find((b) => b.id === "bench-north-1");
  if (!east2.assignedIds.includes(id11)) {
    throw new Error("survivor not placed on the chosen compatible bench");
  }
  if (east2.assignedIds.includes(id12) || north1.assignedIds.includes(id12) || north1.assignedIds.includes(id11)) {
    throw new Error("merged identities left on a non-target bench");
  }

  // 光照护栏：再造一对，字段裁决改为遮阴后，全日照台架必须被拒绝。
  await page.goto(`${baseUrl}/#/roster`, { waitUntil: "networkidle" });
  await createAccessionViaForm(page, {
    ...pairValues,
    accessionNo: "ACC-0013",
    quantity: 40,
    preferredLight: "full-sun",
    note: "护栏测试批次三，默认全日照。",
  });
  await createAccessionViaForm(page, {
    ...pairValues,
    accessionNo: "ACC-0014",
    quantity: 40,
    preferredLight: "shade",
    note: "护栏测试批次四，实际为遮阴。",
  });
  const id13 = await getAccessionId(page, "ACC-0013");
  await page.goto(`${baseUrl}/#/layout`, { waitUntil: "networkidle" });
  await page
    .getByTestId("assignment-accession-select")
    .selectOption({ label: "ACC-0013 - Guard Ridge" });
  await page.getByTestId(`assign-bench-bench-east-2`).click();
  await page.getByText("台架分配成功", { exact: true }).first().waitFor();

  await page.goto(`${baseUrl}/#/duplicates`, { waitUntil: "networkidle" });
  const secondPairCard = page
    .locator(".duplicate-card")
    .filter({ hasText: "ACC-0013" })
    .filter({ hasText: "ACC-0014" });
  await secondPairCard.getByRole("button", { name: /发起合并/ }).click();
  await page.getByTestId("merge-accessions-form").waitFor();
  // 在“适宜光照”冲突行选择 ACC-0014 的遮阴值。
  const lightConflict = page
    .locator(".merge-conflict-row")
    .filter({ hasText: "适宜光照" });
  await lightConflict
    .locator("label")
    .filter({ hasText: "ACC-0014" })
    .click();
  // E-2 是全日照台架，选项上出现不兼容徽标，且提交被领域层拒绝。
  const east2Option = page
    .locator("label.merge-option")
    .filter({ has: page.getByTestId("merge-target-bench-bench-east-2") });
  await east2Option.getByText("不兼容").waitFor();
  await page.getByTestId("merge-target-bench-bench-east-2").check();
  await page
    .getByTestId("merge-reason-input")
    .fill("两批 Guard Ridge 重复录入，合并后按遮阴养护。");
  await page.getByTestId("confirm-merge-accessions").click();
  await page
    .getByTestId("merge-bench-error")
    .getByText("不兼容")
    .waitFor();
  // 改选“不分配台架”后合并成功，存活者不落在任何台架上。
  await page.getByTestId("merge-target-bench-unassigned").check();
  await page.getByTestId("confirm-merge-accessions").click();
  await page.getByText("批次已合并", { exact: true }).waitFor();

  const stateAfterSecondMerge = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("glasshouse-trial-bench:workspace:v1")).state,
  );
  const survivor13 = stateAfterSecondMerge.accessions.find((a) => a.id === id13);
  if (survivor13.preferredLight !== "shade") {
    throw new Error("survivor light did not follow field resolution");
  }
  const onAnyBench = stateAfterSecondMerge.benches.some((bench) =>
    bench.assignedIds.includes(id13),
  );
  if (onAnyBench) {
    throw new Error("survivor landed on a bench after choosing unassigned");
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
