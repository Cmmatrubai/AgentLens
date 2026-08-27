import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, expectTypeOf, it } from "vitest";
import {
  openDatabase,
  RunRepository,
  type AgentLensDatabase
} from "../src/index.js";

it("does not expose a raw SQLite event-mutation handle from the public API", () => {
  type DatabaseHasConnection = "connection" extends keyof AgentLensDatabase ? true : false;
  type RepositoryHasDatabase = "database" extends keyof RunRepository ? true : false;
  expectTypeOf<DatabaseHasConnection>().toEqualTypeOf<false>();
  expectTypeOf<RepositoryHasDatabase>().toEqualTypeOf<false>();

  const root = mkdtempSync(join(tmpdir(), "agentlens-storage-public-"));
  const artifactRoot = join(root, "artifacts", "sha256");
  mkdirSync(artifactRoot, { recursive: true, mode: 0o700 });
  const database = openDatabase(join(root, "agentlens.sqlite"));
  try {
    const repository = new RunRepository(database, { artifactRoot });
    expect("connection" in database).toBe(false);
    expect("database" in repository).toBe(false);
    expect(Object.keys(database)).not.toContain("connection");
    expect(Object.keys(repository)).not.toContain("database");
  } finally {
    database.close();
    rmSync(root, { recursive: true, force: true });
  }
});
