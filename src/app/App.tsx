import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./AppShell";
import { AccessionHistoryPage } from "../features/roster/AccessionHistoryPage";
import { RosterPage } from "../features/roster/RosterPage";
import { LayoutPage } from "../features/layout/LayoutPage";
import { ObservationPage } from "../features/observations/ObservationPage";
import { ClearancePage } from "../features/clearance/ClearancePage";
import { RuleSetsPage } from "../features/rules/RuleSetsPage";

export function App() {
  return (
    <AppShell>
      <Routes>
        <Route path="/" element={<Navigate to="/roster" replace />} />
        <Route path="/roster" element={<RosterPage />} />
        <Route
          path="/accessions/:accessionId/history"
          element={<AccessionHistoryPage />}
        />
        <Route path="/layout" element={<LayoutPage />} />
        <Route path="/observations" element={<ObservationPage />} />
        <Route path="/clearance" element={<ClearancePage />} />
        <Route path="/rules" element={<RuleSetsPage />} />
        <Route path="*" element={<Navigate to="/roster" replace />} />
      </Routes>
    </AppShell>
  );
}
