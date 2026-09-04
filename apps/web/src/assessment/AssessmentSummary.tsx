import type { CurrentAssessmentV1 } from "@agentlens/api-contract";

export function AssessmentSummary({ assessment }: Readonly<{ assessment: CurrentAssessmentV1 }>) {
  if (assessment.state === "projected") {
    return <span>Not reviewed · projected state · no human evidence</span>;
  }
  const reviewedAt = new Date(assessment.reviewedAt).toISOString();
  return (
    <span className="assessment-summary">
      <span>Reviewer: {assessment.verdict} · human evidence</span>
      <span className="assessment-summary__time">
        Reviewed at <time dateTime={reviewedAt}>{reviewedAt}</time>
      </span>
    </span>
  );
}
