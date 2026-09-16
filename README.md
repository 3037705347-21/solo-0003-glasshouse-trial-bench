# 温室试验台

温室试验台是一个离线优先的 React 工作台，用于管理作物试验。它把材料登记、台架分配、生长观测和放行检查集中到一个本地浏览器工具中。材料支持停用、替代和恢复，停用后保留历史观测、标记、台架与放行引用，但不会继续出现在新分配或新观测的选择器中。

今日工作台（`/#/workbench`，默认首页）实时汇总当天及已逾期的观测计划、开放标记、待处理异常（未分配材料、隔离台架）、临近放行和台架维护事项。工作台不保存任何副本，每次打开或状态变化都直接从当前工作区记录重新派生；点击条目会带上下文跳回对应工作流，处理完成后返回即可看到事项消失。可按试验、对象类型（试验/材料/台架）和截止状态（逾期/今天/临近/待处理/已暂停）筛选。试验暂停后旧提醒会保留但冻结为“已暂停”，恢复后重新参与逾期计算。

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
node scripts/smoke.mjs review-today-workbench
```

每条命令都会启动并关闭一个本地 Vite 预览服务，端口为 `4177`。检查过程不调用外部服务，也不依赖在线数据库。

## 目录结构

```text
src/
  app/                    路由组合和应用外壳
  domain/                 实体、校验、状态转换和规则
  state/                  reducer、选择器、示例状态和持久化
  features/
    workbench/            今日工作台实时汇总
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
