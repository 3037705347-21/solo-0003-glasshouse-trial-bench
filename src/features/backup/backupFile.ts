import type { WorkspaceBackup } from "../../domain/backup";

export function backupFileName(exportedAt: string): string {
  const stamp = exportedAt.replace(/[:.]/g, "-");
  return `glasshouse-workspace-backup-${stamp}.json`;
}

export function downloadWorkspaceBackup(backup: WorkspaceBackup): string {
  const fileName = backupFileName(backup.exportedAt);
  const blob = new Blob([JSON.stringify(backup, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
  return fileName;
}

export function formatBackupTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}
