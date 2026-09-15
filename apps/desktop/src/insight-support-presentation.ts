import type { ComparisonFinding } from "./comparison-types";
import type {
  InsightSupport,
  InsightSupportConsent,
  InsightSupportFinding,
  InsightSupportPassage,
} from "./insight-types";

const verdicts = ["supported", "needs_review", "unsupported"];
const nonemptyText = (value: unknown): value is string =>
  typeof value === "string" && !!value.trim();
function validPassage(passage: InsightSupportPassage): boolean {
  return (
    !!passage &&
    (passage.kind === "task_context"
      ? passage.attemptKey === ""
      : nonemptyText(passage.attemptKey)) &&
    nonemptyText(passage.kind) &&
    nonemptyText(passage.label) &&
    nonemptyText(passage.quote) &&
    ((passage.kind === "attempt_facts" || passage.kind === "task_context")
      ? passage.sourceId === null
      : nonemptyText(passage.sourceId))
  );
}

function consistentClaims(result: InsightSupportFinding): boolean {
  if (
    result.issues.some(
      (issue) =>
        issue.passages !== undefined &&
        (!Array.isArray(issue.passages) || !issue.passages.every(validPassage)),
    )
  )
    return false;
  if (result.claims === undefined) return true;
  if (
    !Array.isArray(result.claims) ||
    !result.claims.length ||
    result.claims.some(
      (claim) =>
        !claim ||
        !nonemptyText(claim.unitId) ||
        !nonemptyText(claim.field) ||
        !nonemptyText(claim.text) ||
        !nonemptyText(claim.reason) ||
        !verdicts.includes(claim.verdict) ||
        !Array.isArray(claim.passages) ||
        !claim.passages.every(validPassage),
    )
  )
    return false;
  const verdict = result.claims.some((claim) => claim.verdict === "unsupported")
    ? "unsupported"
    : result.claims.some((claim) => claim.verdict === "needs_review")
      ? "needs_review"
      : "supported";
  return verdict === result.verdict;
}

export function partitionSupportFindings(
  findings: ComparisonFinding[],
  support?: InsightSupport | null,
): {
  reviewed: boolean;
  supported: ComparisonFinding[];
  pending: {
    finding: ComparisonFinding;
    result: InsightSupportFinding | null;
  }[];
} {
  const results = support?.review?.findings ?? [];
  const ids = new Set(findings.map((finding) => finding.id));
  const reviewed =
    support?.state === "available" &&
    results.length === findings.length &&
    new Set(results.map((result) => result.findingId)).size ===
      findings.length &&
    results.every(
      (result) =>
        ids.has(result.findingId) &&
        verdicts.includes(result.verdict) &&
        consistentClaims(result) &&
        (result.verdict === "supported"
          ? result.issues.length === 0
          : result.issues.length > 0),
    );
  if (!reviewed)
    return {
      reviewed: false,
      supported: [],
      pending: findings.map((finding) => ({ finding, result: null })),
    };
  const byId = new Map(results.map((result) => [result.findingId, result]));
  return {
    reviewed: true,
    supported: findings.filter(
      (finding) => byId.get(finding.id)?.verdict === "supported",
    ),
    pending: findings
      .filter((finding) => byId.get(finding.id)?.verdict !== "supported")
      .map((finding) => ({ finding, result: byId.get(finding.id)! })),
  };
}

export function isCurrentSupportConsent(
  snapshot: InsightSupportConsent,
  current: InsightSupportConsent | null,
): boolean {
  return (
    !!current &&
    snapshot.analysisId === current.analysisId &&
    snapshot.inputHash === current.inputHash &&
    snapshot.settingsHash === current.settingsHash &&
    snapshot.reviewKey === current.reviewKey
  );
}
