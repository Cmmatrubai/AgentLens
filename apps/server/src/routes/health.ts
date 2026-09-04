import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";

import { RouteRequestError, endJson, type RouteContext } from "./routeContext.js";

const healthSchema = z.object({
  schemaVersion: z.literal(1),
  ready: z.literal(true),
  readModel: z.literal("ready")
}).strict();

export function handleHealthRoute(
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  context: RouteContext
): boolean {
  if (request.method !== "GET" || url.pathname !== "/api/v1/health") return false;
  if (url.search !== "") throw new RouteRequestError();
  endJson(response, 200, healthSchema.parse(context.health()));
  return true;
}
