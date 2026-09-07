import type { RecordedRun } from "./recorded-types";
export type IndependentCheck = {
  id: string;
  title: string;
  outcome: "pass" | "fail" | "unknown";
  output: string;
  artifactSha256: string | null;
  command: string;
  durationMs: number | null;
  outputTruncated: boolean;
};
export type RealAttempt = {
  key: string;
  model: string;
  reasoningEffort: string;
  state: string;
  run: RecordedRun | null;
  elapsedMs: number | null;
  checks: IndependentCheck[];
  passed: number;
  failed: number;
  unknown: number;
  snapshotHash: string | null;
  evaluatedAt: number | null;
  eventCount: number;
  controlNotes: string[];
  coverageLimits: string[];
};
export type RealComparison = {
  schemaVersion: 1;
  id: string;
  title: string;
  manifestHash: string;
  baseCommit: string;
  timeoutMs?: number;
  taskPrompt?: string;
  imported?: boolean;
  promptHash: string;
  checkBundleHash?: string;
  attempts: RealAttempt[];
  ready: boolean;
  checks: { id: string; title: string }[];
  startupFailures: { model: string; runId: string; reason: string }[];
  fetchedAt: number;
  review: {
    state: "available" | "unavailable";
    id?: string;
    method?: string;
    findings: ComparisonFinding[];
  };
};
export type FindingSource = {
  id: string;
  kind: "file" | "event" | "check";
  label: string;
  path: string | null;
  identity: string;
  provenance: string;
  command: string;
  exitCode: number | null;
  truncated: boolean;
  sha256: string;
  fromLine: number;
  toLine: number;
  excerpt: string;
  fullSource: string;
};
export type FindingSide = {
  attemptKey: string;
  model: string;
  reasoningEffort: string;
  runId: string;
  observation: string;
  sources: FindingSource[];
};
export type ComparisonFinding = {
  id: string;
  category: string;
  title: string;
  summary: string;
  interpretation: string;
  limitations: string;
  sides: FindingSide[];
};
export type ComparisonResponse =
  { ok: true; comparison: RealComparison } | { ok: false; error: string };
