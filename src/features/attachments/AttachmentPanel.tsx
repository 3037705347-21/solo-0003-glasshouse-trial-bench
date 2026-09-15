import { useRef, useState } from "react";
import {
  Download,
  FileText,
  FileWarning,
  Paperclip,
  Trash2,
  Upload,
} from "lucide-react";
import { Button } from "../../components/Button";
import { Dialog } from "../../components/Dialog";
import { StatusBadge } from "../../components/StatusBadge";
import {
  ATTACHMENT_ACCEPT_ATTRIBUTE,
  attachmentHasPayload,
  attachmentsForSubject,
  createAttachment,
  isImageAttachment,
  validateAttachmentFile,
} from "../../domain/attachment";
import { firstMessage } from "../../domain/result";
import type {
  Attachment,
  AttachmentSubjectKind,
} from "../../domain/types";
import { useWorkspace } from "../../state/store";

interface AttachmentPanelProps {
  subjectKind: AttachmentSubjectKind;
  subjectId: string;
  /** 用于标题和溯源展示的记录标签，例如 “ACC-0001 · Tiny Tim”。 */
  subjectLabel: string;
  compact?: boolean;
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (sizeBytes >= 1024) {
    return `${Math.round(sizeBytes / 1024)} KB`;
  }
  return `${sizeBytes} B`;
}

function formatUploadedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsDataURL(file);
  });
}

/** 图片在上传前实际解码一次，损坏文件不会进入工作区。 */
function verifyImageDecodes(dataUrl: string): Promise<boolean> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
    image.src = dataUrl;
  });
}

export function AttachmentPanel({
  subjectKind,
  subjectId,
  subjectLabel,
  compact = false,
}: AttachmentPanelProps) {
  const { state, dispatch } = useWorkspace();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | undefined>();
  const [status, setStatus] = useState<string | undefined>();
  const [viewing, setViewing] = useState<Attachment | undefined>();
  const [deleting, setDeleting] = useState<Attachment | undefined>();
  const [viewerBroken, setViewerBroken] = useState(false);

  const attachments = attachmentsForSubject(state, subjectKind, subjectId);

  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) {
      return;
    }
    setError(undefined);
    setStatus(undefined);
    const preflight = validateAttachmentFile(
      {
        fileName: file.name,
        mediaType: file.type,
        sizeBytes: file.size,
      },
      state,
    );
    if (!preflight.ok) {
      setError(firstMessage(preflight));
      return;
    }
    let dataUrl: string;
    try {
      dataUrl = await readFileAsDataUrl(file);
    } catch {
      setError("读取文件失败，请重试");
      return;
    }
    if (file.type.startsWith("image/")) {
      const decodes = await verifyImageDecodes(dataUrl);
      if (!decodes) {
        setError("文件内容损坏或格式不符，未保存");
        return;
      }
    }
    const result = createAttachment(
      {
        subjectKind,
        subjectId,
        fileName: file.name,
        mediaType: file.type,
        sizeBytes: file.size,
        dataUrl,
      },
      state,
    );
    if (!result.ok) {
      setError(firstMessage(result));
      return;
    }
    dispatch({ type: "attachment/added", attachment: result.value });
    setStatus(`已上传 ${result.value.fileName}`);
  };

  const confirmDelete = () => {
    if (!deleting) {
      return;
    }
    dispatch({ type: "attachment/removed", attachmentId: deleting.id });
    setStatus(`已删除 ${deleting.fileName}`);
    setDeleting(undefined);
  };

  return (
    <section
      className={`attachment-panel ${compact ? "attachment-panel-compact" : ""}`}
      data-testid="attachment-panel"
    >
      <div className="attachment-panel-head">
        <span className="attachment-panel-title">
          <Paperclip size={15} aria-hidden="true" />
          附件（{attachments.length}）
        </span>
        <Button
          tone="secondary"
          size="sm"
          onClick={() => inputRef.current?.click()}
          data-testid="attachment-upload-button"
        >
          <Upload size={14} />
          上传附件
        </Button>
        <input
          ref={inputRef}
          type="file"
          accept={ATTACHMENT_ACCEPT_ATTRIBUTE}
          className="attachment-file-input"
          data-testid="attachment-upload-input"
          aria-label={`上传附件到 ${subjectLabel}`}
          onChange={(event) => {
            void handleFiles(event.target.files);
            event.target.value = "";
          }}
        />
      </div>
      {error ? (
        <p className="attachment-error" role="alert" data-testid="attachment-error">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="attachment-status" data-testid="attachment-status">
          {status}
        </p>
      ) : null}
      {attachments.length === 0 ? (
        <p className="attachment-empty">
          还没有附件。可上传现场照片、检测单据或异常记录。
        </p>
      ) : (
        <ul className="attachment-list">
          {attachments.map((attachment) => {
            const hasPayload = attachmentHasPayload(attachment);
            const isImage = isImageAttachment(attachment);
            return (
              <li
                className="attachment-row"
                key={attachment.id}
                data-testid={`attachment-row-${attachment.id}`}
              >
                <span className="attachment-thumb" aria-hidden="true">
                  {hasPayload && isImage ? (
                    <img src={attachment.dataUrl} alt="" />
                  ) : hasPayload ? (
                    <FileText size={18} />
                  ) : (
                    <FileWarning size={18} />
                  )}
                </span>
                <span className="attachment-meta">
                  <strong>{attachment.fileName}</strong>
                  <small>
                    {formatBytes(attachment.sizeBytes)} ·{" "}
                    {formatUploadedAt(attachment.uploadedAt)}
                  </small>
                  <span className="attachment-badges">
                    {attachment.origin ? (
                      <span data-testid="attachment-origin">
                        <StatusBadge tone="info">
                          {`源自 ${attachment.origin.subjectLabel} · ${
                            attachment.origin.transferredBy === "merge"
                              ? "合并"
                              : "复制"
                          }`}
                        </StatusBadge>
                      </span>
                    ) : null}
                    {!hasPayload ? (
                      <span data-testid="attachment-missing">
                        <StatusBadge tone="critical">文件缺失</StatusBadge>
                      </span>
                    ) : null}
                  </span>
                </span>
                <span className="attachment-actions">
                  {hasPayload ? (
                    <Button
                      tone="ghost"
                      size="sm"
                      onClick={() => {
                        setViewerBroken(false);
                        setViewing(attachment);
                      }}
                      data-testid={`view-attachment-${attachment.id}`}
                    >
                      查看
                    </Button>
                  ) : null}
                  <Button
                    tone="ghost"
                    size="sm"
                    onClick={() => setDeleting(attachment)}
                    data-testid={`delete-attachment-${attachment.id}`}
                  >
                    <Trash2 size={14} />
                    删除
                  </Button>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <Dialog
        open={Boolean(viewing)}
        title={viewing ? `查看附件 · ${viewing.fileName}` : "查看附件"}
        onClose={() => setViewing(undefined)}
      >
        {viewing ? (
          <div className="attachment-viewer" data-testid="attachment-viewer">
            {isImageAttachment(viewing) && !viewerBroken ? (
              <img
                className="attachment-preview-image"
                src={viewing.dataUrl}
                alt={viewing.fileName}
                data-testid="attachment-preview-image"
                onError={() => setViewerBroken(true)}
              />
            ) : isImageAttachment(viewing) && viewerBroken ? (
              <p className="attachment-missing-note">
                附件内容缺失或已损坏，无法预览。可删除该记录。
              </p>
            ) : (
              <div className="attachment-file-card">
                <FileText size={28} aria-hidden="true" />
                <strong>{viewing.fileName}</strong>
                <small>
                  {viewing.mediaType} · {formatBytes(viewing.sizeBytes)}
                </small>
              </div>
            )}
            <div className="attachment-viewer-actions">
              <a
                className="button button-secondary button-md"
                href={viewing.dataUrl}
                download={viewing.fileName}
                data-testid="attachment-download"
              >
                <Download size={15} />
                下载
              </a>
              <Button tone="secondary" onClick={() => setViewing(undefined)}>
                关闭
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
      <Dialog
        open={Boolean(deleting)}
        title="删除附件"
        onClose={() => setDeleting(undefined)}
      >
        {deleting ? (
          <div data-testid="confirm-delete-attachment">
            <p>
              删除后无法恢复，该附件的记录将从工作区移除。确定删除「
              {deleting.fileName}」吗？
            </p>
            <div className="editor-actions">
              <Button tone="secondary" onClick={() => setDeleting(undefined)}>
                取消
              </Button>
              <Button
                tone="danger"
                onClick={confirmDelete}
                data-testid="confirm-delete-attachment-button"
              >
                确认删除
              </Button>
            </div>
          </div>
        ) : null}
      </Dialog>
    </section>
  );
}
