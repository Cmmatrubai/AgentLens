import type { IncomingMessage, ServerResponse } from "node:http";

import {
  assessmentNoteContentV1Schema,
  gitDiffCheckContentV1Schema,
  gitDiffContentV1Schema,
  gitStatusContentV1Schema,
  gitUntrackedContentV1Schema,
  nativeContentResponseV1Schema,
  normalizedContentResponseV1Schema
} from "@agentlens/api-contract";

import {
  RouteRequestError,
  endJson,
  routeId,
  strictSearch,
  type RouteContext
} from "./routeContext.js";

const phaseParameters = new Set(["phase"]);

export async function handleEvidenceRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: RouteContext
): Promise<boolean> {
  if (request.method !== "GET") return false;

  const eventMatch = /^\/api\/v1\/runs\/([^/]+)\/events\/([^/]+)\/(content|native|assessment-note)$/.exec(url.pathname);
  if (eventMatch !== null) {
    if (url.search !== "") throw new RouteRequestError();
    const runId = routeId(eventMatch[1]!);
    const eventId = routeId(eventMatch[2]!);
    switch (eventMatch[3]) {
      case "content":
        endJson(response, 200, normalizedContentResponseV1Schema.parse(
          await context.evidence.eventContent(runId, eventId)
        ));
        return true;
      case "native":
        endJson(response, 200, nativeContentResponseV1Schema.parse(
          await context.evidence.eventNative(runId, eventId)
        ));
        return true;
      case "assessment-note":
        endJson(response, 200, assessmentNoteContentV1Schema.parse(
          await context.evidence.assessmentNote(runId, eventId)
        ));
        return true;
      default:
        throw new RouteRequestError();
    }
  }

  const gitMatch = /^\/api\/v1\/runs\/([^/]+)\/git\/(diff|status|diff-check|untracked)$/.exec(url.pathname);
  if (gitMatch === null) return false;
  const runId = routeId(gitMatch[1]!);
  switch (gitMatch[2]) {
    case "diff":
      if (url.search !== "") throw new RouteRequestError();
      endJson(response, 200, gitDiffContentV1Schema.parse(await context.evidence.gitDiff(runId)));
      return true;
    case "status": {
      const parameters = strictSearch(url, phaseParameters);
      const phase = parameters.get("phase");
      if (phase !== "initial" && phase !== "final") throw new RouteRequestError();
      endJson(response, 200, gitStatusContentV1Schema.parse(
        await context.evidence.gitStatus(runId, phase)
      ));
      return true;
    }
    case "diff-check":
      if (url.search !== "") throw new RouteRequestError();
      endJson(response, 200, gitDiffCheckContentV1Schema.parse(
        await context.evidence.gitDiffCheck(runId)
      ));
      return true;
    case "untracked":
      if (url.search !== "") throw new RouteRequestError();
      endJson(response, 200, gitUntrackedContentV1Schema.parse(
        await context.evidence.gitUntracked(runId)
      ));
      return true;
    default:
      throw new RouteRequestError();
  }
}
