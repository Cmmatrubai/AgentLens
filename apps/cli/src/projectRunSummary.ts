import { TextDecoder } from "node:util";

import { codexExecCapabilities } from "@agentlens/core";
import {
  summarizeRun,
  type CurrentAssessmentProjection,
  type RunSummary,
  type RunSummaryGitEvidenceInput
} from "@agentlens/derivations";
import type { CurrentAssessment, RunDetail, RunRepository } from "@agentlens/storage";

import { readValidatedArtifact } from "./readArtifact.js";

type SummaryRepository = Pick<RunRepository, "getCurrentAssessment">;

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

function gitEvidence(detail: RunDetail): RunSummaryGitEvidenceInput | null {
  const git = detail.gitEvidence;
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
  detail: RunDetail,
  artifactRoot: string
): Promise<{ count: number; artifactId: string } | null> {
  const reference = detail.gitEvidence?.untrackedMetadata;
  if (reference?.state !== "artifact") return null;
  const artifact = detail.artifacts.find(({ id }) => id === reference.artifactId);
  if (!artifact || artifact.runId !== detail.run.id) {
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

export async function projectRunSummary(
  detail: RunDetail,
  repository: SummaryRepository,
  artifactRoot: string
): Promise<RunSummary> {
  return summarizeRun({
    run: {
      id: detail.run.id,
      provider: detail.run.provider,
      capturePolicy: detail.run.capturePolicy,
      startedAt: detail.run.startedAt,
      endedAt: detail.run.endedAt
    },
    events: detail.events,
    gitEvidence: gitEvidence(detail),
    validatedUntrackedFileCount: await validatedUntrackedFileCount(detail, artifactRoot),
    currentAssessment: currentAssessment(repository.getCurrentAssessment(detail.run.id)),
    providerCapabilities: codexExecCapabilities
  });
}
