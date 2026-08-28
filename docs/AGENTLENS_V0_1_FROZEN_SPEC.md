# AgentLens v0.1 frozen specification

**Status:** frozen for implementation  
**Frozen:** 2026-08-26  
**Milestone:** Tasks 1–5, ending at `record -> durable trace -> SQLite/artifacts/Git evidence -> runs -> inspect`  
**Evidence basis:** local Codex CLI probes summarized in [the probe report](../research/agentlens-v0-codex-probes/README.md).

## 1. Frozen product boundary

AgentLens v0.1 records one local `codex exec --json` invocation in a clean Git repository and reconstructs its **observable execution trajectory**. It preserves provider events, recorder/process facts, final Git evidence, and later derivations or human assessments without collapsing those evidence classes.

One AgentLens run is one wrapper invocation. It is not a claim about every action in a provider session, private reasoning, complete filesystem provenance, causal intent, or automatic correctness.

### Tasks 1–5 include

- A TypeScript/Node CLI invoked during development as `pnpm agentlens -- <args>` and packaged with the binary name `agentlens`.
- `agentlens record -- codex exec --json ...` with exact child argument preservation.
- Clean-repository preflight and before/after Git evidence using read-only Git commands.
- Redacted, append-only normalized and native event persistence in SQLite plus external artifacts.
- Unknown/malformed event tolerance, process/provider contradiction preservation, and crash/interruption recovery.
- `agentlens runs` and `agentlens inspect <run-id>`.

### Excluded from Tasks 1–5

- React, HTTP API, a daemon, Claude Code hooks, exports, replay, hosted storage, accounts/teams, comparisons, automatic grading, cost estimates, and interactive Codex capture.
- Test-command derivations, assessments, and `doctor` are Task 6. The API/UI is Task 7.

The accepted `codex exec --json`, local-only, clean-Git architecture is not reconsidered unless implementation evidence disproves a material assumption.

## 2. Evidence classes and immutability

```ts
type Provenance =
  | "observed"
  | "derived"
  | "git_recovered"
  | "recorder"
  | "human";

type EventStatus =
  | "in_progress"
  | "completed"
  | "failed"
  | "declined"
  | "interrupted"
  | "unknown";

type RunStatus =
  | "starting"
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "recorder_error";
```

Observed events are immutable and event history is append-only. `item.started` and `item.completed` are separate observed events even when they share a native item identifier. No recovery routine updates, replaces, or deletes the original `in_progress` event.

If a provider start has no matching provider terminal event, AgentLens appends a `recorder.recovery` event with `provenance: "recorder"`, `status: "interrupted"`, and a `recovers` relationship to the original AgentLens event. The CLI label **Recorder recovery** is reserved for `recorder.recovery`; other recorder facts display as **Recorder**.

Git evidence has `provenance: "git_recovered"`. Derived events name their algorithms and source AgentLens event IDs. Human assessments remain separate rows/events in later tasks.

## 3. Canonical event and relationships

```ts
type EventRelationshipType =
  | "derived_from"
  | "recovers"
  | "correlates_with";

interface EventRelationshipV1 {
  type: EventRelationshipType;
  eventId: string;
}

interface NativeSourceV1 {
  provider: "codex-exec" | "claude-code";
  sessionId?: string;
  threadId?: string;
  turnId?: string;
  itemId?: string;
  toolId?: string;
  eventType?: string;
  itemType?: string;
  correlationId?: string;
}

interface TraceEventV1 {
  id: string;
  runId: string;
  sequence: number;
  receivedAt: string;
  sourceOccurredAt?: string;
  kind: string;
  status: EventStatus;
  provenance: Provenance;
  source: NativeSourceV1;
  relationships: EventRelationshipV1[];
  summary: string;
  normalizedPayload?: unknown;
  nativePayload?:
    | { storage: "inline"; redacted: unknown }
    | { storage: "artifact"; artifactId: string }
    | { storage: "omitted"; reason: string };
  derivation?: {
    name: string;
    version: string;
    sourceEventIds: string[];
    confidence?: "high" | "medium" | "low";
  };
}
```

The same native source identifier can appear on multiple immutable lifecycle events. `relationships` link AgentLens events; native identifiers correlate provider facts.

Initial kinds are open strings and include `thread.started`, `turn.started`, `turn.completed`, `turn.failed`, `message.agent`, `reasoning.summary`, `plan.updated`, `command`, `file.change`, `tool`, `usage.reported`, `error`, `source.unknown`, `recorder.stream_diagnostic`, `recorder.process_exit`, `recorder.recovery`, `run.reconciled`, `git.snapshot`, and `git.final_evidence`.

Unknown event/item types normalize to `source.unknown`, retain all redacted unknown fields in `nativePayload`, and never crash ingestion. No v0.1 `file.read` event is inferred from shell text.

### Native-payload persistence

Every accepted source record has both:

- a normalized redacted representation in `normalizedPayload`; and
- a redacted provider-native representation in `nativePayload`.

After redaction, native JSON up to 32 KiB is stored inline. Larger native JSON is externalized to the artifact store. `metadata-only` and `strict` store an explicit omitted representation instead of content. A monolithic `source_jsonl` artifact is not retained in v0.1; per-event native preservation is authoritative and avoids duplicated sensitive content.

## 4. Parsing and append-only ingestion

1. Read child stdout and stderr through separate pipes; do not use a PTY.
2. Split stdout by line. A JSON object is a provider candidate. Invalid JSON, primitives, arrays, and unexpected stdout text append `recorder.stream_diagnostic` without ending the run.
3. Redact the normalized summary/payload and the full native object in memory before any durable write.
4. Append one event row. Never update an observed event row.
5. Treat provider completion as a new authoritative provider fact, not a mutation of its start.
6. Persist stderr under the active capture policy as recorder diagnostics/artifacts; never mix it into provider JSONL.
7. Assign recorder sequence and receipt time. Preserve provider time separately only when present.

## 5. Run facts and reconciliation

The database run row begins as `starting`, moves to `running` only after successful child spawn, and ends in one terminal `RunStatus`. Provider terminal facts, child-process facts, and recorder failures remain independently inspectable events/columns.

Reconciliation uses this precedence:

1. A persistence/recorder failure that prevents trustworthy completion -> `recorder_error`.
2. A delivered signal, explicit user interruption, or child signal termination -> `interrupted`.
3. A provider failed terminal event, or a nonzero numeric child exit -> `failed`.
4. Provider completed terminal event plus numeric child exit `0` -> `completed`.
5. Numeric child exit `0` without a provider terminal event -> `failed` with reason `incomplete_provider_stream`.
6. Any unresolved terminal combination -> `recorder_error` with reason `unreconciled_terminal_facts`.

Contradictions are never hidden. For example, provider completion plus child exit `1` yields derived run status `failed`, while both the provider-completed event and process-exit event remain visible. `run.reconciled` lists the supporting event IDs and contradiction codes.

An interrupted open item keeps its observed start unchanged and gains one correlated `recorder.recovery` event. No provider completion or numeric exit code is fabricated.

## 6. Capture policy and redaction

Capture policy applies before persistence to summaries, labels, prompts, messages, command strings, output, MCP/tool payloads, Git status/diffs, native payloads, stderr, and recorder diagnostic content.

### Modes

| Mode | Durable content |
|---|---|
| `standard` | redacted content plus non-sensitive Git evidence; sensitive paths excluded |
| `metadata-only` | lifecycle/status/count/type fields and permitted structural metadata only; no prompt, message, command, output, diff, stderr, summary-derived source text, or native/raw-content bytes |
| `strict` | metadata-only plus HMAC-tokenized path/command labels where needed |

In `metadata-only`, summaries use fixed content-free templates such as `Command event` and `Agent message event`. The unique sentinel strings used in prompts/messages/commands/outputs/diffs/native payloads must not occur anywhere in SQLite, WAL/SHM files, artifacts, temp files, or stored logs after the run.

### Keyed markers

AgentLens creates a random 32-byte machine-local redaction key at `<data-root>/secrets/redaction-hmac.key`, with owner-only directory/file permissions. Stable markers use HMAC-SHA-256 and a 16-byte hexadecimal prefix:

```text
[[REDACTED:<rule-id>:hmac-sha256:<32 lowercase hex chars>]]
```

An ordinary unkeyed hash of the secret value is forbidden. Redaction audits store rule IDs and counts, never original values.

### Sensitive paths and Git diffs

Default exclusions include `.env`, `.env.*`, `*.pem`, `*.key`, `id_rsa*`, `credentials*`, `secrets*`, `.aws/**`, `.ssh/**`, and `.gnupg/**`, plus configured deny globs.

Path policy applies to standalone paths and to every file block inside a Git diff. If either old or new path is sensitive, omit that complete diff block and insert a content-free exclusion marker. Rename/copy headers are inspected too. Diff content still passes value redaction after block filtering.

Secret detection is risk reduction, not a guarantee. CLI output must warn that captured content can contain sensitive material and should be reviewed before any future export.

## 7. Artifact durability and garbage collection

Artifacts are content-addressed from already-redacted bytes. Creation order is:

1. redact in memory;
2. write an owner-only same-filesystem temporary file;
3. `fsync` the file;
4. atomically rename to `artifacts/sha256/<prefix>/<sha256>`;
5. `fsync` the containing directory where the platform supports it;
6. commit SQLite metadata referencing the completed artifact.

Filesystem creation and SQLite insertion are not one atomic transaction. A crash may leave an orphan file; startup/maintenance may garbage-collect artifacts not referenced by a committed row. A committed artifact row must never reference a file that was not successfully created.

Artifact content is capped at 10 MiB after redaction and has a visible truncation marker plus explicit truncation/original-length metadata. Inline normalized/native previews are capped at 32 KiB. Inspection never parses or emits an incomplete truncated native JSON document; it returns bounded truncation metadata instead. Temporary files are removed on handled failures.

## 8. SQLite v1

SQLite uses WAL, foreign keys, a 5-second busy timeout, forward-only migrations, and epoch milliseconds internally.

### `runs`

`id`, schema/provider/integration/agent version, `status`, capture policy/version, redaction version, label/prompt-source metadata, repository fingerprint/display, start/end time, child pid, numeric exit code nullable, terminating signal nullable, provider terminal kind nullable, terminal reason, and contradiction codes.

### `events`

`id`, `run_id`, unique sequence, receipt/source time, kind/status/provenance, summary, normalized payload JSON nullable, native payload inline JSON nullable, native payload artifact id nullable, derivation name/version nullable. Rows are insert-only through the repository API.

### `event_sources`

One-to-one with events: provider plus nullable session/thread/turn/item/tool/event/item-type/correlation identifiers. Index `(run_id, item_id)` and `(run_id, turn_id)`.

### `event_relationships`

`event_id`, `related_event_id`, relationship type, with both sides foreign-keyed to events. Derived/recovery events require at least one appropriate relationship.

### `artifacts`

Run, kind, media type, path, SHA-256 of redacted bytes, byte length, redaction state, truncation/original length, creation time. Metadata is inserted only after artifact creation succeeds.

### `git_evidence`

One row per run containing initial/final HEAD, initial/final branch, initial/final status artifact references, tracked-final-diff artifact nullable, diff-check artifact/reference, untracked-metadata artifact nullable, `head_changed`, `branch_changed`, and capture time.

`schema_migrations` and `redaction_audits` complete the milestone schema. Assessments are added in Task 6.

## 9. Git evidence

Preflight uses read-only Git commands to capture repository root, initial HEAD, initial branch (nullable for detached HEAD), and initial porcelain-v2 status. Status uses Git's NUL-delimited form and remains byte-oriented in memory so filesystem containment and metadata checks use the exact path bytes. Any tracked, staged, or untracked entry refuses recording before child spawn. AgentLens never stashes, resets, checks out, commits, adds, cleans, or otherwise mutates Git state.

Postflight captures:

- final HEAD and branch;
- final porcelain-v2 status;
- **tracked final diff relative to the initial HEAD and current working tree/index**, including changes committed by Codex (`git diff --binary --no-ext-diff <initial-head> --`);
- `git diff --check <initial-head> --` result;
- untracked-file metadata (relative path under policy, type, size, and no contents).

If HEAD or branch changes, CLI inspection exposes the initial and final values and an explicit warning. A clean final worktree does not mean no changes: committed changes remain visible relative to initial HEAD.

Durable Git path display is valid UTF-8 only. A path that cannot be represented in the string schema is stored as the content-free `[[UNREPRESENTABLE_GIT_PATH]]` placeholder; its undecodable bytes and any path-bearing tracked-diff block are not persisted. Exact raw path bytes remain memory-only for containment plus `lstat` type/size capture.

Terminology is exact: v0.1 captures **tracked final diff + untracked-file metadata**. It does not capture untracked contents and does not claim an “exact final diff” or forensic attribution. All Git evidence is final repository evidence only.

## 10. CLI and prompt/stdin contract

The CLI package exposes binary `agentlens`. The repository root script is:

```json
{ "scripts": { "agentlens": "tsx --conditions=development apps/cli/src/main.ts" } }
```

Development invocation is `pnpm agentlens -- <agentlens arguments>`; the source entry consumes pnpm's one leading `--` wrapper delimiter before parsing AgentLens arguments. Packaged invocation is `agentlens <arguments>`.

```text
agentlens record [--label TEXT] [--capture standard|metadata-only|strict] [--data-root PATH] -- codex exec --json [codex args...]
agentlens runs [--data-root PATH] [--limit N] [--json]
agentlens inspect RUN_ID [--data-root PATH] [--json] [--native]
```

`record` requires the delimiter, a `codex` executable basename, `exec`, and `--json`. It never injects flags or changes prompt/model/sandbox/approval/permissions/cwd. It emits the run ID before child work starts.

The canonical `--data-root` must be outside the canonical recorded repository root. Equality and containment are rejected before storage/key/database creation and before child spawn, including when either path is reached through a symlink alias. A rejected preflight leaves both repository and proposed data path untouched.

For an argv prompt, the exact child argument vector is forwarded; any displayed/stored command or possible prompt text passes capture policy. AgentLens does not attempt to semantically parse every future Codex option.

For every non-TTY stdin stream—including `codex exec -`, `codex exec` with no argv prompt, and prompt-plus-stdin context—AgentLens reads stdin fully into memory before spawning, applies capture policy to its representation, then writes the **unchanged original bytes** to child stdin and closes it. Original stdin bytes are never written before redaction. Explicit `codex exec -` with TTY stdin fails preflight with instructions to pipe input. Other TTY stdin is inherited unchanged.

`promptSource` is transport metadata only: `stdin-buffered` or `tty-inherited` describes how prompt/stdin bytes reached the child. It does not claim a semantic prompt location. AgentLens does not parse or alter prompt content.

`runs` shows id, status, provider, start time, duration, child exit/signal, and Git HEAD/branch-change flags. In both text and JSON, `inspect` shows chronological immutable events with every available session/thread, turn, item/tool, event/item-type, and correlation source identifier; AgentLens event relationships; process/provider contradictions; initial/final HEAD and branch; tracked-final-diff and untracked-metadata availability; and explicit old-to-new warnings when HEAD or branch changes. The text label **Recorder recovery** is used only for `recorder.recovery`. `--native` displays redacted inline/artifact native payloads only in standard mode.

## 11. Provider capabilities

```ts
interface AdapterCapabilities {
  sourceTimestamps: boolean;
  fileReads: "native" | "partial" | "unavailable";
  toolOutput: "native" | "partial" | "unavailable";
  toolDurations: "native" | "partial" | "unavailable";
  interruptionSignal: "native" | "recorder_only" | "partial";
}
```

Codex exec v0.1 declares `sourceTimestamps: false`, `fileReads: "unavailable"`, `toolOutput: "partial"`, `toolDurations: "unavailable"`, and `interruptionSignal: "partial"`. Codex exec JSONL does not expose a safe agent-version fact in this milestone, so `agentVersion` remains the explicit value `unknown`; AgentLens does not invoke a mutating or prompt-altering probe to guess it. The CLI never renders an unavailable capability as missing agent behavior.

Claude Code is not implemented in this milestone.

## 12. Compatibility fixtures

Raw experimental streams remain local and Git-ignored under `research/agentlens-v0-codex-probes/*.log`.

Committed fixtures under `tests/fixtures/codex/` are sanitized, behavior-preserving JSONL. They replace usernames, absolute paths, thread/item identifiers, prompts, messages, repository content, and tool payload content with deterministic fake values while preserving event ordering, lifecycle types, statuses, exit codes, relationships, and usage-field shape.

`tests/fixtures/codex/manifest.json` records observed Codex version, source fixture class, sanitization classes, and the lifecycle behavior each fixture proves. Sanitization is reviewed before commit.

## 13. Task 6–7 contracts retained for later

Task 6 adds tokenized (not substring) test-command classification, derived `test.command`/`test.result` events with `derived_from` relationships, assessments, and `doctor`. Shell tokenization must identify the executed program/subcommand and reject mentions inside `printf`, comments, filenames, or quoted output.

Task 7 adds the local authenticated API and React UI. Generic recorder events display **Recorder**; only `recorder.recovery` displays **Recorder recovery**. Provider capabilities remain visible.

## 14. Tasks 1–5 acceptance

- Sanitized fixture manifest and lifecycle fixtures are committed; raw traces are ignored.
- Unknown and malformed source input appends inspectable events and never destroys the run.
- Observed lifecycle events are immutable; interruption appends correlated recovery.
- Small redacted native payload is inline; large redacted native payload is an artifact; unknown fields remain inspectable; truncated native artifacts expose bounded metadata instead of incomplete JSON.
- Metadata-only sentinel content is absent from the entire data root.
- Standard mode uses keyed HMAC markers and excludes sensitive paths, including diff blocks.
- Artifact metadata never references an artifact that was not successfully created; orphan files are tolerated.
- Successful, failure/recovery, interrupted, malformed/unknown, privacy, and dirty-repository milestone checks pass.
- A canonical data root equal to or inside the recorded repository, including through a symlink alias, fails before any storage creation or child spawn and leaves repository/data state untouched.
- Git evidence reveals HEAD/branch changes, tracked final diff relative to initial HEAD, diff-check result, and untracked-file metadata without claiming attribution or untracked contents.
- `runs` and text/JSON `inspect` expose provider facts, process facts, every available native source identifier, AgentLens relationships, reconciliation, initial/final Git values, evidence availability, explicit HEAD/branch-change warnings, and capability limits without contradiction loss.
- `agentVersion: "unknown"` is visibly explained as a v0.1 provider limitation; `promptSource` is visibly explained as prompt/stdin transport metadata, not semantic prompt location, and prompt content is neither parsed nor altered.

This document is the binding v0.1 design. Implementation deviations require concrete test evidence and must be recorded in the final milestone report.
