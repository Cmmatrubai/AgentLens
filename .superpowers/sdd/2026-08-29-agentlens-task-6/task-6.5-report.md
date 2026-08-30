# Task 6.5 implementation report

## Scope

- Base HEAD: `8cb73b29aa2d14a3c4e7af15b4ab1fdb442fb68b`.
- Implemented only Task 6.5 eager persisted-command derivation, terminal reconciliation catch-up, sequence-owner advancement, and focused recorder/crash coverage.
- Did not change `persistEventDraft`; its existing `TraceEventV1` return already proves the observed source was durably appended.
- Did not change the Codex adapter, prompt, model, sandbox, permissions, child arguments, working directory, `runs`, or `inspect`.

## TDD evidence

### Eager durability and ordering

Valid RED after correcting a test-only SQLite module-resolution error:

    pnpm vitest --run apps/cli/test/recordRun.integration.test.ts -t "derives test evidence only after the terminal observed command is durable"

Result: exit 1; 1 failed and 28 skipped. The terminal source existed in the final database, but `terminalPersistedSnapshot` was `undefined` because `recordRun` did not invoke the post-commit observation hook or eager derivation.

### Complete and split finalization gaps

RED:

    pnpm vitest --run apps/cli/test/recordRun.integration.test.ts -t "finalization fills"

Result: exit 1; 2 failed and 29 skipped. Neither the eager-derivation seam nor the finalization service seam was invoked, leaving the complete gap and preventing the split-gap fixture from being installed.

### Containment and derivation-storage failure

RED:

    pnpm vitest --run apps/cli/test/recordRun.integration.test.ts -t "contains|routes a derived-event storage"

Result: exit 1; 4 failed and 31 skipped. Malformed and unknown terminal commands never reached eager derivation, the classifier exception was never injected, and the derived-event storage failure was never reached.

### Combined required RED

    pnpm vitest --run apps/cli/test/recordRun.integration.test.ts apps/cli/test/crashRecovery.integration.test.ts

Result: exit 1; crash recovery passed, while record-run integration had 7 expected Task 6.5 failures and 29 passes.

### Focused GREEN

    pnpm vitest --run apps/cli/test/recordRun.integration.test.ts -t "derives test evidence|finalization fills|contains|routes a derived-event storage"

Result: exit 0; all 7 Task 6.5 tests passed and 28 were skipped, with no unhandled errors.

    pnpm vitest --run apps/cli/test/recordRun.integration.test.ts apps/cli/test/crashRecovery.integration.test.ts

Result: exit 0; 2 files and 36 tests passed.

### Review fix round 1: partial derived-write failures

Eager-path RED:

    pnpm vitest --run apps/cli/test/recordRun.integration.test.ts -t "rebases and contains an eager second-write derivation failure"

Result: exit 1; 1 failed and 36 skipped. `test.command` committed, the injected `test.result` persistence error escaped through the provider stream with a `PromiseRejectionHandledWarning`, and stale recorder allocation caused aggregate terminal-reconciliation failure.

Finalization-path RED:

    pnpm vitest --run apps/cli/test/recordRun.integration.test.ts -t "rebases and contains a finalization second-write derivation failure"

Result: exit 1; 1 failed and 36 skipped. `test.command` committed, the injected `test.result` persistence error reached finalization, and stale recorder allocation caused aggregate terminal-reconciliation failure.

GREEN:

    pnpm vitest --run apps/cli/test/recordRun.integration.test.ts -t "rebases and contains an eager second-write derivation failure"

    pnpm vitest --run apps/cli/test/recordRun.integration.test.ts -t "rebases and contains a finalization second-write derivation failure"

Result: each command exited 0 with 1 pass and 36 skips. The eager run emitted no unhandled rejection or warning.

    pnpm vitest --run apps/cli/test/recordRun.integration.test.ts apps/cli/test/crashRecovery.integration.test.ts

Result: exit 0; 2 files and 38 tests passed.

## Implementation decisions

- `recordRun` checks the returned durable event for the same terminal observed-command eligibility used by the derivation service, then invokes `derivePersistedTerminalCommand` with only the repository, run ID, and durable source event ID.
- The `onObservedEventPersisted` test hook exposes only `runId` and `eventId`. A second query-only SQLite connection proves the terminal source row exists before either derived row.
- After every eager or finalization service result, recorder-owned allocation advances with `state.sequence = Math.max(state.sequence, event.sequence + 1)` for every returned winner, including idempotent existing winners.
- `ensureTestDerivationsForRun` runs immediately before all three normal reconciliation sites: pre-spawn interruption, normal child completion, and recorder-error recovery.
- Recorder-error paths attempt catch-up only after a recorder-failure event proves storage remains usable. Catch-up failure is secondary, so the original recorder/process-group error remains the primary fact.
- Every eager or finalization derivation call now rebases recorder allocation from all durable run events before rethrowing an exception. If the durable reread also fails, the original derivation persistence error remains primary.
- Eager derivation persistence errors are latched after rebasing instead of rejecting the provider stream callback. Further eager attempts stop, provider stream consumption completes cleanly, and the original latched error is thrown at the first safe awaited boundary into existing recorder-error handling.
- The complete-gap test skips eager derivation once, and the split-gap test durably installs only `test.command`. Each finalization seam calls the real ensure service twice to prove no duplicates.
- Classifier exceptions are injected through the real derivation service and remain contained on both eager and finalization attempts. The durable source remains queryable, the retryable gap remains visible, and the exception sentinel is absent from storage.
- The derivation-persistence failure test intentionally skips eager derivation, then makes the first `appendDerivedEvent` during finalization fail. It proves existing recorder-error reconciliation, byte-for-byte source immutability, retry catch-up while storage remains usable, and non-persistence of the private error sentinel.
- Hard-crash recovery now explicitly asserts that an immutable open `item.started` command receives no `test.command` or `test.result` derivation.

## Files changed

- `apps/cli/src/recordRun.ts`
- `apps/cli/test/recordRun.integration.test.ts`
- `apps/cli/test/crashRecovery.integration.test.ts`
- `apps/cli/test/fixtures/fake-codex.mjs`
- `.superpowers/sdd/2026-08-29-agentlens-task-6/task-6.5-report.md`

`apps/cli/src/persistEvent.ts` was read but not changed because its return contract was already sufficient.

## Verification

    pnpm vitest --run apps/cli/test

Result: exit 0; 13 files and 127 tests passed.

    pnpm test

Result: exit 0; 30 files and 417 tests passed.

    pnpm typecheck

Result: exit 0 (`tsc -b --pretty false`).

    git diff --check

Result: exit 0 with no output.

Manual diff review found no adapter-side or pre-commit derivation, no source rewrite, no unredacted hook payload, no local sequence collision, no `item.started` derivation, and no Task 6.6+ or frozen-design changes.

## Deviations and unresolved risks

- The first eager-order test attempt failed during test collection because `better-sqlite3` is owned by the storage workspace rather than the CLI workspace. The test now resolves that already-installed dependency through the storage package and uses a second query-only connection; the valid RED above was rerun after this correction.
- Review fix round 1 resolved the prior eager-path `PromiseRejectionHandledWarning` within `recordRun.ts`; no `processRunner.ts` change was required. Exact eager and finalization second-write failures now reconcile durably as `recorder_error`, preserve the partial winner and source, fill only the missing result during best-effort catch-up, and remain idempotent on repeated ensure calls. No remaining Task 6.5 risk was identified in this fix round.
