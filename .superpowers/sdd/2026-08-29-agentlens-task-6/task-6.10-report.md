# Task 6.10 implementation report

## Outcome

Task 6.10 adds a read-only `agentlens doctor` command with stable JSON/text
output, fail-closed storage diagnosis, local capability probes, privacy-safe
summaries, and exit status derived from the overall diagnostic result. The
command does not initialize, repair, migrate, chmod, recover, or otherwise
mutate AgentLens storage.

Base: `3565febb942b919d94e0f4fb9e3afc67b72ce1c9`

The binding brief supplied verified Codebase Memory evidence for project
`AgentLens-task6-implementation`, generation `2026-08-30T21:01:52Z` (782 nodes
/ 2438 edges, zero skipped or parse-partial production files). Coverage for
`args.ts`, `main.ts`, `readOnlyDataRoot.ts`, `processIdentity.ts`, `dataRoot.ts`,
and storage `database.ts` was `metadata_match` with no recorded issue. Tests and
migrations excluded by the fast-pattern were read directly before editing.

## TDD evidence

### Untouched baseline

The first untouched full run observed one transient existing
`processRunner.test.ts` failure because its expected `grandchild.pid` fixture
was not created under parallel load:

```text
pnpm test
Test Files  1 failed | 35 passed (36)
Tests       1 failed | 679 passed (680)
Exit        1
```

The unchanged focused process-runner suite then passed 5/5, and a fresh
unchanged full rerun was green:

```text
pnpm vitest --run apps/cli/test/processRunner.test.ts
Test Files  1 passed (1)
Tests       5 passed (5)
Exit        0

pnpm test
Test Files  36 passed (36)
Tests       680 passed (680)
Exit        0
```

No production change was made for the transient failure.

### RED

The named Task 6.10 RED suite was:

```text
pnpm vitest --run apps/cli/test/doctor.test.ts apps/cli/test/doctor.integration.test.ts apps/cli/test/args.test.ts
Test Files  3 failed (3)
Tests       7 failed | 34 passed (41)
Exit        1
```

The seven collected failures proved the missing `doctor` CLI grammar. Both new
doctor suites failed collection because `../src/doctor.js` did not yet exist.
Before this authoritative RED, a test-only `better-sqlite3` fixture import was
corrected to resolve through the storage package; no production file had been
edited.

Post-implementation self-review drove three additional RED/GREEN refinements:

```text
# non-ENOENT Codex spawn failure classification and child cleanup
Test Files  2 failed (2)
Tests       2 failed | 76 passed (78)

# invalid parent symlinks must retain their stable no-follow classifications
Tests       2 failed (2)

# real corrupt database bytes must classify as corrupt
Tests       1 failed (1)
```

Each refinement failed for the intended behavior before the smallest production
change was applied. The corresponding targeted reruns passed 78/78, 2/2, and
1/1 respectively.

### GREEN

The first complete focused GREEN passed 117 tests before the self-review
refinements. The final fresh gates after those refinements were:

```text
pnpm vitest --run apps/cli/test/doctor.test.ts apps/cli/test/doctor.integration.test.ts apps/cli/test/args.test.ts
Test Files  3 passed (3)
Tests       122 passed (122)
Exit        0

pnpm vitest --run apps/cli/test/packagedBinary.integration.test.ts apps/cli/test/readOnlyDataRoot.test.ts packages/storage/test/readOnlyDatabase.test.ts
Test Files  3 passed (3)
Tests       73 passed (73)
Exit        0

pnpm vitest --run apps/cli/test
Test Files  20 passed (20)
Tests       390 passed (390)
Exit        0

pnpm test
Test Files  38 passed (38)
Tests       768 passed (768)
Exit        0

pnpm typecheck
Exit        0

git diff --check
Exit        0
```

A source-entrypoint smoke test ran `doctor --data-root <missing-path> --json`
against an explicitly created temporary parent. It exited zero with `overall:
"warn"`, emitted the seven ordered checks, parsed the installed Codex version,
and passed the process-group and loopback probes. The missing data root remained
absent after the command.

## Implemented contract

- `agentlens doctor [--data-root PATH] [--json]` is part of the public CLI
  grammar. Duplicate, missing-value, and unknown options are rejected by the
  existing argument error boundary.
- The JSON envelope is `DoctorResultV1`; text renders the overall result followed
  by the same seven checks in deterministic order: `data_root`,
  `sensitive_paths`, `redaction_key`, `sqlite`, `codex`, `process_groups`, and
  `loopback`.
- Overall status is the worst check status (`fail` before `warn` before `pass`).
  Exit status is one only for an overall failure and zero otherwise.
- Filesystem diagnosis uses lstat plus no-follow opens and handle identity
  checks. It examines type, ownership, mode, symlink boundaries, bounded tree
  shape, and metadata only; it never reads secret or artifact payload bytes.
- Sensitive path traversal is bounded to 10,000 entries by default and reports
  stable classifications/counts without leaking secret values, artifact
  content, external symlink targets, or untrusted OS error text.
- SQLite diagnosis uses the existing immutable read-only opener. It validates
  migration continuity, expected tables/indexes/foreign keys, `query_only`,
  foreign-key violations, quick/integrity checks, and fail-closed WAL handling,
  including orphan WALs. Corrupt and inaccessible databases receive stable
  classifications.
- The Codex probe spawns exactly `codex --version` without a shell, closes stdin,
  bounds stdout and stderr to 8 KiB, applies a three-second timeout, terminates
  and awaits the child on failure, and accepts only a bounded semantic-version
  token. Missing, nonzero, invalid, overflow, timeout, and other spawn failures
  remain distinct stable results.
- Process-group support is a local platform capability check. Loopback binds
  only `127.0.0.1` on an ephemeral port and always closes the listener.
- Production probes are dependency-injectable and the pure diagnosis coordinator
  remains separate from CLI formatting and exit-code ownership.

## Diff and privacy review

The final review searched the changed production paths for writable data-root
preparation, writable database opens, key creation/loading, artifact-store use,
Git inspection, payload reads, raw exception/string/stack interpolation,
placeholders, and TODO/FIXME markers. No forbidden dependency or output remains.
The only network address in the implementation is the literal loopback host.

Argument parsing and main-command dispatch were changed only to wire `doctor`.
Storage schemas, migrations, repositories, derivations, adapters, read-only
`runs`/`inspect`, Task 6.11, Task 7, and UI files were not changed.

## Deviations and residual risks

- The only pre-GREEN fixture corrections were the direct `better-sqlite3`
  package resolver and compiled-CLI shebang setup; neither changed production
  behavior.
- Filesystem observations are point-in-time. The accepted same-owner pathname
  replacement residual remains; no claim is made that validation across
  multiple path operations is globally atomic.
- WAL handling intentionally fails closed. Doctor does not checkpoint, remove,
  or infer that a present WAL is stale.
- Capability probes report the state observed during the command and do not
  promise future process-group, executable, filesystem, or port availability.
- No storage/SQLite repair, migration, or durable mutation is attempted.
