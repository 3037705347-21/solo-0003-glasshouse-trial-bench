# 温室试验台

温室试验台是一个离线优先的 React 工作台，用于管理作物试验。它把材料登记、台架分配、生长观测和放行检查集中到一个本地浏览器工具中。材料支持停用、替代和恢复，停用后保留历史观测、标记、台架与放行引用，但不会继续出现在新分配或新观测的选择器中。

材料、观测和质量事件（标记）都可以挂载附件：现场照片、检测单据或异常记录以图片或文件形式随记录持久化，刷新后仍可打开。材料被复制或合并时，附件会复制到目标记录并保留指向来源的溯源标记；停用材料、解除标记都不会丢失附件。重复上传、损坏文件和超限文件会被明确拒绝，删除附件前需要确认，内容缺失的附件会显式标注而不是留下断链。整个工作区（含附件）可以导出为 JSON 文件并重新导入。

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
node scripts/smoke.mjs attach-evidence-records
node scripts/smoke.mjs observation-repeat-upload
node scripts/smoke.mjs merge-accession-attachments
node scripts/smoke.mjs missing-attachment-file
node scripts/smoke.mjs export-workspace-attachments
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
    attachments/          附件上传、查看和删除面板
  components/             共享 UI 原语
  styles/                 应用样式
scripts/
  smoke.mjs               无头浏览器工作流检查
```

## 输入与输出

- 输入：试验信息、材料信息、台架约束、观测测量、标记处理、附件文件、工作区导入文件和放行请求。
- 输出：本地持久化工作区、更新的台架布局、派生生长标记、放行快照和含附件的工作区导出文件。

本地使用不需要环境变量。
