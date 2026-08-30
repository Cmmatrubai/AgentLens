import type { EventStatus, NativeSourceV1 } from "@agentlens/core";

export type CommandEvidence =
  | Readonly<{ state: "available"; redactedCommand: string }>
  | Readonly<{
      state: "omitted";
      reason: "metadata-only" | "strict" | "capture-bound";
    }>;

export interface ObservedCommand {
  readonly command: string;
  readonly exitCode: number | null;
  readonly eventStatus: EventStatus;
}

export interface TestCommandClassification {
  readonly family:
    | "pytest"
    | "jest"
    | "vitest"
    | "npm"
    | "pnpm"
    | "yarn"
    | "cargo"
    | "go"
    | "maven"
    | "gradle";
  readonly confidence: "high" | "medium";
  readonly derivationVersion: "test-command/1";
}

export type TestDerivedKind = "test.command" | "test.result";

export type TestResultOutcome = "passed" | "failed" | "unknown";

export interface DerivationIdentityInput {
  readonly runId: string;
  readonly sourceEventId: string;
  readonly name: "test-command";
  readonly version: "1";
  readonly derivedKind: TestDerivedKind;
}

export interface BuildTestDerivationDraftsInput {
  readonly runId: string;
  readonly sourceEventId: string;
  readonly sourceProvider: NativeSourceV1["provider"];
  readonly eventStatus: Extract<EventStatus, "completed" | "failed">;
  readonly exitCode: number | null;
  readonly classification: TestCommandClassification;
}

export interface TestDerivationMetadata {
  readonly name: "test-command";
  readonly version: "1";
  readonly sourceEventIds: readonly [string];
  readonly confidence: "high" | "medium";
  readonly identity: string;
}

interface TestDerivationDraftBase {
  readonly id: string;
  readonly runId: string;
  readonly status: EventStatus;
  readonly provenance: "derived";
  readonly source: Readonly<{ provider: NativeSourceV1["provider"] }>;
  readonly relationships: readonly [
    Readonly<{ type: "derived_from"; eventId: string }>
  ];
  readonly summary: string;
  readonly derivation: TestDerivationMetadata;
}

export interface TestCommandDerivationDraft extends TestDerivationDraftBase {
  readonly kind: "test.command";
  readonly normalizedPayload: Readonly<{
    family: TestCommandClassification["family"];
    confidence: TestCommandClassification["confidence"];
    derivationId: "test-command/1";
  }>;
}

export interface TestResultDerivationDraft extends TestDerivationDraftBase {
  readonly kind: "test.result";
  readonly normalizedPayload: Readonly<{
    family: TestCommandClassification["family"];
    confidence: TestCommandClassification["confidence"];
    outcome: TestResultOutcome;
    exitCode?: number;
    derivationId: "test-command/1";
  }>;
}

export type TestDerivationDraft =
  | TestCommandDerivationDraft
  | TestResultDerivationDraft;
