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

export type InsightSettings = {
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

export type InsightAnalysis = {
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
  analyzerVersion: string;
  promptVersion: string;
};

export type InsightHistoryItem = {
  id: string;
  state: string;
  createdAt: number;
  model: string;
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
    sources: InsightPreviewSource[];
  };
  state: InsightState;
  analysis: InsightAnalysis | null;
  error: string | null;
  history: InsightHistoryItem[];
};

export type InsightResponse = InsightReadSuccess | { ok: false; error: string };

export type InsightConfigureInput = {
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
