import { AgentLensClientError } from "./client.js";

const retryDelaysMs = [250, 500, 1_000, 2_000, 5_000] as const;

function abortError(): DOMException {
  return new DOMException("The operation was aborted.", "AbortError");
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw abortError();
}

function waitForRetryDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(abortError());
      return;
    }
    let settled = false;
    const timer = setTimeout(() => settle(resolve), delayMs);
    const onAbort = (): void => settle(() => reject(abortError()));
    const settle = (complete: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      complete();
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export function isRetryableActiveSnapshotError(error: unknown): error is AgentLensClientError {
  return error instanceof AgentLensClientError &&
    error.status === 503 &&
    error.code === "active_snapshot_unavailable" &&
    error.retryable === true;
}

export function activeSnapshotRetryDelay(attemptIndex: number): number {
  if (!Number.isSafeInteger(attemptIndex) || attemptIndex <= 0) return retryDelaysMs[0];
  return retryDelaysMs[Math.min(attemptIndex, retryDelaysMs.length - 1)]!;
}

export async function retryActiveSnapshotRequest<T>(input: Readonly<{
  request: () => Promise<T>;
  signal: AbortSignal;
  onRetryableFailure?: (error: AgentLensClientError) => void;
}>): Promise<T> {
  let attemptIndex = 0;
  while (true) {
    throwIfAborted(input.signal);
    try {
      const result = await input.request();
      throwIfAborted(input.signal);
      return result;
    } catch (error) {
      if (input.signal.aborted) throw abortError();
      if (!isRetryableActiveSnapshotError(error)) throw error;
      input.onRetryableFailure?.(error);
      await waitForRetryDelay(activeSnapshotRetryDelay(attemptIndex), input.signal);
      attemptIndex += 1;
    }
  }
}
