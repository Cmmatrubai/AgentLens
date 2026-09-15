import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  loadPublicComparison,
  publicDestination,
} from "../src/public-demo-data";
const bytes = JSON.stringify({
  ok: true,
  comparison: {
    schemaVersion: 1,
    attempts: [{ key: "sol" }, { key: "terra" }],
    review: { state: "available", findings: [] },
  },
});
const manifest = {
  schemaVersion: 1,
  exportVersion: "public-demo-v1",
  comparisonFile: "comparison.json",
  comparisonBytes: Buffer.byteLength(bytes),
  comparisonSha256: createHash("sha256").update(bytes).digest("hex"),
};
test("public reader uses subpath assets, checks the bytes and never calls a local API", async () => {
  const requested: string[] = [];
  const transport = async (url: string) => {
    requested.push(url);
    return new Response(
      url.endsWith("manifest.json") ? JSON.stringify(manifest) : bytes,
    );
  };
  const result = await loadPublicComparison("/showcase/", transport);
  assert.equal(result.ok, true);
  assert.deepEqual(requested, [
    "/showcase/demo/manifest.json",
    "/showcase/demo/comparison.json",
  ]);
});
test("public reader rejects tampered content, redirects to arbitrary assets, and error responses", async () => {
  const serve = (m: any, text: string) => async (url: string) =>
    new Response(url.endsWith("manifest.json") ? JSON.stringify(m) : text);
  await assert.rejects(
    loadPublicComparison("./", serve(manifest, bytes + " ")),
    /integrity/i,
  );
  await assert.rejects(
    loadPublicComparison(
      "./",
      serve({ ...manifest, comparisonFile: "https://example.com/data" }, bytes),
    ),
    /manifest/i,
  );
  await assert.rejects(
    loadPublicComparison(
      "./",
      async () => new Response("unavailable", { status: 404 }),
    ),
    /unavailable/i,
  );
});
test("unknown and sample routes resolve to the real case rather than simulated execution", () => {
  for (const hash of ["", "#/setup", "#/run", "#/saved", "#/anything"])
    assert.equal(publicDestination(hash), "case");
  assert.equal(publicDestination("#/evidence"), "evidence");
  assert.equal(publicDestination("#/about"), "about");
});
