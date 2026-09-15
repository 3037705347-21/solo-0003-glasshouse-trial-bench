import { GitBranch } from "lucide-react";
import { Dialog } from "../../components/Dialog";
import { StatusBadge } from "../../components/StatusBadge";
import {
  isPassSuperseded,
  passVersionNumber,
} from "../../domain/observation";
import type { Flag, ObservationPass } from "../../domain/types";
import {
  flagsForPass,
  passSeriesVersions,
  passVersionLabel,
} from "../../state/selectors";
import { useWorkspace } from "../../state/store";

interface RevisionChainDialogProps {
  seriesId: string;
  onClose: () => void;
}

function displayDateTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function flagStateLabel(flag: Flag): string {
  switch (flag.state) {
    case "open":
      return "未处理";
    case "resolved":
      return "已解决";
    case "waived":
      return "已豁免";
    case "superseded":
      return "已失效";
  }
}

function flagStateTone(flag: Flag): "neutral" | "positive" | "warning" | "critical" | "info" {
  switch (flag.state) {
    case "open":
      return "critical";
    case "resolved":
      return "positive";
    case "waived":
      return "info";
    case "superseded":
      return "neutral";
  }
}

export function RevisionChainDialog({
  seriesId,
  onClose,
}: RevisionChainDialogProps) {
  const { state } = useWorkspace();
  const versions = passSeriesVersions(state, seriesId);
  const series = versions;

  const versionLabelOf = (pass: ObservationPass) =>
    passVersionLabel(state, pass);

  const successorOf = (flag: Flag): Flag | undefined =>
    flag.supersededByFlagId
      ? state.flags.find((item) => item.id === flag.supersededByFlagId)
      : undefined;

  const predecessorOf = (flag: Flag): Flag | undefined =>
    flag.supersedesFlagId
      ? state.flags.find((item) => item.id === flag.supersedesFlagId)
      : undefined;

  const passOfFlag = (flag: Flag | undefined): ObservationPass | undefined =>
    flag
      ? state.observationPasses.find((pass) => pass.id === flag.observationPassId)
      : undefined;

  return (
    <Dialog open title="观测修订历史" onClose={onClose} wide>
      <div className="revision-chain" data-testid="revision-chain">
        {versions.map((pass) => {
          const version = passVersionNumber(series, pass);
          const superseded = isPassSuperseded(pass);
          const flags = flagsForPass(state, pass.id);
          return (
            <article
              className="lifecycle-entry revision-entry"
              key={pass.id}
              data-testid={`revision-version-${version}`}
            >
              <div className="revision-entry-heading">
                <StatusBadge tone={superseded ? "neutral" : "positive"}>
                  {superseded ? `v${version} · 已被取代` : `v${version} · 当前版本`}
                </StatusBadge>
                <span className="revision-entry-meta">
                  {pass.observedOn} · {pass.observer}
                </span>
              </div>
              {pass.revision ? (
                <dl className="revision-meta-grid">
                  <div>
                    <dt>更正人</dt>
                    <dd>{pass.revision.revisedBy}</dd>
                  </div>
                  <div>
                    <dt>更正时间</dt>
                    <dd>{displayDateTime(pass.revision.revisedOn)}</dd>
                  </div>
                  <div>
                    <dt>基于版本</dt>
                    <dd>
                      {versionLabelOf(
                        state.observationPasses.find(
                          (item) => item.id === pass.revision?.basePassId,
                        ) ?? pass,
                      )}
                    </dd>
                  </div>
                </dl>
              ) : null}
              {pass.revision ? (
                <p className="revision-reason">{pass.revision.reason}</p>
              ) : null}
              <div className="revision-entries">
                {pass.entries.map((entry) => {
                  const accession = state.accessions.find(
                    (item) => item.id === entry.accessionId,
                  );
                  return (
                    <span className="revision-entry-chip" key={entry.accessionId}>
                      {accession?.accessionNo ?? entry.accessionId} · 株高{" "}
                      {entry.heightMm}mm · 叶片 {entry.leafCount} · EC {entry.ecMs}
                    </span>
                  );
                })}
              </div>
              {flags.length > 0 ? (
                <div className="revision-flags">
                  {flags.map((flag) => {
                    const successor = successorOf(flag);
                    const successorPass = passOfFlag(successor);
                    const predecessor = predecessorOf(flag);
                    const predecessorPass = passOfFlag(predecessor);
                    return (
                      <div className="revision-flag-row" key={flag.id}>
                        <StatusBadge tone={flagStateTone(flag)}>
                          {flagStateLabel(flag)}
                        </StatusBadge>
                        <span>
                          {flag.code} · {flag.message}
                        </span>
                        {successor && successorPass ? (
                          <small>
                            由 {versionLabelOf(successorPass)} 的标记接替
                          </small>
                        ) : null}
                        {predecessor && predecessorPass ? (
                          <small>
                            接替 {versionLabelOf(predecessorPass)} 的同名标记
                          </small>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="revision-no-flags">该版本未派生标记。</p>
              )}
            </article>
          );
        })}
        {versions.length === 0 ? (
          <p className="history-empty">
            <GitBranch size={16} aria-hidden="true" /> 未找到该观测的修订记录。
          </p>
        ) : null}
      </div>
    </Dialog>
  );
}
