interface StatusBadgeProps {
  children: string;
  tone: "neutral" | "positive" | "warning" | "critical" | "info";
}

export function StatusBadge({ children, tone }: StatusBadgeProps) {
  return <span className={`status-badge status-badge-${tone}`}>{children}</span>;
}

export function statusTone(
  value: string,
): StatusBadgeProps["tone"] {
  if (
    ["active", "assigned", "ready", "resolved", "available", "cleared", "进行中", "已分配", "就绪", "已解决", "可用", "已放行"].includes(
      value,
    )
  ) {
    return "positive";
  }
  if (
    ["paused", "waived", "partial-shade", "info", "已暂停", "已豁免", "半阴", "提示"].includes(
      value,
    )
  ) {
    return "info";
  }
  if (
    ["blocked", "quarantine", "open", "受限", "隔离", "未处理", "严重"].includes(
      value,
    )
  ) {
    return "critical";
  }
  if (
    ["draft", "unassigned", "warning", "草稿", "未分配", "警告"].includes(value)
  ) {
    return "warning";
  }
  return "neutral";
}
