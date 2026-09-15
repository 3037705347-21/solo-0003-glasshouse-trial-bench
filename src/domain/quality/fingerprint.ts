import type { WorkspaceState } from "../types";

/**
 * 稳定状态指纹：对规范化后的 JSON 做 FNV-1a 哈希。
 * - 对象键按字典序排列，消除键序差异；
 * - 只依赖数据内容，不依赖保存时间戳；
 * - 体积小，可直接写入修复会话，用于恢复对账和并发冲突检测。
 */
export function fingerprintState(state: WorkspaceState): string {
  const canonical = stableStringify(state);
  return fnv1a(canonical);
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  const pairs = keys.map(
    (key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`,
  );
  return `{${pairs.join(",")}}`;
}

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

function fnv1a(input: string): string {
  let hash = FNV_OFFSET;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, FNV_PRIME) >>> 0;
  }
  return `fnv1a-${hash.toString(16).padStart(8, "0")}`;
}
