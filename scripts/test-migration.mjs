#!/usr/bin/env node
/**
 * 迁移机制测试的本地运行器。
 *
 * 应用本身通过 Vite 打包（ESM、无扩展名导入），而这些测试只用 Node 内置的
 * node:test 运行、不依赖任何第三方测试框架。因此这里：
 * 1. 用专门的 tsconfig 把迁移核心 + 测试编译为 CommonJS 到 dist-test；
 * 2. 写入 package.json 标记 CommonJS（工作区根是 ESM）；
 * 3. 用 node --test 运行。
 * dist-test 已被 .gitignore 忽略。
 */
import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outDir = resolve(root, "dist-test");

const tsc = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["tsc", "-p", "src/state/migration/tsconfig.test.json"],
  { cwd: root, stdio: "inherit" },
);
if (tsc.status !== 0) {
  process.exit(tsc.status ?? 1);
}

mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, "package.json"), JSON.stringify({ type: "commonjs" }));

const run = spawnSync(
  process.execPath,
  ["--test", resolve(outDir, "state/migration")],
  { cwd: root, stdio: "inherit" },
);
process.exit(run.status ?? 1);
