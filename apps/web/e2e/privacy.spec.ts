import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import type { Page, Request } from "@playwright/test";
import { expect, navigateToRun, openBootstrapped, test } from "./fixtures.js";
import {
  captureResponse,
  drainResponseCaptures,
  type CapturedResponse,
  type ResponseCapture
} from "./responseCapture.js";
import {
  type RequestLifecycleLedger,
  type RequestMatch
} from "./requestLifecycle.js";

const rawSentinels = [
  "OMITTED_PROMPT_SENTINEL_RELEASE",
  "OMITTED_MESSAGE_SENTINEL_RELEASE",
  "OMITTED_COMMAND_SENTINEL_RELEASE",
  "OMITTED_OUTPUT_SENTINEL_RELEASE",
  "OMITTED_DIFF_SENTINEL_RELEASE",
  "OMITTED_NOTE_SENTINEL_RELEASE",
  "OMITTED_SOURCE_ID_SENTINEL_RELEASE",
  "OMITTED_DATABASE_PATH_SENTINEL_RELEASE",
  "OMITTED_ARTIFACT_PATH_SENTINEL_RELEASE",
  "OMITTED_REPOSITORY_PATH_SENTINEL_RELEASE",
  "RAW_STANDARD_SECRET_SENTINEL_RELEASE"
] as const;

const expectedStandardMarkers = [
  "[[REDACTED:auth-bearer:hmac-sha256:c40257ce4c2ffc291e2b3506f3852709]]"
] as const;

const deniedExplicitPaths = [
  "/api/v1/runs/fixture-metadata-only/events/fixture-metadata-only-message/content",
  "/api/v1/runs/fixture-metadata-only/events/fixture-metadata-only-message/native",
  "/api/v1/runs/fixture-strict-omitted/events/fixture-strict-omitted-message/content",
  "/api/v1/runs/fixture-strict-omitted/events/fixture-strict-omitted-message/native"
] as const;

const contentUnavailableEnvelope = {
  schemaVersion: 1,
  error: {
    code: "content_unavailable",
    message: "Requested content is unavailable.",
    retryable: false
  }
} as const;

async function readRootBytes(root: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const candidate = join(directory, entry.name);
      if (entry.isDirectory()) await visit(candidate);
      else if (entry.isFile()) chunks.push(await readFile(candidate));
    }
  };
  await visit(root);
  return Buffer.concat(chunks);
}

async function returnToLedger(
  page: Page,
  lifecycle: RequestLifecycleLedger<Request>,
  origin: string
): Promise<void> {
  const checkpoint = lifecycle.checkpoint();
  await page.getByRole("link", { name: "Run ledger" }).click();
  await expect(page.getByRole("heading", { name: "Run ledger" })).toBeVisible();
  await lifecycle.waitForTerminal(checkpoint, {
    method: "GET",
    origin,
    pathname: "/api/v1/runs",
    search: "?limit=50"
  });
}

test.use({
  allowedSameOriginFailures: {
    responses: deniedExplicitPaths.map((pathname) => ({
      method: "GET",
      pathname,
      status: 404
    }))
  }
});

test("ordinary HTTP and durable bytes contain no release privacy sentinels or browser secrets", async ({
  page,
  productionUi,
  releaseFixture,
  requestLifecycle
}) => {
  const pendingCaptures = new Map<Request, Promise<ResponseCapture>>();
  let authorizationHeader: Promise<string> | undefined;
  page.on("request", (request) => {
    const requested = new URL(request.url());
    if (authorizationHeader !== undefined || requested.origin !== productionUi.origin ||
        !requested.pathname.startsWith("/api/")) return;
    authorizationHeader = request.headerValue("authorization").then((value) => {
      if (value === null || !value.startsWith("Bearer ")) {
        throw new Error("The browser did not attach its in-memory authorization to the API request.");
      }
      return value;
    });
  });
  await page.route("**/*", async (route) => {
    const requested = new URL(route.request().url());
    if (requested.origin !== productionUi.origin) {
      await route.continue();
      return;
    }
    const upstream = await route.fetch({ maxRedirects: 0 });
    const capture = captureResponse({
      body: () => upstream.body(),
      headersArray: async () => upstream.headersArray(),
      request: () => ({ method: () => route.request().method() }),
      status: () => upstream.status(),
      url: () => upstream.url()
    });
    pendingCaptures.set(route.request(), capture);
    const result = await capture;
    if (!result.ok) throw result.error;
    await route.fulfill({ response: upstream, body: result.captured.body });
  });
  const drainAfter = async (
    checkpoint: number,
    matches: readonly RequestMatch<Request>[]
  ): Promise<CapturedResponse[]> => {
    const records = await Promise.all(matches.map((match) =>
      requestLifecycle.waitForTerminal(checkpoint, { origin: productionUi.origin, ...match })
    ));
    const captures = records.map((record) => {
      const capture = pendingCaptures.get(record.request);
      if (capture === undefined) {
        throw new Error(`Privacy capture missing for request #${record.id}.`);
      }
      return capture;
    });
    return drainResponseCaptures(captures);
  };

  const bootstrapCheckpoint = requestLifecycle.checkpoint();
  await openBootstrapped(page, productionUi);
  await drainAfter(bootstrapCheckpoint, [{ method: "GET", pathname: "/api/v1/runs", search: "?limit=50" }]);
  const completedRunCheckpoint = requestLifecycle.checkpoint();
  await navigateToRun(page, "fixture-completed-recovery");
  await drainAfter(completedRunCheckpoint, [
    { method: "GET", pathname: "/api/v1/runs/fixture-completed-recovery", search: "" },
    { method: "GET", pathname: "/api/v1/runs/fixture-completed-recovery/events", search: "?limit=100" }
  ]);
  const commandCheckpoint = requestLifecycle.checkpoint();
  await page.getByRole("button", { name: "Jump to first failure" }).click();
  await page.getByRole("button", { name: "Load command evidence" }).click();
  await expect(page.getByRole("heading", { name: "Redacted command", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Redacted provider payload" }).click();
  await expect(page.getByRole("tabpanel", { name: "Redacted provider payload" })).toBeVisible();
  await drainAfter(commandCheckpoint, [
    { method: "GET", pathname: "/api/v1/runs/fixture-completed-recovery/events/fixture-completed-recovery-command-failed", search: "" },
    { method: "GET", pathname: "/api/v1/runs/fixture-completed-recovery/events/fixture-completed-recovery-command-failed/content", search: "" },
    { method: "GET", pathname: "/api/v1/runs/fixture-completed-recovery/events/fixture-completed-recovery-command-failed/native", search: "" }
  ]);

  await returnToLedger(page, requestLifecycle, productionUi.origin);
  const metadataRunCheckpoint = requestLifecycle.checkpoint();
  await navigateToRun(page, "fixture-metadata-only");
  await drainAfter(metadataRunCheckpoint, [
    { method: "GET", pathname: "/api/v1/runs/fixture-metadata-only", search: "" },
    { method: "GET", pathname: "/api/v1/runs/fixture-metadata-only/events", search: "?limit=100" }
  ]);
  const metadataDetailCheckpoint = requestLifecycle.checkpoint();
  await page.locator('[role="option"][data-event-id="fixture-metadata-only-message"]').click();
  await expect(page.locator(".event-inspector").getByText("fixture-metadata-only-message", { exact: true })).toBeVisible();
  await drainAfter(metadataDetailCheckpoint, [{
    method: "GET",
    pathname: "/api/v1/runs/fixture-metadata-only/events/fixture-metadata-only-message",
    search: ""
  }]);

  await returnToLedger(page, requestLifecycle, productionUi.origin);
  const strictRunCheckpoint = requestLifecycle.checkpoint();
  await navigateToRun(page, "fixture-strict-omitted");
  await drainAfter(strictRunCheckpoint, [
    { method: "GET", pathname: "/api/v1/runs/fixture-strict-omitted", search: "" },
    { method: "GET", pathname: "/api/v1/runs/fixture-strict-omitted/events", search: "?limit=100" }
  ]);
  const strictDetailCheckpoint = requestLifecycle.checkpoint();
  await page.locator('[role="option"][data-event-id="fixture-strict-omitted-message"]').click();
  await expect(page.locator(".event-inspector").getByText("fixture-strict-omitted-message", { exact: true })).toBeVisible();
  await drainAfter(strictDetailCheckpoint, [{
    method: "GET",
    pathname: "/api/v1/runs/fixture-strict-omitted/events/fixture-strict-omitted-message",
    search: ""
  }]);

  if (authorizationHeader === undefined) {
    throw new Error("The privacy journey did not observe browser API authorization.");
  }
  const deniedCheckpoint = requestLifecycle.checkpoint();
  const denied = await page.evaluate(async ({ authorization, paths }) => await Promise.all(paths.map(async (pathname) => {
    const response = await fetch(pathname, { headers: { Authorization: authorization } });
    return { pathname, status: response.status, body: await response.json() as unknown };
  })), {
    authorization: await authorizationHeader,
    paths: [...deniedExplicitPaths]
  });
  expect(denied).toEqual(deniedExplicitPaths.map((pathname) => ({
    pathname,
    status: 404,
    body: contentUnavailableEnvelope
  })));
  await drainAfter(deniedCheckpoint, deniedExplicitPaths.map((pathname) => ({
    method: "GET",
    pathname,
    search: ""
  })));

  const requiredPaths = [
    "/api/v1/runs/fixture-completed-recovery/events/fixture-completed-recovery-command-failed",
    "/api/v1/runs/fixture-completed-recovery/events/fixture-completed-recovery-command-failed/content",
    "/api/v1/runs/fixture-completed-recovery/events/fixture-completed-recovery-command-failed/native",
    "/api/v1/runs/fixture-metadata-only/events/fixture-metadata-only-message",
    ...deniedExplicitPaths.slice(0, 2),
    "/api/v1/runs/fixture-strict-omitted/events/fixture-strict-omitted-message",
    ...deniedExplicitPaths.slice(2)
  ] as const;
  const captured = await drainResponseCaptures([...pendingCaptures.values()]);
  expect(captured
    .filter(({ pathname }) => requiredPaths.includes(pathname as typeof requiredPaths[number]))
    .map(({ pathname }) => pathname)).toEqual(expect.arrayContaining([...requiredPaths]));
  for (const pathname of deniedExplicitPaths) {
    const matches = captured.filter((response) => response.pathname === pathname);
    expect(matches).toHaveLength(1);
    expect(matches[0]?.status).toBe(404);
    expect(JSON.parse(matches[0]!.body.toString("utf8"))).toEqual(contentUnavailableEnvelope);
  }
  const durable = await readRootBytes(releaseFixture.dataRoot);
  const corpora = [
    durable,
    ...captured.flatMap(({ headers, body }) => [headers, body]),
    Buffer.from(productionUi.stderrLog(), "utf8")
  ];
  for (const sentinel of rawSentinels) {
    for (const corpus of corpora) expect(corpus.includes(Buffer.from(sentinel))).toBe(false);
  }
  const markers = new Set(corpora.flatMap((corpus) =>
    [...corpus.toString("utf8").matchAll(/\[\[REDACTED:[^\]]+\]\]/g)].map(([marker]) => marker)
  ));
  expect([...markers].sort()).toEqual([...expectedStandardMarkers]);

  expect(await page.evaluate(async () => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
    cookie: document.cookie,
    indexedDatabases: (await indexedDB.databases()).map(({ name }) => name),
    bootstrapScriptCount: document.querySelectorAll("#agentlens-bootstrap").length,
    url: location.href
  }))).toEqual({
    local: [],
    session: [],
    cookie: "",
    indexedDatabases: [],
    bootstrapScriptCount: 0,
    url: `${productionUi.origin}/runs/fixture-strict-omitted?event=fixture-strict-omitted-message`
  });
});
