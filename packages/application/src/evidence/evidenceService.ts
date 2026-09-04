import { TextDecoder } from "node:util";

import {
  assessmentNoteContentV1Schema,
  browserAddressableEventIdV1Schema,
  gitDiffCheckContentV1Schema,
  gitStatusContentV1Schema,
  gitUntrackedContentV1Schema,
  nativeContentResponseV1Schema,
  maximumAssessmentEventIdCharacters,
  type AssessmentNoteContentV1,
  type GitDiffCheckContentV1,
  type GitDiffContentV1,
  type GitStatusContentV1,
  type GitUntrackedContentV1,
  type NativeContentResponseV1,
  type NormalizedContentResponseV1
} from "@agentlens/api-contract";
import type { NativeSourceV1 } from "@agentlens/core";
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

// JSON string escaping is at most six output bytes per input byte/code unit.
// The fixed empty DTO is 45 bytes; this keeps every valid 16 KiB note and
// 256-character event ID bounded without weakening any other evidence route.
export const maximumAssessmentNoteResponseBytes =
  45 + 6 * (16 * 1024 + maximumAssessmentEventIdCharacters);

const LIMITS = Object.freeze({
  content: 256 * 1024,
  native: 256 * 1024,
  noteContent: 16 * 1024,
  noteResponse: maximumAssessmentNoteResponseBytes,
  diff: 2 * 1024 * 1024,
  status: 256 * 1024,
  diffCheck: 256 * 1024,
  untracked: 512 * 1024
});
const UTF8 = new TextDecoder("utf-8", { fatal: true });
const EXCLUSION_STATUS = /^\[\[EXCLUDED:[a-z0-9._-]{1,128}\]\]$/;
const GIT_STATUS_KINDS = new Set(["git-initial-status", "git-final-status"]);
const NATIVE_ARTIFACT_FORMATS: Readonly<Record<string, "json" | "text">> = Object.freeze({
  "application/json": "json",
  "text/plain; charset=utf-8": "text"
});
const NATIVE_SOURCE_MARKERS = Object.freeze([
  ["sessionId", "[[AGENTLENS_RESPONSE_REDACTED:SESSION_ID]]"],
  ["threadId", "[[AGENTLENS_RESPONSE_REDACTED:THREAD_ID]]"],
  ["turnId", "[[AGENTLENS_RESPONSE_REDACTED:TURN_ID]]"],
  ["itemId", "[[AGENTLENS_RESPONSE_REDACTED:ITEM_ID]]"],
  ["toolId", "[[AGENTLENS_RESPONSE_REDACTED:TOOL_ID]]"],
  ["correlationId", "[[AGENTLENS_RESPONSE_REDACTED:CORRELATION_ID]]"],
  ["eventType", "[[AGENTLENS_RESPONSE_REDACTED:EVENT_TYPE]]"],
  ["itemType", "[[AGENTLENS_RESPONSE_REDACTED:ITEM_TYPE]]"]
] as const);

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

function validRunId(value: string): boolean {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value);
}

function validEventId(value: string): boolean {
  return browserAddressableEventIdV1Schema.safeParse(value).success;
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

type SourceReplacement = Readonly<{
  source: string;
  marker: string;
  priority: number;
}>;

function sourceReplacements(source: NativeSourceV1): readonly SourceReplacement[] {
  const byValue = new Map<string, SourceReplacement>();
  for (const [priority, [field, marker]] of NATIVE_SOURCE_MARKERS.entries()) {
    const value = source[field];
    if (typeof value !== "string" || value.length === 0 || byValue.has(value)) continue;
    byValue.set(value, { source: value, marker, priority });
  }
  return [...byValue.values()].sort((left, right) =>
    right.source.length - left.source.length || left.priority - right.priority
  );
}

function redactSourceString(value: string, replacements: readonly SourceReplacement[]): string {
  const output: string[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    let matchIndex = -1;
    let match: SourceReplacement | undefined;
    for (const candidate of replacements) {
      const index = value.indexOf(candidate.source, cursor);
      if (
        index !== -1 &&
        (matchIndex === -1 || index < matchIndex ||
          (index === matchIndex && candidate.source.length > (match?.source.length ?? 0)))
      ) {
        matchIndex = index;
        match = candidate;
      }
    }
    if (match === undefined) {
      output.push(value.slice(cursor));
      break;
    }
    output.push(value.slice(cursor, matchIndex), match.marker);
    cursor = matchIndex + match.source.length;
  }
  return output.join("");
}

function projectNativeJson(value: unknown, source: NativeSourceV1): unknown {
  const replacements = sourceReplacements(source);
  if (replacements.length === 0) return value;
  if (typeof value === "string") return redactSourceString(value, replacements);
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value !== "object") throw new Error("Native payload is not JSON.");

  const root: unknown[] | Record<string, unknown> = Array.isArray(value)
    ? []
    : Object.create(null) as Record<string, unknown>;
  const pending: Array<{
    input: readonly unknown[] | Readonly<Record<string, unknown>>;
    output: unknown[] | Record<string, unknown>;
  }> = [{
    input: value as readonly unknown[] | Readonly<Record<string, unknown>>,
    output: root
  }];
  let visited = 0;
  while (pending.length > 0) {
    const current = pending.pop()!;
    const entries: Array<[string, unknown]> = Array.isArray(current.input)
      ? current.input.map((entry, index) => [String(index), entry])
      : Object.entries(current.input);
    for (const [inputKey, child] of entries) {
      visited += 1;
      if (visited > LIMITS.native) throw new Error("Native payload projection exceeds node bound.");
      const outputKey = Array.isArray(current.output)
        ? inputKey
        : redactSourceString(inputKey, replacements);
      if (!Array.isArray(current.output) && Object.hasOwn(current.output, outputKey)) {
        throw new Error("Native payload source redaction collides object keys.");
      }
      let projected: unknown;
      if (typeof child === "string") {
        projected = redactSourceString(child, replacements);
      } else if (child === null || typeof child === "boolean" || typeof child === "number") {
        projected = child;
      } else if (typeof child === "object") {
        projected = Array.isArray(child) ? [] : Object.create(null) as Record<string, unknown>;
        pending.push({
          input: child as readonly unknown[] | Readonly<Record<string, unknown>>,
          output: projected as unknown[] | Record<string, unknown>
        });
      } else {
        throw new Error("Native payload is not JSON.");
      }
      if (Array.isArray(current.output)) current.output.push(projected);
      else current.output[outputKey] = projected;
    }
  }
  return root;
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
    if (!validRunId(runId) || (eventId !== undefined && !validEventId(eventId))) {
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
        let format: "json" | "text" = "json";
        let durableText: string;
        let truncated = false;
        if (native.storage === "inline") {
          durableText = JSON.stringify(native.redacted);
          if (Buffer.byteLength(durableText, "utf8") > LIMITS.native) {
            throw new EvidenceServiceError("evidence_binding_mismatch");
          }
          parseJson(durableText);
        } else {
          const artifact = boundArtifact(repository, runId, native.artifactId);
          const artifactFormat = NATIVE_ARTIFACT_FORMATS[artifact.mediaType];
          if (artifactFormat === undefined) {
            throw new EvidenceServiceError("evidence_binding_mismatch");
          }
          const value = await artifactBytes(artifact, input.artifactRoot, {
            maximum: LIMITS.native,
            expectedKind: "native-payload",
            expectedMediaType: artifact.mediaType,
            requireComplete: false
          });
          durableText = decodeUtf8(value.bytes);
          format = artifactFormat;
          if (format === "json") parseJson(durableText);
          truncated = value.truncated;
        }
        let text: string;
        try {
          text = format === "json"
            ? JSON.stringify(projectNativeJson(parseJson(durableText), event.source))
            : redactSourceString(durableText, sourceReplacements(event.source));
        } catch {
          throw new EvidenceServiceError("evidence_binding_mismatch");
        }
        if (Buffer.byteLength(text, "utf8") > LIMITS.native) {
          throw new EvidenceServiceError("evidence_binding_mismatch");
        }
        const value = nativeContentResponseV1Schema.parse({
          schemaVersion: 1,
          eventId,
          content: { format, text, truncated }
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
          maximum: LIMITS.noteContent,
          expectedKind: "assessment-note",
          expectedMediaType: "text/plain; charset=utf-8",
          requireComplete: true
        });
        const value = assessmentNoteContentV1Schema.parse({
          schemaVersion: 1, eventId, content: decodeUtf8(artifact.bytes)
        });
        responseWithin(value, LIMITS.noteResponse);
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
