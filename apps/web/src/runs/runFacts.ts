import type { RunListItemV1 } from "@agentlens/api-contract";

export function words(value: string): string {
  return value.replaceAll("_", " ");
}

export function providerText(run: RunListItemV1): string {
  return run.provider.state === "known"
    ? run.provider.value
    : `Unsupported provider: ${run.provider.safeToken}`;
}

export function likelyTestsText(run: RunListItemV1): string {
  const tests = run.summary.likelyTests;
  if (tests.state === "none_detected") return "Test-bearing commands: none detected";
  if (tests.state === "unavailable_due_to_capture_policy") {
    return "Test-bearing commands: unavailable due to capture policy";
  }
  const failures = tests.attempts.previousFailures;
  const attributionUnavailable = tests.derivationId === "test-command/2" && tests.testCommandDetails.some(
    (detail) => detail.outcomeAttribution === "unavailable"
  );
  return `Test-bearing commands: latest ${tests.attempts.latest}, previous failures ${failures}${
    attributionUnavailable ? " · individual test outcome unavailable" : ""
  }`;
}

export function reviewText(run: RunListItemV1, includeProvenance = false): string {
  const assessment = run.summary.assessment;
  if (assessment.state === "projected") {
    return "Not reviewed · projected state · no human evidence";
  }
  return `Reviewer: ${assessment.verdict}${includeProvenance ? " · human evidence" : ""}`;
}

export function durationText(run: RunListItemV1): string | undefined {
  const elapsed = run.summary.elapsedRecorderTimeMs;
  if (elapsed.state === "unavailable") return undefined;
  if (elapsed.value < 1_000) return `${elapsed.value} ms`;
  return `${(elapsed.value / 1_000).toFixed(elapsed.value % 1_000 === 0 ? 0 : 1)} s`;
}
