import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApiErrorCodeV1, ApiErrorV1 } from "@agentlens/api-contract";
import type { AssessmentService, EvidenceService, RunQueryService } from "@agentlens/application";
import { createBootstrapHtml, createReloadHtml } from "./bootstrap.js";
import { createResponseNonce, noStoreSecurityHeaders, staticSecurityHeaders } from "./security/headers.js";
import {
  hasExactHost,
  hasExactOrigin,
  isMutationMethod,
  readBoundedRequestBody
} from "./security/requestPolicy.js";
import { matchesBearer } from "./security/tokens.js";
import type { StaticAssets } from "./staticAssets.js";
import { handleEventRoutes } from "./routes/events.js";
import { handleAssessmentRoute, maximumAssessmentRequestBytes } from "./routes/assessment.js";
import { handleEvidenceRoutes } from "./routes/evidence.js";
import { handleHealthRoute } from "./routes/health.js";
import { handleRunRoutes } from "./routes/runs.js";
import { handleRouteError } from "./routes/routeContext.js";

export interface AgentLensRouterOptions {
  readonly origin: string;
  readonly expectedHost: string;
  readonly bearer: Buffer;
  readonly bootstrapCode: string;
  readonly staticAssets: StaticAssets;
  readonly health: () => Readonly<{ schemaVersion: 1; ready: true; readModel: "ready" }>;
  readonly runQueries: RunQueryService;
  readonly evidence: EvidenceService;
  readonly assessment: AssessmentService;
}

function endJson(response: ServerResponse, status: number, value: object): void {
  const nonce = createResponseNonce();
  response.writeHead(status, {
    ...noStoreSecurityHeaders(nonce),
    "Content-Type": "application/json; charset=utf-8"
  });
  response.end(`${JSON.stringify(value)}\n`);
}

function endError(
  response: ServerResponse,
  status: number,
  code: ApiErrorCodeV1,
  message: string
): void {
  const body: ApiErrorV1 = {
    schemaVersion: 1,
    error: { code, message, retryable: false }
  };
  endJson(response, status, body);
}

function endHtml(response: ServerResponse, html: string, nonce: string): void {
  response.writeHead(200, {
    ...noStoreSecurityHeaders(nonce),
    "Content-Type": "text/html; charset=utf-8"
  });
  response.end(html);
}

export function createAgentLensRouter(options: AgentLensRouterOptions) {
  let bootstrapAvailable = true;
  const bootstrapPath = `/bootstrap/${options.bootstrapCode}`;

  return async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    try {
      if (!hasExactHost(request, options.expectedHost)) {
        endError(response, 400, "invalid_request", "Request host is not allowed.");
        return;
      }

      const url = new URL(request.url ?? "/", options.origin);
      if (url.pathname.startsWith("/api/v1")) {
        if (!matchesBearer(request.headers.authorization, options.bearer)) {
          request.resume();
          endError(response, 401, "authentication_required", "Authentication is required.");
          return;
        }
        if (isMutationMethod(request.method) && !hasExactOrigin(request, options.origin)) {
          request.resume();
          endError(response, 403, "forbidden_origin", "Request origin is not allowed.");
          return;
        }
        const assessmentMutation = request.method === "PUT" &&
          /^\/api\/v1\/runs\/[^/]+\/assessment$/.test(url.pathname);
        const requestBody = isMutationMethod(request.method)
          ? await readBoundedRequestBody(
              request,
              assessmentMutation ? maximumAssessmentRequestBytes : undefined
            )
          : undefined;

        const routeContext = {
          runQueries: options.runQueries,
          evidence: options.evidence,
          assessment: options.assessment,
          health: options.health
        };
        try {
          if (handleHealthRoute(request, response, url, routeContext)) return;
          if (await handleAssessmentRoute(request, response, url, routeContext, requestBody)) return;
          if (await handleEvidenceRoutes(request, response, url, routeContext)) return;
          if (await handleEventRoutes(request, response, url, routeContext)) return;
          if (await handleRunRoutes(request, response, url, routeContext)) return;
        } catch (error) {
          handleRouteError(response, error);
          return;
        }
        endError(response, 404, "invalid_request", "API route was not found.");
        return;
      }

      if (request.method === "GET" && url.pathname === bootstrapPath && url.search === "") {
        if (!bootstrapAvailable) {
          endError(response, 404, "invalid_request", "Bootstrap was not found.");
          return;
        }
        const nonce = createResponseNonce();
        const html = createBootstrapHtml(
          options.bearer.toString("base64url"),
          options.staticAssets.entryUrl,
          nonce,
          options.staticAssets.styleUrls
        );
        bootstrapAvailable = false;
        endHtml(response, html, nonce);
        return;
      }

      if (request.method === "GET" && /^\/runs(?:\/[^/?#]+)?$/.test(url.pathname)) {
        const nonce = createResponseNonce();
        endHtml(response, createReloadHtml(
          options.staticAssets.entryUrl,
          nonce,
          options.staticAssets.styleUrls
        ), nonce);
        return;
      }

      if (request.method === "GET" && url.pathname === "/favicon.ico" && url.search === "") {
        response.writeHead(204, noStoreSecurityHeaders(createResponseNonce()));
        response.end();
        return;
      }

      if (request.method === "GET" && url.search === "") {
        const asset = await options.staticAssets.read(url.pathname);
        if (asset !== null) {
          response.writeHead(200, { ...staticSecurityHeaders, "Content-Type": asset.contentType });
          response.end(asset.bytes);
          return;
        }
      }

      endError(response, 404, "invalid_request", "Resource was not found.");
    } catch (error) {
      if (error instanceof Error
        && ["request_body_too_large", "invalid_content_length"].includes(error.message)) {
        endError(
          response,
          error.message === "request_body_too_large" ? 413 : 400,
          "invalid_request",
          error.message === "request_body_too_large"
            ? "Request body is too large."
            : "Request content length is invalid."
        );
        return;
      }
      endError(response, 500, "internal_error", "The local server could not complete the request.");
    }
  };
}
