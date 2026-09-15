import { useState } from "react";
import { Check, ListPlus } from "lucide-react";
import { Button } from "../../components/Button";
import { TextAreaField } from "../../components/fields";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import {
  appendIncidentAction,
  incidentKindLabel,
  incidentStatusLabel,
  liftIncident,
} from "../../domain/incident";
import { incidentById } from "../../state/selectors";
import { useWorkspace } from "../../state/store";

interface IncidentDetailProps {
  incidentId: string;
  notify: (toast: { tone: "success" | "error"; title: string; message: string }) => void;
}

function formatInstant(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

export function IncidentDetail({ incidentId, notify }: IncidentDetailProps) {
  const { state, dispatch } = useWorkspace();
  const [actionNote, setActionNote] = useState("");
  const [actionError, setActionError] = useState<string | undefined>();
  const [resolution, setResolution] = useState("");
  const [resolutionError, setResolutionError] = useState<string | undefined>();
  const incident = incidentById(state, incidentId);

  if (!incident) {
    return <p className="muted-copy">该事件不存在或已被移除。</p>;
  }

  const affected = incident.accessionIds.map(
    (accessionId) =>
      state.accessions.find((item) => item.id === accessionId) ?? undefined,
  );
  const pass = incident.observationPassId
    ? state.observationPasses.find((item) => item.id === incident.observationPassId)
    : undefined;
  const flag = incident.flagId
    ? state.flags.find((item) => item.id === incident.flagId)
    : undefined;

  const handleAppendAction = () => {
    const result = appendIncidentAction(incident, actionNote);
    if (!result.ok) {
      setActionError(result.errors[0]?.message);
      return;
    }
    dispatch({ type: "incident/updated", incident: result.value });
    setActionNote("");
    setActionError(undefined);
    notify({
      tone: "success",
      title: "处置已追加",
      message: "新的处置动作已加入事件轨迹。",
    });
  };

  const handleLift = () => {
    const result = liftIncident(incident, resolution);
    if (!result.ok) {
      setResolutionError(result.errors[0]?.message);
      return;
    }
    dispatch({ type: "incident/updated", incident: result.value });
    setResolution("");
    setResolutionError(undefined);
    notify({
      tone: "success",
      title: "事件已解除",
      message: "完整处理轨迹已保留，可在已解除视图中查看。",
    });
  };

  return (
    <div className="incident-detail" data-testid="incident-detail">
      <div className="incident-detail-heading">
        <StatusBadge tone={statusTone(incidentStatusLabel(incident))}>
          {incidentStatusLabel(incident)}
        </StatusBadge>
        <StatusBadge tone="neutral">
          {incidentKindLabel(incident.kind)}
        </StatusBadge>
        <span className="muted-copy">
          发现于 {incident.discoveredOn} · 记录于 {formatInstant(incident.createdOn)}
        </span>
      </div>
      <section className="incident-section">
        <h3>影响材料</h3>
        <div className="pass-card-tags">
          {incident.accessionIds.map((accessionId, index) => {
            const accession = affected[index];
            return (
              <StatusBadge tone="neutral" key={accessionId}>
                {accession
                  ? `${accession.accessionNo} - ${accession.cultivar}`
                  : accessionId}
              </StatusBadge>
            );
          })}
        </div>
      </section>
      <section className="incident-section">
        <h3>原因</h3>
        <p>{incident.cause}</p>
      </section>
      <section className="incident-section">
        <h3>影响范围</h3>
        <p>{incident.scope}</p>
      </section>
      <section className="incident-section">
        <h3>关联线索</h3>
        {pass || flag ? (
          <ul className="clue-list">
            {pass ? (
              <li>
                观测 {pass.observedOn}（{pass.observer}）
              </li>
            ) : null}
            {flag ? (
              <li>
                标记 {flag.code}：{flag.message}（
                {flag.state === "open"
                  ? "未处理"
                  : flag.state === "resolved"
                    ? "已解决"
                    : "已豁免"}
                ）
              </li>
            ) : null}
          </ul>
        ) : (
          <p className="muted-copy">未关联观测或标记。</p>
        )}
      </section>
      <section className="incident-section">
        <h3>处置轨迹</h3>
        <ol className="action-trail">
          {incident.actions.map((action, index) => (
            <li key={`${action.recordedOn}-${index}`}>
              <time>{formatInstant(action.recordedOn)}</time>
              <span>{action.note}</span>
            </li>
          ))}
        </ol>
      </section>
      {incident.status === "lifted" ? (
        <section className="incident-section incident-resolution" data-testid="incident-resolution">
          <h3>解除结论</h3>
          <p>{incident.resolution}</p>
          <span className="muted-copy">
            解除于 {incident.liftedOn ? formatInstant(incident.liftedOn) : "未知时间"}
          </span>
        </section>
      ) : (
        <>
          <section className="incident-section">
            <h3>追加处置</h3>
            <TextAreaField
              label="处置动作"
              rows={2}
              value={actionNote}
              onChange={(event) => setActionNote(event.target.value)}
              error={actionError}
              data-testid="incident-action-note"
            />
            <div>
              <Button
                tone="secondary"
                size="sm"
                onClick={handleAppendAction}
                data-testid="append-incident-action"
              >
                <ListPlus size={15} />
                追加处置
              </Button>
            </div>
          </section>
          <section className="incident-section">
            <h3>解除事件</h3>
            <p className="muted-copy">
              解除后事件轨迹完整保留；关联的历史观测与标记不会被改写，未处理标记仍需在观测页单独处理。
            </p>
            <TextAreaField
              label="解除结论"
              rows={2}
              value={resolution}
              onChange={(event) => setResolution(event.target.value)}
              error={resolutionError}
              data-testid="incident-resolution-input"
            />
            <div>
              <Button
                size="sm"
                onClick={handleLift}
                data-testid="lift-incident-button"
              >
                <Check size={15} />
                解除事件
              </Button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
