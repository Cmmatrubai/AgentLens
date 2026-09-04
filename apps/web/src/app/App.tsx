import { Navigate, Route, Routes } from "react-router-dom";

import type { AgentLensApiClient } from "../api/client.js";
import { ApiClientProvider } from "../api/queries.js";
import { RunListPage } from "../runs/RunListPage.js";
import { AppShell } from "./AppShell.js";
import { ErrorState } from "./ErrorState.js";
import { RunDetailPage } from "../run-detail/RunDetailPage.js";

export function App({ client }: Readonly<{ client: AgentLensApiClient | null }>) {
  if (client === null) {
    return (
      <AppShell>
        <ErrorState
          title="Authentication expired"
          message="Restart AgentLens UI to reconnect."
        />
      </AppShell>
    );
  }
  return (
    <ApiClientProvider client={client}>
      <AppShell>
        <Routes>
          <Route path="/runs" element={<RunListPage />} />
          <Route path="/runs/:runId" element={<RunDetailPage />} />
          <Route path="*" element={<Navigate replace to="/runs" />} />
        </Routes>
      </AppShell>
    </ApiClientProvider>
  );
}
