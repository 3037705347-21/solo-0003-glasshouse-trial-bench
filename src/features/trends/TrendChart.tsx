import type { TrendMetricKey, TrendPoint } from "../../domain/trend";
import {
  TREND_THRESHOLD_LINES,
  openFlagSeverity,
  trendPointKey,
} from "../../domain/trend";

export interface TrendChartSeries {
  accessionId: string;
  label: string;
  color: string;
  points: TrendPoint[];
}

interface TrendChartProps {
  title: string;
  unit: string;
  metric: TrendMetricKey;
  dates: string[];
  series: TrendChartSeries[];
  selectedKey: string | null;
  onSelect: (point: TrendPoint) => void;
}

const WIDTH = 760;
const HEIGHT = 240;
const PAD = { left: 48, right: 20, top: 18, bottom: 36 };
const INNER_WIDTH = WIDTH - PAD.left - PAD.right;
const INNER_HEIGHT = HEIGHT - PAD.top - PAD.bottom;

export const SEVERITY_COLORS: Record<"info" | "warning" | "critical", string> = {
  info: "#3f5f78",
  warning: "#9a6a16",
  critical: "#b53a32",
};

const HANDLED_FLAG_COLOR = "#65705f";
const GRID_COLOR = "#e7ebe4";
const AXIS_TEXT_COLOR = "#65705f";

function timestampOf(date: string): number {
  return Date.parse(`${date}T00:00:00`);
}

export function TrendChart({
  title,
  unit,
  metric,
  dates,
  series,
  selectedKey,
  onSelect,
}: TrendChartProps) {
  const thresholds = TREND_THRESHOLD_LINES[metric];
  const allPoints = series.flatMap((item) => item.points);
  const values = allPoints.map((point) => point[metric]);
  const domainValues = [...values, ...thresholds.map((line) => line.value)];
  let minValue = Math.min(...domainValues);
  let maxValue = Math.max(...domainValues);
  if (minValue === maxValue) {
    minValue -= 1;
    maxValue += 1;
  }
  const padding = (maxValue - minValue) * 0.12;
  minValue = Math.max(0, minValue - padding);
  maxValue += padding;

  const timestamps = dates.map(timestampOf);
  const minTime = Math.min(...timestamps);
  const maxTime = Math.max(...timestamps);

  const xFor = (date: string): number => {
    if (maxTime === minTime) {
      return PAD.left + INNER_WIDTH / 2;
    }
    return (
      PAD.left +
      ((timestampOf(date) - minTime) / (maxTime - minTime)) * INNER_WIDTH
    );
  };

  const yFor = (value: number): number => {
    return (
      PAD.top + (1 - (value - minValue) / (maxValue - minValue)) * INNER_HEIGHT
    );
  };

  const yTicks = [0, 1, 2, 3].map(
    (index) => minValue + (index / 3) * (maxValue - minValue),
  );
  const formatValue = (value: number): string =>
    metric === "ecMs" ? value.toFixed(1) : String(Math.round(value));

  const xTickIndexes =
    dates.length <= 7
      ? dates.map((_, index) => index)
      : Array.from(new Set([0, 1, 2, 3, 4, 5, 6].map((slot) =>
          Math.round((slot / 6) * (dates.length - 1)),
        )));

  return (
    <section className="trend-chart-card" data-testid={`trend-chart-${metric}`}>
      <div className="trend-chart-heading">
        <h3>{title}</h3>
        <span>{unit}</span>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${title}趋势图`}>
        {yTicks.map((tick) => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={yFor(tick)}
              y2={yFor(tick)}
              stroke={GRID_COLOR}
              strokeWidth={1}
            />
            <text
              x={PAD.left - 8}
              y={yFor(tick) + 4}
              textAnchor="end"
              fontSize={11}
              fill={AXIS_TEXT_COLOR}
            >
              {formatValue(tick)}
            </text>
          </g>
        ))}
        {thresholds.map((line) => (
          <g key={line.label}>
            <line
              x1={PAD.left}
              x2={WIDTH - PAD.right}
              y1={yFor(line.value)}
              y2={yFor(line.value)}
              stroke={SEVERITY_COLORS[line.severity]}
              strokeWidth={1.5}
              strokeDasharray="6 4"
            />
            <text
              x={WIDTH - PAD.right}
              y={yFor(line.value) - 5}
              textAnchor="end"
              fontSize={11}
              fill={SEVERITY_COLORS[line.severity]}
            >
              {line.label}
            </text>
          </g>
        ))}
        {series.map((item) =>
          item.points.length >= 2 ? (
            <polyline
              key={item.accessionId}
              points={item.points
                .map((point) => `${xFor(point.observedOn)},${yFor(point[metric])}`)
                .join(" ")}
              fill="none"
              stroke={item.color}
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ) : null,
        )}
        {xTickIndexes.map((index) => (
          <text
            key={dates[index]}
            x={xFor(dates[index])}
            y={HEIGHT - PAD.bottom + 20}
            textAnchor="middle"
            fontSize={11}
            fill={AXIS_TEXT_COLOR}
          >
            {dates[index].slice(5)}
          </text>
        ))}
        {series.map((item) =>
          item.points.map((point) => {
            const cx = xFor(point.observedOn);
            const cy = yFor(point[metric]);
            const breach = point.breaches.find((item2) => item2.metric === metric);
            const openSeverity = openFlagSeverity(point);
            const flagged = point.flags.length > 0;
            const key = trendPointKey(point);
            const selected = key === selectedKey;
            return (
              <g key={`${item.accessionId}-${point.passId}`}>
                {flagged ? (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={9}
                    fill="none"
                    stroke={openSeverity ? SEVERITY_COLORS[openSeverity] : HANDLED_FLAG_COLOR}
                    strokeWidth={2}
                    strokeDasharray={openSeverity ? undefined : "3 3"}
                  />
                ) : null}
                {breach ? (
                  <path
                    d={`M ${cx} ${cy - 6.5} L ${cx + 6.5} ${cy} L ${cx} ${cy + 6.5} L ${cx - 6.5} ${cy} Z`}
                    fill={SEVERITY_COLORS[breach.severity]}
                    stroke="#ffffff"
                    strokeWidth={1.5}
                  />
                ) : (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={4.5}
                    fill={item.color}
                    stroke="#ffffff"
                    strokeWidth={1.5}
                  />
                )}
                {selected ? (
                  <circle
                    cx={cx}
                    cy={cy}
                    r={13}
                    fill="none"
                    stroke="#202620"
                    strokeWidth={1.5}
                  />
                ) : null}
                <circle
                  cx={cx}
                  cy={cy}
                  r={14}
                  fill="transparent"
                  style={{ cursor: "pointer", pointerEvents: "all" }}
                  data-testid={`trend-point-${metric}-${point.passId}-${point.accessionId}`}
                  onClick={() => onSelect(point)}
                >
                  <title>{`${point.observedOn} · ${item.label}`}</title>
                </circle>
              </g>
            );
          }),
        )}
      </svg>
    </section>
  );
}
