import { useLayoutEffect, useRef, useState } from "react";

import type { LiveTrajectoryAppend } from "./useTrajectoryPages.js";

const tailThresholdPx = 32;

export function useFollowTail(input: Readonly<{
  runId: string;
  liveAppend: LiveTrajectoryAppend;
  onFollowTail: () => void;
}>) {
  const followingRef = useRef(true);
  const onFollowTailRef = useRef(input.onFollowTail);
  onFollowTailRef.current = input.onFollowTail;
  const processedRef = useRef<Readonly<{
    runId: string;
    revision: number;
    identities: Set<string>;
  }>>({ runId: input.runId, revision: 0, identities: new Set() });
  const [countState, setCountState] = useState({ runId: input.runId, count: 0 });
  const newEventCount = countState.runId === input.runId ? countState.count : 0;

  useLayoutEffect(() => {
    if (processedRef.current.runId !== input.runId) {
      processedRef.current = { runId: input.runId, revision: 0, identities: new Set() };
      followingRef.current = true;
      setCountState({ runId: input.runId, count: 0 });
    }
    if (input.liveAppend.runId !== input.runId ||
        input.liveAppend.revision <= processedRef.current.revision) return;
    const identities = new Set(processedRef.current.identities);
    const appended = input.liveAppend.identities.filter((identity) => {
      if (identities.has(identity)) return false;
      identities.add(identity);
      return true;
    }).length;
    processedRef.current = {
      runId: input.runId,
      revision: input.liveAppend.revision,
      identities
    };
    if (appended === 0) return;
    if (followingRef.current) {
      setCountState({ runId: input.runId, count: 0 });
      onFollowTailRef.current();
    } else {
      setCountState((current) => ({
        runId: input.runId,
        count: current.runId === input.runId ? current.count + appended : appended
      }));
    }
  }, [input.liveAppend, input.runId]);

  return {
    newEventCount,
    observeViewport(element: HTMLElement): void {
      const distance = element.scrollHeight - element.clientHeight - element.scrollTop;
      followingRef.current = distance <= tailThresholdPx;
    },
    jumpToLatest(): void {
      followingRef.current = true;
      setCountState({ runId: input.runId, count: 0 });
      onFollowTailRef.current();
    }
  } as const;
}
