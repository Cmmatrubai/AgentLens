# Task 6.8 implementation report

## Scope

- Base: `77d12b69d4b52e9b9b4d3df083055c44f4c3b5ee`.
- Added the explicit `agentlens assess` command, its parser/routing, the non-mutating read-only data-root locator, and focused/integration coverage.
- Left `runs`, `inspect`, recorder behavior, derivations, storage semantics/migrations, the frozen spec/plan, and Task 6.9+ behavior unchanged.

## TDD evidence

Untouched baseline:

    pnpm vitest --run apps/cli/test/args.test.ts apps/cli/test/*.test.ts

Result: exit 0; 13 test files passed; 127 tests passed.

Initial RED after adding parser, locator, and assess integration tests:

    pnpm vitest --run apps/cli/test/args.test.ts apps/cli/test/assess.integration.test.ts apps/cli/test/readOnlyDataRoot.test.ts

Result: exit 1; 3 test files failed; 41 tests failed and 9 passed. Parser and integration failures reported the unsupported `assess` command, and locator tests reported the missing `readOnlyDataRoot` module.

Follow-up RED for the future-compatible locator state contract:

    pnpm vitest --run apps/cli/test/readOnlyDataRoot.test.ts

Result: exit 1; 1 test file failed; 2 tests failed and 1 passed. Existing storage lacked the explicit `existing` state and missing storage rejected instead of returning the non-mutating `missing` state.

Focused GREEN:

    pnpm vitest --run apps/cli/test/args.test.ts apps/cli/test/assess.integration.test.ts apps/cli/test/readOnlyDataRoot.test.ts

Result: exit 0; 3 test files passed; 50 tests passed.

Round 1 review-fix RED for the exported direct-call boundary:

    pnpm vitest --run apps/cli/test/assess.integration.test.ts

Result: exit 1; 1 test file failed; 30 tests failed and 25 passed. The failures
showed field-specific validation was missing, and the migration-003 snapshot for
a `Buffer` note gained migration changes plus `secrets/redaction-hmac.key` before
redaction failed.

Round 1 direct-call GREEN:

    pnpm vitest --run apps/cli/test/assess.integration.test.ts

Result: exit 0; 1 test file passed; 56 tests passed. Twenty-one malformed runtime
shapes are each exercised against both a missing root and a migration-003 root;
every case rejects before the data-root locator is called and preserves the full
filesystem snapshot. A runtime-valid missing-root control proves the locator spy
observes a real lookup.

Round 1 focused GREEN:

    pnpm vitest --run apps/cli/test/args.test.ts apps/cli/test/assess.integration.test.ts apps/cli/test/readOnlyDataRoot.test.ts

Result: exit 0; 3 test files passed; 93 tests passed.

## Verification evidence

CLI suite:

    pnpm vitest --run apps/cli/test/*.test.ts

Result: exit 0; 15 test files passed; 170 tests passed.

Assessment/privacy/storage/artifact suite:

    pnpm vitest --run apps/cli/test/assess.integration.test.ts apps/cli/test/privacy.integration.test.ts packages/core/test/artifactStore.test.ts packages/core/test/redaction.test.ts packages/storage/test/artifactMetadata.test.ts packages/storage/test/migrations.test.ts packages/storage/test/readOnlyDatabase.test.ts packages/storage/test/runRepository.test.ts

Result: exit 0; 8 test files passed; 201 tests passed.

Full suite on the reviewed implementation:

    pnpm test

Result: exit 0; 33 test files passed; 548 tests passed.

Type checking:

    pnpm typecheck

Result: exit 0.

Initial whitespace/error-marker check:

    git diff --check

Result: exit 0.

## Round 1 post-fix verification evidence

CLI suite:

    pnpm vitest --run apps/cli/test/*.test.ts

Result: exit 0; 15 test files passed; 213 tests passed.

Assessment/privacy/storage/artifact suite:

    pnpm vitest --run apps/cli/test/assess.integration.test.ts apps/cli/test/privacy.integration.test.ts packages/core/test/artifactStore.test.ts packages/core/test/redaction.test.ts packages/storage/test/artifactMetadata.test.ts packages/storage/test/migrations.test.ts packages/storage/test/readOnlyDatabase.test.ts packages/storage/test/runRepository.test.ts

Result: exit 0; 8 test files passed; 244 tests passed.

Full suite:

    pnpm test

Result: exit 0; 33 test files passed; 591 tests passed.

Type checking:

    pnpm typecheck

Result: exit 0.

Whitespace/error-marker check:

    git diff --check

Result: exit 0.

Verification environment note: one over-parallelized final CLI run observed the
unrelated crash-recovery timing test report `orphan_child_active` instead of
`active`. The exact test then passed 1/1 in isolation, the CLI suite passed
213/213 sequentially, and the subsequent full suite passed 591/591. No recovery
code or test was changed.

## Review findings

- The exported `runAssessCommand` boundary now runtime-validates the command
  object and every `AssessCommand` field before note byte counting or data-root
  lookup; erased TypeScript types cannot route malformed direct calls into the
  writable phase.
- Parser, enum, combination, duplicate-option, and UTF-8 byte-limit validation complete before data-root discovery.
- Missing/symlinked/non-regular storage, WAL refusal, missing runs, and migration-003 validation use the non-mutating locator plus immutable/query-only SQLite before any writable setup.
- The writable phase re-reads the run and its capture policy after reopening.
- Standard non-empty notes create the key only after validation, redact in memory, complete the content-addressed artifact, and then call the atomic assessment update with redaction audits.
- Empty/omitted notes and metadata-only/strict notes create neither a key nor an artifact. Full closed-root scans verify policy note sentinels are absent.
- Repeated identical notes reuse artifact metadata while producing distinct human events, bindings, and current event IDs, including equal-millisecond timestamps.
- Stable text and JSON output expose only structured assessment state/provenance/timestamps and never reviewer-note content.
- A forced post-artifact SQLite failure leaves one unreferenced redacted artifact and no event, artifact metadata, binding, or current-assessment row.

## Deviations and residual risks

- No scope deviations.
- The approved post-artifact database-failure boundary can leave an orphan content-addressed artifact file; tests confirm no database row references it.
- The graph reports the modified production path as metadata-changed and excludes
  the integration test and `.superpowers` report by configuration, so all three
  candidate paths were reviewed directly after the final coverage check.
