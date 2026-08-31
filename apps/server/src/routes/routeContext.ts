import type { ServerResponse } from "node:http";

import {
  apiErrorV1Schema,
  type ApiErrorCodeV1
} from "@agentlens/api-contract";
import {
  EvidenceServiceError,
  RunQueryServiceError,
  type EvidenceService,
  type RunQueryService
} from "@agentlens/application";
import { z } from "zod";

import { createResponseNonce, noStoreSecurityHeaders } from "../security/headers.js";

export interface RouteContext {
  readonly runQueries: RunQueryService;
  readonly evidence: EvidenceService;
  readonly health: () => Readonly<{ schemaVersion: 1; ready: true; readModel: "ready" }>;
}

export class RouteRequestError extends Error {
  constructor() {
    super("invalid_request");
    this.name = "RouteRequestError";
  }
}

export function endJson(response: ServerResponse, status: number, value: object): void {
  const nonce = createResponseNonce();
  response.writeHead(status, {
    ...noStoreSecurityHeaders(nonce),
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(value)}\n`);
}

export function endError(
  response: ServerResponse,
  status: number,
  code: ApiErrorCodeV1,
  message: string,
  retryable = false
): void {
  endJson(response, status, apiErrorV1Schema.parse({
    schemaVersion: 1,
    error: { code, message, retryable }
  }));
}

export function strictSearch(url: URL, allowed: ReadonlySet<string>): URLSearchParams {
  const seen = new Set<string>();
  for (const key of url.searchParams.keys()) {
    if (!allowed.has(key) || seen.has(key)) throw new RouteRequestError();
    seen.add(key);
  }
  return url.searchParams;
}

export function boundedInteger(
  text: string | null,
  fallback: number,
  maximum: number
): number {
  if (text === null) return fallback;
  if (!/^(?:0|[1-9]\d*)$/.test(text)) throw new RouteRequestError();
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RouteRequestError();
  }
  return value;
}

export function sequence(text: string | null): number | undefined {
  if (text === null) return undefined;
  if (!/^(?:0|[1-9]\d*)$/.test(text)) throw new RouteRequestError();
  const value = Number(text);
  if (!Number.isSafeInteger(value)) throw new RouteRequestError();
  return value;
}

export function routeId(encoded: string): string {
  let value: string;
  try {
    value = decodeURIComponent(encoded);
  } catch {
    throw new RouteRequestError();
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(value)) {
    throw new RouteRequestError();
  }
  return value;
}

export function handleRouteError(response: ServerResponse, error: unknown): void {
  if (error instanceof RouteRequestError) {
    endError(response, 400, "invalid_request", "Request parameters are invalid.");
    return;
  }
  if (error instanceof RunQueryServiceError) {
    switch (error.code) {
      case "invalid_request":
        endError(response, 400, "invalid_request", "Request parameters are invalid.");
        return;
      case "invalid_cursor":
        endError(response, 400, "invalid_cursor", "Cursor is invalid.");
        return;
      case "run_not_found":
        endError(response, 404, "run_not_found", "Run was not found.");
        return;
      case "active_snapshot_unavailable":
        endError(
          response,
          503,
          "active_snapshot_unavailable",
          "The active run snapshot is temporarily unavailable.",
          true
        );
        return;
    }
  }
  if (error instanceof EvidenceServiceError) {
    switch (error.code) {
      case "invalid_request":
        endError(response, 400, "invalid_request", "Request parameters are invalid.");
        return;
      case "run_not_found":
        endError(response, 404, "run_not_found", "Run was not found.");
        return;
      case "event_not_found":
        endError(response, 404, "event_not_found", "Event was not found.");
        return;
      case "content_unavailable":
        endError(response, 404, "content_unavailable", "Requested content is unavailable.");
        return;
      case "evidence_binding_mismatch":
        endError(response, 409, "evidence_binding_mismatch", "Evidence binding could not be validated.");
        return;
      case "active_snapshot_unavailable":
        endError(
          response,
          503,
          "active_snapshot_unavailable",
          "The active run snapshot is temporarily unavailable.",
          true
        );
        return;
    }
  }
  if (error instanceof z.ZodError) {
    endError(response, 500, "internal_error", "The local server could not complete the request.");
    return;
  }
  endError(response, 500, "internal_error", "The local server could not complete the request.");
}
