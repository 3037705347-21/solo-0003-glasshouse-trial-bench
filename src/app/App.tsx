import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./AppShell";
import { RosterPage } from "../features/roster/RosterPage";
import { LayoutPage } from "../features/layout/LayoutPage";
import { ObservationPage } from "../features/observations/ObservationPage";
import { ClearancePage } from "../features/clearance/ClearancePage";
import { SchedulePage } from "../features/schedule/SchedulePage";

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/roster" replace />} />
        <Route path="/roster" element={<RosterPage />} />
        <Route path="/layout" element={<LayoutPage />} />
        <Route path="/observations" element={<ObservationPage />} />
        <Route path="/clearance" element={<ClearancePage />} />
        <Route path="/schedule" element={<SchedulePage />} />
        <Route path="*" element={<Navigate to="/roster" replace />} />
      </Routes>
    </AppShell>
  );
}
