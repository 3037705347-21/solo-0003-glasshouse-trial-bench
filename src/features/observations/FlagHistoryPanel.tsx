import { useState } from "react";
import { History, RotateCcw } from "lucide-react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { TextAreaField } from "../../components/fields";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import type { Flag as DomainFlag } from "../../domain/types";
import { correctFlagState } from "../../domain/observation";
import { ruleSetLabel } from "../../state/selectors";
import { useWorkspace } from "../../state/store";

interface FlagHistoryPanelProps {
  flags: DomainFlag[];
}

function stateLabel(flag: DomainFlag): string {
  if (flag.state === "resolved") {
    return "已解决";
  }
  if (flag.state === "waived") {
    return "已豁免";
  }
  return "已被规则取代";
}

export function FlagHistoryPanel({ flags }: FlagHistoryPanelProps) {
  const { state, dispatch } = useWorkspace();
  const [correcting, setCorrecting] = useState<DomainFlag | undefined>();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>();

  const handleCorrect = () => {
    if (!correcting) {
      return;
    }
    const result = correctFlagState(correcting, note);
    if (!result.ok) {
      setError(result.errors[0]?.message);
      return;
    }
    dispatch({ type: "flag/transitioned", flag: result.value });
    setCorrecting(undefined);
    setNote("");
    setError(undefined);
  };

  return (
    <section className="content-panel flag-history" data-testid="flag-history">
      <div className="panel-heading">
        <div>
          <span className="panel-title">标记历史与更正</span>
          <span className="panel-subtitle">
            已解决、已豁免和被规则取代的标记完整保留，可带说明重开
          </span>
        </div>
        <History size={20} className="panel-icon" aria-hidden="true" />
      </div>
      {flags.length === 0 ? (
        <p className="history-empty">该试验还没有已处理的标记。</p>
      ) : (
        <div className="history-list">
          {flags.map((flag) => (
            <div className="history-list-row" key={flag.id} data-testid={`flag-history-${flag.id}`}>
              <div>
                <strong>{flag.code}</strong>
                <StatusBadge
                  tone={flag.state === "superseded" ? "neutral" : statusTone(stateLabel(flag))}
                >
                  {stateLabel(flag)}
                </StatusBadge>
              </div>
              <span>
                {flag.message}
                <small className="flag-history-meta">
                  判定依据：{ruleSetLabel(state, flag.ruleSetId)}
                  {flag.state === "superseded" && flag.supersededReason
                    ? ` · 取代原因：${flag.supersededReason}`
                    : ""}
                  {flag.resolutionNote ? ` · 处理说明：${flag.resolutionNote}` : ""}
                </small>
              </span>
              {flag.state === "resolved" || flag.state === "waived" ? (
                <Button
                  tone="ghost"
                  size="sm"
                  onClick={() => {
                    setCorrecting(flag);
                    setNote("");
                    setError(undefined);
                  }}
                  data-testid={`correct-flag-${flag.id}`}
                >
                  <RotateCcw size={14} />
                  更正
                </Button>
              ) : null}
            </div>
          ))}
        </div>
      )}
      <Dialog
        open={Boolean(correcting)}
        title="更正标记结论"
        onClose={() => setCorrecting(undefined)}
      >
        {correcting ? (
          <div className="editor-form">
            <p className="muted-copy">
              将把 {correcting.code}（{stateLabel(correcting)}）重开为未处理，
              原结论保留在修订历史中。
            </p>
            <TextAreaField
              label="更正说明"
              rows={3}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              error={error}
              data-testid="correct-flag-note"
            />
            <div className="editor-actions">
              <Button tone="secondary" onClick={() => setCorrecting(undefined)}>
                取消
              </Button>
              <Button onClick={handleCorrect} data-testid="confirm-correct-flag">
                确认更正
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}
