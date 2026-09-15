# 温室试验台

温室试验台是一个离线优先的 React 工作台，用于管理作物试验。它把材料登记、台架分配、生长观测和放行检查集中到一个本地浏览器工具中。材料支持停用、替代和恢复，停用后保留历史观测、标记、台架与放行引用，但不会继续出现在新分配或新观测的选择器中。

观测录入是可恢复会话：巡场途中关闭对话框或刷新页面都不会丢失已填写内容。每条测量行有明确归属（待提交、已跳过、已失效、已提交），恢复或部分提交时会对照当前工作区重新对账——被停用或同日已被记录的材料行会标记失效并说明原因，重复提交由确定性观测编号幂等拦截，不会重复写入。

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
node scripts/smoke.mjs resume-observation-session
node scripts/smoke.mjs advance-trial-clearance
node scripts/smoke.mjs retire-accession-replacement
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
