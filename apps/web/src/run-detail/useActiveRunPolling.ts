import type { RunDetailV1, TrajectoryEventV1, TrajectoryPageV1 } from "@agentlens/api-contract";
import { useEffect, useRef, useState } from "react";

import { AgentLensClientError, type AgentLensApiClient } from "../api/client.js";

const pollIntervalMs = 1_000;
const pollLimit = 100;

function active(status: RunDetailV1["status"] | undefined): boolean {
  return status?.state === "known" && (status.value === "starting" || status.value === "running");
}

function temporarySnapshotFailure(error: unknown): boolean {
  return error instanceof AgentLensClientError &&
    error.code === "active_snapshot_unavailable" &&
    error.status === 503 &&
    error.retryable;
}

export function useActiveRunPolling(input: Readonly<{
  client: Pick<AgentLensApiClient, "getRun" | "getEvents">;
  runId: string;
  status: RunDetailV1["status"] | undefined;
  events: readonly TrajectoryEventV1[];
  onRun: (run: RunDetailV1) => void;
  onPage: (page: TrajectoryPageV1) => void;
}>) {
  const eventsRef = useRef(input.events);
  const onRunRef = useRef(input.onRun);
  const onPageRef = useRef(input.onPage);
  eventsRef.current = input.events;
  onRunRef.current = input.onRun;
  onPageRef.current = input.onPage;
  const [pollState, setPollState] = useState<Readonly<{
    runId: string;
    degraded: boolean;
    error: unknown;
  }>>({ runId: input.runId, degraded: false, error: null });
  const currentState = pollState.runId === input.runId
    ? pollState
    : { runId: input.runId, degraded: false, error: null };
  const shouldPoll = active(input.status);

  useEffect(() => {
    if (!shouldPoll) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let controller: AbortController | null = null;

    const schedule = (): void => {
      timer = setTimeout(() => { void poll(); }, pollIntervalMs);
    };
    const poll = async (): Promise<void> => {
      const pollController = new AbortController();
      controller = pollController;
      const lastSequence = eventsRef.current.at(-1)?.sequence;
      const eventQuery = lastSequence === undefined
        ? { limit: pollLimit }
        : { limit: pollLimit, afterSequence: lastSequence };
      const [runResult, pageResult] = await Promise.allSettled([
        input.client.getRun(input.runId, pollController.signal),
        input.client.getEvents(input.runId, eventQuery, pollController.signal)
      ]);
      if (disposed || pollController.signal.aborted) return;
      if (controller === pollController) controller = null;

      let latestStatus = input.status;
      let degraded = false;
      let failure: unknown = null;
      if (runResult.status === "fulfilled") {
        latestStatus = runResult.value.status;
        try {
          onRunRef.current(runResult.value);
        } catch (error) {
          failure = error;
        }
      } else if (temporarySnapshotFailure(runResult.reason)) {
        degraded = true;
      } else {
        failure = runResult.reason;
      }
      if (pageResult.status === "fulfilled") {
        try {
          onPageRef.current(pageResult.value);
        } catch (error) {
          if (failure === null) failure = error;
        }
      } else if (temporarySnapshotFailure(pageResult.reason)) {
        degraded = true;
      } else if (failure === null) {
        failure = pageResult.reason;
      }
      setPollState({ runId: input.runId, degraded, error: failure });
      if (failure === null && active(latestStatus)) schedule();
    };

    schedule();
    return () => {
      disposed = true;
      if (timer !== null) clearTimeout(timer);
      controller?.abort();
    };
  }, [input.client, input.runId, shouldPoll]);

  return currentState;
}
