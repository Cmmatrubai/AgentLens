CREATE TABLE run_ownership (
  run_id TEXT PRIMARY KEY REFERENCES runs(id),
  recorder_instance_id TEXT NOT NULL,
  recorder_pid INTEGER NOT NULL CHECK (recorder_pid > 0),
  recorder_start_token TEXT NOT NULL,
  child_pid INTEGER CHECK (child_pid IS NULL OR child_pid > 0),
  child_start_token TEXT,
  child_process_group_id INTEGER CHECK (
    child_process_group_id IS NULL OR child_process_group_id > 0
  ),
  heartbeat_at INTEGER NOT NULL,
  condition TEXT NOT NULL CHECK (
    condition IN (
      'active',
      'orphan_child_active',
      'identity_ambiguous',
      'reconciling',
      'released'
    )
  ),
  ownership_lost_event_id TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (ownership_lost_event_id, run_id) REFERENCES events(id, run_id),
  CHECK (
    (child_pid IS NULL AND child_start_token IS NULL AND child_process_group_id IS NULL)
    OR
    child_pid IS NOT NULL
  )
);

CREATE INDEX idx_run_ownership_condition
  ON run_ownership(condition, heartbeat_at);
