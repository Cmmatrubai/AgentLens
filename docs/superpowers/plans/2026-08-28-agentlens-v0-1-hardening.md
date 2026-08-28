# AgentLens v0.1 Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the five blocking/important v0.1 review findings while preserving append-only evidence, privacy, read-only Git capture, exact Codex forwarding, and the Task 1–5 boundary.

**Architecture:** Add a durable ownership record and a conservative stale-run reconciler, bound process termination and JSONL ingestion at the child-process boundary, project persistence events into safe inspect DTOs, and repair the existing-artifact directory-sync branch. Each behavior is introduced through a failing regression test and committed separately after fresh focused tests and type checking.

**Tech Stack:** TypeScript, Node.js child processes/streams, Vitest, better-sqlite3, pnpm workspaces, read-only Git subprocesses.

**Spec:** `docs/AGENTLENS_V0_1_HARDENING_AMENDMENT.md`

## Global Constraints

- Start from commit `c5cb5731d155b7710d0154124da889c50d0920f8`.
- Never mutate observed events or fabricate provider completion/numeric exit facts.
- No unredacted source content may reach durable storage before redaction.
- Git commands remain physically read-only and recording still requires a clean repository.
- Preserve exact child argv, stdin bytes, capture policy, model, sandbox, approval configuration, permissions, and working directory.
- Unknown/malformed Codex events remain non-fatal.
- Do not implement Task 6, Task 7, or any excluded feature.

---

### Task 1: Freeze the narrow hardening contracts

**Files:**
- Create: `docs/AGENTLENS_V0_1_HARDENING_AMENDMENT.md`
- Create: `docs/superpowers/plans/2026-08-28-agentlens-v0-1-hardening.md`

**Interfaces:**
- Consumes: `docs/AGENTLENS_V0_1_FROZEN_SPEC.md` and the independent review findings.
- Produces: controlling ownership, interruption, ingestion, inspect-projection, and artifact-durability contracts for Tasks 2–5 below.

- [ ] **Step 1: Confirm the baseline**

Run `git rev-parse HEAD`, `git status --short`, `pnpm test`, and `pnpm typecheck`. Expected: exact starting commit, clean tree, 255 passing tests, and TypeScript exit 0.

- [ ] **Step 2: Add and self-review the amendment and plan**

Check both documents for stale v0.1 wording, placeholders, feature expansion, and conflicts with append-only/privacy/Git contracts.

- [ ] **Step 3: Verify and commit**

Run `git diff --check -- docs/AGENTLENS_V0_1_HARDENING_AMENDMENT.md docs/superpowers/plans/2026-08-28-agentlens-v0-1-hardening.md`, then commit only those documents.

### Task 2: Durable recorder ownership and stale recovery

**Files:**
- Create: `packages/storage/migrations/003_recorder_ownership.sql`
- Modify: `packages/storage/src/runRepository.ts`
- Modify: `packages/storage/test/migrations.test.ts`
- Modify: `packages/storage/test/runRepository.test.ts`
- Create: `apps/cli/src/processIdentity.ts`
- Create: `apps/cli/src/recoverRuns.ts`
- Modify: `apps/cli/src/recordRun.ts`
- Modify: `apps/cli/src/commands/runs.ts`
- Modify: `apps/cli/src/commands/inspect.ts`
- Modify: `apps/cli/src/format.ts`
- Modify: `apps/cli/test/recordRun.integration.test.ts`
- Modify: `apps/cli/test/readCommands.integration.test.ts`

**Interfaces:**
- Produces: `RecorderOwnership`, `RunRepository.createOwnership()`, `refreshOwnership()`, `attachChild()`, `markOwnershipCondition()`, `releaseOwnership()`, and `listRecoverableRuns()`; `ProcessIdentityInspector`; `recoverStaleRuns()`.
- Recovery consumes persisted run/event/Git facts and adds `recorder.ownership_lost`, `recorder.recovery`, and `run.reconciled` without updating observed rows.

- [ ] **Step 1: Write storage RED tests**

Add literal migration expectations for `run_ownership`; assert create/heartbeat/child/release transitions; reject wrong recorder-instance updates; and prove a unique ownership-loss/reconciliation claim prevents duplicate recovery.

- [ ] **Step 2: Run storage RED tests**

Run `pnpm vitest --run packages/storage/test/migrations.test.ts packages/storage/test/runRepository.test.ts`. Expected: failures because migration 3 and ownership APIs do not exist.

- [ ] **Step 3: Implement the migration and minimal repository APIs**

Persist PID/start tokens, process group, heartbeat, condition, and the one ownership-loss event reference. All conditional updates include the expected recorder instance ID.

- [ ] **Step 4: Run storage GREEN tests and typecheck**

Run the focused storage tests, then `pnpm typecheck`.

- [ ] **Step 5: Write CLI RED tests**

Use a real spawned fake Codex and fresh CLI process to prove: hard-killed recorder + gone child finalizes once; observed start is byte-for-byte unchanged; no provider terminal/exit is invented; a live recorder is untouched; dead recorder + live process group reports `orphan_child_active`; a second read adds no duplicate facts.

- [ ] **Step 6: Run CLI RED tests**

Run the named new cases in `recordRun.integration.test.ts` and `readCommands.integration.test.ts`. Expected: current runs remain permanently `running` and expose no ownership.

- [ ] **Step 7: Implement identity, heartbeat, and conservative recovery**

Use PID plus `ps` start identity on supported POSIX systems, treat ambiguity as non-recoverable, refresh ownership every 1,000 ms, and have reads reconcile only confirmed dead recorder + dead child/group. Match current Git root by keyed repository fingerprint before optional final evidence capture.

- [ ] **Step 8: Run CLI GREEN tests, full focused lifecycle tests, typecheck, and diff review**

Run `pnpm vitest --run apps/cli/test/recordRun.integration.test.ts apps/cli/test/readCommands.integration.test.ts packages/storage/test`, `pnpm typecheck`, and `git diff --check`; inspect the diff for PID reuse, recovery races, duplicate facts, raw paths, and process mutation.

- [ ] **Step 9: Commit Task 2**

Commit the ownership/recovery implementation and tests after the fresh checks pass.

### Task 3: Bounded process-group interruption

**Files:**
- Modify: `apps/cli/src/processRunner.ts`
- Modify: `apps/cli/src/main.ts`
- Modify: `apps/cli/src/recordRun.ts`
- Modify: `apps/cli/test/processRunner.test.ts`
- Modify: `apps/cli/test/fixtures/fake-codex.mjs`
- Modify: `apps/cli/test/packagedBinary.integration.test.ts`
- Modify: `apps/cli/test/recordRun.integration.test.ts`

**Interfaces:**
- Produces: `DEFAULT_TERMINATION_GRACE_MS = 2_000`; process-group-aware termination; a second `forceTerminationSignal`; actual `ChildProcessResult.terminatingSignal`.

- [ ] **Step 1: Write RED tests**

Add a fake mode that emits an open command, ignores `SIGTERM`, launches a same-group grandchild, and hangs. Assert first interrupt escalates within the bounded interval, second interrupt escalates immediately, direct child/grandchild disappear, actual `SIGKILL` is persisted, exactly one recovery is appended, and no provider completion appears.

- [ ] **Step 2: Run RED tests**

Run the named process-runner and packaged/record integration cases. Expected: timeout because the current direct-child `SIGTERM` has no deadline.

- [ ] **Step 3: Implement minimal bounded termination**

Spawn a POSIX process group, signal the group, schedule one grace timer, escalate once, clear listeners/timers on close, and fall back to direct-child signaling where groups are unsupported. Keep user interruption and child close as separate facts.

- [ ] **Step 4: Run GREEN tests, lifecycle regressions, typecheck, and diff review**

Run the focused files, `pnpm typecheck`, and `git diff --check`; inspect cleanup paths for timer/listener leaks and children surviving error branches.

- [ ] **Step 5: Commit Task 3**

Commit only after fresh verification.

### Task 4: Bounded byte-oriented JSONL ingestion

**Files:**
- Create: `apps/cli/src/sourceStreamDecoder.ts`
- Create: `apps/cli/test/sourceStreamDecoder.test.ts`
- Modify: `apps/cli/src/processRunner.ts`
- Modify: `apps/cli/src/recordRun.ts`
- Modify: `apps/cli/test/processRunner.test.ts`
- Modify: `apps/cli/test/recordRun.integration.test.ts`

**Interfaces:**
- Produces: `MAX_SOURCE_LINE_BYTES = 1_048_576`, `SourceStreamRecord`, `SourceStreamDiagnostic`, `SourceIngestionMetrics`, and `consumeSourceStream()`.
- `consumeSourceStream()` emits complete lines or one content-free oversize diagnostic and awaits each callback before reading more input.

- [ ] **Step 1: Write decoder RED tests**

Cover byte-by-byte records, multiple records/chunk, CRLF/blank/final-no-newline, stdout/stderr, 64 MiB malformed and valid-looking oversized records, following valid records, high-rate normal lines, and a deliberately slow callback. Assert `maxRetainedBytes <= 1_048_576` and `maxInFlightCallbacks === 1` per stream.

- [ ] **Step 2: Run decoder RED tests**

Run `pnpm vitest --run apps/cli/test/sourceStreamDecoder.test.ts`. Expected: module/API missing.

- [ ] **Step 3: Implement the fixed buffer/discard state machine**

Copy at most the configured limit into a fixed byte buffer, count discarded bytes to newline/EOF, never decode oversized bytes, ignore blank records, and await the callback inline in async iteration.

- [ ] **Step 4: Integrate content-free diagnostics and bounded serialization**

Map oversize records directly to `recorder.stream_diagnostic` with only stream/reason/limit/observed bytes. Keep at most one callback per source stream waiting on the shared persistence serialization point.

- [ ] **Step 5: Run GREEN tests, 64 MiB integration, typecheck, and diff review**

Run decoder/process/record integration tests, the standalone 64 MiB probe under `/usr/bin/time -l`, `pnpm typecheck`, and `git diff --check`; inspect for string concatenation, unbounded arrays, or promise backlogs.

- [ ] **Step 6: Commit Task 4**

Commit only after fresh verification.

### Task 5: Safe inspect projection and existing-artifact fsync

**Files:**
- Modify: `apps/cli/src/format.ts`
- Modify: `apps/cli/test/readCommands.integration.test.ts`
- Modify: `packages/core/src/artifactStore.ts`
- Modify: `packages/core/test/artifactStore.test.ts`

**Interfaces:**
- Produces: explicit `InspectEventDto`/`InspectJsonOutput`; safe `nativePayload` metadata; optional `nativeContent`; an injectable directory-sync operation used by both new and existing artifact branches.

- [ ] **Step 1: Write inspect RED tests**

Record unique inline and artifact-backed native sentinels. Assert JSON/text without `--native` contain neither; standard `--native` contains allowed redacted content; metadata-only/strict expose an omission reason and no content.

- [ ] **Step 2: Run inspect RED tests**

Run the named `readCommands.integration.test.ts` cases. Expected: inline sentinel leaks from the persistence object without `--native`.

- [ ] **Step 3: Implement explicit projection**

Destructure away stored native content before presentation, add safe storage metadata, expand only after policy/flag/integrity checks, and feed the same DTO to text and JSON formatters.

- [ ] **Step 4: Write artifact RED test**

Inject a first-writer directory-sync failure after rename, then create a second store that sees the canonical file. Assert the second call does not resolve until its directory-sync hook runs.

- [ ] **Step 5: Run artifact RED test**

Run the named `artifactStore.test.ts` case. Expected: existing-file branch returns without the injected directory sync.

- [ ] **Step 6: Implement and verify existing-file directory sync**

Call the same directory-sync operation after validating an existing artifact and before returning. Run focused core/CLI tests, `pnpm typecheck`, and `git diff --check`.

- [ ] **Step 7: Commit Task 5**

Commit only after fresh verification.

### Task 6: Independent hardening verification (not product Task 6)

**Files:**
- Modify only test fixtures or documentation if a verification discrepancy requires a tested correction.

**Interfaces:**
- Consumes: completed hardening Tasks 1–5.
- Produces: reproducible command/output evidence and a re-review recommendation; no new product feature.

- [ ] **Step 1: Run full automated gates**

Run `pnpm test`, `pnpm typecheck`, and `git diff --check` and record exact counts/results.

- [ ] **Step 2: Run independent probes**

Run hard-crash/gone-child, hard-crash/live-orphan, bounded interruption, 64 MiB followed-valid-line, inline/artifact native sentinel, and existing-artifact fault probes in disposable roots.

- [ ] **Step 3: Run milestone regressions**

Run real Codex success, failed-command recovery activity, active interruption, malformed/unknown input, metadata-only full-root sentinel scan, standard HMAC/sensitive-path scan, and dirty-repository refusal.

- [ ] **Step 4: Review the complete diff and history**

Audit ownership races/PID reuse, duplicate recovery, child leaks, async bounds, native projection, redaction boundaries, Git read-only behavior, and filesystem/SQLite durability ordering.

- [ ] **Step 5: Commit any verification-only correction after repeating RED/GREEN**

Do not commit generated raw probe data or sensitive fixtures. Finish with either `READY FOR INDEPENDENT RE-REVIEW` or `STILL BLOCKED`; do not authorize product Task 6.
