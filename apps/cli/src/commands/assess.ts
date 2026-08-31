import { createAssessmentService } from "@agentlens/application";
import type { ExplicitCurrentAssessment } from "@agentlens/storage";
import type { AssessCommand } from "../args.js";

interface OutputWriter {
  write(chunk: string | Uint8Array): unknown;
}

export interface AssessJsonOutput {
  readonly schemaVersion: 1;
  readonly runId: string;
  readonly currentEventId: string;
  readonly verdict: ExplicitCurrentAssessment["verdict"];
  readonly taskCompleted: ExplicitCurrentAssessment["taskCompleted"];
  readonly note: ExplicitCurrentAssessment["note"];
  readonly state: "explicit";
  readonly provenance: "human";
  readonly reviewedAt: number;
  readonly updatedAt: number;
}

function validateCommand(command: unknown): asserts command is AssessCommand {
  if (typeof command !== "object" || command === null || Array.isArray(command)) {
    throw new Error("Assessment command must be an object.");
  }
  const candidate = command as Record<string, unknown>;
  if (candidate.name !== "assess") {
    throw new Error("Assessment command name must be assess.");
  }
  if (typeof candidate.dataRoot !== "string" || candidate.dataRoot === "") {
    throw new Error("Assessment data root must be a non-empty string.");
  }
  if (typeof candidate.json !== "boolean") {
    throw new Error("Assessment json flag must be a boolean.");
  }
}

function projectAssessment(assessment: ExplicitCurrentAssessment): AssessJsonOutput {
  return {
    schemaVersion: 1,
    runId: assessment.runId,
    currentEventId: assessment.currentEventId,
    verdict: assessment.verdict,
    taskCompleted: assessment.taskCompleted,
    note: assessment.note,
    state: assessment.state,
    provenance: assessment.provenance,
    reviewedAt: assessment.reviewedAt,
    updatedAt: assessment.updatedAt
  };
}

function assessmentText(assessment: AssessJsonOutput): string {
  return `Assessment ${assessment.runId}: verdict=${assessment.verdict} ` +
    `taskCompleted=${assessment.taskCompleted} state=${assessment.state} ` +
    `provenance=${assessment.provenance} note=${assessment.note.state} ` +
    `currentEventId=${assessment.currentEventId} reviewedAt=${assessment.reviewedAt} ` +
    `updatedAt=${assessment.updatedAt}\n`;
}

export async function runAssessCommand(
  command: AssessCommand,
  dependencies: { readonly stdout?: OutputWriter } = {}
): Promise<AssessJsonOutput> {
  validateCommand(command);

  const current = await createAssessmentService({ dataRoot: command.dataRoot }).assess({
    runId: command.runId,
    verdict: command.verdict,
    taskCompleted: command.taskCompleted,
    ...(command.note === undefined ? {} : { note: command.note }),
    expectedRevision: { state: "unconditional" }
  });
  const output = projectAssessment(current);
  (dependencies.stdout ?? process.stdout).write(
    command.json ? `${JSON.stringify(output, null, 2)}\n` : assessmentText(output)
  );
  return output;
}
