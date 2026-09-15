#!/usr/bin/env node
// 单元测试运行器：用 rolldown 把每个 *.test.ts 打包为 CJS，再交给 node:test 执行。
// 不引入 vitest/jest 等新依赖；类型检查由 `tsc -p test/tsconfig.json` 单独负责。
import { rmSync, readdirSync, mkdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { rolldown } from "rolldown";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const testDir = join(root, "test");
const outDir = join(root, ".test-build");

rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

const testFiles = readdirSync(testDir).filter((name) =>
  name.endsWith(".test.ts"),
);

if (testFiles.length === 0) {
  console.error("No test files found");
  process.exit(2);
}

const builtFiles = [];
for (const name of testFiles) {
  const file = join(testDir, name);
  const bundle = await rolldown({
    input: file,
    external: [/^node:/],
  });
  const outFile = join(outDir, name.replace(/\.ts$/, ".cjs"));
  await bundle.write({
    file: outFile,
    format: "cjs",
    sourcemap: false,
    codeSplitting: false,
  });
  await bundle.close();
  builtFiles.push(outFile);
}

const child = spawn(process.execPath, ["--test", ...builtFiles], {
  stdio: "inherit",
});
child.on("exit", (code) => process.exit(code === 0 ? 0 : 1));
