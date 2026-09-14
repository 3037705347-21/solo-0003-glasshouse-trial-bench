import type {
  Flag,
  FlagSeverity,
  ObservationEntry,
  WorkspaceState,
} from "./types";
import { GROWTH_THRESHOLDS } from "./rules";

export type TrendMetricKey = "heightMm" | "leafCount" | "ecMs";

export interface TrendMetricMeta {
  key: TrendMetricKey;
  label: string;
  unit: string;
}

export const TREND_METRICS: TrendMetricMeta[] = [
  { key: "heightMm", label: "株高", unit: "mm" },
  { key: "leafCount", label: "叶片数", unit: "片" },
  { key: "ecMs", label: "电导率", unit: "mS/cm" },
];

export interface ThresholdBreach {
  code: "HT_UNDER" | "HT_OVER" | "LEAF_LOW" | "EC_HIGH";
  metric: TrendMetricKey;
  severity: FlagSeverity;
  message: string;
}

export interface TrendPoint {
  passId: string;
  accessionId: string;
  observedOn: string;
  observer: string;
  heightMm: number;
  leafCount: number;
  ecMs: number;
  breaches: ThresholdBreach[];
  flags: Flag[];
}

export interface TrendSeries {
  accessionId: string;
  points: TrendPoint[];
}

export interface GrowthTrend {
  trialId: string;
  dates: string[];
  series: TrendSeries[];
}

export interface TrendThresholdLine {
  value: number;
  severity: FlagSeverity;
  label: string;
}

export const TREND_THRESHOLD_LINES: Record<TrendMetricKey, TrendThresholdLine[]> = {
  heightMm: [
    {
      value: GROWTH_THRESHOLDS.heightUnderMm,
      severity: "warning",
      label: `下限 ${GROWTH_THRESHOLDS.heightUnderMm} mm`,
    },
    {
      value: GROWTH_THRESHOLDS.heightOverMm,
      severity: "critical",
      label: `上限 ${GROWTH_THRESHOLDS.heightOverMm} mm`,
    },
  ],
  leafCount: [
    {
      value: GROWTH_THRESHOLDS.leafLowCount,
      severity: "warning",
      label: `下限 ${GROWTH_THRESHOLDS.leafLowCount} 片`,
    },
  ],
  ecMs: [
    {
      value: GROWTH_THRESHOLDS.ecHighMs,
      severity: "critical",
      label: `上限 ${GROWTH_THRESHOLDS.ecHighMs} mS/cm`,
    },
  ],
};

export function breachesForEntry(entry: ObservationEntry): ThresholdBreach[] {
  const breaches: ThresholdBreach[] = [];
  if (entry.heightMm < GROWTH_THRESHOLDS.heightUnderMm) {
    breaches.push({
      code: "HT_UNDER",
      metric: "heightMm",
      severity: "warning",
      message: `株高低于 ${GROWTH_THRESHOLDS.heightUnderMm} 毫米阈值`,
    });
  }
  if (entry.heightMm >= GROWTH_THRESHOLDS.heightOverMm) {
    breaches.push({
      code: "HT_OVER",
      metric: "heightMm",
      severity: "critical",
      message: `株高达到 ${GROWTH_THRESHOLDS.heightOverMm} 毫米阈值`,
    });
  }
  if (entry.leafCount < GROWTH_THRESHOLDS.leafLowCount) {
    breaches.push({
      code: "LEAF_LOW",
      metric: "leafCount",
      severity: "warning",
      message: `真叶数少于 ${GROWTH_THRESHOLDS.leafLowCount} 片`,
    });
  }
  if (entry.ecMs >= GROWTH_THRESHOLDS.ecHighMs) {
    breaches.push({
      code: "EC_HIGH",
      metric: "ecMs",
      severity: "critical",
      message: `基质电导率达到 ${GROWTH_THRESHOLDS.ecHighMs} mS/cm 阈值`,
    });
  }
  return breaches;
}

export function buildGrowthTrend(
  state: WorkspaceState,
  trialId: string,
  accessionIds: string[],
): GrowthTrend {
  const wanted = new Set(accessionIds);
  const pointsByAccession = new Map<string, TrendPoint[]>(
    accessionIds.map((id) => [id, []]),
  );
  const dates = new Set<string>();
  const passes = state.observationPasses
    .filter((pass) => pass.trialId === trialId)
    .sort(
      (left, right) =>
        left.observedOn.localeCompare(right.observedOn) ||
        left.id.localeCompare(right.id),
    );
  passes.forEach((pass) => {
    pass.entries.forEach((entry) => {
      if (!wanted.has(entry.accessionId)) {
        return;
      }
      const flags = state.flags
        .filter(
          (flag) =>
            flag.observationPassId === pass.id &&
            flag.accessionId === entry.accessionId,
        )
        .sort(
          (left, right) =>
            left.code.localeCompare(right.code) || left.id.localeCompare(right.id),
        );
      pointsByAccession.get(entry.accessionId)?.push({
        passId: pass.id,
        accessionId: entry.accessionId,
        observedOn: pass.observedOn,
        observer: pass.observer,
        heightMm: entry.heightMm,
        leafCount: entry.leafCount,
        ecMs: entry.ecMs,
        breaches: breachesForEntry(entry),
        flags,
      });
      dates.add(pass.observedOn);
    });
  });
  return {
    trialId,
    dates: Array.from(dates).sort(),
    series: accessionIds.map((accessionId) => ({
      accessionId,
      points: pointsByAccession.get(accessionId) ?? [],
    })),
  };
}

export function trendPointKey(point: TrendPoint): string {
  return `${point.passId}::${point.accessionId}`;
}

export function openFlagSeverity(point: TrendPoint): FlagSeverity | null {
  const open = point.flags.filter((flag) => flag.state === "open");
  if (open.some((flag) => flag.severity === "critical")) {
    return "critical";
  }
  if (open.some((flag) => flag.severity === "warning")) {
    return "warning";
  }
  return open.length > 0 ? "info" : null;
}
