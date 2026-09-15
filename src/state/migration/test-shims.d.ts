/**
 * 仅测试构建用：项目本身不依赖 @types/node，这里用最小声明让 tsc 编译
 * node:test / node:assert 导入；运行时由 Node 提供真实实现。
 */
declare module "node:test" {
  export function test(name: string, fn: () => void | Promise<void>): void;
}
declare module "node:assert/strict" {
  interface AssertStrict {
    (value: unknown, message?: string | Error): void;
    equal(actual: unknown, expected: unknown, message?: string | Error): void;
    deepEqual(actual: unknown, expected: unknown, message?: string | Error): void;
    ok(value: unknown, message?: string | Error): void;
    notEqual(actual: unknown, expected: unknown, message?: string | Error): void;
  }
  const assert: AssertStrict;
  export default assert;
}
