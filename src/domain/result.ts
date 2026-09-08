export interface FieldError {
  field: string;
  code: string;
  message: string;
}

export type Result<T> =
  | { ok: true; value: T }
  | { ok: false; errors: FieldError[] };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T>(errors: FieldError[]): Result<T> {
  return { ok: false, errors };
}

export function fieldError(field: string, code: string, message: string): FieldError {
  return { field, code, message };
}

export function firstMessage(result: { ok: false; errors: FieldError[] }): string {
  return result.errors[0]?.message ?? "未知校验错误";
}

export function collectMessages(results: Array<Result<unknown>>): FieldError[] {
  return results.flatMap((result) => (result.ok ? [] : result.errors));
}
