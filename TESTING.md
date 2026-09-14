# 测试说明

领域层自动化测试，直接调用 `src/domain` 的公开函数（`validate*` / `create*` /
`assign*` / `transition*` / `deriveFlags` / `buildClearanceSnapshot` 等），并在需要
贯穿状态时通过公开的 `workspaceReducer` 折叠结果。测试不复制任何实现细节，只断言
公开行为；夹具使用确定性的内联数据，不依赖随机 id 或浏览器环境。

## 运行

```bash
npm install
npm test                 # 一次性运行全部领域测试（vitest run）
npm run test:watch       # 监听模式
npm run typecheck:test   # 对测试本身做类型检查
npm run smoke            # 既有的四条 Playwright 冒烟路径（需系统 Chromium 依赖）
```

测试为纯 Node 环境，无需浏览器、服务器或网络，可在本地稳定重复运行。

## 文件与覆盖

| 文件 | 覆盖内容 |
| --- | --- |
| `tests/accession.test.ts` | 材料编号格式与重复（含编辑自身编号、跨试验唯一）、品种/来源必填、繁殖日期、数量 1–500 边界、穴盘规格白名单、光照枚举、基因型说明、多错误聚合与文本/标签规范化、编号建议 |
| `tests/bench.test.ts` | 三种光照偏好与台架光照的兼容矩阵、容量边界（末位、满位、利用率取整）、停用/隔离拒绝、同台重复、移出与状态恢复、有材料时禁止改光照，以及“同一材料不得同时位于多个台架”的业务不变量（直接分配与经 reducer 的完整工作流两种路径） |
| `tests/trial.test.ts` | 显式状态转换表全部合法/非法跳转、终态、同态转换、暂停不可直接放行；试验草稿编号/科属/目标/季节/日期顺序校验 |
| `tests/observation.test.ts` | 试验状态对录入的限制、观测日期（格式/未来/不存在日期）、观测人、空记录、未知材料、跨试验材料、单次重复材料、株高/叶片数/电导率测量边界与多错误行号 |
| `tests/flags.test.ts` | 60mm / 420mm 株高、5 片真叶、3.5mS/cm 电导率阈值与边界值、多标记组合、跨材料归属、未知材料跳过、open 初始态；标记处理说明（≥8 字符、空白裁剪、resolved/waived、非 open 不可再处理）；最近观测查询 |
| `tests/clearance.test.ts` | ready 场景；UNASSIGNED / BENCH_BLOCKED / BENCH_QUARANTINE / FLAG_* / NO_ACCESSIONS / TRIAL_DRAFT 在不同材料、台架、标记组合下的阻止项与 id 关联；四项指标数值；跨试验隔离；已处理标记不计；快照不可变；applyClearance 对 blocked/ready/暂停 的行为；快照检索 |
| `tests/workflow.test.ts` | 经公开 API + reducer 串联：草稿→进行中→建材料→分台架→观测派生标记→阻止放行→处理标记→放行→终态不可再观测 |

## 当前结果

`180` 个用例：**174 通过 / 6 失败**。6 个失败全部对应真实领域缺陷，见
[测试报告](#缺陷报告)。用例有意保持红色以暴露缺陷，未通过修改业务逻辑来迎合。

## 缺陷报告

> 以下为测试暴露的真实缺陷。仅记录，未修改 `src/domain` 中的任何业务逻辑。

### D1. 同一材料可同时分配到多个台架（业务不变量被破坏，严重）

- **位置**：`src/domain/bench.ts` 的 `canAssignAccession` / `validateBenchAssignment` /
  `assignAccession`；`LayoutPage.handleAssign` 也没有在分配到新台架前从旧台架移出。
- **输入**：材料 `acc-1`（偏好 `partial-shade`）先分到 `full-sun` 台架 `b1`；
  随后把同一 `acc-1` 分到另一个有空位、光照兼容的 `partial-shade` 台架 `b2`。
- **预期**：第二次分配被拒绝（或先从 `b1` 移出再放入 `b2`），材料任意时刻只在一个台架上。
- **实际**：第二次分配成功，`b1.assignedIds` 与 `b2.assignedIds` 同时包含 `acc-1`。
  现有校验只检查“该台架上是否已含此材料”（duplicate）和本台容量/光照/状态，
  完全没有检查其他台架；`validateBenchAssignment` 的函数签名甚至不接收台架列表。
- **影响**：布局数据出现物理上不可能的双重占位；台架利用率、空位与“在用台架”指标
  全部被高估，可能导致超卖台架。注意 `state/selectors.ts` 的 `benchForAccession`
  用 `find` 只返回第一个台架，UI 状态与底层数据会不一致。
- **对应用例**：`tests/bench.test.ts`
  “材料已在其他台架时，再分配到第二个台架必须被拒绝”。

### D2. 观测可引用其他试验的材料（数据归属越界，严重）

- **位置**：`src/domain/observation.ts` 的 `validateObservationDraft`。
- **输入**：`draft.trialId = "trl-1"`，但测量条目引用的材料 `acc-9` 属于
  `trl-9`（该材料在 `state.accessions` 中存在）。
- **预期**：以 `entries.N.accessionId` 错误拒绝（材料必须属于当前试验）。
- **实际**：校验只用全局 `state.accessions` 建立 id 集合，不核对
  `accession.trialId === draft.trialId`，因此跨试验材料被接受并入库、派生标记。
- **影响**：观测次与标记被挂到错误试验；`deriveFlags` 仍能找到该材料并生成标记，
  污染 `trl-1` 的放行阻止项与指标；示例工作区中多个试验并存，UI 的材料下拉虽按
  试验过滤，但领域层（唯一的状态变更路径）没有兜底。
- **对应用例**：`tests/observation.test.ts` “引用其他试验的材料时必须拒绝”。

### D3. 暂停试验可借由放行快照直接进入已放行，绕过状态转换表（严重）

- **位置**：`src/domain/clearance.ts` 的 `applyClearance`（与 `buildClearanceSnapshot`
  缺少 paused 阻止项）。
- **输入**：`state = "paused"` 的试验，材料全部分配、台架可用、无未处理标记。
- **预期**：转换表仅允许 `active → cleared`（及 `paused → active`）；暂停试验不能
  被放行，快照应给出阻止项，`applyClearance` 不应改变状态。
- **实际**：快照 `status = "ready"`（只把 `draft` 列为阻止项），
  `applyClearance` 无条件把该试验置为 `cleared`。
- **影响**：绕过显式生命周期，暂停中的试验可被直接放行；与 `trial.ts` 的转换规则
  自相矛盾。`ClearancePage` 对非草稿态一律显示“生成快照”，该路径在 UI 中可达。
- **对应用例**：`tests/clearance.test.ts`
  “暂停试验即使快照就绪，也不能通过放行绕过转换表进入已放行状态”。

### D4. 不存在的日历日期被接受（跨三处日期输入，根因同一）

- **根因位置**：`src/domain/rules.ts` 的 `parseDateOnly`：
  正则只校验 `YYYY-MM-DD` 形状，随后 `new Date("2026-02-30T00:00:00")` 会被 JS
  规范化为 3 月 2 日而不是 `Invalid Date`，因此越界日（2 月 30 日、非闰年 2 月 29 日、
  11 月 31 日等）全部通过。
- **三处表现与对应用例**：
  1. 试验开始/结束日期：`validateTrialDraft({startDate:"2026-02-30"})` 返回成功
     —— `tests/trial.test.ts` “开始日期无效时拒绝”。
  2. 材料繁殖日期：`validateAccessionDraft({propagatedOn:"2026-02-29"})`（2026 非闰年）
     返回成功 —— `tests/accession.test.ts`
     “拒绝不存在的日历日期（2026 年非闰年的 2 月 29 日）”。
  3. 观测日期：`validateObservationDraft({observedOn:"2026-02-30"})` 返回成功
     —— `tests/observation.test.ts` “拒绝不存在的日历日期”。
- **预期**：上述输入分别以 `invalid_date` / `date_sequence` 等字段错误拒绝。
- **实际**：均被接受，并被静默改写成另一个日期参与后续比较与持久化。
- **影响**：无效日期进入存储并污染日期先后比较（例如结束早于开始、观测未来日的
  判断可能被改写后的日期绕过）；与“无效繁殖日期/观测日期必须被拒绝”的产品规则不符。

## 未覆盖风险

- **浏览器/组件层**：本套测试针对领域层；React 页面交互、toast、对话框、localStorage
  持久化（含损坏值回退示例工作区）仅由原 4 条 Playwright 冒烟路径粗覆盖。本环境缺少
  Chromium 系统库（`libnspr4.so` 等）且无 root 权限，冒烟路径未能在此运行。
- **reducer 动作合法性**：reducer 是无条件折叠动作的薄通道，未测试“对不存在 id 派发
  动作”等异常输入（UI 当前不会产生，但领域层也没有防护）。
- **跨实体一致性**：除“单材料单台架”外，未验证删除/修改材料或台架后，既有观测、标记、
  快照中悬空引用的处理（产品目前不提供删除入口）。
- **时钟相关**：`accessionAgeDays`、`trialDaysRemaining`、观测“今天”边界依赖系统时钟，
  未注入固定时钟做跨时区/跨午夜测试（日期比较按 UTC 午夜构造，极端时区下“今天”可能偏移）。
- **数量与穴盘容量关系**：现有规则不校验数量与穴盘规格（如 72 穴盘培育 500 株是否需要
  多盘），产品规格未定义该规则，故未测试。
- **快照 id / 时间戳**：`createId` 与 `new Date().toISOString()` 输出未做断言，仅断言
  其存在性，避免依赖随机性与时钟。
