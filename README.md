# 温室试验台

温室试验台是一个离线优先的 React 工作台，用于管理作物试验。它把材料登记、台架分配、生长观测和放行检查集中到一个本地浏览器工具中。

## 本地运行

```bash
npm install
npm run dev
```

打开 Vite 输出的地址。应用默认进入材料登记页，数据保存在浏览器的本地存储中，命名空间为 `glasshouse-trial-bench:workspace:v1`。追加式审计日志使用独立命名空间 `glasshouse-trial-bench:audit:v1`，重置或导入工作区都不会清空它。

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
node scripts/smoke.mjs audit-trail
node scripts/smoke.mjs audit-reset-batch
```

每条命令都会启动并关闭一个本地 Vite 预览服务，端口为 `4177`。检查过程不调用外部服务，也不依赖在线数据库。

审计日志的纯逻辑不变量（相邻操作顺序、序号连续、失败不记录、批量整体条目、重置只追加、对象移除后无死链、不落整份状态）可以直接用 Node 验证：

```bash
npm run audit:check
```

## 目录结构

```text
src/
  app/                    路由组合和应用外壳
  domain/                 实体、校验、状态转换和规则（含审计条目构建）
  state/                  reducer、选择器、示例状态和持久化
  features/
    roster/               材料登记和编辑
    layout/               台架分配工作区（含批量移出）
    observations/         观测记录和标记处理
    clearance/            放行快照工作区
    audit/                追加式审计日志、对象跳转解析
  components/             共享 UI 原语
  styles/                 应用样式
scripts/
  smoke.mjs               无头浏览器工作流检查
  audit-logic-check.ts    审计纯逻辑不变量检查（经 run-audit-logic-check.mjs 打包执行）
```

## 审计日志

入口：`/#/audit`。审计日志只追加，记录试验、材料、台架、观测、标记和放行快照的关键变更，每条条目包含操作时间、对象、变化前后摘要和结果；失败的校验操作不会落日志。重置和导入恢复记录为一条 `workspace.replaced` 整体操作，可展开到每个对象的新建、更新与移除差异；布局页的批量移出记录为一条包含多个台架子项的条目。条目只保存可读摘要（长文本截断、列表只记编号与计数），不保存整份状态副本。每个子项可跳回仍存在的对象；对象已被删除时保留历史摘要并标注「对象已不存在」，不渲染死链。

## 输入与输出

- 输入：试验信息、材料信息、台架约束、观测测量、标记处理和放行请求。
- 输出：本地持久化工作区、更新的台架布局、派生生长标记和放行快照。

本地使用不需要环境变量。
