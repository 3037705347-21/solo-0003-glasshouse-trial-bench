interface ProgressBarProps {
  value: number;
  max: number;
  tone?: "positive" | "warning" | "critical";
}

export function ProgressBar({
  value,
  max,
  tone = "positive",
}: ProgressBarProps) {
  const percent = max === 0 ? 0 : Math.round((value / max) * 100);
  return (
    <div className="progress-track" role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={max}>
      <div
        className={`progress-fill progress-fill-${tone}`}
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}
