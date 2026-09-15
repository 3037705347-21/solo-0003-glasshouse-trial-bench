/**
 * 用 rolldown 把 TS 验证脚本即时打包为 ESM 再执行，
 * 避免给项目引入测试框架依赖。
 */
import { rolldown } from "rolldown";
import { pathToFileURL } from "node:url";
import { rm } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const entry = path.join(root, "scripts", "audit-logic-check.ts");
const outfile = path.join(root, "node_modules", ".cache", "audit-logic-check.mjs");

const bundle = await rolldown({
  input: entry,
  platform: "node",
  target: "es2022",
});
await bundle.write({
  file: outfile,
  format: "esm",
});
await bundle.close();

try {
  await import(pathToFileURL(outfile).href);
} finally {
  await rm(outfile, { force: true }).catch(() => undefined);
}
