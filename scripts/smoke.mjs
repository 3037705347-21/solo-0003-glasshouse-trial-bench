import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
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
  "attach-evidence-records": attachEvidenceRecords,
  "observation-repeat-upload": observationRepeatUpload,
  "merge-accession-attachments": mergeAccessionAttachments,
  "missing-attachment-file": missingAttachmentFile,
  "export-workspace-attachments": exportWorkspaceAttachments,
};

const scenarioPaths = {
  "curate-accession-roster": "/roster",
  "assign-accession-bench": "/layout",
  "record-observation-pass": "/observations",
  "advance-trial-clearance": "/clearance",
  "retire-accession-replacement": "/roster",
  "attach-evidence-records": "/roster",
  "observation-repeat-upload": "/observations",
  "merge-accession-attachments": "/roster",
  "missing-attachment-file": "/roster",
  "export-workspace-attachments": "/roster",
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
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
    acceptDownloads: true,
  });
  await page.goto(`${baseUrl}/#${path}`, { waitUntil: "networkidle" });
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  return page;
}

/** 在页面里用 canvas 生成一张有效 PNG，避免硬编码二进制夹具。 */
async function makePngFile(page, name, color) {
  const dataUrl = await page.evaluate((fill) => {
    const canvas = document.createElement("canvas");
    canvas.width = 8;
    canvas.height = 8;
    const context = canvas.getContext("2d");
    context.fillStyle = fill;
    context.fillRect(0, 0, 8, 8);
    return canvas.toDataURL("image/png");
  }, color);
  return {
    name,
    mimeType: "image/png",
    buffer: Buffer.from(dataUrl.split(",")[1], "base64"),
  };
}

function textFile(name, content) {
  return { name, mimeType: "text/plain", buffer: Buffer.from(content) };
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

async function assertCount(locator, expected, label) {
  const actual = await locator.count();
  if (actual !== expected) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
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

async function attachEvidenceRecords(page) {
  const pngRed = await makePngFile(page, "field-photo.png", "#cc3322");
  const pngBlue = await makePngFile(page, "anomaly-photo.png", "#2244cc");

  // 材料附件：上传成功
  await page.getByTestId("attachments-accession-acc-tom-01").click();
  const dialog = page.getByTestId("attachment-dialog");
  await dialog.waitFor();
  await dialog.getByTestId("attachment-upload-input").setInputFiles(pngRed);
  await dialog.getByText("已上传 field-photo.png", { exact: true }).waitFor();
  await assertCount(
    dialog.locator('[data-testid^="attachment-row-"]'),
    1,
    "accession attachment rows",
  );

  // 重复上传同一文件被拒绝，已有附件不被覆盖
  await dialog.getByTestId("attachment-upload-input").setInputFiles(pngRed);
  await dialog
    .getByText("相同内容的附件已存在，未重复上传", { exact: true })
    .waitFor();
  await assertCount(
    dialog.locator('[data-testid^="attachment-row-"]'),
    1,
    "rows after duplicate upload",
  );

  // 损坏文件被拒绝
  await dialog.getByTestId("attachment-upload-input").setInputFiles({
    name: "broken.png",
    mimeType: "image/png",
    buffer: Buffer.from("this is not a real png"),
  });
  await dialog
    .getByText("文件内容损坏或格式不符，未保存", { exact: true })
    .waitFor();
  await assertCount(
    dialog.locator('[data-testid^="attachment-row-"]'),
    1,
    "rows after corrupt upload",
  );

  // 超出大小限制被拒绝
  await dialog.getByTestId("attachment-upload-input").setInputFiles({
    name: "huge.png",
    mimeType: "image/png",
    buffer: Buffer.alloc(600 * 1024, 7),
  });
  await dialog.getByText("单个附件不能超过 500 KB", { exact: true }).waitFor();
  await assertCount(
    dialog.locator('[data-testid^="attachment-row-"]'),
    1,
    "rows after oversize upload",
  );

  // 非图片文件也可以上传
  await dialog
    .getByTestId("attachment-upload-input")
    .setInputFiles(textFile("inspection.txt", "inspector sign-off"));
  await dialog.getByText("已上传 inspection.txt", { exact: true }).waitFor();
  await assertCount(
    dialog.locator('[data-testid^="attachment-row-"]'),
    2,
    "rows after text upload",
  );

  // 查看图片附件
  const imageRow = dialog.locator('[data-testid^="attachment-row-"]', {
    hasText: "field-photo.png",
  });
  await imageRow.locator('[data-testid^="view-attachment-"]').click();
  const preview = page.getByTestId("attachment-preview-image");
  await preview.waitFor();
  const previewSrc = await preview.getAttribute("src");
  if (!previewSrc || !previewSrc.startsWith("data:image/png")) {
    throw new Error("attachment preview is not the uploaded image");
  }
  await page.getByRole("button", { name: "关闭", exact: true }).click();

  // 删除附件前必须明确确认
  const textRow = dialog.locator('[data-testid^="attachment-row-"]', {
    hasText: "inspection.txt",
  });
  await textRow.locator('[data-testid^="delete-attachment-"]').click();
  await page
    .getByTestId("confirm-delete-attachment")
    .getByText("确定删除「inspection.txt」吗？", { exact: false })
    .waitFor();
  await page.getByTestId("confirm-delete-attachment-button").click();
  await assertCount(
    dialog.locator('[data-testid^="attachment-row-"]'),
    1,
    "rows after confirmed delete",
  );
  await page.getByRole("button", { name: "关闭对话框" }).click();

  // 质量事件（标记）附件：上传后解除事件，证据仍然可追溯
  await page.goto(`${baseUrl}/#/observations`, { waitUntil: "networkidle" });
  const flagAttachments = page.getByTestId("flag-attachments");
  await flagAttachments
    .getByTestId("attachment-upload-input")
    .setInputFiles(pngBlue);
  await flagAttachments
    .getByText("已上传 anomaly-photo.png", { exact: true })
    .waitFor();
  await page
    .getByTestId("flag-resolution-note")
    .fill("已复核现场照片，株高恢复正常。");
  await page.getByTestId("resolve-flag").click();
  await page
    .getByText("该试验没有未处理的标记。", { exact: true })
    .waitFor();

  // 刷新后材料附件仍在且可打开
  await page.goto(`${baseUrl}/#/roster`, { waitUntil: "networkidle" });
  await page.reload({ waitUntil: "networkidle" });
  const accessionButton = await page
    .getByTestId("attachments-accession-acc-tom-01")
    .innerText();
  if (!accessionButton.includes("附件 1")) {
    throw new Error("accession attachment count not persisted after reload");
  }
  await page.getByTestId("attachments-accession-acc-tom-01").click();
  const reopened = page.getByTestId("attachment-dialog");
  await reopened.locator('[data-testid^="view-attachment-"]').click();
  await page.getByTestId("attachment-preview-image").waitFor();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "关闭对话框" }).click();

  // 停用材料后，附件仍保留在历史页并可查看
  await page.getByTestId("retire-accession-acc-tom-01").click();
  await page.getByTestId("retire-replacement-select").selectOption("acc-tom-02");
  await page
    .getByTestId("retire-accession-reason")
    .fill("批次结束，保留证据备查。");
  await page.getByTestId("confirm-retire-accession").click();
  await page.getByText("材料已停用", { exact: true }).waitFor();

  // 已解除的事件和已停用的材料，其附件仍可从历史页打开
  await page.goto(`${baseUrl}/#/accessions/acc-tom-01/history`, {
    waitUntil: "networkidle",
  });
  const attachmentsSection = page.getByTestId("accession-attachments-section");
  await attachmentsSection
    .getByText("field-photo.png", { exact: true })
    .waitFor();
  await attachmentsSection.locator('[data-testid^="view-attachment-"]').click();
  await page.getByTestId("attachment-preview-image").waitFor();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByTestId("attachments-flag-flag-tom-01").click();
  const flagDialog = page.getByTestId("attachment-dialog");
  await flagDialog.getByText("anomaly-photo.png", { exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭对话框" }).click();
}

async function observationRepeatUpload(page) {
  const pngA = await makePngFile(page, "pass-photo-a.png", "#117722");
  const pngB = await makePngFile(page, "pass-photo-b.png", "#771177");

  // 同一观测第一次上传
  await page.getByTestId("attachments-pass-obs-tom-01").click();
  let dialog = page.getByTestId("attachment-dialog");
  await dialog.waitFor();
  await dialog.getByTestId("attachment-upload-input").setInputFiles(pngA);
  await dialog.getByText("已上传 pass-photo-a.png", { exact: true }).waitFor();

  // 同一观测重复上传同一文件被拒绝
  await dialog.getByTestId("attachment-upload-input").setInputFiles(pngA);
  await dialog
    .getByText("相同内容的附件已存在，未重复上传", { exact: true })
    .waitFor();
  await assertCount(
    dialog.locator('[data-testid^="attachment-row-"]'),
    1,
    "rows after duplicate upload",
  );

  // 同一观测可以继续上传不同文件
  await dialog
    .getByTestId("attachment-upload-input")
    .setInputFiles(textFile("ec-log.txt", "ec readings"));
  await dialog.getByText("已上传 ec-log.txt", { exact: true }).waitFor();
  await assertCount(
    dialog.locator('[data-testid^="attachment-row-"]'),
    2,
    "rows after second file",
  );
  await page.getByRole("button", { name: "关闭对话框" }).click();

  // 关闭后再次打开，同一观测继续上传
  await page.getByTestId("attachments-pass-obs-tom-01").click();
  dialog = page.getByTestId("attachment-dialog");
  await dialog.getByTestId("attachment-upload-input").setInputFiles(pngB);
  await dialog.getByText("已上传 pass-photo-b.png", { exact: true }).waitFor();
  await assertCount(
    dialog.locator('[data-testid^="attachment-row-"]'),
    3,
    "rows after second session",
  );
  await page.getByRole("button", { name: "关闭对话框" }).click();

  // 刷新后同一观测的多次上传仍然完整
  await page.reload({ waitUntil: "networkidle" });
  const passButton = await page
    .getByTestId("attachments-pass-obs-tom-01")
    .innerText();
  if (!passButton.includes("附件 3")) {
    throw new Error("pass attachment count not persisted after reload");
  }
  await page.getByTestId("attachments-pass-obs-tom-01").click();
  dialog = page.getByTestId("attachment-dialog");
  await assertCount(
    dialog.locator('[data-testid^="attachment-row-"]'),
    3,
    "rows after reload",
  );
  const rowA = dialog.locator('[data-testid^="attachment-row-"]', {
    hasText: "pass-photo-a.png",
  });
  await rowA.locator('[data-testid^="view-attachment-"]').click();
  await page.getByTestId("attachment-preview-image").waitFor();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "关闭对话框" }).click();

  // 其他观测的附件数量不受影响
  await page
    .getByTestId("observation-trial-select")
    .selectOption("trial-ama-02");
  const otherLabel = await page
    .getByTestId("attachments-pass-obs-bee-01")
    .innerText();
  if (otherLabel.trim() !== "附件") {
    throw new Error("unrelated observation should have no attachments");
  }
}

async function mergeAccessionAttachments(page) {
  const png = await makePngFile(page, "merge-photo.png", "#aa5511");

  // 给 ACC-0003 上传两个附件
  await page.getByTestId("attachments-accession-acc-tom-03").click();
  const dialog = page.getByTestId("attachment-dialog");
  await dialog.waitFor();
  await dialog.getByTestId("attachment-upload-input").setInputFiles(png);
  await dialog.getByText("已上传 merge-photo.png", { exact: true }).waitFor();
  await dialog
    .getByTestId("attachment-upload-input")
    .setInputFiles(textFile("merge-note.txt", "merge evidence"));
  await dialog.getByText("已上传 merge-note.txt", { exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭对话框" }).click();

  // 合并 ACC-0003 到 ACC-0002
  await page.getByTestId("merge-accession-acc-tom-03").click();
  await page.getByTestId("merge-target-select").selectOption("acc-tom-02");
  await page
    .getByTestId("merge-accession-reason")
    .fill("重复批次合并，保留 ACC-0002 作为主记录。");
  await page.getByTestId("confirm-merge-accession").click();
  await page.getByText("材料已合并", { exact: true }).waitFor();
  const sourceRow = page.locator("tr").filter({ hasText: "ACC-0003" });
  await sourceRow.getByText("已停用", { exact: true }).waitFor();

  // 目标材料获得带溯源标记的附件副本，且可以打开
  await page.getByTestId("attachments-accession-acc-tom-02").click();
  const targetDialog = page.getByTestId("attachment-dialog");
  await assertCount(
    targetDialog.locator('[data-testid^="attachment-row-"]'),
    2,
    "merged attachment copies",
  );
  await assertCount(
    targetDialog.getByTestId("attachment-origin"),
    2,
    "origin badges on merged copies",
  );
  await targetDialog
    .getByText("源自 ACC-0003 · Yellow Pear · 合并", { exact: true })
    .first()
    .waitFor();
  const copyRow = targetDialog.locator('[data-testid^="attachment-row-"]', {
    hasText: "merge-photo.png",
  });
  await copyRow.locator('[data-testid^="view-attachment-"]').click();
  await page.getByTestId("attachment-preview-image").waitFor();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "关闭对话框" }).click();

  // 来源材料仍保留原始附件，且没有溯源标记
  await page.goto(`${baseUrl}/#/accessions/acc-tom-03/history`, {
    waitUntil: "networkidle",
  });
  const sourceSection = page.getByTestId("accession-attachments-section");
  await assertCount(
    sourceSection.locator('[data-testid^="attachment-row-"]'),
    2,
    "source original attachments",
  );
  await assertCount(
    sourceSection.getByTestId("attachment-origin"),
    0,
    "source rows should have no origin badge",
  );

  // 刷新后来源与目标的附件都保持正确指向
  await page.reload({ waitUntil: "networkidle" });
  await assertCount(
    page
      .getByTestId("accession-attachments-section")
      .locator('[data-testid^="attachment-row-"]'),
    2,
    "source attachments after reload",
  );
  await page.goto(`${baseUrl}/#/roster`, { waitUntil: "networkidle" });
  const targetLabel = await page
    .getByTestId("attachments-accession-acc-tom-02")
    .innerText();
  if (!targetLabel.includes("附件 2")) {
    throw new Error("merged attachment copies not persisted after reload");
  }

  // 放行检查不受附件合并影响
  await page.goto(`${baseUrl}/#/clearance`, { waitUntil: "networkidle" });
  await page.getByTestId("generate-clearance").click();
  await page.getByText("放行被阻止", { exact: true }).waitFor();
}

async function missingAttachmentFile(page) {
  const png = await makePngFile(page, "missing-soon.png", "#333333");
  await page.getByTestId("attachments-accession-acc-tom-01").click();
  const dialog = page.getByTestId("attachment-dialog");
  await dialog.waitFor();
  await dialog.getByTestId("attachment-upload-input").setInputFiles(png);
  await dialog.getByText("已上传 missing-soon.png", { exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭对话框" }).click();

  // 模拟附件内容缺失：直接改写本地存储中的数据
  await page.evaluate((key) => {
    const stored = JSON.parse(window.localStorage.getItem(key));
    stored.state.attachments = stored.state.attachments.map((attachment) => ({
      ...attachment,
      dataUrl: "",
    }));
    window.localStorage.setItem(key, JSON.stringify(stored));
  }, "glasshouse-trial-bench:workspace:v1");
  await page.reload({ waitUntil: "networkidle" });

  // 缺失状态明确可见，没有断链图片或失效的查看入口
  await page.getByTestId("attachments-accession-acc-tom-01").click();
  const missingDialog = page.getByTestId("attachment-dialog");
  await missingDialog.getByTestId("attachment-missing").waitFor();
  await assertCount(
    missingDialog.locator('[data-testid^="view-attachment-"]'),
    0,
    "view buttons for missing file",
  );
  await assertCount(
    missingDialog.locator(".attachment-thumb img"),
    0,
    "broken thumbnails for missing file",
  );
  await page.getByRole("button", { name: "关闭对话框" }).click();

  // 放行检查不受附件缺失影响
  await page.goto(`${baseUrl}/#/clearance`, { waitUntil: "networkidle" });
  await page.getByTestId("generate-clearance").click();
  await page.getByText("放行被阻止", { exact: true }).waitFor();

  // 删除缺失附件仍需确认，删除后无残留
  await page.goto(`${baseUrl}/#/roster`, { waitUntil: "networkidle" });
  await page.getByTestId("attachments-accession-acc-tom-01").click();
  const cleanupDialog = page.getByTestId("attachment-dialog");
  await cleanupDialog.locator('[data-testid^="delete-attachment-"]').click();
  await page.getByTestId("confirm-delete-attachment").waitFor();
  await page.getByTestId("confirm-delete-attachment-button").click();
  await assertCount(
    cleanupDialog.locator('[data-testid^="attachment-row-"]'),
    0,
    "rows after deleting missing file",
  );
  await page.reload({ waitUntil: "networkidle" });
  const label = await page
    .getByTestId("attachments-accession-acc-tom-01")
    .innerText();
  if (label.trim() !== "附件") {
    throw new Error("missing attachment should be fully removed");
  }
}

async function exportWorkspaceAttachments(page) {
  const png = await makePngFile(page, "export-photo.png", "#007766");
  await page.getByTestId("attachments-accession-acc-tom-01").click();
  const dialog = page.getByTestId("attachment-dialog");
  await dialog.waitFor();
  await dialog.getByTestId("attachment-upload-input").setInputFiles(png);
  await dialog.getByText("已上传 export-photo.png", { exact: true }).waitFor();
  await page.getByRole("button", { name: "关闭对话框" }).click();

  // 复制材料后附件带溯源标记
  await page.getByTestId("duplicate-accession-acc-tom-01").click();
  await page.getByText("材料已复制", { exact: true }).waitFor();
  const duplicateRow = page.locator("tr").filter({ hasText: "ACC-0009" });
  await duplicateRow.locator('[data-testid^="attachments-accession-"]').click();
  await page
    .getByTestId("attachment-dialog")
    .getByText("源自 ACC-0001 · Tiny Tim · 复制", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "关闭对话框" }).click();

  // 导出工作区，附件随记录一并写入文件
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByTestId("export-workspace").click(),
  ]);
  const exportPath = await download.path();
  const exported = JSON.parse(await readFile(exportPath, "utf8"));
  if (
    !exported.state ||
    !Array.isArray(exported.state.attachments) ||
    exported.state.attachments.length !== 2
  ) {
    throw new Error("exported workspace does not contain both attachments");
  }

  // 清空工作区后回到示例数据，附件消失
  await page.evaluate(() => window.localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  const wipedLabel = await page
    .getByTestId("attachments-accession-acc-tom-01")
    .innerText();
  if (wipedLabel.trim() !== "附件") {
    throw new Error("expected sample workspace without attachments after wipe");
  }

  // 无效文件导入被拒绝，当前工作区不受影响
  await page.getByTestId("import-workspace-input").setInputFiles({
    name: "broken.json",
    mimeType: "application/json",
    buffer: Buffer.from("{ not a workspace"),
  });
  await page.getByText("导入失败", { exact: true }).waitFor();

  // 导入导出的工作区，附件和溯源标记一并恢复
  await page.getByTestId("import-workspace-input").setInputFiles(exportPath);
  await page.getByTestId("confirm-import-workspace").waitFor();
  await page.getByTestId("confirm-import-workspace-button").click();
  await page.getByText("工作区已导入", { exact: true }).waitFor();
  await page.getByTestId("attachments-accession-acc-tom-01").click();
  const importedDialog = page.getByTestId("attachment-dialog");
  await importedDialog
    .getByText("export-photo.png", { exact: true })
    .waitFor();
  await importedDialog.locator('[data-testid^="view-attachment-"]').click();
  await page.getByTestId("attachment-preview-image").waitFor();
  await page.getByRole("button", { name: "关闭", exact: true }).click();
  await page.getByRole("button", { name: "关闭对话框" }).click();
  const importedDuplicateRow = page.locator("tr").filter({ hasText: "ACC-0009" });
  await importedDuplicateRow
    .locator('[data-testid^="attachments-accession-"]')
    .click();
  await page
    .getByTestId("attachment-dialog")
    .getByText("源自 ACC-0001 · Tiny Tim · 复制", { exact: true })
    .waitFor();
  await page.getByRole("button", { name: "关闭对话框" }).click();

  // 刷新后导入的附件仍可用
  await page.reload({ waitUntil: "networkidle" });
  const importedLabel = await page
    .getByTestId("attachments-accession-acc-tom-01")
    .innerText();
  if (!importedLabel.includes("附件 1")) {
    throw new Error("imported attachments not persisted after reload");
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
