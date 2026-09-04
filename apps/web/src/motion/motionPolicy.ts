import { useEffect, useState } from "react";

export const motionDurations = Object.freeze({
  selectionMs: 150,
  inspectorMs: 180,
  lifecycleMs: 200
});

const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function currentReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(reducedMotionQuery).matches;
}

export function useMotionPolicy() {
  const [reduced, setReduced] = useState(currentReducedMotion);
  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(reducedMotionQuery);
    const update = (): void => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  return {
    reduced,
    selectionDurationMs: reduced ? 0 : motionDurations.selectionMs,
    inspectorDurationMs: reduced ? 0 : motionDurations.inspectorMs,
    lifecycleDurationMs: reduced ? 0 : motionDurations.lifecycleMs,
    selection: { duration: reduced ? 0 : motionDurations.selectionMs / 1_000 },
    inspector: { duration: reduced ? 0 : motionDurations.inspectorMs / 1_000 },
    lifecycle: { duration: reduced ? 0 : motionDurations.lifecycleMs / 1_000 }
  } as const;
}
