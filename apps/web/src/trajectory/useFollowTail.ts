import type { TrajectoryEventV1 } from "@agentlens/api-contract";
import { useLayoutEffect, useRef, useState } from "react";

const tailThresholdPx = 32;

function identity(event: TrajectoryEventV1): string {
  return `${event.eventId}:${event.sequence}`;
}

export function useFollowTail(input: Readonly<{
  events: readonly TrajectoryEventV1[];
  onFollowTail: () => void;
}>) {
  const previousRef = useRef(input.events.map(identity));
  const followingRef = useRef(true);
  const onFollowTailRef = useRef(input.onFollowTail);
  onFollowTailRef.current = input.onFollowTail;
  const [newEventCount, setNewEventCount] = useState(0);
  const signature = input.events.map(identity).join("|");

  useLayoutEffect(() => {
    const previous = new Set(previousRef.current);
    const next = input.events.map(identity);
    const appended = next.filter((eventIdentity) => !previous.has(eventIdentity)).length;
    previousRef.current = next;
    if (appended === 0) return;
    if (followingRef.current) {
      setNewEventCount(0);
      onFollowTailRef.current();
    } else {
      setNewEventCount((current) => current + appended);
    }
  }, [signature]);

  return {
    newEventCount,
    observeViewport(element: HTMLElement): void {
      const distance = element.scrollHeight - element.clientHeight - element.scrollTop;
      followingRef.current = distance <= tailThresholdPx;
    },
    jumpToLatest(): void {
      followingRef.current = true;
      setNewEventCount(0);
      onFollowTailRef.current();
    }
  } as const;
}
