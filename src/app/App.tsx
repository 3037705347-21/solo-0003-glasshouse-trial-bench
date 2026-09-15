import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./AppShell";
import { AccessionHistoryPage } from "../features/roster/AccessionHistoryPage";
import { RosterPage } from "../features/roster/RosterPage";
import { DuplicatesPage } from "../features/duplicates/DuplicatesPage";
import { LayoutPage } from "../features/layout/LayoutPage";
import { ObservationPage } from "../features/observations/ObservationPage";
import { ClearancePage } from "../features/clearance/ClearancePage";

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/roster" replace />} />
        <Route path="/roster" element={<RosterPage />} />
        <Route path="/duplicates" element={<DuplicatesPage />} />
        <Route
          path="/accessions/:accessionId/history"
          element={<AccessionHistoryPage />}
        />
        <Route path="/layout" element={<LayoutPage />} />
        <Route path="/observations" element={<ObservationPage />} />
        <Route path="/clearance" element={<ClearancePage />} />
        <Route path="*" element={<Navigate to="/roster" replace />} />
      </Routes>
    </AppShell>
  );
}
