# AgentLens Evaluation-Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AgentLens evaluation-ready before T01-A2 by fixing the five evidenced A1 gaps while preserving immutable evidence, capture-policy privacy, bounded reads, and truthful provenance.

**Architecture:** Keep the current provider-adapter → recorder persistence → deterministic derivation → application projection → closed API → React UI flow. Add one explicit normalized allowlist for Codex usage counters, a conservative shell-envelope parser for `test-command/2`, client-derived recorder elapsed timing for existing lifecycle pairs, retry state around the current fail-closed active-snapshot API, and a single bounded auto-fill page for completed trajectories. Existing run databases are interpreted at read time; no historical event is rewritten or appended by a read path.

**Tech Stack:** TypeScript, Node.js 22, pnpm workspaces, Zod 3, better-sqlite3, React, TanStack Query, Vitest, React Testing Library, Playwright, and the existing loopback-only AgentLens server.

**Spec:** `docs/superpowers/specs/2026-09-03-agentlens-evaluation-readiness-design.md`

## Release Boundary

- Start from `main@1aebc25e8122af99d0f8b55b27ae99110d808ab8` after reconfirming `HEAD`, `origin/main`, the remote URL, worktree ownership, and status.
- Use `gpt-5.6-terra` with `xhigh` reasoning for implementation.
- Create an isolated `codex/agentlens-evaluation-readiness` worktree before production edits. Do not implement directly in the current checkout.
- Preserve the current untracked `design-prototypes/` directory. Never edit, format, stage, or copy its generated contents.
- Treat the T01-A1 evidence root as read-only. Never migrate, checkpoint, repair, copy for snapshotting, backfill, assess, or append to it.
- Do not create a T01-A2 worktree, execute an A2 prompt, alter the experiment protocol, or begin the Flight Console visual redesign in this release.
- This planning turn creates documentation only and makes no commit. During a later authorized execution, use the task commits below; do not push, open a pull request, merge, or start A2 without separate authorization.
- Preserve current loopback authentication, path stripping, response bounds, cursor signing, immutable ordering, and active-WAL fail-closed checks.
- Keep observed provider facts, recorder facts, deterministic derivations, Git-recovered evidence, and human judgment distinct.
- Unknown remains unknown. Never turn an absent value into zero, an aggregate shell status into an inner test result, recorder timing into provider timing, or incidental shell evidence into first-class file-read telemetry.
- Each behavior task follows RED → confirm the expected failure → smallest GREEN change → focused regressions → `pnpm typecheck` → scoped diff review → `git diff --check` → commit.
- If a test fails unexpectedly, use `superpowers:systematic-debugging` before changing implementation.
- Before each commit or completion claim, use `superpowers:verification-before-completion` with fresh output.

## File Responsibility Map

### Provider capture and privacy

- `packages/codex/src/normalize.ts` extracts the five approved provider counters into `normalizedPayload.usageCounters`.
- `packages/core/src/redaction.ts` remains the generic secret scrubber; it must not gain a broad exception for properties containing `token`.
- `apps/cli/src/persistEvent.ts` continues to omit normalized content under `metadata-only` and `strict` and persists the already-safe normalized counter names under `standard`.
- `apps/cli/test/privacy.integration.test.ts` and `apps/cli/test/recordRun.integration.test.ts` prove restrictive-capture and on-disk behavior.

### Derivation and contracts

- `packages/derivations/src/shellTokenizer.ts` owns the bounded shell-envelope and top-level `&&` parsing primitives.
- `packages/derivations/src/classifyTestCommand.ts` owns direct, shell-wrapped, and compound command classification.
- `packages/derivations/src/testDerivations.ts` emits `test-command/2` without assigning a compound shell result to an inner test.
- `packages/derivations/src/runSummary.ts` owns v1/v2 compatibility, source-event deduplication, usage aggregation, and precise unavailable reasons.
- `packages/core/src/capabilities.ts` and `packages/codex/src/capabilities.ts` own provider capability facts.
- `packages/api-contract/src/runs.ts` owns the closed run-summary and limitation schemas.
- `packages/application/src/api/projectors.ts` maps derivation states into those schemas without guessing.

### Web presentation and resilience

- `apps/web/src/trajectory/projectTrajectory.ts` derives recorder-observed timing only for already-compatible loaded lifecycle pairs.
- `apps/web/src/trajectory/types.ts` carries the explicit timing discriminant.
- `apps/web/src/trajectory/TrajectoryRow.tsx` labels timing basis and file-read limits truthfully.
- `apps/web/src/run-detail/RunHeader.tsx` presents the five counters and their unavailable reason.
- `apps/web/src/api/client.ts` retains typed retryability from API errors.
- `apps/web/src/run-detail/RunDetailPage.tsx` owns initial and later degraded active-snapshot states.
- `apps/web/src/run-detail/useActiveRunPolling.ts` owns the bounded retry schedule and cancellation.
- `apps/web/src/trajectory/useTrajectoryPages.ts` owns the one-page completed-run auto-fill.
- `apps/web/src/trajectory/TrajectoryToolbar.tsx` shows loaded and total event counts.

---

### Task 1: Preserve only the approved five usage counters in standard capture

**Files:**
- Modify: `packages/codex/src/normalize.ts`
- Modify: `packages/codex/test/normalizeFixtures.test.ts`
- Modify: `packages/codex/test/unknownNativeFields.test.ts`
- Modify: `apps/cli/src/persistEvent.ts` only if the normalized projection needs a narrow type-preserving helper
- Modify: `apps/cli/test/recordRun.integration.test.ts`
- Modify: `apps/cli/test/privacy.integration.test.ts`
- Modify: `packages/core/test/redaction.test.ts`

**Interfaces:**

```ts
export interface CodexUsageCountersV1 {
  readonly input?: number;
  readonly cachedInput?: number;
  readonly output?: number;
  readonly reasoningOutput?: number;
  readonly cacheWriteInput?: number;
}

// Present only on a Codex turn.completed event when at least one value is valid.
normalizedPayload.usageCounters: CodexUsageCountersV1;
```

- [ ] **Step 1: Write adapter RED tests for the exact allowlist**

Add a `turn.completed` fixture containing all five approved keys, missing keys, negative numbers, fractions, `NaN`-equivalent JSON inputs where representable, values above `Number.MAX_SAFE_INTEGER`, numeric `total_tokens`, numeric `access_token`, a string `refresh_token`, and an unknown numeric usage field.

Assert that only nonnegative safe integers from these exact source keys survive in `usageCounters`:

```ts
expect(draft.normalizedPayload).toMatchObject({
  usageCounters: {
    input: 11,
    cachedInput: 3,
    output: 7,
    reasoningOutput: 2,
    cacheWriteInput: 5
  }
});
expect(draft.normalizedPayload).not.toHaveProperty("usageCounters.total");
expect(draft.normalizedPayload).not.toHaveProperty("usageCounters.access");
```

- [ ] **Step 2: Run the adapter test RED**

```bash
pnpm vitest --run packages/codex/test/normalizeFixtures.test.ts packages/codex/test/unknownNativeFields.test.ts
```

Expected: FAIL because normalization currently copies the raw `usage` object rather than emitting the safe five-counter structure.

- [ ] **Step 3: Implement a closed extraction helper**

In `packages/codex/src/normalize.ts`, add a local helper that:

1. accepts only a plain `turn.completed.usage` object;
2. enumerates the five approved source keys explicitly;
3. accepts only `Number.isSafeInteger(value) && value >= 0`;
4. maps to `input`, `cachedInput`, `output`, `reasoningOutput`, and `cacheWriteInput`;
5. omits `usageCounters` when none are valid;
6. leaves the complete provider object attached as `nativePayload` so the existing native redactor remains authoritative.

Do not modify the generic sensitive-key matcher in `packages/core/src/redaction.ts`. The privacy boundary is the normalized allowlist, not an exception that would make arbitrary token-named fields persist.

- [ ] **Step 4: Add persistence RED tests for all three capture policies**

Record the same synthetic provider event under `standard`, `metadata-only`, and `strict`.

For `standard`, inspect the persisted event and assert:

```ts
expect(event.normalizedPayload).toMatchObject({
  usageCounters: {
    input: 11,
    cachedInput: 3,
    output: 7,
    reasoningOutput: 2,
    cacheWriteInput: 5
  }
});
expect(JSON.stringify(event.nativePayload)).not.toContain("UNAPPROVED_SECRET_VALUE");
```

For `metadata-only` and `strict`, byte-scan the database and artifacts for each source counter value encoded with unique sentinel digits and for the unapproved secret sentinel. Assert none are present. Also assert the normalized payload remains omitted according to the existing capture contract.

- [ ] **Step 5: Run persistence RED, then GREEN**

```bash
pnpm vitest --run apps/cli/test/recordRun.integration.test.ts apps/cli/test/privacy.integration.test.ts packages/core/test/redaction.test.ts
```

Expected RED: standard capture lacks the safe counter structure. Expected GREEN after the adapter change: standard preserves only the five mapped integers, while restrictive policies and generic native redaction remain unchanged.

- [ ] **Step 6: Verify and commit Task 1**

```bash
pnpm typecheck
git diff --check
git diff -- packages/codex/src/normalize.ts packages/codex/test/normalizeFixtures.test.ts packages/codex/test/unknownNativeFields.test.ts apps/cli/src/persistEvent.ts apps/cli/test/recordRun.integration.test.ts apps/cli/test/privacy.integration.test.ts packages/core/test/redaction.test.ts
```

Commit only modified Task 1 files:

```bash
git add packages/codex/src/normalize.ts packages/codex/test/normalizeFixtures.test.ts packages/codex/test/unknownNativeFields.test.ts apps/cli/src/persistEvent.ts apps/cli/test/recordRun.integration.test.ts apps/cli/test/privacy.integration.test.ts packages/core/test/redaction.test.ts
git commit -m "feat(codex): preserve safe usage counters"
```

---

### Task 2: Project truthful token-usage availability through the API and UI

**Files:**
- Modify: `packages/core/src/capabilities.ts`
- Modify: `packages/codex/src/capabilities.ts`
- Modify: `packages/derivations/src/types.ts`
- Modify: `packages/derivations/src/runSummary.ts`
- Modify: `packages/derivations/test/runSummary.test.ts`
- Modify: `packages/api-contract/src/runs.ts`
- Modify: `packages/api-contract/test/contracts.test.ts`
- Modify: `packages/application/src/api/projectors.ts`
- Modify: `packages/application/test/apiProjection.test.ts`
- Modify: `packages/application/test/runSummary.test.ts`
- Modify: `apps/server/src/startServer.ts`
- Modify: `apps/web/src/run-detail/RunHeader.tsx`
- Modify: `apps/web/test/runHeader.test.tsx`
- Modify: `apps/web/test-support/fixtureDataRoot.ts`

**Interfaces:**

```ts
export interface AdapterCapabilities {
  readonly sourceTimestamps: boolean;
  readonly fileReads: "native" | "partial" | "unavailable";
  readonly toolOutput: "native" | "partial" | "unavailable";
  readonly toolDurations: "native" | "partial" | "unavailable";
  readonly tokenUsage: "native" | "unavailable";
  readonly interruptionSignal: "native" | "recorder_only" | "partial";
}

export type TokenUsageUnavailableReason =
  | "not_yet_available"
  | "capture_policy"
  | "redacted_by_policy"
  | "not_captured";
```

- [ ] **Step 1: Write derivation RED tests for the availability matrix**

Cover these cases in `packages/derivations/test/runSummary.test.ts`:

- one or several new `usageCounters` payloads sum each field independently;
- a field absent from every event remains `null` rather than zero;
- invalid or overflow values do not contribute;
- an active standard-capture run without a completed usage event is `not_yet_available`;
- `metadata-only` and `strict` are `capture_policy`;
- a historical standard event whose raw `usage` contains legacy redaction markers under approved keys is `redacted_by_policy`;
- a terminal standard run with no provider usage is `not_captured`;
- the provider capability list does not claim Codex token usage is unavailable after the new normalized path exists.

Use unique supporting event IDs and assert canonical chronological summation.

- [ ] **Step 2: Run derivation tests RED**

```bash
pnpm vitest --run packages/derivations/test/runSummary.test.ts packages/application/test/runSummary.test.ts
```

Expected: FAIL because summary extraction currently reads `normalizedPayload.usage` and collapses all absent cases into a generic unavailable state.

- [ ] **Step 3: Implement the discriminated token summary**

Read `normalizedPayload.usageCounters` for new events. Retain a narrowly scoped legacy detector that recognizes redaction-marker values only to choose `redacted_by_policy`; never recover, parse, or expose the hidden value. Sum safe integers by field, preserve `null` for never-emitted fields, and include the IDs of contributing observed `turn.completed` events.

Add `tokenUsage` to every adapter capability literal. Codex is `native`; unknown/fallback providers are `unavailable`. Add `token_usage` to the limitation capability enum and emit it only for non-native providers.

- [ ] **Step 4: Freeze the closed API schema**

Replace the generic projected unavailable reason for `observedTokenUsage` with a token-specific discriminated union that accepts exactly `available` plus the four reasons above. Permit `test-command/1` unchanged here; Task 3 extends that contract separately.

Add contract fixtures for every branch and assert that an unknown reason, an extra counter, a negative counter, or a non-integer counter is rejected.

- [ ] **Step 5: Add UI RED tests and presentation**

In `RunHeader`, render the five counters separately with these labels:

- Input
- Cached input
- Output
- Reasoning output
- Cache-write input

Use `not emitted` for a missing field in an otherwise available summary. Never compute a combined total. Use exact unavailable messages:

- `not_yet_available`: `Waiting for provider usage at turn completion.`
- `capture_policy`: `Usage counters are unavailable under this run's capture policy.`
- `redacted_by_policy`: `Provider usage fields were present but redacted by the capture policy used for this run.`
- `not_captured`: `The provider did not emit usable usage counters.`

Test available, partial-field, legacy A1, restrictive-capture, active, and provider-absent states.

- [ ] **Step 6: Run focused GREEN and compatibility tests**

```bash
pnpm vitest --run packages/derivations/test/runSummary.test.ts packages/api-contract/test/contracts.test.ts packages/application/test/apiProjection.test.ts packages/application/test/runSummary.test.ts apps/web/test/runHeader.test.tsx
pnpm vitest --run apps/server/test/readApi.integration.test.ts apps/cli/test/readCommands.integration.test.ts
```

Expected: all new token states pass and existing run-detail/read contracts remain bounded and path-free.

- [ ] **Step 7: Verify and commit Task 2**

```bash
pnpm typecheck
git diff --check
git diff -- packages/core/src/capabilities.ts packages/codex/src/capabilities.ts packages/derivations/src/types.ts packages/derivations/src/runSummary.ts packages/derivations/test/runSummary.test.ts packages/api-contract/src/runs.ts packages/api-contract/test/contracts.test.ts packages/application/src/api/projectors.ts packages/application/test/apiProjection.test.ts packages/application/test/runSummary.test.ts apps/server/src/startServer.ts apps/web/src/run-detail/RunHeader.tsx apps/web/test/runHeader.test.tsx apps/web/test-support/fixtureDataRoot.ts
```

```bash
git add packages/core/src/capabilities.ts packages/codex/src/capabilities.ts packages/derivations/src/types.ts packages/derivations/src/runSummary.ts packages/derivations/test/runSummary.test.ts packages/api-contract/src/runs.ts packages/api-contract/test/contracts.test.ts packages/application/src/api/projectors.ts packages/application/test/apiProjection.test.ts packages/application/test/runSummary.test.ts apps/server/src/startServer.ts apps/web/src/run-detail/RunHeader.tsx apps/web/test/runHeader.test.tsx apps/web/test-support/fixtureDataRoot.ts
git commit -m "feat(summary): expose truthful token usage"
```

---

### Task 3: Detect shell-wrapped test-bearing commands without inventing outcomes

**Files:**
- Modify: `packages/derivations/src/types.ts`
- Modify: `packages/derivations/src/shellTokenizer.ts`
- Modify: `packages/derivations/src/classifyTestCommand.ts`
- Modify: `packages/derivations/src/testDerivations.ts`
- Modify: `packages/derivations/src/runSummary.ts`
- Modify: `packages/derivations/test/shellTokenizer.test.ts`
- Modify: `packages/derivations/test/classifyTestCommand.test.ts`
- Modify: `packages/derivations/test/testDerivations.test.ts`
- Modify: `packages/derivations/test/runSummary.test.ts`
- Modify: `apps/cli/src/deriveTests.ts`
- Modify: `apps/cli/test/deriveTests.test.ts`
- Modify: `packages/api-contract/src/runs.ts`
- Modify: `packages/api-contract/test/contracts.test.ts`
- Modify: `packages/application/src/api/projectors.ts`
- Modify: `apps/cli/src/format.ts`
- Modify: `apps/cli/test/format.test.ts`
- Modify: `apps/web/src/run-detail/RunHeader.tsx`
- Modify: `apps/web/test/runHeader.test.tsx`

**Interfaces:**

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

- [ ] **Step 1: Freeze the six T01-A1 command shapes as RED fixtures**

Add sanitized fixtures matching the observed envelopes:

```ts
[
  `/bin/zsh -lc "rg pattern && pnpm vitest --run packages/a.test.ts"`,
  `/bin/zsh -lc "pnpm vitest --run packages/a.test.ts && pnpm vitest -t 'content-free diagnostic'"`,
  `/bin/zsh -lc "pnpm vitest -t 'content-free diagnostic' && pnpm typecheck"`,
  `/bin/zsh -lc "pnpm vitest --run a.test.ts && pnpm vitest --run b.test.ts && pnpm typecheck && git diff --check && git status --short"`,
  `/bin/zsh -lc 'pnpm test'`,
  `/bin/zsh -lc "pnpm vitest --run a.test.ts && pnpm vitest --run b.test.ts && pnpm typecheck && git diff --check"`
]
```

Assert all six are test-bearing. Five compound envelopes must have `outcomeAttribution: "unavailable"`. The standalone shell-wrapped `pnpm test` must have `outcomeAttribution: "source_exit"`.

- [ ] **Step 2: Add hostile and false-positive RED cases**

Reject malformed quotes, extra shell positional arguments, `sh -x`, `bash -euc`, `||`, pipes, semicolons, newlines, redirects, backgrounding, parentheses, backticks, `$(...)`, double-quoted parameter expansion, unsupported shells, and nested shell commands.

Keep these unclassified:

```text
rg vitest packages
sed -n '/pnpm test/p' README.md
pnpm typecheck
echo contest
node script-named-vitest.js
```

Add positive direct recognizers for `pnpm vitest`, `pnpm exec vitest`, `npm exec vitest`, and the equivalent Jest forms.

- [ ] **Step 3: Run parser/classifier RED**

```bash
pnpm vitest --run packages/derivations/test/shellTokenizer.test.ts packages/derivations/test/classifyTestCommand.test.ts
```

Expected: FAIL because the current simple tokenizer rejects shell control syntax and `classifyTestCommand` emits only `test-command/1`.

- [ ] **Step 4: Implement the bounded parser**

Keep `tokenizeSimpleCommand` unchanged for direct commands. Add separate helpers that:

1. tokenize the outer command without evaluating it;
2. accept only `sh`, `bash`, `zsh`, or their `/bin/...` paths;
3. accept only `-c`, `-lc`, or `-cl`;
4. require exactly one shell body and no positional tail;
5. scan the body once while tracking single quote, double quote, and backslash state;
6. split only top-level `&&`;
7. reject every unsupported control or expansion construct before classifying segments.

Return a structure that retains all segments and whether the envelope is compound. Do not invoke a shell and do not add a dependency that evaluates shell text.

- [ ] **Step 5: Emit `test-command/2` conservatively**

Use the first recognized test family in left-to-right order. One source command produces at most one classification and one derivation identity.

For direct or single-command shell-wrapped inputs:

```ts
{
  commandShape: "direct" | "shell_wrapped",
  outcomeAttribution: "source_exit"
}
```

For any accepted body containing `&&`:

```ts
{
  commandShape: "compound",
  outcomeAttribution: "unavailable"
}
```

When attribution is unavailable, emit derived status and result `unknown` regardless of the aggregate outer exit code.

- [ ] **Step 6: Prove v1/v2 compatibility and no double counting**

Add summary fixtures with:

- persisted v1 only;
- persisted v2 only;
- v1 and v2 derived evidence for the same source event;
- missing persisted v2 evidence with a classifiable standard-capture source event;
- restrictive-capture commands whose content is unavailable.

Readers must choose the highest supported version per source event, report `test-command/2` when any selected entry is v2, count each source event once, preserve `durability: "incomplete"` for read-time-only v2 results, and append nothing during a read.

Extend the API contract to accept `test-command/1` or `test-command/2` and additive command-shape/outcome-attribution details. Preserve v1 response compatibility for old evidence.

- [ ] **Step 7: Update presentation wording**

Rename the summary label from `Likely tests` to `Test-bearing commands`. For compound entries, show `individual test outcome unavailable`. Keep source command status separately visible; do not imply the inner test passed or failed.

- [ ] **Step 8: Run focused GREEN and CLI derivation regressions**

```bash
pnpm vitest --run packages/derivations/test/shellTokenizer.test.ts packages/derivations/test/classifyTestCommand.test.ts packages/derivations/test/testDerivations.test.ts packages/derivations/test/runSummary.test.ts
pnpm vitest --run apps/cli/test/deriveTests.test.ts apps/cli/test/format.test.ts packages/api-contract/test/contracts.test.ts packages/application/test/apiProjection.test.ts apps/web/test/runHeader.test.tsx
```

Expected: all six A1-shaped fixtures are detected, compound results remain unknown, false positives remain absent, and existing v1 evidence remains readable.

- [ ] **Step 9: Verify and commit Task 3**

```bash
pnpm typecheck
git diff --check
git diff -- packages/derivations packages/api-contract/src/runs.ts packages/api-contract/test/contracts.test.ts packages/application/src/api/projectors.ts apps/cli/src/deriveTests.ts apps/cli/src/format.ts apps/cli/test/deriveTests.test.ts apps/cli/test/format.test.ts apps/web/src/run-detail/RunHeader.tsx apps/web/test/runHeader.test.tsx
```

Commit only Task 3 files:

```bash
git add packages/derivations packages/api-contract/src/runs.ts packages/api-contract/test/contracts.test.ts packages/application/src/api/projectors.ts apps/cli/src/deriveTests.ts apps/cli/src/format.ts apps/cli/test/deriveTests.test.ts apps/cli/test/format.test.ts apps/web/src/run-detail/RunHeader.tsx apps/web/test/runHeader.test.tsx
git commit -m "feat(derivations): detect shell wrapped tests"
```

---

### Task 4: Add recorder-observed elapsed timing and explicit evidence boundaries

**Files:**
- Modify: `apps/web/src/trajectory/types.ts`
- Modify: `apps/web/src/trajectory/projectTrajectory.ts`
- Modify: `apps/web/src/trajectory/TrajectoryRow.tsx`
- Modify: `apps/web/src/run-detail/RunHeader.tsx`
- Modify: `apps/web/test/projectTrajectory.test.ts`
- Modify: `apps/web/test/trajectory.test.tsx`
- Modify: `apps/web/test/runHeader.test.tsx`
- Modify: `apps/web/test/accessibility.test.tsx`

**Interface:**

```ts
export type RecorderTiming =
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

- [ ] **Step 1: Write trajectory projection RED tests**

For a compatible start/terminal lifecycle pair, assert elapsed time is terminal `receivedAt` minus start `receivedAt` and the supporting IDs are ordered start then terminal. Cover zero duration, negative time, invalid timestamps, a missing terminal event, mismatched lifecycle keys/domains/classes, and a pair that becomes complete only after the second page is merged.

No test should expect timing for unrelated singleton events.

- [ ] **Step 2: Run projection RED**

```bash
pnpm vitest --run apps/web/test/projectTrajectory.test.ts
```

Expected: FAIL because layout rows do not carry recorder timing.

- [ ] **Step 3: Implement timing within the existing pairing boundary**

Compute timing only after `compatibleLifecyclePair` has accepted the two loaded events. Parse both `receivedAt` values, subtract, and require a finite nonnegative safe integer millisecond result. Attach unavailable timing when a row has no valid pair; never alter event status, lifecycle grouping, or canonical order.

Do not add a metric event, database column, provider capability claim, or server-side write.

- [ ] **Step 4: Write presentation RED tests**

Assert the paired row contains:

```text
Recorder-observed elapsed · derived from receipt timestamps
```

Assert it does not contain `Provider duration`. Keep the existing provider-time-unavailable text.

In the run evidence boundary, assert these exact facts:

```text
Provider file-read telemetry unavailable. Shell commands may incidentally show possible access; AgentLens does not infer complete reads.
Provider tool duration unavailable. Completed lifecycle pairs show recorder-observed elapsed time when both events are loaded.
```

- [ ] **Step 5: Implement compact evidence-boundary presentation**

Add the copy to the existing run-detail information hierarchy without changing the visual system or rearranging the page. The file-read line is informational only: do not introduce a file-read classifier, count, or inferred provenance.

- [ ] **Step 6: Run focused GREEN and accessibility tests**

```bash
pnpm vitest --run apps/web/test/projectTrajectory.test.ts apps/web/test/trajectory.test.tsx apps/web/test/runHeader.test.tsx apps/web/test/accessibility.test.tsx
```

Expected: timing basis is explicit, file-read limitations are truthful, and accessible names do not collapse recorder and provider evidence.

- [ ] **Step 7: Verify and commit Task 4**

```bash
pnpm typecheck
git diff --check
git diff -- apps/web/src/trajectory/types.ts apps/web/src/trajectory/projectTrajectory.ts apps/web/src/trajectory/TrajectoryRow.tsx apps/web/src/run-detail/RunHeader.tsx apps/web/test/projectTrajectory.test.ts apps/web/test/trajectory.test.tsx apps/web/test/runHeader.test.tsx apps/web/test/accessibility.test.tsx
```

```bash
git add apps/web/src/trajectory/types.ts apps/web/src/trajectory/projectTrajectory.ts apps/web/src/trajectory/TrajectoryRow.tsx apps/web/src/run-detail/RunHeader.tsx apps/web/test/projectTrajectory.test.ts apps/web/test/trajectory.test.tsx apps/web/test/runHeader.test.tsx apps/web/test/accessibility.test.tsx
git commit -m "feat(web): label recorder timing evidence"
```

---

### Task 5: Recover the UI from retryable active-snapshot refusals

**Files:**
- Create: `apps/web/src/api/activeSnapshotRetry.ts`
- Create: `apps/web/test/activeSnapshotRetry.test.ts`
- Modify: `apps/web/src/bootstrap.tsx`
- Modify: `apps/web/src/api/queries.ts`
- Modify: `apps/web/src/trajectory/useTrajectoryPages.ts`
- Modify: `apps/web/src/run-detail/useActiveRunPolling.ts`
- Modify: `apps/web/src/run-detail/RunDetailPage.tsx`
- Modify: `apps/web/src/runs/RunListPage.tsx`
- Modify: `apps/web/test/apiClient.test.ts`
- Modify: `apps/web/test/trajectoryPages.test.tsx`
- Modify: `apps/web/test/activePolling.test.tsx`
- Modify: `apps/web/test/runList.test.tsx`
- Modify: `apps/web/e2e/active-run.spec.ts`
- Modify: `apps/web/e2e/requestLifecycle.ts` if the fixture needs another deterministic response step

**Interfaces:**

```ts
export function isRetryableActiveSnapshotError(error: unknown): boolean;

export function activeSnapshotRetryDelay(attemptIndex: number): number;

export async function retryActiveSnapshotRequest<T>(input: Readonly<{
  request: () => Promise<T>;
  signal: AbortSignal;
  onRetryableFailure?: (error: AgentLensClientError) => void;
}>): Promise<T>;
```

The delay sequence is exactly `250, 500, 1000, 2000, 5000` milliseconds, with every later attempt capped at `5000`.

- [ ] **Step 1: Write pure retry-policy RED tests**

Use fake timers to assert:

- only status `503`, code `active_snapshot_unavailable`, and `retryable: true` retries;
- authentication, validation, not-found, invalid-cursor, response-shape, and other errors reject immediately;
- the first five delays are exact and later delays stay at 5000 ms;
- a successful retry resolves once and leaves no timer;
- abort during a delay rejects with abort semantics and starts no later request;
- at most one attempt for a single request is in flight.

- [ ] **Step 2: Run the retry helper RED**

```bash
pnpm vitest --run apps/web/test/activeSnapshotRetry.test.ts apps/web/test/apiClient.test.ts
```

Expected: FAIL because there is no shared retry predicate or delay schedule and the default query policy rejects every `AgentLensClientError`.

- [ ] **Step 3: Implement the shared retry policy**

Keep `AgentLensClientError` as the source of typed `code`, `status`, and `retryable`. The helper must use the provided `AbortSignal` for both waiting and the actual request. It must not inspect server messages, WAL paths, sidecar identities, or provider payloads.

In the TanStack Query defaults, use the exact predicate and delay function so the run ledger and initial run-detail query recover while mounted. Keep all non-retryable AgentLens errors at zero retries.

- [ ] **Step 4: Add initial-trajectory and navigation RED tests**

In `trajectoryPages.test.tsx`, script:

1. initial `getEvents` rejects twice with retryable active-snapshot errors;
2. the third call returns the initial page;
3. the hook stays in a visible degraded-loading state rather than terminal error;
4. success clears degraded state and commits one page;
5. changing `runId` or unmounting during backoff aborts the old sequence;
6. a non-retryable error reaches terminal error without another call.

Apply the same shared helper to initial, cursor, and around-selection event requests. When later paging fails retryably and events are already loaded, retain those events.

- [ ] **Step 5: Rework active polling around the same predicate**

Replace duplicate retry classification with the shared function. A polling cycle must preserve the most recent successful run and event data when either request receives a retryable refusal. Cancel pending work on terminal run state, navigation, run change, or unmount. Never start a second attempt for the same endpoint while its previous attempt is pending.

Retain the existing one-second live polling cadence after successful cycles; the shorter exponential schedule applies only to retryable snapshot refusals.

- [ ] **Step 6: Render distinct pre-success and post-success degraded states**

Use exact copy:

```text
Waiting for a safe active snapshot · retrying automatically
Last safe snapshot · retrying automatically
```

The first appears when no run/trajectory data has succeeded. The second appears when already-rendered evidence is retained during a later refusal. Non-retryable failures stop retries and keep the existing safe generic error presentation.

- [ ] **Step 7: Run focused GREEN**

```bash
pnpm vitest --run apps/web/test/activeSnapshotRetry.test.ts apps/web/test/apiClient.test.ts apps/web/test/trajectoryPages.test.tsx apps/web/test/activePolling.test.tsx apps/web/test/runList.test.tsx
```

Expected: initial ledger, run, and trajectory reads recover; later errors retain the last safe snapshot; non-retryable errors stop; timers and requests are canceled cleanly.

- [ ] **Step 8: Prove storage and server boundaries did not move**

```bash
pnpm vitest --run packages/storage/test/readOnlyDatabase.test.ts packages/application/test/runQueryService.test.ts packages/application/test/evidenceService.test.ts apps/server/test/readApi.integration.test.ts apps/server/test/evidenceApi.integration.test.ts apps/server/test/security.integration.test.ts
```

Expected: the existing owner, mode, symlink, inode, sidecar-change, read-transaction, response-bound, and path-free tests remain green. No storage source file should be modified by Task 5.

- [ ] **Step 9: Add the browser recovery journey**

In Playwright, return one or more retryable 503 responses before successful ledger/run/event responses. Assert the waiting copy is visible, then disappears after evidence renders. Trigger a later retryable response and assert the current trajectory stays visible beside the last-safe-snapshot copy. Check that the browser response body contains no filesystem path or sidecar identity.

```bash
pnpm playwright test --config apps/web/playwright.config.ts apps/web/e2e/active-run.spec.ts
```

- [ ] **Step 10: Verify and commit Task 5**

```bash
pnpm typecheck
git diff --check
git diff -- apps/web/src/api/activeSnapshotRetry.ts apps/web/src/bootstrap.tsx apps/web/src/api/queries.ts apps/web/src/trajectory/useTrajectoryPages.ts apps/web/src/run-detail/useActiveRunPolling.ts apps/web/src/run-detail/RunDetailPage.tsx apps/web/src/runs/RunListPage.tsx apps/web/test/activeSnapshotRetry.test.ts apps/web/test/apiClient.test.ts apps/web/test/trajectoryPages.test.tsx apps/web/test/activePolling.test.tsx apps/web/test/runList.test.tsx apps/web/e2e/active-run.spec.ts apps/web/e2e/requestLifecycle.ts
```

```bash
git add apps/web/src/api/activeSnapshotRetry.ts apps/web/src/bootstrap.tsx apps/web/src/api/queries.ts apps/web/src/trajectory/useTrajectoryPages.ts apps/web/src/run-detail/useActiveRunPolling.ts apps/web/src/run-detail/RunDetailPage.tsx apps/web/src/runs/RunListPage.tsx apps/web/test/activeSnapshotRetry.test.ts apps/web/test/apiClient.test.ts apps/web/test/trajectoryPages.test.tsx apps/web/test/activePolling.test.tsx apps/web/test/runList.test.tsx apps/web/e2e/active-run.spec.ts apps/web/e2e/requestLifecycle.ts
git commit -m "fix(web): retry safe active snapshots"
```

---

### Task 6: Close the bounded 100/101 completed-run pagination gap

**Files:**
- Modify: `apps/web/src/trajectory/useTrajectoryPages.ts`
- Modify: `apps/web/src/trajectory/TrajectoryToolbar.tsx`
- Modify: `apps/web/src/trajectory/Trajectory.tsx`
- Modify: `apps/web/src/run-detail/RunDetailPage.tsx`
- Modify: `apps/web/test/trajectoryPages.test.tsx`
- Modify: `apps/web/test/trajectory.test.tsx`
- Modify: `apps/web/test/mergePages.test.ts`
- Modify: `apps/web/e2e/trajectory.spec.ts`

**Interface change:**

```ts
export function useTrajectoryPages(
  runId: string,
  selectedEventId: string | null,
  run: Readonly<{ terminal: boolean; totalEventCount: number }> | null
): Readonly<{
  events: readonly TrajectoryEventV1[];
  loadedEventCount: number;
  totalEventCount: number | null;
  isComplete: boolean;
  // existing state, selection, paging, cursor, and live-append fields remain
}>;
```

- [ ] **Step 1: Write exact boundary RED tests**

Build deterministic completed-run pages for:

- 100 total: no automatic cursor request;
- 101 total: load 100, then automatically request the later cursor once and finish at 101;
- 200 total: load 100, then automatically request one page and finish at 200;
- 201 total: load 100 and do not auto-fetch because 101 events remain;
- active 101 total: do not use completed-run auto-fill;
- duplicate or overlapping second page: deduplicate by run ID, event ID, and sequence and refuse to claim completeness unless loaded count equals total;
- second-page failure: retain the first 100, expose a retryable paging error, and keep manual `Load later` available.

The 101 fixture must place `run.reconciled` at sequence 101 and assert it becomes selectable after auto-fill.

- [ ] **Step 2: Run pagination RED**

```bash
pnpm vitest --run apps/web/test/trajectoryPages.test.tsx apps/web/test/mergePages.test.ts apps/web/test/trajectory.test.tsx
```

Expected: FAIL because the hook knows cursors but not completed-run total count and the toolbar reports only a loaded count.

- [ ] **Step 3: Implement one bounded auto-fill request**

After the initial page and run detail are both available:

```ts
const remaining = totalEventCount - loadedEventCount;
const shouldAutoFill =
  terminal &&
  remaining >= 1 &&
  remaining <= pageLimit &&
  laterCursor !== null &&
  !autoFillAttemptedForThisRun;
```

Use the existing cursor request and `mergeTrajectoryPages`. Mark the one-shot attempt per run ID and initial-page identity so React rerenders cannot duplicate it. Reuse Task 5 retry behavior for a retryable active-snapshot refusal, but never fetch a third page automatically.

- [ ] **Step 4: Keep manual paging and selection semantics**

Manual `Load earlier` and `Load later` remain available whenever their cursor exists and no request is pending. Around-event selection resolution, page-anchor preservation, live append, canonical ordering, and duplicate rejection stay unchanged.

`isComplete` is true only when `loadedEventCount === totalEventCount` and the merged page set has no canonical gap. It is false for an inconsistent count even when both cursors are null.

- [ ] **Step 5: Update toolbar count wording**

Pass both values to `TrajectoryToolbar` and render:

```text
100 of 101 immutable events loaded
101 of 101 immutable events loaded
```

When total is temporarily unavailable, retain `N immutable events loaded`. Do not display `complete` unless `isComplete` is true.

- [ ] **Step 6: Run focused GREEN**

```bash
pnpm vitest --run apps/web/test/trajectoryPages.test.tsx apps/web/test/mergePages.test.ts apps/web/test/trajectory.test.tsx
```

Expected: 101 and 200 complete with exactly one extra bounded request, while 201 remains on the first page until the user asks for more.

- [ ] **Step 7: Add the real-browser 101-event proof**

Use a sanitized fixture with exactly 101 immutable events and a terminal `run.reconciled` event. Assert the toolbar moves from `100 of 101` to `101 of 101`, the final event exists, and no `Load later` click is required. Add a 201-event fixture or route stub that proves no second automatic request is sent.

```bash
pnpm playwright test --config apps/web/playwright.config.ts apps/web/e2e/trajectory.spec.ts
```

- [ ] **Step 8: Verify and commit Task 6**

```bash
pnpm typecheck
git diff --check
git diff -- apps/web/src/trajectory/useTrajectoryPages.ts apps/web/src/trajectory/TrajectoryToolbar.tsx apps/web/src/trajectory/Trajectory.tsx apps/web/src/run-detail/RunDetailPage.tsx apps/web/test/trajectoryPages.test.tsx apps/web/test/trajectory.test.tsx apps/web/test/mergePages.test.ts apps/web/e2e/trajectory.spec.ts
```

```bash
git add apps/web/src/trajectory/useTrajectoryPages.ts apps/web/src/trajectory/TrajectoryToolbar.tsx apps/web/src/trajectory/Trajectory.tsx apps/web/src/run-detail/RunDetailPage.tsx apps/web/test/trajectoryPages.test.tsx apps/web/test/trajectory.test.tsx apps/web/test/mergePages.test.ts apps/web/e2e/trajectory.spec.ts
git commit -m "fix(web): fill final bounded event page"
```

---

### Task 7: Run the cross-cutting evaluation-readiness release gates

**Files:**
- No production file is owned by this task.
- Modify a production or test file only by returning the failure to Tasks 1-6 and rerunning that task's focused RED/GREEN cycle.

- [ ] **Step 1: Reconfirm the implementation scope**

```bash
git status --short
git log --oneline --decorate -8
git diff --stat main...HEAD
git diff --name-only main...HEAD
```

Expected: only the files named by Tasks 1-6 plus the approved design/plan documents differ. No `design-prototypes/**` path, experiment prompt, A2 worktree, visual-redesign file, storage implementation, migration, or database artifact is present.

- [ ] **Step 2: Run every focused suite together**

```bash
pnpm vitest --run \
  packages/codex/test/normalizeFixtures.test.ts \
  packages/codex/test/unknownNativeFields.test.ts \
  packages/core/test/redaction.test.ts \
  packages/derivations/test/shellTokenizer.test.ts \
  packages/derivations/test/classifyTestCommand.test.ts \
  packages/derivations/test/testDerivations.test.ts \
  packages/derivations/test/runSummary.test.ts \
  packages/api-contract/test/contracts.test.ts \
  packages/application/test/apiProjection.test.ts \
  packages/application/test/runSummary.test.ts \
  apps/cli/test/deriveTests.test.ts \
  apps/cli/test/recordRun.integration.test.ts \
  apps/cli/test/privacy.integration.test.ts \
  apps/web/test/activeSnapshotRetry.test.ts \
  apps/web/test/apiClient.test.ts \
  apps/web/test/projectTrajectory.test.ts \
  apps/web/test/trajectoryPages.test.tsx \
  apps/web/test/trajectory.test.tsx \
  apps/web/test/activePolling.test.tsx \
  apps/web/test/runHeader.test.tsx \
  apps/web/test/runList.test.tsx \
  apps/web/test/accessibility.test.tsx
```

Expected: all focused tests pass in one process with no order dependency.

- [ ] **Step 3: Repeat the privacy and active-read gates ten times**

```bash
for evaluation_iteration in {1..10}; do
  pnpm vitest --run \
    apps/cli/test/privacy.integration.test.ts \
    packages/storage/test/readOnlyDatabase.test.ts \
    apps/server/test/readApi.integration.test.ts \
    apps/server/test/security.integration.test.ts || exit 1
done
```

Expected: all ten iterations pass. A failure is a release blocker; do not dismiss it as flaky and do not weaken the inode, ownership, byte-snapshot, path-free, or restrictive-capture assertions.

- [ ] **Step 4: Run the full unit/integration, type, and build gates**

```bash
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Expected: every command exits zero. This release cannot repeat A1's “focused tests pass but full suite fails” condition.

- [ ] **Step 5: Run focused browser journeys, then the full browser suite**

```bash
pnpm playwright test --config apps/web/playwright.config.ts \
  apps/web/e2e/active-run.spec.ts \
  apps/web/e2e/trajectory.spec.ts \
  apps/web/e2e/privacy.spec.ts \
  apps/web/e2e/accessibility.spec.ts
pnpm test:e2e
```

Expected: initial and later active-snapshot recovery, exact 101-event auto-fill, 201-event boundedness, no path leakage, restrictive-capture privacy, keyboard behavior, and narrow-width accessibility all pass.

- [ ] **Step 6: Repeat the high-risk browser journeys**

```bash
for evaluation_iteration in {1..10}; do
  pnpm playwright test --config apps/web/playwright.config.ts \
    apps/web/e2e/active-run.spec.ts \
    apps/web/e2e/privacy.spec.ts || exit 1
done
```

Expected: all ten iterations pass without a leaked browser, UI server, or recorder process.

- [ ] **Step 7: Check for worktree-owned lingering processes**

Run a read-only process listing scoped to the implementation worktree path and the AgentLens/Playwright commands launched by the gates. If any owned process remains, stop it through its normal test/server lifecycle and rerun the responsible test. Do not kill unrelated user processes.

- [ ] **Step 8: Review the complete diff against the invariants**

```bash
git diff --check main...HEAD
git diff --stat main...HEAD
git diff main...HEAD -- \
  packages/core \
  packages/codex \
  packages/derivations \
  packages/api-contract \
  packages/application \
  apps/cli \
  apps/server \
  apps/web
```

Confirm manually:

- exactly five normalized counter names exist;
- generic token-key redaction is not weakened;
- metadata-only and strict behavior is unchanged;
- compound test results remain unknown;
- `test-command/1` remains readable and v1/v2 are not double-counted;
- recorder elapsed is labeled derived and never provider-native;
- file reads are not inferred;
- storage fail-closed code is unchanged;
- retries stop for non-retryable errors and abort on navigation;
- completed-run auto-fill issues at most one cursor request;
- no A2 or visual-redesign path was touched.

There is no Task 7 commit. A failed gate returns to the task that owns the behavior; after its focused verification and commit, rerun Task 7 from Step 1.

---

### Task 8: Verify T01-A1 read-only and publish the release evidence

**Files:**
- Modify: `README.md`
- Create: `docs/verification/2026-09-03-agentlens-evaluation-readiness.md`
- Include unchanged: `docs/superpowers/specs/2026-09-03-agentlens-evaluation-readiness-design.md`
- Include unchanged: `docs/superpowers/plans/2026-09-03-agentlens-evaluation-readiness.md`

**Historical evidence target:**

- Run ID: `2049e5b9-c88e-4e95-8e7c-69d879ad6f1a`
- Expected human assessment: verdict `partial`; task completed `yes`
- Evidence root: the operator-resolved T01-A1 `--data-root` outside the repository

- [ ] **Step 1: Snapshot the historical evidence root before any product read**

Use task-specific variables and a disposable directory:

```bash
a1_evidence_root="${AGENTLENS_A1_EVIDENCE_ROOT:?Set the resolved external T01-A1 data root}"
a1_run_id="2049e5b9-c88e-4e95-8e7c-69d879ad6f1a"
a1_verification_temp="$(mktemp -d)"

find "$a1_evidence_root" -mindepth 1 -print0 |
  xargs -0 stat -f '%N|%HT|%Mp%Lp|%u|%g|%z|%m|%i' |
  LC_ALL=C sort > "$a1_verification_temp/before-metadata.txt"
find "$a1_evidence_root" -type f -print0 |
  xargs -0 shasum -a 256 |
  LC_ALL=C sort > "$a1_verification_temp/before-sha256.txt"
```

Confirm the target is the dedicated replay evidence root, not a home directory, repository root, or default AgentLens root. Do not proceed if the exact root is unresolved.

- [ ] **Step 2: Inspect A1 with the new CLI without requesting native payloads**

```bash
pnpm agentlens inspect "$a1_run_id" \
  --data-root "$a1_evidence_root" \
  --json > "$a1_verification_temp/inspect.json"
```

Verify:

- assessment remains `partial` with task completed `yes`;
- six source terminal events are reported as test-bearing;
- compound command outcomes are `unknown` and labeled individually unavailable;
- derivation is `test-command/2` at read time with incomplete durability when v2 events were never persisted;
- legacy standard-capture usage is `redacted_by_policy` rather than zero or provider-unavailable;
- provider file reads and provider tool durations remain unavailable;
- no read appended a derived event or assessment.

- [ ] **Step 3: Inspect A1 in the read-only UI**

Start `agentlens ui --no-open` against the same evidence root and open the returned loopback URL. Confirm:

- the six test-bearing commands are visible without claiming inner pass/fail;
- recorder-observed elapsed appears only on compatible loaded lifecycle pairs;
- the file-read and tool-duration boundary copy is present;
- legacy token usage explains capture-policy redaction;
- the toolbar distinguishes loaded from total events;
- the terminal `run.reconciled` event becomes visible after the one bounded auto-fill request.

The original pre-assessment run had 101 events. The current historical ledger may have an additional immutable assessment event, so the live A1 check is not the exact 101-event regression fixture. The sanitized Playwright fixture from Task 6 is the authoritative exact 100/101 boundary proof.

- [ ] **Step 4: Snapshot the historical evidence root again**

```bash
find "$a1_evidence_root" -mindepth 1 -print0 |
  xargs -0 stat -f '%N|%HT|%Mp%Lp|%u|%g|%z|%m|%i' |
  LC_ALL=C sort > "$a1_verification_temp/after-metadata.txt"
find "$a1_evidence_root" -type f -print0 |
  xargs -0 shasum -a 256 |
  LC_ALL=C sort > "$a1_verification_temp/after-sha256.txt"

diff -u "$a1_verification_temp/before-metadata.txt" "$a1_verification_temp/after-metadata.txt"
diff -u "$a1_verification_temp/before-sha256.txt" "$a1_verification_temp/after-sha256.txt"
```

Expected: both diffs are empty. Any database, WAL, SHM, artifact, directory-entry, ownership, mode, size, mtime, inode, or digest change is a release blocker. Preserve the before/after evidence and return to the owning task; do not normalize or repair the root.

- [ ] **Step 5: Update truthful public documentation**

Update `README.md` to state:

- standard capture preserves only the five approved provider-emitted numeric usage counters;
- metadata-only and strict remain content-omitting;
- test-bearing command detection supports the bounded shell forms and compound outcomes remain unknown;
- elapsed time is recorder-observed and derived, not provider duration;
- file-read telemetry remains unavailable for Codex;
- active snapshots may temporarily fail closed and the UI retries safely;
- completed trajectories may auto-load one final bounded page.

Do not claim A2 results, a redesigned UI, provider-native duration, complete file reads, universal shell support, or historical backfill.

- [ ] **Step 6: Write the verification record**

In `docs/verification/2026-09-03-agentlens-evaluation-readiness.md`, record:

- repository baseline and final commit;
- exact commands and exit codes from Tasks 1-8;
- focused/full test counts and durations;
- all ten-iteration privacy/active-read and browser-repeat outcomes;
- the sanitized 101- and 201-event fixture results;
- A1 before/after metadata and SHA-256 comparison result;
- A1 assessment and six-command summary;
- the legacy token `redacted_by_policy` result;
- any environment limitation without converting it into a pass;
- explicit confirmation that A2 and the visual redesign did not begin.

Do not include absolute user paths, bearer tokens, redaction keys, raw provider payloads, hidden values, or private prompt text.

- [ ] **Step 7: Run final documentation and repository checks**

```bash
rg -n 'A2 completed|visual redesign shipped|provider duration available|complete file reads' README.md docs/verification/2026-09-03-agentlens-evaluation-readiness.md
git diff --check
git status --short
git diff --stat main...HEAD
```

Review every match from `rg`; expected result is no unsupported claim. Confirm `design-prototypes/` remains untracked and unchanged.

- [ ] **Step 8: Commit documentation only after every gate is green**

```bash
git add README.md \
  docs/superpowers/specs/2026-09-03-agentlens-evaluation-readiness-design.md \
  docs/superpowers/plans/2026-09-03-agentlens-evaluation-readiness.md \
  docs/verification/2026-09-03-agentlens-evaluation-readiness.md
git commit -m "docs: record evaluation readiness release"
```

- [ ] **Step 9: Stop at the release boundary**

Report the final commit, verification evidence, unresolved limitations, and unchanged A1 root. Do not create or run A2, begin the visual redesign, push, open a pull request, or merge. Those actions require a separate user decision after reviewing this release.

## Final Acceptance Checklist

- [ ] Standard capture preserves exactly the five approved nonnegative safe-integer counters.
- [ ] Unknown or secret-like native usage fields remain redacted.
- [ ] Metadata-only and strict behavior and byte-scan privacy gates are unchanged.
- [ ] The six sanitized T01-A1 command forms are test-bearing.
- [ ] Compound commands never inherit the outer shell result as an individual test result.
- [ ] v1/v2 evidence is compatible, deduplicated, and read-only.
- [ ] Recorder elapsed timing is derived from receipt timestamps with supporting event IDs.
- [ ] Provider tool duration and file-read telemetry remain explicitly unavailable.
- [ ] Retryable active-snapshot failures recover before and after first success.
- [ ] Non-retryable failures stop, and navigation/unmount cancels pending retry work.
- [ ] The exact 101-event fixture loads its final reconciliation event automatically.
- [ ] A 201-event run does not auto-fetch beyond the initial page.
- [ ] Focused tests, full tests, typecheck, build, focused browser tests, and full browser tests pass.
- [ ] High-risk privacy, storage, server, and browser gates pass ten consecutive iterations.
- [ ] T01-A1 renders the corrected interpretation without any evidence-root mutation.
- [ ] README and verification claims stay within observed evidence.
- [ ] T01-A2 and the visual redesign remain unstarted.
