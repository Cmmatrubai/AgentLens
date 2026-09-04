# AgentLens Evaluation-Readiness Release Design

**Date:** 2026-09-03<br>
**Status:** Approved for implementation planning<br>
**Repository baseline:** `main@1aebc25e8122af99d0f8b55b27ae99110d808ab8`<br>
**Execution model:** `gpt-5.6-terra` with `xhigh` reasoning

## Purpose

The first controlled historical replay, T01-A1, produced useful execution evidence but exposed five product gaps that would distort or slow the remaining replay study:

1. AgentLens reported `Likely tests: none detected` even though six terminal command events visibly contained `pnpm test` or Vitest invocations.
2. Provider tool duration remained unavailable even though AgentLens had recorder receipt timestamps for paired lifecycle events.
3. Codex emitted five numeric usage counters, but standard capture redacted them because their property names contained `token`.
4. Codex did not provide first-class file-read telemetry, while read-like shell commands were visible only incidentally.
5. Safe active-WAL reads could fail closed before the UI's polling state existed, and a 101-event completed run initially displayed only the first 100 events.

This release makes AgentLens evaluation-ready before T01-A2. It improves derivation correctness, preserves approved numeric usage metadata, exposes recorder-based elapsed timing without calling it provider timing, makes evidence limits explicit, survives retryable active snapshot refusals, and removes the two-page cliff for runs that fit within one additional bounded page.

## Scope

### Goals

- Detect the six T01-A1 test-bearing terminal commands without claiming unsupported individual test results.
- Preserve exactly five allowlisted, provider-emitted, nonnegative safe-integer usage counters in `standard` capture.
- Leave `metadata-only` and `strict` capture semantics unchanged.
- Display deterministic elapsed time for loaded, compatible lifecycle pairs as a derivation from recorder receipt timestamps.
- Keep provider tool-duration and file-read capability declarations truthful.
- Retry `active_snapshot_unavailable` before and after the initial UI read succeeds.
- Preserve fail-closed storage behavior and unchanged-file guarantees.
- Automatically load one final contiguous page when a completed run has no more than 100 events beyond its initial page.
- Display loaded event count separately from total event count.
- Make the already-recorded T01-A1 run more truthful when viewed with the new build without modifying its database or observed events.

### Non-goals

- Do not begin T01-A2 or any other replay attempt.
- Do not implement or begin the visual redesign.
- Do not begin multi-provider work or the Insight Layer.
- Do not reconstruct private reasoning.
- Do not infer complete file-read telemetry from shell commands.
- Do not relabel recorder-derived elapsed time as provider duration.
- Do not add a general-purpose shell parser.
- Do not rewrite, delete, or backfill observed events in existing run databases.
- Do not open the evidence database in writable mode, copy it to obtain a snapshot, checkpoint its WAL, or weaken sidecar identity checks.
- Do not automatically fetch an unbounded trajectory.

## Global invariants

1. Observed provider facts, recorder facts, deterministic derivations, Git-recovered evidence, and human judgments remain distinct.
2. `runs`, `inspect`, and UI reads remain non-mutating.
3. Every numeric metric states its basis and exposes supporting event IDs when applicable.
4. Unknown is never converted to zero, passed, failed, absent, or complete.
5. Existing `test-command/1` evidence remains readable.
6. New test-command evidence uses `test-command/2`; readers prefer the highest supported version per source event and never double-count v1 plus v2.
7. Standard capture persists only the approved usage-counter allowlist. Arbitrary numeric properties whose names resemble secrets remain redacted.
8. Browser/API responses remain bounded, loopback-only, authenticated, path-free, and free of raw source identifiers.
9. A retryable read refusal is a visible degraded state, not a reason to bypass storage safety.
10. The release is complete only after focused, full-suite, typecheck, build, browser, privacy, and unchanged-storage gates pass.

## Design 1: Test-bearing command derivation v2

### Classification unit

One terminal observed provider command is one classification unit. A command containing several shell segments still contributes at most one test-bearing-command entry. This keeps derivation identity tied to the immutable source event and avoids inventing multiple executions from one aggregate provider result.

`TestCommandClassification` gains these fields:

```ts
export type TestCommandShape = "direct" | "shell_wrapped" | "compound";
export type TestOutcomeAttribution = "source_exit" | "unavailable";

export interface TestCommandClassification {
  readonly family: TestFamily;
  readonly confidence: "high" | "medium";
  readonly commandShape: TestCommandShape;
  readonly outcomeAttribution: TestOutcomeAttribution;
  readonly derivationVersion: "test-command/2";
}
```

The `family` is the first recognized test family in left-to-right shell order. This release does not add multi-family aggregation because the evaluation question is whether a provider command is test-bearing, not how many inner programs it contains.

### Supported command envelopes

The v2 parser recognizes:

- an existing direct simple command;
- a single shell body invoked through `sh`, `bash`, or `zsh`, including `/bin/sh`, `/bin/bash`, and `/bin/zsh`;
- shell option tokens `-c`, `-lc`, and `-cl` only;
- zero additional shell positional arguments after the body;
- top-level `&&` segmentation while respecting single quotes, double quotes, and backslash escaping.

It rejects command substitution, parameter expansion inside double quotes, pipelines, `||`, semicolons, newlines, redirects, backgrounding, parentheses, malformed quoting, unsupported shell flags, and extra positional parameters. Rejection returns no classification rather than a guess.

For a shell body containing one recognized simple command, `commandShape` is `shell_wrapped` and `outcomeAttribution` is `source_exit`. For a body containing `&&`, `commandShape` is `compound` and `outcomeAttribution` is `unavailable` even when the outer shell exits zero. The aggregate shell result is never assigned to an inner test.

### Recognized test forms

Existing direct recognizers remain. The frozen additions are:

- `pnpm vitest ...`
- `pnpm exec vitest ...`
- `npm exec vitest ...`
- their Jest equivalents

The release intentionally does not classify `typecheck`, `lint`, `build`, `git diff --check`, file names containing test-runner words, or arbitrary package scripts whose names do not equal `test` or start with `test:`.

### Derived event semantics

`test-command/2` produces the existing `test.command` and `test.result` event kinds with additive normalized fields:

```ts
{
  family: TestFamily;
  confidence: "high" | "medium";
  commandShape: "direct" | "shell_wrapped" | "compound";
  outcomeAttribution: "source_exit" | "unavailable";
  derivationId: "test-command/2";
}
```

For direct and single-command shell envelopes, result mapping remains conservative: exit zero is passed, a known nonzero exit is failed, and a completed event without an exit code is unknown. For compound commands, both the derived event status and test outcome are `unknown`; the source event retains its observed aggregate status separately.

The UI copy changes from an unconditional `Likely tests` result to `Test-bearing commands`. Compound entries explicitly say `individual test outcome unavailable`.

### Compatibility

- The API accepts `test-command/1` and `test-command/2` derivation identifiers.
- A summary groups derived evidence by source event and selects v2 over v1 when both exist.
- Existing closed runs are reclassified in memory during reads when standard command evidence is present.
- Read paths never append missing v2 events. A1 can therefore show six detected test-bearing commands with incomplete durability while its persisted event history remains unchanged.

## Design 2: Standard-capture usage counters

### Approved allowlist

Only these fields are eligible, and only when directly emitted under a Codex `turn.completed.usage` object as nonnegative safe integers:

- `input_tokens`
- `cached_input_tokens`
- `output_tokens`
- `reasoning_output_tokens`
- `cache_write_input_tokens`

The Codex adapter copies eligible values to an explicit normalized structure whose persisted property names do not collide with generic secret-name redaction:

```ts
interface CodexUsageCountersV1 {
  readonly input?: number;
  readonly cachedInput?: number;
  readonly output?: number;
  readonly reasoningOutput?: number;
  readonly cacheWriteInput?: number;
}
```

The normalized payload key is `usageCounters`. Unknown usage fields are not copied into this structure. The native provider payload continues through the existing JSON redactor, so fields named `access_token`, `refresh_token`, or any unapproved token-like key remain redacted even when numeric.

### Capture-policy behavior

| Capture policy | Normalized five-counter structure | Native usage object |
|---|---|---|
| `standard` | Preserve valid allowlisted numbers | Preserve only after existing generic redaction |
| `metadata-only` | Omit | Omit |
| `strict` | Omit | Omit |

There is no database migration. Usage counters live in the existing normalized event payload.

### Summary availability

Token usage becomes a dedicated discriminated summary so unavailable reasons are not guessed by the API projector:

- `available`: at least one approved numeric counter was observed; missing individual fields remain `null`.
- `not_yet_available`: the run is active and no terminal usage event has arrived.
- `capture_policy`: the run used `metadata-only` or `strict`.
- `redacted_by_policy`: a standard-capture usage object exists, but its approved fields contain legacy redaction markers, as in T01-A1.
- `not_captured`: the provider emitted no usable approved fields.

Multiple `turn.completed` events are summed per field in canonical chronology. A field absent from every event remains `null`; it is never reported as zero.

The Codex capability contract gains `tokenUsage: "native"`. Unknown providers use `tokenUsage: "unavailable"`. Provider capability limitations include `token_usage` only when it is not native.

### UI presentation

Run detail shows all five counters separately. It does not compute a misleading grand total because cached input may overlap input accounting. Missing counters display `not emitted`. Legacy A1 displays `Provider usage fields were present but redacted by the capture policy used for this run`.

## Design 3: Recorder-observed elapsed timing

Provider capability `toolDurations` remains `unavailable` for Codex. AgentLens instead derives elapsed time only when two loaded events form an existing compatible lifecycle pair and both have valid recorder `receivedAt` timestamps.

The browser projection produces:

```ts
type RecorderTiming =
  | Readonly<{
      state: "available";
      elapsedMs: number;
      basis: "recorder_received_at";
      provenance: "derived";
      supportingEventIds: readonly [string, string];
    }>
  | Readonly<{
      state: "unavailable";
      reason: "missing_pair" | "invalid_recorder_time";
    }>;
```

Elapsed time is the terminal receipt timestamp minus the start receipt timestamp. Negative, non-finite, or unsafe values are unavailable. The UI label is `Recorder-observed elapsed · derived from receipt timestamps`, never `Provider duration`.

This is computed from loaded immutable events and does not append metric events or mutate historical runs. When a lifecycle pair spans two pages, the timing becomes available after both events are loaded and merged.

## Design 4: Evidence-boundary presentation

Run detail gains a compact evidence-boundary section using the existing visual system. It is not a redesign.

- File reads: `Provider file-read telemetry unavailable. Shell commands may incidentally show possible access; AgentLens does not infer complete reads.`
- Tool timing: `Provider tool duration unavailable. Completed lifecycle pairs show recorder-observed elapsed time when both events are loaded.`
- Token usage: the five values or the precise unavailable reason described above.

No file-access classifier is added in this release. Read-like commands remain ordinary observed command evidence.

## Design 5: Retryable active snapshot state

The storage contract remains unchanged:

- no WAL means immutable read-only open;
- a WAL triggers the guarded owner-only sidecar path;
- missing, invalid, changed, or unavailable sidecars fail closed;
- reads pin a transaction snapshot and roll it back;
- no read path migrates, checkpoints, writes, or repairs storage.

The UI treats API error `active_snapshot_unavailable` with `retryable: true` as a degraded live state at every read phase, including the initial ledger, run, and trajectory requests.

- Retry one request at a time.
- Use exponential delays of 250 ms, 500 ms, 1 s, 2 s, then a 5 s cap.
- Continue while the view is mounted and the error remains retryable.
- Cancel timers and requests on navigation, run change, unmount, or success.
- Stop automatically on authentication, validation, not-found, cursor, response-shape, or other non-retryable failures.
- Show `Waiting for a safe active snapshot · retrying automatically` before first success.
- Preserve already loaded data during later retryable failures and label it `Last safe snapshot · retrying automatically`.

The browser receives only the existing safe error code and message. Internal sidecar paths and identity details remain server-side.

## Design 6: Completed-run pagination

The event page limit remains 100 in the web client and at most 250 in the API.

The toolbar receives both `loadedEventCount` and `totalEventCount` and renders, for example, `100 of 101 immutable events loaded`.

After the initial head page for a completed run:

1. calculate `remaining = totalEventCount - loadedEventCount`;
2. if `1 <= remaining <= 100` and a later cursor exists, request that cursor once;
3. merge and deduplicate by run, event ID, and sequence using the existing page merger;
4. require the resulting loaded count to equal the total before describing the trajectory as complete;
5. otherwise leave manual paging enabled and keep the loaded/total distinction visible.

This makes a 101-event run complete with one extra bounded request. It does not fetch every page of a large run. Selection and jump resolution retain their existing around-event behavior.

## Error handling

- Unsupported shell syntax returns no classification, not an exception or partial parse.
- Invalid usage values are ignored; other token-like native fields stay redacted.
- Legacy redacted usage is `redacted_by_policy`, not `provider_capability` or zero.
- Invalid recorder timing is unavailable and does not alter lifecycle grouping.
- A retryable active snapshot refusal stays visible and retrying; a non-retryable error stops.
- Pagination auto-fill failure preserves the first page, shows a retryable page error, and leaves the manual `Load later` action available.

## Validation strategy

### Unit and contract tests

- Exact T01-A1 shell forms: six test-bearing commands detected.
- Compound test outcomes: unknown regardless of aggregate exit code.
- False positives: file reads mentioning Vitest, `typecheck`, `contest`, command substitutions, pipes, and unsupported shells remain unclassified.
- Usage allowlist: five valid numeric fields survive standard capture; missing fields remain null.
- Numeric and string secrets outside the allowlist remain redacted.
- Metadata-only and strict byte scans remain unchanged and contain no source usage values.
- v1 and v2 derivations coexist without double counting.
- Recorder timing handles valid, zero, negative, invalid, and cross-page pairing.
- API schemas accept the new token unavailability reason and both derivation versions.

### Storage and server tests

- Read-only active-WAL tests retain owner, symlink, inode, mode, and sidecar-change defenses.
- Database, WAL, SHM, artifact bytes, and material metadata remain unchanged except already-allowed SHM coordination metadata.
- Retryable 503 responses remain bounded and path-free.

### Browser tests

- Initial active-snapshot refusal recovers without navigation.
- A later retryable refusal preserves the last safe snapshot.
- Non-retryable errors stop retrying.
- A 101-event completed run automatically becomes `101 of 101` and exposes `run.reconciled`.
- A run larger than 200 events does not auto-fetch the entire trajectory.
- Token, timing, and evidence-boundary copy is accessible at desktop and narrow widths.

### Release gates

- Focused Vitest suites pass.
- Full `pnpm test` passes.
- `pnpm typecheck` passes.
- `pnpm build` passes.
- Focused Playwright journeys pass, followed by full `pnpm test:e2e` when the environment supports it.
- `git diff --check` passes.
- A read-only inspection of T01-A1 changes no evidence-root bytes or material metadata.
- T01-A1 reports six test-bearing commands, legacy token usage as redacted by policy, recorder-observed timing on compatible pairs, truthful file-read limits, and a fully loaded terminal reconciliation event.

## Release boundary

Passing these gates authorizes a decision about T01-A2. It does not itself authorize creating the A2 worktree, invoking Codex for A2, editing the experiment prompt, or beginning the visual redesign.
