import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
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
      const tables = database.connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .pluck()
        .all();
      expect(tables).toEqual(expect.arrayContaining([
        "artifacts",
        "event_relationships",
        "event_sources",
        "events",
        "git_evidence",
        "redaction_audits",
        "runs",
        "schema_migrations"
      ]));

      const indexes = database.connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'index' ORDER BY name")
        .pluck()
        .all();
      expect(indexes).toEqual(expect.arrayContaining([
        "idx_artifacts_run_id",
        "idx_event_relationships_related_event_id",
        "idx_event_sources_run_item_id",
        "idx_event_sources_run_turn_id",
        "idx_events_run_sequence",
        "idx_runs_started_at"
      ]));
      expect(database.connection.pragma("foreign_keys", { simple: true })).toBe(1);
      expect(database.connection.pragma("journal_mode", { simple: true })).toBe("wal");
      expect(database.connection.pragma("synchronous", { simple: true })).toBe(1);
      expect(database.connection.pragma("busy_timeout", { simple: true })).toBe(5_000);
      expect(database.connection.prepare("SELECT version FROM schema_migrations").pluck().all()).toEqual([1]);
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
      expect(reopened.connection.prepare("SELECT version FROM schema_migrations").pluck().all()).toEqual([1]);
      expect(reopened.connection.prepare("PRAGMA integrity_check").pluck().get()).toBe("ok");
    } finally {
      reopened.close();
    }
  });
});
