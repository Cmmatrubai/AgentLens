export interface SuccessfulRequestObservation {
  readonly method: string;
  readonly pollGeneration?: number | null;
  readonly requestId: number;
  readonly resourceType: string;
  readonly sequence: number;
  readonly url: string;
}

export interface FailedRequestObservation extends SuccessfulRequestObservation {
  readonly errorText: string;
}

export function canonicalRequestIdentity(input: Readonly<{
  method: string;
  url: string;
}>): string {
  const requested = new URL(input.url);
  return `${input.method.toUpperCase()} ${requested.origin}${requested.pathname}${requested.search}`;
}

export function classifyFailedRequests(
  successful: readonly SuccessfulRequestObservation[],
  failed: readonly FailedRequestObservation[]
): string[] {
  return failed.map((failure) => {
    const identity = canonicalRequestIdentity(failure);
    const matchingPriorSuccesses = successful.filter((candidate) =>
      candidate.resourceType === "fetch" &&
      candidate.requestId !== failure.requestId &&
      candidate.sequence < failure.sequence &&
      canonicalRequestIdentity(candidate) === identity
    );
    const matchingLaterSuccesses = successful.filter((candidate) =>
      candidate.resourceType === "fetch" &&
      candidate.requestId !== failure.requestId &&
      candidate.sequence > failure.sequence &&
      canonicalRequestIdentity(candidate) === identity
    );
    const prior = matchingPriorSuccesses.map(({ requestId, sequence }) =>
      `${requestId}@${sequence}`).join(",") || "none";
    const later = matchingLaterSuccesses.length === 0
      ? ""
      : `; later distinct completions ${matchingLaterSuccesses.map(({ requestId, sequence }) =>
          `${requestId}@${sequence}`).join(",")}`;
    const poll = failure.pollGeneration === undefined || failure.pollGeneration === null
      ? ""
      : ` poll=${failure.pollGeneration}`;
    return `failed request: ${identity} ${failure.errorText} ` +
      `(request ${failure.requestId}@${failure.sequence}${poll}; prior distinct completions ${prior}${later})`;
  });
}
