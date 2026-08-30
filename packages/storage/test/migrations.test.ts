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

const migrationSql = [1, 2, 3].map((version) =>
  readFileSync(
    new URL(
      `../migrations/00${version}_${[
        "initial",
        "storage_invariants",
        "recorder_ownership"
      ][version - 1]}.sql`,
      import.meta.url
    ),
    "utf8"
  )
);

function createMigration003Database(path: string): Database.Database {
  const connection = new Database(path);
  connection.pragma("foreign_keys = ON");
  for (const [index, sql] of migrationSql.entries()) {
    connection.exec(sql);
    connection.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)")
      .run(index + 1, 1_777_777_777_000 + index);
  }
  return connection;
}

function insertRun(connection: Database.Database, id: string): void {
  connection.prepare(`
    INSERT INTO runs (
      id, schema_version, provider, integration_version, agent_version, status,
      capture_policy, capture_policy_version, redaction_version,
      repository_fingerprint, repository_display, started_at
    ) VALUES (?, 1, 'codex-exec', '0.1.0', 'fixture-agent', 'running',
      'standard', '1', '1', ?, 'fixture-repository', ?)
  `).run(id, `fingerprint-${id}`, 1_777_777_777_000);
}

function insertEvent(
  connection: Database.Database,
  input: { id: string; runId: string; sequence: number; provenance?: string; kind?: string }
): void {
  connection.prepare(`
    INSERT INTO events (
      id, run_id, sequence, received_at, kind, status, provenance, summary
    ) VALUES (?, ?, ?, ?, ?, 'completed', ?, ?)
  `).run(
    input.id,
    input.runId,
    input.sequence,
    1_777_777_777_000 + input.sequence,
    input.kind ?? "command",
    input.provenance ?? "observed",
    `fixture ${input.id}`
  );
}

function insertArtifact(connection: Database.Database, id: string, runId: string): void {
  connection.prepare(`
    INSERT INTO artifacts (
      id, run_id, kind, media_type, path, sha256, byte_length, redaction_state,
      truncated, original_byte_length, created_at
    ) VALUES (?, ?, 'assessment-note', 'text/plain', ?, ?, 7, 'redacted', 0, 7, ?)
  `).run(id, runId, `/fixture/${id}`, "a".repeat(64), 1_777_777_777_000);
}

function evidenceSnapshot(connection: Database.Database): Record<string, unknown[]> {
  return Object.fromEntries([
    "runs",
    "events",
    "event_sources",
    "event_relationships",
    "artifacts",
    "git_evidence",
    "redaction_audits",
    "run_ownership"
  ].map((table) => [
    table,
    connection.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all() as unknown[]
  ]));
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("SQLite migrations", () => {
  it("creates the v1 tables, indexes, and database safety pragmas", () => {
    const database = openDatabase(temporaryDatabasePath());
    try {
      const inspection = database.inspect();
      expect(inspection.tables).toEqual(expect.arrayContaining([
        "artifacts",
        "event_relationships",
        "event_sources",
        "events",
        "event_artifact_bindings",
        "git_evidence",
        "current_assessments",
        "derivation_identities",
        "redaction_audits",
        "run_ownership",
        "runs",
        "schema_migrations"
      ]));

      expect(inspection.indexes).toEqual(expect.arrayContaining([
        "idx_artifacts_run_id",
        "idx_event_relationships_one_recovery",
        "idx_event_relationships_related_event_id",
        "idx_event_artifact_bindings_run_artifact",
        "idx_event_artifact_bindings_run_event",
        "idx_derivation_identities_run_source",
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
      expect(inspection.migrations).toEqual([1, 2, 3, 4]);
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
      expect(reopened.inspect().migrations).toEqual([1, 2, 3, 4]);
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
      expect(inspection.migrations).toEqual([1, 2, 3, 4]);
      expect(inspection.indexes).toContain("idx_event_relationships_one_recovery");
      expect(inspection.integrity).toBe("ok");
    } finally {
      migrated.close();
    }
  });

  it("preserves all Task 1-5 evidence while migrating a populated v3 database", () => {
    const path = temporaryDatabasePath();
    const legacy = createMigration003Database(path);
    let before: Record<string, unknown[]>;
    try {
      insertRun(legacy, "run-preserved");
      insertArtifact(legacy, "artifact-preserved", "run-preserved");
      insertEvent(legacy, { id: "event-source", runId: "run-preserved", sequence: 0 });
      insertEvent(legacy, {
        id: "event-derived",
        runId: "run-preserved",
        sequence: 1,
        provenance: "derived",
        kind: "run.reconciled"
      });
      legacy.prepare(`
        INSERT INTO event_sources (event_id, run_id, provider, event_type, item_type)
        VALUES ('event-source', 'run-preserved', 'codex-exec', 'item.completed', 'command_execution')
      `).run();
      legacy.prepare(`
        INSERT INTO event_sources (event_id, run_id, provider, event_type)
        VALUES ('event-derived', 'run-preserved', 'codex-exec', 'run.reconciled')
      `).run();
      legacy.prepare(`
        INSERT INTO event_relationships (event_id, run_id, related_event_id, relationship_type)
        VALUES ('event-derived', 'run-preserved', 'event-source', 'derived_from')
      `).run();
      legacy.prepare(`
        INSERT INTO git_evidence (
          run_id, initial_head, final_head, initial_branch, final_branch,
          initial_status_state, initial_status_artifact_id, initial_status_omission_reason,
          final_status_state, final_status_artifact_id, final_status_omission_reason,
          tracked_final_diff_state, tracked_final_diff_artifact_id,
          tracked_final_diff_omission_reason, diff_check_state, diff_check_artifact_id,
          diff_check_omission_reason, diff_check_passed, untracked_metadata_state,
          untracked_metadata_artifact_id, untracked_metadata_omission_reason,
          head_changed, branch_changed, captured_at
        ) VALUES (
          'run-preserved', ?, ?, 'main', 'main',
          'artifact', 'artifact-preserved', NULL,
          'artifact', 'artifact-preserved', NULL,
          'absent', NULL, NULL, 'artifact', 'artifact-preserved', NULL, 1,
          'absent', NULL, NULL, 0, 0, ?
        )
      `).run("a".repeat(40), "a".repeat(40), 1_777_777_777_500);
      legacy.prepare(`
        INSERT INTO redaction_audits (
          run_id, event_id, artifact_id, reason, count, created_at
        ) VALUES ('run-preserved', 'event-source', 'artifact-preserved', 'fixture', 1, ?)
      `).run(1_777_777_777_600);
      legacy.prepare(`
        INSERT INTO run_ownership (
          run_id, recorder_instance_id, recorder_pid, recorder_start_token,
          heartbeat_at, condition, updated_at
        ) VALUES ('run-preserved', 'recorder-1', 101, 'token-101', ?, 'active', ?)
      `).run(1_777_777_777_700, 1_777_777_777_700);
      before = evidenceSnapshot(legacy);
    } finally {
      legacy.close();
    }

    const migrated = openDatabase(path);
    migrated.close();

    const inspected = new Database(path, { readonly: true, fileMustExist: true });
    try {
      expect(evidenceSnapshot(inspected)).toEqual(before);
      expect(inspected.prepare(
        "SELECT version FROM schema_migrations ORDER BY version"
      ).pluck().all()).toEqual([1, 2, 3, 4]);
      for (const table of [
        "derivation_identities",
        "current_assessments",
        "event_artifact_bindings"
      ]) {
        expect(inspected.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get()).toBe(0);
      }
    } finally {
      inspected.close();
    }
  });

  it("enforces Task 6 same-run keys, derivation uniqueness, and valid note-state tuples", () => {
    const path = temporaryDatabasePath();
    const database = openDatabase(path);
    database.close();
    const connection = new Database(path);
    connection.pragma("foreign_keys = ON");
    try {
      const parentIndex = connection.prepare(
        "SELECT name, [unique] FROM pragma_index_list('events') WHERE name = 'idx_events_id_run_id'"
      ).get() as { name: string; unique: number } | undefined;
      expect(parentIndex).toEqual({ name: "idx_events_id_run_id", unique: 1 });
      expect(connection.prepare(
        "SELECT name FROM pragma_index_info('idx_events_id_run_id') ORDER BY seqno"
      ).pluck().all()).toEqual(["id", "run_id"]);

      insertRun(connection, "run-a");
      insertRun(connection, "run-b");
      insertEvent(connection, { id: "source-a", runId: "run-a", sequence: 0 });
      insertEvent(connection, { id: "derived-a", runId: "run-a", sequence: 1, provenance: "derived" });
      insertEvent(connection, { id: "derived-a-2", runId: "run-a", sequence: 2, provenance: "derived" });
      insertEvent(connection, { id: "assessment-a", runId: "run-a", sequence: 3, provenance: "human" });
      insertEvent(connection, { id: "source-b", runId: "run-b", sequence: 0 });
      insertArtifact(connection, "note-a", "run-a");
      insertArtifact(connection, "note-b", "run-b");

      const insertIdentity = connection.prepare(`
        INSERT INTO derivation_identities (
          run_id, identity, source_event_id, derivation_name, derivation_version,
          derived_kind, derived_event_id, created_at
        ) VALUES (?, ?, ?, 'test-command', '1', ?, ?, ?)
      `);
      insertIdentity.run(
        "run-a", "identity-a", "source-a", "test.command", "derived-a", 1_777_777_777_800
      );
      expect(() => insertIdentity.run(
        "run-a", "identity-a", "source-a", "test.result", "derived-a-2", 1_777_777_777_801
      )).toThrow();
      expect(() => insertIdentity.run(
        "run-a", "identity-other", "source-a", "test.command", "derived-a-2", 1_777_777_777_802
      )).toThrow();
      expect(() => insertIdentity.run(
        "run-a", "identity-cross-run", "source-b", "test.result", "derived-a-2", 1_777_777_777_803
      )).toThrow(/foreign key/i);

      const insertAssessment = connection.prepare(`
        INSERT INTO current_assessments (
          run_id, current_event_id, verdict, task_completion, note_state,
          note_artifact_id, note_omission_reason, reviewed_at, updated_at
        ) VALUES ('run-a', 'assessment-a', 'partial', 'uncertain', ?, ?, ?, ?, ?)
      `);
      const validTuples = [
        ["absent", null, null],
        ["artifact", "note-a", null],
        ["omitted", null, "metadata-only"],
        ["omitted", null, "strict"]
      ] as const;
      for (const [offset, tuple] of validTuples.entries()) {
        connection.prepare("DELETE FROM current_assessments WHERE run_id = 'run-a'").run();
        expect(() => insertAssessment.run(...tuple, 1_777_777_777_900, 1_777_777_777_900 + offset))
          .not.toThrow();
      }
      for (const tuple of [
        ["absent", "note-a", null],
        ["absent", null, "strict"],
        ["artifact", null, null],
        ["artifact", "note-a", "strict"],
        ["omitted", "note-a", "strict"],
        ["omitted", null, null]
      ]) {
        connection.prepare("DELETE FROM current_assessments WHERE run_id = 'run-a'").run();
        expect(() => insertAssessment.run(...tuple, 1_777_777_777_900, 1_777_777_777_900))
          .toThrow();
      }
      expect(() => insertAssessment.run(
        "artifact", "note-b", null, 1_777_777_777_900, 1_777_777_777_900
      )).toThrow(/foreign key/i);

      connection.prepare(`
        INSERT INTO event_artifact_bindings (
          event_id, run_id, artifact_id, role, created_at
        ) VALUES ('assessment-a', 'run-a', 'note-a', 'assessment_note', ?)
      `).run(1_777_777_777_999);
      expect(() => connection.prepare(`
        INSERT INTO event_artifact_bindings (
          event_id, run_id, artifact_id, role, created_at
        ) VALUES ('assessment-a', 'run-a', 'note-b', 'assessment_note', ?)
      `).run(1_777_777_778_000)).toThrow(/foreign key/i);
    } finally {
      connection.close();
    }
  });

  it("rejects a current assessment without a run identity", () => {
    const path = temporaryDatabasePath();
    const database = openDatabase(path);
    database.close();
    const connection = new Database(path);
    connection.pragma("foreign_keys = ON");
    try {
      expect(() => connection.prepare(`
        INSERT INTO current_assessments (
          run_id, current_event_id, verdict, task_completion, note_state,
          note_artifact_id, note_omission_reason, reviewed_at, updated_at
        ) VALUES (
          NULL, 'missing-event', 'unreviewed', 'uncertain', 'absent',
          NULL, NULL, 1777777777900, 1777777777900
        )
      `).run()).toThrow(/not null/i);
    } finally {
      connection.close();
    }
  });

  it("reports future migration rows without rewriting or hiding them", () => {
    const path = temporaryDatabasePath();
    const database = openDatabase(path);
    database.close();
    const future = new Database(path);
    future.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (99, ?)")
      .run(1_777_777_779_000);
    future.close();

    const reopened = openDatabase(path);
    try {
      expect(reopened.inspect().migrations).toEqual([1, 2, 3, 4, 99]);
    } finally {
      reopened.close();
    }
  });
});
