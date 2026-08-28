import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { openDatabase } from "../src/database.js";

const temporaryRoots: string[] = [];

function temporaryDatabasePath(): string {
  const root = mkdtempSync(join(tmpdir(), "agentlens-storage-migration-"));
  temporaryRoots.push(root);
  return join(root, "agentlens.sqlite");
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SQLite migration 001", () => {
  it("creates the v1 tables, indexes, and database safety pragmas", () => {
    const database = openDatabase(temporaryDatabasePath());
    try {
      const inspection = database.inspect();
      expect(inspection.tables).toEqual(expect.arrayContaining([
        "artifacts",
        "event_relationships",
        "event_sources",
        "events",
        "git_evidence",
        "redaction_audits",
        "run_ownership",
        "runs",
        "schema_migrations"
      ]));

      expect(inspection.indexes).toEqual(expect.arrayContaining([
        "idx_artifacts_run_id",
        "idx_event_relationships_one_recovery",
        "idx_event_relationships_related_event_id",
        "idx_event_sources_run_item_id",
        "idx_event_sources_run_turn_id",
        "idx_events_run_sequence",
        "idx_run_ownership_condition",
        "idx_runs_started_at"
      ]));
      expect(inspection.foreignKeys).toBe(true);
      expect(inspection.journalMode).toBe("wal");
      expect(inspection.synchronous).toBe(1);
      expect(inspection.busyTimeout).toBe(5_000);
      expect(inspection.migrations).toEqual([1, 2, 3]);
    } finally {
      database.close();
    }
  });

  it("reruns migration discovery without changing the applied migration", () => {
    const path = temporaryDatabasePath();
    const first = openDatabase(path);
    first.close();

    const reopened = openDatabase(path);
    try {
      expect(reopened.inspect().migrations).toEqual([1, 2, 3]);
      expect(reopened.inspect().integrity).toBe("ok");
    } finally {
      reopened.close();
    }
  });

  it("applies storage invariants forward to a database already recorded at v1", () => {
    const path = temporaryDatabasePath();
    const legacy = new Database(path);
    try {
      legacy.pragma("foreign_keys = ON");
      legacy.exec(readFileSync(new URL("../migrations/001_initial.sql", import.meta.url), "utf8"));
      legacy.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (1, ?)")
        .run(1_777_777_777_000);
    } finally {
      legacy.close();
    }

    const migrated = openDatabase(path);
    try {
      const inspection = migrated.inspect();
      expect(inspection.migrations).toEqual([1, 2, 3]);
      expect(inspection.indexes).toContain("idx_event_relationships_one_recovery");
      expect(inspection.integrity).toBe("ok");
    } finally {
      migrated.close();
    }
  });
});
