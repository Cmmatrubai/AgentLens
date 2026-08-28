# AgentLens v0.1 hardening amendment

**Status:** frozen for the post-review hardening pass

**Frozen:** 2026-08-28

**Applies to:** AgentLens v0.1 Tasks 1–5 only

**Base specification:** [AgentLens v0.1 frozen specification](./AGENTLENS_V0_1_FROZEN_SPEC.md)

This amendment closes five implementation-review findings without changing the accepted product boundary. Where this document is more specific than the base specification, this document controls. All other v0.1 contracts remain frozen.

## 1. Durable recorder ownership and stale-run recovery

Every nonterminal run has one durable ownership row containing:

- a random recorder instance ID;
- recorder PID and a platform process-start identity;
- child PID and child process-start identity when spawned, plus a process-group ID when supported;
- heartbeat and update timestamps; and
- an ownership condition: `active`, `orphan_child_active`, `identity_ambiguous`, `reconciling`, or `released`.

The active recorder refreshes its heartbeat once per second. Heartbeat age alone never proves death. A fresh AgentLens process may take recovery action only after the stored recorder PID/start-identity pair is confirmed gone or replaced. If process identity cannot be checked unambiguously, the run remains nonterminal and reports an ambiguous ownership condition.

`runs` and `inspect` perform a bounded stale-run check before reading. They may append recovery facts and terminalize a run only when the recorder is confirmed dead and both the child identity and stored process group are confirmed gone. They never signal a child.

When the recorder is dead but the child or process group remains alive, the run remains `running`, ownership becomes `orphan_child_active`, and one append-only `recorder.ownership_lost` fact exposes the condition. A later `runs` or `inspect` call may finish recovery after that child/group is independently gone. v0.1 does not add a child-termination command; the safe resolution is natural/external child termination followed by another read. This avoids turning a read command into process control.

When recorder and child/group are confirmed gone, recovery is append-only and idempotent:

1. append or reuse exactly one `recorder.ownership_lost` event;
2. append exactly one `recorder.recovery` for each genuinely open provider item, linked with `recovers`;
3. capture final Git evidence only if the caller's current repository fingerprint matches the run and read-only evidence capture is safe;
4. append exactly one `run.reconciled` referencing the ownership-loss and recovery evidence;
5. set `RunStatus` to `interrupted`, `terminalReason` to `recorder_crash`, and release ownership.

Recovery never mutates an observed start, fabricates a provider terminal event, or fabricates a numeric exit code. Failure to establish the matching repository makes final Git evidence unavailable; it does not justify reading an unverified path or persisting an unredacted repository path.

The run-status precedence gains one explicit fact: a validated recorder ownership loss with no surviving child/group derives `interrupted/recorder_crash`. A recorder persistence error still has higher precedence. Provider and process facts remain independent and contradictory evidence remains visible.

## 2. Bounded interruption

On POSIX platforms the child is started as a process-group leader. On the first user `SIGINT` or `SIGTERM`, AgentLens records interruption intent in memory and sends `SIGTERM` to the child process group. `DEFAULT_TERMINATION_GRACE_MS` is 2,000 milliseconds. If the group has not terminated by the deadline, AgentLens sends `SIGKILL`. A second user interrupt requests immediate `SIGKILL` escalation.

On platforms without process-group signaling, AgentLens applies the same bounded policy to the direct child and reports the capability limitation. AgentLens waits for the child's actual close fact and stores the actual exit code or terminating signal returned by the operating system. Interruption intent, process termination, provider lifecycle, recovery, and run reconciliation remain separate facts. Killing a process never creates provider completion evidence.

## 3. Bounded JSONL ingestion and backpressure

`MAX_SOURCE_LINE_BYTES` is 1 MiB (1,048,576 bytes), excluding the line delimiter, for each stdout or stderr record. This limit is independent of the 32 KiB native-inline threshold and 10 MiB artifact cap.

The decoder is byte-oriented. Each stream retains at most one fixed-size line buffer plus its current transport chunk. It handles arbitrary chunk boundaries, multiple records per chunk, CRLF, blank lines, and a final record without a newline. Blank lines are ignored.

Each stream awaits its current persistence callback before reading further input. The shared recorder serialization point can therefore have at most one pending callback from stdout and one from stderr; it cannot accumulate an unbounded promise or event array. Node stream backpressure limits transport buffering.

After a line exceeds `MAX_SOURCE_LINE_BYTES`, AgentLens stops retaining bytes, counts/discards through the delimiter or EOF, and emits exactly one content-free `recorder.stream_diagnostic` with:

- stream;
- reason `line_too_large`;
- configured byte limit; and
- observed byte count.

The oversized bytes are never decoded, redacted, parsed as truncated JSON, or persisted. Normal parsing resumes with the following record.

## 4. Inspect native-content projection

Storage entities never pass directly to CLI presentation. `inspect` builds an explicit DTO for every event.

Without `--native`, the DTO exposes only native storage metadata:

```json
{ "storage": "inline", "contentAvailable": true }
```

or:

```json
{ "storage": "artifact", "artifactId": "...", "contentAvailable": true }
```

It never includes inline redacted content or artifact bytes.

With `--native`, standard-mode runs may add `nativeContent` from the redacted inline value or from an integrity-, containment-, and size-validated artifact. `metadata-only` and `strict` runs keep `nativeContent` absent and expose `contentAvailable: false` plus the persisted omission reason. Text and JSON output use the same projected events.

## 5. Existing-artifact directory durability

Artifact creation remains ordered as specified in the base document. In addition, when the canonical content-addressed artifact already exists, AgentLens validates its identity, size, and digest and then synchronizes the containing directory before returning a completed artifact to the SQLite metadata layer.

This makes a second writer repair the rename-before-directory-sync crash window before any new committed database row can reference the file. Unsupported directory-sync errors remain limited to the already documented platform codes; all other sync failures prevent metadata commit.

## 6. Scope and acceptance gate

This pass adds no test derivations, assessments, doctor command, HTTP API, React UI, Claude hooks, exports, grading, comparisons, or hosted behavior. Completion requires red/green regression evidence for all five findings, the full v0.1 suite, type checking, diff checking, real/fault probes, privacy scans, and an explicit independent re-review recommendation. Passing this self-review is not approval to begin Task 6.
