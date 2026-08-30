import { TextDecoder } from "node:util";
import { join } from "node:path";
import {
  openDatabaseReadOnly,
  RunRepository,
  type CurrentAssessment,
  type RunDetail
} from "@agentlens/storage";
import type { InspectCommand } from "../args.js";
import { diagnoseOwnership } from "../diagnoseOwnership.js";
import {
  inspectJson,
  inspectText,
  type ReviewerNoteDto
} from "../format.js";
import {
  systemProcessIdentityInspector,
  type ProcessIdentityInspector
} from "../processIdentity.js";
import { projectRunSummary } from "../projectRunSummary.js";
import { readValidatedArtifact } from "../readArtifact.js";
import { locateReadOnlyDataRoot } from "../readOnlyDataRoot.js";

interface OutputWriter {
  write(chunk: string | Uint8Array): unknown;
}

function runNotFound(runId: string): Error {
  return new Error(`AgentLens run not found: ${runId}.`);
}

function getRunDetail(repository: RunRepository, runId: string): RunDetail {
  try {
    return repository.getRunDetail(runId);
  } catch (error) {
    if (error instanceof Error && /does not exist|not found/i.test(error.message)) {
      throw runNotFound(runId);
    }
    throw error;
  }
}

async function reviewerNote(
  detail: RunDetail,
  assessment: CurrentAssessment,
  artifactRoot: string
): Promise<ReviewerNoteDto> {
  if (assessment.state === "projected") {
    return { state: "absent", contentAvailable: false };
  }
  const note = assessment.note;
  if (note.state === "absent") {
    return { state: "absent", contentAvailable: false };
  }
  if (note.state === "omitted") {
    return {
      state: "omitted",
      contentAvailable: false,
      reason: note.reason
    };
  }
  if (detail.run.capturePolicy !== "standard") {
    throw new Error("Reviewer note artifact is invalid for restrictive capture.");
  }
  const artifact = detail.artifacts.find(({ id }) => id === note.artifactId);
  if (!artifact || artifact.runId !== detail.run.id) {
    throw new Error("Reviewer note artifact is unavailable.");
  }
  const read = await readValidatedArtifact(artifact, artifactRoot, {
    expectedKind: "assessment-note",
    expectedMediaType: "text/plain; charset=utf-8",
    requireComplete: true
  });
  let content: string;
  try {
    content = new TextDecoder("utf-8", { fatal: true }).decode(read.bytes);
  } catch {
    throw new Error("Reviewer note artifact has invalid UTF-8.");
  }
  return {
    state: "artifact",
    artifactId: artifact.id,
    contentAvailable: true,
    content
  };
}

export async function runInspectCommand(
  command: InspectCommand,
  dependencies: {
    readonly stdout?: OutputWriter;
    readonly cwd?: string;
    readonly processIdentityInspector?: ProcessIdentityInspector;
  } = {}
): Promise<Awaited<ReturnType<typeof inspectJson>>> {
  const located = await locateReadOnlyDataRoot(command.dataRoot);
  if (located.state === "missing") throw runNotFound(command.runId);
  const database = openDatabaseReadOnly(located.databasePath);
  try {
    const artifactRoot = join(located.dataRoot, "artifacts", "sha256");
    const repository = new RunRepository(database, {
      artifactRoot
    });
    const detail = getRunDetail(repository, command.runId);
    const assessment = repository.getCurrentAssessment(command.runId);
    const projection = {
      summary: await projectRunSummary(detail, repository, artifactRoot),
      ownership: await diagnoseOwnership(
        detail.run,
        detail.ownership,
        dependencies.processIdentityInspector ?? systemProcessIdentityInspector
      ),
      reviewerNote: await reviewerNote(detail, assessment, artifactRoot)
    };
    const value = await inspectJson(detail, command.native, artifactRoot, projection);
    (dependencies.stdout ?? process.stdout).write(
      command.json
        ? `${JSON.stringify(value, null, 2)}\n`
        : inspectText(detail, value.events, projection)
    );
    return value;
  } finally {
    database.close();
  }
}
