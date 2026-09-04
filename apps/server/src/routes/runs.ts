import type { IncomingMessage, ServerResponse } from "node:http";

import { runDetailV1Schema, runPageV1Schema } from "@agentlens/api-contract";
import type { RunListQueryV1 } from "@agentlens/application";
import type { RunStatus } from "@agentlens/core";

import {
  RouteRequestError,
  boundedInteger,
  endError,
  endJson,
  routeId,
  strictSearch,
  type RouteContext
} from "./routeContext.js";

const listParameters = new Set(["limit", "cursor", "status", "repository", "assessment"]);
const statuses = new Set<RunStatus>([
  "starting", "running", "completed", "failed", "interrupted", "recorder_error"
]);

function listQuery(url: URL): RunListQueryV1 {
  const parameters = strictSearch(url, listParameters);
  const statusText = parameters.get("status");
  if (statusText !== null && !statuses.has(statusText as RunStatus)) throw new RouteRequestError();
  const repositoryFingerprint = parameters.get("repository") ?? undefined;
  if (repositoryFingerprint !== undefined &&
      (repositoryFingerprint.length === 0 || repositoryFingerprint.length > 256)) {
    throw new RouteRequestError();
  }
  const cursor = parameters.get("cursor") ?? undefined;
  if (cursor !== undefined && (cursor.length === 0 || cursor.length > 4_096)) {
    throw new RouteRequestError();
  }
  const assessmentText = parameters.get("assessment");
  let assessment: RunListQueryV1["assessment"];
  if (assessmentText === "projected") assessment = { state: "projected" };
  else if (assessmentText === "explicit") assessment = { state: "explicit" };
  else if (["unreviewed", "success", "partial", "failure"].includes(assessmentText ?? "")) {
    assessment = {
      state: "explicit",
      verdict: assessmentText as "unreviewed" | "success" | "partial" | "failure"
    };
  } else if (assessmentText !== null) throw new RouteRequestError();

  return {
    limit: boundedInteger(parameters.get("limit"), 50, 100),
    ...(cursor === undefined ? {} : { cursor }),
    ...(statusText === null ? {} : { status: statusText as RunStatus }),
    ...(repositoryFingerprint === undefined ? {} : { repositoryFingerprint }),
    ...(assessment === undefined ? {} : { assessment })
  };
}

export async function handleRunRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: RouteContext
): Promise<boolean> {
  if (request.method !== "GET") return false;
  if (url.pathname === "/api/v1/runs") {
    endJson(response, 200, runPageV1Schema.parse(await context.runQueries.listRuns(listQuery(url))));
    return true;
  }
  const detailMatch = /^\/api\/v1\/runs\/([^/]+)$/.exec(url.pathname);
  if (detailMatch === null) return false;
  if (url.search !== "") throw new RouteRequestError();
  const value = await context.runQueries.getRun(routeId(detailMatch[1]!));
  if (value === null) {
    endError(response, 404, "run_not_found", "Run was not found.");
    return true;
  }
  endJson(response, 200, runDetailV1Schema.parse(value));
  return true;
}
