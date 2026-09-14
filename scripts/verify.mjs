import { spawn } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const steps = [
  { label: "类型检查", args: ["run", "typecheck"] },
  { label: "生产构建", args: ["run", "build"] },
  { label: "浏览器冒烟(全部场景)", args: ["run", "smoke"] },
];

function runStep(step, index) {
  console.log(`\n[verify] (${index + 1}/${steps.length}) ${step.label}: npm ${step.args.join(" ")}`);
  return new Promise((resolve) => {
    const child = spawn(npm, step.args, { cwd: root, stdio: "inherit" });
    child.on("exit", (code, signal) => {
      if (code === 0) {
        console.log(`[verify] ✅ ${step.label} 通过`);
        resolve(true);
      } else {
        const reason = signal ? `被信号 ${signal} 终止` : `退出码 ${code}`;
        console.error(`[verify] ❌ ${step.label} 失败(${reason})`);
        resolve(false);
      }
    });
    child.on("error", (error) => {
      console.error(`[verify] ❌ ${step.label} 无法启动: ${error.message}`);
      resolve(false);
    });
  });
}

for (const [index, step] of steps.entries()) {
  const ok = await runStep(step, index);
  if (!ok) {
    console.error(`\n[verify] 验证终止:第 ${index + 1} 步「${step.label}」未通过,后续步骤未执行。`);
    process.exit(1);
  }
}

console.log("\n[verify] 全部验证步骤通过。");
