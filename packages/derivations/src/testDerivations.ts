import { createHash } from "node:crypto";

import type {
  BuildTestDerivationDraftsInput,
  DerivationIdentityInput,
  TestCommandDerivationDraft,
  TestDerivationMetadata,
  TestDerivedKind,
  TestResultDerivationDraft,
  TestResultOutcome
} from "./types.js";

const DERIVATION_NAME = "test-command";
const DERIVATION_VERSION = "1";
const DERIVATION_ID = "test-command/1";
const IDENTITY_PREFIX = "agentlens-derivation-sha256:";

export function derivationIdentity(input: DerivationIdentityInput): string {
  const digest = createHash("sha256");
  for (const value of [
    input.runId,
    input.sourceEventId,
    input.name,
    input.version,
    input.derivedKind
  ]) {
    const bytes = Buffer.from(value, "utf8");
    digest.update(`${bytes.byteLength}:`, "utf8");
    digest.update(bytes);
  }
  return `${IDENTITY_PREFIX}${digest.digest("hex")}`;
}

function identityFor(
  input: BuildTestDerivationDraftsInput,
  derivedKind: TestDerivedKind
): string {
  return derivationIdentity({
    runId: input.runId,
    sourceEventId: input.sourceEventId,
    name: DERIVATION_NAME,
    version: DERIVATION_VERSION,
    derivedKind
  });
}

function eventIdFor(identity: string): string {
  return `drv_${identity.slice(IDENTITY_PREFIX.length)}`;
}

function derivationFor(
  input: BuildTestDerivationDraftsInput,
  identity: string
): TestDerivationMetadata {
  return {
    name: DERIVATION_NAME,
    version: DERIVATION_VERSION,
    sourceEventIds: [input.sourceEventId],
    confidence: input.classification.confidence,
    identity
  };
}

function outcomeFor(
  input: BuildTestDerivationDraftsInput
): Readonly<{ status: "completed" | "failed" | "unknown"; outcome: TestResultOutcome }> {
  if (input.exitCode === 0) return { status: "completed", outcome: "passed" };
  if (input.exitCode !== null || input.eventStatus === "failed") {
    return { status: "failed", outcome: "failed" };
  }
  return { status: "unknown", outcome: "unknown" };
}

export function buildTestDerivationDrafts(
  input: BuildTestDerivationDraftsInput
): readonly [TestCommandDerivationDraft, TestResultDerivationDraft] {
  const commandIdentity = identityFor(input, "test.command");
  const resultIdentity = identityFor(input, "test.result");
  const result = outcomeFor(input);

  const commandDraft: TestCommandDerivationDraft = {
    id: eventIdFor(commandIdentity),
    runId: input.runId,
    kind: "test.command",
    status: input.eventStatus,
    provenance: "derived",
    source: { provider: input.sourceProvider },
    relationships: [{ type: "derived_from", eventId: input.sourceEventId }],
    summary: `Likely ${input.classification.family} test command (${input.classification.confidence} confidence)`,
    normalizedPayload: {
      family: input.classification.family,
      confidence: input.classification.confidence,
      derivationId: DERIVATION_ID
    },
    derivation: derivationFor(input, commandIdentity)
  };
  const resultDraft: TestResultDerivationDraft = {
    id: eventIdFor(resultIdentity),
    runId: input.runId,
    kind: "test.result",
    status: result.status,
    provenance: "derived",
    source: { provider: input.sourceProvider },
    relationships: [{ type: "derived_from", eventId: input.sourceEventId }],
    summary: `Likely ${input.classification.family} test result: ${result.outcome} (${input.classification.confidence} confidence)`,
    normalizedPayload: {
      family: input.classification.family,
      confidence: input.classification.confidence,
      outcome: result.outcome,
      ...(input.exitCode === null ? {} : { exitCode: input.exitCode }),
      derivationId: DERIVATION_ID
    },
    derivation: derivationFor(input, resultIdentity)
  };
  return [commandDraft, resultDraft];
}
