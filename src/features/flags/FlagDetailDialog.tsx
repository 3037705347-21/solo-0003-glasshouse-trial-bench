import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  CalendarDays,
  CircleAlert,
  FlaskConical,
  History,
  NotebookPen,
  Sprout,
} from "lucide-react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { TextAreaField } from "../../components/fields";
import { StatusBadge, statusTone } from "../../components/StatusBadge";
import type { Flag } from "../../domain/types";
import { transitionFlag } from "../../domain/observation";
import {
  FLAG_SEVERITY_LABELS,
  FLAG_STATE_LABELS,
  flagCodeLabel,
  formatObservedOn,
  formatTimestamp,
  type FlagTrace,
} from "../../domain/flagTrace";
import { useWorkspace } from "../../state/store";

interface FlagDetailDialogProps {
  trace: FlagTrace | undefined;
  onClose: () => void;
  onTransited: (message: string) => void;
}

export function FlagDetailDialog({
  trace,
  onClose,
  onTransited,
}: FlagDetailDialogProps) {
  const { dispatch } = useWorkspace();
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | undefined>();

  // 切换到另一条标记时清空处理说明。
  useEffect(() => {
    setNote("");
    setError(undefined);
  }, [trace?.flag.id]);

  if (!trace) {
    return null;
  }

  const { flag, trial, accession, accessionTrial, pass, entry, crossTrial } =
    trace;
  const isOpen = flag.state === "open";

  const applyTransition = (next: "resolved" | "waived") => {
    const result = transitionFlag(flag, next, note);
    if (!result.ok) {
      setError(result.errors[0]?.message);
      return;
    }
    dispatch({ type: "flag/transitioned", flag: result.value });
    setNote("");
    setError(undefined);
    onTransited(
      next === "resolved"
        ? `标记 ${flag.code} 已解决，放行结果已同步重算。`
        : `标记 ${flag.code} 已豁免，放行结果已同步重算。`,
    );
  };

  return (
    <Dialog open onClose={onClose} wide title="标记追溯与处理">
      <div className="flag-detail" data-testid="flag-detail">
        <header className="flag-detail-header">
          <div className="flag-detail-title">
            <StatusBadge tone={statusTone(flag.severity)}>
              {FLAG_SEVERITY_LABELS[flag.severity]}
            </StatusBadge>
            <StatusBadge tone={statusTone(flag.state)}>
              {FLAG_STATE_LABELS[flag.state]}
            </StatusBadge>
            <strong>{flag.code}</strong>
            <span className="flag-detail-code-label">
              {flagCodeLabel(flag.code)}
            </span>
          </div>
          <p className="flag-detail-message">{flag.message}</p>
        </header>

        <dl className="flag-trace-grid">
          <TraceItem icon={FlaskConical} label="产生观测的试验">
            {trial ? (
              <Link
                to={`/observations?trial=${encodeURIComponent(trial.id)}`}
                className="trace-link"
              >
                {trial.code} · {trial.cropFamily}
              </Link>
            ) : (
              <MissingText />
            )}
          </TraceItem>
          <TraceItem icon={NotebookPen} label="来源观测">
            {pass ? (
              <Link
                to={`/observations?trial=${encodeURIComponent(flag.trialId)}&pass=${encodeURIComponent(pass.id)}`}
                className="trace-link"
              >
                {formatObservedOn(pass.observedOn)} · {pass.observer}
              </Link>
            ) : (
              <MissingText />
            )}
          </TraceItem>
          <TraceItem icon={Sprout} label="受影响材料">
            {accession ? (
              <Link
                to={`/observations?trial=${encodeURIComponent(flag.trialId)}&accession=${encodeURIComponent(accession.id)}`}
                className="trace-link"
              >
                {accession.accessionNo} · {accession.cultivar}
              </Link>
            ) : (
              <MissingText />
            )}
          </TraceItem>
          <TraceItem icon={CalendarDays} label="材料登记试验">
            {accessionTrial ? (
              <span>
                {accessionTrial.code}
                {crossTrial ? (
                  <StatusBadge tone="info">跨试验引用</StatusBadge>
                ) : null}
              </span>
            ) : (
              <MissingText />
            )}
          </TraceItem>
        </dl>

        {entry ? (
          <section className="flag-measurements">
            <h4>当次测量</h4>
            <div className="flag-measurement-grid">
              <Measurement label="株高" value={`${entry.heightMm} mm`} />
              <Measurement label="真叶数" value={`${entry.leafCount} 片`} />
              <Measurement label="电导率" value={`${entry.ecMs} mS/cm`} />
            </div>
            {entry.notes ? (
              <p className="flag-entry-notes">观测备注：{entry.notes}</p>
            ) : null}
          </section>
        ) : null}

        <section className="flag-clearance-row">
          <div>
            <span className="field-label">是否阻挡放行</span>
            {trace.blockingClearance ? (
              <StatusBadge tone="critical">仍在阻挡</StatusBadge>
            ) : (
              <StatusBadge tone="positive">不再阻挡</StatusBadge>
            )}
          </div>
          <Link
            to={`/clearance?trial=${encodeURIComponent(flag.trialId)}`}
            className="trace-link"
          >
            前往放行检查
          </Link>
        </section>

        {trace.related.length > 0 ? (
          <section className="flag-related">
            <h4>
              <History size={14} aria-hidden="true" />
              同一材料的其他标记（{trace.related.length}）
            </h4>
            <ul className="flag-related-list">
              {trace.related.map((item) => (
                <RelatedFlag key={item.id} flag={item} />
              ))}
            </ul>
          </section>
        ) : null}

        <footer className="flag-resolution">
          <h4>处理记录</h4>
          <div className="flag-resolution-meta">
            <span>创建于 {formatTimestamp(flag.createdOn)}</span>
            {isOpen ? (
              <StatusBadge tone="critical">等待处理</StatusBadge>
            ) : (
              <span className="flag-resolution-time">
                {FLAG_STATE_LABELS[flag.state]}于{" "}
                {formatTimestamp(flag.resolvedOn)}
              </span>
            )}
          </div>
          {isOpen ? (
            <>
              <TextAreaField
                label="处理说明（至少 8 个字符，保存后不可修改）"
                rows={3}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                  setError(undefined);
                }}
                error={error}
                data-testid="workbench-resolution-note"
              />
              <div className="flag-actions">
                <Button
                  tone="secondary"
                  size="sm"
                  onClick={() => applyTransition("waived")}
                  data-testid="workbench-waive"
                >
                  <CircleAlert size={15} />
                  豁免标记
                </Button>
                <Button
                  size="sm"
                  onClick={() => applyTransition("resolved")}
                  data-testid="workbench-resolve"
                >
                  解决标记
                </Button>
              </div>
            </>
          ) : (
            <p className="flag-resolution-note-saved" data-testid="saved-resolution-note">
              {flag.resolutionNote}
            </p>
          )}
        </footer>
      </div>
    </Dialog>
  );
}

function TraceItem({
  icon: Icon,
  label,
  children,
}: {
  icon: typeof Sprout;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="flag-trace-item">
      <dt>
        <Icon size={14} aria-hidden="true" />
        {label}
      </dt>
      <dd>{children}</dd>
    </div>
  );
}

function Measurement({ label, value }: { label: string; value: string }) {
  return (
    <div className="flag-measurement">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function RelatedFlag({ flag }: { flag: Flag }) {
  return (
    <li>
      <StatusBadge tone={statusTone(flag.severity)}>
        {FLAG_SEVERITY_LABELS[flag.severity]}
      </StatusBadge>
      <code>{flag.code}</code>
      <span className="flag-related-msg">{flag.message}</span>
      <StatusBadge tone={statusTone(flag.state)}>
        {FLAG_STATE_LABELS[flag.state]}
      </StatusBadge>
      <span className="flag-related-time">
        {formatTimestamp(flag.createdOn)}
      </span>
    </li>
  );
}

function MissingText() {
  return <span className="flag-missing">记录缺失</span>;
}
