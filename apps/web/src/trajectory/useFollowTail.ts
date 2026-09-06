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
  }>>({ runId: input.runId, revision: 0 });
  const [countState, setCountState] = useState({ runId: input.runId, count: 0 });
  const newEventCount = countState.runId === input.runId ? countState.count : 0;

  useLayoutEffect(() => {
    if (processedRef.current.runId !== input.runId) {
      processedRef.current = { runId: input.runId, revision: 0 };
      followingRef.current = true;
      setCountState({ runId: input.runId, count: 0 });
    }
    if (input.liveAppend.runId !== input.runId ||
        input.liveAppend.revision <= processedRef.current.revision) return;
    const appended = input.liveAppend.identities.length;
    processedRef.current = {
      runId: input.runId,
      revision: input.liveAppend.revision
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
    observeViewport(element: HTMLElement, tail?: Readonly<{ bottomInset: number; nodeEnd: number }>): void {
      const distance = element.scrollHeight - (tail?.bottomInset ?? 0) - element.clientHeight - element.scrollTop;
      // Extra clarification space is scrollable, but is not the execution tail.
      followingRef.current = distance <= tailThresholdPx && element.scrollTop < (tail?.nodeEnd ?? Infinity);
    },
    jumpToLatest(): void {
      followingRef.current = true;
      setCountState({ runId: input.runId, count: 0 });
      onFollowTailRef.current();
    }
  } as const;
}
