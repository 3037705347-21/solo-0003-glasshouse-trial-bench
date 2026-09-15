import { useEffect, useRef, useState } from "react";
import {
  Check,
  Flag,
  FlagOff,
  History,
  RotateCcw,
  SearchCode,
  Waypoints,
} from "lucide-react";
import { Button } from "../../components/Button";
import { TextAreaField } from "../../components/fields";
import { SegmentedTabs } from "../../components/SegmentedTabs";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import type { Flag as DomainFlag } from "../../domain/types";
import {
  closeFlag,
  displayDateTime,
  flagActionLabel,
  flagStateLabel,
  isFlagClosed,
  isFlagOpen,
  isFlagSuperseded,
  reopenFlag,
} from "../../domain/flag";
import { useWorkspace } from "../../state/store";
import { EscalateFlagDialog } from "./EscalateFlagDialog";

interface FlagPanelProps {
  flags: DomainFlag[];
}

type FlagSegment = "open" | "closed";

function followUpTag(flag: DomainFlag): string | undefined {
  if (flag.followUpType === "recurrence") {
    return "复发跟进";
  }
  if (flag.followUpType === "escalation") {
    return "升级跟进 · 全试验";
  }
  return undefined;
}

export function FlagPanel({ flags }: FlagPanelProps) {
  const { state, dispatch } = useWorkspace();
  const [segment, setSegment] = useState<FlagSegment>("open");
  const [selectedId, setSelectedId] = useState(() => flags[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>();
  const [escalating, setEscalating] = useState(false);

  const openFlags = flags.filter(isFlagOpen);
  const closedFlags = flags.filter(
    (flag) => isFlagClosed(flag) || isFlagSuperseded(flag),
  );
  const visible = segment === "open" ? openFlags : closedFlags;
  const selected = flags.find((flag) => flag.id === selectedId);
  const effectiveSelected =
    selected && visible.some((flag) => flag.id === selected.id)
      ? selected
      : visible[0];

  // 新标记（复发建标、升级跟进）由上层加入时自动回到未处理视图；
  // 用户自己在两个标签页间切换、关闭标记、初次挂载都不会被打断。
  const knownIdsRef = useRef<Set<string>>(
    new Set(flags.map((flag) => flag.id)),
  );
  const mountedRef = useRef(false);
  useEffect(() => {
    const knownIds = knownIdsRef.current;
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    const arrived = flags.find((flag) => !knownIds.has(flag.id));
    flags.forEach((flag) => knownIds.add(flag.id));
    if (arrived && isFlagOpen(arrived) && segment === "closed") {
      setSegment("open");
      setSelectedId(arrived.id);
      setNote("");
      setError(undefined);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flags]);
  const applyResult = (
    result: ReturnType<typeof closeFlag>,
    nextSegment?: FlagSegment,
  ) => {
    if (!result.ok) {
      setError(result.errors[0]?.message);
      return;
    }
    dispatch({ type: "flag/transitioned", flag: result.value });
    setNote("");
    setError(undefined);
    if (nextSegment) {
      setSegment(nextSegment);
    }
  };

  if (flags.length === 0) {
    return (
      <div className="flag-panel-empty" data-testid="flag-panel-empty">
        <Flag size={22} aria-hidden="true" />
        <p>该试验没有标记。</p>
      </div>
    );
  }

  const followUpParent = effectiveSelected?.followUpOfId
    ? state.flags.find((item) => item.id === effectiveSelected.followUpOfId)
    : undefined;
  const supersededBy = effectiveSelected?.supersededById
    ? state.flags.find((item) => item.id === effectiveSelected.supersededById)
    : undefined;

  return (
    <aside className="flag-panel content-panel" data-testid="flag-panel">
      <div className="flag-panel-heading">
        <Flag size={18} aria-hidden="true" />
        <h3>标记生命周期</h3>
      </div>
      <SegmentedTabs
        label="按处理状态筛选标记"
        value={segment}
        options={[
          { value: "open", label: `未处理 ${openFlags.length}` },
          { value: "closed", label: `已处理 ${closedFlags.length}` },
        ]}
        onChange={(value) => {
          setSegment(value);
          setNote("");
          setError(undefined);
        }}
      />
      {visible.length === 0 ? (
        <p className="muted-copy">
          {segment === "open" ? "没有待处理的标记。" : "还没有已处理的标记。"}
        </p>
      ) : (
        <>
          <div className="flag-list">
            {visible.map((flag) => {
              const tag = followUpTag(flag);
              return (
                <button
                  className={`flag-list-item ${effectiveSelected?.id === flag.id ? "flag-list-item-active" : ""}`}
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
                  {tag ? (
                    <StatusBadge tone={flag.scope === "trial" ? "critical" : "info"}>
                      {tag}
                    </StatusBadge>
                  ) : null}
                  {flag.scope === "trial" && !tag ? (
                    <StatusBadge tone="critical">全试验</StatusBadge>
                  ) : null}
                </button>
              );
            })}
          </div>
          {effectiveSelected ? (
            <div className="flag-editor">
              <div className="flag-editor-heading">
                <strong>{effectiveSelected.code}</strong>
                <StatusBadge tone={statusTone(flagStateLabel(effectiveSelected))}>
                  {flagStateLabel(effectiveSelected)}
                </StatusBadge>
              </div>
              <p>{effectiveSelected.message}</p>
              {followUpParent ? (
                <p className="flag-relation" data-testid="flag-followup-parent">
                  <Waypoints size={14} aria-hidden="true" />
                  跟进自 {followUpParent.code}
                  （{flagStateLabel(followUpParent)}）
                  {effectiveSelected.followUpType === "recurrence"
                    ? "：处理后问题再次出现"
                    : "：处理范围扩大到全试验"}
                </p>
              ) : null}
              {supersededBy ? (
                <p className="flag-relation">
                  <SearchCode size={14} aria-hidden="true" />
                  已被
                  <Button
                    tone="ghost"
                    size="sm"
                    onClick={() => {
                      setSelectedId(supersededBy.id);
                      setSegment("open");
                    }}
                    data-testid={`jump-flag-${supersededBy.id}`}
                  >
                    {supersededBy.code}（全试验跟进）
                  </Button>
                  取代，原结论保留为历史。
                </p>
              ) : null}
              {isFlagOpen(effectiveSelected) ? (
                <>
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
                      onClick={() =>
                        applyResult(closeFlag(effectiveSelected, "waived", note), "closed")
                      }
                      data-testid="waive-flag"
                    >
                      <FlagOff size={15} />
                      豁免
                    </Button>
                    <Button
                      size="sm"
                      onClick={() =>
                        applyResult(closeFlag(effectiveSelected, "resolved", note), "closed")
                      }
                      data-testid="resolve-flag"
                    >
                      <Check size={15} />
                      解决
                    </Button>
                  </div>
                </>
              ) : null}
              {isFlagClosed(effectiveSelected) ? (
                <div className="flag-followup-zone" data-testid="flag-followup-zone">
                  <div className="flag-prior-conclusion">
                    <span>
                      原处理：{flagStateLabel(effectiveSelected)}
                      {effectiveSelected.resolvedOn
                        ? ` · ${displayDateTime(effectiveSelected.resolvedOn)}`
                        : ""}
                    </span>
                    <p>{effectiveSelected.resolutionNote}</p>
                  </div>
                  <TextAreaField
                    label="重开说明（原结论为何被推翻）"
                    rows={2}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                    error={error}
                    data-testid="flag-reopen-note"
                  />
                  <div className="flag-actions">
                    <Button
                      tone="secondary"
                      size="sm"
                      onClick={() => {
                        const result = reopenFlag(effectiveSelected, note);
                        applyResult(result, "open");
                      }}
                      data-testid="reopen-flag"
                    >
                      <RotateCcw size={15} />
                      重新打开
                    </Button>
                    <Button
                      tone="danger"
                      size="sm"
                      onClick={() => setEscalating(true)}
                      data-testid="escalate-flag"
                    >
                      <Waypoints size={15} />
                      扩大处理范围
                    </Button>
                  </div>
                </div>
              ) : null}
              {isFlagSuperseded(effectiveSelected) ? (
                <p className="muted-copy">
                  该标记已随升级关闭，不能重开或再次升级；请在全试验跟进标记上继续处理。
                </p>
              ) : null}
              <FlagHistory flag={effectiveSelected} />
            </div>
          ) : null}
        </>
      )}
      {escalating && isFlagClosed(effectiveSelected) ? (
        <EscalateFlagDialog
          flag={effectiveSelected}
          onCancel={() => setEscalating(false)}
          onEscalated={(followUp) => {
            setEscalating(false);
            setSelectedId(followUp.id);
            setSegment("open");
            setNote("");
            setError(undefined);
          }}
        />
      ) : null}
    </aside>
  );
}

function FlagHistory({ flag }: { flag: DomainFlag }) {
  const entries = [...flag.history].reverse();
  return (
    <div className="flag-history" data-testid="flag-history">
      <div className="flag-history-heading">
        <History size={14} aria-hidden="true" />
        <span>处理流水（只追加，不可改写）</span>
      </div>
      <ol>
        {entries.map((entry) => (
          <li key={entry.id}>
            <div>
              <StatusBadge tone={statusTone("neutral")}>
                {flagActionLabel(entry.action)}
              </StatusBadge>
              <time>{displayDateTime(entry.at)}</time>
            </div>
            <p>{entry.note}</p>
          </li>
        ))}
      </ol>
    </div>
  );
}
