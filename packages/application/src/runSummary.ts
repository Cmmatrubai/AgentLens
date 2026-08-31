import { TextDecoder } from "node:util";

import type { AdapterCapabilities, NativeSourceV1, TraceEventV1 } from "@agentlens/core";
import {
  summarizeRun,
  type CurrentAssessmentProjection,
  type RunSummary,
  type RunSummaryGitEvidenceInput
} from "@agentlens/derivations";
import type {
  CurrentAssessment,
  RunDetail,
  RunGitEvidence,
  RunRecord,
  RunRepository,
  StoredArtifact
} from "@agentlens/storage";

import { readValidatedArtifact } from "./artifacts/readValidatedArtifact.js";

export interface ProviderCapabilitiesLookup {
  forProvider(provider: NativeSourceV1["provider"]): AdapterCapabilities;
}

function currentAssessment(
  assessment: CurrentAssessment
): CurrentAssessmentProjection | null {
  if (assessment.state === "projected") return null;
  return {
    currentEventId: assessment.currentEventId,
    verdict: assessment.verdict,
    taskCompleted: assessment.taskCompleted,
    note: { ...assessment.note },
    reviewedAt: assessment.reviewedAt,
    updatedAt: assessment.updatedAt
  };
}

function gitEvidence(git: RunGitEvidence | null): RunSummaryGitEvidenceInput | null {
  if (git === null) return null;
  return {
    trackedFinalDiff: { ...git.trackedFinalDiff },
    untrackedMetadata: { ...git.untrackedMetadata }
  };
}

function parseJson(bytes: Buffer, context: string): unknown {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Error(`${context} has invalid UTF-8.`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error(`${context} is not valid JSON.`);
  }
}

function untrackedEntry(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.path === "string" &&
    (entry.type === "file" ||
      entry.type === "directory" ||
      entry.type === "symlink" ||
      entry.type === "other") &&
    Number.isInteger(entry.size) &&
    (entry.size as number) >= 0;
}

async function validatedUntrackedFileCount(
  runId: string,
  gitEvidence: RunGitEvidence | null,
  artifact: StoredArtifact | null,
  artifactRoot: string
): Promise<{ count: number; artifactId: string } | null> {
  const reference = gitEvidence?.untrackedMetadata;
  if (reference?.state !== "artifact") return null;
  if (!artifact || artifact.id !== reference.artifactId || artifact.runId !== runId) {
    throw new Error("Untracked metadata artifact is unavailable.");
  }
  const read = await readValidatedArtifact(artifact, artifactRoot, {
    expectedKind: "git-untracked-file-metadata",
    expectedMediaType: "application/json",
    requireComplete: true
  });
  const value = parseJson(read.bytes, "Untracked metadata");
  if (!Array.isArray(value) || !value.every(untrackedEntry)) {
    throw new Error("Untracked metadata has an invalid structure.");
  }
  return { count: value.length, artifactId: artifact.id };
}

export async function projectRunSummaryFromEvidence(input: {
  readonly run: RunRecord;
  readonly events: readonly TraceEventV1[];
  readonly gitEvidence: RunGitEvidence | null;
  readonly currentAssessment: CurrentAssessment;
  readonly untrackedMetadataArtifact: StoredArtifact | null;
  readonly artifactRoot: string;
  readonly providerCapabilities: ProviderCapabilitiesLookup;
}): Promise<RunSummary> {
  const {
    run,
    events,
    gitEvidence: storedGitEvidence,
    currentAssessment: storedAssessment,
    untrackedMetadataArtifact,
    artifactRoot,
    providerCapabilities
  } = input;
  return summarizeRun({
    run: {
      id: run.id,
      provider: run.provider,
      capturePolicy: run.capturePolicy,
      startedAt: run.startedAt,
      endedAt: run.endedAt
    },
    events,
    gitEvidence: gitEvidence(storedGitEvidence),
    validatedUntrackedFileCount: await validatedUntrackedFileCount(
      run.id,
      storedGitEvidence,
      untrackedMetadataArtifact,
      artifactRoot
    ),
    currentAssessment: currentAssessment(storedAssessment),
    providerCapabilities: providerCapabilities.forProvider(run.provider)
  });
}

export async function projectRunSummary(input: {
  readonly detail: RunDetail;
  readonly repository: Pick<RunRepository, "getCurrentAssessment">;
  readonly artifactRoot: string;
  readonly providerCapabilities: ProviderCapabilitiesLookup;
}): Promise<RunSummary> {
  const { detail, repository, artifactRoot, providerCapabilities } = input;
  const untrackedReference = detail.gitEvidence?.untrackedMetadata;
  return projectRunSummaryFromEvidence({
    run: detail.run,
    events: detail.events,
    gitEvidence: detail.gitEvidence,
    currentAssessment: repository.getCurrentAssessment(detail.run.id),
    untrackedMetadataArtifact: untrackedReference?.state === "artifact"
      ? detail.artifacts.find(({ id }) => id === untrackedReference.artifactId) ?? null
      : null,
    artifactRoot,
    providerCapabilities
  });
}
