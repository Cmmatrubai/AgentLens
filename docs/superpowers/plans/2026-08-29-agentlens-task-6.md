# AgentLens Task 6 Evaluation Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the frozen AgentLens Task 6 evaluation layer: conservative likely-test derivation, provider-neutral summaries, durable human assessments, pure runs and inspect reads, and a diagnostic-only doctor command.

**Architecture:** A new provider-neutral derivations package classifies only durable redacted structured command evidence and builds deterministic derived-event drafts. Storage migration 004 adds derivation identities, current assessments, and event-artifact bindings. The CLI invokes idempotent derivation after observed terminal commands and again at finalization, while summary projection remains pure. Human notes pass through the existing in-memory redaction and artifact durability boundary. runs, inspect, and doctor use dedicated non-mutating inspection paths.

**Tech Stack:** TypeScript, Node.js 22, pnpm workspaces, Vitest, Zod, better-sqlite3, content-addressed filesystem artifacts, and local Codex CLI JSONL.

**Spec:** docs/superpowers/specs/2026-08-28-agentlens-task-6-design.md

## Global Constraints

- Start from frozen-design commit 57247e16a6c218568aeb0b780226da192156bfdc on branch codex/agentlens-task-6.
- Do not reopen Tasks 1–5 unless a direct implementation incompatibility is proven by a failing test.
- Do not implement product Task 7, HTTP, React, Claude hooks, grading, comparisons, exports, replay, hosting, or cost estimation.
- Preserve observed events byte-for-byte; Task 6 appends evidence and never rewrites provider facts.
- No raw prompt, message, command, output, diff, native payload, or reviewer-note bytes may touch durable storage before redaction.
- metadata-only and strict must not inspect omitted command or note content for semantics.
- Unknown and malformed Codex events must remain non-fatal.
- Derivation may never affect run reconciliation.
- runs and inspect are pure reads. They do not initialize, chmod, migrate, recover, derive, assess, or change lifecycle state.
- Git operations performed by AgentLens remain read-only.
- Preserve exact Codex argv, stdin, model, sandbox, permissions, approval configuration, and working directory.
- Raw real-world traces stay local and ignored; only sanitized behavior-preserving fixtures may be committed.
- Preserve unrelated untracked design-prototypes content and stage only Task 6 files or Task 6 lockfile hunks.
- For every implementation task: read the current files, write one or more failing tests, confirm RED, implement the smallest correct change, confirm GREEN, run adjacent regressions, run pnpm typecheck, inspect git diff and git diff --check, then commit only the verified task.
- If a test unexpectedly fails, invoke superpowers:systematic-debugging before changing implementation.
- Before any completion claim or commit, invoke superpowers:verification-before-completion and use fresh output.

## File Responsibility Map

### Provider-neutral derivation domain

- packages/derivations/src/shellTokenizer.ts owns the non-executing single-command tokenizer.
- packages/derivations/src/classifyTestCommand.ts owns test-command/1 recognition.
- packages/derivations/src/commandEvidence.ts owns durable command-evidence parsing and eligibility.
- packages/derivations/src/testDerivations.ts owns deterministic identities and content-free test event drafts.
- packages/derivations/src/runSummary.ts owns pure provider-neutral summary computation.
- packages/derivations/src/types.ts owns public derivation and summary contracts.
- packages/derivations/src/index.ts is the only public package surface.
- packages/derivations never imports storage, Codex, CLI, filesystem, SQLite, or Git modules.

### Canonical and storage contracts

- packages/core/src/events.ts adds an optional derivation identity field so Task 6 test derivations can expose it without invalidating existing run-reconciliation events.
- packages/storage/migrations/004_task6_evaluation.sql is the only forward schema migration.
- packages/storage/src/database.ts owns writable migration 004 and a dedicated read-only/query-only connection.
- packages/storage/src/runRepository.ts owns idempotent derived-event insertion, assessment transactions, schema capability detection, and Task 5-schema compatible reads.
- packages/storage does not classify commands or compute presentation summaries.

### CLI orchestration and presentation

- apps/cli/src/persistEvent.ts adds commandEvidence only after normalized command redaction.
- apps/cli/src/deriveTests.ts invokes and retries provider-neutral test derivations.
- apps/cli/src/projectRunSummary.ts supplies validated artifact-derived inputs to the pure summary function.
- apps/cli/src/diagnoseOwnership.ts performs read-only process-identity checks for likely-stale projection only.
- apps/cli/src/readArtifact.ts validates canonical artifact paths, file identity, length, and digest for native payloads, reviewer notes, and untracked metadata.
- apps/cli/src/readOnlyDataRoot.ts locates existing storage without initialization or permission repair.
- apps/cli/src/commands/assess.ts owns explicit human assessment orchestration.
- apps/cli/src/doctor.ts owns diagnostic checks; apps/cli/src/commands/doctor.ts owns output and exit status.
- apps/cli/src/commands/runs.ts and apps/cli/src/commands/inspect.ts only read and project.
- apps/cli/src/format.ts formats DTOs and never performs durable writes.
- apps/cli/src/recordRun.ts remains the only automatic recording/recovery/derivation orchestration entry point.

---

### Task 6.1: Add the provider-neutral tokenizer and classifier

**Files:**
- Create: packages/derivations/package.json
- Create: packages/derivations/tsconfig.json
- Create: packages/derivations/src/types.ts
- Create: packages/derivations/src/shellTokenizer.ts
- Create: packages/derivations/src/classifyTestCommand.ts
- Create: packages/derivations/src/index.ts
- Create: packages/derivations/test/shellTokenizer.test.ts
- Create: packages/derivations/test/classifyTestCommand.test.ts
- Modify: tsconfig.json
- Modify: apps/cli/package.json
- Modify: apps/cli/tsconfig.json
- Modify: pnpm-lock.yaml only if pnpm adds the packages/derivations workspace importer

**Public contract:**

    export interface ObservedCommand {
      readonly command: string;
      readonly exitCode: number | null;
      readonly eventStatus: EventStatus;
    }

    export interface TestCommandClassification {
      readonly family:
        | "pytest"
        | "jest"
        | "vitest"
        | "npm"
        | "pnpm"
        | "yarn"
        | "cargo"
        | "go"
        | "maven"
        | "gradle";
      readonly confidence: "high" | "medium";
      readonly derivationVersion: "test-command/1";
    }

- [ ] **Step 1: Read current package and test conventions**

Read root package.json, tsconfig.json, vitest.workspace.ts, packages/core/package.json, packages/core/tsconfig.json, packages/core/test/events.test.ts, and apps/cli package references. Confirm no unrelated workspace importer will be overwritten.

- [ ] **Step 2: Write tokenizer RED tests**

Create table-driven tests for spaces, tabs, single quotes, double quotes, unambiguous backslash escapes, comments at word boundaries, leading NAME=value assignments, env and command wrappers, and exact executable tokens.

Add negative cases for unquoted semicolon, newline, and-and, or-or, pipe, background operator, malformed quoting, backticks, dollar command substitution, parameter-selected executables, process substitution, bash -lc, sh -c, env -S, env -i, env -u, env --unset, env --chdir, command -v, command -V, and command -p.

The core assertion is:

    expect(tokenizeSimpleCommand("A=1 env -- pytest -q")).toEqual({
      executable: "pytest",
      argv: ["pytest", "-q"]
    });
    expect(tokenizeSimpleCommand("pytest -q && echo done")).toBeNull();

- [ ] **Step 3: Run tokenizer RED**

Run:

    pnpm vitest --run packages/derivations/test/shellTokenizer.test.ts

Expected: the package/module is missing.

- [ ] **Step 4: Implement the smallest deterministic tokenizer**

Implement a character-state machine with unquoted, single-quoted, and double-quoted states. Return null for unsupported evaluation or control syntax. Strip leading assignments only when the name matches:

    /^[A-Za-z_][A-Za-z0-9_]*=/

Unwrap only the frozen env and command grammars. Do not execute a shell and do not recursively parse wrapper string arguments.

- [ ] **Step 5: Run tokenizer GREEN**

Run the focused tokenizer test. Expected: all tokenizer cases pass.

- [ ] **Step 6: Write classifier RED tests**

Cover every frozen positive family:

| Family | Required direct forms |
| --- | --- |
| pytest | pytest, python -m pytest, python3 -m pytest |
| jest | jest, npx jest |
| vitest | vitest, npx vitest |
| npm | npm test, npm run test, npm run test:unit |
| pnpm | pnpm test, pnpm run test, pnpm run test:unit |
| yarn | yarn test, yarn run test |
| cargo | cargo test |
| go | go test |
| maven | mvn test with only allowlisted option forms before the goal |
| gradle | gradle test, ./gradlew test |

Cover exact-token negatives such as echo pytest, cat jest-output.txt, pytest-results.txt, npm run contest, pnpm run latest, unknown Maven options before test, and Maven test consumed as an option operand.

Assert package-manager test: scripts are medium confidence and direct/exact test forms are high confidence.

Freeze the Maven v1 pre-goal allowlist exactly:

- no operand: -q, --quiet, -B, --batch-mode, -o, --offline, -U, --update-snapshots, -N, --non-recursive, -e, --errors, -X, --debug, -V, --show-version, -ntp, --no-transfer-progress, -nsu, --no-snapshot-updates, -fae, --fail-at-end, -ff, --fail-fast, -fn, --fail-never;
- consumes the following token: -f, --file, -s, --settings, -gs, --global-settings, -t, --toolchains, -T, --threads, -pl, --projects, -rf, --resume-from, -P, --activate-profiles, -D, --define, -l, --log-file, -b, --builder;
- attached short value: a non-empty token beginning -D, -P, or -T;
- attached long value: --file=, --settings=, --global-settings=, --toolchains=, --threads=, --projects=, --resume-from=, --activate-profiles=, --define=, --log-file=, or --builder= followed by a non-empty value.

An exact test token consumed by one of the following-token options is not a goal. Any other option before the exact test goal leaves the whole command unclassified. Options and paths after the recognized goal do not change the family decision.

- [ ] **Step 7: Run classifier RED**

Run:

    pnpm vitest --run packages/derivations/test/classifyTestCommand.test.ts

Expected: classifier exports are missing.

- [ ] **Step 8: Implement exact-token family recognition**

Implement one recognizer per family over tokenizer output. Maven must use explicit sets for no-operand, attached-value, and following-operand options. Return null for unknown pre-goal options.

The dispatcher must be equivalent to:

    export function classifyTestCommand(
      input: ObservedCommand
    ): TestCommandClassification | null {
      const parsed = tokenizeSimpleCommand(input.command);
      if (parsed === null) return null;
      for (const recognize of recognizers) {
        const classification = recognize(parsed.argv);
        if (classification !== null) return classification;
      }
      return null;
    }

- [ ] **Step 9: Verify package integration and commit**

Run:

    pnpm vitest --run packages/derivations/test
    pnpm typecheck
    git diff --check
    git status --short

Inspect the staged diff for substring matching, shell execution, provider imports, wrapper expansion, lockfile prototype changes, or broadened family support. Commit:

    feat(derivations): add conservative test command classifier

---

### Task 6.2: Persist bounded redacted structured command evidence

**Files:**
- Create: packages/derivations/src/commandEvidence.ts
- Create: packages/derivations/test/commandEvidence.test.ts
- Modify: packages/derivations/src/types.ts
- Modify: packages/derivations/src/index.ts
- Modify: packages/core/src/events.ts
- Modify: packages/core/test/events.test.ts
- Modify: apps/cli/src/persistEvent.ts
- Modify: apps/cli/test/recordRun.integration.test.ts
- Modify: apps/cli/test/privacy.integration.test.ts

**Durable contract:**

    export type CommandEvidence =
      | Readonly<{ state: "available"; redactedCommand: string }>
      | Readonly<{
          state: "omitted";
          reason: "metadata-only" | "strict" | "capture-bound";
        }>;

    export const MAX_COMMAND_EVIDENCE_BYTES = 16 * 1024;

- [ ] **Step 1: Read the redaction and persistence boundary**

Read apps/cli/src/persistEvent.ts, packages/core/src/redaction.ts, packages/core/src/events.ts, packages/codex/src/normalize.ts, and the current privacy integration tests. Confirm command text currently enters normalizedPayload.command only after redactJson.

- [ ] **Step 2: Write RED tests for standard command evidence**

Add tests proving:

- a terminal observed command stores commandEvidence.available;
- its value is copied from the already-redacted normalized object;
- a token sentinel appears only as a keyed HMAC marker;
- a large aggregated output may truncate the general normalized payload without losing bounded command evidence;
- a redacted command above 16 KiB stores capture-bound and no redactedCommand bytes in commandEvidence;
- a numeric exitCode remains durable structural metadata when aggregated output is truncated.

The large-output assertion must inspect the durable event after reopening SQLite:

    expect(command.normalizedPayload).toMatchObject({
      truncated: true,
      commandEvidence: {
        state: "available",
        redactedCommand: "pnpm test"
      }
    });

- [ ] **Step 3: Write RED tests for metadata-only and strict**

Record unique command sentinels under both policies. Assert commandEvidence is omitted with the exact policy reason and scan the complete data root, SQLite, WAL/SHM, and artifacts to prove the sentinels are absent.

- [ ] **Step 4: Run RED**

Run:

    pnpm vitest --run apps/cli/test/recordRun.integration.test.ts apps/cli/test/privacy.integration.test.ts packages/core/test/events.test.ts packages/derivations/test/commandEvidence.test.ts

Expected: commandEvidence and derivation identity schema support are absent.

- [ ] **Step 5: Implement evidence extraction after redaction**

For standard capture, read command only from normalized.redacted after redactJson succeeds. Measure UTF-8 bytes. Add commandEvidence to both full and structurally truncated normalized payloads for every observed command lifecycle event. Preserve an already-redacted numeric exitCode as structural metadata so result derivation does not depend on output size. Never read draft.normalizedPayload.command to populate durable evidence.

For metadata-only and strict, set only:

    {
      commandEvidence: {
        state: "omitted",
        reason: context.capturePolicy
      }
    }

Add identity as an optional string to the canonical derivation schema. Existing run-reconciliation derived events remain valid; Task 6 test-event builders will require identity.

- [ ] **Step 6: Implement legacy evidence parsing**

parseCommandEvidence(event, capturePolicy) must:

- use commandEvidence when present;
- for standard Task 5 events, accept a top-level redacted normalized command string;
- treat truncated legacy payloads without command as capture-bound;
- return policy omission for metadata-only/strict;
- never read nativePayload or summary.

- [ ] **Step 7: Verify and commit**

Run the focused tests, pnpm typecheck, git diff --check, and inspect the diff for a second redaction pass, raw-draft reads, raw sentinels, or output-size coupling. Commit:

    feat(recorder): persist bounded redacted command evidence

---

### Task 6.3: Add migration 004 and non-migrating database inspection

**Files:**
- Create: packages/storage/migrations/004_task6_evaluation.sql
- Modify: packages/storage/src/database.ts
- Modify: packages/storage/src/index.ts
- Modify: packages/storage/src/runRepository.ts
- Modify: packages/storage/test/migrations.test.ts
- Create: packages/storage/test/readOnlyDatabase.test.ts
- Modify: packages/storage/test/runRepository.test.ts
- Modify: packages/storage/test/publicSurface.test.ts

**Migration shape:**

    CREATE TABLE derivation_identities (
      run_id TEXT NOT NULL,
      identity TEXT NOT NULL,
      source_event_id TEXT NOT NULL,
      derivation_name TEXT NOT NULL,
      derivation_version TEXT NOT NULL,
      derived_kind TEXT NOT NULL CHECK (derived_kind IN ('test.command', 'test.result')),
      derived_event_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (run_id, identity),
      UNIQUE (run_id, source_event_id, derivation_name, derivation_version, derived_kind),
      UNIQUE (derived_event_id, run_id),
      FOREIGN KEY (source_event_id, run_id) REFERENCES events(id, run_id),
      FOREIGN KEY (derived_event_id, run_id) REFERENCES events(id, run_id)
    );

    CREATE TABLE current_assessments (
      run_id TEXT PRIMARY KEY REFERENCES runs(id),
      current_event_id TEXT NOT NULL,
      verdict TEXT NOT NULL CHECK (verdict IN ('unreviewed', 'success', 'partial', 'failure')),
      task_completion TEXT NOT NULL CHECK (task_completion IN ('yes', 'no', 'uncertain')),
      note_state TEXT NOT NULL CHECK (note_state IN ('absent', 'artifact', 'omitted')),
      note_artifact_id TEXT,
      note_omission_reason TEXT CHECK (note_omission_reason IN ('metadata-only', 'strict')),
      reviewed_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (current_event_id, run_id) REFERENCES events(id, run_id),
      FOREIGN KEY (note_artifact_id, run_id) REFERENCES artifacts(id, run_id)
    );

    CREATE TABLE event_artifact_bindings (
      event_id TEXT NOT NULL,
      run_id TEXT NOT NULL,
      artifact_id TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role = 'assessment_note'),
      created_at INTEGER NOT NULL,
      PRIMARY KEY (event_id, artifact_id, role),
      FOREIGN KEY (event_id, run_id) REFERENCES events(id, run_id),
      FOREIGN KEY (artifact_id, run_id) REFERENCES artifacts(id, run_id)
    );

Add explicit CHECK constraints for every valid note state tuple and indexes used by run/source lookup.

Migration 002 already provides the required composite parent key through unique index idx_events_id_run_id on events(id, run_id). Migration tests must assert that invariant before exercising migration 004's same-run event foreign keys; migration 004 must not create a redundant parent index.

- [ ] **Step 1: Read all existing migrations and database tests**

Confirm migration 004 is forward-only, migration ordering remains 1 through 4, and no ALTER or UPDATE touches Tasks 1–5 evidence.

- [ ] **Step 2: Write migration RED tests**

Assert the new tables, indexes, same-run foreign keys, note-state constraints, derivation uniqueness, and future migration inspection. Create a populated migration-003 fixture and snapshot logical runs/events/artifacts/Git/ownership/audits before and after writable migration.

- [ ] **Step 3: Run migration RED**

Run:

    pnpm vitest --run packages/storage/test/migrations.test.ts

Expected: migration 004 and its tables are absent.

- [ ] **Step 4: Implement migration 004**

Add migration 004 to the ordered MIGRATIONS list. Do not backfill identities, derivations, or assessments. Preserve all existing rows logically unchanged.

- [ ] **Step 5: Write read-only database RED tests**

Create fixtures for current schema, migration 003, missing schema_migrations, corrupt SQLite, and a live WAL. Snapshot database, WAL, SHM, modes, sizes, mtimes, inode identities, and content hashes before and after open/inspect/close.

Assert the API:

    const database = openDatabaseReadOnly(databasePath);
    expect(database.inspect().migrations).toEqual([1, 2, 3, 4]);
    expect(() => new RunRepository(database, options).createRun(input, ownership))
      .toThrow(/readonly/i);
    database.close();

- [ ] **Step 6: Run read-only RED**

Run:

    pnpm vitest --run packages/storage/test/readOnlyDatabase.test.ts

Expected: openDatabaseReadOnly does not exist.

- [ ] **Step 7: Implement the dedicated read-only/query-only open**

Open only an existing regular database with better-sqlite3 readonly and fileMustExist. Set foreign_keys ON and query_only ON. Do not set journal mode, apply migrations, mkdir, chmod, or create a database.

Make inspectConnection tolerate a missing schema_migrations table by reporting an empty migration list and provide quick_check and foreign_key_check results without writes.

If the WAL fixture proves that this open mode creates or changes a sidecar, stop implementation and report the proven incompatibility before choosing another design. Do not copy the database, create a temporary snapshot, or weaken the no-filesystem-change contract without explicit design approval.

- [ ] **Step 8: Add schema capability detection**

RunRepository records whether derivation_identities, current_assessments, and event_artifact_bindings exist by querying sqlite_master. Task 5-schema reads must not query absent Task 6 tables.

- [ ] **Step 9: Verify and commit**

Run all storage tests, pnpm typecheck, git diff --check, and review the SQL for row rewrites, missing same-run keys, invalid note tuples, or a read path that migrates. Commit:

    feat(storage): add Task 6 schema and read-only inspection

---

### Task 6.4: Build deterministic derived events and idempotent storage

**Files:**
- Create: packages/derivations/src/testDerivations.ts
- Create: packages/derivations/test/testDerivations.test.ts
- Modify: packages/derivations/src/types.ts
- Modify: packages/derivations/src/index.ts
- Modify: packages/storage/src/runRepository.ts
- Modify: packages/storage/test/runRepository.test.ts
- Create: apps/cli/src/deriveTests.ts
- Create: apps/cli/test/deriveTests.test.ts

**Identity contract:**

    export function derivationIdentity(input: {
      readonly runId: string;
      readonly sourceEventId: string;
      readonly name: "test-command";
      readonly version: "1";
      readonly derivedKind: "test.command" | "test.result";
    }): string

The canonical input encoding is a length-delimited UTF-8 sequence in the exact field order runId, sourceEventId, name, version, derivedKind. The result is:

    agentlens-derivation-sha256:<64 lowercase hex characters>

The deterministic event ID is:

    drv_<64 lowercase hex characters>

- [ ] **Step 1: Read event insertion and relationship validation**

Read RunRepository.appendEvent, insertEvent, readEvents, nextSequence, relationship constraints, and run-reconciliation derivation behavior. Confirm test derivations require one and only one derived_from source.

- [ ] **Step 2: Write pure derivation RED tests**

Assert deterministic identities, deterministic event IDs, distinct kinds, passed/failed/unknown outcomes, content-free payloads, run-provider-only source context, exact test-command/1 fields, and no copied command/output/native content.

The failed-without-exit case must produce:

    {
      kind: "test.result",
      status: "failed",
      normalizedPayload: {
        family: "pytest",
        confidence: "high",
        outcome: "failed",
        derivationId: "test-command/1"
      }
    }

- [ ] **Step 3: Run pure derivation RED**

Run:

    pnpm vitest --run packages/derivations/test/testDerivations.test.ts

Expected: identity and draft builders are missing.

- [ ] **Step 4: Implement pure identity and draft builders**

Build exactly two independent drafts per classification. Each draft has identity in derivation, one sourceEventIds entry, and one matching derived_from relationship.

- [ ] **Step 5: Write storage idempotency RED tests**

Test:

- first append inserts test.command;
- repeat returns the already stored event;
- test.result can be appended after a simulated crash gap;
- repeating both creates no duplicates;
- same tuple with different payload is rejected;
- cross-run source IDs are rejected;
- two repository connections racing the same identity converge on one event;
- sequence allocation remains chronological;
- closing and reopening the database rehydrates derivation.identity on both derived events.

The repository method contract is:

    appendDerivedEvent(input: {
      readonly identity: string;
      readonly sourceEventId: string;
      readonly eventId: string;
      readonly receivedAt: string;
      readonly kind: "test.command" | "test.result";
      readonly status: EventStatus;
      readonly sourceProvider: NativeSourceV1["provider"];
      readonly summary: string;
      readonly normalizedPayload: unknown;
      readonly derivation: {
        readonly name: "test-command";
        readonly version: "1";
        readonly identity: string;
        readonly confidence: "high" | "medium";
      };
    }): TraceEventV1

- [ ] **Step 6: Run storage RED**

Run the named RunRepository derivation tests. Expected: repository API is absent.

- [ ] **Step 7: Implement transactional identity resolution**

In one immediate transaction:

1. load an existing identity or natural tuple;
2. validate it matches the requested deterministic event;
3. otherwise load and validate the source event in the same run;
4. allocate the next sequence;
5. insert the derived event and relationship;
6. insert derivation_identities;
7. on a unique race, load and validate the committed winner.

Never update the source event.

When Task 6 schema capability is present, readEvents conditionally left-joins derivation_identities on run ID plus derived event ID and restores the stored identity into the canonical derivation object. When the table is absent, use the Task 5 query shape and leave identity absent. Do not infer or recompute a missing durable identity during reads.

- [ ] **Step 8: Write service RED tests**

Test derivePersistedTerminalCommand and ensureTestDerivationsForRun against standard, metadata-only, strict, started, malformed, unknown, and legacy events. Simulate a gap containing only test.command and verify catch-up adds only test.result.

- [ ] **Step 9: Implement the run-scoped service**

The service reads the persisted source event, parses durable command evidence, invokes pure builders, and calls appendDerivedEvent. It is exported for focused programmatic historical backfill. It adds no general CLI.

- [ ] **Step 10: Verify and commit**

Run derivations, storage, and deriveTests suites; pnpm typecheck; git diff --check; and inspect for nondeterministic IDs, copied source content, provider-native source fields, or source updates. Commit:

    feat(evaluation): add idempotent test derivation service

---

### Task 6.5: Invoke eager derivation and finalization catch-up during recording

**Files:**
- Modify: apps/cli/src/recordRun.ts
- Modify: apps/cli/src/persistEvent.ts only if a narrow return contract is required
- Modify: apps/cli/test/recordRun.integration.test.ts
- Modify: apps/cli/test/crashRecovery.integration.test.ts
- Modify: apps/cli/test/fixtures/fake-codex.mjs

- [ ] **Step 1: Read every recordRun terminal and error path**

Trace successful ingestion, provider terminal handling, child failure, explicit interruption, recovery of open events, Git finalization, recorder error reconciliation, and database close. Identify every point that can reach run reconciliation with eligible command events.

- [ ] **Step 2: Write eager-derivation RED**

Add a fake mode emitting item.started then item.completed for pnpm test. Use an onObservedEventPersisted hook to query a second read-only connection and prove the observed terminal event exists before either derived event. Assert chronological order:

    item.completed command
    test.command
    test.result

Also assert item.started remains unchanged and receives no derivation.

- [ ] **Step 3: Write crash-gap/finalization RED**

Inject a one-shot eager derivation skip after the source commit. Verify finalization catches up both events. Inject a split write that commits test.command then stops; verify finalization adds only test.result. Re-run finalization twice and assert no duplicates.

- [ ] **Step 4: Write containment RED**

Feed malformed and unknown command text. Assert recording completes and the source event remains queryable. Inject a classifier exception and assert the source remains durable and the gap is visible for later retry. Inject a storage write failure and assert existing recorder-error reconciliation handles it without source mutation.

- [ ] **Step 5: Run RED**

Run:

    pnpm vitest --run apps/cli/test/recordRun.integration.test.ts apps/cli/test/crashRecovery.integration.test.ts

Expected: no automatic test derivations exist.

- [ ] **Step 6: Implement eager invocation**

Immediately after persistEventDraft returns an eligible terminal observed command, call derivePersistedTerminalCommand with that returned durable event ID. The service returns the durable derived events, including already committed idempotent winners. Advance the recorder allocator exactly as follows so later recorder events cannot collide:

    for (const event of derivedEvents) {
      state.sequence = Math.max(state.sequence, event.sequence + 1);
    }

Do not invoke derivation from the Codex adapter or before the observed event commit.

- [ ] **Step 7: Implement finalization catch-up**

Before every normal terminal reconciliation, call ensureTestDerivationsForRun and advance state.sequence from every returned durable derived event using the same maximum rule. In recorder error paths, attempt catch-up only when storage remains usable; preserve the original error as the primary fact.

Contain unexpected classifier exceptions per source event and leave an inspectable derivation gap for later retry. Do not convert a pure classifier exception into a recorder failure. Let derivation identity/event persistence failures follow the existing recorder-error path because durable storage is unhealthy.

- [ ] **Step 8: Verify and commit**

Run focused record/crash tests, all CLI lifecycle tests, pnpm typecheck, and git diff --check. Review event order, error containment, local sequence ownership, and immutable starts. Commit:

    feat(recorder): derive test evidence after durable commands

---

### Task 6.6: Compute pure provider-neutral run summaries

**Files:**
- Create: packages/derivations/src/runSummary.ts
- Create: packages/derivations/test/runSummary.test.ts
- Modify: packages/derivations/src/types.ts
- Modify: packages/derivations/src/index.ts

**Summary boundary:**

    export function summarizeRun(input: RunSummaryInput): RunSummary

RunSummaryInput contains durable run/events/Git-reference states, an optional validated untracked-file count, a current-assessment projection, and provider capabilities. It contains no database, filesystem, repository, artifact store, Codex adapter, or output writer.

- [ ] **Step 1: Write evidence-field RED tests**

Cover terminal commands, failed commands, native file-change events, tracked-final-diff availability, untracked metadata count, elapsed recorder time, observed token usage, assessment, and capability limitations.

Each evidence-bearing value must include provenance, availability, and supporting event/artifact IDs. Unknown token usage and untracked count must be null/unavailable, never zero.

- [ ] **Step 2: Write likely-test RED tests**

Cover:

- standard with no recognized tests: none_detected;
- metadata-only: unavailable_due_to_capture_policy;
- strict: unavailable_due_to_capture_policy;
- standard with only capture-bound/legacy truncated evidence: unavailable_due_to_capture_policy;
- standard with an available non-test command plus an omitted command and zero detections: unavailable_due_to_capture_policy;
- detected pass;
- detected failure;
- failed then passed: latest passed and previousFailures 1;
- passed then failed: latest failed and previousFailures 0;
- detected plus omitted command evidence: detected with partial coverage;
- source present with neither derived event: incomplete with missingExpected 2;
- only test.command durable: incomplete with missingExpected 1;
- both durable: complete;
- out-of-order durable rows still follow source chronology.

The key assertion is:

    expect(summary.likelyTests).toMatchObject({
      state: "detected",
      attempts: {
        total: 2,
        passed: 1,
        failed: 1,
        unknown: 0,
        latest: "passed",
        previousFailures: 1
      },
      durability: "complete",
      missingExpected: 0,
      coverage: "complete",
      omittedTerminalCommands: 0,
      derivationId: "test-command/1"
    });

- [ ] **Step 3: Write human-projection RED tests**

Assert no assessment produces verdict unreviewed, state projected, provenance null, and null event/timestamps. Assert explicit unreviewed remains state explicit with human provenance and timestamps.

- [ ] **Step 4: Run RED**

Run:

    pnpm vitest --run packages/derivations/test/runSummary.test.ts

Expected: summary API is missing.

- [ ] **Step 5: Implement pure summary computation**

Classify standard durable command evidence in memory to calculate expected identities. Compare expected IDs with durable derived events without writing. Preserve source chronology and supporting IDs. Do not treat absent telemetry as zero.

- [ ] **Step 6: Verify and commit**

Run all derivations tests, pnpm typecheck, git diff --check, and review for filesystem/database imports, unqualified tests-passed wording, capture-policy inspection, or evidence-class collapse. Commit:

    feat(evaluation): add pure run summaries

---

### Task 6.7: Store append-only human assessments transactionally

**Files:**
- Modify: packages/storage/src/runRepository.ts
- Modify: packages/storage/test/runRepository.test.ts
- Modify: packages/storage/src/index.ts only if explicit assessment types need export

**Storage contracts:**

    export type AssessmentVerdict =
      | "unreviewed"
      | "success"
      | "partial"
      | "failure";

    export type TaskCompletion = "yes" | "no" | "uncertain";

    export type AssessmentNoteRef =
      | Readonly<{ state: "absent" }>
      | Readonly<{ state: "artifact"; artifact: CompletedArtifact }>
      | Readonly<{ state: "omitted"; reason: "metadata-only" | "strict" }>;

- [ ] **Step 1: Read artifact metadata validation and audit insertion**

Read commitArtifactMetadata, canonical artifact-path validation, insertAudits, appendEvent, and migration 004 constraints. Reuse these checks inside one assessment transaction rather than duplicating weaker validation.

- [ ] **Step 2: Write assessment RED tests**

Cover:

- first assessment appends one assessment.updated human event and current row;
- reviewedAt equals first action and stays fixed across updates;
- updatedAt/currentEventId advance;
- omitted task-completed becomes uncertain;
- omitted note replaces current note with absent;
- explicit unreviewed rejects yes/no but accepts uncertain and a note;
- each repeated identical assessment appends a distinct human event;
- old human events and bindings remain immutable;
- observed/derived/recorder/Git evidence is unchanged;
- metadata-only/strict note states contain no artifact;
- same standard artifact is validated and reused for the same run;
- cross-run artifacts/events are rejected;
- transaction failure preserves the previous current assessment.

- [ ] **Step 3: Run RED**

Run the named RunRepository assessment tests. Expected: assessment APIs are absent.

- [ ] **Step 4: Implement current projection reads**

On a Task 5 schema, getCurrentAssessment returns the projected unreviewed value without querying absent tables. On migration 004, return explicit fields and note reference from current_assessments.

- [ ] **Step 5: Implement one assessment transaction**

In one immediate transaction:

1. validate run and structured fields;
2. validate or insert completed note artifact metadata and audits;
3. allocate the next event sequence;
4. append content-free assessment.updated with human provenance;
5. append assessment_note binding when present;
6. insert or replace current_assessments while preserving the first reviewedAt.

The event source is only:

    { provider: run.provider }

The canonical event runId already owns the run relationship. The source has no correlation ID, provider-native lifecycle fields, or native payload.

- [ ] **Step 6: Verify and commit**

Run storage tests, pnpm typecheck, git diff --check, and inspect for mutable history, note text in SQLite, weak artifact reuse, or cross-run references. Commit:

    feat(storage): add durable human assessments

---

### Task 6.8: Add the assess CLI with note privacy

**Files:**
- Modify: apps/cli/src/args.ts
- Modify: apps/cli/src/main.ts
- Create: apps/cli/src/commands/assess.ts
- Create: apps/cli/test/assess.integration.test.ts
- Modify: apps/cli/test/args.test.ts
- Modify: apps/cli/test/format.test.ts only if assessment output helpers live there

**CLI contract:**

    agentlens assess RUN_ID
      --verdict unreviewed|success|partial|failure
      [--task-completed yes|no|uncertain]
      [--note TEXT]
      [--data-root PATH]
      [--json]

- [ ] **Step 1: Read argument and command routing conventions**

Read args.ts, main.ts, record command output patterns, data-root safeguards, redaction-key handling, ArtifactStore ordering, and CLI integration helpers.

- [ ] **Step 2: Write parser RED tests**

Cover every verdict/task value, required run ID/verdict, default uncertain task completion, optional empty/non-empty note, data root, JSON, unknown options, duplicate-value handling, and explicit unreviewed validation.

- [ ] **Step 3: Write validation-before-write RED tests**

Snapshot a missing root and an existing root. Assert malformed arguments, oversized note, missing run, and invalid unreviewed/task combinations do not initialize, migrate, chmod, create a key, write an artifact, or change SQLite.

- [ ] **Step 4: Write privacy and history RED tests**

For standard:

- use a note containing a unique bearer token and assignment secret;
- assert raw bytes are absent from SQLite and artifacts;
- validate the redacted artifact and HMAC markers;
- repeat the same note and prove artifact reuse plus distinct human events.

For metadata-only and strict:

- use unique note sentinels;
- scan the entire data root and prove the bytes are absent;
- assert note state omitted with the exact policy reason.

Assert a 16 KiB UTF-8 note succeeds and a 16 KiB plus one-byte note fails before any write.

- [ ] **Step 5: Run RED**

Run:

    pnpm vitest --run apps/cli/test/args.test.ts apps/cli/test/assess.integration.test.ts

Expected: assess is unsupported.

- [ ] **Step 6: Implement read-only validation first**

Parse all arguments and byte bounds. Locate existing storage without mutation, open it read-only, confirm the run, load capture policy, and close. Only then call the writable data-root/database path, which may apply migration 004.

- [ ] **Step 7: Redact or omit in memory**

Standard non-empty notes use redactText with contentClass message, then redactedTextBytes, then ArtifactStore.writeRedacted with kind assessment-note and text/plain; charset=utf-8. Empty or omitted notes are absent. metadata-only and strict do not create RedactedBytes or artifact files.

After the artifact is complete, call the repository assessment transaction. A SQLite failure may leave only an orphan artifact file.

- [ ] **Step 8: Implement stable output**

Text names verdict, task completion, explicit human state, and note availability without printing note content. JSON returns schema version, run ID, current event ID, fields, provenance, and timestamps.

- [ ] **Step 9: Verify and commit**

Run assess, args, privacy, storage, and artifact tests; pnpm typecheck; git diff --check; and scan the test data roots for raw note sentinels. Review for pre-validation writes and note bytes in summaries/events. Commit:

    feat(cli): add explicit human assessment command

---

### Task 6.9: Make runs and inspect pure and add Task 6 read models

**Files:**
- Create: apps/cli/src/readOnlyDataRoot.ts
- Create: apps/cli/src/readArtifact.ts
- Create: apps/cli/src/projectRunSummary.ts
- Create: apps/cli/src/diagnoseOwnership.ts
- Modify: apps/cli/src/commands/runs.ts
- Modify: apps/cli/src/commands/inspect.ts
- Modify: apps/cli/src/recordRun.ts
- Modify: apps/cli/src/format.ts
- Modify: apps/cli/test/readCommands.integration.test.ts
- Modify: apps/cli/test/recordRun.integration.test.ts
- Modify: apps/cli/test/format.test.ts
- Modify: packages/storage/src/runRepository.ts only for Task 5-schema compatible read DTOs

- [ ] **Step 1: Read the current mutating read paths**

Confirm runs and inspect currently call prepareDataRoot, openDatabase, ownerOnlyDatabaseFiles, and recoverStaleRuns. Read recoverRuns.ts and recordRun preflight order.

- [ ] **Step 2: Write pure-read RED tests**

Cover:

- runs on a missing root returns empty and creates nothing;
- inspect on a missing root or run returns not found and creates nothing;
- neither command chmods permissive existing paths;
- neither command applies migration 004 to a migration-003 database;
- neither command recovers stale ownership or appends recorder.recovery;
- neither command fills derivation gaps or appends human evidence;
- both commands can read a Task 5 schema;
- likely stale ownership is diagnosed in output only;
- symlinked root/database/WAL/SHM is rejected without target mutation.

Capture a recursive snapshot before and after each command containing relative path, file type, mode, uid, gid, size, mtime nanoseconds, inode, and SHA-256 for regular files. Compare exact snapshots, including database, WAL, and SHM.

- [ ] **Step 3: Run pure-read RED**

Run the new named readCommands tests. Expected: current reads initialize, chmod, migrate, and recover.

- [ ] **Step 4: Implement non-mutating root discovery**

readOnlyDataRoot returns missing or an existing canonical regular database path. It uses lstat/open with no-follow checks but never mkdir, create, chmod, rename, delete, or permission repair.

Use openDatabaseReadOnly and close it without ownerOnlyDatabaseFiles.

For a nonterminal run whose stored ownership condition is active or reconciling, diagnose recorder liveness with the existing read-only PID plus start-token inspector. Project same as active, gone as likely_stale, and ambiguous as unknown. Project orphan_child_active and identity_ambiguous from their explicit stored conditions. Never claim or repair ownership from this projection.

- [ ] **Step 5: Move automatic stale recovery to record startup**

In recordRun, keep this order:

1. captureGitBefore rejects non-Git/dirty repositories;
2. resolve prompt transport;
3. prepareDataRoot enforces repository-containment and owner-only write storage;
4. open writable database and repository;
5. recoverStaleRuns;
6. allocate/create the new run;
7. spawn Codex.

Remove recoverStaleRuns from runs and inspect. Add a dirty-repository regression proving Codex is never spawned and the storage root is not touched.

- [ ] **Step 6: Extract generic validated artifact reads**

Move native-artifact validation into readArtifact.ts with explicit expected kind/media type. Reuse it for:

- native-payload JSON expansion;
- assessment-note UTF-8 text;
- git-untracked-file-metadata JSON.

Reject non-canonical paths, symlinks, file identity changes, length mismatch, digest mismatch, kind mismatch, media-type mismatch, and truncated content where the consumer requires complete JSON.

- [ ] **Step 7: Project provider-neutral summaries**

projectRunSummary loads only validated untracked metadata when available, counts the validated array, obtains current assessment from storage, and calls summarizeRun. It performs no write and does not classify omitted content.

runs adds likelyTests and assessment to every item. inspect adds full summary, derived/human events, current assessment, and current reviewer-note content only when standard and artifact validation succeeds.

Text must say:

    Likely tests: latest passed, previous failures 1
    Reviewer: unreviewed (projected)

when those exact facts apply. It must never say unqualified tests passed.

- [ ] **Step 8: Test additive JSON and provenance labels**

Assert existing Task 5 fields remain present. Assert Provider, Derived, Git recovered, Recorder, Recorder recovery, and Human remain distinct. Derived output includes identity, source ID, and test-command/1.

- [ ] **Step 9: Verify and commit**

Run read commands, record startup recovery, format, assessment, derivation, and storage tests; pnpm typecheck; git diff --check; and repeat the recursive filesystem snapshots. Review for hidden initialization, migration, recovery, artifact writes, and note/native leaks. Commit:

    feat(cli): add pure Task 6 run inspection

---

### Task 6.10: Add the read-only doctor command

**Files:**
- Modify: apps/cli/src/args.ts
- Modify: apps/cli/src/main.ts
- Create: apps/cli/src/doctor.ts
- Create: apps/cli/src/commands/doctor.ts
- Create: apps/cli/test/doctor.test.ts
- Create: apps/cli/test/doctor.integration.test.ts
- Modify: apps/cli/test/args.test.ts
- Modify: apps/cli/test/packagedBinary.integration.test.ts

**Stable result:**

    export interface DoctorResultV1 {
      readonly schemaVersion: 1;
      readonly overall: "pass" | "warn" | "fail";
      readonly dataRoot: string;
      readonly checks: readonly DoctorCheck[];
    }

    export interface DoctorCheck {
      readonly id: string;
      readonly status: "pass" | "warn" | "fail";
      readonly summary: string;
      readonly metadata: Readonly<Record<string, string | number | boolean | null>>;
    }

- [ ] **Step 1: Write parser and aggregation RED tests**

Cover --data-root, --json, unknown options, ordered checks, fail precedence, warn precedence, exit zero for pass/warn, and exit one for fail.

- [ ] **Step 2: Write data-root/key RED tests**

Cover missing root as warn/not_initialized, wrong owner or permissive mode, symlinked root/database/key as fail, missing key in initialized DB as fail, unsupported POSIX inspection as warn, and proof that key contents are never read into output.

Name and test every sensitive location class: the data root; secrets; secrets/redaction-hmac.key; artifacts; artifacts/tmp; artifacts/sha256; existing two-character hash directories; every regular file under artifacts/tmp and artifacts/sha256 whether referenced, orphaned, or temporary; agentlens.sqlite; agentlens.sqlite-wal; and agentlens.sqlite-shm. Walk sensitive trees with lstat and directory handles without following symlinks. Directories must not be group/world accessible, sensitive regular files must not be group/world readable, and any symlink substitution at an inspected sensitive path fails. Add explicit world-readable orphan and temporary artifact failures. Report only bounded counts and stable codes, never artifact names or content.

- [ ] **Step 3: Write SQLite RED tests**

Cover current schema pass, migration 003 fail as older, future migration fail, missing database warn only for uninitialized/empty root, missing tables/indexes fail, foreign_key_check failure, quick_check failure/corruption, and read-only open failure. Assert doctor applies no migration and changes no database/WAL/SHM bytes or metadata.

- [ ] **Step 4: Write Codex/platform/loopback RED tests**

Inject bounded local codex --version results for available, missing, timeout, oversized output, and nonzero exit. Cover process-group pass/warn and a bind/close on 127.0.0.1 port zero whose failure is warn. Assert no non-loopback address and no listener remains.

- [ ] **Step 5: Write doctor privacy RED**

Seed database/artifacts with unique prompt/message/output/diff/native/note sentinels. Run doctor --json and assert none appear. Assert no Git subprocess and no artifact-content read occurs.

- [ ] **Step 6: Run RED**

Run:

    pnpm vitest --run apps/cli/test/doctor.test.ts apps/cli/test/doctor.integration.test.ts apps/cli/test/args.test.ts

Expected: doctor is unsupported.

- [ ] **Step 7: Implement bounded diagnostic checks**

Use dependency injection for filesystem identity, database inspection, codex version process, process-group detection, and loopback binding. Convert raw exceptions into stable bounded codes and summaries. Never include raw exception messages that may carry paths or source content.

Codex version execution must have a timeout, bounded stdout/stderr, and cleanup. The loopback socket binds only 127.0.0.1 with port zero and closes in a finally block.

- [ ] **Step 8: Implement CLI output and packaged invocation**

Text prints overall plus ordered check IDs/status/summaries. JSON exactly matches schema version 1. main returns doctor-derived exit status rather than treating warnings as failure.

- [ ] **Step 9: Verify and commit**

Run doctor, args, packaged binary, and read-only storage tests; pnpm typecheck; git diff --check; filesystem snapshots; and sentinel output scans. Review for migration, key/artifact reads, network access, listener leaks, or raw exception leakage. Commit:

    feat(cli): add read-only doctor diagnostics

---

### Task 6.11: End-to-end validation, full regression, and independent review

**Files:**
- Create: docs/verification/2026-08-29-agentlens-task-6.md
- Modify tests or implementation only when a reproduced failure requires a focused RED/GREEN correction
- Do not commit raw Codex JSONL, unsanitized machine paths, prompts, repository content, or data roots

- [ ] **Step 1: Run focused Task 6 suites**

Run:

    pnpm vitest --run packages/derivations/test
    pnpm vitest --run packages/storage/test
    pnpm vitest --run apps/cli/test/assess.integration.test.ts apps/cli/test/readCommands.integration.test.ts apps/cli/test/doctor.test.ts apps/cli/test/doctor.integration.test.ts
    pnpm typecheck

Record exact pass counts and exit results in the verification document.

- [ ] **Step 2: Run the complete Tasks 1–6 automated gate**

Run:

    pnpm test
    pnpm typecheck
    git diff --check

Do not reuse earlier output.

- [ ] **Step 3: Run named Tasks 1–5 regressions**

Run focused tests for:

- hard-crash recovery;
- process-group termination;
- concurrent stale recovery;
- 64 MiB oversized JSONL handling;
- metadata-only sentinel exclusion;
- HMAC redaction;
- sensitive Git paths;
- inspect native privacy;
- artifact durability;
- dirty-repository refusal.

Record test names and results.

- [ ] **Step 4: Run controlled fail-then-pass acceptance**

In a clean disposable Git repository, record a controlled Codex-compatible stream with one failed likely-test command followed by one passed likely-test command. Verify:

- source command terminal events precede derivations;
- failed evidence is not rewritten after pass;
- latest is passed;
- previousFailures is 1;
- durability and coverage are complete;
- assessment is unreviewed/projected.

Then run:

    pnpm agentlens assess RUN_ID --verdict partial --task-completed uncertain --note "Needs manual review" --data-root DATA_ROOT --json
    pnpm agentlens inspect RUN_ID --data-root DATA_ROOT --json

Verify the explicit partial human assessment coexists with latest likely-test pass.

- [ ] **Step 5: Run none-detected and privacy acceptance**

Record a standard no-test run and verify none_detected/projected unreviewed.

Record metadata-only and strict sentinel fixtures spanning prompt, message, command, output, diff, native payload, and assessment note candidates. Scan the entire data root including SQLite, WAL/SHM, key-adjacent paths, and artifacts. Assert no sentinel content bytes persist.

Run standard token redaction and sensitive-path tests and verify only keyed HMAC/exclusion markers persist.

- [ ] **Step 6: Run real Codex smoke recording**

Create a clean disposable Git repository with one committed file and a data root outside it. Record a small real local command without changing user Codex configuration:

    pnpm agentlens record --data-root DATA_ROOT -- codex exec --ignore-user-config --ignore-rules -c features.chronicle=false --json "Inspect the repository and report the tracked filename. Do not modify files."

Verify run ID is printed before Codex work, child exit fact is retained, provider lifecycle is inspectable, Git evidence is correct, and unknown event types would remain non-fatal. Keep raw output local and ignored; document only sanitized facts and the observed Codex version.

- [ ] **Step 7: Run doctor against the real local installation**

Run:

    pnpm agentlens doctor --data-root DATA_ROOT --json

Verify stable schema version 1, expected overall/exit code, no captured content or secrets, current migration, Codex version diagnostic, process-group result, and loopback readiness.

- [ ] **Step 8: Perform local self-review**

Inspect:

    git diff main...HEAD --stat
    git diff main...HEAD
    git log --oneline main..HEAD
    git status --short

Trace every frozen-spec acceptance criterion to a test or disposable probe. Search changed files for TODO, FIXME, TBD, placeholder logic, unqualified tests-passed wording, raw note/command copying, and read-path mutation calls. This self-review must be performed by the implementing agent.

- [ ] **Step 9: Request independent read-only review**

Invoke superpowers:requesting-code-review and assign an independent adversarial reviewer the bounded diff main...HEAD. Require Critical, Important, and Minor findings covering evidence provenance, derivation idempotency, crash gaps, privacy, assessment history, pure reads, migration compatibility, doctor safety, and scope.

Independently reproduce every blocking finding before changing code. For each accepted correction, write a focused failing regression, confirm RED, implement the minimum fix, repeat focused/full verification, and commit separately.

- [ ] **Step 10: Final fresh verification and verification-document commit**

Run again:

    pnpm test
    pnpm typecheck
    git diff --check
    git status --short

Update docs/verification/2026-08-29-agentlens-task-6.md with exact commands, results, real disposable evidence, deviations, new risks, commits, and reviewer disposition. Exclude raw/sensitive paths and streams. Commit:

    docs: record Task 6 verification evidence

- [ ] **Step 11: Stop at the Task 6 boundary**

Return the required completion report in this exact order:

1. feature-branch name;
2. resulting HEAD;
3. commits created;
4. migration added;
5. exact classifier semantics and known limitations;
6. derivation trigger and catch-up timing;
7. idempotency proof;
8. assessment model and privacy behavior;
9. runs changes;
10. inspect changes;
11. doctor checks and exit semantics;
12. exact full test, typecheck, and diff-check results;
13. Tasks 1–5 regression results;
14. fail-then-pass end-to-end evidence;
15. human-assessment disagreement evidence;
16. doctor output summary;
17. independent review findings;
18. remaining risks;
19. exactly one final verdict: READY TO MERGE TASK 6 or TASK 6 STILL BLOCKED.

Do not merge automatically and do not begin product Task 7.
