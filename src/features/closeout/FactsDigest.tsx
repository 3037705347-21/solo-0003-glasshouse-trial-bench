import { StatusBadge } from "../../components/StatusBadge";
import type { CloseoutFacts, TrialState } from "../../domain/types";

interface FactsDigestProps {
  facts: CloseoutFacts;
}

export function formatTimestamp(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function trialStateLabel(state: TrialState): string {
  if (state === "draft") {
    return "草稿";
  }
  if (state === "active") {
    return "进行中";
  }
  if (state === "paused") {
    return "已暂停";
  }
  return "已放行";
}

export function FactsDigest({ facts }: FactsDigestProps) {
  const openFlags = facts.flags.filter((flag) => flag.state === "open");
  const resolvedFlags = facts.flags.filter((flag) => flag.state === "resolved");
  const waivedFlags = facts.flags.filter((flag) => flag.state === "waived");
  const entryTotal = facts.observationPasses.reduce(
    (sum, pass) => sum + pass.entryCount,
    0,
  );
  const lastPass = facts.observationPasses[facts.observationPasses.length - 1];

  return (
    <div className="facts-digest" data-testid="facts-digest">
      <span className="facts-captured">
        阶段事实 · 采集于 {formatTimestamp(facts.capturedOn)} · 试验状态{" "}
        {trialStateLabel(facts.trialState)}
      </span>
      <div className="facts-group">
        <span className="facts-label">材料表现</span>
        {facts.accessions.length === 0 ? (
          <span className="facts-empty">该试验没有材料</span>
        ) : (
          <div className="facts-tags">
            {facts.accessions.map((accession) => (
              <StatusBadge tone="neutral" key={accession.accessionNo}>
                {`${accession.accessionNo} ${accession.cultivar} · ${
                  accession.benchCode ?? "未分配"
                }`}
              </StatusBadge>
            ))}
          </div>
        )}
      </div>
      <div className="facts-group">
        <span className="facts-label">观测覆盖</span>
        {facts.observationPasses.length === 0 ? (
          <span className="facts-empty">无观测记录</span>
        ) : (
          <span className="facts-line">
            {facts.observationPasses.length} 次观测 · {entryTotal} 条记录 ·
            最近 {lastPass.observedOn}（{lastPass.observer}）
          </span>
        )}
      </div>
      <div className="facts-group">
        <span className="facts-label">标记处理</span>
        {facts.flags.length === 0 ? (
          <span className="facts-line">未产生标记</span>
        ) : (
          <span className="facts-line">
            共 {facts.flags.length} 个 · 未处理 {openFlags.length} · 已解决{" "}
            {resolvedFlags.length} · 已豁免 {waivedFlags.length}
          </span>
        )}
        {openFlags.length > 0 ? (
          <span className="facts-line facts-warning">
            未处理：{openFlags.map((flag) => flag.code).join("、")}
          </span>
        ) : null}
      </div>
      <div className="facts-group">
        <span className="facts-label">台架使用</span>
        {facts.benches.length === 0 ? (
          <span className="facts-empty">未使用台架</span>
        ) : (
          <span className="facts-line">
            {facts.benches
              .map((bench) => `${bench.code} ${bench.usedSlots}/${bench.capacity}`)
              .join(" · ")}
          </span>
        )}
      </div>
      <div className="facts-group">
        <span className="facts-label">放行结论</span>
        {facts.clearance ? (
          <span className="facts-line">
            <StatusBadge
              tone={facts.clearance.status === "ready" ? "positive" : "critical"}
            >
              {facts.clearance.status === "ready" ? "就绪" : "阻止"}
            </StatusBadge>
            {formatTimestamp(facts.clearance.generatedOn)} ·{" "}
            {facts.clearance.blockerCount} 个阻止项
          </span>
        ) : (
          <span className="facts-empty">尚未生成放行快照</span>
        )}
      </div>
    </div>
  );
}
