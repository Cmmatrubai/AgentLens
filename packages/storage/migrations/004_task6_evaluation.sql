CREATE TABLE derivation_identities (
  run_id TEXT NOT NULL,
  identity TEXT NOT NULL,
  source_event_id TEXT NOT NULL,
  derivation_name TEXT NOT NULL,
  derivation_version TEXT NOT NULL,
  derived_kind TEXT NOT NULL CHECK (derived_kind IN ('test.command', 'test.result')),
  derived_event_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (run_id, identity),
  UNIQUE (run_id, source_event_id, derivation_name, derivation_version, derived_kind),
  UNIQUE (derived_event_id, run_id),
  FOREIGN KEY (source_event_id, run_id) REFERENCES events(id, run_id),
  FOREIGN KEY (derived_event_id, run_id) REFERENCES events(id, run_id)
);

CREATE INDEX idx_derivation_identities_run_source
  ON derivation_identities(run_id, source_event_id);

CREATE TABLE current_assessments (
  run_id TEXT PRIMARY KEY REFERENCES runs(id),
  current_event_id TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('unreviewed', 'success', 'partial', 'failure')),
  task_completion TEXT NOT NULL CHECK (task_completion IN ('yes', 'no', 'uncertain')),
  note_state TEXT NOT NULL CHECK (note_state IN ('absent', 'artifact', 'omitted')),
  note_artifact_id TEXT,
  note_omission_reason TEXT CHECK (note_omission_reason IN ('metadata-only', 'strict')),
  reviewed_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (
    (note_state = 'absent' AND note_artifact_id IS NULL AND note_omission_reason IS NULL)
    OR
    (note_state = 'artifact' AND note_artifact_id IS NOT NULL AND note_omission_reason IS NULL)
    OR
    (note_state = 'omitted' AND note_artifact_id IS NULL
      AND note_omission_reason IS NOT NULL
      AND note_omission_reason IN ('metadata-only', 'strict'))
  ),
  FOREIGN KEY (current_event_id, run_id) REFERENCES events(id, run_id),
  FOREIGN KEY (note_artifact_id, run_id) REFERENCES artifacts(id, run_id)
);

CREATE TABLE event_artifact_bindings (
  event_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  artifact_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role = 'assessment_note'),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (event_id, artifact_id, role),
  FOREIGN KEY (event_id, run_id) REFERENCES events(id, run_id),
  FOREIGN KEY (artifact_id, run_id) REFERENCES artifacts(id, run_id)
);

CREATE INDEX idx_event_artifact_bindings_run_event
  ON event_artifact_bindings(run_id, event_id);

CREATE INDEX idx_event_artifact_bindings_run_artifact
  ON event_artifact_bindings(run_id, artifact_id);
