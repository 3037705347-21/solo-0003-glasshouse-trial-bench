// 不依赖浏览器的页面渲染冒烟：用 react-dom/server 渲染全部路由。
// 运行：node scripts/verify-render.mjs
import { rolldown } from "rolldown";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const storage = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (storage.has(k) ? storage.get(k) : null),
    setItem: (k, v) => storage.set(k, String(v)),
    removeItem: (k) => storage.delete(k),
    clear: () => storage.clear(),
  },
};

const ENTRY = `
import React from "react";
import { renderToString } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { App } from "${root}/src/app/App.tsx";
import { WorkspaceProvider } from "${root}/src/state/store.tsx";
export function render(path) {
  return renderToString(
    React.createElement(
      WorkspaceProvider,
      null,
      React.createElement(MemoryRouter, { initialEntries: [path] }, React.createElement(App)),
    ),
  );
}
`;

const bundle = await rolldown({
  input: "entry",
  plugins: [
    {
      name: "virtual-entry",
      resolveId: (id) => (id === "entry" ? "\0entry" : null),
      load: (id) => (id === "\0entry" ? ENTRY : null),
    },
  ],
});
const generated = await bundle.generate({ format: "esm", entryFileNames: "entry.js" });
await bundle.close();
const dataUrl =
  "data:text/javascript;base64," +
  Buffer.from(generated.output[0].code, "utf8").toString("base64");
const mod = await import(dataUrl);

let failed = 0;
function expectContains(html, text, label) {
  if (html.includes(text)) {
    console.log(`  ✓ ${label}`);
  } else {
    console.error(`  ✗ ${label}（缺少 "${text}"）`);
    failed += 1;
  }
}

for (const [path, checks] of [
  ["/roster", ["材料登记", "新建材料", "Tiny Tim"]],
  ["/benches", ["台架台账与维护", "新建台架", "滴灌管路维修中", "受限", "N-2"]],
  ["/layout", ["台架布局", "东翼", "隔离", "台架台账"]],
  ["/observations", ["生长观测"]],
  ["/clearance", ["放行检查", "BENCH_BLOCKED", "滴灌管路维修中"]],
]) {
  console.log(`路由 ${path}`);
  let html;
  try {
    html = mod.render(path);
  } catch (error) {
    console.error(`  ✗ 渲染抛出异常: ${error?.stack || error}`);
    failed += 1;
    continue;
  }
  checks.forEach((text) => expectContains(html, text, `包含「${text}」`));
}

if (failed > 0) {
  console.error(`\n${failed} 项渲染断言失败`);
  process.exit(1);
}
console.log("\n✅ 全部路由渲染冒烟通过");
process.exit(0);
