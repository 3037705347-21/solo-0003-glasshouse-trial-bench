# 温室试验台

温室试验台是一个离线优先的 React 工作台，用于管理作物试验。它把材料登记、台架分配、生长观测和放行检查集中到一个本地浏览器工具中。材料支持停用、替代和恢复，停用后保留历史观测、标记、台架与放行引用，但不会继续出现在新分配或新观测的选择器中。

## 本地运行

```bash
npm install
npm run dev
```

打开 Vite 输出的地址。应用默认进入材料登记页，业务状态保存在浏览器的本地存储中，命名空间为 `glasshouse-trial-bench:workspace:v1`；撤销/重做日志使用独立命名空间 `glasshouse-trial-bench:history:v1`。

## 撤销与重做

侧边栏底部提供线性撤销/重做。每个用户动作在进入业务 reducer 前都会被包装成一个带 ID、时间、反向语义和依赖范围的命令，命令与业务状态在同一个状态事务中提交；校验失败时不写日志、不改业务状态。

撤销不是回滚整个工作区，而是只反向命令触及的实体或字段。台架命令只增删对应分配 ID，编辑材料只恢复该实体，停用材料通过补偿性“恢复”记录保留审计历史。重做会重新检查当前容量、光照、编号冲突、生命周期和依赖关系；不安全时明确阻止并显示原因。

观测入库、受阻/已保存的放行快照、手工恢复生命周期以及草稿启动试验属于历史事实或永久业务栅栏，不提供删除式撤销。若这些事实之后又让较早命令失去安全前提，撤销会被拒绝，用户需要追加更正或执行新的业务动作。

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
npm run history
```

`npm run history` 是纯状态回归检查：构造“撤销放行后的命令 → 走新分支 → 撤销新分支 → 再撤销更早放行”的分支序列，并验证失败时业务状态与历史栈都保持不变。

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
