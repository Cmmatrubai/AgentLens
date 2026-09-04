import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const MAX_CURSOR_TEXT_LENGTH = 4_096;

export interface RunCursorFilters {
  readonly status?: string;
  readonly repositoryFingerprint?: string;
  readonly assessment?:
    | { readonly state: "projected" }
    | { readonly state: "explicit"; readonly verdict?: string };
}

export interface RunCursorBoundary {
  readonly startedAt: number;
  readonly runId: string;
}

export interface EventCursorValue {
  readonly direction: "earlier" | "later";
  readonly mode: "before" | "after";
  readonly boundarySequence: number;
  readonly latestCommittedSequence: number;
}

export type CursorResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: "invalid_cursor" }>;

export interface CursorCodec {
  encodeRun(input: {
    readonly filters: RunCursorFilters;
    readonly boundary: RunCursorBoundary;
  }): string;
  decodeRun(cursor: string, filters: RunCursorFilters): CursorResult<RunCursorBoundary>;
  encodeEvent(input: {
    readonly runId: string;
    readonly direction: "earlier" | "later";
    readonly boundarySequence: number;
    readonly latestCommittedSequence: number;
  }): string;
  decodeEvent(cursor: string, expected: {
    readonly runId: string;
    readonly direction?: "earlier" | "later";
    readonly latestCommittedSequence?: number;
  }): CursorResult<EventCursorValue>;
}

interface CanonicalFilters {
  readonly status: string | null;
  readonly repositoryFingerprint: string | null;
  readonly assessmentState: "projected" | "explicit" | null;
  readonly assessmentVerdict: string | null;
}

interface RunCursorPayload {
  readonly v: 1;
  readonly k: "runs";
  readonly f: CanonicalFilters;
  readonly startedAt: number;
  readonly runId: string;
}

interface EventCursorPayload {
  readonly v: 1;
  readonly k: "events";
  readonly runId: string;
  readonly direction: "earlier" | "later";
  readonly mode: "before" | "after";
  readonly boundarySequence: number;
  readonly latestCommittedSequence: number;
}

const invalid = Object.freeze({ ok: false, error: "invalid_cursor" } as const);

function validText(value: unknown, max = 512): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= max;
}

function validInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function canonicalFilters(filters: RunCursorFilters): CanonicalFilters {
  const status = filters.status ?? null;
  const repositoryFingerprint = filters.repositoryFingerprint ?? null;
  const assessmentState = filters.assessment?.state ?? null;
  const assessmentVerdict = filters.assessment?.state === "explicit"
    ? filters.assessment.verdict ?? null
    : null;
  if (status !== null && !validText(status)) throw new Error("Run cursor filters are invalid.");
  if (repositoryFingerprint !== null && !validText(repositoryFingerprint)) {
    throw new Error("Run cursor filters are invalid.");
  }
  if (assessmentVerdict !== null && !validText(assessmentVerdict)) {
    throw new Error("Run cursor filters are invalid.");
  }
  return { status, repositoryFingerprint, assessmentState, assessmentVerdict };
}

function filtersFrom(value: unknown): CanonicalFilters | null {
  const fields = record(value);
  if (!fields || !exactKeys(fields, [
    "status", "repositoryFingerprint", "assessmentState", "assessmentVerdict"
  ])) return null;
  if (!(fields.status === null || validText(fields.status))) return null;
  if (!(fields.repositoryFingerprint === null || validText(fields.repositoryFingerprint))) return null;
  if (!(fields.assessmentState === null || fields.assessmentState === "projected" || fields.assessmentState === "explicit")) return null;
  if (!(fields.assessmentVerdict === null || validText(fields.assessmentVerdict))) return null;
  if (fields.assessmentState !== "explicit" && fields.assessmentVerdict !== null) return null;
  return {
    status: fields.status,
    repositoryFingerprint: fields.repositoryFingerprint,
    assessmentState: fields.assessmentState,
    assessmentVerdict: fields.assessmentVerdict
  };
}

function sameFilters(left: CanonicalFilters, right: CanonicalFilters): boolean {
  return left.status === right.status &&
    left.repositoryFingerprint === right.repositoryFingerprint &&
    left.assessmentState === right.assessmentState &&
    left.assessmentVerdict === right.assessmentVerdict;
}

function keyBytes(key: Uint8Array): Buffer {
  const bytes = Buffer.from(key);
  if (bytes.byteLength !== 32) throw new Error("API HMAC keys must contain exactly 32 bytes.");
  return bytes;
}

function encode(key: Buffer, payload: RunCursorPayload | EventCursorPayload): string {
  const payloadText = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const mac = createHmac("sha256", key).update("agentlens/cursor/v1\0").update(payloadText).digest("base64url");
  const cursor = `${payloadText}.${mac}`;
  if (cursor.length > MAX_CURSOR_TEXT_LENGTH) throw new Error("Cursor exceeds its maximum encoded size.");
  return cursor;
}

function decode(key: Buffer, cursor: string): unknown | null {
  if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > MAX_CURSOR_TEXT_LENGTH) return null;
  const parts = cursor.split(".");
  const payloadText = parts[0];
  const suppliedText = parts[1];
  if (parts.length !== 2 || !payloadText || !suppliedText ||
      !/^[A-Za-z0-9_-]+$/.test(payloadText) || !/^[A-Za-z0-9_-]+$/.test(suppliedText)) return null;
  const expected = createHmac("sha256", key)
    .update("agentlens/cursor/v1\0")
    .update(payloadText)
    .digest();
  const supplied = Buffer.from(suppliedText, "base64url");
  if (supplied.byteLength !== expected.byteLength || !timingSafeEqual(supplied, expected)) return null;
  try {
    const bytes = Buffer.from(payloadText, "base64url");
    if (bytes.byteLength > 3_072) return null;
    return JSON.parse(bytes.toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

function runPayload(value: unknown): RunCursorPayload | null {
  const payload = record(value);
  if (!payload || !exactKeys(payload, ["v", "k", "f", "startedAt", "runId"]) ||
      payload.v !== 1 || payload.k !== "runs" || !validInteger(payload.startedAt) ||
      !validText(payload.runId, 256)) return null;
  const filters = filtersFrom(payload.f);
  if (!filters) return null;
  return { v: 1, k: "runs", f: filters, startedAt: payload.startedAt, runId: payload.runId };
}

function eventPayload(value: unknown): EventCursorPayload | null {
  const payload = record(value);
  if (!payload || !exactKeys(payload, [
    "v", "k", "runId", "direction", "mode", "boundarySequence", "latestCommittedSequence"
  ]) || payload.v !== 1 || payload.k !== "events" || !validText(payload.runId, 256) ||
      (payload.direction !== "earlier" && payload.direction !== "later") ||
      (payload.mode !== "before" && payload.mode !== "after") ||
      !validInteger(payload.boundarySequence) || !validInteger(payload.latestCommittedSequence) ||
      !validEventBoundary(
        payload.direction,
        payload.boundarySequence,
        payload.latestCommittedSequence
      ) ||
      (payload.direction === "earlier" ? payload.mode !== "before" : payload.mode !== "after")) return null;
  return {
    v: 1,
    k: "events",
    runId: payload.runId,
    direction: payload.direction,
    mode: payload.mode,
    boundarySequence: payload.boundarySequence,
    latestCommittedSequence: payload.latestCommittedSequence
  };
}

function validEventBoundary(
  direction: "earlier" | "later",
  boundarySequence: number,
  latestCommittedSequence: number
): boolean {
  return boundarySequence <= latestCommittedSequence ||
    (direction === "earlier" &&
      latestCommittedSequence < Number.MAX_SAFE_INTEGER &&
      boundarySequence === latestCommittedSequence + 1);
}

export function createCursorCodec(cursorKey: Uint8Array = randomBytes(32)): CursorCodec {
  const key = keyBytes(cursorKey);
  const codec: CursorCodec = {
    encodeRun(input): string {
      if (!validInteger(input.boundary.startedAt) || !validText(input.boundary.runId, 256)) {
        throw new Error("Run cursor boundary is invalid.");
      }
      return encode(key, {
        v: 1,
        k: "runs",
        f: canonicalFilters(input.filters),
        startedAt: input.boundary.startedAt,
        runId: input.boundary.runId
      });
    },
    decodeRun(cursor, filters): CursorResult<RunCursorBoundary> {
      let expectedFilters: CanonicalFilters;
      try {
        expectedFilters = canonicalFilters(filters);
      } catch {
        return invalid;
      }
      const payload = runPayload(decode(key, cursor));
      if (!payload || !sameFilters(payload.f, expectedFilters)) return invalid;
      return { ok: true, value: { startedAt: payload.startedAt, runId: payload.runId } };
    },
    encodeEvent(input): string {
      if ((input.direction !== "earlier" && input.direction !== "later") ||
          !validText(input.runId, 256) || !validInteger(input.boundarySequence) ||
          !validInteger(input.latestCommittedSequence) ||
          !validEventBoundary(
            input.direction,
            input.boundarySequence,
            input.latestCommittedSequence
          )) {
        throw new Error("Event cursor boundary is invalid.");
      }
      return encode(key, {
        v: 1,
        k: "events",
        runId: input.runId,
        direction: input.direction,
        mode: input.direction === "earlier" ? "before" : "after",
        boundarySequence: input.boundarySequence,
        latestCommittedSequence: input.latestCommittedSequence
      });
    },
    decodeEvent(cursor, expectedContext): CursorResult<EventCursorValue> {
      const payload = eventPayload(decode(key, cursor));
      if (!payload || payload.runId !== expectedContext.runId ||
          (expectedContext.direction !== undefined && payload.direction !== expectedContext.direction) ||
          (expectedContext.latestCommittedSequence !== undefined &&
            payload.latestCommittedSequence !== expectedContext.latestCommittedSequence)) return invalid;
      return {
        ok: true,
        value: {
          direction: payload.direction,
          mode: payload.mode,
          boundarySequence: payload.boundarySequence,
          latestCommittedSequence: payload.latestCommittedSequence
        }
      };
    }
  };
  return Object.freeze(codec);
}
