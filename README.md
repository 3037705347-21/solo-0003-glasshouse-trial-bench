# 温室试验台

温室试验台是一个离线优先的 React 工作台，用于管理作物试验。它把材料登记、台架分配、生长观测和放行检查集中到一个本地浏览器工具中。

## 本地运行

```bash
npm install
npm run dev
```

打开 Vite 输出的地址。应用默认进入材料登记页，数据保存在浏览器的本地存储中，命名空间为 `glasshouse-trial-bench:workspace:v1`。

## 构建与验证

标准安装后，先安装冒烟检查所需的无头浏览器，再运行统一验证命令：

```bash
npm install
npx playwright install chromium   # Linux 上如缺系统库,再执行 npx playwright install-deps chromium
npm run verify
```

`npm run verify` 按以下顺序执行，任一步失败都会以非零退出码终止，后续步骤不再执行，输出中会标明失败的是哪一步：

1. `npm run typecheck` — TypeScript 项目引用检查
2. `npm run build` — 类型检查加 Vite 生产构建，输出到 `dist/`
3. `npm run smoke` — 无头浏览器冒烟，依次运行全部四个工作流场景

## 工作流冒烟检查

当前项目处于延迟测试模式，本阶段不生成单元测试或 Playwright 测试文件，后续任务阶段再补充正式测试。以下生产级冒烟命令会启动无头浏览器，逐条验证公开工作流。

先构建，再运行全部场景（材料登记 → 台架分配 → 观测记录 → 放行检查）：

```bash
npm run build
npm run smoke
```

每个场景都会启动并关闭一个独立的本地 Vite 预览服务：优先使用端口 `4177`，被占用时自动改用空闲端口；场景结束（无论成败）都会回收服务进程，某个场景失败时立即停止，不再执行后续场景。检查过程不调用外部服务，也不依赖在线数据库。

单独调试某一场景时，把场景名传给 `npm run smoke`：

```bash
npm run smoke -- curate-accession-roster    # 材料登记
npm run smoke -- assign-accession-bench     # 台架分配
npm run smoke -- record-observation-pass    # 观测记录
npm run smoke -- advance-trial-clearance    # 放行检查
```

## 目录结构

```text
src/
  app/                    路由组合和应用外壳
  domain/                 实体、校验、状态转换和规则
  state/                  reducer、选择器、示例状态和持久化
  features/
    roster/               材料登记和编辑
    layout/               台架分配工作区
    observations/         观测记录和标记处理
    clearance/            放行快照工作区
  components/             共享 UI 原语
  styles/                 应用样式
scripts/
  smoke.mjs               无头浏览器工作流检查(默认运行全部场景,可指定单个场景)
  verify.mjs              统一验证入口:类型检查 → 构建 → 全部冒烟
```

## 输入与输出

- 输入：试验信息、材料信息、台架约束、观测测量、标记处理和放行请求。
- 输出：本地持久化工作区、更新的台架布局、派生生长标记和放行快照。

本地使用不需要环境变量。
