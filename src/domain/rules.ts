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

export function lightProfileLabel(light: PreferredLight): string {
  if (light === "full-sun") {
    return "全日照";
  }
  if (light === "partial-shade") {
    return "半阴";
  }
  return "遮阴";
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
