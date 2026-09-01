import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import type { Page, Response } from "@playwright/test";
import { expect, navigateToRun, openBootstrapped, test } from "./fixtures.js";

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

interface CapturedResponse {
  readonly body: Buffer;
  readonly headers: Buffer;
  readonly pathname: string;
}

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

function captureResponse(response: Response): Promise<CapturedResponse> {
  return Promise.all([
    response.body().catch(() => Buffer.alloc(0)),
    response.headersArray()
  ]).then(([body, headers]) => ({
    body,
    headers: Buffer.from(headers.map(({ name, value }) => `${name}: ${value}\r\n`).join(""), "latin1"),
    pathname: new URL(response.url()).pathname
  }));
}

async function drainResponseCaptures(pending: readonly Promise<CapturedResponse>[]): Promise<CapturedResponse[]> {
  const captured: CapturedResponse[] = [];
  let offset = 0;
  while (offset < pending.length) {
    const batch = pending.slice(offset);
    offset = pending.length;
    captured.push(...await Promise.all(batch));
  }
  return captured;
}

async function returnToLedger(page: Page): Promise<void> {
  await page.getByRole("link", { name: "Run ledger" }).click();
  await expect(page.getByRole("heading", { name: "Run ledger" })).toBeVisible();
}

test("ordinary HTTP and durable bytes contain no release privacy sentinels or browser secrets", async ({ page, productionUi, releaseFixture }) => {
  const pendingCaptures: Promise<CapturedResponse>[] = [];
  page.on("response", (response) => {
    if (new URL(response.url()).origin !== productionUi.origin) return;
    pendingCaptures.push(captureResponse(response));
  });

  await openBootstrapped(page, productionUi);
  await navigateToRun(page, "fixture-completed-recovery");
  await page.getByRole("button", { name: "Jump to first failure" }).click();
  await page.getByRole("button", { name: "Load command evidence" }).click();
  await expect(page.getByRole("heading", { name: "Redacted command", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Redacted provider payload" }).click();
  await expect(page.getByRole("tabpanel", { name: "Redacted provider payload" })).toBeVisible();

  await returnToLedger(page);
  await navigateToRun(page, "fixture-metadata-only");
  await page.locator('[role="option"][data-event-id="fixture-metadata-only-message"]').click();
  await expect(page.locator(".event-inspector").getByText("fixture-metadata-only-message", { exact: true })).toBeVisible();

  await returnToLedger(page);
  await navigateToRun(page, "fixture-strict-omitted");
  await page.locator('[role="option"][data-event-id="fixture-strict-omitted-message"]').click();
  await expect(page.locator(".event-inspector").getByText("fixture-strict-omitted-message", { exact: true })).toBeVisible();

  const requiredPaths = [
    "/api/v1/runs/fixture-completed-recovery/events/fixture-completed-recovery-command-failed",
    "/api/v1/runs/fixture-completed-recovery/events/fixture-completed-recovery-command-failed/content",
    "/api/v1/runs/fixture-completed-recovery/events/fixture-completed-recovery-command-failed/native",
    "/api/v1/runs/fixture-metadata-only/events/fixture-metadata-only-message",
    "/api/v1/runs/fixture-strict-omitted/events/fixture-strict-omitted-message"
  ] as const;
  await expect.poll(async () => (await drainResponseCaptures(pendingCaptures))
    .filter(({ pathname }) => requiredPaths.includes(pathname as typeof requiredPaths[number]))
    .map(({ pathname }) => pathname)).toEqual(expect.arrayContaining([...requiredPaths]));
  const captured = await drainResponseCaptures(pendingCaptures);
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
