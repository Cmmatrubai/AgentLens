export interface SuccessfulRequestObservation {
  readonly method: string;
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
  let duplicateCancellationConsumed = false;
  return failed.flatMap((failure) => {
    const identity = canonicalRequestIdentity(failure);
    const matchingPriorSuccess = successful.some((candidate) =>
      candidate.resourceType === "fetch" &&
      candidate.sequence < failure.sequence &&
      canonicalRequestIdentity(candidate) === identity
    );
    const expectedCancellation = !duplicateCancellationConsumed &&
      failure.resourceType === "fetch" &&
      failure.errorText === "net::ERR_ABORTED" &&
      matchingPriorSuccess;
    if (expectedCancellation) duplicateCancellationConsumed = true;
    return expectedCancellation ? [] : [`failed request: ${identity} ${failure.errorText}`];
  });
}
