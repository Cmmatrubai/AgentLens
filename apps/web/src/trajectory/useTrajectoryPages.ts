import type { TrajectoryEventV1, TrajectoryPageV1 } from "@agentlens/api-contract";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { AgentLensApiClient } from "../api/client.js";
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

export function trajectoryPageCursors(
  pages: readonly TrajectoryPageV1[]
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
  return {
    earlier,
    later
  };
}

export function useTrajectoryPages(runId: string, selectedEventId: string | null) {
  const client = useAgentLensApi();
  const [pages, setPages] = useState<readonly TrajectoryPageV1[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<unknown>(null);
  const [selectionState, setSelectionState] = useState<"idle" | "resolving" | "unavailable">("idle");
  const [pagingState, setPagingState] = useState<"idle" | "loading" | "error">("idle");
  const initialRequestRef = useRef<object | null>(null);
  const selectionRequestRef = useRef<object | null>(null);
  const cursorRequestRef = useRef<Readonly<{ identity: object; controller: AbortController }> | null>(null);
  const pagesRef = useRef<readonly TrajectoryPageV1[]>([]);
  const events = useMemo(() => mergeTrajectoryPages(pages), [pages]);

  const commitPage = useCallback((page: TrajectoryPageV1): void => {
    const candidate = [...pagesRef.current, page];
    mergeTrajectoryPages(candidate);
    pagesRef.current = candidate;
    setPages(candidate);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const identity = {};
    initialRequestRef.current = identity;
    cursorRequestRef.current?.controller.abort();
    cursorRequestRef.current = null;
    selectionRequestRef.current = null;
    pagesRef.current = [];
    setPages([]);
    setState("loading");
    setError(null);
    setSelectionState("idle");
    setPagingState("idle");
    void client.getEvents(runId, { limit: pageLimit }, controller.signal).then((page) => {
      if (controller.signal.aborted || initialRequestRef.current !== identity) return;
      commitPage(page);
      setState("ready");
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted && initialRequestRef.current === identity) {
        setError(failure);
        setState("error");
      }
    });
    return () => {
      controller.abort();
      if (initialRequestRef.current === identity) initialRequestRef.current = null;
      cursorRequestRef.current?.controller.abort();
      cursorRequestRef.current = null;
    };
  }, [client, commitPage, runId]);

  useEffect(() => {
    if (state !== "ready" || selectedEventId === null ||
        events.some(({ eventId }) => eventId === selectedEventId)) {
      setSelectionState("idle");
      return;
    }
    const controller = new AbortController();
    const identity = {};
    selectionRequestRef.current = identity;
    setSelectionState("resolving");
    void resolveTrajectorySelection({
      client,
      runId,
      eventId: selectedEventId,
      loadedEvents: events,
      limit: pageLimit,
      signal: controller.signal
    }).then((resolution) => {
      if (controller.signal.aborted || selectionRequestRef.current !== identity) return;
      if (resolution.state === "resolved" && resolution.page !== null) {
        try {
          commitPage(resolution.page);
          setSelectionState("idle");
        } catch (failure) {
          setError(failure);
          setState("error");
        }
      } else if (resolution.state === "unavailable") {
        setSelectionState("unavailable");
      }
    }).catch(() => {
      if (!controller.signal.aborted && selectionRequestRef.current === identity) {
        setSelectionState("unavailable");
      }
    });
    return () => {
      controller.abort();
      if (selectionRequestRef.current === identity) selectionRequestRef.current = null;
    };
  }, [client, commitPage, events, runId, selectedEventId, state]);

  const loadCursor = useCallback(async (cursor: string) => {
    cursorRequestRef.current?.controller.abort();
    const controller = new AbortController();
    const identity = {};
    cursorRequestRef.current = { identity, controller };
    setPagingState("loading");
    try {
      const page = await client.getEvents(runId, { limit: pageLimit, cursor }, controller.signal);
      if (controller.signal.aborted || cursorRequestRef.current?.identity !== identity) return;
      commitPage(page);
      setPagingState("idle");
    } catch {
      if (!controller.signal.aborted && cursorRequestRef.current?.identity === identity) {
        setPagingState("error");
      }
    }
  }, [client, commitPage, runId]);

  const cursors = useMemo(() => trajectoryPageCursors(pages), [pages]);

  return {
    events,
    state,
    error,
    selectionState,
    pagingState,
    hasEarlier: cursors.earlier !== null && pagingState !== "loading",
    hasLater: cursors.later !== null && pagingState !== "loading",
    loadEarlier: cursors.earlier === null ? null : () => loadCursor(cursors.earlier!),
    loadLater: cursors.later === null ? null : () => loadCursor(cursors.later!)
  } as const;
}
