import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import { fixtureManifestSchema } from "../src/fixtureManifest.js";

const fixturesDir = resolve(
  fileURLToPath(new URL("../../../tests/fixtures/codex/", import.meta.url))
);
const manifestPath = resolve(fixturesDir, "manifest.json");

describe("sanitized Codex fixture contract", () => {
  it("ships only sanitized, declared Codex fixtures", async () => {
    const manifest = fixtureManifestSchema.parse(
      JSON.parse(await readFile(manifestPath, "utf8"))
    );

    expect(manifest.observedCodexVersion).toBe("0.149.0-alpha.4");
    expect(manifest.fixtures.map((fixture) => fixture.behavior)).toEqual([
      "read-success",
      "edit-success",
      "failure-recovery",
      "interrupted"
    ]);

    for (const fixture of manifest.fixtures) {
      const body = await readFile(resolve(fixturesDir, fixture.file), "utf8");
      expect(body).not.toMatch(/chaitanyamatrubai|\/Users\/|\/private\/tmp\//);
      expect(fixture.sanitizedClasses).toEqual(
        expect.arrayContaining([
          "machine-paths",
          "identifiers",
          "prompts-messages",
          "repository-content"
        ])
      );
    }
  });
});
