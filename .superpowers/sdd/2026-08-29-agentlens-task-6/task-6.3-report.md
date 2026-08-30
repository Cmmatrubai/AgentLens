# Task 6.3 implementation report

Status: **VERIFIED and ready for the mandated Task 6.3 commit**

Branch: `codex/agentlens-task-6-impl`

Original implementation base: `dc9a486554705c217592f86823b2798235049de5`

Final frozen design base: `7f8182a0f4abbb86bee04a62cdd58937088994e7`

## Completed evidence

### Clean base and baseline

- The assigned linked worktree was clean at the exact required base commit.
- The pre-change storage baseline passed: 4 files and 58 tests.

### Migration RED

Command:

    pnpm vitest --run packages/storage/test/migrations.test.ts

Observed RED: 1 file failed; 6 tests failed for the intended missing-004 reasons:

- Task 6 tables and indexes were absent.
- applied migrations were `[1, 2, 3]`, not `[1, 2, 3, 4]`.
- `derivation_identities` did not exist.
- a populated migration-003 fixture had not advanced to migration 004.
- future migration inspection omitted version 4.

### Migration GREEN

The minimal forward-only migration and ordered migration entry were added. The first GREEN run exposed that SQLite accepts a CHECK expression whose result is NULL: the omitted-note tuple with a NULL omission reason passed until the tuple CHECK explicitly required `note_omission_reason IS NOT NULL`.

After that root-cause fix:

    Test Files  1 passed (1)
    Tests       6 passed (6)

The migration tests cover the existing unique parent index `idx_events_id_run_id`, same-run event/artifact foreign keys, identity and natural-tuple uniqueness, valid and invalid note-state tuples, empty Task 6 tables after migration, future migration visibility, and logical preservation of populated Task 1-5 evidence.

### Read-only RED

Command:

    pnpm vitest --run packages/storage/test/readOnlyDatabase.test.ts

Observed RED: 4 tests failed because `openDatabaseReadOnly` did not exist. The suite covers current schema, migration 003, missing `schema_migrations`, corrupt SQLite, missing/non-regular paths, write rejection, and a live WAL.

## Blocking WAL evidence

After minimally adding the required `better-sqlite3` `readonly: true`, `fileMustExist: true`, `foreign_keys = ON`, and `query_only = ON` path, the read-only suite proved filesystem mutation.

Command:

    pnpm vitest --run packages/storage/test/readOnlyDatabase.test.ts

Observed result: 1 file failed; 3 tests failed and 3 passed.

### Closed WAL database

Before open/inspect/close, both sidecars were absent. Afterwards:

- `agentlens.sqlite-wal` existed with size 0 and SHA-256 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`.
- `agentlens.sqlite-shm` existed with size 32768 and SHA-256 `fd4c9fda9cd3f9ae7c962b0ddf37232294d55580e1aa165aa06129b8549389eb`.
- the main database mode, size, mtime, inode, and hash stayed unchanged.

### Live WAL database

With a writable connection kept open and an uncheckpointed migration/run row in the WAL, all three files existed before the reader opened. After read-only open/inspect/close:

- the main database snapshot was unchanged;
- the WAL snapshot was unchanged;
- the SHM mode, size (32768), mtime, device, and inode were unchanged;
- the SHM content hash changed from `bf41d2559af8a5e92775672db1bf4c180d640a178c38a93cf50fb4b40168d55a` to `60979cca943eff8de0fbb51f9ebafe0696d4805c990efab324a458bf22c26b5a`.

This directly violates the frozen requirement that read-only operations leave DB/WAL/SHM modes, size, mtime, inode, and hashes unchanged. The brief explicitly requires stopping at this point rather than inventing a snapshot/copy/temp strategy or weakening the contract.

## Historical stopped state before the approved amendments

- Schema capability detection was not started.
- Public-surface tests were not updated.
- Full storage, full repository, typecheck, and final diff verification were not run after the blocker.
- The corrupt-file test also showed that opening the handle alone does not validate SQLite bytes; validation currently occurs on inspection. No change was attempted because the WAL blocker requires stopping first.
- No commit was created.

## Uncommitted files

- `packages/storage/migrations/004_task6_evaluation.sql`
- `packages/storage/src/database.ts`
- `packages/storage/src/index.ts`
- `packages/storage/test/migrations.test.ts`
- `packages/storage/test/readOnlyDatabase.test.ts`
- this report

No other files were edited, and Task 6.4 was not started.

## Resumed implementation after approved fail-closed WAL amendment

The user approved the fail-closed WAL amendment in committed spec/plan revision
`25749ecc6249c66c52be765fa6ce2d6b87e98ddf`. The preserved migration work was
kept, the disposable ordinary-readonly product opener was removed, and the
read-only phase restarted with tests first.

### Amended read-only RED

The revised suite asserts:

- immutable inspection of checkpointed current and migration-003 main databases;
- exact root and entry snapshots including type, mode, size, mtime nanoseconds,
  device, inode, regular-file SHA-256, and symlink target;
- main-database visibility through `RunRepository`;
- readonly write rejection;
- bounded missing, non-regular, corrupt, and missing-schema behavior;
- stable `wal_present` refusal for an empty file, stale bytes, directory, and
  symlink at the exact `<database>-wal` path;
- `wal_present` before SQLite inspection when the main bytes are corrupt.

After removing the prior opener:

    Test Files  1 failed (1)
    Tests       8 failed | 2 passed (10)

The failures were the intended missing immutable opener and missing
`wal_present` reason.

### Fail-closed WAL preflight result

The minimal implementation checks the existing regular main database, lstat's
the exact WAL path without following it, and returns an error with
`reason: "wal_present"` before SQLite open whenever that path exists.

All amended WAL refusal cases passed, including the corrupt-main fixture. Their
complete before/after storage snapshots were equal.

### New immutable-open incompatibility

The same focused command then produced:

    Test Files  1 failed (1)
    Tests       3 failed | 7 passed (10)

The three clean no-WAL success fixtures all failed at the SQLite constructor:

    SqliteError: unable to open database file

Affected fixtures:

- checkpointed current schema with a durable run;
- checkpointed migration-003 schema;
- a valid SQLite database without `schema_migrations`.

The attempted immutable filename was a `file:///.../agentlens.sqlite?immutable=1`
URI supplied with `readonly: true` and `fileMustExist: true`.

The installed `better-sqlite3` 12.11.1 build cannot activate that URI:

- `src/objects/database.cpp` constructs the `sqlite3_open_v2` mask from
  `SQLITE_OPEN_READONLY`/`SQLITE_OPEN_READWRITE` but does not include
  `SQLITE_OPEN_URI`;
- `deps/defines.gypi` sets `SQLITE_USE_URI=0`.

SQLite therefore treats the immutable URI as a literal filename and
`fileMustExist` returns `unable to open database file`. The amended stop rule
requires stopping when immutable no-WAL access cannot read a clean checkpointed
database correctly.

No alternative library, native dependency patch, copy, checkpoint, snapshot,
sidecar cleanup, ordinary readonly fallback, or weakened immutable contract was
attempted. At that checkpoint, schema capability detection, public-surface
completion, final full verification, and commit were blocked. Task 6.4 was not
started.

## Corrected dependency mechanism and completed implementation

The controller corrected the incomplete native-addon diagnosis and froze the
binding implementation ruling in commit
`7f8182a0f4abbb86bee04a62cdd58937088994e7`. The installed
`better-sqlite3` addon provides `Addon::ConfigureURI`, which reads
`SQLITE_USE_URI` exactly once when the first `Database` constructor lazily loads
the native addon. Merely importing the JavaScript module does not initialize
that hook.

### Constructor-initialization RED and GREEN

Fresh-process tests were added before the centralized constructor factory. They
cover both an initially absent `SQLITE_USE_URI` property and an exact
preexisting value, and they require writable open to be the first AgentLens
constructor before immutable read-only inspection. A separate fresh process
initializes the addon through a foreign raw constructor with URI support off and
requires a clear immutable failure without fallback.

Before the factory, the amended focused suite produced:

    Test Files  1 failed (1)
    Tests       6 failed | 7 passed (13)

The minimal factory synchronously saves whether the environment property
existed and its exact value, sets `SQLITE_USE_URI=1`, constructs the connection,
and restores or deletes the property in `finally`. Both writable and immutable
read-only AgentLens opens use this factory; writable filenames remain ordinary
paths. No dependency was patched and no environment change remains after a
constructor returns or throws.

After implementation:

    Test Files  1 passed (1)
    Tests       13 passed (13)

The foreign-first fixture returns `ReadOnlyDatabaseError` with stable reason
`immutable_unavailable` and restores the exact preexisting environment value.
There is deliberately no ordinary-readonly fallback.

### Filesystem invariance and fail-closed WAL evidence

Successful immutable reads of checkpointed current-schema, migration-003, and
missing-`schema_migrations` databases preserve exact root and entry snapshots.
The snapshots compare path type, mode, size, mtime in nanoseconds, device,
inode, regular-file SHA-256, and symlink target. The current-schema fixture also
proves that the durable main-database run is visible and that a repository write
fails readonly.

Every exact `<database>-wal` presence case (empty file, stale bytes, directory,
and symlink) is rejected with `reason: "wal_present"` before SQLite open. A
corrupt-main-plus-WAL fixture proves the preflight order. Every refusal preserves
the exact root, main database, WAL path, SHM path if present, and all other root
entries. Missing, directory, symlink, and corrupt main-database behavior is also
bounded and non-mutating.

### Schema capability detection RED and GREEN

Repository tests were added first for a current database and a populated
migration-003 database. RED was:

    Test Files  1 failed (1)
    Tests       2 failed | 49 passed (51)

`RunRepository` now records the three individual table capabilities from one
`sqlite_master` query. The migration-003 fixture reports all three false while
`listRuns` and `getRunDetail` continue to use only the Task 5 schema. GREEN was:

    Test Files  1 passed (1)
    Tests       51 passed (51)

No Task 6.4 joins, derivation reads, or assessment behavior were added.

### Public surface RED and GREEN

The public-surface test was made to require `openDatabaseReadOnly`,
`ReadOnlyDatabaseError`, its stable reason union, and the foreign-key violation
inspection shape while those exports were absent. RED was one failure and one
pass. Restoring the intended exports produced 2 of 2 passing tests.

## Final verification

Focused Task 6.3 verification:

    Test Files  4 passed (4)
    Tests       72 passed (72)

All storage tests:

    Test Files  5 passed (5)
    Tests       77 passed (77)

Full repository test suite:

    Test Files  28 passed (28)
    Tests       385 passed (385)

TypeScript project build:

    pnpm typecheck
    $ tsc -b --pretty false

`git diff --check` completed with no output. Manual SQL review confirmed that
migration 004 contains only new Task 6 tables and indexes: no `ALTER`, `UPDATE`,
backfill, or redundant `idx_events_id_run_id`. The migration tests assert that
the migration-002 composite parent index exists before exercising the same-run
foreign keys and that populated Task 1-5 evidence is logically unchanged.
The review also found that the implemented run/artifact binding index lacked an
explicit assertion. Removing the index while adding that assertion produced the
intended 1-failed/5-passed RED; restoring it returned the migration suite to 6
of 6 GREEN.

## Final scope

Task 6.3 changes are limited to the eight owned storage source/test/migration
paths plus this authorized durable report:

- `packages/storage/migrations/004_task6_evaluation.sql`
- `packages/storage/src/database.ts`
- `packages/storage/src/index.ts`
- `packages/storage/src/runRepository.ts`
- `packages/storage/test/migrations.test.ts`
- `packages/storage/test/readOnlyDatabase.test.ts`
- `packages/storage/test/runRepository.test.ts`
- `packages/storage/test/publicSurface.test.ts`
- `.superpowers/sdd/2026-08-29-agentlens-task-6/task-6.3-report.md`

Task 6.4 was not started.

## Residual risks accepted by the frozen design

- URI configuration is a process-global, first-native-constructor dependency
  hook. If a foreign consumer initializes the addon first with URI support off,
  immutable AgentLens inspection fails explicitly with `immutable_unavailable`.
- AgentLens read/inspect/doctor database checks are unavailable whenever any
  exact WAL path remains, including empty, stale, symlink, or non-regular paths.
- The environment override is synchronous and restored in `finally`, but it is
  still a dependency-specific initialization mechanism that must be revisited
  if `better-sqlite3` changes its native startup contract.
- Corrupt SQLite bytes can construct an immutable handle; the bounded error is
  raised when inspection first reads the schema. No filesystem mutation occurs.
