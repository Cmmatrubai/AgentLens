# AgentLens Task 6 Frozen Design

Status: frozen for implementation

Date: 2026-08-28

Approved amendment: 2026-08-30 — fail closed when WAL state prevents an
immutable filesystem read

Branch: codex/agentlens-task-6

Starting point: main at fb44a133c9db9ca77b9c6b456d1db12b1d5e1c16

## 1. Purpose and binding context

Task 6 adds AgentLens's first evaluation layer:

- versioned likely-test command classification;
- append-only derived test evidence;
- provider-neutral run summaries;
- durable human assessments;
- the assess command;
- the read-only doctor command;
- additive runs and inspect output.

The Tasks 1–5 recorder, lifecycle, recovery, redaction, Git evidence, artifact,
Codex normalization, and provider-capability contracts remain binding. Task 6
does not redesign them unless a direct implementation incompatibility is proven.

Task 7 is excluded. There is no HTTP API, React UI, hosted behavior, export,
comparison, replay, grading, cost estimation, Claude adapter, or quality score.

## 2. Evidence model

Task 6 preserves five evidence classes:

| Evidence class | Meaning |
| --- | --- |
| observed | Provider or child-process evidence captured by AgentLens |
| derived | A versioned AgentLens interpretation of observed evidence |
| git_recovered | Final repository evidence recovered through read-only Git operations |
| recorder | AgentLens lifecycle or recovery evidence |
| human | An explicit reviewer action |

A likely test with exit code zero supports only a derived likely-test result of
passed. It does not support task correctness, regression freedom, completeness,
or a successful human verdict.

The absence of an assessment is represented in read models as an unreviewed
projection. That projection has no human provenance, event ID, or review
timestamp. An explicit assess invocation with verdict unreviewed is a real
timestamped human action and does append human evidence.

## 3. Architecture and mutation boundaries

The approved flow is:

    terminal observed command
            |
            v
    durably persist immutable observed event
            |
            v
    provider-neutral derivation service
            |
            v
    append test.command and test.result
            |
            v
    pure Task 6 summary computation
            |
            v
    runs and inspect

Derivation happens outside provider adapters and never influences run
reconciliation.

Observed-event persistence and derivation are separate durable operations. A
crash between them may leave a reconstructible derivation gap. The observed
event remains unchanged. Retrying the derivation service fills missing derived
events without duplicates.

Every successfully persisted eligible terminal observed command immediately
invokes the derivation service. After normal source ingestion and before final
run reconciliation completes, new-run finalization scans all eligible terminal
observed commands and attempts to ensure their Task 6 derivations exist. The
same run-scoped service is exported for focused tests and explicit programmatic
backfill. Task 6 adds no automatic database-upgrade backfill and no new
general-purpose backfill CLI.

Task 6 run-summary reads detect and expose missing durable derivations without
repairing them.

The current Task 5 runs and inspect implementations invoke stale-run recovery,
create or chmod data-root files, and use the migrating database-open path. This
is a proven direct incompatibility with the approved Task 6 pure-read contract.
Task 6 therefore makes both commands fully non-mutating:

- they do not initialize a missing root;
- they do not chmod files;
- they do not apply migrations;
- they do not append recovery, derivation, or human events;
- they do not change run lifecycle state;
- they use a dedicated immutable database-open path after a fail-closed WAL
  preflight;
- their SQLite/WAL access creates, deletes, chmods, or changes no filesystem
  entry;
- they may diagnose likely-stale ownership in the returned read model.

Implementation proved that SQLite's ordinary `readonly` plus `query_only`
connection is not filesystem-immutable: it can create `-wal`/`-shm` sidecars
for a closed database and change shared-memory bytes for a live WAL. The
approved Task 6 contract therefore fails closed instead of weakening pure-read
semantics:

- the database path must be an existing regular file and every existing
  database sidecar must pass the existing no-follow containment checks;
- if the `-wal` path exists at all, the read is refused with the stable reason
  `wal_present`; AgentLens does not guess whether that WAL is active, empty, or
  safely checkpointed;
- with no WAL path, SQLite is opened in read-only immutable mode and may read
  only the checkpointed main database;
- AgentLens does not copy, checkpoint, snapshot, delete, truncate, or repair the
  database or its sidecars;
- successful immutable reads and WAL-present refusals must both preserve the
  complete data-root filesystem snapshot exactly.

This preserves purity at the explicit product cost that `runs`, `inspect`,
`assess` validation, and SQLite doctor checks may be unavailable while a WAL
path is present. Writable recorder/maintenance flows remain responsible for
normal SQLite checkpoint/close behavior; read commands never trigger it.

The existing durable stale-run recovery service remains unchanged. Its automatic
trigger moves to record startup after the existing non-Git/dirty-repository and
data-root containment preflights pass, but before a new run is created or Codex
is spawned. It also remains explicitly callable from write/maintenance code and
tests. This preserves dirty-repository refusal without storage mutation. runs on
a missing root returns an empty result without creating storage; inspect on a
missing root or run returns a non-mutating not-found error.

## 4. Provider-neutral classifier

### 4.1 Public contract

The classifier lives in a new provider-neutral package:

    packages/derivations

Its input is a durably stored structured observed command, not a
provider-native object and not a rendered summary:

    interface ObservedCommand {
      command: string;
      exitCode: number | null;
      eventStatus: EventStatus;
    }

Successful classification returns:

    interface TestCommandClassification {
      family:
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
      confidence: "high" | "medium";
      derivationVersion: "test-command/1";
    }

The canonical derivation fields use name test-command and version 1. Read
models expose the combined identifier test-command/1.

### 4.2 Eligible source event

An event is eligible only when all of the following hold:

- provenance is observed;
- kind is command;
- the native item type, when present, is command_execution;
- its event status is completed or failed;
- its provider event type, when present, is a terminal item event rather than a
  start or progress event;
- its normalized payload contains available structured command evidence;
- the run capture policy is standard.

The classifier reads the redacted normalized command evidence after the
observed event has been durably persisted. It never reads native payloads.

Metadata-only and strict normalized events omit command content. AgentLens does
not inspect the omitted content in memory merely to derive semantics. Their
likely-test summary state is unavailable_due_to_capture_policy.

Task 5 may replace a normalized payload larger than 32 KiB with structural
metadata. Task 6 makes command evidence independent of output and native-payload
size by adding this redacted normalized structure to every observed command:

    commandEvidence:
      { state: "available", redactedCommand: string }
      | {
          state: "omitted",
          reason: "metadata-only" | "strict" | "capture-bound"
        }

For standard capture, the redacted command is retained up to 16 KiB of UTF-8
even when aggregated output causes the rest of the normalized payload to be
truncated. The retained value is extracted from the already-redacted normalized
object, not redacted a second time. A command exceeding that bound is omitted
with capture-bound and is not classifiable. Any omitted command evidence maps
to unavailable_due_to_capture_policy rather than none_detected.

### 4.3 Tokenizer boundary

Task 6 uses a deterministic, non-executing, conservative shell tokenizer owned
by the derivations package. It supports:

- spaces and tabs;
- single and double quoted tokens;
- backslash escaping where unambiguous;
- comments beginning with an unquoted hash at a shell word boundary;
- leading environment assignments;
- the safe wrappers env and command.

It rejects or leaves unclassified any command containing unsupported shell
evaluation that could change the executable, including command substitution,
backticks, parameter-selected executables, process substitution, or malformed
quoting.

Shell-evaluated wrappers such as bash -lc and sh -c are intentionally
unclassified in test-command/1. Task 6 does not recursively interpret their
string arguments.

test-command/1 accepts exactly one simple command after leading assignments and
approved wrappers. Any unquoted semicolon, newline, and-and, or-or, pipe,
background operator, or other shell control operator makes the whole command
unclassified. AgentLens cannot safely attribute a compound shell command's
aggregate exit code to an individual test segment.

Arguments containing runner names do not classify a command whose executed
program is echo, printf, cat, grep, touch, or another non-test program.

The wrapper grammar is deliberately narrow:

- env accepts zero or more NAME=VALUE assignments, an optional double-dash,
  then the executable;
- env options such as -S, -i, -u, --unset, and --chdir are unclassified;
- command accepts an optional double-dash followed by the executable;
- command modes or options such as -v, -V, and -p are unclassified.

### 4.4 Recognized families

High-confidence direct forms include:

- pytest, python -m pytest, and python3 -m pytest;
- jest, npx jest, vitest, and npx vitest;
- npm test, npm run test, and npm run scripts whose token is exactly test or
  begins with test:;
- pnpm test, pnpm run test, and pnpm run scripts whose token is exactly test or
  begins with test:;
- yarn test and yarn run test;
- cargo test and go test;
- mvn test and Maven invocations whose options are in an explicit v1 allowlist
  before the exact test lifecycle goal;
- gradle test and ./gradlew test.

Ordinary flags and paths after the identified invocation are allowed.

Medium confidence is reserved for recognized package-manager test: scripts or
supported wrappers where the exact runner behind the script is not observable.
Direct runner and exact test-subcommand forms are high confidence.

Matching is token based. It never uses substring matching. Filenames such as
pytest-results.txt and jest-output.txt do not classify.

Maven parsing distinguishes no-operand options, attached-value options, and
known options that consume the following token. A token test consumed as an
option operand is never treated as the lifecycle goal. An unknown Maven option
before test leaves the command unclassified.

## 5. Derived test events

Each classified eligible observed command produces two append-only events:

### 5.1 test.command

- provenance: derived;
- kind: test.command;
- status: the terminal source command status;
- summary: content-free likely-test wording including only family and
  confidence;
- normalized payload: family, confidence, and derivation identifier;
- relationship: exactly one derived_from relationship to the source event.

### 5.2 test.result

- provenance: derived;
- kind: test.result;
- status: completed for passed, failed for failed, and unknown for unknown;
- normalized payload: family, confidence, outcome, and observed numeric exit
  code when present;
- relationship: exactly one derived_from relationship to the same source event.

Outcome is determined conservatively:

- numeric exit code zero means passed;
- numeric nonzero exit code means failed;
- an explicit observed failed command status without a numeric exit means
  failed;
- otherwise the result is unknown.

No command string, output, prompt, message, or native payload is copied into a
derived event.

### 5.3 Deterministic identity and concurrency

Every derived event has a deterministic derivation identity computed from a
canonical encoding of at least:

- run ID;
- source AgentLens event ID;
- derivation name;
- derivation version;
- derived kind.

The identity is a full SHA-256 digest with an AgentLens derivation prefix. The
derived event ID is deterministic from the same tuple.

The next forward migration adds a derivation_identities binding table. It stores
the identity, run ID, source event ID, derivation name, derivation version,
derived kind, and derived event ID with same-run foreign keys. It enforces both
unique run-plus-identity and unique natural tuple constraints. The canonical
derivation object and inspect JSON expose the identity.

The repository appends a derived event in a transaction that checks or resolves
the durable identity, allocates the next sequence, validates the same-run source
relationship, and inserts the event. A concurrent unique conflict is resolved
by loading and validating the already committed event. It is never treated as a
request to create another event.

If test.command exists but test.result does not after a crash, a retry appends
only test.result. Repeated complete derivation is a no-op.

Derived events retain only the run provider as source context and do not copy a
provider-native event type or lifecycle identity. Their provenance and
derived_from relationship are authoritative. Human assessment events follow the
same source-context rule and cannot masquerade as provider observations.

## 6. Run-summary read model

Summary computation is provider neutral and has no durable side effects. Each
field includes its evidence class, availability, and supporting event or
artifact IDs where applicable.

The Task 6 summary includes:

- terminal commands observed;
- failed terminal commands observed;
- native file-change evidence when available;
- tracked-final-diff availability;
- untracked-file count when recoverable from validated untracked metadata;
- likely-test state and attempt history;
- elapsed time from recorder timestamps;
- observed token usage when present;
- current human assessment or the unreviewed projection;
- provider capability limitations.

Unknown or unavailable telemetry is never represented as zero.

### 6.1 Likely-test summary

The top-level state is exactly one of:

- none_detected;
- unavailable_due_to_capture_policy;
- detected.

For detected, the summary contains:

- total attempt count;
- passed, failed, and unknown attempt counts;
- latest outcome;
- previous failure count, excluding the latest attempt when it failed;
- ordered source event IDs;
- ordered durable derived event IDs;
- derivation identifier;
- durability state complete or incomplete;
- count of expected derived events that are missing;
- classification coverage complete or partial;
- count of terminal commands whose command evidence was omitted.

The latest outcome is based on source-event chronology. A failed then passed
sequence is described as latest passed with one previous failure, never as an
unqualified statement that tests passed.

For standard capture, the pure summary layer may classify terminal observed
commands in memory to distinguish none_detected from a crash gap. It compares
the expected deterministic identities with durable derived events. This
read-time interpretation is returned with derived provenance and source event
IDs but performs no writes.

For metadata-only and strict, classification is not attempted and the state is
unavailable_due_to_capture_policy even when zero durable test events exist. A
standard run with only omitted command evidence has the same unavailable state.
When at least one test is detected but other terminal commands have omitted
command evidence, the state remains detected with partial coverage and the
omitted count.

### 6.2 Human-assessment projection

When no current assessment row exists:

- verdict is unreviewed;
- state is projected;
- provenance is null;
- event ID, reviewedAt, and updatedAt are null.

When an explicit assessment exists:

- state is explicit;
- provenance is human;
- its current event ID and timestamps are present;
- explicit verdict unreviewed remains distinguishable from the default
  projection.

## 7. Human assessment storage and privacy

The next migration adds a current_assessments table. Append-only
assessment.updated events are the historical record; no mutable history table
is needed. It also adds an append-only event_artifact_bindings table with
same-run foreign keys. Each standard reviewer-note artifact is relationally
bound to its assessment event with role assessment_note, so projection updates
and future garbage collection cannot orphan historical note evidence.

The current row contains:

- run ID;
- current human event ID;
- verdict: unreviewed, success, partial, or failure;
- task completion: yes, no, or uncertain;
- note state: absent, artifact, or omitted;
- optional note artifact ID;
- optional omission reason: metadata-only or strict;
- reviewedAt;
- updatedAt.

The current row has same-run foreign keys to the run, current event, and note
artifact. reviewedAt is the first explicit review timestamp and is preserved
across updates. updatedAt is the latest assessment event timestamp.

An assess invocation is a complete replacement of the current structured
assessment:

- omitted task-completed defaults to uncertain;
- omitted note means the current note is absent;
- prior assessment events and prior note artifacts remain immutable history;
- explicit unreviewed requires taskCompleted uncertain;
- a reviewer note is allowed with explicit unreviewed.

Reviewer-note input is bounded to 16 KiB of UTF-8 before any write.

For standard capture, a non-empty note is redacted in memory and written as an
owner-only text artifact using the existing safe artifact ordering. Its raw
bytes never enter SQLite. For metadata-only and strict, note content is not
written anywhere in the AgentLens data root; only structured assessment fields
and an explicit omitted state are persisted.

The assessment.updated event has completed status and contains structured
verdict, task completion, note state, and note artifact ID when present. Its
summary contains no reviewer-note content. It has human provenance and no native
payload.

The note artifact file is completed before the SQLite transaction. One SQLite
transaction then commits any artifact metadata and redaction audits, appends the
human event exactly once, and updates the current projection. A database failure
may leave an orphan artifact file, but no committed row may reference a missing
artifact.

Artifacts are content addressed. If the same redacted note is assessed again in
the same run, the transaction validates and reuses matching committed artifact
metadata rather than inserting a duplicate row. It still appends a distinct
assessment.updated event and a distinct event-to-artifact binding for the new
human action.

## 8. assess CLI

The additive command is:

    agentlens assess RUN_ID
      --verdict unreviewed|success|partial|failure
      [--task-completed yes|no|uncertain]
      [--note TEXT]
      [--data-root PATH]
      [--json]

The command:

- validates arguments and run existence through a read-only path before opening
  the approved writable/migrating path;
- enforces the note byte bound;
- loads the run capture policy;
- applies redaction or omission before durable storage;
- commits one current projection update and one append-only human event;
- never changes observed, recorder, Git, or prior human events;
- returns concise text and stable structured JSON.

Each successful invocation is a new human action, even if its values equal the
previous current assessment. CLI process retries are not silently deduplicated
because they represent repeated explicit reviewer actions.

## 9. runs and inspect contracts

Existing Task 5 JSON fields remain additive and stable where practical.

runs adds:

- a structured likelyTests object using the three-state semantics;
- a structured assessment object distinguishing projected from explicit;
- concise text such as Likely tests: latest passed, previous failures 1 and
  Reviewer: unreviewed (projected).

inspect adds:

- the complete provider-neutral run summary;
- chronological derived test.command and test.result events;
- explicit derived_from source IDs and test-command/1;
- chronological assessment.updated human events;
- the current assessment projection;
- the redacted current reviewer note for standard capture when present;
- explicit note omission for metadata-only and strict.

Reviewer-note artifact reads use the same canonical-path, non-symlink, file
identity, byte-length, and digest validation boundary used for native artifacts.

Observed, Derived, Git recovered, Recorder, Recorder recovery, and Human labels
remain visually distinct. Native-payload expansion remains exactly as defined
by Tasks 1–5.

## 10. doctor

The command is:

    agentlens doctor [--data-root PATH] [--json]

Doctor is diagnostic only. It never initializes a root, applies migrations,
repairs data, opens Git, reads captured payload or artifact content, reveals key
material, uploads telemetry, or contacts an external network service.

Doctor uses a dedicated read-only inspection path rather than prepareDataRoot or
the normal migrating openDatabase function.

### 10.1 Stable result

JSON schema version 1 contains:

- overall: pass, warn, or fail;
- data-root display path;
- an ordered checks array;
- for each check: stable ID, status, summary, and bounded structured metadata.

No check includes secrets, HMAC bytes, prompts, messages, outputs, diffs, native
payloads, reviewer notes, or captured artifact content.

Overall is fail when any required check fails, warn when none fail and at least
one warns, otherwise pass. Exit code is zero for pass or warn and one for fail.

### 10.2 Checks

Data root:

- a missing root returns check status warn with stable result code
  not_initialized;
- an initialized root must be owned by the current user on POSIX;
- expected sensitive directories must not be group or world accessible;
- sensitive regular files must not be group or world readable;
- obvious symlink substitution at the root, database, or key is a failure;
- unsupported ownership/mode inspection is a platform warning.

HMAC key:

- a missing key in an otherwise initialized database root fails;
- key type, ownership, and restrictive mode are checked;
- key content is never read into output or reported.

SQLite:

- a missing database in an otherwise empty/uninitialized root warns;
- an existing database with no WAL path is opened through the immutable
  inspection connection;
- a present WAL path produces the stable non-mutating `wal_present` failure;
- schema_migrations is read without applying changes;
- current migration equals the highest Task 6 migration;
- an older or future unsupported schema fails clearly;
- required tables and indexes are checked;
- foreign-key metadata and foreign_key_check are checked;
- quick_check must return ok;
- open, schema, foreign-key, or integrity errors fail.

Codex:

- codex --version is executed locally with bounded output and timeout;
- an available version passes;
- a missing or failing executable is an actionable failure;
- the version is diagnostic only and is never written into historical runs.

Platform:

- POSIX process-group support passes where available;
- a supported fallback or known limitation warns rather than fabricating
  support.

Loopback:

- doctor may bind port zero on 127.0.0.1 and immediately close it;
- failure is a Task 7-readiness warning, not a Task 6 recorder failure;
- no non-loopback address is used and no listener remains running.

## 11. Forward migration and compatibility

The current highest migration is 003_recorder_ownership.sql. Task 6 adds only
the next forward migration, 004_task6_evaluation.sql.

Migration 004:

- adds derivation_identities and its identity/natural-tuple constraints;
- adds current_assessments and its indexes/constraints;
- adds event_artifact_bindings and its same-run constraints;
- does not rewrite historical events, runs, artifacts, Git evidence, ownership,
  audits, or provider payloads;
- does not synthesize human judgments;
- does not automatically backfill derived events.

Pre-Task-6 databases migrate through normal writable entry points such as record
and assess. The pure runs and inspect paths detect the available migration set
without upgrading it. Their storage reads remain compatible with a Task 5
schema: missing Task 6 identity/assessment tables mean no durable Task 6
derivations and a projected unreviewed assessment, while summaries may still
classify available standard normalized commands in memory.

For a Task 5 command event, the summary layer uses the legacy redacted
normalized command string when present. A legacy command event whose normalized
payload is marked truncated but no longer contains its command is treated as
omitted capture evidence and therefore unavailable_due_to_capture_policy, never
none_detected.

Tests compare original evidence before and after a writable migration and
require it to be logically unchanged, with only the Task 6 schema additions
present.

## 12. Error handling

- Unsupported or malformed command text returns no classification and never
  crashes recording.
- A classifier bug must be contained to Task 6 derivation; the observed event
  remains durable and eligible for later retry.
- A derivation persistence error follows existing recorder error handling
  because durable storage is unhealthy, but it never rewrites source evidence.
- Assessment validation fails before database mutation.
- Assessment artifact or transaction failure leaves the previous current
  assessment intact.
- Doctor converts local diagnostic failures into stable check results and does
  not expose raw exception content that could contain secrets.

## 13. Verification requirements

Implementation uses test-driven development for each independently testable
behavior: demonstrate RED, implement the smallest correct change, demonstrate
GREEN, run adjacent regression tests, typecheck, and review the diff before
commit.

Required coverage includes:

- every positive and negative classifier family/example in the Task 6 request;
- safe env and command wrappers;
- unclassified bash -lc and sh -c;
- malformed quoting and unsupported expansion;
- passed, failed, and unknown test results;
- deterministic identities and concurrent/retry idempotency;
- crash gap and finalization catch-up;
- explicit programmatic historical backfill;
- three-state likely-test summaries;
- failed then passed attempt history;
- projected and explicit unreviewed assessments;
- assessment updates and immutable human history;
- note redaction, omission, bounds, and artifact ordering;
- additive runs and inspect text/JSON;
- byte-for-byte and metadata-level proof that successful checkpointed reads and
  WAL-present refusals change no data-root files, including SQLite WAL/SHM
  state;
- doctor pass, warning, failure, privacy, and stable JSON;
- safe migration of a pre-Task-6 database;
- the complete Tasks 1–5 regression suite and real Codex smoke recording.

End-to-end Task 6 acceptance explicitly includes:

- a real or controlled fail-then-pass likely-test trajectory showing latest
  passed, one previous failure, and projected unreviewed;
- an explicit human partial assessment coexisting with latest likely pass;
- a standard run with no recognized test showing none_detected and projected
  unreviewed;
- doctor --json against the real local installation with no secrets or captured
  content in output.

Named focused Tasks 1–5 regressions are rerun for:

- hard-crash recovery;
- process-group termination;
- concurrent stale recovery;
- 64 MiB oversized JSONL handling;
- metadata-only sentinel exclusion;
- HMAC redaction;
- sensitive Git paths;
- inspect native privacy;
- artifact durability;
- dirty-repository refusal;
- real Codex smoke recording.

After implementation, an independent read-only review compares the feature
branch with main and classifies Critical, Important, and Minor findings. Task 6
is not merge-ready until blocking findings are fixed and fresh verification
passes.

## 14. Stop rule

Stop after Task 6 implementation, end-to-end evidence, regression verification,
and independent review. Do not merge automatically and do not begin Task 7.
