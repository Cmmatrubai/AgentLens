import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseModelCatalog,
  readModelCatalog,
} from "../server/live/model-catalog.mjs";

const model = {
  slug: "model-a",
  display_name: "Model A",
  description: "Catalog description",
  visibility: "list",
  supported_reasoning_levels: [{ effort: "high" }, { effort: "max" }],
};
test("catalog exposes only visible, valid models and launcher-supported reasoning", () => {
  const result = parseModelCatalog({
    fetched_at: "2026-09-15T12:00:00Z",
    models: [
      model,
      { ...model, slug: "hidden", visibility: "hide" },
      { ...model, slug: "no-effort", supported_reasoning_levels: [] },
      { ...model, slug: "bad id" },
      model,
    ],
  });
  assert.deepEqual(result.models, [
    {
      id: "model-a",
      name: "Model A",
      description: "Catalog description",
      efforts: ["high"],
    },
  ]);
  assert.equal(result.source, "codex-cache");
  assert.equal(result.fetchedAt, "2026-09-15T12:00:00.000Z");
});
test("malformed catalog cannot become invented options", () => {
  assert.throws(
    () => parseModelCatalog({ models: "wrong" }),
    /model_catalog_unavailable/,
  );
  assert.deepEqual(parseModelCatalog({ models: [] }).models, []);
});
test("missing, malformed and oversized cache fail safely; only normalized metadata is returned", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "agentlens-models-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(readModelCatalog(root), /model_catalog_unavailable/);
  await writeFile(join(root, "models_cache.json"), "{");
  await assert.rejects(readModelCatalog(root), /model_catalog_unavailable/);
  await writeFile(
    join(root, "models_cache.json"),
    " ".repeat(2 * 1024 * 1024 + 1),
  );
  await assert.rejects(readModelCatalog(root), /model_catalog_unavailable/);
  await writeFile(
    join(root, "models_cache.json"),
    JSON.stringify({
      etag: "private metadata",
      models: [{ ...model, instructions: "not for renderer" }],
    }),
  );
  const result = await readModelCatalog(root);
  assert.equal(result.models.length, 1);
  assert.doesNotMatch(
    JSON.stringify(result),
    /instructions|etag|private metadata/,
  );
});
