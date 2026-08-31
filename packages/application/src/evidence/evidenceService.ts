import { TextDecoder } from "node:util";

import {
  assessmentNoteContentV1Schema,
  gitDiffCheckContentV1Schema,
  gitStatusContentV1Schema,
  gitUntrackedContentV1Schema,
  nativeContentResponseV1Schema,
  type AssessmentNoteContentV1,
  type GitDiffCheckContentV1,
  type GitDiffContentV1,
  type GitStatusContentV1,
  type GitUntrackedContentV1,
  type NativeContentResponseV1,
  type NormalizedContentResponseV1
} from "@agentlens/api-contract";
import {
  RunRepository,
  ServerReadDatabaseError,
  openDatabaseForServerRead,
  withServerReadSnapshot,
  type StoredArtifact,
  type StoredGitEvidence,
  type StoredOptionalGitEvidenceRef,
  type StoredRequiredGitEvidenceRef
} from "@agentlens/storage";

import { readValidatedArtifact } from "../artifacts/readValidatedArtifact.js";
import { projectEventContent } from "./contentProjector.js";
import { parseGitDiff } from "./gitDiffParser.js";

const LIMITS = Object.freeze({
  content: 256 * 1024,
  native: 256 * 1024,
  note: 16 * 1024,
  diff: 2 * 1024 * 1024,
  status: 256 * 1024,
  diffCheck: 256 * 1024,
  untracked: 512 * 1024
});
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const EXCLUSION_STATUS = /^\[\[EXCLUDED:[a-z0-9._-]{1,128}\]\]$/;
const GIT_STATUS_KINDS = new Set(["git-initial-status", "git-final-status"]);

export type EvidenceServiceErrorCode =
  | "invalid_request"
  | "run_not_found"
  | "event_not_found"
  | "content_unavailable"
  | "evidence_binding_mismatch"
  | "active_snapshot_unavailable";

export class EvidenceServiceError extends Error {
  readonly code: EvidenceServiceErrorCode;

  constructor(code: EvidenceServiceErrorCode) {
    super(code);
    this.name = "EvidenceServiceError";
    this.code = code;
  }
}

export interface EvidenceService {
  eventContent(runId: string, eventId: string): Promise<NormalizedContentResponseV1>;
  eventNative(runId: string, eventId: string): Promise<NativeContentResponseV1>;
  assessmentNote(runId: string, eventId: string): Promise<AssessmentNoteContentV1>;
  gitDiff(runId: string): Promise<GitDiffContentV1>;
  gitStatus(runId: string, phase: "initial" | "final"): Promise<GitStatusContentV1>;
  gitDiffCheck(runId: string): Promise<GitDiffCheckContentV1>;
  gitUntracked(runId: string): Promise<GitUntrackedContentV1>;
}

export interface CreateEvidenceServiceInput {
  readonly databasePath: string;
  readonly artifactRoot: string;
}

function validId(value: string): boolean {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);
}

function responseWithin(value: object, maximum: number): void {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > maximum) {
    throw new EvidenceServiceError("evidence_binding_mismatch");
  }
}

function decodeUtf8(bytes: Buffer): string {
  try {
    return UTF8.decode(bytes);
  } catch {
    throw new EvidenceServiceError("evidence_binding_mismatch");
  }
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new EvidenceServiceError("evidence_binding_mismatch");
  }
}

async function artifactBytes(
  artifact: StoredArtifact,
  artifactRoot: string,
  options: Readonly<{
    maximum: number;
    expectedKind: string;
    expectedMediaType: string;
    requireComplete: boolean;
  }>
) {
  if (artifact.byteLength > options.maximum) {
    throw new EvidenceServiceError("evidence_binding_mismatch");
  }
  try {
    return await readValidatedArtifact(artifact, artifactRoot, {
      expectedKind: options.expectedKind,
      expectedMediaType: options.expectedMediaType,
      requireComplete: options.requireComplete,
      requireOwnerOnly: true
    });
  } catch {
    throw new EvidenceServiceError("evidence_binding_mismatch");
  }
}

function requireRun(repository: RunRepository, runId: string) {
  const run = repository.getRun(runId);
  if (run === null) throw new EvidenceServiceError("run_not_found");
  return run;
}

function requireGit(repository: RunRepository, runId: string): StoredGitEvidence {
  const run = requireRun(repository, runId);
  if (run.capturePolicy !== "standard") throw new EvidenceServiceError("content_unavailable");
  const git = repository.getRunReadModel(runId)?.summary.gitEvidence ?? null;
  if (git === null) throw new EvidenceServiceError("content_unavailable");
  return git;
}

function artifactReference(
  reference: StoredRequiredGitEvidenceRef | StoredOptionalGitEvidenceRef
): string {
  if (reference.state !== "artifact") throw new EvidenceServiceError("content_unavailable");
  return reference.artifactId;
}

function boundArtifact(repository: RunRepository, runId: string, artifactId: string): StoredArtifact {
  const artifact = repository.getArtifactForRun(runId, artifactId);
  if (artifact === null) throw new EvidenceServiceError("evidence_binding_mismatch");
  return artifact;
}

function parseStatus(text: string): GitStatusContentV1 {
  const pathAfterSpaces = (line: string, count: number): string => {
    let remaining = count;
    for (let index = 0; index < line.length; index += 1) {
      if (line[index] !== " ") continue;
      remaining -= 1;
      if (remaining === 0 && index + 1 < line.length) return line.slice(index + 1);
    }
    throw new EvidenceServiceError("evidence_binding_mismatch");
  };
  const entries = text.length === 0 ? [] : text.split("\n").filter(Boolean).map((line) => {
    if (EXCLUSION_STATUS.test(line)) return { code: "excluded", path: line };
    if (line === "[[UNSUPPORTED_GIT_STATUS_RECORD]]") {
      return { code: "unsupported", path: line };
    }
    if (line.startsWith("? ") || line.startsWith("! ")) {
      return { code: line[0] === "?" ? "??" : "!!", path: line.slice(2) };
    }
    const structured = /^(1|2|u) ([^ ]{2}) /.exec(line);
    if (structured === null) throw new EvidenceServiceError("evidence_binding_mismatch");
    const fieldCount = structured[1] === "1" ? 8 : structured[1] === "2" ? 9 : 10;
    return { code: structured[2]!, path: pathAfterSpaces(line, fieldCount) };
  });
  try {
    return gitStatusContentV1Schema.parse({ schemaVersion: 1, kind: "status", entries });
  } catch {
    throw new EvidenceServiceError("evidence_binding_mismatch");
  }
}

function parseDiffCheck(text: string, expectedPassed: boolean): GitDiffCheckContentV1 {
  const value = parseJson(text);
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new EvidenceServiceError("evidence_binding_mismatch");
  }
  const record = value as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "output,passed" ||
      typeof record.passed !== "boolean" || typeof record.output !== "string" ||
      record.passed !== expectedPassed) {
    throw new EvidenceServiceError("evidence_binding_mismatch");
  }
  try {
    return gitDiffCheckContentV1Schema.parse({
      schemaVersion: 1, kind: "diff_check", passed: record.passed, output: record.output
    });
  } catch {
    throw new EvidenceServiceError("evidence_binding_mismatch");
  }
}

function parseUntracked(text: string): GitUntrackedContentV1 {
  const value = parseJson(text);
  try {
    return gitUntrackedContentV1Schema.parse({
      schemaVersion: 1,
      kind: "untracked",
      entries: value
    });
  } catch {
    throw new EvidenceServiceError("evidence_binding_mismatch");
  }
}

export function createEvidenceService(input: CreateEvidenceServiceInput): EvidenceService {
  async function read<T>(operation: (repository: RunRepository) => Promise<T> | T): Promise<T> {
    let opened: ReturnType<typeof openDatabaseForServerRead> | undefined;
    try {
      opened = openDatabaseForServerRead(input.databasePath);
      const repository = new RunRepository(opened.database, { artifactRoot: input.artifactRoot });
      return await withServerReadSnapshot(opened.database, () => operation(repository));
    } catch (error) {
      if (error instanceof EvidenceServiceError) throw error;
      if (error instanceof ServerReadDatabaseError) {
        throw new EvidenceServiceError("active_snapshot_unavailable");
      }
      throw error;
    } finally {
      opened?.database.close();
    }
  }

  function ids(runId: string, eventId?: string): void {
    if (!validId(runId) || (eventId !== undefined && !validId(eventId))) {
      throw new EvidenceServiceError("invalid_request");
    }
  }

  return Object.freeze({
    async eventContent(runId: string, eventId: string) {
      ids(runId, eventId);
      return read((repository) => {
        const run = requireRun(repository, runId);
        if (run.capturePolicy !== "standard") throw new EvidenceServiceError("content_unavailable");
        let event;
        try {
          event = repository.getEvent(runId, eventId);
        } catch {
          throw new EvidenceServiceError("content_unavailable");
        }
        if (event === null) throw new EvidenceServiceError("event_not_found");
        let value;
        try {
          value = projectEventContent(event, run.capturePolicy);
        } catch {
          throw new EvidenceServiceError("content_unavailable");
        }
        if (value === null) throw new EvidenceServiceError("content_unavailable");
        responseWithin(value, LIMITS.content);
        return value;
      });
    },

    async eventNative(runId: string, eventId: string) {
      ids(runId, eventId);
      return read(async (repository) => {
        const run = requireRun(repository, runId);
        if (run.capturePolicy !== "standard") throw new EvidenceServiceError("content_unavailable");
        const event = repository.getEvent(runId, eventId);
        if (event === null) throw new EvidenceServiceError("event_not_found");
        if (event.provenance !== "observed") {
          throw new EvidenceServiceError("content_unavailable");
        }
        const native = event.nativePayload;
        if (native === undefined || native.storage === "omitted") {
          throw new EvidenceServiceError("content_unavailable");
        }
        let text: string;
        let truncated = false;
        if (native.storage === "inline") {
          text = JSON.stringify(native.redacted);
          if (Buffer.byteLength(text, "utf8") > LIMITS.native) {
            throw new EvidenceServiceError("evidence_binding_mismatch");
          }
        } else {
          const artifact = boundArtifact(repository, runId, native.artifactId);
          const value = await artifactBytes(artifact, input.artifactRoot, {
            maximum: LIMITS.native,
            expectedKind: "native-payload",
            expectedMediaType: "application/json",
            requireComplete: false
          });
          text = decodeUtf8(value.bytes);
          parseJson(text);
          truncated = value.truncated;
        }
        const value = nativeContentResponseV1Schema.parse({
          schemaVersion: 1,
          eventId,
          content: { format: "json", text, truncated }
        });
        responseWithin(value, LIMITS.native);
        return value;
      });
    },

    async assessmentNote(runId: string, eventId: string) {
      ids(runId, eventId);
      return read(async (repository) => {
        const run = requireRun(repository, runId);
        if (run.capturePolicy !== "standard") throw new EvidenceServiceError("content_unavailable");
        const event = repository.getEvent(runId, eventId);
        if (event === null) throw new EvidenceServiceError("event_not_found");
        const binding = repository.getEventArtifactBinding(runId, eventId, "assessment_note");
        if (binding === null) throw new EvidenceServiceError("evidence_binding_mismatch");
        const artifact = await artifactBytes(binding.artifact, input.artifactRoot, {
          maximum: LIMITS.note,
          expectedKind: "assessment-note",
          expectedMediaType: "text/plain; charset=utf-8",
          requireComplete: true
        });
        const value = assessmentNoteContentV1Schema.parse({
          schemaVersion: 1, eventId, content: decodeUtf8(artifact.bytes)
        });
        responseWithin(value, LIMITS.note);
        return value;
      });
    },

    async gitDiff(runId: string) {
      ids(runId);
      return read(async (repository) => {
        const git = requireGit(repository, runId);
        const artifact = boundArtifact(repository, runId, artifactReference(git.trackedFinalDiff));
        const readResult = await artifactBytes(artifact, input.artifactRoot, {
          maximum: LIMITS.diff,
          expectedKind: "git-tracked-final-diff",
          expectedMediaType: "text/x-diff",
          requireComplete: false
        });
        let value: GitDiffContentV1;
        try {
          value = parseGitDiff(decodeUtf8(readResult.bytes), readResult.truncated);
        } catch {
          throw new EvidenceServiceError("evidence_binding_mismatch");
        }
        responseWithin(value, LIMITS.diff);
        return value;
      });
    },

    async gitStatus(runId: string, phase: "initial" | "final") {
      ids(runId);
      if (phase !== "initial" && phase !== "final") throw new EvidenceServiceError("invalid_request");
      return read(async (repository) => {
        const git = requireGit(repository, runId);
        const reference = phase === "initial" ? git.initialStatus : git.finalStatus;
        const artifact = boundArtifact(repository, runId, artifactReference(reference));
        if (!GIT_STATUS_KINDS.has(artifact.kind)) {
          throw new EvidenceServiceError("evidence_binding_mismatch");
        }
        const readResult = await artifactBytes(artifact, input.artifactRoot, {
          maximum: LIMITS.status,
          expectedKind: artifact.kind,
          expectedMediaType: "text/plain",
          requireComplete: true
        });
        const value = parseStatus(decodeUtf8(readResult.bytes));
        responseWithin(value, LIMITS.status);
        return value;
      });
    },

    async gitDiffCheck(runId: string) {
      ids(runId);
      return read(async (repository) => {
        const git = requireGit(repository, runId);
        const artifact = boundArtifact(repository, runId, artifactReference(git.diffCheck));
        const readResult = await artifactBytes(artifact, input.artifactRoot, {
          maximum: LIMITS.diffCheck,
          expectedKind: "git-diff-check",
          expectedMediaType: "application/json",
          requireComplete: true
        });
        const value = parseDiffCheck(decodeUtf8(readResult.bytes), git.diffCheckPassed);
        responseWithin(value, LIMITS.diffCheck);
        return value;
      });
    },

    async gitUntracked(runId: string) {
      ids(runId);
      return read(async (repository) => {
        const git = requireGit(repository, runId);
        const artifact = boundArtifact(repository, runId, artifactReference(git.untrackedMetadata));
        const readResult = await artifactBytes(artifact, input.artifactRoot, {
          maximum: LIMITS.untracked,
          expectedKind: "git-untracked-file-metadata",
          expectedMediaType: "application/json",
          requireComplete: true
        });
        const value = parseUntracked(decodeUtf8(readResult.bytes));
        responseWithin(value, LIMITS.untracked);
        return value;
      });
    }
  });
}
