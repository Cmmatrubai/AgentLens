# Task 6.9 implementation report

## Outcome

Task 6.9 makes `runs` and `inspect` immutable, migration-free reads while adding
provider-neutral run summaries, current assessment projections, reviewer-note
visibility, and read-time ownership diagnosis. Automatic stale-run recovery now
runs only during clean `record` startup, before a new run ID/row is allocated or
the child is spawned.

Base: `c4729a311a19359b3e40a697057a7606e5d44022`

Codebase Memory verification used project `AgentLens-task6-implementation`,
generation `2026-08-30T19:52:37Z` (753 nodes / 2285 edges, zero skipped or
parse-partial production files). Candidate production paths were checked with
`check_index_coverage`; all returned `no_recorded_issue`. CLI tests excluded by
the fast-pattern were read directly.

## TDD evidence

### Untouched baseline

```text
pnpm test
Test Files  33 passed (33)
Tests       591 passed (591)
Exit        0
```

### RED

The named Task 6.9 RED suite was:

```text
pnpm vitest --run apps/cli/test/readArtifact.test.ts apps/cli/test/diagnoseOwnership.test.ts apps/cli/test/projectRunSummary.test.ts apps/cli/test/readCommands.integration.test.ts apps/cli/test/recordRun.integration.test.ts apps/cli/test/format.test.ts
```

It produced 14 failing behavior tests plus three missing-module suites, while 61
pre-existing tests passed. The failures demonstrated the old read-path
initialization/chmod/recovery behavior, WAL acceptance, missing summary/note and
artifact APIs, stale ownership mutation, and record recovery occurring at the
wrong command boundary.

The formatter-specific RED was:

```text
pnpm vitest --run apps/cli/test/format.test.ts
Test Files  1 failed (1)
Tests       3 failed (3)
Exit        1
```

Two focused refinements also went RED before their fixes:

```text
pnpm vitest --run apps/cli/test/diagnoseOwnership.test.ts
Tests       1 failed | 9 passed (10)

pnpm vitest --run apps/cli/test/readCommands.integration.test.ts -t 'diagnoses likely-stale ownership'
Tests       1 failed | 36 skipped (37)
```

These locked terminal ownership projection and the additive inspect ownership
diagnosis. A formatter refinement likewise failed 1 of 4 formatter tests before
missing ownership was rendered once as `unavailable`.

### GREEN

Focused Task 6.9 gate:

```text
pnpm vitest --run apps/cli/test/readArtifact.test.ts apps/cli/test/diagnoseOwnership.test.ts apps/cli/test/projectRunSummary.test.ts apps/cli/test/format.test.ts apps/cli/test/readCommands.integration.test.ts apps/cli/test/recordRun.integration.test.ts
Test Files  6 passed (6)
Tests       113 passed (113)
Exit        0
```

Assessment, derivation, and storage regressions:

```text
pnpm vitest --run apps/cli/test/assess.integration.test.ts packages/derivations/test packages/storage/test
Test Files  11 passed (11)
Tests       315 passed (315)
Exit        0
```

Complete CLI gate:

```text
pnpm vitest --run apps/cli/test
Test Files  18 passed (18)
Tests       266 passed (266)
Exit        0
```

Fresh full gate:

```text
pnpm test
Test Files  36 passed (36)
Tests       644 passed (644)
Exit        0

pnpm typecheck
Exit        0

git diff --check
Exit        0
```

One earlier full-suite candidate run observed the process-runner safety timer
fire before its expected source line under parallel load (`interruptedAt`
remained zero). The unchanged focused process-runner suite then passed 5/5, and
the fresh unchanged full suite above passed 644/644. No production change was
made for that transient timing failure.

### Post-review orphan-WAL and artifact-evidence fix round

Fix-round base: `7655c0ccc7be87ca99e70d26f523af60f1376a9d`

The fix round rechecked Codebase Memory project
`AgentLens-task6-implementation`, generation `2026-08-30T20:34:08Z` (782 nodes /
2436 edges, zero skipped or parse-partial files). The locator and all three
artifact consumers were traced, production candidates returned
`no_recorded_issue`, and the four excluded CLI tests were read directly.

The untouched fix-round baseline was:

```text
pnpm test
Test Files  36 passed (36)
Tests       644 passed (644)
Exit        0
```

The orphan-WAL RED was:

```text
pnpm vitest --run apps/cli/test/readOnlyDataRoot.test.ts apps/cli/test/readCommands.integration.test.ts -t 'WAL exists without|regular WAL without'
Test Files  2 failed (2)
Tests       4 failed | 40 skipped (44)
Exit        1
```

With a regular `agentlens.sqlite-wal` but no main database, the locator returned
`missing`, `runs` returned an empty list, and `inspect`/`assess` returned their
missing-run/storage errors. The smallest production change retains the already
no-follow-validated WAL existence result and raises the existing stable
`ReadOnlyDatabaseError("wal_present")` after validating the SHM sidecar and
before any SQLite open.

The added artifact regressions establish the shared identity/length/digest
boundary through native payload, reviewer-note, and untracked-metadata reads.
They cover root and bucket symlinks; cross-run, kind, media, redaction, and
length mismatches; complete/truncated behavior; invalid UTF-8 and JSON;
alternate, colliding, and noncanonical paths; restrictive omissions; and the
fact that `runs` never reads reviewer-note content. These behavior-preserving
tests exposed no additional production defect. Two candidate test fixtures were
corrected without production changes: `node:path.join` had normalized a planned
alternate spelling, and SQLite's `redaction_state = 'redacted'` check correctly
prevented an invalid row. Redaction rejection remains directly covered at the
shared DTO boundary and through the untracked consumer.

Fresh fix-round gates:

```text
pnpm vitest --run apps/cli/test/readOnlyDataRoot.test.ts apps/cli/test/readArtifact.test.ts apps/cli/test/projectRunSummary.test.ts apps/cli/test/readCommands.integration.test.ts
Test Files  4 passed (4)
Tests       99 passed (99)
Exit        0

pnpm vitest --run apps/cli/test
Test Files  18 passed (18)
Tests       302 passed (302)
Exit        0

pnpm test
Test Files  36 passed (36)
Tests       680 passed (680)
Exit        0

pnpm typecheck
Exit        0

git diff --check
Exit        0
```

## Implemented contract

- `runs` and `inspect` use `locateReadOnlyDataRoot` plus
  `openDatabaseReadOnly`; they never prepare, chmod, migrate, recover, derive,
  assess, or otherwise mutate storage.
- Existing root/database/WAL/SHM paths are lstat/open/no-follow validated. Any
  regular WAL remains the stable `wal_present` refusal; regular SHM without WAL
  is accepted untouched.
- Recursive before/after snapshots compare path, type, mode, uid, gid, size,
  mtime nanoseconds, inode, symlink target, and SHA-256 across database,
  sidecars, artifacts, secrets, unknown files, and external symlink targets.
- Missing storage preserves the existing empty/not-found contracts and creates
  nothing. A Task 5 schema remains at migrations `1,2,3` after both reads.
- Ownership diagnosis is a point-in-time, non-durable projection. Stored
  condition remains separate; stale evidence says `likely_stale`, never
  recovered.
- `record` now rejects dirty Git before touching existing storage, then prepares
  writable storage, opens/hardens it, constructs the repository, recovers older
  eligible runs, captures the new recorder identity/resources, allocates the new
  run, prints its ID, and spawns the child. Setup failures close the database.
- One generic content-addressed artifact reader validates metadata, canonical
  path, no-follow file identity, lengths, digest, and completeness. Native
  payloads, untracked metadata, and standard reviewer notes all use it.
- Summaries preserve `detected`, `none_detected`, and
  `unavailable_due_to_capture_policy`, chronological failed-then-passed history,
  derivation durability/coverage, projected versus explicit human assessment,
  provider limitations, and validated untracked counts without paths.
- Inspect retains derivation identity and `derived_from` source relationships;
  Provider, Derived, Git recovered, Recorder, Recorder recovery, and Human text
  labels remain distinct.
- Runs never reads reviewer-note content. Inspect exposes only validated,
  already-redacted standard note text; restrictive capture reports the exact
  omission without reading content.

## Diff review

The final review searched the changed production paths for hidden
initialization, writable database open, chmod, recovery, filesystem writes,
unqualified `tests passed`, placeholders, and TODO/FIXME markers. No forbidden
read-path call or wording remains. Storage schemas/migrations, assess semantics,
derivation semantics, adapters, doctor, and UI were not changed.

## Deviations and residual risks

- Necessary compatibility deviation: the legacy crash-recovery integration test
  was updated because it expected `inspect` to perform recovery. It now proves
  inspect diagnoses only, while successive clean `record` startups perform the
  orphan and terminal recovery transitions. Production crash/recovery semantics
  were not weakened.
- No storage DTO or migration change was required.
- The accepted same-owner pathname-replacement residual remains: no claim is
  made that filesystem path validation and SQLite/artifact open are globally
  atomic. Final components are nevertheless lstat/open/no-follow checked and
  handle identity is verified.
- WAL handling intentionally remains fail-closed. A reader does not checkpoint,
  delete, or decide that a present WAL is stale.
- Process ownership diagnosis is inherently point-in-time; ambiguous or failed
  inspection returns `unknown` and never changes durable state.
