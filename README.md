# 温室试验台

温室试验台是一个离线优先的 React 工作台，用于管理作物试验。它把材料登记、台架分配、生长观测和放行检查集中到一个本地浏览器工具中。材料支持停用、替代和恢复，停用后保留历史观测、标记、台架与放行引用，但不会继续出现在新分配或新观测的选择器中。

材料编号由可配置的编号规则生成。负责人可以按试验、作物科属或来源设置前缀、日期段（无 / 年 / 年月 / 年月日）和序号方式（全局连续或按日期重新计数）。录入和批量导入时会先预览下一批编号并校验格式、长度和重复；试验复制时沿用同一规则并自动跳过规则已停用的材料。规则修改只影响新生成的编号，已有材料编号不可改写。

## 本地运行

```bash
npm install
npm run dev
```

打开 Vite 输出的地址。应用默认进入材料登记页，数据保存在浏览器的本地存储中，命名空间为 `glasshouse-trial-bench:workspace:v1`。

## 构建

```bash
npm run build
```

构建会先执行 TypeScript 项目引用检查，再由 Vite 输出生产包到 `dist/`。

## 工作流检查

当前项目处于延迟测试模式，本阶段不生成单元测试或 Playwright 测试文件，后续任务阶段再补充正式测试。以下生产级冒烟命令会启动无头浏览器，逐条验证公开工作流：

```bash
node scripts/smoke.mjs curate-accession-roster
node scripts/smoke.mjs configure-number-rules
node scripts/smoke.mjs batch-import-accessions
node scripts/smoke.mjs copy-trial-numbers
node scripts/smoke.mjs assign-accession-bench
node scripts/smoke.mjs record-observation-pass
node scripts/smoke.mjs advance-trial-clearance
node scripts/smoke.mjs retire-accession-replacement
```

每条命令都会启动并关闭一个本地 Vite 预览服务，端口为 `4177`。检查过程不调用外部服务，也不依赖在线数据库。

无浏览器环境下可用 rolldown 执行领域层和渲染层的 Node 检查：

```bash
node_modules/.bin/rolldown scripts/verify-numbering.mts --platform node --format esm -o /tmp/verify-numbering.mjs && node /tmp/verify-numbering.mjs
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
  smoke.mjs               无头浏览器工作流检查
```

## 输入与输出

- 输入：试验信息、材料信息、台架约束、观测测量、标记处理和放行请求。
- 输出：本地持久化工作区、更新的台架布局、派生生长标记和放行快照。

本地使用不需要环境变量。
