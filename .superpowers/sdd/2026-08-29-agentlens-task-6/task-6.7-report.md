# Task 6.7 implementation report

## Scope

- Base HEAD: `d34092b6ac826662927217abd45f69253f500ac6`.
- Implemented only append-only human-assessment storage and its focused repository tests.
- Production changes are confined to `packages/storage/src/runRepository.ts`; `packages/storage/src/index.ts` did not need modification because it already exports the repository module.
- Did not modify migration 004, recorder, CLI, derivations, frozen design/plan documents, or any Task 6.8+ surface.
- Used the existing isolated `<worktree>` on `codex/agentlens-task-6-impl`.

## TDD evidence

### Baseline

    pnpm vitest --run packages/storage/test/runRepository.test.ts

Result before Task 6.7 changes: exit 0; 1 file and 56 tests passed.

### Required missing-API RED

All required and adversarial assessment cases were added before production code.

    pnpm vitest --run packages/storage/test/runRepository.test.ts -t "human assessment" --reporter=dot

Result: exit 1; 23 selected tests failed and 56 were skipped. The Task 5 projection case failed with `repository.getCurrentAssessment is not a function`; the remaining 22 cases failed with `repository.updateAssessment is not a function`. Test setup and fixture construction succeeded.

The focused Task 5 fixture initially exposed an existing test-order dependency: better-sqlite3 URI handling had only been initialized by earlier tests in a full-file run. The fixture now initializes URI handling itself, after which its RED failure was the expected missing `getCurrentAssessment` API.

### Focused GREEN

    pnpm vitest --run packages/storage/test/runRepository.test.ts -t "human assessment" --reporter=dot

Result: exit 0; 23 selected tests passed and 56 were skipped.

### Repository and storage GREEN

    pnpm vitest --run packages/storage/test/runRepository.test.ts

Result: exit 0; 1 file and 79 tests passed.

    pnpm vitest --run packages/storage/test

Result: exit 0; 5 files and 106 tests passed.

## Contract decisions

- Added `AssessmentVerdict`, `TaskCompletion`, input `AssessmentNoteRef`, stored `AssessmentNoteProjection`, `UpdateAssessmentInput`, and discriminated projected/explicit current-assessment types.
- `getCurrentAssessment(runId)` first validates the run, then returns an immutable projected `unreviewed`/`uncertain`/absent value when migration 004 or a current row is absent. It never queries missing Task 6 tables.
- `updateAssessment(input, noteAudits)` validates structured fields before mutation. Omitted task completion becomes `uncertain`; omitted note becomes `absent`; explicit `unreviewed` accepts only `uncertain` task completion.
- Each call creates a fresh `assessment.updated` event supplied by the caller's event ID and timestamp. The event is completed/human, has provider-only source, no relationships, no native payload or derivation, a content-free summary, and only structured verdict/task/note reference data.
- The artifact file identity/path/realpath/symlink/length/digest validation formerly embedded in `commitArtifactMetadata` is now a shared private boundary. The opened file is validated by device, inode, length, and digest and its handle remains open through the SQLite transaction; this validates the opened bytes but does not preserve pathname identity through commit.
- Assessment notes require same-run ownership, `assessment-note` kind, `text/plain; charset=utf-8`, and redacted state. New metadata and audits are inserted inside the assessment transaction.
- Same-run content-addressed reuse revalidates the file and requires every stored metadata field and artifact audit to match. It does not duplicate artifact or audit rows, but each human action gets a distinct event-to-artifact binding.
- One immediate transaction inserts/reuses artifact metadata and audits, allocates the event sequence, appends the human event and binding, and upserts the current projection. The upsert preserves the original `reviewed_at`, advances `current_event_id`, and keeps `updated_at` at the latest accepted event timestamp, which may equal the prior value for actions in the same millisecond.
- No historical event, binding, artifact, audit, observed/derived/recorder evidence, Git evidence, run fact, or ownership row is updated or deleted.

## Required and adversarial coverage

- First assessment/current row, default uncertain, default absent, fixed `reviewedAt`, advancing current event with a nondecreasing update timestamp, repeated identical actions, immutable old human events/bindings, and logical immutability of observed/derived/recorder/Git evidence.
- Explicit unreviewed rejection/acceptance rules and standard, metadata-only, and strict note states.
- Provider-only source, null lifecycle/correlation columns, no relationships/native payload/derivation, content-free summary, and absence of reviewer-note bytes from SQLite/WAL/SHM and the event object.
- Same-run artifact reuse, exact audit reuse, physical file revalidation, cross-run committed artifact ownership, cross-run event ownership, and transaction rollback with an allowed orphan file.
- Invalid verdict/task enums, invalid timestamp, malformed note tuples, non-canonical/missing/symlinked/digest-mismatched/length-mismatched files, artifact kind/media/redaction mismatches, and non-positive/non-integer audit counts.
- Task 5 read-only schema compatibility.

## Files changed

- `packages/storage/src/runRepository.ts`
- `packages/storage/test/runRepository.test.ts`
- `.superpowers/sdd/2026-08-29-agentlens-task-6/task-6.7-report.md`

## Verification

    pnpm test

Result: exit 0; 31 files and 484 tests passed.

    pnpm typecheck

Result: exit 0 (`tsc -b --pretty false`).

    git diff --check

Result: exit 0 with no output.

Manual diff/scope/privacy review found no mutable historical evidence, note text in event or SQLite storage, weak same-run artifact reuse, cross-run note/event acceptance, Task 6.8 implementation, or changed production file outside the assigned storage repository.

## Deviations and residual risks

- No frozen Task 6.7 contract deviation is known.
- The focused Task 5 test fixture now initializes SQLite URI handling independently; this is test-only and fixes a pre-existing order dependency without changing production database behavior.
- Artifact file creation and SQLite cannot be atomic together. As frozen, a completed note file can remain orphaned when the database transaction fails; no SQLite row references it.
- Note redaction, the 16 KiB pre-write bound, and CLI validation-before-write orchestration remain intentionally deferred to Task 6.8.
- Independent review was not dispatched because the assignment explicitly prohibited subagents; the controller retains the independent acceptance review.

## Fix round 1: assessment evidence invariants

### TDD evidence

The reviewer cases were added before the fix.

    pnpm vitest --run packages/storage/test/runRepository.test.ts -t "human assessment" --reporter=dot

RED result: exit 1; 16 of 44 selected tests failed, 28 passed, and 56 were skipped. The failures included the original two timestamp-boundary cases, six capture-policy/note-state mismatches, and eight invalid artifact-length tuples. Fix round 2 below corrects the original equal-timestamp interpretation. Four tuple-shape cases were accepted, two restrictive-policy artifacts reached the missing-file check instead of policy rejection, and the remaining cases failed with older nonspecific validation errors.

After the smallest production change, the same command was GREEN: exit 0; 44 selected tests passed and 56 were skipped.

### Contract decisions

- A subsequent assessment loads the existing current row inside the immediate transaction and rejects only `receivedAt < updated_at` before any artifact metadata, audit, event, binding, or current-row write. Earlier timestamps roll back. Equal timestamps append a distinct action and advance `current_event_id` while leaving `updated_at` equal; later timestamps advance both. The first `reviewed_at` is preserved in every accepted case.
- The shared completed-artifact boundary now requires non-negative integer `byteLength` and `originalByteLength`. An untruncated artifact requires equal lengths; a truncated artifact requires `originalByteLength` to be strictly greater. Valid truncated note artifacts remain supported, and physical file length and digest validation remains in place.
- Capture-policy enforcement belongs at the storage mutation boundary as defense in depth. The frozen design assigns standard note content to redacted artifacts and restrictive note content to structured omission; Task 6.7 requires run and structured-field validation in the transaction, while Task 6.8 reads the run policy to choose the representation. Storage therefore accepts absent/artifact for `standard`, absent/matching omission for `metadata-only` and `strict`, and rejects mismatched omissions and all restrictive-policy artifacts. This is checked before artifact file access and rechecked against the transaction's run row.

### Verification

    pnpm vitest --run packages/storage/test/runRepository.test.ts

Result: exit 0; 1 file and 100 tests passed.

    pnpm vitest --run packages/storage/test

Result: exit 0; 5 files and 127 tests passed.

    pnpm test

Result: exit 0; 31 files and 505 tests passed.

    pnpm typecheck

Result: exit 0 (`tsc -b --pretty false`).

### Residual filesystem risk

Holding the validated file descriptor open does not preserve pathname identity through the SQLite commit. A concurrent process running as the same owner can replace the artifact pathname after validation, so the persisted pathname may later resolve to different bytes. Owner-only directories plus canonical-path, symlink, device/inode, length, and digest checks reduce the exposure but do not make filesystem and SQLite updates atomic. This fix round intentionally does not claim or invent such atomicity.

## Fix round 2: same-timestamp actions

The frozen append-only rule treats every successful invocation as a distinct human action, and separate actions can share the same millisecond. The timestamp guard therefore prevents only regression; equality is accepted.

### TDD evidence

    pnpm vitest --run packages/storage/test/runRepository.test.ts -t "human assessment" --reporter=dot

RED result: exit 1; 2 selected tests failed, 42 passed, and 56 were skipped. The equal-timestamp action was rejected by the old strict-advance guard, and the earlier-timestamp test exposed the old strict-advance error contract.

After changing only the comparison and regression error, the same command was GREEN: exit 0; 44 selected tests passed and 56 were skipped. The equal-timestamp test proves two distinct `assessment.updated` events with sequences 0 and 1, an advanced `currentEventId`, preserved `reviewedAt`, and equal `updatedAt`.

### Verification

- Repository: 100/100 tests passed.
- Storage: 127/127 tests passed across 5 files.
- Full suite: 505/505 tests passed across 31 files.
- Typecheck: exit 0 (`tsc -b --pretty false`).
