import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./AppShell";
import { TrialsPage } from "../features/trials/TrialsPage";
import { RosterPage } from "../features/roster/RosterPage";
import { LayoutPage } from "../features/layout/LayoutPage";
import { ObservationPage } from "../features/observations/ObservationPage";
import { ClearancePage } from "../features/clearance/ClearancePage";

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/trials" replace />} />
        <Route path="/trials" element={<TrialsPage />} />
        <Route path="/roster" element={<RosterPage />} />
        <Route path="/layout" element={<LayoutPage />} />
        <Route path="/observations" element={<ObservationPage />} />
        <Route path="/clearance" element={<ClearancePage />} />
        <Route path="*" element={<Navigate to="/trials" replace />} />
      </Routes>
    </AppShell>
  );
}
