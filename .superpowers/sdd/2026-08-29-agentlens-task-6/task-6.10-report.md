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
Tests       23 passed (23)
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

### Independent-review fix round

Fix-round base: `a84cfba7d6afad036b6d6c52b5872da095c84141`

The controller added four permanent integration regressions and reproduced the
candidate defects. The untouched fix-round RED was reproduced exactly:

```text
pnpm vitest --run apps/cli/test/doctor.integration.test.ts
Test Files  1 failed (1)
Tests       4 failed | 60 passed (64)
Exit        1
```

The failures showed direct-PID-only Codex cleanup waiting for an inherited
stdio descendant until an external watchdog (4,502 ms); a same-owner parent
symlink reaching an initialized external root and reporting `ok`; replacement
UTF-8 decoding accepting a later `1.2.3` token after invalid bytes; and a mode
`000` exact regular WAL being classified `path_inspection_failed` instead of
the mandatory `wal_present`.

Each controller regression passed alone after its minimal production fix. The
first aggregate attempt then exposed a containment false positive: macOS temp
paths lexically use the root-owned `/var` system alias, so an unbounded
filesystem-root component walk incorrectly classified 48 existing storage tests
as root failures. The implementation was corrected to validate the
current-user-owned ancestor boundary and trust the first differently owned
ancestor. A further parent-first ordering regression went RED before the final
fix:

```text
pnpm vitest --run apps/cli/test/doctor.integration.test.ts -t 'classifies a parent symlink before inspecting its inaccessible target'
Test Files  1 failed (1)
Tests       1 failed | 64 skipped (65)
Exit        1
```

This proved an inaccessible external target could not mask the nearer stable
`root_symlink` classification. Final fresh fix-round gates were:

```text
pnpm vitest --run apps/cli/test/doctor.test.ts apps/cli/test/doctor.integration.test.ts apps/cli/test/args.test.ts
Test Files  3 passed (3)
Tests       127 passed (127)
Exit        0

pnpm vitest --run apps/cli/test/packagedBinary.integration.test.ts apps/cli/test/readOnlyDataRoot.test.ts packages/storage/test/readOnlyDatabase.test.ts
Test Files  3 passed (3)
Tests       23 passed (23)
Exit        0

pnpm vitest --run apps/cli/test
Test Files  20 passed (20)
Tests       395 passed (395)
Exit        0

pnpm test
Test Files  38 passed (38)
Tests       773 passed (773)
Exit        0

pnpm typecheck
Exit        0

git diff --check
Exit        0
```

### Second independent-review fix round

Second fix-round base: `7b29521d12d139aba4566285213606cbcc056b72`

After correcting a test-only missing import, the controller added eight more
permanent regressions. The untouched production candidate reproduced the
authoritative RED exactly:

```text
pnpm vitest --run apps/cli/test/doctor.integration.test.ts
Test Files  1 failed (1)
Tests       8 failed | 65 passed (73)
Exit        1
```

The failures established three shared defects: a sibling key/SHM access failure
could still mask an exact regular WAL; ancestor ownership was trusted before
node type/security and uid-unavailable traversal followed a parent symlink; and
Codex cleanup still settled on direct-child close, missed nonzero-exit groups,
and waited on inherited pipes from a self-detached descendant.

The storage fix records independent path-inspection outcomes and gives exact WAL
type/presence its mandatory SQLite precedence. Key, WAL, SHM, and artifact-file
checks are metadata-only, so owner-only mode `000` does not invent a content or
readability requirement. Ancestor validation now checks type before trust,
anchors uid-unavailable traversal to observed ancestor ownership, rejects a
differently-owned writable directory, and permits a platform alias only when
the alias and containing directory have the same different owner, the container
is not group/world writable, and the target is a directory.

Codex cleanup now starts when the leader exits or a forced result occurs, keeps
TERM-to-KILL group escalation alive after leader close, applies cleanup to
nonzero and other terminal results, and destroys the parent-owned stdin/stdout/
stderr handles before forced settlement. A self-detached process is outside the
owned group; doctor bounds its own return without claiming that escaped process
was reclaimed.

The first focused attempt after the shared fixes exposed four unit failures from
macOS `/tmp` being a secured root-owned directory alias. Those failures drove
the explicit secured-alias rule above. The added writable-directory fixture also
required an explicit `chmod(0770)` because the process umask removed its group
write bit. Final fresh second-round gates were:

```text
pnpm vitest --run apps/cli/test/doctor.test.ts apps/cli/test/doctor.integration.test.ts apps/cli/test/args.test.ts
Test Files  3 passed (3)
Tests       136 passed (136)
Exit        0

pnpm vitest --run apps/cli/test/packagedBinary.integration.test.ts apps/cli/test/readOnlyDataRoot.test.ts packages/storage/test/readOnlyDatabase.test.ts
Test Files  3 passed (3)
Tests       23 passed (23)
Exit        0

pnpm vitest --run apps/cli/test
Test Files  20 passed (20)
Tests       404 passed (404)
Exit        0

pnpm test
Test Files  38 passed (38)
Tests       782 passed (782)
Exit        0

pnpm typecheck
Exit        0

git diff --check
Exit        0
```

### Third independent-review fix round

Third fix-round base: `599a1f7b348c46cf0c5bf3562bbc444698937133`

The controller added one permanent inaccessible-database regression and an
explicit redaction-key assertion to the existing WAL/mode fixture. The exact
targeted RED was reproduced before the production edit:

```text
pnpm vitest --run apps/cli/test/doctor.integration.test.ts -t 'inaccessible regular database|unreadable redaction key'
Test Files  1 failed (1)
Tests       1 failed | 1 passed | 73 skipped (75)
Exit        1
```

The inaccessible exact regular database was still inspected through a
handle-opening filesystem helper. Mode `000` therefore erased its existence
metadata and collapsed `sensitive_paths`, `redaction_key`, and `sqlite` into a
filesystem inspection failure. The database path now uses the same
metadata-only type/owner/mode classification boundary as the exact sidecars;
the existing immutable SQLite inspection remains solely responsible for
database accessibility and maps its bounded raw failure to `open_failed`.
This preserves database symlink/non-regular classification, mandatory WAL
precedence, `key_missing` for a present database, and the no-content contract.

The exact targeted rerun passed 2/2. Final fresh third-round gates were:

```text
pnpm vitest --run apps/cli/test/doctor.integration.test.ts
Test Files  1 passed (1)
Tests       75 passed (75)
Exit        0

pnpm vitest --run apps/cli/test/doctor.test.ts apps/cli/test/doctor.integration.test.ts apps/cli/test/args.test.ts
Test Files  3 passed (3)
Tests       137 passed (137)
Exit        0

pnpm vitest --run apps/cli/test/packagedBinary.integration.test.ts apps/cli/test/readOnlyDataRoot.test.ts packages/storage/test/readOnlyDatabase.test.ts
Test Files  3 passed (3)
Tests       23 passed (23)
Exit        0

pnpm vitest --run apps/cli/test
Test Files  20 passed (20)
Tests       405 passed (405)
Exit        0

pnpm test
Test Files  38 passed (38)
Tests       783 passed (783)
Exit        0

pnpm typecheck
Exit        0

git diff --check
Exit        0
```

### Final independent-review fix round

Final fix-round base: `b4a4a9291aaa06dcac0f3eddd8c30b70c63cfba9`

The controller added one permanent regression for forced cleanup on the
non-POSIX direct-child fallback. The exact targeted RED was reproduced before
the production edit:

```text
pnpm vitest --run apps/cli/test/doctor.integration.test.ts -t 'non-POSIX timeout escalation'
Test Files  1 failed (1)
Tests       1 failed | 75 skipped (76)
Exit        1
```

The fallback sent TERM, waited 250 ms, sent KILL when the child remained open,
and settled immediately without awaiting an exit/reap observation. The
direct-child exit could therefore race the returned timeout result. The fixed
fallback establishes an exit/close promise before signaling, preserves the
250 ms TERM-to-KILL grace, and awaits that observation for a separately bounded
250 ms confirmation before forced settlement. The POSIX owned-group path and
all probe result facts are unchanged.

The exact targeted rerun passed 1/1. Final fresh gates were:

```text
pnpm vitest --run apps/cli/test/doctor.integration.test.ts
Test Files  1 passed (1)
Tests       76 passed (76)
Exit        0

pnpm vitest --run apps/cli/test/doctor.test.ts apps/cli/test/doctor.integration.test.ts apps/cli/test/args.test.ts
Test Files  3 passed (3)
Tests       138 passed (138)
Exit        0

pnpm vitest --run apps/cli/test/packagedBinary.integration.test.ts apps/cli/test/readOnlyDataRoot.test.ts packages/storage/test/readOnlyDatabase.test.ts
Test Files  3 passed (3)
Tests       23 passed (23)
Exit        0

pnpm vitest --run apps/cli/test
Test Files  20 passed (20)
Tests       406 passed (406)
Exit        0

pnpm test
Test Files  38 passed (38)
Tests       784 passed (784)
Exit        0

pnpm typecheck
Exit        0

git diff --check
Exit        0
```

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
  checks where handle access is part of the path contract. Exact database,
  sidecar, key, and artifact-file classification retains lstat metadata without
  opening payload bytes; immutable SQLite inspection owns database access. It
  examines type, ownership, mode, symlink boundaries, and bounded tree shape;
  it never reads secret or artifact payload bytes.
- Requested-root containment checks ancestors parent-first and validates node
  type before ownership trust, including when uid lookup is unavailable. A
  differently-owned directory is a boundary only when not group/world writable;
  a differently-owned alias additionally requires the same securely containing
  owner and a directory target, preserving macOS `/tmp` and `/var` without
  trusting arbitrary symlinks.
- Sensitive path traversal is bounded to 10,000 entries by default and reports
  stable classifications/counts without leaking secret values, artifact
  content, external symlink targets, or untrusted OS error text.
- SQLite diagnosis uses the existing immutable read-only opener. It validates
  migration continuity, expected tables/indexes/foreign keys, `query_only`,
  foreign-key violations, quick/integrity checks, and fail-closed WAL handling,
  including orphan WALs. Per-path inspection outcomes prevent sibling failures
  from masking WAL presence or collapsing unrelated checks. Corrupt and
  inaccessible databases receive stable classifications.
- The Codex probe spawns exactly `codex --version` without a shell, closes stdin,
  bounds stdout and stderr to 8 KiB, applies a three-second timeout, terminates
  and bounds owned process-group cleanup on POSIX (or direct-child fallback),
  awaits bounded direct-child exit confirmation on the fallback, closes
  parent-owned pipes for forced settlement, and accepts only a bounded semantic-
  version token from fatal UTF-8 decoding. Missing, nonzero, invalid, overflow,
  timeout, and other spawn failures remain distinct stable results.
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
- Ancestors beyond a securely contained, differently-owned directory/alias are
  a trusted platform boundary. With uid lookup unavailable, metadata ownership
  transitions still bound traversal and node type fails closed, while storage
  ownership/mode status retains the existing `platform_unsupported` warnings.
- WAL handling intentionally fails closed. Doctor does not checkpoint, remove,
  or infer that a present WAL is stale.
- Owned descendant cleanup uses POSIX process groups. Non-POSIX hosts retain the
  direct-child fallback and the separate `process_groups` limitation warning;
  doctor does not claim process-tree support there.
- A descendant that creates a new POSIX session/process group escapes the owned
  group and cannot be guaranteed reclaimable without stronger OS isolation.
  Doctor closes its own pipe handles and returns the forced timeout/overflow
  within the bound, without claiming the escaped process was terminated.
- Capability probes report the state observed during the command and do not
  promise future process-group, executable, filesystem, or port availability.
- No storage/SQLite repair, migration, or durable mutation is attempted.
