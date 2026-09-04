import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentLensClientError } from "../src/api/client.js";
import {
  activeSnapshotRetryDelay,
  isRetryableActiveSnapshotError,
  retryActiveSnapshotRequest
} from "../src/api/activeSnapshotRetry.js";

function retryableSnapshotError(overrides: Partial<ConstructorParameters<typeof AgentLensClientError>[0]> = {}) {
  return new AgentLensClientError({
    code: "active_snapshot_unavailable",
    status: 503,
    retryable: true,
    message: "safe fixture message",
    ...overrides
  });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("active snapshot retry policy", () => {
  it("accepts only the typed retryable active-snapshot refusal", () => {
    expect(isRetryableActiveSnapshotError(retryableSnapshotError())).toBe(true);
    expect(isRetryableActiveSnapshotError(retryableSnapshotError({ status: 500 }))).toBe(false);
    expect(isRetryableActiveSnapshotError(retryableSnapshotError({ retryable: false }))).toBe(false);
    expect(isRetryableActiveSnapshotError(retryableSnapshotError({ code: "authentication_required" }))).toBe(false);
    expect(isRetryableActiveSnapshotError(new Error("active_snapshot_unavailable 503"))).toBe(false);
  });

  it("uses the exact capped retry delay sequence", () => {
    expect([0, 1, 2, 3, 4, 5, 99].map(activeSnapshotRetryDelay)).toEqual([
      250, 500, 1_000, 2_000, 5_000, 5_000, 5_000
    ]);
  });

  it("resolves after one retry without leaving a timer", async () => {
    vi.useFakeTimers();
    const request = vi.fn()
      .mockRejectedValueOnce(retryableSnapshotError())
      .mockResolvedValueOnce("safe snapshot");
    const result = retryActiveSnapshotRequest({ request, signal: new AbortController().signal });

    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(250);

    await expect(result).resolves.toBe("safe snapshot");
    expect(request).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects non-retryable client errors without another request", async () => {
    vi.useFakeTimers();
    const failure = retryableSnapshotError({ code: "invalid_cursor", status: 400 });
    const request = vi.fn().mockRejectedValue(failure);
    const result = retryActiveSnapshotRequest({ request, signal: new AbortController().signal });

    await expect(result).rejects.toBe(failure);
    expect(request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("aborts a pending retry delay without starting another request", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const request = vi.fn().mockRejectedValue(retryableSnapshotError());
    const result = retryActiveSnapshotRequest({ request, signal: controller.signal });

    await vi.advanceTimersByTimeAsync(0);
    expect(request).toHaveBeenCalledTimes(1);
    controller.abort();

    await expect(result).rejects.toMatchObject({ name: "AbortError" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not overlap retry attempts for one request", async () => {
    vi.useFakeTimers();
    let attemptsInFlight = 0;
    let maximumInFlight = 0;
    const request = vi.fn(async () => {
      attemptsInFlight += 1;
      maximumInFlight = Math.max(maximumInFlight, attemptsInFlight);
      attemptsInFlight -= 1;
      if (maximumInFlight === 1 && request.mock.calls.length === 1) throw retryableSnapshotError();
      return "safe snapshot";
    });
    const result = retryActiveSnapshotRequest({ request, signal: new AbortController().signal });

    await vi.advanceTimersByTimeAsync(250);

    await expect(result).resolves.toBe("safe snapshot");
    expect(request).toHaveBeenCalledTimes(2);
    expect(maximumInFlight).toBe(1);
  });
});
