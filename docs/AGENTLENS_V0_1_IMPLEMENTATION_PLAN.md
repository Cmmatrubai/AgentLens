# AgentLens v0.1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the local `codex exec --json` vertical slice through durable redacted storage, final Git evidence, `runs`, and `inspect`.

**Architecture:** A Node/TypeScript workspace separates immutable canonical contracts, before-persistence redaction/artifacts, append-only SQLite storage, Codex normalization, and the CLI process/Git recorder. Provider, process, recorder, Git, derived, and human facts keep distinct provenance and explicit relationships.

**Tech Stack:** Node.js 22+, TypeScript, pnpm workspaces, Zod, better-sqlite3, Vitest, tsx.

**Spec:** `docs/AGENTLENS_V0_1_FROZEN_SPEC.md`

## Global Constraints

- Tasks 1–5 stop at `record -> SQLite/artifacts/Git evidence -> runs -> inspect`; no UI/API, Claude hooks, grading, comparisons, exports, or hosted features.
- Observed events are insert-only. Recovery appends a correlated recorder event and never mutates the observed start.
- Redaction happens in memory before any source content reaches durable storage.
- Capture policy covers summaries, labels, prompts, messages, command strings/output, tools/MCP, Git status/diff, native payloads, stderr, and diagnostics.
- `metadata-only` persists no prompt/message/command/output/diff/native/raw-content bytes.
- Redaction markers use HMAC-SHA-256 with a 32-byte machine-local key and 32 lowercase hex characters.
- Raw real probes remain ignored; only sanitized fixtures plus their manifest are committed.
- Unknown/malformed Codex input never crashes recording or destroys the run.
- Git commands are read-only; dirty repositories refuse before child spawn.
- Child argv, stdin bytes, model, sandbox, permissions, approval configuration, and working directory are never silently changed.
- Final Git evidence means tracked final diff relative to initial HEAD plus untracked-file metadata, not forensic attribution or untracked contents.
- Each task follows strict red-green-refactor, fresh task tests/typecheck/diff review, independent review, then commit.

## Project structure

```text
apps/cli/                    CLI parser, process recorder, Git evidence, terminal readers
packages/core/               event/run contracts, capabilities, capture policy, redaction, artifacts
packages/storage/            SQLite migration and append-only repository
packages/codex/              JSONL decoder and Codex adapter
tests/fixtures/codex/        sanitized behavior-preserving fixtures and manifest
research/.../*.log           ignored raw local probes
```

---

### Task 1: Workspace, frozen contracts, and sanitized fixtures

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `tsconfig.json`
- Create: `vitest.workspace.ts`
- Create: `packages/core/package.json`
- Create: `packages/core/tsconfig.json`
- Create: `packages/core/src/events.ts`
- Create: `packages/core/src/capabilities.ts`
- Create: `packages/core/src/fixtureManifest.ts`
- Create: `packages/core/src/index.ts`
- Create: `packages/core/test/events.test.ts`
- Create: `packages/core/test/fixtureContract.test.ts`
- Create: `tests/fixtures/codex/manifest.json`
- Create: `tests/fixtures/codex/read-success.jsonl`
- Create: `tests/fixtures/codex/edit-success.jsonl`
- Create: `tests/fixtures/codex/failure-recovery.jsonl`
- Create: `tests/fixtures/codex/interrupted.jsonl`

**Interfaces:**
- Produces: `TraceEventV1`, `EventDraftV1`, `RunStatus`, `EventStatus`, `Provenance`, `NativeSourceV1`, `EventRelationshipV1`, `NativePayloadRefV1`.
- Produces: `traceEventV1Schema`, `eventDraftV1Schema`, `fixtureManifestSchema`.
- Produces: `AdapterCapabilities` and frozen `codexExecCapabilities` shape.

- [ ] **Step 1: Add only the workspace/test configuration**

Root `package.json` must contain:

```json
{
  "name": "agentlens",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "agentlens": "tsx apps/cli/src/main.ts",
    "test": "vitest --run",
    "typecheck": "tsc -b --pretty false"
  }
}
```

Add Zod, TypeScript, Vitest, tsx, and Node types. Configure strict TypeScript with `noUncheckedIndexedAccess` and `exactOptionalPropertyTypes`. Create a root composite `tsconfig.json` that references each workspace package as it is added; every package owns a composite `tsconfig.json` extending `tsconfig.base.json`. Add `.codebase-memory/` to `.gitignore`; the generated graph artifact is local tooling state, not product source.

- [ ] **Step 2: Write failing canonical-contract tests**

Name the break: mutating/ambiguous evidence would become possible if source relationships, separate run status, or native payload representation disappeared.

```ts
it("keeps run and event lifecycle types separate", () => {
  expect(runStatusSchema.parse("recorder_error")).toBe("recorder_error");
  expect(() => eventStatusSchema.parse("recorder_error")).toThrow();
});

it("requires derived events to name their source AgentLens events", () => {
  expect(() => traceEventV1Schema.parse({
    ...validEvent,
    provenance: "derived",
    relationships: [],
    derivation: { name: "test-command", version: "1", sourceEventIds: [] }
  })).toThrow();
});

it("supports redacted inline, artifact, and omitted native payloads", () => {
  for (const nativePayload of [
    { storage: "inline", redacted: { future_field: 7 } },
    { storage: "artifact", artifactId: "01JARTIFACT00000000000000" },
    { storage: "omitted", reason: "metadata-only" }
  ]) expect(traceEventV1Schema.parse({ ...validEvent, nativePayload })).toBeTruthy();
});
```

- [ ] **Step 3: Write the failing fixture-contract test**

Name the break: a real path, username, raw prompt, or missing sanitization manifest could be committed as a compatibility fixture.

```ts
it("ships only sanitized, declared Codex fixtures", async () => {
  const manifest = fixtureManifestSchema.parse(JSON.parse(await readFile(manifestPath, "utf8")));
  expect(manifest.observedCodexVersion).toBe("0.149.0-alpha.4");
  expect(manifest.fixtures.map(f => f.behavior)).toEqual([
    "read-success", "edit-success", "failure-recovery", "interrupted"
  ]);
  for (const fixture of manifest.fixtures) {
    const body = await readFile(resolve(fixturesDir, fixture.file), "utf8");
    expect(body).not.toMatch(/chaitanyamatrubai|\/Users\/|\/private\/tmp\//);
    expect(fixture.sanitizedClasses).toEqual(expect.arrayContaining([
      "machine-paths", "identifiers", "prompts-messages", "repository-content"
    ]));
  }
});
```

- [ ] **Step 4: Run RED**

Run: `pnpm install && pnpm vitest packages/core/test/events.test.ts packages/core/test/fixtureContract.test.ts --run`  
Expected: FAIL because schemas and sanitized fixtures do not exist.

- [ ] **Step 5: Implement the minimal schemas and sanitized fixtures**

Implement exact types from the frozen spec. Sanitize the local probes from the canonical checkout's ignored `research/agentlens-v0-codex-probes/*.log` files by replacing all machine paths, user identifiers, prompts/messages, repository content, native identifiers, and tool payload content with deterministic fake values while keeping ordering, event/item types, statuses, exit codes, and usage shape. Do not copy the raw logs unchanged.

- [ ] **Step 6: Verify GREEN, typecheck, and diff scope**

Run: `pnpm vitest packages/core/test/events.test.ts packages/core/test/fixtureContract.test.ts --run && pnpm typecheck`  
Expected: PASS. Then run `git diff --check && git status --short` and confirm no ignored raw `.log` is staged.

- [ ] **Step 7: Commit**

```bash
git add .gitignore package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json tsconfig.json vitest.workspace.ts packages/core tests/fixtures/codex
git commit -m "feat: freeze AgentLens evidence contracts"
```

### Task 2: HMAC redaction, capture policies, and durable artifacts

**Files:**
- Create: `packages/core/src/capturePolicy.ts`
- Create: `packages/core/src/redactionKey.ts`
- Create: `packages/core/src/redaction.ts`
- Create: `packages/core/src/gitDiffRedaction.ts`
- Create: `packages/core/src/artifactStore.ts`
- Create: `packages/core/test/redaction.test.ts`
- Create: `packages/core/test/gitDiffRedaction.test.ts`
- Create: `packages/core/test/artifactStore.test.ts`

**Interfaces:**
- Produces: `loadOrCreateRedactionKey(dataRoot): Promise<Buffer>`.
- Produces: `redactText(input, { policy, key, contentClass }): RedactionResult`.
- Produces: `redactJson(input, context): RedactedJsonResult`.
- Produces: `redactGitDiff(input, context): RedactionResult`.
- Produces: `shouldExcludePath(path, policy): ExclusionDecision`.
- Produces: `ArtifactStore.writeRedacted({ runId, kind, redactedBytes, mediaType }): Promise<CompletedArtifact>`.
- Produces: `prepareNativePayload(redactedJson, artifactStore): Promise<NativePayloadRefV1>`.

- [ ] **Step 1: Write failing policy/HMAC tests**

Name the breaks: an unkeyed marker permits dictionary attacks; metadata-only leaks source strings through summaries or payload classes.

```ts
it("uses a stable keyed HMAC marker without exposing an ordinary digest", () => {
  const first = redactText("Bearer SENTINEL_TOKEN_91", standardContext);
  const second = redactText("Bearer SENTINEL_TOKEN_91", standardContext);
  expect(first.text).toBe(second.text);
  expect(first.text).toMatch(/\[\[REDACTED:auth-bearer:hmac-sha256:[0-9a-f]{32}\]\]/);
  expect(first.text).not.toContain(createHash("sha256").update("SENTINEL_TOKEN_91").digest("hex").slice(0, 32));
});

it.each(["summary", "prompt", "message", "command", "output", "tool", "git-diff", "native", "stderr"])(
  "metadata-only omits %s content",
  contentClass => expect(redactText("UNIQUE_METADATA_SENTINEL", metadataContext(contentClass)).text)
    .not.toContain("UNIQUE_METADATA_SENTINEL")
);
```

- [ ] **Step 2: Write the failing sensitive-diff test**

```ts
it("removes an entire sensitive-path diff block", () => {
  const result = redactGitDiff(diffWithEnvAndSafeFile, standardContext);
  expect(result.text).not.toContain("DATABASE_PASSWORD");
  expect(result.text).not.toContain("diff --git a/.env.production");
  expect(result.text).toContain("diff --git a/src/safe.ts b/src/safe.ts");
  expect(result.text).toContain("[[EXCLUDED:sensitive-path.env]]");
});
```

- [ ] **Step 3: Write failing artifact-ordering tests**

Name the breaks: content could reach disk before redaction, a row could reference an incomplete file, or a rename/fsync failure could be reported as completed.

Use a temporary real filesystem. Assert the original sentinel never appears in any file, final mode is owner-only, final path exists before `CompletedArtifact` returns, large native payload externalizes, small native payload stays inline, and injected rename failure returns no completed artifact.

- [ ] **Step 4: Run RED**

Run: `pnpm vitest packages/core/test/redaction.test.ts packages/core/test/gitDiffRedaction.test.ts packages/core/test/artifactStore.test.ts --run`  
Expected: FAIL because redaction/artifact modules do not exist.

- [ ] **Step 5: Implement minimal in-memory redaction and filesystem ordering**

Use `createHmac("sha256", key)`, 32 random key bytes, owner-only key storage, fixed content-free metadata summaries, sensitive block parsing for old/new/rename/copy paths, and the six-step artifact ordering in the spec. Artifact store does no SQLite work. Directory `fsync` is best effort only for platform errors documented as unsupported; other failures propagate.

- [ ] **Step 6: Verify GREEN, typecheck, and diff scope**

Run: `pnpm vitest packages/core/test --run && pnpm typecheck && git diff --check`  
Expected: PASS, including a whole-temp-root byte scan that finds no unredacted sentinel.

- [ ] **Step 7: Commit**

```bash
git add packages/core
git commit -m "feat: redact content before durable storage"
```

### Task 3: Append-only SQLite storage and recovery relationships

**Files:**
- Create: `packages/storage/package.json`
- Create: `packages/storage/tsconfig.json`
- Create: `packages/storage/migrations/001_initial.sql`
- Create: `packages/storage/src/database.ts`
- Create: `packages/storage/src/runRepository.ts`
- Create: `packages/storage/src/index.ts`
- Create: `packages/storage/test/migrations.test.ts`
- Create: `packages/storage/test/runRepository.test.ts`
- Create: `packages/storage/test/artifactMetadata.test.ts`

**Interfaces:**
- Produces: `openDatabase(path): AgentLensDatabase`.
- Produces: `RunRepository.createRun`, `markRunning`, `appendEvent`, `commitArtifactMetadata`, `saveGitEvidence`, `recordProcessFact`, `reconcileRun`, `appendRecoveryForOpenEvents`, `listRuns`, and `getRunDetail`.
- `appendEvent` is the only event-write API. No event-update/delete method exists.

- [ ] **Step 1: Write the failing migration test**

Assert v1 creates `runs`, `events`, `event_sources`, `event_relationships`, `artifacts`, `git_evidence`, `redaction_audits`, and required indexes; foreign keys are enabled; migrations rerun safely.

- [ ] **Step 2: Write failing append-only recovery tests**

```ts
it("appends recorder recovery without mutating the observed start", () => {
  const started = repository.appendEvent(observedCommandStart);
  repository.appendRecoveryForOpenEvents(runId, interruptedContext);
  const events = repository.getRunDetail(runId).events;
  expect(events[0]).toEqual(started);
  expect(events[0].status).toBe("in_progress");
  expect(events[1]).toMatchObject({ kind: "recorder.recovery", provenance: "recorder", status: "interrupted" });
  expect(events[1].relationships).toContainEqual({ type: "recovers", eventId: started.id });
});

it("requires a derived_from relationship for derived events", () => {
  expect(() => repository.appendEvent(derivedWithoutSource)).toThrow(/derived_from/);
});
```

Also assert a second recovery call is idempotent by relationship and does not append a duplicate.

- [ ] **Step 3: Write failing reconciliation-table tests**

Table-drive provider completed/failed/absent against exit `0`/nonzero/signal and recorder failure. Assert the precedence in spec section 5 and that contradiction codes retain both facts.

- [ ] **Step 4: Write the failing artifact metadata test**

Create one completed artifact and one missing path. Assert metadata for the completed file commits; missing-path metadata fails and leaves no row. Create an orphan file without metadata and prove database open/recovery tolerates it.

- [ ] **Step 5: Run RED**

Run: `pnpm vitest packages/storage/test --run`  
Expected: FAIL because SQLite storage is absent.

- [ ] **Step 6: Implement the migration and minimal repository**

Use WAL, foreign keys, synchronous `NORMAL`, 5-second busy timeout, epoch milliseconds, insert-only event statements, explicit source/relationship rows, and transactional event+relationship insertion. `commitArtifactMetadata` must `stat` and verify the completed artifact before its transaction.

- [ ] **Step 7: Verify GREEN, typecheck, and diff scope**

Run: `pnpm vitest packages/storage/test --run && pnpm typecheck && git diff --check`  
Expected: PASS with the first observed row byte-for-byte unchanged after recovery.

- [ ] **Step 8: Commit**

```bash
git add packages/storage
git commit -m "feat: persist append-only AgentLens runs"
```

### Task 4: Codex JSONL decoder and evidence-preserving adapter

**Files:**
- Create: `packages/codex/package.json`
- Create: `packages/codex/tsconfig.json`
- Create: `packages/codex/src/lineDecoder.ts`
- Create: `packages/codex/src/normalize.ts`
- Create: `packages/codex/src/capabilities.ts`
- Create: `packages/codex/src/index.ts`
- Create: `packages/codex/test/lineDecoder.test.ts`
- Create: `packages/codex/test/normalizeFixtures.test.ts`
- Create: `packages/codex/test/unknownNativeFields.test.ts`

**Interfaces:**
- Produces: `decodeCodexLine(line, stream): CodexDecodedLine`.
- Produces: `normalizeCodexRecord(record): EventDraftV1[]`.
- Produces: `codexExecCapabilities` exactly matching frozen spec section 11.
- Normalized drafts carry full native objects only in memory; Task 5 applies redaction and persistence.

- [ ] **Step 1: Write failing decoder tests**

Name the break: malformed/future input could terminate the recorder.

Assert valid object JSON returns `provider_record`; malformed JSON, primitives, arrays, and unexpected stdout return diagnostic drafts; stderr is always a recorder diagnostic and never parsed as provider JSON.

- [ ] **Step 2: Write failing sanitized-fixture lifecycle tests**

```ts
it("preserves failed command then later recovery activity as separate events", async () => {
  const drafts = await normalizeFixture("failure-recovery.jsonl");
  expect(drafts.filter(e => e.kind === "command").map(e => e.status)).toEqual([
    "in_progress", "failed",
    "in_progress", "completed",
    "in_progress", "completed",
    "in_progress", "completed"
  ]);
});

it("leaves the interrupted command as observed in_progress", async () => {
  const drafts = await normalizeFixture("interrupted.jsonl");
  expect(drafts.at(-1)).toMatchObject({ kind: "command", status: "in_progress", provenance: "observed" });
  expect(drafts.some(e => e.kind === "recorder.recovery")).toBe(false);
});
```

- [ ] **Step 3: Write the failing unknown-native-fields test**

Normalize `{ "type": "future.event", "future": { "nested": 7 } }`. Assert kind `source.unknown`, event type preserved, and `future.nested` remains in the in-memory native object for later redacted persistence.

- [ ] **Step 4: Run RED**

Run: `pnpm vitest packages/codex/test --run`  
Expected: FAIL because decoder/adapter modules do not exist.

- [ ] **Step 5: Implement minimal mapping**

Map thread/turn/error and agent message, reasoning, command execution, file change, MCP tool call, web search, and plan item types. Populate native session/thread/turn/item/tool/event/item-type/correlation identifiers when present. Emit one immutable draft per source record; do not synthesize recovery inside the adapter.

- [ ] **Step 6: Verify GREEN, typecheck, and diff scope**

Run: `pnpm vitest packages/codex/test --run && pnpm typecheck && git diff --check`  
Expected: PASS for every sanitized fixture plus malformed/future records.

- [ ] **Step 7: Commit**

```bash
git add packages/codex
git commit -m "feat: normalize Codex JSONL evidence"
```

### Task 5: Read-only Git evidence, process recorder, `runs`, and `inspect`

**Files:**
- Create: `apps/cli/package.json`
- Create: `apps/cli/tsconfig.json`
- Create: `apps/cli/src/args.ts`
- Create: `apps/cli/src/promptInput.ts`
- Create: `apps/cli/src/gitEvidence.ts`
- Create: `apps/cli/src/processRunner.ts`
- Create: `apps/cli/src/persistEvent.ts`
- Create: `apps/cli/src/recordRun.ts`
- Create: `apps/cli/src/format.ts`
- Create: `apps/cli/src/commands/record.ts`
- Create: `apps/cli/src/commands/runs.ts`
- Create: `apps/cli/src/commands/inspect.ts`
- Create: `apps/cli/src/main.ts`
- Create: `apps/cli/test/args.test.ts`
- Create: `apps/cli/test/promptInput.test.ts`
- Create: `apps/cli/test/gitEvidence.test.ts`
- Create: `apps/cli/test/recordRun.integration.test.ts`
- Create: `apps/cli/test/readCommands.integration.test.ts`
- Create: `apps/cli/test/privacy.integration.test.ts`
- Create: `apps/cli/test/fixtures/fake-codex.mjs`

**Interfaces:**
- Produces: packaged binary `agentlens` and development command `pnpm agentlens --`.
- Produces: `parseAgentLensArgs(argv): AgentLensCommand` without rewriting child args.
- Produces: `resolvePromptInput(childArgs, stdin): Promise<PromptInput>`.
- Produces: `captureGitBefore(cwd): Promise<GitBeforeEvidence>` and `captureGitAfter(before): Promise<GitAfterEvidence>`.
- Produces: `recordRun(command, dependencies): Promise<RecordResult>`.

- [ ] **Step 1: Write failing argument/stdin tests**

Name the breaks: AgentLens could inject flags/change argv, or fail to preserve stdin prompts.

Assert exact child argv equality for ordinary prompts; reject missing delimiter/non-Codex/missing exec/missing `--json`; buffer and forward every non-TTY stdin stream unchanged (including `codex exec -`, promptless piped prompts, and prompt-plus-stdin context); store only redacted/omitted representation; reject explicit `codex exec -` with TTY stdin.

- [ ] **Step 2: Write failing Git evidence tests**

Use real disposable repos and a recording fake. Assert dirty status refuses before fake spawn; executed Git subcommands are restricted to read-only allowlist; initial/final HEAD/branch/status persist; a child-created commit with a clean final worktree still produces tracked final diff relative to initial HEAD; branch changes flag; untracked contents are absent while metadata remains; `git diff --check <initial-head> --` result persists.

- [ ] **Step 3: Write failing recorder lifecycle tests**

The fake Codex supports success, failed-then-recovery, nonzero, malformed, unknown, stderr, stdin-echo, commit, branch-change, untracked, and hang modes. Assert run ID exists and is printed before fake child begins; provider and process facts remain separate; contradictions reconcile by spec precedence; interruption keeps observed `in_progress` unchanged and appends one `recorder.recovery`; child exit/signal remains nullable and never fabricated.

- [ ] **Step 4: Write failing native-payload/privacy tests**

Assert standard mode stores small unknown fields inline after redaction and large native JSON as an artifact. Assert metadata-only unique sentinel strings placed in prompt/message/command/output/diff/native/stderr never appear in a byte scan of the entire closed data root, including SQLite/WAL/SHM/artifacts/temp paths. Assert standard bearer token becomes the exact keyed-marker shape and `.env` diff block/content is absent.

- [ ] **Step 5: Write failing `runs`/`inspect` tests**

Assert `runs --json` includes status, child exit/signal, head/branch-change flags, and capability summary. Assert `inspect --json` returns immutable chronological events, sources, relationships, native payload representation, contradictions, and exact Git terminology `tracked final diff` and `untracked-file metadata`. Text labels use `Recorder recovery` only for `recorder.recovery`; other recorder events use `Recorder`.

- [ ] **Step 6: Run RED**

Run: `pnpm vitest apps/cli/test --run`  
Expected: FAIL because the CLI vertical slice does not exist.

- [ ] **Step 7: Implement argument/prompt and Git preflight**

Keep child argv bytes/ordering exact. Buffer every non-TTY stdin stream fully in memory, capture it under policy, and forward the original bytes unchanged. Use Node `spawn` with argument arrays for the child and `execFile` with argument arrays for exact read-only Git commands. Refuse dirty/non-Git before child spawn.

- [ ] **Step 8: Implement streaming persistence and reconciliation**

Create run `starting`, print id, spawn child with separate pipes/no PTY, mark `running`, decode lines, redact summaries/normalized/native content, prepare artifacts, commit artifact metadata only after completed files exist, append events/sources/relationships, record process exit, capture final Git evidence, append recovery, reconcile, and close storage handles.

- [ ] **Step 9: Implement `runs` and `inspect`**

Set `apps/cli/package.json` to expose `{ "bin": { "agentlens": "dist/main.js" } }` and add a Node shebang to the compiled entry point. Support text and JSON output with the exact fields/labels in the spec. `--native` refuses non-standard capture and otherwise loads only redacted inline/artifact native content.

- [ ] **Step 10: Verify GREEN, typecheck, and diff scope**

Run: `pnpm vitest apps/cli/test --run && pnpm test && pnpm typecheck && git diff --check`  
Expected: PASS with no UI/API/Claude/derivation code.

- [ ] **Step 11: Run milestone real-process checks**

Use clean disposable repositories and isolated `--data-root` directories for success, failed-command recovery, interrupt, malformed/unknown fake input, metadata-only sentinels, standard token/diff redaction, and dirty refusal. For the successful and recovery cases, run the installed current `codex exec --json` where deterministic prompting permits; use the deterministic fake only for malformed/unknown, forced signal timing, and sentinel injection that a real provider cannot safely guarantee.

- [ ] **Step 12: Commit**

```bash
git add apps/cli package.json pnpm-lock.yaml
git commit -m "feat: record and inspect Codex trajectories"
```

## Deferred Task 6: Derivations, assessments, and doctor

After the Task 5 milestone is accepted, add tokenized shell-command classification rather than substring matching. `test.command` and `test.result` events must use `derived_from` relationships and source event IDs. Add assessments and `doctor`; keep passing tests separate from correctness.

Required negative classifier cases include `printf 'pytest'`, comments, quoted output, and filenames containing `test`. Required positive cases identify the executed program/subcommand for npm/pnpm/Jest/Vitest/pytest/Cargo/Go/Maven/Gradle.

## Deferred Task 7: Local API and React review UI

After Task 6 is accepted, add a loopback-only authenticated API and two screens: run list and run detail. Preserve provenance, contradictions, capability limits, tracked-final-diff/untracked-metadata terminology, redacted native inspection, and distinct `Recorder` versus `Recorder recovery` labels. Do not add graphs, grading, comparisons, or hosted features.

## Milestone stop rule

After Task 5 verification and final whole-branch review, stop. Report commits, exact verification evidence, real disposable-run artifacts, deviations, risks, rulings, and whether implementation evidence supports proceeding to deferred Tasks 6–7.
