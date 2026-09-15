import type { ReactNode } from "react";
import { Nav } from "./Nav";
import { MigrationBanner } from "../features/recovery/MigrationBanner";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="app-shell">
      <Nav />
      <div className="app-column">
        <MigrationBanner />
        <main className="app-main">{children}</main>
      </div>
    </div>
  );
}
