import { useState } from "react";
import { ArchiveRestore, Download, Trash2 } from "lucide-react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import type { QuarantineEntry } from "../../state/persistence";

interface QuarantinePanelProps {
  entries: QuarantineEntry[];
  onDiscard: (id: string) => void;
}

const reasonLabels: Record<QuarantineEntry["reason"], string> = {
  "parse-error": "JSON 解析失败",
  "schema-mismatch": "结构不符合工作区模式",
  "version-unknown": "版本号无法识别",
  "version-legacy": "无版本封装的旧版数据",
};

function exportEntry(entry: QuarantineEntry) {
  const blob = new Blob([entry.raw], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `quarantine-${entry.id}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function QuarantinePanel({ entries, onDiscard }: QuarantinePanelProps) {
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const confirmEntry = entries.find((entry) => entry.id === confirmId);

  if (entries.length === 0) {
    return null;
  }

  return (
    <section className="quarantine-panel" data-testid="quarantine-panel">
      <div className="panel-heading">
        <div>
          <span className="panel-title">损坏数据隔离区</span>
          <span className="panel-subtitle">
            {entries.length} 份无法加载的原始数据被完整保留，未被示例数据覆盖
          </span>
        </div>
        <ArchiveRestore size={20} className="panel-icon" aria-hidden="true" />
      </div>
      <ul className="quarantine-list">
        {entries.map((entry) => (
          <li key={entry.id} className="quarantine-item" data-testid={`quarantine-${entry.id}`}>
            <div className="quarantine-item-copy">
              <strong>{reasonLabels[entry.reason]}</strong>
              <p>{entry.detail}</p>
              <span>
                {new Date(entry.detectedAt).toLocaleString()} · 原始数据 {entry.raw.length} 字符
              </span>
            </div>
            <div className="quarantine-item-actions">
              <Button size="sm" tone="secondary" onClick={() => exportEntry(entry)}>
                <Download size={14} />
                导出原始数据
              </Button>
              <Button
                size="sm"
                tone="danger"
                onClick={() => setConfirmId(entry.id)}
                data-testid={`discard-quarantine-${entry.id}`}
              >
                <Trash2 size={14} />
                核对后清除
              </Button>
            </div>
          </li>
        ))}
      </ul>

      <Dialog
        open={confirmId !== null}
        title="确认清除隔离数据"
        onClose={() => setConfirmId(null)}
        footer={
          <>
            <Button tone="secondary" onClick={() => setConfirmId(null)}>
              取消
            </Button>
            <Button
              tone="danger"
              onClick={() => {
                if (confirmId) {
                  onDiscard(confirmId);
                }
                setConfirmId(null);
              }}
              data-testid="confirm-discard-quarantine"
            >
              我已导出并核对，确认清除
            </Button>
          </>
        }
      >
        <p className="muted-copy">
          清除后该份原始数据将无法在本机恢复。请先使用“导出原始数据”留存副本。
          {confirmEntry ? `该记录包含 ${confirmEntry.raw.length} 个字符的原始工作区数据。` : ""}
        </p>
      </Dialog>
    </section>
  );
}
