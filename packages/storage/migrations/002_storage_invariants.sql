CREATE UNIQUE INDEX IF NOT EXISTS idx_events_id_run_id ON events(id, run_id);

ALTER TABLE event_relationships RENAME TO event_relationships_v1;

CREATE TABLE event_relationships (
  event_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  related_event_id TEXT NOT NULL,
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('derived_from', 'recovers', 'correlates_with')),
  PRIMARY KEY (event_id, related_event_id, relationship_type),
  FOREIGN KEY (event_id, run_id) REFERENCES events(id, run_id),
  FOREIGN KEY (related_event_id, run_id) REFERENCES events(id, run_id)
);

INSERT INTO event_relationships (
  event_id, run_id, related_event_id, relationship_type
)
SELECT relationships.event_id, source_event.run_id,
  relationships.related_event_id, relationships.relationship_type
FROM event_relationships_v1 AS relationships
JOIN events AS source_event ON source_event.id = relationships.event_id;

DROP TABLE event_relationships_v1;

CREATE INDEX idx_event_relationships_related_event_id
  ON event_relationships(run_id, related_event_id);

CREATE UNIQUE INDEX idx_event_relationships_one_recovery
  ON event_relationships(run_id, related_event_id)
  WHERE relationship_type = 'recovers';

ALTER TABLE git_evidence RENAME TO git_evidence_v1;

CREATE TABLE git_evidence (
  run_id TEXT PRIMARY KEY REFERENCES runs(id),
  initial_head TEXT NOT NULL,
  final_head TEXT NOT NULL,
  initial_branch TEXT,
  final_branch TEXT,
  initial_status_state TEXT NOT NULL CHECK (initial_status_state IN ('artifact', 'omitted')),
  initial_status_artifact_id TEXT,
  initial_status_omission_reason TEXT,
  final_status_state TEXT NOT NULL CHECK (final_status_state IN ('artifact', 'omitted')),
  final_status_artifact_id TEXT,
  final_status_omission_reason TEXT,
  tracked_final_diff_state TEXT NOT NULL CHECK (tracked_final_diff_state IN ('artifact', 'omitted', 'absent')),
  tracked_final_diff_artifact_id TEXT,
  tracked_final_diff_omission_reason TEXT,
  diff_check_state TEXT NOT NULL CHECK (diff_check_state IN ('artifact', 'omitted')),
  diff_check_artifact_id TEXT,
  diff_check_omission_reason TEXT,
  diff_check_passed INTEGER NOT NULL CHECK (diff_check_passed IN (0, 1)),
  untracked_metadata_state TEXT NOT NULL CHECK (untracked_metadata_state IN ('artifact', 'omitted', 'absent')),
  untracked_metadata_artifact_id TEXT,
  untracked_metadata_omission_reason TEXT,
  head_changed INTEGER NOT NULL CHECK (head_changed IN (0, 1)),
  branch_changed INTEGER NOT NULL CHECK (branch_changed IN (0, 1)),
  captured_at INTEGER NOT NULL,
  CHECK (
    (initial_status_state = 'artifact' AND initial_status_artifact_id IS NOT NULL AND initial_status_omission_reason IS NULL)
    OR
    (initial_status_state = 'omitted' AND initial_status_artifact_id IS NULL AND initial_status_omission_reason IN ('metadata-only', 'strict', 'legacy-unspecified'))
  ),
  CHECK (
    (final_status_state = 'artifact' AND final_status_artifact_id IS NOT NULL AND final_status_omission_reason IS NULL)
    OR
    (final_status_state = 'omitted' AND final_status_artifact_id IS NULL AND final_status_omission_reason IN ('metadata-only', 'strict', 'legacy-unspecified'))
  ),
  CHECK (
    (tracked_final_diff_state = 'artifact' AND tracked_final_diff_artifact_id IS NOT NULL AND tracked_final_diff_omission_reason IS NULL)
    OR
    (tracked_final_diff_state = 'omitted' AND tracked_final_diff_artifact_id IS NULL AND tracked_final_diff_omission_reason IN ('metadata-only', 'strict', 'legacy-unspecified'))
    OR
    (tracked_final_diff_state = 'absent' AND tracked_final_diff_artifact_id IS NULL AND tracked_final_diff_omission_reason IS NULL)
  ),
  CHECK (
    (diff_check_state = 'artifact' AND diff_check_artifact_id IS NOT NULL AND diff_check_omission_reason IS NULL)
    OR
    (diff_check_state = 'omitted' AND diff_check_artifact_id IS NULL AND diff_check_omission_reason IN ('metadata-only', 'strict', 'legacy-unspecified'))
  ),
  CHECK (
    (untracked_metadata_state = 'artifact' AND untracked_metadata_artifact_id IS NOT NULL AND untracked_metadata_omission_reason IS NULL)
    OR
    (untracked_metadata_state = 'omitted' AND untracked_metadata_artifact_id IS NULL AND untracked_metadata_omission_reason IN ('metadata-only', 'strict', 'legacy-unspecified'))
    OR
    (untracked_metadata_state = 'absent' AND untracked_metadata_artifact_id IS NULL AND untracked_metadata_omission_reason IS NULL)
  ),
  FOREIGN KEY (initial_status_artifact_id, run_id) REFERENCES artifacts(id, run_id),
  FOREIGN KEY (final_status_artifact_id, run_id) REFERENCES artifacts(id, run_id),
  FOREIGN KEY (tracked_final_diff_artifact_id, run_id) REFERENCES artifacts(id, run_id),
  FOREIGN KEY (diff_check_artifact_id, run_id) REFERENCES artifacts(id, run_id),
  FOREIGN KEY (untracked_metadata_artifact_id, run_id) REFERENCES artifacts(id, run_id)
);

INSERT INTO git_evidence (
  run_id, initial_head, final_head, initial_branch, final_branch,
  initial_status_state, initial_status_artifact_id, initial_status_omission_reason,
  final_status_state, final_status_artifact_id, final_status_omission_reason,
  tracked_final_diff_state, tracked_final_diff_artifact_id, tracked_final_diff_omission_reason,
  diff_check_state, diff_check_artifact_id, diff_check_omission_reason, diff_check_passed,
  untracked_metadata_state, untracked_metadata_artifact_id, untracked_metadata_omission_reason,
  head_changed, branch_changed, captured_at
)
SELECT
  run_id, initial_head, final_head, initial_branch, final_branch,
  CASE WHEN initial_status_artifact_id IS NULL THEN 'omitted' ELSE 'artifact' END,
  initial_status_artifact_id,
  CASE WHEN initial_status_artifact_id IS NULL THEN 'legacy-unspecified' ELSE NULL END,
  CASE WHEN final_status_artifact_id IS NULL THEN 'omitted' ELSE 'artifact' END,
  final_status_artifact_id,
  CASE WHEN final_status_artifact_id IS NULL THEN 'legacy-unspecified' ELSE NULL END,
  CASE WHEN tracked_final_diff_artifact_id IS NULL THEN 'absent' ELSE 'artifact' END,
  tracked_final_diff_artifact_id,
  NULL,
  CASE WHEN diff_check_artifact_id IS NULL THEN 'omitted' ELSE 'artifact' END,
  diff_check_artifact_id,
  CASE WHEN diff_check_artifact_id IS NULL THEN 'legacy-unspecified' ELSE NULL END,
  diff_check_passed,
  CASE WHEN untracked_metadata_artifact_id IS NULL THEN 'absent' ELSE 'artifact' END,
  untracked_metadata_artifact_id,
  NULL,
  head_changed, branch_changed, captured_at
FROM git_evidence_v1;

DROP TABLE git_evidence_v1;
