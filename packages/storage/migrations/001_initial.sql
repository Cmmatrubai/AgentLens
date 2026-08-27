CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  schema_version INTEGER NOT NULL,
  provider TEXT NOT NULL,
  integration_version TEXT NOT NULL,
  agent_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('starting', 'running', 'completed', 'failed', 'interrupted', 'recorder_error')),
  capture_policy TEXT NOT NULL CHECK (capture_policy IN ('standard', 'metadata-only', 'strict')),
  capture_policy_version TEXT NOT NULL,
  redaction_version TEXT NOT NULL,
  label TEXT,
  prompt_source TEXT,
  repository_fingerprint TEXT NOT NULL,
  repository_display TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  child_pid INTEGER,
  exit_code INTEGER,
  terminating_signal TEXT,
  process_event_id TEXT,
  provider_terminal_kind TEXT,
  terminal_reason TEXT,
  contradiction_codes_json TEXT NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at DESC);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  sequence INTEGER NOT NULL,
  received_at INTEGER NOT NULL,
  source_occurred_at INTEGER,
  kind TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed', 'failed', 'declined', 'interrupted', 'unknown')),
  provenance TEXT NOT NULL CHECK (provenance IN ('observed', 'derived', 'git_recovered', 'recorder', 'human')),
  summary TEXT NOT NULL,
  normalized_payload_json TEXT,
  native_payload_storage TEXT CHECK (native_payload_storage IN ('inline', 'artifact', 'omitted')),
  native_payload_inline_json TEXT,
  native_payload_artifact_id TEXT,
  native_payload_omitted_reason TEXT,
  derivation_name TEXT,
  derivation_version TEXT,
  derivation_confidence TEXT CHECK (derivation_confidence IN ('high', 'medium', 'low')),
  UNIQUE (run_id, sequence),
  FOREIGN KEY (native_payload_artifact_id, run_id) REFERENCES artifacts(id, run_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_events_run_sequence ON events(run_id, sequence);

CREATE TABLE IF NOT EXISTS event_sources (
  event_id TEXT PRIMARY KEY REFERENCES events(id),
  run_id TEXT NOT NULL REFERENCES runs(id),
  provider TEXT NOT NULL,
  session_id TEXT,
  thread_id TEXT,
  turn_id TEXT,
  item_id TEXT,
  tool_id TEXT,
  event_type TEXT,
  item_type TEXT,
  correlation_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_event_sources_run_item_id ON event_sources(run_id, item_id);
CREATE INDEX IF NOT EXISTS idx_event_sources_run_turn_id ON event_sources(run_id, turn_id);

CREATE TABLE IF NOT EXISTS event_relationships (
  event_id TEXT NOT NULL REFERENCES events(id),
  related_event_id TEXT NOT NULL REFERENCES events(id),
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('derived_from', 'recovers', 'correlates_with')),
  PRIMARY KEY (event_id, related_event_id, relationship_type)
);

CREATE INDEX IF NOT EXISTS idx_event_relationships_related_event_id
  ON event_relationships(related_event_id);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id),
  kind TEXT NOT NULL,
  media_type TEXT NOT NULL,
  path TEXT NOT NULL,
  sha256 TEXT NOT NULL,
  byte_length INTEGER NOT NULL,
  redaction_state TEXT NOT NULL CHECK (redaction_state = 'redacted'),
  truncated INTEGER NOT NULL CHECK (truncated IN (0, 1)),
  original_byte_length INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (id, run_id),
  UNIQUE (path, run_id)
);

CREATE INDEX IF NOT EXISTS idx_artifacts_run_id ON artifacts(run_id);

CREATE TABLE IF NOT EXISTS git_evidence (
  run_id TEXT PRIMARY KEY REFERENCES runs(id),
  initial_head TEXT NOT NULL,
  final_head TEXT NOT NULL,
  initial_branch TEXT,
  final_branch TEXT,
  initial_status_artifact_id TEXT,
  final_status_artifact_id TEXT,
  tracked_final_diff_artifact_id TEXT,
  diff_check_artifact_id TEXT,
  diff_check_passed INTEGER NOT NULL CHECK (diff_check_passed IN (0, 1)),
  untracked_metadata_artifact_id TEXT,
  head_changed INTEGER NOT NULL CHECK (head_changed IN (0, 1)),
  branch_changed INTEGER NOT NULL CHECK (branch_changed IN (0, 1)),
  captured_at INTEGER NOT NULL,
  FOREIGN KEY (initial_status_artifact_id, run_id) REFERENCES artifacts(id, run_id),
  FOREIGN KEY (final_status_artifact_id, run_id) REFERENCES artifacts(id, run_id),
  FOREIGN KEY (tracked_final_diff_artifact_id, run_id) REFERENCES artifacts(id, run_id),
  FOREIGN KEY (diff_check_artifact_id, run_id) REFERENCES artifacts(id, run_id),
  FOREIGN KEY (untracked_metadata_artifact_id, run_id) REFERENCES artifacts(id, run_id)
);

CREATE TABLE IF NOT EXISTS redaction_audits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL REFERENCES runs(id),
  event_id TEXT REFERENCES events(id),
  artifact_id TEXT,
  reason TEXT NOT NULL,
  count INTEGER NOT NULL CHECK (count > 0),
  created_at INTEGER NOT NULL,
  FOREIGN KEY (artifact_id, run_id) REFERENCES artifacts(id, run_id)
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at INTEGER NOT NULL
);
