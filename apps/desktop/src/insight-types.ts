import type { ComparisonFinding, FindingSource } from "./comparison-types";

export type InsightState =
  | "not_analyzed"
  | "running"
  | "available"
  | "no_findings"
  | "insufficient_evidence"
  | "stale"
  | "failed"
  | "interrupted";

export type InsightDiagnostics = {
  finishReason?: string;
  status?: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  reasoningTokens?: number;
  answerCharacters?: number;
};

export type InsightCompletionSettings = {
  reasoningEffort: "default" | "none" | "low" | "medium" | "high" | "max";
  maxOutputTokens: number;
  timeoutSeconds: number;
};

export type InsightSettings = InsightCompletionSettings & {
  provider: "openai-compatible";
  baseUrl: string;
  apiFormat: "responses" | "chat_completions";
  outputFormat: "json_schema" | "json_object" | "prompted_json";
  authMode: "bearer" | "none";
  model: string;
  enabled: boolean;
  hasKey: boolean;
  desktopRequired: boolean;
};

export type InsightCoverage = {
  includedSources: number;
  totalSources: number;
  omittedSources: number;
  characters: number;
  limits: string[];
};

export type InsightPreviewSource = Pick<
  FindingSource,
  "id" | "label" | "path" | "provenance" | "excerpt"
> & { attemptKey: string };

export type RecordedFactBase = {
  id: string;
  inputHash: string;
  attemptKey: string;
  label: string;
  command: string;
  sourceIds: string[];
  truncated: boolean;
  reason: string;
};
export type RecordedFact = RecordedFactBase & (
  | {kind: "independent_check"; checkId: string; outcome: "pass" | "fail" | "unknown"; artifactSha256: string | null; evidenceState: "selected" | "omitted" | "missing"}
  | {kind: "command_exit"; exitCode: number | null; sourceSha256: string}
);
export type RecordedFactLedger = {
  version: string;
  inputHash: string;
  facts: RecordedFact[];
  limits: string[];
};

export type InsightAnalysis = Partial<InsightCompletionSettings> & {
  id: string;
  model: string;
  baseUrl?: string;
  apiFormat?: string;
  outputFormat?: string;
  createdAt: number | null;
  inputHash: string;
  findings: ComparisonFinding[];
  abstentionReason: string;
  usage: Record<string, unknown> | null;
  diagnostics?: InsightDiagnostics | null;
  analyzerVersion: string;
  promptVersion: string;
};

export type InsightHistoryItem = {
  error?: string | null;
  diagnostics?: InsightDiagnostics | null;
  id: string;
  state: string;
  createdAt: number;
  model: string;
};

export type InsightSupportPassage = {
  sourceId: string | null;
  attemptKey: string;
  kind: string;
  label: string;
  quote: string;
};

export type InsightImportFact = {
  id: string;
  sourceId: string;
  sourceSha256: string;
  attemptKey: string;
  path: string;
  imported: string;
  local: string;
  module: string;
  importKind: "type" | "value";
  line: number;
  declaration: string;
};

export type InsightSupportClaim = {
  attemptKey?: string;
  providerAssessment?: {
    verdict: "supported" | "needs_review" | "unsupported";
    reason: string;
  };
  localCheck?: {
    version: string;
    kind: "named_import";
    status: "matched" | "unknown";
    reason: string;
    factIds: string[];
  };
  unitId: string;
  field: string;
  text: string;
  verdict: "supported" | "needs_review" | "unsupported";
  reason: string;
  passages: InsightSupportPassage[];
};

export type InsightSupportFinding = {
  findingId: string;
  verdict: "supported" | "needs_review" | "unsupported";
  reason: string;
  issues: {
    claim: string;
    explanation: string;
    sourceIds: string[];
    passages?: InsightSupportPassage[];
  }[];
  claims?: InsightSupportClaim[];
};

export type InsightSupport = {
  diagnostics?: InsightDiagnostics | null;
  state:
    | "not_reviewed"
    | "running"
    | "available"
    | "failed"
    | "interrupted"
    | "stale";
  reviewKey: string;
  review: {
    id: string;
    createdAt: number | null;
    model: string;
    baseUrl: string;
    version: string;
    promptVersion: string;
    policyVersion?: string;
    importFacts?: { version: string; facts: InsightImportFact[] };
    findings: InsightSupportFinding[];
    usage: Record<string, unknown> | null;
    diagnostics?: InsightDiagnostics | null;
  } | null;
  error: string | null;
};

export type InsightSupportConsent = {
  analysisId: string;
  inputHash: string;
  settingsHash: string;
  reviewKey: string;
};

export type InsightReviewSupportInput = InsightSupportConsent & {
  requestId: string;
  recheck?: boolean;
};

export type InsightReadSuccess = {
  ok: true;
  settingsHash: string;
  settings: InsightSettings;
  input: {
    comparisonId: string;
    hash: string;
    eligible: boolean;
    reason: string;
    coverage: InsightCoverage;
    recordedFacts?: RecordedFactLedger;
    sources: InsightPreviewSource[];
    taskContext?: string;
    attemptFacts?: { attemptKey: string; label: string; text: string }[];
    sourceDetails?: { sourceId: string; label: string; text: string }[];
  };
  state: InsightState;
  analysis: InsightAnalysis | null;
  error: string | null;
  diagnostics?: InsightDiagnostics | null;
  history: InsightHistoryItem[];
  support?: InsightSupport | null;
};

export type InsightResponse = InsightReadSuccess | { ok: false; error: string };

export type InsightConfigureInput = InsightCompletionSettings & {
  baseUrl: string;
  apiFormat: InsightSettings["apiFormat"];
  outputFormat: InsightSettings["outputFormat"];
  authMode: InsightSettings["authMode"];
  model: string;
  enabled: boolean;
  apiKey?: string;
};

export type InsightGenerateInput = {
  settingsHash: string;
  inputHash: string;
  requestId: string;
  regenerate?: boolean;
};
