import { browserAddressableEventIdV1Schema } from "@agentlens/api-contract";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { useAgentLensApi } from "../api/queries.js";
import { queryKeys } from "../api/queryKeys.js";
import { ErrorState } from "../app/ErrorState.js";
import { TrajectoryToolbar } from "../trajectory/TrajectoryToolbar.js";
import { useTrajectoryPages } from "../trajectory/useTrajectoryPages.js";
import { RunHeader } from "./RunHeader.js";
import { RunWorkspace } from "./RunWorkspace.js";
import { useActiveRunPolling } from "./useActiveRunPolling.js";

function TrajectoryDetail({ runId }: Readonly<{ runId: string }>) {
  const client = useAgentLensApi();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const eventValues = searchParams.getAll("event");
  const hasEventQuery = searchParams.has("event");
  const rawEventId = eventValues.length === 1 ? eventValues[0] : null;
  const parsedEventId = rawEventId === null ? null : browserAddressableEventIdV1Schema.safeParse(rawEventId);
  const selectedEventId = parsedEventId?.success ? parsedEventId.data : null;
  const invalidEventQuery = hasEventQuery && (eventValues.length !== 1 || parsedEventId?.success !== true);
  const run = useQuery({
    queryKey: queryKeys.run(runId),
    queryFn: ({ signal }) => client.getRun(runId, signal)
  });
  const trajectory = useTrajectoryPages(runId, selectedEventId);
  const polling = useActiveRunPolling({
    client,
    runId,
    status: trajectory.state === "ready" ? run.data?.status : undefined,
    events: trajectory.events,
    onRun: (nextRun) => queryClient.setQueryData(queryKeys.run(runId), nextRun),
    onPage: trajectory.appendPage
  });
  const select = (eventId: string): void => setSearchParams({ event: eventId });

  if (run.isPending) return <div className="loading-state" role="status">Loading run evidence…</div>;
  if (run.isError) return <ErrorState title="Run evidence unavailable" message="AgentLens could not load this run." />;
  return (
    <section className="run-detail-page">
      <Link className="run-detail-page__back" to="/runs">← Run ledger</Link>
      <RunHeader run={run.data} onAssessmentSaved={select} />
      {invalidEventQuery && (
        <section className="trajectory-selection-error" role="alert">The selected event link is invalid.</section>
      )}
      {polling.degraded && (
        <p className="live-evidence-state live-evidence-state--degraded" role="status" aria-label="Live evidence status">
          Live evidence temporarily unavailable · retrying automatically.
        </p>
      )}
      {polling.error !== null && (
        <p className="live-evidence-state live-evidence-state--error" role="alert">
          Live evidence polling stopped because the local read contract failed.
        </p>
      )}
      <TrajectoryToolbar
        eventCount={trajectory.events.length}
        hasEarlier={trajectory.hasEarlier}
        hasLater={trajectory.hasLater}
        onEarlier={trajectory.loadEarlier}
        onLater={trajectory.loadLater}
        anchors={run.data.anchors}
        onJump={select}
      />
      {trajectory.pagingState === "loading" && (
        <div className="loading-state" role="status">Loading trajectory page…</div>
      )}
      {trajectory.pagingState === "error" && (
        <section className="trajectory-selection-error" role="alert">
          The next trajectory page could not be loaded.
        </section>
      )}
      {trajectory.state === "loading" && <div className="loading-state" role="status">Loading trajectory events…</div>}
      {trajectory.state === "error" && (
        <ErrorState title="Trajectory unavailable" message="AgentLens could not load trajectory events." />
      )}
      {trajectory.state === "ready" && (
        <RunWorkspace
          runId={runId}
          run={run.data}
          events={trajectory.events}
          selectedEventId={selectedEventId}
          selectionState={trajectory.selectionState}
          onSelect={select}
        />
      )}
    </section>
  );
}

export function RunDetailPage() {
  const { runId } = useParams();
  if (runId === undefined) {
    return <ErrorState title="Run not found" message="The requested run identity is unavailable." />;
  }
  return <TrajectoryDetail runId={runId} />;
}
