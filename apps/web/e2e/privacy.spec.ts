import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { expect, openBootstrapped, test } from "./fixtures.js";

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

test("ordinary HTTP and durable bytes contain no release privacy sentinels or browser secrets", async ({ page, productionUi, releaseFixture }) => {
  const captured: string[] = [];
  page.on("response", async (response) => {
    if (!response.url().startsWith(productionUi.origin)) return;
    captured.push(JSON.stringify(response.headers()));
    captured.push(await response.text().catch(() => ""));
  });
  await openBootstrapped(page, productionUi);
  await page.getByRole("link", { name: /Metadata-only capture/ }).click();
  const durable = await readRootBytes(releaseFixture.dataRoot);
  const httpAndLogs = `${captured.join("\n")}\n${productionUi.stderrLog()}`;
  for (const sentinel of [
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
  ]) {
    expect(durable.includes(Buffer.from(sentinel))).toBe(false);
    expect(httpAndLogs).not.toContain(sentinel);
  }
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
    url: `${productionUi.origin}/runs/fixture-metadata-only`
  });
});
