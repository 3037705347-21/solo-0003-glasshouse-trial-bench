import type {
  Attachment,
  AttachmentOrigin,
  AttachmentSubjectKind,
  AttachmentTransferMode,
  WorkspaceState,
} from "./types";
import { createId } from "./id";
import { fail, fieldError, ok, type Result } from "./result";

/**
 * 附件本地上限。工作区整体持久化在浏览器 localStorage（约 5MB），
 * 因此单文件和总量都留出余量，避免保存时触发配额异常。
 */
export const MAX_ATTACHMENT_FILE_BYTES = 500 * 1024;
export const MAX_ATTACHMENT_TOTAL_BYTES = 2 * 1024 * 1024;

const ACCEPTED_MEDIA_TYPES: Record<string, string[]> = {
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
  "image/gif": [".gif"],
  "image/webp": [".webp"],
  "application/pdf": [".pdf"],
  "text/plain": [".txt"],
  "text/csv": [".csv"],
};

export const ATTACHMENT_ACCEPT_ATTRIBUTE = Object.entries(ACCEPTED_MEDIA_TYPES)
  .flatMap(([mediaType, extensions]) => [mediaType, ...extensions])
  .join(",");

export interface AttachmentDraft {
  subjectKind: AttachmentSubjectKind;
  subjectId: string;
  fileName: string;
  mediaType: string;
  sizeBytes: number;
  dataUrl: string;
}

export function attachmentSubjectExists(
  state: WorkspaceState,
  kind: AttachmentSubjectKind,
  id: string,
): boolean {
  if (kind === "accession") {
    return state.accessions.some((accession) => accession.id === id);
  }
  if (kind === "observationPass") {
    return state.observationPasses.some((pass) => pass.id === id);
  }
  return state.flags.some((flag) => flag.id === id);
}

export function attachmentsForSubject(
  state: WorkspaceState,
  kind: AttachmentSubjectKind,
  id: string,
): Attachment[] {
  return state.attachments
    .filter(
      (attachment) =>
        attachment.subjectKind === kind && attachment.subjectId === id,
    )
    .sort((left, right) => right.uploadedAt.localeCompare(left.uploadedAt));
}

export function isImageAttachment(attachment: Attachment): boolean {
  return attachment.mediaType.startsWith("image/");
}

/** 附件内容是否可用；缺失内容的记录仍保留，以便追溯和显式清理。 */
export function attachmentHasPayload(attachment: { dataUrl: string }): boolean {
  return /^data:[^;,]+;base64,.+/.test(attachment.dataUrl);
}

export function totalAttachmentBytes(state: WorkspaceState): number {
  return state.attachments.reduce(
    (total, attachment) => total + attachment.sizeBytes,
    0,
  );
}

/** 复制或合并会复制来源附件，预先检查是否会超出本地存储预算。 */
export function transferWouldExceedBudget(
  state: WorkspaceState,
  kind: AttachmentSubjectKind,
  id: string,
): boolean {
  const copiedBytes = attachmentsForSubject(state, kind, id).reduce(
    (total, attachment) => total + attachment.sizeBytes,
    0,
  );
  return totalAttachmentBytes(state) + copiedBytes > MAX_ATTACHMENT_TOTAL_BYTES;
}

function extensionOf(fileName: string): string {
  const index = fileName.lastIndexOf(".");
  return index >= 0 ? fileName.slice(index).toLowerCase() : "";
}

export function isAcceptedFileType(fileName: string, mediaType: string): boolean {
  if (mediaType && mediaType in ACCEPTED_MEDIA_TYPES) {
    return true;
  }
  const extension = extensionOf(fileName);
  return Object.values(ACCEPTED_MEDIA_TYPES).some((extensions) =>
    extensions.includes(extension),
  );
}

/** FNV-1a 32 位哈希，用于确定性重复检测。 */
export function checksumForDataUrl(dataUrl: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < dataUrl.length; index += 1) {
    hash ^= dataUrl.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function decodedLength(dataUrl: string): number | undefined {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) {
    return undefined;
  }
  try {
    return globalThis.atob(dataUrl.slice(commaIndex + 1)).length;
  } catch {
    return undefined;
  }
}

export function validateAttachmentFile(
  file: { fileName: string; mediaType: string; sizeBytes: number },
  state: WorkspaceState,
): Result<true> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  if (!isAcceptedFileType(file.fileName, file.mediaType)) {
    errors.push(
      fieldError(
        "file",
        "unsupported_type",
        "仅支持 PNG/JPEG/GIF/WebP 图片或 PDF、TXT、CSV 文件",
      ),
    );
  }
  if (file.sizeBytes <= 0) {
    errors.push(fieldError("file", "empty", "文件内容为空，未保存"));
  }
  if (file.sizeBytes > MAX_ATTACHMENT_FILE_BYTES) {
    errors.push(
      fieldError(
        "file",
        "too_large",
        `单个附件不能超过 ${Math.round(MAX_ATTACHMENT_FILE_BYTES / 1024)} KB`,
      ),
    );
  }
  if (totalAttachmentBytes(state) + file.sizeBytes > MAX_ATTACHMENT_TOTAL_BYTES) {
    errors.push(
      fieldError(
        "file",
        "quota",
        "附件总大小超出本地存储预算，请先删除部分附件",
      ),
    );
  }
  return errors.length > 0 ? fail(errors) : ok(true);
}

/**
 * 创建附件。重复内容（同一记录、同一校验和）会被拒绝而不是悄悄覆盖；
 * 数据无法解码或长度不符时视为损坏，同样不落库。
 */
export function createAttachment(
  draft: AttachmentDraft,
  state: WorkspaceState,
): Result<Attachment> {
  const errors: Array<ReturnType<typeof fieldError>> = [];
  if (!attachmentSubjectExists(state, draft.subjectKind, draft.subjectId)) {
    errors.push(
      fieldError("subject", "unknown", "附件对应的记录不存在，未保存"),
    );
  }
  const fileCheck = validateAttachmentFile(draft, state);
  if (!fileCheck.ok) {
    errors.push(...fileCheck.errors);
  }
  if (!attachmentHasPayload(draft)) {
    errors.push(
      fieldError("file", "corrupt", "文件内容损坏或格式不符，未保存"),
    );
  } else {
    const length = decodedLength(draft.dataUrl);
    if (length === undefined || Math.abs(length - draft.sizeBytes) > 2) {
      errors.push(
        fieldError("file", "corrupt", "文件内容损坏或格式不符，未保存"),
      );
    }
  }
  const checksum = checksumForDataUrl(draft.dataUrl);
  const duplicate = state.attachments.find(
    (attachment) =>
      attachment.subjectKind === draft.subjectKind &&
      attachment.subjectId === draft.subjectId &&
      attachment.checksum === checksum,
  );
  if (duplicate) {
    errors.push(
      fieldError(
        "file",
        "duplicate",
        "相同内容的附件已存在，未重复上传",
      ),
    );
  }
  if (errors.length > 0) {
    return fail(errors);
  }
  return ok({
    id: createId("att"),
    subjectKind: draft.subjectKind,
    subjectId: draft.subjectId,
    fileName: draft.fileName.trim() || "未命名附件",
    mediaType: draft.mediaType || "application/octet-stream",
    sizeBytes: draft.sizeBytes,
    checksum,
    dataUrl: draft.dataUrl,
    uploadedAt: new Date().toISOString(),
  });
}

/**
 * 把来源记录上的附件复制到目标记录，并固化溯源信息。
 * 链式转移始终指向最初来源，保证“仍指向正确来源并可追溯”。
 */
export function transferAttachments(
  state: WorkspaceState,
  source: { kind: AttachmentSubjectKind; id: string; label: string },
  target: { kind: AttachmentSubjectKind; id: string },
  transferredBy: AttachmentTransferMode,
): Attachment[] {
  const transferredAt = new Date().toISOString();
  return attachmentsForSubject(state, source.kind, source.id).map(
    (attachment) => {
      const origin: AttachmentOrigin = attachment.origin ?? {
        attachmentId: attachment.id,
        subjectKind: source.kind,
        subjectId: source.id,
        subjectLabel: source.label,
        transferredBy,
        transferredAt,
      };
      return {
        ...attachment,
        id: createId("att"),
        subjectKind: target.kind,
        subjectId: target.id,
        origin,
      };
    },
  );
}
