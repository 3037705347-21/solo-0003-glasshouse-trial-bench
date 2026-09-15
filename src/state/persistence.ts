import type { Accession, Attachment, WorkspaceState } from "../domain/types";
import { isWorkspaceState } from "./types";
import { createSampleWorkspaceState } from "./sampleData";

export const WORKSPACE_STORAGE_KEY = "glasshouse-trial-bench:workspace:v1";

function normalizeAccession(accession: Accession): Accession {
  return {
    ...accession,
    lifecycleStatus:
      accession.lifecycleStatus ??
      (accession.retiredAt ? "retired" : "active"),
    retirementHistory: Array.isArray(accession.retirementHistory)
      ? accession.retirementHistory
      : [],
  };
}

function normalizeOrigin(origin: Attachment["origin"]): Attachment["origin"] {
  if (!origin || typeof origin !== "object") {
    return undefined;
  }
  if (
    typeof origin.attachmentId !== "string" ||
    typeof origin.subjectId !== "string" ||
    typeof origin.subjectLabel !== "string"
  ) {
    return undefined;
  }
  return {
    attachmentId: origin.attachmentId,
    subjectKind: origin.subjectKind,
    subjectId: origin.subjectId,
    subjectLabel: origin.subjectLabel,
    transferredBy: origin.transferredBy === "merge" ? "merge" : "duplicate",
    transferredAt: typeof origin.transferredAt === "string" ? origin.transferredAt : "",
  };
}

function normalizeAttachment(attachment: Attachment): Attachment {
  return {
    ...attachment,
    fileName: attachment.fileName || "未命名附件",
    mediaType: attachment.mediaType || "application/octet-stream",
    sizeBytes:
      typeof attachment.sizeBytes === "number" ? attachment.sizeBytes : 0,
    checksum: attachment.checksum ?? "",
    // 内容缺失的附件记录仍然保留，由界面显式提示，而不是悄悄丢弃。
    dataUrl: typeof attachment.dataUrl === "string" ? attachment.dataUrl : "",
    uploadedAt: attachment.uploadedAt || "",
    origin: normalizeOrigin(attachment.origin),
  };
}

export function normalizeWorkspaceState(
  state: WorkspaceState,
): WorkspaceState {
  return {
    ...state,
    accessions: state.accessions.map(normalizeAccession),
    attachments: Array.isArray(state.attachments)
      ? state.attachments.map(normalizeAttachment)
      : [],
  };
}

export interface StoredWorkspace {
  version: 1;
  savedAt: string;
  state: WorkspaceState;
}

export function loadWorkspaceState(): WorkspaceState {
  try {
    const raw = window.localStorage.getItem(WORKSPACE_STORAGE_KEY);
    if (!raw) {
      return createSampleWorkspaceState();
    }
    const parsed = JSON.parse(raw) as Partial<StoredWorkspace>;
    if (!parsed || !isWorkspaceState(parsed.state)) {
      return createSampleWorkspaceState();
    }
    return normalizeWorkspaceState(parsed.state);
  } catch {
    return createSampleWorkspaceState();
  }
}

/**
 * 解析导入的工作区文件。结构不合法时返回 undefined，
 * 由调用方提示导入失败而不影响当前工作区。
 */
export function parseWorkspaceExport(raw: string): WorkspaceState | undefined {
  try {
    const parsed = JSON.parse(raw) as Partial<StoredWorkspace>;
    if (!parsed || !isWorkspaceState(parsed.state)) {
      return undefined;
    }
    return normalizeWorkspaceState(parsed.state);
  } catch {
    return undefined;
  }
}

export function serializeWorkspace(state: WorkspaceState): string {
  const stored: StoredWorkspace = {
    version: 1,
    savedAt: new Date().toISOString(),
    state,
  };
  return JSON.stringify(stored, null, 2);
}

export function saveWorkspaceState(state: WorkspaceState): boolean {
  const stored: StoredWorkspace = {
    version: 1,
    savedAt: new Date().toISOString(),
    state,
  };
  try {
    window.localStorage.setItem(WORKSPACE_STORAGE_KEY, JSON.stringify(stored));
    return true;
  } catch {
    // 本地存储配额耗尽时不打断交互；附件上传前的总量预算应先行拦截。
    return false;
  }
}

export function clearWorkspaceStorage(): void {
  window.localStorage.removeItem(WORKSPACE_STORAGE_KEY);
}
