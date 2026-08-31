import { randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";

import {
  ArtifactStore,
  loadOrCreateRedactionKey,
  redactText,
  redactedTextBytes,
  type CompletedArtifact,
  type RedactedBytes,
  type RedactionAudit
} from "@agentlens/core";
import {
  AssessmentConflictError,
  openDatabase,
  openDatabaseReadOnly,
  ReadOnlyDatabaseError,
  RunRepository,
  type AssessmentNoteRef,
  type AssessmentRevisionPrecondition,
  type AssessmentVerdict,
  type ExplicitCurrentAssessment,
  type TaskCompletion
} from "@agentlens/storage";

export { AssessmentConflictError };

const maximumAssessmentNoteBytes = 16 * 1024;

export class AssessmentServiceError extends Error {
  readonly code: "invalid_request" | "run_not_found";

  constructor(code: "invalid_request" | "run_not_found", message?: string) {
    super(message ?? (code === "run_not_found" ? "Run not found." : "Assessment input is invalid."));
    this.name = "AssessmentServiceError";
    this.code = code;
  }
}

export interface AssessmentService {
  assess(input: {
    readonly runId: string;
    readonly verdict: AssessmentVerdict;
    readonly taskCompleted: TaskCompletion;
    readonly note?: string;
    readonly expectedRevision: AssessmentRevisionPrecondition;
  }): Promise<ExplicitCurrentAssessment>;
}

export interface AssessmentNoteContentPipeline {
  loadKey(dataRoot: string): Promise<Buffer>;
  redact(note: string, key: Buffer): Readonly<{
    redactedBytes: RedactedBytes;
    audits: readonly RedactionAudit[];
  }>;
  write(input: Readonly<{
    dataRoot: string;
    runId: string;
    redactedBytes: RedactedBytes;
  }>): Promise<CompletedArtifact>;
}

export interface CreateAssessmentServiceInput {
  readonly dataRoot: string;
  readonly now?: () => Date;
  readonly eventId?: () => string;
  readonly noteContent?: AssessmentNoteContentPipeline;
}

const defaultNoteContent: AssessmentNoteContentPipeline = Object.freeze({
  loadKey: loadOrCreateRedactionKey,
  redact(note: string, key: Buffer) {
    const redacted = redactText(note, {
      policy: "standard",
      key,
      contentClass: "message"
    });
    return Object.freeze({
      redactedBytes: redactedTextBytes(redacted),
      audits: redacted.audits
    });
  },
  write({ dataRoot, runId, redactedBytes }: Readonly<{
    dataRoot: string;
    runId: string;
    redactedBytes: RedactedBytes;
  }>) {
    return new ArtifactStore(dataRoot).writeRedacted({
      runId,
      kind: "assessment-note",
      redactedBytes,
      mediaType: "text/plain; charset=utf-8"
    });
  }
});

function pathError(path: string): Error {
  return new Error(`AgentLens storage path cannot be a symbolic link or non-regular file: ${path}`);
}

async function validateOwnedPath(
  path: string,
  expected: "directory" | "file",
  chmod: number | null
): Promise<boolean> {
  let pathStat;
  try {
    pathStat = await lstat(path);
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw cause;
  }
  if (pathStat.isSymbolicLink() ||
      (expected === "directory" ? !pathStat.isDirectory() : !pathStat.isFile())) {
    throw pathError(path);
  }
  const flags = constants.O_RDONLY | constants.O_NOFOLLOW |
    (expected === "directory" ? constants.O_DIRECTORY : 0);
  const handle = await open(path, flags).catch((cause) => {
    throw new Error(pathError(path).message, { cause });
  });
  try {
    const handleStat = await handle.stat();
    if ((expected === "directory" ? !handleStat.isDirectory() : !handleStat.isFile()) ||
        handleStat.dev !== pathStat.dev || handleStat.ino !== pathStat.ino) {
      throw pathError(path);
    }
    if (chmod !== null) await handle.chmod(chmod);
  } finally {
    await handle.close();
  }
  return true;
}

async function locateExistingDataRoot(requestedDataRoot: string): Promise<{
  dataRoot: string;
  databasePath: string;
}> {
  const dataRoot = resolve(requestedDataRoot);
  const databasePath = join(dataRoot, "agentlens.sqlite");
  const rootExists = await validateOwnedPath(dataRoot, "directory", null);
  if (!rootExists) {
    throw new Error("assess requires an existing AgentLens data root and database.");
  }
  const databaseExists = await validateOwnedPath(databasePath, "file", null);
  const [walExists] = await Promise.all([
    validateOwnedPath(`${databasePath}-wal`, "file", null),
    validateOwnedPath(`${databasePath}-shm`, "file", null)
  ]);
  if (walExists) throw new ReadOnlyDatabaseError("wal_present");
  if (!databaseExists) {
    throw new Error("assess requires an existing AgentLens data root and database.");
  }
  await realpath(dataRoot);
  return { dataRoot, databasePath };
}

async function ownerOnlyDatabaseFiles(databasePath: string): Promise<void> {
  for (const path of [databasePath, `${databasePath}-wal`, `${databasePath}-shm`]) {
    await validateOwnedPath(path, "file", 0o600);
  }
}

function validateRevision(value: unknown): asserts value is AssessmentRevisionPrecondition {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Assessment revision precondition is required.");
  }
  const keys = Object.keys(value).sort();
  const candidate = value as { state?: unknown; currentEventId?: unknown };
  if (candidate.state === "unconditional" && keys.length === 1 && keys[0] === "state") return;
  if (candidate.state === "match" && keys.length === 2 &&
      keys[0] === "currentEventId" && keys[1] === "state" &&
      (candidate.currentEventId === null ||
        (typeof candidate.currentEventId === "string" && candidate.currentEventId.length > 0))) {
    return;
  }
  throw new Error("Assessment revision precondition is invalid.");
}

function validateAssessmentInput(input: unknown): asserts input is Parameters<AssessmentService["assess"]>[0] {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Assessment input must be an object.");
  }
  const candidate = input as Record<string, unknown>;
  if (typeof candidate.runId !== "string" || candidate.runId.length === 0) {
    throw new Error("Assessment run ID must be a non-empty string.");
  }
  if (!(candidate.verdict === "unreviewed" || candidate.verdict === "success" ||
      candidate.verdict === "partial" || candidate.verdict === "failure")) {
    throw new Error("Invalid assessment verdict.");
  }
  if (!(candidate.taskCompleted === "yes" || candidate.taskCompleted === "no" ||
      candidate.taskCompleted === "uncertain")) {
    throw new Error("Invalid assessment task-completed value.");
  }
  if (candidate.note !== undefined && typeof candidate.note !== "string") {
    throw new Error("Assessment note must be a string when provided.");
  }
  if (candidate.verdict === "unreviewed" && candidate.taskCompleted !== "uncertain") {
    throw new Error("The unreviewed verdict requires task completion uncertain.");
  }
  if (typeof candidate.note === "string" &&
      Buffer.byteLength(candidate.note, "utf8") > maximumAssessmentNoteBytes) {
    throw new Error("Assessment note exceeds the 16 KiB UTF-8 limit.");
  }
  validateRevision(candidate.expectedRevision);
}

export function createAssessmentService(
  options: CreateAssessmentServiceInput
): AssessmentService {
  if (typeof options !== "object" || options === null ||
      typeof options.dataRoot !== "string" || options.dataRoot.length === 0) {
    throw new Error("Assessment data root must be a non-empty string.");
  }
  const now = options.now ?? (() => new Date());
  const eventId = options.eventId ?? randomUUID;
  const noteContent = options.noteContent ?? defaultNoteContent;
  const dataRoot = options.dataRoot;

  return Object.freeze({
    async assess(input: Parameters<AssessmentService["assess"]>[0]) {
      validateAssessmentInput(input);
      const located = await locateExistingDataRoot(dataRoot);

      const validationDatabase = openDatabaseReadOnly(located.databasePath);
      try {
        try {
          new RunRepository(validationDatabase, {
            artifactRoot: join(located.dataRoot, "artifacts", "sha256")
          }).getRunDetail(input.runId);
        } catch (error) {
          if (error instanceof Error && /^Run .+ does not exist\.$/.test(error.message)) {
            throw new AssessmentServiceError("run_not_found");
          }
          throw error;
        }
      } finally {
        validationDatabase.close();
      }

      await validateOwnedPath(located.dataRoot, "directory", 0o700);
      await ownerOnlyDatabaseFiles(located.databasePath);
      const database = openDatabase(located.databasePath);
      try {
        const repository = new RunRepository(database, {
          artifactRoot: join(located.dataRoot, "artifacts", "sha256")
        });
        const run = repository.getRunDetail(input.runId).run;
        let note: AssessmentNoteRef = Object.freeze({ state: "absent" });
        let noteAudits: readonly RedactionAudit[] = [];
        if (input.note !== undefined && input.note !== "") {
          if (run.capturePolicy === "standard") {
            const key = await noteContent.loadKey(located.dataRoot);
            const redacted = noteContent.redact(input.note, key);
            if (redacted.redactedBytes.byteLength > maximumAssessmentNoteBytes) {
              throw new AssessmentServiceError(
                "invalid_request",
                "Redacted assessment note exceeds the 16 KiB durable-content limit."
              );
            }
            const artifact = await noteContent.write({
              dataRoot: located.dataRoot,
              runId: input.runId,
              redactedBytes: redacted.redactedBytes
            });
            note = Object.freeze({ state: "artifact", artifact });
            noteAudits = redacted.audits;
          } else {
            note = Object.freeze({ state: "omitted", reason: run.capturePolicy });
          }
        }

        const receivedAt = now();
        if (!(receivedAt instanceof Date) || !Number.isFinite(receivedAt.getTime())) {
          throw new Error("Assessment timestamp is invalid.");
        }
        const nextEventId = eventId();
        if (typeof nextEventId !== "string" || nextEventId.length === 0) {
          throw new Error("Assessment event ID must not be empty.");
        }
        return await repository.updateAssessment({
          runId: input.runId,
          eventId: nextEventId,
          receivedAt: receivedAt.toISOString(),
          verdict: input.verdict,
          taskCompleted: input.taskCompleted,
          note,
          expectedRevision: input.expectedRevision
        }, noteAudits);
      } finally {
        database.close();
        await ownerOnlyDatabaseFiles(located.databasePath);
      }
    }
  });
}
