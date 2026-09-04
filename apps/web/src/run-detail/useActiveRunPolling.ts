import type { RunDetailV1, TrajectoryEventV1, TrajectoryPageV1 } from "@agentlens/api-contract";
import { useEffect, useRef, useState } from "react";

import { isRetryableActiveSnapshotError, retryActiveSnapshotRequest } from "../api/activeSnapshotRetry.js";
import type { AgentLensApiClient } from "../api/client.js";

const pollIntervalMs = 1_000;
const pollLimit = 100;

function active(status: RunDetailV1["status"] | undefined): boolean {
  return status?.state === "known" && (status.value === "starting" || status.value === "running");
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
      let terminalFailure: unknown = null;
      const lastSequence = eventsRef.current.at(-1)?.sequence;
      const eventQuery = lastSequence === undefined
        ? { limit: pollLimit }
        : { limit: pollLimit, afterSequence: lastSequence };
      const markRetrying = (): void => {
        if (disposed || controller !== pollController) return;
        setPollState((current) => current.runId === input.runId
          ? { ...current, degraded: true, error: null }
          : current);
      };
      const stopOnTerminalFailure = (failure: unknown): void => {
        if (isRetryableActiveSnapshotError(failure) || pollController.signal.aborted) return;
        terminalFailure ??= failure;
        pollController.abort();
      };
      const [runResult, pageResult] = await Promise.allSettled([
        retryActiveSnapshotRequest({
          request: () => input.client.getRun(input.runId, pollController.signal),
          signal: pollController.signal,
          onRetryableFailure: markRetrying
        }).catch((failure: unknown) => {
          stopOnTerminalFailure(failure);
          throw failure;
        }),
        retryActiveSnapshotRequest({
          request: () => input.client.getEvents(input.runId, eventQuery, pollController.signal),
          signal: pollController.signal,
          onRetryableFailure: markRetrying
        }).catch((failure: unknown) => {
          stopOnTerminalFailure(failure);
          throw failure;
        })
      ]);
      if (disposed || (pollController.signal.aborted && terminalFailure === null)) return;
      if (controller === pollController) controller = null;

      let latestStatus = input.status;
      let degraded = false;
      let failure: unknown = terminalFailure;
      if (runResult.status === "fulfilled") {
        latestStatus = runResult.value.status;
        try {
          onRunRef.current(runResult.value);
        } catch (error) {
          failure = error;
        }
      } else if (failure === null && !pollController.signal.aborted) {
        failure = runResult.reason;
      }
      if (pageResult.status === "fulfilled") {
        try {
          onPageRef.current(pageResult.value);
        } catch (error) {
          if (failure === null) failure = error;
        }
      } else if (failure === null && !pollController.signal.aborted) {
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
