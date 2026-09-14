import type { Accession, Bench, PreferredLight } from "./types";

export const TRAY_CELL_OPTIONS = [32, 50, 72, 104, 128, 200, 288];

export const LIGHT_PROFILES: PreferredLight[] = [
  "full-sun",
  "partial-shade",
  "shade",
];

export const BENCH_LIGHT_COMPATIBILITY: Record<PreferredLight, PreferredLight[]> = {
  "full-sun": ["full-sun"],
  "partial-shade": ["partial-shade", "full-sun"],
  shade: ["shade", "partial-shade"],
};

export const GROWTH_BOUNDS = {
  heightMm: { min: 1, max: 800 },
  leafCount: { min: 0, max: 100 },
  ecMs: { min: 0.1, max: 12 },
};

export const TRIAL_SEASONS = [
  "冬季",
  "春季",
  "夏季",
  "秋季",
];

export function isBenchCompatible(accession: Accession, bench: Bench): boolean {
  return BENCH_LIGHT_COMPATIBILITY[accession.preferredLight].includes(
    bench.lightProfile,
  );
}

export function normalizeLabels(labels: string[]): string[] {
  return Array.from(
    new Set(
      labels
        .map((label) => label.trim().toLowerCase())
        .filter((label) => label.length > 0),
    ),
  ).sort();
}

export function parseDateOnly(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function todayDateOnly(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function isDateOnOrBefore(date: string, boundary: string): boolean {
  const left = parseDateOnly(date);
  const right = parseDateOnly(boundary);
  return Boolean(left && right && left.getTime() <= right.getTime());
}

export interface DateWindow {
  startDate: string;
  endDate: string;
}

/** 两个闭区间日期窗口是否有重叠（同一天也算重叠）。 */
export function windowsOverlap(left: DateWindow, right: DateWindow): boolean {
  return !(left.endDate < right.startDate || right.endDate < left.startDate);
}

/** 枚举闭区间内的每一天（YYYY-MM-DD），日期非法时返回空数组。 */
export function eachDateInclusive(window: DateWindow): string[] {
  const start = parseDateOnly(window.startDate);
  const end = parseDateOnly(window.endDate);
  if (!start || !end || start.getTime() > end.getTime()) {
    return [];
  }
  const days: string[] = [];
  const cursor = new Date(start.getTime());
  while (cursor.getTime() <= end.getTime()) {
    const year = cursor.getFullYear();
    const month = String(cursor.getMonth() + 1).padStart(2, "0");
    const day = String(cursor.getDate()).padStart(2, "0");
    days.push(`${year}-${month}-${day}`);
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}
