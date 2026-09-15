# 温室试验台

温室试验台是一个离线优先的 React 工作台，用于管理作物试验。它把材料登记、台架分配、生长观测和放行检查集中到一个本地浏览器工具中。材料支持停用、替代和恢复，停用后保留历史观测、标记、台架与放行引用，但不会继续出现在新分配或新观测的选择器中。

## 重复治理与合并

入口：`/#/duplicates`（材料登记页也有“重复治理”按钮）。

系统只列出判断依据，不替人决定：每对候选展示编号、品种名近似、来源、繁殖日期、光照、穴盘和标签等相似信号，以及“光照互斥 / 繁殖日期相差过大”等强区分信号。看起来相似但属于不同批次时可标记为“是不同批次”（可恢复）。

确认是重复录入时，合并向导要求显式裁决：唯一存活批次、每个冲突字段的取值来源、数量策略（保留/求和/自定义）、多台架冲突时的唯一目标台架，以及合并依据。合并后：

- 台架占用、观测条目、标记和在用替代指针唯一归属存活批次；
- 被合并批次转为只读墓碑，编号永久不可复用；
- 观测和标记保留原始来源标签；同次观测碰撞中被丢弃的测量值写入审计记录；
- 已保存放行快照保持不变。

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
node scripts/smoke.mjs assign-accession-bench
node scripts/smoke.mjs record-observation-pass
node scripts/smoke.mjs advance-trial-clearance
node scripts/smoke.mjs retire-accession-replacement
node scripts/smoke.mjs merge-duplicate-accessions
node scripts/smoke.mjs merge-conflict-guardrails
```

每条命令都会启动并关闭一个本地 Vite 预览服务，端口为 `4177`。检查过程不调用外部服务，也不依赖在线数据库。

## 目录结构

```text
src/
  app/                    路由组合和应用外壳
  domain/                 实体、校验、状态转换和规则
  state/                  reducer、选择器、示例状态和持久化
  features/
    roster/               材料登记和编辑
    duplicates/           重复候选、证据展示和身份合并
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
