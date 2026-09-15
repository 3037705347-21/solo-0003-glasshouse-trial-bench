import type { StorageLike } from "../src/state/persistence";

export class MemoryStorage implements StorageLike {
  private map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }

  get size(): number {
    return this.map.size;
  }

  keys(): string[] {
    return [...this.map.keys()];
  }

  snapshot(): Map<string, string> {
    return new Map(this.map);
  }

  restore(snapshot: Map<string, string>): void {
    this.map = new Map(snapshot);
  }
}

export function seedWorkspace(
  storage: StorageLike,
  state: import("../src/domain/types").WorkspaceState,
): void {
  storage.setItem(
    "glasshouse-trial-bench:workspace:v1",
    JSON.stringify({ version: 1, savedAt: new Date().toISOString(), state }),
  );
}

export const STORAGE_KEYS = {
  workspace: "glasshouse-trial-bench:workspace:v1",
  quarantine: "glasshouse-trial-bench:quarantine:v1",
  repair: "glasshouse-trial-bench:repair-archive:v1",
} as const;
