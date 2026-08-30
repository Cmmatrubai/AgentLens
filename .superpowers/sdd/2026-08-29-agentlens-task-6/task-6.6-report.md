# Task 6.6 implementation report

## Scope

- Base HEAD: `35453bc844b5479fe286457d6177119076a24032`.
- Implemented only the pure provider-neutral `summarizeRun` value-object boundary, its public types/export, and focused Task 6.6 tests.
- Did not change storage, recorder, Git/artifact readers, the Codex adapter, CLI output, frozen design/plan documents, or any Task 6.7+ surface.
- Used the already isolated worktree `/Users/chaitanyamatrubai/Agent lens/.worktrees/task6-implementation` on `codex/agentlens-task-6-impl`.

## TDD evidence

### Baseline

    pnpm vitest --run packages/derivations/test

Result before Task 6.6 changes: exit 0; 4 files and 88 tests passed.

### Required missing-API RED

All evidence-field, likely-test, durability/identity, chronology, capture-policy privacy, and human-projection tests were added before production code.

    pnpm vitest --run packages/derivations/test/runSummary.test.ts

Result: exit 1; 1 file and 21 tests failed with the expected `TypeError: summarizeRun is not a function`. Test collection and fixture construction succeeded; the missing public summary API was the failure cause in every test.

### Focused GREEN

    pnpm vitest --run packages/derivations/test/runSummary.test.ts

Result: exit 0; 1 file and 21 tests passed.

### Adjacent GREEN

    pnpm vitest --run packages/derivations/test

Result: exit 0; 5 files and 109 tests passed.

The first combined derivations/typecheck run found one compile-only union narrowing error: native interruption capability was being added to a limitations array whose value intentionally excludes `native`. The implementation now omits native interruption support from the limitation list. A fresh typecheck and focused rerun both exited 0.

## Input and output contract decisions

- `RunSummaryInput` contains only durable value objects: minimal run identity/timing/capture fields, immutable core trace events, Git reference states, an optional already-validated untracked count plus its artifact ID, an optional current-assessment projection, and core provider capabilities.
- `runSummary.ts` imports only core trace types and existing pure derivation functions. It has no storage, database, filesystem, repository, artifact-store, provider-adapter, or output-writer dependency and performs no writes.
- Every evidence-bearing output carries `value`, `availability`, `provenance`, `supportingEventIds`, and `supportingArtifactIds`. Summary provenance keeps observed, derived, Git-recovered, recorder, human, and provider capability facts distinct.
- Terminal command and native file-change counts use only eligible terminal observed events. Failed commands remain their own observed count. Recorder elapsed time uses durable run timestamps.
- Token usage normalizes the current durable Codex usage keys into provider-neutral camel-case fields. Missing token evidence is `null`/`unavailable`; an absent validated untracked count is likewise `null`/`unavailable`. A validated count of zero remains representable as known zero.
- Tracked-final-diff projection distinguishes a known absent diff from missing or omitted evidence. Artifact-backed Git fields retain their supporting artifact IDs.
- Provider capability limitations list only non-native or unavailable capabilities and use provider provenance without inventing event or artifact support.
- Standard capture classifies only durable redacted command evidence. Metadata-only and strict never read normalized command content. Without a valid durable detection they return `unavailable_due_to_capture_policy`; a valid deterministic durable detection can still be projected without command inspection.
- For every terminal source, the summary computes the expected `test.command` and `test.result` identities and event IDs in memory. A durable row counts only when its deterministic ID, derivation identity/name/version, exact `derived_from` relationship, source ID, run ID, provenance, kind, and `test-command/1` payload correspond.
- Attempts are ordered by source sequence with received-time and event-ID tie breakers, independent of input/derived row order. Durable derived IDs are returned in source order and command-before-result order.
- Missing expected rows produce exact incomplete counts: neither derived row is 2, only `test.command` is 1, and both rows is 0. Omitted command evidence makes detected coverage partial; zero detections with any unavailable standard evidence remains unavailable.
- Attempt history exposes only structured outcomes. Failed then passed yields latest `passed` with one previous failure; passed then failed yields latest `failed` with zero previous failures. No unqualified success sentence is generated.
- Missing assessment input projects `unreviewed`/`uncertain` with projected state, null provenance/event/timestamps, and no supporting IDs. Explicit `unreviewed` remains timestamped human evidence with explicit state and its current event/note artifact IDs.

## Files changed

- `packages/derivations/src/runSummary.ts`
- `packages/derivations/test/runSummary.test.ts`
- `packages/derivations/src/types.ts`
- `packages/derivations/src/index.ts`
- `.superpowers/sdd/2026-08-29-agentlens-task-6/task-6.6-report.md`

## Verification

    pnpm vitest --run packages/derivations/test/runSummary.test.ts

Result: exit 0; 1 file and 21 tests passed.

    pnpm vitest --run packages/derivations/test

Result: exit 0; 5 files and 109 tests passed.

    pnpm test

Result: exit 0; 31 files and 438 tests passed.

    pnpm typecheck

Result: exit 0 (`tsc -b --pretty false`).

    git diff --check

Result: exit 0 with no output.

Manual scope/privacy review found no database, filesystem, repository, artifact-store, Codex adapter, or output dependency; no input mutation or write path; no restrictive-policy command inspection; no unrelated derived-row acceptance; no evidence-class collapse; and no unqualified `tests passed` wording in production code.

## Deviations and unresolved risks

- No Task 6.6 contract deviation is known.
- The summary intentionally normalizes only the currently observed v1 token fields. A future provider or adapter that adds different durable token keys will need an explicit provider-neutral mapping rather than being guessed at read time.
- Independent review was not dispatched from this task because the assignment explicitly prohibited subagents; the controller retains the normal independent review gate before Task 6.6 acceptance.

# Task 6.6 fix round 1: exact derived semantics and recorder spans

## Review findings reproduced

- A deterministic `test.result` row for a failed `pnpm test` source could retain the correct identity/relationship while forging `outcome: passed`; the summary counted it as complete and projected latest passed.
- `endedAt < startedAt` was clamped to available zero, turning an invalid recorder interval into apparently known evidence.

## RED

Added adversarial cases for forged `test.command` family, confidence, status, and provider; forged `test.result` family, confidence, outcome, status, exit code, and provider; and a negative recorder timestamp span.

    pnpm vitest --run packages/derivations/test/runSummary.test.ts

Result: exit 1; 32 tests ran, 11 expected tests failed and 21 passed. All ten forged rows were counted as complete; the forged result outcome was trusted as passed; and the negative span returned available zero.

A scope-review follow-up tested an inconsistent observed-event provider separately:

    pnpm vitest --run packages/derivations/test/runSummary.test.ts -t "validates derived source provider against the run provider"

Result: exit 1; the one selected test failed and 32 were skipped. Rows carrying the inconsistent observed provider were incorrectly counted as complete instead of being checked against the durable run provider.

## Fix decisions

- Deterministic ID/identity/relationship checks remain the first durable-row gate.
- Standard available command evidence supplies the current classifier result. Each structurally matching row is then compared to the pure expected draft for the durable run provider, event status, derivation confidence, and the exact normalized payload, including family, confidence, `test-command/1`, result outcome, and exact optional exit code. Rendered summaries are not compared.
- When command content is unavailable under metadata-only, strict, or durable standard omission, classification is inferred only from structured durable derivation payloads. Candidate command/result classifications must agree, and the same source-provider/status/payload invariants are checked using non-content source facts. No omitted command property is read.
- A standard source that currently classifies as a non-test cannot be revived by an unrelated durable row. A positively classified standard source remains a detected attempt even when zero derived rows validate, preserving crash-gap `missingExpected: 2` semantics.
- Negative recorder spans are unavailable with null value/provenance. Equal timestamps remain available known zero.

The first GREEN attempt exposed and contained two implementation-only control-flow errors: a classifier result was accidentally assigned as a boolean, and classified zero-row crash gaps were skipped. The focused suite caught both before commit; the corrected implementation preserves the original gap tests.

## GREEN and verification

    pnpm vitest --run packages/derivations/test/runSummary.test.ts

Result: exit 0; 1 file and 33 tests passed. The targeted run-provider case also passed alone with 32 skips.

    pnpm vitest --run packages/derivations/test

Result: exit 0; 5 files and 121 tests passed.

    pnpm test

Result: exit 0; 31 files and 450 tests passed.

    pnpm typecheck

Result: exit 0 (`tsc -b --pretty false`).

    git diff --check

Result: exit 0 with no output.

## Fix-round files and residual risk

- `packages/derivations/src/runSummary.ts`
- `packages/derivations/test/runSummary.test.ts`
- `.superpowers/sdd/2026-08-29-agentlens-task-6/task-6.6-report.md`

No public type change was required. When capture policy has omitted the source command, the summary cannot independently reconstruct the original test family; it therefore validates the durable family/confidence schema, agreement between command/result rows, and every invariant available without reading omitted content. This is the intentional privacy boundary rather than a new correctness claim.
