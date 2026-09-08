import type { ReactNode } from "react";

interface MetricCardProps {
  label: string;
  value: ReactNode;
  detail?: string;
  accent?: "neutral" | "positive" | "warning" | "critical";
}

export function MetricCard({
  label,
  value,
  detail,
  accent = "neutral",
}: MetricCardProps) {
  return (
    <section className={`metric-card metric-card-${accent}`}>
      <span className="metric-card-label">{label}</span>
      <strong className="metric-card-value">{value}</strong>
      {detail ? <span className="metric-card-detail">{detail}</span> : null}
    </section>
  );
}
