# AgentLens Task 6 verification evidence

Date: 2026-08-30

This is the sanitized evidence packet for Task 6. It records fresh verification
at the resulting implementation HEAD and the accepted review corrections. It does not include raw
provider streams, source sentinels, keys, prompts, repository contents,
reviewer-note content, local usernames, or absolute machine paths.

## Scope and branch state

- Branch: `codex/agentlens-task-6-impl`
- Comparison base: `main` at
  `fb44a133c9db9ca77b9c6b456d1db12b1d5e1c16`
- Reviewed correction implementation HEAD:
  `f59cf759dcccd5c7ac4f8ce9430b0afc3e1b244c`
- Original pre-review HEAD:
  `4e51db973f0051308d604610077043248a0faeee`
- Branch commits through the implementation HEAD: 29
- Implementation comparison: 69 files, 17,488 insertions, 227 deletions
- The first independent review reproduced a cross-run assessment-note defect.
  The accepted correction and its RED/GREEN regressions are recorded
  below; no schema or frozen-architecture change was made.
- Task 7/UI/server/export/comparison/grading/Claude work: not started.

### Commit list, newest first

```text
f59cf75 fix(storage): scope assessment note reuse by run
4e51db9 fix(cli): await doctor fallback cleanup
b4a4a92 fix(cli): preserve database metadata in doctor
599a1f7 fix(cli): harden doctor containment and cleanup
7b29521 fix(cli): harden doctor diagnostics
a84cfba feat(cli): add read-only doctor diagnostics
3565feb fix(cli): fail closed on orphan WAL
7655c0c feat(cli): add pure Task 6 run inspection
c4729a3 fix(cli): validate direct assessments before writes
f6e7940 feat(cli): add explicit human assessment command
77d12b6 fix(storage): allow same-timestamp assessment actions
94ad2e1 fix(storage): enforce assessment evidence invariants
abcb716 feat(storage): add durable human assessments
d34092b fix(evaluation): reject native context on derived evidence
1bce28b fix(evaluation): validate summary evidence semantics
72a1abc feat(evaluation): add pure run summaries
35453bc fix(recorder): rebase after partial test derivation
e095e9a feat(recorder): derive test evidence after durable commands
8cb73b2 feat(evaluation): add idempotent test derivation service
50390a5 fix(storage): reject null assessment run ids
8ecdcf4 feat(storage): add Task 6 schema and read-only inspection
7f8182a docs(task6): freeze SQLite URI initialization
25749ec docs(task6): approve fail-closed WAL reads
dc9a486 fix(recorder): enforce command evidence byte bounds
6f86c17 feat(recorder): persist bounded redacted command evidence
c07d637 fix(derivations): preserve frozen wrapper grammar
1980448 feat(derivations): add conservative test command classifier
b071096 docs: add Task 6 implementation plan
57247e1 docs: freeze AgentLens Task 6 design
```

## Migration 004 and compatibility

`004_task6_evaluation.sql` is the only new forward migration. It adds:

- deterministic `derivation_identities` with same-run and natural-tuple
  uniqueness;
- `current_assessments` with structured note-state constraints and same-run
  event/artifact references;
- append-only `event_artifact_bindings` for assessment-note provenance.

It does not rewrite historical events, runs, artifacts, Git evidence,
ownership, audits, or provider payloads, synthesize human judgment, or
automatically backfill derived events. Writable entry points migrate forward;
`runs`, `inspect`, and `doctor` use immutable read-only inspection and do not
migrate. Task 5-schema reads project unreviewed and classify available legacy
standard command evidence in memory. Exact focused evidence:

```text
pnpm vitest --run packages/storage/test/migrations.test.ts --reporter verbose
exit 0; 1/1 file; 7/7 tests
```

The seven cases covered fresh schema/pragmas, idempotent migration discovery,
v1 forward migration, preservation of populated Task 1-5 evidence through v3
to v4, same-run/identity/note constraints, missing run identity rejection, and
future migration reporting without rewrite. The storage suite also passed
127/127, and the read-command gate passed Task 5-schema compatibility without
migration.

## Classifier and derived evidence contract

`test-command/1` is provider neutral and reads only durably stored,
already-redacted structured command evidence from terminal observed
`command_execution` events under standard capture. It tokenizes without
execution and recognizes exact forms for pytest, Jest, Vitest, npm, pnpm,
yarn, Cargo, Go, Maven, and Gradle. Direct/exact forms are high confidence;
supported package-manager `test:` scripts are medium confidence.

The grammar supports spaces/tabs, simple quoting/escaping, word-boundary
comments, leading assignments, and narrow `env`/`command` wrappers. It rejects
malformed quoting, command/parameter/process substitution, shell control
operators, compound commands, unsafe wrapper options, `bash -c`/`sh -c`,
substring-only runner names, and unknown Maven option shapes. Standard command
evidence is bounded at 16 KiB UTF-8; restrictive capture and capture-bound
evidence are not classified and report unavailable rather than none detected.

Each eligible source yields append-only `test.command` and `test.result`
events. The result is passed for exit 0, failed for numeric nonzero or explicit
failed status, and unknown otherwise. Derived facts contain family,
confidence, outcome/exit metadata, identity, and exactly one `derived_from`
relationship; they do not copy command, output, prompt, message, or native
content.

Derivation runs eagerly only after the terminal observed source append returns.
Finalization catches up complete gaps and split-write gaps. Recorder error
handling contains classifier failures without changing the durable source.
Identities are full SHA-256 values over the run/source/name/version/kind tuple;
the storage transaction resolves retries and concurrent uniqueness conflicts
to the same validated durable winner.

Focused ordering/crash-gap evidence:

```text
pnpm vitest --run apps/cli/test/recordRun.integration.test.ts \
  -t 'derives test evidence only after the terminal observed command is durable|finalization fills a complete eager-derivation gap and remains idempotent|finalization fills only the missing result after a split eager write|contains classifier exceptions per durable source and leaves a retryable gap' \
  --reporter verbose
exit 0; 4/4 selected; 35 skipped

pnpm vitest --run packages/storage/test/runRepository.test.ts \
  -t 'fills a split-write gap and makes every retry a no-op|converges two racing repository connections on the same durable winner|rehydrates the exact durable identities after closing and reopening' \
  --reporter verbose
exit 0; 3/3 selected; 97 skipped
```

## Assessment provenance and privacy

Missing assessment is a read-time projection: `unreviewed`, `uncertain`, no
human provenance, event ID, or timestamps. `assess` validates its direct
runtime input and existing run through a read-only path before opening the
approved writable path. Each successful action appends one human
`assessment.updated` event and replaces only the current structured
projection; previous human events and note bindings remain immutable.

Standard notes are bounded to 16 KiB UTF-8, redacted in memory, durably
completed as owner-only artifacts before the SQLite transaction, audited, and
relationally bound to the event. Raw note bytes never enter SQLite.
Metadata-only and strict notes persist only their explicit omission reason.
An explicit `unreviewed` remains distinct from the projection.

The controlled disagreement case appended an explicit human `partial` /
`uncertain` assessment with a timestamped event and note artifact while the
derived latest likely-test result remained passed with one previous failure.
The observed and derived event hashes and facts were unchanged.

Secret detection and keyed redaction are risk reduction, not a guarantee that
captured data is free of sensitive material.

## `runs`, `inspect`, and `doctor`

`runs` and `inspect` are pure/non-mutating. Both use the immutable read-only
database path, fail closed when a WAL path is present, avoid stale recovery and
migration, and preserve Task 5 compatibility. Both add three-state likely-test
and projected/explicit assessment models. `inspect` additionally exposes
chronological provenance/relationships and validates any requested reviewer
note or native artifact before reading it. Reviewer-note content remains absent
from `runs`.

`doctor` is diagnostic only. It does not initialize, migrate, repair, invoke
Git, read captured payload/artifact/key content, or contact an external
service. Schema 1 returns seven ordered checks: data root, sensitive paths,
redaction key, SQLite, Codex, process groups, and loopback. Any failure makes
overall fail/exit 1; warnings without failures and passes return exit 0.

## Fresh automated gates

All commands ran at the resulting pre-review HEAD; no prior output was reused.

```text
pnpm vitest --run packages/derivations/test
exit 0; 5/5 files; 132/132 tests

pnpm vitest --run packages/storage/test
exit 0; 5/5 files; 127/127 tests

pnpm vitest --run apps/cli/test/assess.integration.test.ts apps/cli/test/readCommands.integration.test.ts apps/cli/test/doctor.test.ts apps/cli/test/doctor.integration.test.ts
exit 0; 4/4 files; 207/207 tests

pnpm typecheck
exit 0

pnpm test
exit 0; 38/38 files; 784/784 tests

pnpm typecheck
exit 0

git diff --check
exit 0; no output
```

Before the first independent review, the post-document repeat was also fresh:

```text
pnpm test
exit 0; 38/38 files; 784/784 tests

pnpm typecheck
exit 0

git diff --check
exit 0; no output

git status --short --branch
branch unchanged; only this untracked verification document
```

## First-review accepted correction evidence

The first independent review reproduced one public-valid defect: two standard
runs in one data root could not each bind identical redacted assessment-note
bytes because assessment metadata and audit reuse queried content ID without
the run identity. Both regressions were added and observed RED before the
production correction:

```text
pnpm vitest --run packages/storage/test/runRepository.test.ts -t 'binds identical assessment-note bytes independently to two runs' --reporter verbose
exit 1; 1/1 selected failed; 100 skipped
failure: Assessment note artifact is already owned by another run.
location: packages/storage/src/runRepository.ts:1596

pnpm vitest --run apps/cli/test/assess.integration.test.ts -t 'assesses two runs independently when their standard notes have identical bytes' --reporter verbose
exit 1; 1/1 selected failed; 56 skipped
failure: the second public assess action returned exit 1 instead of exit 0
```

The production correction changes only the assessment-artifact metadata lookup
and matching redaction-audit lookup to use `(id, run_id)`. It does not change the
schema or remove metadata, canonical-path, ownership, capture-policy,
file-handle identity, size, digest, or same-run event validation. The storage
regressions verify one artifact/audit pair per run, one human event/binding and
current projection per run, unchanged same-run idempotency, and rejection
without partial writes when artifact or event ownership does not match.

The first post-fix storage run reached the new row assertions and exposed only
a reversed test expectation for lexical `ORDER BY run_id`; the CLI regression
was already green. The test-only expected order was corrected, with no further
production change, and all subsequent commands used fail-fast execution:

```text
pnpm vitest --run packages/storage/test/runRepository.test.ts -t 'binds identical assessment-note bytes independently to two runs' --reporter verbose
exit 0; 1/1 selected; 100 skipped

pnpm vitest --run apps/cli/test/assess.integration.test.ts -t 'assesses two runs independently when their standard notes have identical bytes' --reporter verbose
exit 0; 1/1 selected; 56 skipped

pnpm vitest --run packages/storage/test/runRepository.test.ts -t 'validates and reuses one same-run content-addressed note while appending distinct actions|rejects cross-run artifact ownership and event identity without partial writes' --reporter verbose
exit 0; 2/2 selected; 99 skipped

pnpm vitest --run packages/storage/test/runRepository.test.ts --reporter verbose
exit 0; 1/1 file; 101/101 tests

pnpm vitest --run apps/cli/test/assess.integration.test.ts --reporter verbose
exit 0; 1/1 file; 57/57 tests

pnpm vitest --run packages/storage/test
exit 0; 5/5 files; 128/128 tests

pnpm vitest --run apps/cli/test
exit 0; 20/20 files; 407/407 tests

pnpm vitest --run apps/cli/test/privacy.integration.test.ts
exit 0; 1/1 file; 7/7 tests

pnpm vitest --run apps/cli/test/assess.integration.test.ts -t 'redacts a standard note, persists audits, and never emits or stores its raw sentinels|assesses two runs independently when their standard notes have identical bytes|omits a metadata-only note without creating a key or artifact|omits a strict note without creating a key or artifact' --reporter verbose
exit 0; 4/4 selected; 53 skipped

pnpm test
exit 0; 38/38 files; 786/786 tests

pnpm typecheck
exit 0

git diff --check
exit 0; no output
```

The three accepted historical report disclosures now use `<worktree>`. The
following scan covered every branch-introduced added/copied/modified/renamed
tracked file plus this untracked packet using the actual local home and username
without recording either value:

```text
scan_local_username="$(id -un)"
scan_local_home_path="$HOME"
if { git diff --name-only --diff-filter=ACMR -z main...HEAD; printf '%s\0' docs/verification/2026-08-29-agentlens-task-6.md; } | xargs -0 rg -n --no-heading -F -e "$scan_local_home_path/" -e "$scan_local_username"; then
  exit 1
fi
exit 0; zero matches
```

An additional bounded scan of the packet and three corrected reports found zero
known raw probe-root, run-ID, restrictive-capture sentinel-prefix, reviewer-note,
or real-prompt matches. No raw provider streams, prompt, source sentinel, key,
probe root, or disposable repository content was copied into Git.

## Named Tasks 1-5 regression evidence

Each command used the existing production-binding test where one exists.

1. Hard-crash recovery

   ```text
   pnpm vitest --run apps/cli/test/crashRecovery.integration.test.ts -t 'diagnoses on reads and reconciles a dead recorder at clean record startup'
   exit 0; 1/1
   ```

2. Process-group termination with resistant descendant

   ```text
   pnpm vitest --run apps/cli/test/recordRun.integration.test.ts -t 'waits for a resistant descendant before final Git and preserves direct and group signals'
   exit 0; 1/1 selected; 38 skipped
   ```

3. Concurrent stale recovery and normal-finalization race

   ```text
   pnpm vitest --run packages/storage/test/runRepository.test.ts -t 'claims stale ownership once and keeps recorder-crash recovery append-only'
   exit 0; 1/1 selected; 99 skipped

   pnpm vitest --run apps/cli/test/recoverRuns.test.ts -t 'does nothing when normal finalization wins during the recorder identity check'
   exit 0; 1/1
   ```

4. 64 MiB source line

   ```text
   pnpm vitest --run apps/cli/test/recordRun.integration.test.ts -t 'discards a 64 MiB source line content-free and records the following valid provider line'
   exit 0; 1/1 selected; 38 skipped
   ```

5. Metadata-only sentinel exclusion

   ```text
   pnpm vitest --run apps/cli/test/privacy.integration.test.ts -t 'keeps every metadata-only source sentinel out of the entire closed data root'
   exit 0; 1/1 selected; 6 skipped
   ```

6. Keyed bearer HMAC and sensitive Git diff filtering

   ```text
   pnpm vitest --run packages/core/test/redaction.test.ts -t 'uses a stable keyed HMAC marker without exposing an ordinary digest'
   exit 0; 1/1 selected; 33 skipped

   pnpm vitest --run packages/core/test/gitDiffRedaction.test.ts -t 'removes an entire sensitive-path diff block before token redaction'
   exit 0; 1/1 selected; 18 skipped

   pnpm vitest --run apps/cli/test/privacy.integration.test.ts -t 'uses the exact keyed bearer marker and removes the complete sensitive .env diff block'
   exit 0; 1/1 selected; 6 skipped
   ```

7. Inspect native privacy

   ```text
   pnpm vitest --run apps/cli/test/readCommands.integration.test.ts -t 'projects inline and artifact native content only when standard capture requests --native|keeps native content omitted with an explicit reason'
   exit 0; 3/3 selected; 51 skipped
   ```

8. Artifact durability

   ```text
   pnpm vitest --run packages/core/test/artifactStore.test.ts -t 'writes only explicitly redacted bytes and resolves after the owner-only final file exists|repairs an existing artifact.s directory durability before returning it'
   exit 0; 2/2 selected; 20 skipped
   ```

9. Dirty-repository refusal

   ```text
   pnpm vitest --run apps/cli/test/recordRun.integration.test.ts -t 'refuses a dirty worktree before the fake child or durable recorder starts|leaves pre-existing stale-capable storage byte-and-metadata unchanged on dirty Git refusal'
   exit 0; 2/2 selected; 37 skipped
   ```

10. Real local Codex smoke: see the disposable evidence below.

## Controlled end-to-end evidence

All repositories, shims, raw streams, data roots, and probe output were
disposable and outside Git.

### Failed then passed likely-test trajectory

The public CLI recorded a controlled Codex-compatible stream with two terminal
structured `command_execution` items, each normalized as `pnpm test`: first
failed/nonzero, then completed/zero.

```text
node <worktree>/apps/cli/dist/main.js record --data-root <data-root> -- \
  codex exec --json <controlled-prompt>
```

Public `runs --json`, `inspect --json`, and immutable read-only storage evidence
showed:

- two observed terminal commands and one observed failure;
- each observed terminal source was durable before its two derived events;
- the failed source payload SHA-256 was identical before and after the later
  pass and after assessment;
- `likelyTests.state=detected`, total 2, passed 1, failed 1, latest passed,
  previousFailures 1;
- durability complete, missingExpected 0, coverage complete;
- projected unreviewed with no human event before assessment.

The public assessment/inspection equivalent was:

```text
node <worktree>/apps/cli/dist/main.js assess <run-id> \
  --verdict partial --task-completed uncertain --note <reviewer-note> \
  --data-root <data-root> --json
node <worktree>/apps/cli/dist/main.js inspect <run-id> \
  --data-root <data-root> --json
```

Afterward, exactly one timestamped human event existed. The explicit partial
assessment and note artifact coexisted with latest likely-test pass; observed
and derived facts were unchanged.

### No-test trajectory

A separate standard stream with only provider lifecycle/message activity
completed with zero terminal commands. `inspect --json` reported
`likelyTests.state=none_detected` and projected unreviewed with no human event.

### Restrictive-capture privacy

Separate metadata-only and strict recordings each placed 12 unique source
sentinels across label, prompt, argv, stdin, provider message, structured
command, output, Git diff, native payload, stderr, filename, and assessment-note
candidate positions. After close and explicit assessment:

- recursive byte scans of every file under each data root found zero source
  sentinel matches;
- recursive filename/path scans found zero matches;
- each closed root contained only the SQLite database and owner-only HMAC key;
  no WAL/SHM, temporary artifact, or final artifact existed;
- command evidence and reviewer note were explicitly omitted with the exact
  capture-policy reason;
- likely-test state was `unavailable_due_to_capture_policy`, never
  `none_detected`;
- the structured human assessment still existed with human provenance.

## Real local Codex smoke

The installed strict semantic version was `codex-cli 0.151.0-alpha.7.2`.
`pnpm --dir <worktree>` was verified to change the child working directory to
the AgentLens worktree, so it was not used for this gate. The compiled
Node-shebang entrypoint was invoked from the clean disposable repository to
preserve repository-cwd semantics:

```text
node <worktree>/apps/cli/dist/main.js record --data-root <data-root> -- \
  codex exec --ignore-user-config --ignore-rules \
  -c features.chronicle=false --json <bounded-read-only-prompt>
```

The initial smoke completed in 13.4 seconds with process exit 0. An equivalent
timing repetition yielded the run ID within 0.25 seconds while provider work
was still active, then completed 12.7 seconds later with exit 0. No user Codex
configuration, model, sandbox, approval, permission, or cwd semantics were
changed.

Sanitized public read evidence for the timing run:

- run completed; child exit 0; no signal; provider terminal completed;
- ownership released;
- observed provider lifecycle contained thread/turn start, two terminal
  commands, agent messages, and turn completion; one bounded recorder stream
  diagnostic was non-fatal;
- final summary had two terminal commands, zero failures, no recognized tests,
  and projected unreviewed;
- initial/final Git evidence was available; HEAD and branch unchanged; tracked
  diff and untracked metadata absent; diff-check passed;
- the disposable repository remained clean;
- `runs --json` and `inspect --json` both succeeded.

Unknown/malformed provider source remains non-fatal by the fresh full suite and
the focused recorder regression. This smoke confirms the observed local
environment only; it does not expand provider capability claims.

## Real doctor evidence

Doctor used the same compiled entrypoint against the initialized real-smoke
data root. It returned exit 0, schema version 1, overall pass, and exactly seven
ordered checks:

1. data root: pass;
2. sensitive paths: pass (six directories, four files, four traversed entries);
3. redaction key: pass;
4. SQLite: pass (migration count/current migration 4, 13 tables, 26 indexes,
   foreign keys/query-only/integrity/quick-check valid, zero FK violations);
5. Codex: pass, version `0.151.0-alpha.7.2`;
6. process groups: pass;
7. loopback: pass on `127.0.0.1`.

A bounded output scan found no real-smoke prompt, tracked filename, or file
content. A whole-tree digest covering every path's type, mode, owner, size,
mtime, ctime, inode, and every file's SHA-256 was identical before and after
doctor. The path list was also identical; no WAL/SHM appeared.

## Self-review

The implementing agent inspected `main...HEAD` stat, name-status, log, production
diffs by package, migration/config changes, acceptance tests, and the final
working-tree diff. Searches covered TODO/FIXME/TBD/placeholder markers,
unqualified tests-passed/READY wording, raw note/command copying, writable calls
on read paths, hidden migrations, forbidden Git mutation, and Task 7 scope
terms.

Findings:

- marker/test-pass/READY matches were confined to plans, historical task
  reports, test names/assertions, and the frozen stop rule; no placeholder or
  unqualified success wording exists in Task 6 production behavior;
- derived and human events use content-free summaries/payloads and do not copy
  source command, prompt, message, output, note, or native content;
- `runs` and `inspect` use `openDatabaseReadOnly`, do not prepare/migrate a
  data root or recover stale runs, and write only their requested stdout;
- doctor uses read-only metadata/immutable SQLite inspection, bounded local
  `codex --version`, POSIX process-group probing, and loopback-only bind/close;
- migration registration contains only forward migration 004;
- Task 6 additions introduce no Git mutation; recorder Git evidence remains on
  the frozen read-only allowlist;
- no Task 7/UI/server/export/comparison/grading/Claude implementation entered
  production paths.

## Deviations and residual risks

- The requested `pnpm --dir` real-smoke form did not preserve disposable
  repository cwd. The allowed compiled entrypoint alternative was used and is
  recorded above.
- Native `sqlite3 -readonly` could not open the closed probe database in this
  environment. AgentLens public reads were unaffected; an immutable read-only
  URI succeeded and was used only for supplemental event/hash queries. No
  product change was warranted.
- The real Codex smoke was repeated once to obtain direct temporal proof that
  the run ID was visible before provider completion.
- The classifier is intentionally conservative and does not interpret compound
  shells, dynamic executables, unsafe wrappers, arbitrary Maven options, or
  command evidence unavailable because of capture policy/bounds.
- Codex JSONL does not authoritatively expose source timestamps, complete file
  reads, private reasoning, or complete tool durations/output. `agentVersion`
  remains unavailable in historical runs; doctor version is a current local
  diagnostic only.
- Secret detection and HMAC redaction reduce risk but cannot guarantee all
  sensitive material is recognized.
- Process-group evidence covers the owned local POSIX group and bounded cleanup;
  it is not a general guarantee for independently detached descendants.
- Pure reads deliberately fail closed on WAL presence. The immutable closed-DB
  snapshot does not claim live WAL/read atomicity.
- Filesystem observations are point-in-time. Same-owner pathname replacement
  remains possible, and validation across multiple pathname operations is not
  globally atomic; the implemented canonical-path, ownership, no-follow,
  file-handle identity, size, and digest checks remain bounded protections, not
  a global filesystem transaction.
- Real-smoke and doctor facts apply to the observed local version and environment,
  not every future provider version or platform.

## Independent review: accepted CLEAN

The first independent Task 6.11 adversarial review returned BLOCKED and the
controller accepted two Important corrections and one Minor documentation
correction: run-scoped assessment-artifact reuse, removal of three historical
local-path disclosures, and the point-in-time filesystem residual above. The
accepted implementation is commit
`f59cf759dcccd5c7ac4f8ce9430b0afc3e1b244c`.

The same reviewer re-reviewed the corrections and returned CLEAN with zero
Critical, Important, or Minor findings. Reviewer-reported independent reruns
passed focused storage 3/3 selected, focused public CLI 1/1 selected, complete
storage 128/128, complete CLI 407/407, and the full suite at 38/38 files and
786/786 tests. Typecheck, correction-base `git diff --check`, and worktree
`git diff --check` also passed.

The reviewer additionally repeated the public workflow in a disposable
repository: both records, both assessments, and both inspections exited zero;
the runs were distinct, the content-addressed artifact was shared, both
assessments retained human provenance, both notes were available, and the
repository remained clean.

Final verdict: READY TO MERGE TASK 6

Task 6 has not been merged or pushed, and Task 7 has not started.
