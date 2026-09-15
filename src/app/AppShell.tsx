import type { ReactNode } from "react";
import { Nav } from "./Nav";
import { BootQualityBanner } from "./BootQualityBanner";

interface AppShellProps {
  children: ReactNode;
}

export function AppShell({ children }: AppShellProps) {
  return (
    <div className="app-shell">
      <Nav />
      <main className="app-main">
        <BootQualityBanner />
        {children}
      </main>
    </div>
  );
}
