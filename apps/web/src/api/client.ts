import {
  apiErrorV1Schema,
  assessmentConflictResponseV1Schema,
  assessmentNoteContentV1Schema,
  assessmentResponseV1Schema,
  assessmentUpdateRequestV1Schema,
  browserAddressableEventIdV1Schema,
  browserAddressableRunIdV1Schema,
  eventDetailV1Schema,
  gitDiffCheckContentV1Schema,
  gitDiffContentV1Schema,
  gitStatusContentV1Schema,
  gitUntrackedContentV1Schema,
  maximumAssessmentRevisionEtagCharacters,
  nativeContentResponseV1Schema,
  normalizedContentResponseV1Schema,
  runDetailV1Schema,
  runPageV1Schema,
  trajectoryPageV1Schema,
  type ApiErrorCodeV1,
  type AssessmentConflictResponseV1,
  type AssessmentNoteContentV1,
  type AssessmentResponseV1,
  type EventDetailV1,
  type GitDiffCheckContentV1,
  type GitDiffContentV1,
  type GitStatusContentV1,
  type GitUntrackedContentV1,
  type NativeContentResponseV1,
  type NormalizedContentResponseV1,
  type RunDetailV1,
  type RunPageV1,
  type TrajectoryPageV1
} from "@agentlens/api-contract";

interface ResponseSchema<T> {
  safeParse(value: unknown):
    | Readonly<{ success: true; data: T }>
    | Readonly<{ success: false }>;
}

const maximumResponseBytes = 4 * 1024 * 1024;
const runStatuses = new Set([
  "starting", "running", "completed", "failed", "interrupted", "recorder_error"
] as const);
const assessments = new Set([
  "projected", "explicit", "unreviewed", "success", "partial", "failure"
] as const);

export type RunStatusQueryV1 =
  | "starting" | "running" | "completed" | "failed"
  | "interrupted" | "recorder_error";
export type AssessmentQueryV1 =
  | "projected" | "explicit" | "unreviewed" | "success" | "partial" | "failure";

export interface RunListQueryV1 {
  readonly limit: number;
  readonly cursor?: string;
  readonly status?: RunStatusQueryV1;
  readonly repository?: string;
  readonly assessment?: AssessmentQueryV1;
}

export interface EventPageQueryV1 {
  readonly limit: number;
  readonly cursor?: string;
  readonly afterSequence?: number;
  readonly aroundSequence?: number;
}

export interface AssessmentDraft {
  readonly verdict: "unreviewed" | "success" | "partial" | "failure";
  readonly taskCompleted: "yes" | "no" | "uncertain";
  readonly note: string;
}

export interface AssessmentMutationInput {
  readonly runId: string;
  readonly etag: string;
  readonly draft: AssessmentDraft;
}

export interface AgentLensApiClient {
  listRuns(query: RunListQueryV1, signal?: AbortSignal): Promise<RunPageV1>;
  getRun(runId: string, signal?: AbortSignal): Promise<RunDetailV1>;
  getEvents(
    runId: string,
    query: EventPageQueryV1,
    signal?: AbortSignal
  ): Promise<TrajectoryPageV1>;
  getEvent(runId: string, eventId: string, signal?: AbortSignal): Promise<EventDetailV1>;
  getEventContent(runId: string, eventId: string, signal?: AbortSignal): Promise<NormalizedContentResponseV1>;
  getEventNative(runId: string, eventId: string, signal?: AbortSignal): Promise<NativeContentResponseV1>;
  getAssessmentNote(runId: string, eventId: string, signal?: AbortSignal): Promise<AssessmentNoteContentV1>;
  getGitDiff(runId: string, signal?: AbortSignal): Promise<GitDiffContentV1>;
  getGitStatus(runId: string, phase: "initial" | "final", signal?: AbortSignal): Promise<GitStatusContentV1>;
  getGitDiffCheck(runId: string, signal?: AbortSignal): Promise<GitDiffCheckContentV1>;
  getGitUntracked(runId: string, signal?: AbortSignal): Promise<GitUntrackedContentV1>;
  updateAssessment(input: AssessmentMutationInput): Promise<AssessmentResponseV1>;
}

export type AgentLensClientErrorCode =
  | ApiErrorCodeV1
  | "invalid_client_input"
  | "invalid_response"
  | "network_error"
  | "request_aborted";

export class AgentLensClientError extends Error {
  readonly code: AgentLensClientErrorCode;
  readonly status: number | null;
  readonly retryable: boolean;

  constructor(input: Readonly<{
    code: AgentLensClientErrorCode;
    status: number | null;
    retryable: boolean;
    message: string;
  }>) {
    super(input.message);
    this.name = "AgentLensClientError";
    this.code = input.code;
    this.status = input.status;
    this.retryable = input.retryable;
  }
}

export class AgentLensAssessmentConflictError extends AgentLensClientError {
  readonly assessment: AssessmentConflictResponseV1["assessment"];
  readonly etag: string;

  constructor(conflict: AssessmentConflictResponseV1) {
    super({
      code: "assessment_conflict",
      status: 412,
      retryable: false,
      message: "AgentLens could not complete the request."
    });
    this.name = "AgentLensAssessmentConflictError";
    this.assessment = conflict.assessment;
    this.etag = conflict.etag;
  }
}

function clientFailure(
  code: AgentLensClientErrorCode,
  message: string,
  status: number | null = null,
  retryable = false
): AgentLensClientError {
  return new AgentLensClientError({ code, message, status, retryable });
}

function safeApiMessage(code: ApiErrorCodeV1): string {
  switch (code) {
    case "authentication_required": return "AgentLens authentication is no longer available.";
    case "active_snapshot_unavailable": return "Active run evidence is temporarily unavailable.";
    case "run_not_found": return "The requested run was not found.";
    case "event_not_found": return "The requested event was not found.";
    case "invalid_cursor": return "The evidence cursor is no longer valid.";
    case "forbidden_origin": return "The request origin was not accepted.";
    case "precondition_required":
    case "assessment_conflict":
    case "content_unavailable":
    case "evidence_binding_mismatch":
    case "invalid_request":
    case "internal_error":
      return "AgentLens could not complete the request.";
  }
}

function validateOrigin(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw clientFailure("invalid_client_input", "AgentLens server origin is invalid.");
  }
  if (parsed.protocol !== "http:"
    || parsed.hostname !== "127.0.0.1"
    || parsed.port === ""
    || parsed.username !== ""
    || parsed.password !== ""
    || parsed.pathname !== "/"
    || parsed.search !== ""
    || parsed.hash !== "") {
    throw clientFailure("invalid_client_input", "AgentLens server origin is invalid.");
  }
  return parsed.origin;
}

function runId(value: string): string {
  if (!browserAddressableRunIdV1Schema.safeParse(value).success) {
    throw clientFailure("invalid_client_input", "AgentLens resource ID is invalid.");
  }
  return encodeURIComponent(value);
}

function eventId(value: string): string {
  if (!browserAddressableEventIdV1Schema.safeParse(value).success) {
    throw clientFailure("invalid_client_input", "AgentLens event ID is invalid.");
  }
  return encodeURIComponent(value);
}

function boundedInteger(value: number, maximum: number): void {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw clientFailure("invalid_client_input", "AgentLens query is invalid.");
  }
}

function addBoundedText(params: URLSearchParams, name: string, value: string | undefined, maximum: number): void {
  if (value === undefined) return;
  if (value.length < 1 || value.length > maximum) {
    throw clientFailure("invalid_client_input", "AgentLens query is invalid.");
  }
  params.set(name, value);
}

function runSearch(query: RunListQueryV1): string {
  boundedInteger(query.limit, 100);
  if (query.status !== undefined && !runStatuses.has(query.status)) {
    throw clientFailure("invalid_client_input", "AgentLens query is invalid.");
  }
  if (query.assessment !== undefined && !assessments.has(query.assessment)) {
    throw clientFailure("invalid_client_input", "AgentLens query is invalid.");
  }
  const params = new URLSearchParams();
  params.set("limit", String(query.limit));
  addBoundedText(params, "cursor", query.cursor, 4_096);
  if (query.status !== undefined) params.set("status", query.status);
  addBoundedText(params, "repository", query.repository, 256);
  if (query.assessment !== undefined) params.set("assessment", query.assessment);
  return params.toString();
}

function eventSearch(query: EventPageQueryV1): string {
  boundedInteger(query.limit, 250);
  const selectors = [query.cursor, query.afterSequence, query.aroundSequence]
    .filter((value) => value !== undefined);
  if (selectors.length > 1) throw clientFailure("invalid_client_input", "AgentLens query is invalid.");
  for (const sequence of [query.afterSequence, query.aroundSequence]) {
    if (sequence !== undefined && (!Number.isSafeInteger(sequence) || sequence < 0)) {
      throw clientFailure("invalid_client_input", "AgentLens query is invalid.");
    }
  }
  const params = new URLSearchParams();
  params.set("limit", String(query.limit));
  addBoundedText(params, "cursor", query.cursor, 4_096);
  if (query.afterSequence !== undefined) params.set("afterSequence", String(query.afterSequence));
  if (query.aroundSequence !== undefined) params.set("aroundSequence", String(query.aroundSequence));
  return params.toString();
}

function isAbort(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true || (error instanceof DOMException && error.name === "AbortError");
}

async function cancelBodyBestEffort(body: ReadableStream<Uint8Array> | null): Promise<void> {
  if (body === null || body.locked) return;
  try {
    await body.cancel();
  } catch {
    // Cancellation is cleanup only; its failure must not replace the bounded client error.
  }
}

async function cancelReaderBestEffort(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
  try {
    await reader.cancel();
  } catch {
    // Cancellation is cleanup only; its failure must not replace the bounded client error.
  }
}

async function readBoundedJson(response: Response, signal?: AbortSignal): Promise<unknown> {
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (mediaType !== "application/json") {
    await cancelBodyBestEffort(response.body);
    throw clientFailure("invalid_response", "AgentLens returned an invalid response.", response.status);
  }
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsedLength = Number(declaredLength);
    if (!Number.isSafeInteger(parsedLength) || parsedLength < 0 || parsedLength > maximumResponseBytes) {
      await cancelBodyBestEffort(response.body);
      throw clientFailure("invalid_response", "AgentLens returned an invalid response.", response.status);
    }
  }
  if (response.body === null) {
    throw clientFailure("invalid_response", "AgentLens returned an invalid response.", response.status);
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.byteLength;
      if (total > maximumResponseBytes) {
        await cancelReaderBestEffort(reader);
        throw clientFailure("invalid_response", "AgentLens returned an invalid response.", response.status);
      }
      chunks.push(next.value);
    }
  } catch (error) {
    await cancelReaderBestEffort(reader);
    if (error instanceof AgentLensClientError) throw error;
    if (isAbort(error, signal)) {
      throw clientFailure("request_aborted", "The AgentLens request was cancelled.");
    }
    throw clientFailure("invalid_response", "AgentLens returned an invalid response.", response.status);
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return JSON.parse(text) as unknown;
  } catch {
    throw clientFailure("invalid_response", "AgentLens returned an invalid response.", response.status);
  }
}

async function parseResponse<T>(
  response: Response,
  schema: ResponseSchema<T>,
  signal?: AbortSignal
): Promise<T> {
  if (response.redirected) {
    await cancelBodyBestEffort(response.body);
    throw clientFailure("invalid_response", "AgentLens returned an invalid response.", response.status);
  }
  const body = await readBoundedJson(response, signal);
  if (!response.ok) {
    const parsedError = apiErrorV1Schema.safeParse(body);
    if (!parsedError.success) {
      throw clientFailure("invalid_response", "AgentLens returned an invalid response.", response.status);
    }
    const { code, retryable } = parsedError.data.error;
    throw clientFailure(code, safeApiMessage(code), response.status, retryable);
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw clientFailure("invalid_response", "AgentLens returned an invalid response.", response.status);
  }
  return parsed.data;
}

function assessmentRequest(input: AssessmentMutationInput) {
  const note = input.draft.note.length === 0
    ? { state: "absent" as const }
    : { state: "text" as const, text: input.draft.note };
  const parsed = assessmentUpdateRequestV1Schema.safeParse({
    schemaVersion: 1,
    verdict: input.draft.verdict,
    taskCompleted: input.draft.taskCompleted,
    note
  });
  if (!parsed.success) {
    throw clientFailure("invalid_client_input", "AgentLens assessment input is invalid.");
  }
  return parsed.data;
}

function validAssessmentEtag(value: string): boolean {
  return value === '"assessment:projected"' ||
    (/^"assessment:[A-Za-z0-9_-]+"$/.test(value) &&
      value.length <= maximumAssessmentRevisionEtagCharacters);
}

export function assessmentEtagFor(currentEventId: string | null): string {
  if (currentEventId === null) return '"assessment:projected"';
  if (!browserAddressableEventIdV1Schema.safeParse(currentEventId).success) {
    throw clientFailure("invalid_client_input", "AgentLens assessment revision is invalid.");
  }
  const bytes = new TextEncoder().encode(currentEventId);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const encoded = btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
  return `"assessment:${encoded}"`;
}

export function createAgentLensApiClient(input: Readonly<{
  origin: string;
  bearerToken: string;
  fetchImpl?: typeof fetch;
}>): AgentLensApiClient {
  const origin = validateOrigin(input.origin);
  if (input.bearerToken.length < 1) {
    throw clientFailure("invalid_client_input", "AgentLens authentication is invalid.");
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  const request = async <T>(path: string, schema: ResponseSchema<T>, signal?: AbortSignal): Promise<T> => {
    let response: Response;
    try {
      response = await fetchImpl(`${origin}${path}`, {
        method: "GET",
        redirect: "error",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${input.bearerToken}`
        },
        ...(signal === undefined ? {} : { signal })
      });
    } catch (error) {
      if (signal?.aborted || (error instanceof DOMException && error.name === "AbortError")) {
        throw clientFailure("request_aborted", "The AgentLens request was cancelled.");
      }
      throw clientFailure("network_error", "AgentLens could not reach the local server.", null, true);
    }
    try {
      return await parseResponse(response, schema, signal);
    } catch (error) {
      if (error instanceof AgentLensClientError) throw error;
      if (isAbort(error, signal)) {
        throw clientFailure("request_aborted", "The AgentLens request was cancelled.");
      }
      throw clientFailure("invalid_response", "AgentLens returned an invalid response.", response.status);
    }
  };

  const updateAssessment = async (inputValue: AssessmentMutationInput): Promise<AssessmentResponseV1> => {
    const body = assessmentRequest(inputValue);
    if (!validAssessmentEtag(inputValue.etag)) {
      throw clientFailure("invalid_client_input", "AgentLens assessment revision is invalid.");
    }
    let response: Response;
    try {
      response = await fetchImpl(`${origin}/api/v1/runs/${runId(inputValue.runId)}/assessment`, {
        method: "PUT",
        redirect: "error",
        headers: {
          Accept: "application/json",
          Authorization: `Bearer ${input.bearerToken}`,
          "Content-Type": "application/json",
          "If-Match": inputValue.etag
        },
        body: JSON.stringify(body)
      });
    } catch {
      throw clientFailure("network_error", "AgentLens could not reach the local server.", null, true);
    }
    if (response.redirected) {
      await cancelBodyBestEffort(response.body);
      throw clientFailure("invalid_response", "AgentLens returned an invalid response.", response.status);
    }
    const responseBody = await readBoundedJson(response);
    if (response.status === 412) {
      const conflict = assessmentConflictResponseV1Schema.safeParse(responseBody);
      if (!conflict.success) {
        throw clientFailure("invalid_response", "AgentLens returned an invalid response.", response.status);
      }
      throw new AgentLensAssessmentConflictError(conflict.data);
    }
    if (!response.ok) {
      const parsedError = apiErrorV1Schema.safeParse(responseBody);
      if (!parsedError.success) {
        throw clientFailure("invalid_response", "AgentLens returned an invalid response.", response.status);
      }
      const { code, retryable } = parsedError.data.error;
      throw clientFailure(code, safeApiMessage(code), response.status, retryable);
    }
    const parsed = assessmentResponseV1Schema.safeParse(responseBody);
    if (!parsed.success) {
      throw clientFailure("invalid_response", "AgentLens returned an invalid response.", response.status);
    }
    return parsed.data;
  };

  return Object.freeze({
    listRuns: (query: RunListQueryV1, signal?: AbortSignal) =>
      request(`/api/v1/runs?${runSearch(query)}`, runPageV1Schema, signal),
    getRun: (runIdValue: string, signal?: AbortSignal) =>
      request(`/api/v1/runs/${runId(runIdValue)}`, runDetailV1Schema, signal),
    getEvents: (runIdValue: string, query: EventPageQueryV1, signal?: AbortSignal) =>
      request(
        `/api/v1/runs/${runId(runIdValue)}/events?${eventSearch(query)}`,
        trajectoryPageV1Schema,
        signal
      ),
    getEvent: (runIdValue: string, eventIdValue: string, signal?: AbortSignal) =>
      request(
        `/api/v1/runs/${runId(runIdValue)}/events/${eventId(eventIdValue)}`,
        eventDetailV1Schema,
        signal
      ),
    getEventContent: (runIdValue: string, eventIdValue: string, signal?: AbortSignal) =>
      request(
        `/api/v1/runs/${runId(runIdValue)}/events/${eventId(eventIdValue)}/content`,
        normalizedContentResponseV1Schema,
        signal
      ),
    getEventNative: (runIdValue: string, eventIdValue: string, signal?: AbortSignal) =>
      request(
        `/api/v1/runs/${runId(runIdValue)}/events/${eventId(eventIdValue)}/native`,
        nativeContentResponseV1Schema,
        signal
      ),
    getAssessmentNote: (runIdValue: string, eventIdValue: string, signal?: AbortSignal) =>
      request(
        `/api/v1/runs/${runId(runIdValue)}/events/${eventId(eventIdValue)}/assessment-note`,
        assessmentNoteContentV1Schema,
        signal
      ),
    getGitDiff: (runIdValue: string, signal?: AbortSignal) =>
      request(`/api/v1/runs/${runId(runIdValue)}/git/diff`, gitDiffContentV1Schema, signal),
    getGitStatus: (runIdValue: string, phase: "initial" | "final", signal?: AbortSignal) => {
      if (phase !== "initial" && phase !== "final") {
        throw clientFailure("invalid_client_input", "AgentLens query is invalid.");
      }
      return request(
        `/api/v1/runs/${runId(runIdValue)}/git/status?phase=${phase}`,
        gitStatusContentV1Schema,
        signal
      );
    },
    getGitDiffCheck: (runIdValue: string, signal?: AbortSignal) =>
      request(`/api/v1/runs/${runId(runIdValue)}/git/diff-check`, gitDiffCheckContentV1Schema, signal),
    getGitUntracked: (runIdValue: string, signal?: AbortSignal) =>
      request(`/api/v1/runs/${runId(runIdValue)}/git/untracked`, gitUntrackedContentV1Schema, signal),
    updateAssessment
  });
}
