import { StatusBadge } from "../../components/StatusBadge";
import type { Bench } from "../../domain/types";
import type { BenchCapacityPlan } from "../../domain/reservation";

interface BenchCapacityCardProps {
  bench: Bench;
  plan: BenchCapacityPlan;
  onMaintain: (benchId: string) => void;
}

function bucketDays(plan: BenchCapacityPlan, bucketCount: number) {
  if (plan.days.length === 0) {
    return [] as Array<{ real: number; held: number; load: number }>;
  }
  const size = Math.max(1, Math.ceil(plan.days.length / bucketCount));
  const buckets: Array<{ real: number; held: number; load: number }> = [];
  for (let index = 0; index < plan.days.length; index += size) {
    const slice = plan.days.slice(index, index + size);
    buckets.push({
      real: Math.max(...slice.map((day) => day.real)),
      held: Math.max(...slice.map((day) => day.held)),
      load: Math.max(...slice.map((day) => day.load)),
    });
  }
  return buckets;
}

export function BenchCapacityCard({
  bench,
  plan,
  onMaintain,
}: BenchCapacityCardProps) {
  const buckets = bucketDays(plan, 28);
  const overbooked = plan.peakLoad > bench.capacity;

  return (
    <article
      className={`capacity-card ${overbooked ? "capacity-card-over" : ""}`}
      data-testid={`capacity-card-${bench.id}`}
    >
      <header className="capacity-card-header">
        <div>
          <span className="bench-code">{bench.code}</span>
          <strong>{bench.sector}</strong>
        </div>
        <StatusBadge
          tone={
            bench.status === "available"
              ? "positive"
              : bench.status === "assigned"
                ? "info"
                : "critical"
          }
        >
          {bench.status === "assigned"
            ? "已分配"
            : bench.status === "blocked"
              ? "受限"
              : bench.status === "quarantine"
                ? "隔离"
                : "可用"}
        </StatusBadge>
      </header>
      <div className="capacity-spark" aria-hidden="true">
        {buckets.map((bucket, index) => {
          const ratio = bench.capacity === 0 ? 0 : bucket.load / bench.capacity;
          const tier =
            bucket.load > bench.capacity
              ? "over"
              : ratio >= 1
                ? "full"
                : ratio >= 0.75
                  ? "high"
                  : ratio > 0
                    ? "mid"
                    : "empty";
          return (
            <span
              key={index}
              className={`capacity-cell capacity-cell-${tier}`}
              title={`真实 ${bucket.real} / 预留 ${bucket.held} / 容量 ${bench.capacity}`}
            />
          );
        })}
      </div>
      <dl className="capacity-figures">
        <div>
          <dt>容量</dt>
          <dd>{bench.capacity}</dd>
        </div>
        <div>
          <dt>峰值占用</dt>
          <dd>{plan.peakLoad}</dd>
        </div>
        <div>
          <dt>最少可分配</dt>
          <dd className={plan.minFree === 0 ? "capacity-figure-zero" : ""}>
            {plan.minFree}
          </dd>
        </div>
      </dl>
      <p className="capacity-peak-date">
        {overbooked
          ? `峰值超出容量 ${plan.peakLoad - bench.capacity} 个槽位（${plan.peakDate}）`
          : `峰值出现在 ${plan.peakDate}`}
      </p>
      <button
        type="button"
        className="capacity-maintain-link"
        onClick={() => onMaintain(bench.id)}
        data-testid={`maintain-bench-${bench.id}`}
      >
        维护台架 / 调整容量与状态
      </button>
    </article>
  );
}
