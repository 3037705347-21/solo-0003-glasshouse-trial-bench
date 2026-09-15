import type { ReactNode } from "react";
import { Nav } from "./Nav";
import { useWorkspace } from "../state/store";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  const { persistenceFailed } = useWorkspace();
  return (
    <div className="app-shell">
      <Nav />
      <main className="app-main">
        {persistenceFailed ? (
          <div className="persistence-warning" role="alert">
            本地存储空间不足，最近的更改可能无法保存。请删除部分附件，或导出工作区后清理。
          </div>
        ) : null}
        {children}
      </main>
    </div>
  );
}
