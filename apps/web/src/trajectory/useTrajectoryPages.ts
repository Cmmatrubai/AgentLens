import type { TrajectoryEventV1, TrajectoryPageV1 } from "@agentlens/api-contract";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AgentLensApiClient } from "../api/client.js";
import { retryActiveSnapshotRequest } from "../api/activeSnapshotRetry.js";
import { useAgentLensApi } from "../api/queries.js";
import { mergeTrajectoryPages } from "./mergePages.js";

export type SelectionResolution =
  | Readonly<{ state: "resolved"; event: TrajectoryEventV1; page: TrajectoryPageV1 | null }>
  | Readonly<{ state: "unavailable" }>;

export async function resolveTrajectorySelection(input: Readonly<{
  client: Pick<AgentLensApiClient, "getEvent" | "getEvents">;
  runId: string;
  eventId: string;
  loadedEvents: readonly TrajectoryEventV1[];
  limit: number;
  signal?: AbortSignal;
}>): Promise<SelectionResolution> {
  const loaded = input.loadedEvents.find(({ eventId }) => eventId === input.eventId);
  if (loaded !== undefined) return { state: "resolved", event: loaded, page: null };
  const detail = await input.client.getEvent(input.runId, input.eventId, input.signal);
  const page = await input.client.getEvents(input.runId, {
    limit: input.limit,
    aroundSequence: detail.sequence
  }, input.signal);
  const event = page.items.find(({ eventId, sequence }) =>
    eventId === detail.eventId && sequence === detail.sequence
  );
  return event === undefined ? { state: "unavailable" } : { state: "resolved", event, page };
}

const pageLimit = 100;

export type TrajectoryCursorRequest = Readonly<{
  direction: "earlier" | "later";
  cursor: string;
}>;

export type LiveTrajectoryAppend = Readonly<{
  runId: string;
  revision: number;
  identities: readonly string[];
}>;

function eventIdentity(event: TrajectoryEventV1): string {
  return `${event.eventId}:${event.sequence}`;
}

export function trajectoryPageCursors(
  pages: readonly TrajectoryPageV1[],
  requests: readonly (TrajectoryCursorRequest | null)[] = []
): Readonly<{ earlier: string | null; later: string | null }> {
  const nonempty = pages.filter((page) => page.window.state === "nonempty");
  if (nonempty.length === 0) {
    const last = pages.at(-1);
    return {
      earlier: last?.window.earlierCursor ?? null,
      later: last?.window.laterCursor ?? null
    };
  }
  const ordered = [...nonempty].sort((left, right) => {
    if (left.window.state !== "nonempty" || right.window.state !== "nonempty") return 0;
    return left.window.minSequence - right.window.minSequence;
  });
  const earliest = ordered[0]!;
  const latest = ordered.reduce((candidate, page) => {
    if (candidate.window.state !== "nonempty" || page.window.state !== "nonempty") return candidate;
    return page.window.maxSequence > candidate.window.maxSequence ? page : candidate;
  }, earliest);
  let earlier = earliest.window.earlierCursor;
  let later = latest.window.laterCursor;
  for (let index = 0; index < ordered.length - 1; index += 1) {
    const left = ordered[index]!;
    const right = ordered[index + 1]!;
    if (left.window.state !== "nonempty" || right.window.state !== "nonempty") continue;
    if (left.window.maxSequence + 1 < right.window.minSequence) {
      later ??= left.window.laterCursor;
      earlier ??= right.window.earlierCursor;
    }
  }
  for (let index = 0; index < pages.length; index += 1) {
    const page = pages[index]!;
    const request = requests[index];
    if (page.mode !== "cursor" || page.window.state !== "empty" || request == null) continue;
    if (request.direction === "earlier" && earlier === request.cursor) earlier = null;
    if (request.direction === "later" && later === request.cursor) later = null;
  }
  return { earlier, later };
}

function hasCanonicalGap(events: readonly TrajectoryEventV1[]): boolean {
  for (let index = 1; index < events.length; index += 1) {
    if (events[index - 1]!.sequence + 1 !== events[index]!.sequence) return true;
  }
  return false;
}

export function useTrajectoryPages(
  runId: string,
  selectedEventId: string | null,
  run: Readonly<{ terminal: boolean; totalEventCount: number }> | null
) {
  const client = useAgentLensApi();
  const [entries, setEntries] = useState<readonly Readonly<{
    page: TrajectoryPageV1;
    request: TrajectoryCursorRequest | null;
  }>[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<unknown>(null);
  const [retryingRequestIdentities, setRetryingRequestIdentities] = useState<ReadonlySet<object>>(() => new Set());
  const [selectionState, setSelectionState] = useState<"idle" | "resolving" | "unavailable">("idle");
  const [pagingState, setPagingState] = useState<"idle" | "loading" | "error">("idle");
  const [liveAppend, setLiveAppend] = useState<LiveTrajectoryAppend>({
    runId,
    revision: 0,
    identities: []
  });
  const liveAppendRef = useRef<LiveTrajectoryAppend>(liveAppend);
  const initialRequestRef = useRef<Readonly<{ identity: object; controller: AbortController }> | null>(null);
  const selectionRequestRef = useRef<object | null>(null);
  const cursorRequestRef = useRef<Readonly<{ identity: object; controller: AbortController }> | null>(null);
  const autoFillAttemptRef = useRef<Readonly<{ runId: string; initialPage: TrajectoryPageV1 }> | null>(null);
  const entriesRef = useRef<readonly Readonly<{
    page: TrajectoryPageV1;
    request: TrajectoryCursorRequest | null;
  }>[]>([]);
  const pages = useMemo(() => entries.map(({ page }) => page), [entries]);
  const events = useMemo(() => mergeTrajectoryPages(pages), [pages]);
  const eventsRef = useRef(events);
  eventsRef.current = events;
  const retrying = retryingRequestIdentities.size > 0;

  const markRetrying = useCallback((identity: object): void => {
    setRetryingRequestIdentities((current) => {
      if (current.has(identity)) return current;
      return new Set([...current, identity]);
    });
  }, []);
  const clearRetrying = useCallback((identity: object): void => {
    setRetryingRequestIdentities((current) => {
      if (!current.has(identity)) return current;
      const next = new Set(current);
      next.delete(identity);
      return next;
    });
  }, []);
  const clearAllRetrying = useCallback((): void => {
    setRetryingRequestIdentities(new Set());
  }, []);

  const commitPage = useCallback((page: TrajectoryPageV1, request: TrajectoryCursorRequest | null = null): readonly string[] => {
    const before = mergeTrajectoryPages(entriesRef.current.map((entry) => entry.page));
    if (page.mode === "after" && page.items.length === 0) return [];
    const base = page.mode === "tail" && before.length === 0
      ? entriesRef.current.filter((entry) => entry.page.mode !== "tail")
      : entriesRef.current;
    const candidate = [...base, { page, request }];
    const after = mergeTrajectoryPages(candidate.map((entry) => entry.page));
    entriesRef.current = candidate;
    setEntries(candidate);
    const previous = new Set(before.map(eventIdentity));
    return after.map(eventIdentity).filter((identity) => !previous.has(identity));
  }, []);

  const appendPage = useCallback((page: TrajectoryPageV1): number => {
    if (page.mode !== "tail" && page.mode !== "after") {
      throw new Error("Active trajectory polling returned an incompatible page mode.");
    }
    const appended = commitPage(page);
    const current = liveAppendRef.current.runId === runId
      ? liveAppendRef.current
      : { runId, revision: 0, identities: [] };
    const next = { runId, revision: current.revision + 1, identities: appended };
    liveAppendRef.current = next;
    setLiveAppend(next);
    return appended.length;
  }, [commitPage, runId]);

  useEffect(() => {
    const controller = new AbortController();
    const identity = {};
    initialRequestRef.current = { identity, controller };
    cursorRequestRef.current?.controller.abort();
    cursorRequestRef.current = null;
    autoFillAttemptRef.current = null;
    selectionRequestRef.current = null;
    entriesRef.current = [];
    const resetLiveAppend = { runId, revision: 0, identities: [] };
    liveAppendRef.current = resetLiveAppend;
    setLiveAppend(resetLiveAppend);
    setEntries([]);
    setState("loading");
    setError(null);
    clearAllRetrying();
    setSelectionState("idle");
    setPagingState("idle");
    void retryActiveSnapshotRequest({
      request: () => client.getEvents(runId, { limit: pageLimit }, controller.signal),
      signal: controller.signal,
      onRetryableFailure: () => markRetrying(identity)
    }).then((page) => {
      if (controller.signal.aborted || initialRequestRef.current?.identity !== identity) return;
      initialRequestRef.current = null;
      try {
        commitPage(page);
        clearRetrying(identity);
        setState("ready");
      } catch (failure) {
        clearRetrying(identity);
        setError(failure);
        setState("error");
      }
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted && initialRequestRef.current?.identity === identity) {
        initialRequestRef.current = null;
        clearRetrying(identity);
        setError(failure);
        setState("error");
      }
    });
    return () => {
      if (initialRequestRef.current?.identity === identity) {
        controller.abort();
        initialRequestRef.current = null;
      }
      clearRetrying(identity);
      const cursorRequest = cursorRequestRef.current;
      cursorRequest?.controller.abort();
      if (cursorRequest !== null) clearRetrying(cursorRequest.identity);
      cursorRequestRef.current = null;
    };
  }, [clearAllRetrying, clearRetrying, client, commitPage, markRetrying, runId]);

  useEffect(() => {
    if (state !== "ready" || selectedEventId === null ||
        eventsRef.current.some(({ eventId }) => eventId === selectedEventId)) {
      setSelectionState("idle");
      return;
    }
    const controller = new AbortController();
    const identity = {};
    selectionRequestRef.current = identity;
    setSelectionState("resolving");
    void retryActiveSnapshotRequest({
      request: () => resolveTrajectorySelection({
        client,
        runId,
        eventId: selectedEventId,
        loadedEvents: eventsRef.current,
        limit: pageLimit,
        signal: controller.signal
      }),
      signal: controller.signal,
      onRetryableFailure: () => markRetrying(identity)
    }).then((resolution) => {
      if (controller.signal.aborted || selectionRequestRef.current !== identity) return;
      selectionRequestRef.current = null;
      if (resolution.state === "resolved") {
        try {
          if (resolution.page !== null) commitPage(resolution.page);
          clearRetrying(identity);
          setSelectionState("idle");
        } catch (failure) {
          clearRetrying(identity);
          setError(failure);
          setState("error");
        }
      } else if (resolution.state === "unavailable") {
        clearRetrying(identity);
        setSelectionState("unavailable");
      }
    }).catch(() => {
      if (!controller.signal.aborted && selectionRequestRef.current === identity) {
        selectionRequestRef.current = null;
        clearRetrying(identity);
        setSelectionState("unavailable");
      }
    });
    return () => {
      if (selectionRequestRef.current === identity) {
        controller.abort();
        selectionRequestRef.current = null;
      }
      clearRetrying(identity);
    };
  }, [clearRetrying, client, commitPage, markRetrying, runId, selectedEventId, state]);

  const loadCursor = useCallback(async (direction: "earlier" | "later", cursor: string) => {
    const previousCursorRequest = cursorRequestRef.current;
    previousCursorRequest?.controller.abort();
    if (previousCursorRequest !== null) clearRetrying(previousCursorRequest.identity);
    const controller = new AbortController();
    const identity = {};
    cursorRequestRef.current = { identity, controller };
    setPagingState("loading");
    try {
      const page = await retryActiveSnapshotRequest({
        request: () => client.getEvents(runId, { limit: pageLimit, cursor }, controller.signal),
        signal: controller.signal,
        onRetryableFailure: () => markRetrying(identity)
      });
      if (controller.signal.aborted || cursorRequestRef.current?.identity !== identity) return;
      commitPage(page, { direction, cursor });
      cursorRequestRef.current = null;
      clearRetrying(identity);
      setPagingState("idle");
    } catch {
      if (!controller.signal.aborted && cursorRequestRef.current?.identity === identity) {
        cursorRequestRef.current = null;
        clearRetrying(identity);
        setPagingState("error");
      }
    }
  }, [clearRetrying, client, commitPage, markRetrying, runId]);

  const cursors = useMemo(() => trajectoryPageCursors(
    pages,
    entries.map(({ request }) => request)
  ), [entries, pages]);
  const loadedEventCount = events.length;
  const totalEventCount = run?.totalEventCount ?? null;
  const hasCanonicalBounds = totalEventCount !== null && (totalEventCount === 0
    ? loadedEventCount === 0
    : events[0]?.sequence === 0 && events.at(-1)?.sequence === totalEventCount - 1);
  const isComplete = totalEventCount !== null &&
    loadedEventCount === totalEventCount &&
    !hasCanonicalGap(events) &&
    hasCanonicalBounds &&
    cursors.earlier === null &&
    cursors.later === null;

  useEffect(() => {
    const initialPage = entries[0]?.page;
    if (state !== "ready" || run === null || entries.length !== 1 || initialPage === undefined) return;
    const attempted = autoFillAttemptRef.current;
    if (attempted?.runId === runId && attempted.initialPage === initialPage) return;
    const remaining = run.totalEventCount - loadedEventCount;
    const laterCursor = cursors.later;
    if (!run.terminal || remaining < 1 || remaining > pageLimit || laterCursor === null) return;
    autoFillAttemptRef.current = { runId, initialPage };
    void loadCursor("later", laterCursor);
  }, [cursors.later, entries, loadedEventCount, loadCursor, run, runId, state]);

  return {
    events,
    loadedEventCount,
    totalEventCount,
    isComplete,
    state,
    error,
    retrying,
    selectionState,
    pagingState,
    liveAppend: liveAppend.runId === runId
      ? liveAppend
      : { runId, revision: 0, identities: [] },
    appendPage,
    hasEarlier: cursors.earlier !== null && pagingState !== "loading",
    hasLater: cursors.later !== null && pagingState !== "loading",
    loadEarlier: cursors.earlier === null ? null : () => loadCursor("earlier", cursors.earlier!),
    loadLater: cursors.later === null ? null : () => loadCursor("later", cursors.later!)
  } as const;
}
