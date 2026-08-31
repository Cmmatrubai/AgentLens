import type { IncomingMessage, ServerResponse } from "node:http";

import { eventDetailV1Schema, trajectoryPageV1Schema } from "@agentlens/api-contract";
import type { EventPageQueryV1 } from "@agentlens/application";

import {
  RouteRequestError,
  boundedInteger,
  endError,
  endJson,
  routeId,
  sequence,
  strictSearch,
  type RouteContext
} from "./routeContext.js";

const eventParameters = new Set(["limit", "cursor", "afterSequence", "aroundSequence"]);

function eventQuery(url: URL): EventPageQueryV1 {
  const parameters = strictSearch(url, eventParameters);
  const cursor = parameters.get("cursor") ?? undefined;
  if (cursor !== undefined && (cursor.length === 0 || cursor.length > 4_096)) {
    throw new RouteRequestError();
  }
  const afterSequence = sequence(parameters.get("afterSequence"));
  const aroundSequence = sequence(parameters.get("aroundSequence"));
  if ([cursor, afterSequence, aroundSequence].filter((value) => value !== undefined).length > 1) {
    throw new RouteRequestError();
  }
  return {
    limit: boundedInteger(parameters.get("limit"), 100, 250),
    ...(cursor === undefined ? {} : { cursor }),
    ...(afterSequence === undefined ? {} : { afterSequence }),
    ...(aroundSequence === undefined ? {} : { aroundSequence })
  };
}

export async function handleEventRoutes(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: RouteContext
): Promise<boolean> {
  if (request.method !== "GET") return false;
  const detailMatch = /^\/api\/v1\/runs\/([^/]+)\/events\/([^/]+)$/.exec(url.pathname);
  if (detailMatch !== null) {
    if (url.search !== "") throw new RouteRequestError();
    const value = await context.runQueries.getEvent(
      routeId(detailMatch[1]!),
      routeId(detailMatch[2]!)
    );
    if (value === null) {
      endError(response, 404, "event_not_found", "Event was not found.");
      return true;
    }
    endJson(response, 200, eventDetailV1Schema.parse(value));
    return true;
  }
  const pageMatch = /^\/api\/v1\/runs\/([^/]+)\/events$/.exec(url.pathname);
  if (pageMatch === null) return false;
  endJson(response, 200, trajectoryPageV1Schema.parse(await context.runQueries.getEvents(
    routeId(pageMatch[1]!),
    eventQuery(url)
  )));
  return true;
}
