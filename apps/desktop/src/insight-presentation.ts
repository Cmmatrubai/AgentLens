import type { InsightDiagnostics } from "./insight-types";

export function describeInsightFailure(
  error: string | null | undefined,
  diagnostics: InsightDiagnostics | null | undefined,
) {
  if (error !== "provider_incomplete" || diagnostics?.finishReason !== "length")
    return null;
  const noAnswer =
    diagnostics.answerCharacters === 0 &&
    Number.isSafeInteger(diagnostics.reasoningTokens) &&
    (diagnostics.reasoningTokens ?? 0) > 0;
  return {
    title: "Response limit reached",
    description: noAnswer
      ? "The provider reported reasoning tokens but returned no answer text. Review the response limits or reasoning effort before trying again."
      : "The provider reached the response limit before returning a complete analysis. Review the response limits before trying again.",
  };
}

export type AnalysisAction = {
  kind: "settings" | "preview" | "none";
  label: string;
  reason: string;
  canPreviewRetry?: boolean;
};

// Describe only the next reversible step. Sending evidence remains a separate,
// explicit action in the existing preview/consent dialog.
export function describeAnalysisAction(context: {
  state: import("./insight-types").InsightState | "unavailable";
  desktop: boolean;
  eligible: boolean;
  busy: boolean;
  supportRunning: boolean;
  settings: Pick<
    import("./insight-types").InsightSettings,
    "enabled" | "hasKey" | "authMode" | "model"
  >;
  error?: string | null;
}): AnalysisAction {
  if (context.state === "running" || context.supportRunning)
    return {
      kind: "none",
      label: "Analysis in progress",
      reason:
        "Wait for the current analysis or evidence review to finish. You can still explore the recorded work.",
    };
  if (context.busy)
    return {
      kind: "none",
      label: "Please wait",
      reason: "The current operation is finishing.",
    };
  if (!context.desktop)
    return {
      kind: "none",
      label: "Open the desktop app",
      reason:
        "You can read saved results here. Open AgentLens desktop to set up a provider or start a new analysis.",
    };
  if (!context.eligible)
    return {
      kind: "none",
      label: "More evidence needed",
      reason:
        "This comparison needs eligible recordings from both agents before AI analysis can start. You can still inspect the evidence supplied.",
    };
  if (
    !context.settings.enabled ||
    !context.settings.model.trim() ||
    (context.settings.authMode !== "none" && !context.settings.hasKey)
  )
    return {
      kind: "settings",
      label: "Set up AI analysis",
      reason:
        "To run a new analysis, choose a provider and model. Saving settings does not send your evidence.",
    };
  if (context.state === "failed" && context.error === "provider_authentication")
    return {
      kind: "settings",
      label: "Check provider access",
      canPreviewRetry: true,
      reason:
        "Check the key saved for this endpoint before trying again. Your recorded results are still available.",
    };
  if (
    context.state === "failed" &&
    context.error === "provider_unsupported_request"
  )
    return {
      kind: "settings",
      label: "Check provider settings",
      canPreviewRetry: true,
      reason:
        "Check the model and API compatibility options before trying again.",
    };
  return {
    kind: "preview",
    label:
      context.state === "not_analyzed"
        ? "Review evidence for analysis"
        : context.state === "available" || context.state === "no_findings"
          ? "Preview another analysis"
          : context.state === "stale"
            ? "Review updated evidence"
            : "Preview retry",
    reason: context.state === "available"
      ? "Explore the saved findings and their evidence. Preview another analysis when you want a new revision."
      : context.state === "no_findings"
        ? "This does not mean the agents are identical. You can inspect their recorded work or preview another analysis."
        : "Next, review what will be sent and where. Analysis starts only after you confirm in the preview.",
  };
}
