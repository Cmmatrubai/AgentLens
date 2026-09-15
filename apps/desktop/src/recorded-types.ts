import type {
  InsightConfigureInput,
  InsightGenerateInput,
  InsightReviewSupportInput,
  InsightResponse,
} from "./insight-types";

export type RecordedEvent = {
  id: string;
  sequence: number;
  kind: string;
  status: string;
  provenance: string;
  receivedAt: number | string;
  summary: string;
  command: string;
  output: string;
  outputState: "available" | "unavailable" | "truncated";
  exitCode: number | null;
  message: string;
  files: { path: string; kind: string }[];
  testOutcome: "pass" | "fail" | "unknown" | null;
  testAttribution: string | null;
  artifactId: string | null;
  relationships: { type: string; eventId: string }[];
};
export type RecordedRun = {
  schemaVersion: 1;
  id: string;
  title: string;
  label: string;
  provider: string;
  agentVersion: string;
  model: string | null;
  status: string;
  startedAt: number;
  endedAt: number | null;
  fetchedAt: number;
  readerRevision: string;
  capturePolicy: string;
  eventCount: number;
  commandCount: number;
  failedCommandCount: number;
  elapsedMs: number | null;
  tokenUsageReason: string;
  tests: {
    total: number;
    passed: number;
    failed: number;
    unknown: number;
    derivation: string | null;
    durability: string | null;
  };
  assessment: {
    verdict: string;
    taskCompleted: string;
    eventId: string | null;
    reviewedAt: number | null;
  };
  events: RecordedEvent[];
  git: {
    state: string;
    artifactId: string | null;
    reason: string | null;
    initialHead: string | null;
    finalHead: string | null;
    files: { path: string; content: string; truncated: boolean }[];
  };
};
export type RecordedResponse =
  { ok: true; run: RecordedRun } | { ok: false; error: string };
declare global {
  interface Window {
    agentlens?: import("./live-types").LiveAPI & {
      readRecordedRun: () => Promise<RecordedResponse>;
      readComparison: () => Promise<
        import("./comparison-types").ComparisonResponse
      >;
      readInsights: () => Promise<InsightResponse>;
      configureInsights: (
        input: InsightConfigureInput,
      ) => Promise<InsightResponse>;
      generateInsights: (
        input: InsightGenerateInput,
      ) => Promise<InsightResponse>;
      reviewInsightSupport: (
        input: InsightReviewSupportInput,
      ) => Promise<InsightResponse>;
      forgetInsightKey: () => Promise<InsightResponse>;
      openInsightPair: (input?: { requireChecks?: boolean }) => Promise<
        { ok: true; cancelled?: boolean } | { ok: false; error: string }
      >;
      useOriginalComparison: () => Promise<
        { ok: true; cancelled?: boolean } | { ok: false; error: string }
      >;
    };
  }
}
