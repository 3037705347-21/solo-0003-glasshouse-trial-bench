/**
 * 结构防护：持久化的 JSON 可能缺字段或类型错误。检查器必须把畸形对象
 * 作为问题报告出来，而不是让整个扫描崩溃。
 */

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export function isString(value: unknown): value is string {
  return typeof value === "string";
}

export function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function objectId(value: unknown, index: number): string {
  if (isRecord(value) && isNonEmptyString(value.id)) {
    return value.id;
  }
  return `[第 ${index + 1} 项]`;
}

export function objectLabel(
  value: unknown,
  codeFields: string[],
  fallback: string,
): string {
  if (isRecord(value)) {
    for (const field of codeFields) {
      if (isNonEmptyString(value[field])) {
        return value[field];
      }
    }
  }
  return fallback;
}
