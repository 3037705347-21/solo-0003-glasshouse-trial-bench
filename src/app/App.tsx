import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./AppShell";
import { RosterPage } from "../features/roster/RosterPage";
import { LayoutPage } from "../features/layout/LayoutPage";
import { ObservationPage } from "../features/observations/ObservationPage";
import { TrendsPage } from "../features/trends/TrendsPage";
import { ClearancePage } from "../features/clearance/ClearancePage";

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/roster" replace />} />
        <Route path="/roster" element={<RosterPage />} />
        <Route path="/layout" element={<LayoutPage />} />
        <Route path="/observations" element={<ObservationPage />} />
        <Route path="/trends" element={<TrendsPage />} />
        <Route path="/clearance" element={<ClearancePage />} />
        <Route path="*" element={<Navigate to="/roster" replace />} />
      </Routes>
    </AppShell>
  );
}
