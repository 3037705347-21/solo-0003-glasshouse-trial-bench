/**
 * 版本迁移注册表。
 *
 * 规则：
 * - 每个结构版本恰好对应一个“从 N 到 N+1”的步骤，按版本顺序串行执行，禁止跳版本。
 * - 迁移只允许无损、确定性的操作：补默认值、重命名/搬运字段、重组派生数据。
 *   不允许删除任何记录或字段——未知字段必须原样透传（实现上统一使用展开拷贝）。
 * - 引用完整性问题不在这里“修复”（删除会丢事实）；它由 integrity 扫描登记为
 *   待人工处理项。
 * - 迁移函数不应主动抛错；一旦抛出，运行器会捕获并把本次升级判定为失败，
 *   调用方进入恢复模式而不是落盘。
 */

export interface StateMigration {
  fromVersion: number;
  toVersion: number;
  name: string;
  migrate: (state: unknown) => unknown;
}

type RecordBag = Record<string, unknown>;

function isRecord(value: unknown): value is RecordBag {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function mapCollection(
  state: RecordBag,
  key: string,
  mapRecord: (record: RecordBag) => RecordBag,
): void {
  const collection = state[key];
  if (!Array.isArray(collection)) {
    // 集合缺失或不是数组属于损坏，交由结构校验判定为失败；迁移不猜测。
    return;
  }
  state[key] = collection.map((item) =>
    isRecord(item) ? mapRecord(item) : item,
  );
}

/**
 * v1 -> v2：
 * 材料停用/替代生命周期落地。旧版本保存的 accession 可能缺少
 * `lifecycleStatus` 与 `retirementHistory`（这正是旧 persistence.normalizeAccession
 * 在内存里临时补的字段）。升级时把它们固化进数据：
 * - lifecycleStatus 缺省时由 retiredAt 推断（retired / active）；
 * - retirementHistory 缺省为空数组。
 * 其余字段（含当前代码不认识的字段）随展开原样保留。
 */
const migrateV1ToV2: StateMigration = {
  fromVersion: 1,
  toVersion: 2,
  name: "accession-lifecycle",
  migrate: (input) => {
    if (!isRecord(input)) {
      return input;
    }
    const state: RecordBag = { ...input };
    mapCollection(state, "accessions", (accession) => ({
      ...accession,
      lifecycleStatus:
        typeof accession.lifecycleStatus === "string" &&
        accession.lifecycleStatus.length > 0
          ? accession.lifecycleStatus
          : accession.retiredAt
            ? "retired"
            : "active",
      retirementHistory: Array.isArray(accession.retirementHistory)
        ? accession.retirementHistory
        : [],
      // 历史数据可能缺少标签数组；空数组是确定且无损的默认值。
      labels: Array.isArray(accession.labels) ? accession.labels : [],
    }));
    // 台架分配列表缺失时补空数组（无分配）。
    mapCollection(state, "benches", (bench) => ({
      ...bench,
      assignedIds: Array.isArray(bench.assignedIds) ? bench.assignedIds : [],
    }));
    return state;
  },
};

/**
 * 迁移表，按 fromVersion 升序。新增版本时在此追加一个步骤，
 * 并把 CURRENT_SCHEMA_VERSION 提升到目标版本。
 */
export const STATE_MIGRATIONS: readonly StateMigration[] = [migrateV1ToV2];
