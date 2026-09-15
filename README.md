# 温室试验台

温室试验台是一个离线优先的 React 工作台，用于管理作物试验。它把材料登记、台架分配、生长观测和放行检查集中到一个本地浏览器工具中。

## 本地运行

```bash
npm install
npm run dev
```

打开 Vite 输出的地址。应用默认进入材料登记页，数据保存在浏览器的本地存储中，命名空间为 `glasshouse-trial-bench:workspace:v1`。

## 数据质量中心

入口：`/#/quality`

应用在启动时自动扫描六大领域（试验、材料、台架、观测、标记、放行快照）与持久化版本。
问题按「阻断 / 警告 / 提示」分组，每条都展示涉及对象、规则代码和可追溯证据。
- 对确定性的安全问题（悬空台架引用、同一材料跨多个台架、台架内重复登记、
  受限台架占用、派生状态矛盾、可证实的标记试验引用错误）提供逐项勾选的修复。
- 所有修复必须先**整批预演**：在副本上计算逐项结果、预计终态与冲突，
  用户逐项确认后才一次性应用；重复执行是幂等的，已修复项会跳过。
- 无法自动判断的问题（容量该移出谁、观测引用消失对象、快照历史偏差等）
  只提供跳转到对应工作流的人工处理入口，绝不删除观测、标记或快照历史。
- 整批修复创建可恢复会话：中断后再次进入会提示继续执行、整批回滚或放弃；
  会话冻结修复前状态并保留审计历史。
- 无法解析、结构不符或版本未知的持久化数据会进入**隔离区**而不是被示例数据覆盖；
  原始内容可导出，只有在用户核对后显式清除。

## 构建

```bash
npm run build
```

构建会先执行 TypeScript 项目引用检查，再由 Vite 输出生产包到 `dist/`。

## 工作流检查

当前项目的自动化检查分两层：领域逻辑使用 Node 内置测试运行器，公开工作流使用无头浏览器。

### 单元测试（检查器、幂等修复、持久化引导）

```bash
npm run test:unit
```

类型检查后，测试会用 rolldown 打包 `test/*.test.ts` 并交给 `node:test` 执行，
覆盖健康工作区、单项损坏、多个关联损坏、整批预演、幂等修复、修复中断后续跑/回滚，
以及损坏持久化数据的隔离与版本检查。

### 生产冒烟（无头浏览器）

```bash
node scripts/smoke.mjs curate-accession-roster
node scripts/smoke.mjs assign-accession-bench
node scripts/smoke.mjs record-observation-pass
node scripts/smoke.mjs advance-trial-clearance
node scripts/smoke.mjs quality-healthy-workspace
node scripts/smoke.mjs quality-repair-damage
node scripts/smoke.mjs quality-recovery-resume
node scripts/smoke.mjs quality-corrupt-persistence
```

每条命令都会启动并关闭一个本地 Vite 预览服务，端口为 `4177`。检查过程不调用外部服务，也不依赖在线数据库。

## 目录结构

```text
src/
  app/                    路由组合、应用外壳和启动质量横幅
  domain/                 实体、校验、状态转换、规则与数据质量中心领域
    quality/              跨对象/跨状态/跨版本检查器、幂等修复、修复会话
  state/                  reducer、选择器、示例状态、持久化与隔离区
  features/
    roster/               材料登记和编辑
    layout/               台架分配工作区
    observations/         观测记录和标记处理
    clearance/            放行快照工作区
    quality/              数据质量中心页面、预演对话框和恢复横幅
  components/             共享 UI 原语
  styles/                 应用样式
scripts/
  smoke.mjs               无头浏览器工作流检查
  run-unit-tests.mjs      领域单元测试打包与运行
test/                     数据质量领域与持久化引导单元测试
```

## 输入与输出

- 输入：试验信息、材料信息、台架约束、观测测量、标记处理、放行请求和数据质量修复确认。
- 输出：本地持久化工作区、更新的台架布局、派生生长标记、放行快照、质量报告与修复审计记录。

本地使用不需要环境变量。
