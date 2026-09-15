import { useState } from "react";
import { Check, Flag, FlagOff } from "lucide-react";
import { Button } from "../../components/Button";
import { TextAreaField } from "../../components/fields";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import type { Flag as DomainFlag } from "../../domain/types";
import { transitionFlag } from "../../domain/observation";
import { useWorkspace } from "../../state/store";

interface FlagPanelProps {
  flags: DomainFlag[];
}

export function FlagPanel({ flags }: FlagPanelProps) {
  const { state, dispatch } = useWorkspace();
  const [selectedId, setSelectedId] = useState(() => flags[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>();
  const selected = flags.find((flag) => flag.id === selectedId) ?? flags[0];

  const applyTransition = (next: "resolved" | "waived") => {
    if (!selected) {
      return;
    }
    const result = transitionFlag(selected, next, note);
    if (!result.ok) {
      setError(result.errors[0]?.message);
      return;
    }
    dispatch({ type: "flag/transitioned", flag: result.value });
    setNote("");
    setError(undefined);
  };

  if (flags.length === 0) {
    return (
      <div className="flag-panel-empty">
        <Flag size={22} aria-hidden="true" />
        <p>该试验没有未处理的标记。</p>
      </div>
    );
  }

  return (
    <aside className="flag-panel" data-testid="flag-panel">
      <div className="flag-panel-heading">
        <Flag size={18} aria-hidden="true" />
        <h3>未处理标记</h3>
        <span>{flags.length}</span>
      </div>
      <div className="flag-list">
        {flags.map((flag) => {
          const source =
            flag.sourceAccessionId && flag.sourceAccessionId !== flag.accessionId
              ? state.accessions.find(
                  (item) => item.id === flag.sourceAccessionId,
                )
              : undefined;
          return (
            <button
              className={`flag-list-item ${selected?.id === flag.id ? "flag-list-item-active" : ""}`}
              key={flag.id}
              onClick={() => {
                setSelectedId(flag.id);
                setNote("");
                setError(undefined);
              }}
              data-testid={`flag-${flag.id}`}
            >
              <StatusBadge tone={statusTone(flag.severity)}>
                {flag.severity === "critical"
                  ? "严重"
                  : flag.severity === "warning"
                    ? "警告"
                    : "提示"}
              </StatusBadge>
              <span>{flag.code}</span>
              {source ? (
                <StatusBadge tone="info">{`原 ${source.accessionNo}`}</StatusBadge>
              ) : null}
            </button>
          );
        })}
      </div>
      {selected ? (
        <div className="flag-editor">
          <strong>{selected.code}</strong>
          <p>{selected.message}</p>
          <TextAreaField
            label="处理说明"
            rows={3}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            error={error}
            data-testid="flag-resolution-note"
          />
          <div className="flag-actions">
            <Button
              tone="secondary"
              size="sm"
              onClick={() => applyTransition("waived")}
              data-testid="waive-flag"
            >
              <FlagOff size={15} />
              豁免
            </Button>
            <Button
              size="sm"
              onClick={() => applyTransition("resolved")}
              data-testid="resolve-flag"
            >
              <Check size={15} />
              解决
            </Button>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
