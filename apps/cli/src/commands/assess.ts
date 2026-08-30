import { randomUUID } from "node:crypto";
import { join } from "node:path";
import {
  ArtifactStore,
  loadOrCreateRedactionKey,
  redactText,
  redactedTextBytes,
  type RedactionAudit
} from "@agentlens/core";
import {
  openDatabase,
  openDatabaseReadOnly,
  RunRepository,
  type AssessmentNoteRef,
  type ExplicitCurrentAssessment
} from "@agentlens/storage";
import type { AssessCommand } from "../args.js";
import { ownerOnlyDatabaseFiles, prepareDataRoot } from "../dataRoot.js";
import { locateReadOnlyDataRoot } from "../readOnlyDataRoot.js";

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

const assessmentVerdicts = new Set(["unreviewed", "success", "partial", "failure"]);
const taskCompletionValues = new Set(["yes", "no", "uncertain"]);
const maximumAssessmentNoteBytes = 16 * 1024;

function validateCommand(command: AssessCommand): void {
  if (command.runId === "") throw new Error("assess requires a run ID.");
  if (!assessmentVerdicts.has(command.verdict)) {
    throw new Error("Invalid assessment verdict.");
  }
  if (!taskCompletionValues.has(command.taskCompleted)) {
    throw new Error("Invalid assessment task-completed value.");
  }
  if (command.verdict === "unreviewed" && command.taskCompleted !== "uncertain") {
    throw new Error("The unreviewed verdict requires task completion uncertain.");
  }
  if (command.note !== undefined &&
      Buffer.byteLength(command.note, "utf8") > maximumAssessmentNoteBytes) {
    throw new Error("Assessment note exceeds the 16 KiB UTF-8 limit.");
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

  const located = await locateReadOnlyDataRoot(command.dataRoot);
  if (located.state === "missing") {
    throw new Error("assess requires an existing AgentLens data root and database.");
  }
  const validationDatabase = openDatabaseReadOnly(located.databasePath);
  try {
    const validationRepository = new RunRepository(validationDatabase, {
      artifactRoot: join(located.dataRoot, "artifacts", "sha256")
    });
    validationRepository.getRunDetail(command.runId).run.capturePolicy;
  } finally {
    validationDatabase.close();
  }

  const databasePath = await prepareDataRoot(located.dataRoot);
  const database = openDatabase(databasePath);
  try {
    const repository = new RunRepository(database, {
      artifactRoot: join(located.dataRoot, "artifacts", "sha256")
    });
    const run = repository.getRunDetail(command.runId).run;
    let note: AssessmentNoteRef = { state: "absent" };
    let noteAudits: readonly RedactionAudit[] = [];

    if (command.note !== undefined && command.note !== "") {
      if (run.capturePolicy === "standard") {
        const key = await loadOrCreateRedactionKey(located.dataRoot);
        const redacted = redactText(command.note, {
          policy: run.capturePolicy,
          key,
          contentClass: "message"
        });
        const artifact = await new ArtifactStore(located.dataRoot).writeRedacted({
          runId: command.runId,
          kind: "assessment-note",
          redactedBytes: redactedTextBytes(redacted),
          mediaType: "text/plain; charset=utf-8"
        });
        note = { state: "artifact", artifact };
        noteAudits = redacted.audits;
      } else {
        note = { state: "omitted", reason: run.capturePolicy };
      }
    }

    const current = await repository.updateAssessment({
      runId: command.runId,
      eventId: randomUUID(),
      receivedAt: new Date(Date.now()).toISOString(),
      verdict: command.verdict,
      taskCompleted: command.taskCompleted,
      note
    }, noteAudits);
    const output = projectAssessment(current);
    (dependencies.stdout ?? process.stdout).write(
      command.json ? `${JSON.stringify(output, null, 2)}\n` : assessmentText(output)
    );
    return output;
  } finally {
    database.close();
    await ownerOnlyDatabaseFiles(databasePath);
  }
}
