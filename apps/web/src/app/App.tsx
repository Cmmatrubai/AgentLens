import { Link, Navigate, Route, Routes, useParams } from "react-router-dom";

import type { AgentLensApiClient } from "../api/client.js";
import { ApiClientProvider } from "../api/queries.js";
import { RunListPage } from "../runs/RunListPage.js";
import { AppShell } from "./AppShell.js";
import { ErrorState } from "./ErrorState.js";

function RunDetailShell() {
  const { runId } = useParams();
  return (
    <section className="detail-shell" aria-labelledby="detail-shell-title">
      <p className="page-eyebrow">Run evidence</p>
      <h1 id="detail-shell-title">Run detail</h1>
      <p className="detail-shell__identity">{runId}</p>
      <p>The execution trajectory is not loaded in this shell.</p>
      <Link to="/runs">Return to the run ledger</Link>
    </section>
  );
}

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
          <Route path="/runs/:runId" element={<RunDetailShell />} />
          <Route path="*" element={<Navigate replace to="/runs" />} />
        </Routes>
      </AppShell>
    </ApiClientProvider>
  );
}
