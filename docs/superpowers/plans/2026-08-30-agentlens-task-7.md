# AgentLens Task 7 Production UI/API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved local AgentLens production interface from durable Task 6 evidence: `agentlens ui` opens a loopback-only authenticated run ledger and execution trajectory with bounded event, Git, native, and human-assessment inspection.

**Architecture:** Task 7 first proves the narrow active-WAL read boundary, then extracts Task 6 read semantics from the CLI into `packages/application`. Storage adds bounded keyset/window queries without changing canonical evidence. `packages/api-contract` owns closed browser schemas, `apps/server` owns loopback HTTP/auth/static delivery, and `apps/web` owns the React execution-spine experience. The CLI and HTTP server share application services; React never imports storage or re-derives evidence.

**Tech Stack:** TypeScript, Node.js 22, pnpm workspaces, Vitest, Zod 3, better-sqlite3, Node HTTP, React, Vite, React Router, TanStack Query, TanStack Virtual, Motion for React, React Testing Library, Playwright, and locally bundled Fontsource Geist assets.

**Spec:** `docs/superpowers/specs/2026-08-30-agentlens-task-7-design.md`

## Global Constraints

- Start from local `main` commit `78d99399248e5bdda41cb3c78ba7344354db69a6` and create an isolated `codex/agentlens-task-7` worktree with `superpowers:using-git-worktrees` before implementation.
- The design commit is the source of truth. Do not reopen its architecture unless a failing implementation proof establishes a material incompatibility.
- Task 7 is limited to the localhost server, explicit API DTOs, run list, run detail, execution trajectory, evidence inspector, final Git evidence, assessment UI, active polling, visual polish, responsive behavior, accessibility, and browser/E2E verification.
- Do not implement Claude hooks, AGY, multi-provider comparisons, benchmark cases, Insights, hosted accounts, sharing, exports, LLM summaries, grading, quality scores, WebSockets, SSE, or a mobile app.
- Canonical observed events are immutable and chronological. UI grouping is presentation-only, combines only contiguous exact lifecycle siblings, and never rewrites or reorders evidence.
- Preserve observed, derived, Git-recovered, recorder, recorder-recovery presentation, and human evidence as distinct concepts. Status and provenance remain independent.
- Never convert likely-test evidence, child exit, provider completion, or human assessment into an unqualified claim that a run succeeded.
- `none_detected`, `unavailable_due_to_capture_policy`, and `detected` remain distinct. Multiple test attempts retain the latest result and prior-failure count.
- Missing telemetry is unavailable, not zero. Untracked-file contents remain unavailable; use “tracked final diff + untracked-file metadata.”
- Browser contracts are closed allowlists. No storage record, SQLite handle, artifact path, database path, full repository path, redaction key, arbitrary normalized object, or persisted raw provider source ID crosses HTTP.
- Standard content is already redacted and still passes response bounds. Metadata-only and strict return no prompt, message, command, output, diff, note, native, or other omitted content bytes.
- Secret detection remains risk reduction, not a guarantee.
- Ordinary API reads issue no SQL writes, migrations, initialization, repair, recovery, derivation, assessment, Git command, or lifecycle mutation.
- `agentlens runs` and `agentlens inspect` keep the accepted immutable/no-WAL behavior unchanged.
- Active-WAL server reads are authorized only by the exact Section 16 exception. If Task 7.1 cannot prove that boundary with the installed SQLite stack, stop implementation and request a design amendment.
- Assessment note bytes are redacted in memory, written durably before database metadata, and may become an orphan after an ETag conflict. A committed row may never reference a missing artifact.
- Assessment `If-Match` comparison occurs inside the same immediate transaction before artifact metadata, human event, or current projection is committed.
- The server binds an OS-selected port on `127.0.0.1` only. No public bind option, permissive CORS, token persistence, token log, or unauthenticated API route is allowed.
- The bearer token remains in a lexical in-memory client closure. It never enters localStorage, sessionStorage, IndexedDB, cookies, URL state, browser history, DOM attributes, globals, source maps, or logs.
- Fonts, scripts, styles, and icons are bundled locally. The UI makes no external network requests.
- The prototype under `design-prototypes/trajectory-concept-v1` remains an isolated visual reference and production has no runtime import from it. Preserve the untracked prototype directory and never stage its generated output.
- Keep files focused. Do not recreate the prototype’s monolithic component or add a broad component framework.
- Every implementation task follows RED → confirm expected failure → smallest GREEN implementation → focused regressions → `pnpm typecheck` → diff review → `git diff --check` → commit.
- If a test fails unexpectedly, invoke `superpowers:systematic-debugging` before changing implementation.
- Before each commit or completion claim, invoke `superpowers:verification-before-completion` and use fresh output.
- At Tasks 7.9–7.14, inspect the real browser at meaningful milestones; do not defer visual verification to the final task.

## File Responsibility Map

### Storage and application services

- `packages/storage/src/database.ts` owns immutable terminal reads and the separately named active-WAL server-read gate.
- `packages/storage/src/runRepository.ts` owns bounded run/event queries, exact event/artifact bindings, Git-evidence references, and atomic assessment persistence. It does not create browser DTOs.
- `packages/application/src/artifacts/readValidatedArtifact.ts` owns canonical path, no-follow, identity, length, digest, kind, media, capture-policy, and response-bound artifact reads shared by CLI and server.
- `packages/application/src/ownership.ts` and `packages/application/src/processIdentity.ts` own read-only ownership diagnosis shared by CLI and server.
- `packages/application/src/runSummary.ts` supplies validated inputs to `@agentlens/derivations`; it does not duplicate summary semantics.
- `packages/application/src/queries/runQueryService.ts` owns provider-neutral run/detail/event-window queries and jump anchors.
- `packages/application/src/api/projectors.ts` owns closed browser projections, availability states, safe summaries, and unsupported-value wrappers.
- `packages/application/src/api/cursors.ts` owns process-local authenticated opaque run/event cursors.
- `packages/application/src/api/sourceRefs.ts` owns process-local HMAC source/group references using a dedicated secret.
- `packages/application/src/assessmentService.ts` owns validation, redaction, artifact creation, and shared CLI/HTTP assessment orchestration.
- `packages/application/src/index.ts` is the only public application-package surface.

### Browser contract and server

- `packages/api-contract/src/errors.ts` owns the exact API error-code union and envelope.
- `packages/api-contract/src/evidence.ts` owns availability, status, provider, provenance, and source-reference schemas.
- `packages/api-contract/src/runs.ts` owns run-list/detail DTOs and page schemas.
- `packages/api-contract/src/events.ts` owns trajectory, event-detail, content, native, and event-page schemas.
- `packages/api-contract/src/git.ts` owns structured Git status/diff/diff-check/untracked DTOs.
- `packages/api-contract/src/assessment.ts` owns assessment read/write schemas and ETag-facing DTOs.
- `apps/server/src/security/*` owns token/bootstrap generation, Host/Origin enforcement, CSP, and headers.
- `apps/server/src/routes/*` owns route parsing and application-service calls; route files do not read SQLite or artifacts directly.
- `apps/server/src/staticAssets.ts` owns the Vite manifest and hashed local assets.
- `apps/server/src/startServer.ts` owns the loopback listener and lifecycle.
- `apps/cli/src/commands/ui.ts` owns CLI startup/open-browser behavior and signal-driven shutdown.

### Production web application

- `apps/web/src/api/*` owns the in-memory authenticated client, query keys, and schema-validated responses.
- `apps/web/src/app/*` owns routes and shell.
- `apps/web/src/runs/*` owns the evidence-dense run ledger and filters.
- `apps/web/src/run-detail/*` owns the run header, workspace, inspector, and deep-evidence surface.
- `apps/web/src/trajectory/projectTrajectory.ts` is the pure event-to-layout projection.
- `apps/web/src/trajectory/*` owns virtualization, spine/gutter rendering, selection, grouping, jumps, and relationships.
- `apps/web/src/evidence/*` owns command/output/native/Git/note viewers and never renders untrusted HTML.
- `apps/web/src/styles/*` owns tokens, typography, responsive rules, focus, reduced motion, provenance, and status styling.
- `apps/web/e2e/*` owns real-browser journeys and visual/accessibility release checks.

### Existing CLI compatibility

- `apps/cli/src/commands/runs.ts`, `inspect.ts`, and `assess.ts` become thin consumers of `@agentlens/application` while preserving their public JSON/text contracts.
- `apps/cli/src/args.ts`, `main.ts`, and new `developmentEntry.ts` make `pnpm agentlens ui` and packaged `agentlens ui` real invocations.
- `apps/cli/src/format.ts` remains CLI-only presentation. No HTTP route imports it.

---

### Task 7.1: Prove the active-WAL server-read boundary first

**Files:**
- Modify: `packages/storage/src/database.ts:1-224`
- Modify: `packages/storage/src/index.ts`
- Modify: `packages/storage/test/readOnlyDatabase.test.ts:1-440`

**Interfaces:**
- Consumes: existing `openDatabaseReadOnly(path)` unchanged for terminal/no-WAL CLI reads.
- Produces:

```ts
export type ServerReadMode = "immutable" | "active_wal";

export interface ServerReadDatabase {
  readonly database: AgentLensDatabase;
  readonly mode: ServerReadMode;
}

export type ServerReadDatabaseErrorReason =
  | "active_sidecar_missing"
  | "active_sidecar_invalid"
  | "active_sidecar_changed"
  | "active_wal_unavailable";

export function openDatabaseForServerRead(path: string): ServerReadDatabase;
```

- [ ] **Step 1: Re-read the frozen gate and current SQLite implementation**

Read design Section 16, `openDatabaseReadOnly`, `constructDatabase`, `databaseInternal.ts`, and every existing read-only database test. Confirm `openDatabaseReadOnly` and its `wal_present` result remain byte-for-byte compatible.

- [ ] **Step 2: Write active-WAL RED tests**

Add helpers that snapshot every entry under the temporary data root with path, type, link target, uid, gid, mode, device, inode, size, and SHA-256. Create a writable AgentLens database, keep WAL mode active, ensure main/WAL/SHM are owner-only regular files, commit one run, hold the writer quiescent, snapshot, read through the new function, snapshot again, then commit a second run and repeat.

Core assertions:

```ts
const opened = openDatabaseForServerRead(path);
expect(opened.mode).toBe("active_wal");
expect(new RunRepository(opened.database, { artifactRoot }).listRuns()
  .map(({ id }) => id)).toContain("active-run-2");

expect(withAllowedShmCoordination(after)).toEqual(
  withAllowedShmCoordination(before)
);
expect(afterShm).toMatchObject({
  type: "file",
  uid: beforeShm.uid,
  gid: beforeShm.gid,
  mode: beforeShm.mode,
  inode: beforeShm.inode,
  size: beforeShm.size
});
```

Add negative cases for absent WAL, absent SHM while WAL exists, symlink/directory sidecars, owner mismatch, group/world permissions, inode swap between validation/open, and SQL write attempts. Instrument a write query and assert it fails with readonly/query-only behavior.

- [ ] **Step 3: Run the gate RED**

Run:

```bash
pnpm vitest --run packages/storage/test/readOnlyDatabase.test.ts
```

Expected: FAIL because `openDatabaseForServerRead` and the active-sidecar error contract do not exist.

- [ ] **Step 4: Implement the smallest server-only read path**

Keep the no-WAL branch delegated to `openDatabaseReadOnly`. For a present WAL, lstat main/WAL/SHM before opening; require same effective owner, owner-only modes, regular non-symlink files, and stable identities. Open with `readonly: true`, `fileMustExist: true`, then set `foreign_keys=ON`, `query_only=ON`, and the existing bounded busy timeout without migrations or journal pragmas. Re-lstat after open and fail closed if any identity changed.

Do not create sidecars, call checkpoint, copy the database, clean SHM, or fall back to `openDatabase`.

- [ ] **Step 5: Run the active-WAL gate GREEN and immutable regressions**

Run the focused test again. Expected: all active-WAL and existing immutable/no-WAL cases pass. Then run:

```bash
pnpm vitest --run apps/cli/test/readCommands.integration.test.ts
```

Expected: CLI `runs`/`inspect` still refuse WAL and preserve exact storage snapshots.

- [ ] **Step 6: Stop if the physical boundary cannot be proven**

If the test detects any new path, database/WAL/artifact byte change, SHM inode/owner/mode/size change, SQL write, or inability to see the second committed run, do not weaken assertions. Report the failing snapshots and request a design amendment. Do not begin Task 7.2.

- [ ] **Step 7: Verify and commit**

Run:

```bash
pnpm typecheck
git diff --check
git diff -- packages/storage/src/database.ts packages/storage/src/index.ts packages/storage/test/readOnlyDatabase.test.ts
```

Commit only those files:

```bash
git add packages/storage/src/database.ts packages/storage/src/index.ts packages/storage/test/readOnlyDatabase.test.ts
git commit -m "feat(storage): add bounded active WAL reads"
```

---

### Task 7.2: Extract shared read services without changing CLI behavior

**Files:**
- Create: `packages/application/package.json`
- Create: `packages/application/tsconfig.json`
- Create: `packages/application/src/artifacts/readValidatedArtifact.ts`
- Create: `packages/application/src/processIdentity.ts`
- Create: `packages/application/src/ownership.ts`
- Create: `packages/application/src/runSummary.ts`
- Create: `packages/application/src/index.ts`
- Create: `packages/application/test/readValidatedArtifact.test.ts`
- Create: `packages/application/test/ownership.test.ts`
- Create: `packages/application/test/runSummary.test.ts`
- Modify: `apps/cli/src/readArtifact.ts`
- Modify: `apps/cli/src/processIdentity.ts`
- Modify: `apps/cli/src/diagnoseOwnership.ts`
- Modify: `apps/cli/src/projectRunSummary.ts`
- Modify: `apps/cli/package.json`
- Modify: `apps/cli/tsconfig.json`
- Modify: `tsconfig.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: `RunDetail`, `RunRepository.getCurrentAssessment`, `summarizeRun`, injected provider capabilities, and the existing artifact-root layout.
- Produces:

```ts
export interface ProviderCapabilitiesLookup {
  forProvider(provider: NativeSourceV1["provider"]): AdapterCapabilities;
}

export async function projectRunSummary(input: {
  readonly detail: RunDetail;
  readonly repository: Pick<RunRepository, "getCurrentAssessment">;
  readonly artifactRoot: string;
  readonly providerCapabilities: ProviderCapabilitiesLookup;
}): Promise<RunSummary>;

export async function readValidatedArtifact(
  artifact: StoredArtifact,
  artifactRoot: string,
  requirements: ArtifactReadRequirements
): Promise<ValidatedArtifactRead>;
```

- [ ] **Step 1: Read existing CLI behavior and public tests**

Read the four CLI modules being extracted plus `projectRunSummary.test.ts`, `readArtifact.test.ts`, `diagnoseOwnership.test.ts`, and `readCommands.integration.test.ts`. Record every exported name and error pattern the CLI tests observe.

- [ ] **Step 2: Write application-package RED tests**

Port the existing behavior tables into the new package before moving implementation. Add an explicit provider-injection test:

```ts
const summary = await projectRunSummary({
  detail,
  repository,
  artifactRoot,
  providerCapabilities: {
    forProvider: (provider) => {
      expect(provider).toBe("codex-exec");
      return codexExecCapabilities;
    }
  }
});
expect(summary.providerCapabilityLimitations.availability).toBe("available");
```

Assert artifact tampering, symlinks, digest/length/media/kind mismatches, invalid UTF-8 untracked metadata, projected-vs-explicit assessment, and likely-stale ownership produce the same results as Task 6.

- [ ] **Step 3: Run the extraction RED tests**

Run:

```bash
pnpm vitest --run packages/application/test
```

Expected: FAIL because `@agentlens/application` does not exist.

- [ ] **Step 4: Move implementation, do not rewrite semantics**

Move the tested functions into focused application files. Keep the CLI source files as compatibility re-exports for one commit so existing internal imports and tests remain stable:

```ts
export { readValidatedArtifact } from "@agentlens/application";
export type {
  ArtifactReadRequirements,
  ValidatedArtifactRead
} from "@agentlens/application";
```

Use a provider capability lookup rather than importing Codex semantics into the summary projector. CLI commands inject `codexExecCapabilities` for the current provider.

- [ ] **Step 5: Run application and CLI GREEN suites**

Run:

```bash
pnpm vitest --run packages/application/test apps/cli/test/projectRunSummary.test.ts apps/cli/test/readArtifact.test.ts apps/cli/test/diagnoseOwnership.test.ts apps/cli/test/readCommands.integration.test.ts
```

Expected: all moved-service and CLI compatibility tests pass with unchanged CLI JSON/text fixtures.

- [ ] **Step 6: Verify and commit**

Run `pnpm typecheck`, `git diff --check`, and review that `packages/application` imports no CLI module. Commit:

```bash
git add packages/application apps/cli/src/readArtifact.ts apps/cli/src/processIdentity.ts apps/cli/src/diagnoseOwnership.ts apps/cli/src/projectRunSummary.ts apps/cli/package.json apps/cli/tsconfig.json tsconfig.json pnpm-lock.yaml
git commit -m "refactor: share AgentLens read services"
```

---

### Task 7.3: Add bounded storage queries and exact evidence bindings

**Files:**
- Modify: `packages/storage/src/runRepository.ts:135-386,1861-2134`
- Modify: `packages/storage/src/index.ts`
- Modify: `packages/storage/test/runRepository.test.ts`

**Interfaces:**
- Consumes: current canonical storage rows and schemas; no browser DTO dependency.
- Produces:

```ts
export interface RunPageBoundary {
  readonly startedAt: number;
  readonly runId: string;
}

export interface ListRunPageInput {
  readonly limit: number;
  readonly before?: RunPageBoundary;
  readonly status?: RunStatus;
  readonly repositoryFingerprint?: string;
  readonly assessment?:
    | { readonly state: "projected" }
    | { readonly state: "explicit"; readonly verdict?: AssessmentVerdict };
}

export type EventWindowInput =
  | { readonly mode: "head"; readonly limit: number }
  | { readonly mode: "tail"; readonly limit: number }
  | { readonly mode: "after"; readonly sequence: number; readonly limit: number }
  | { readonly mode: "around"; readonly sequence: number; readonly limit: number }
  | { readonly mode: "before"; readonly sequence: number; readonly limit: number };

export interface EventWindowRecord {
  readonly events: readonly TraceEventV1[];
  readonly latestCommittedSequence: number | null;
  readonly hasEarlier: boolean;
  readonly hasLater: boolean;
}

export interface EventArtifactBinding {
  readonly runId: string;
  readonly eventId: string;
  readonly role: "assessment_note";
  readonly artifact: StoredArtifact;
}

export interface RunSummaryBatchRecord {
  readonly runId: string;
  readonly summaryEvents: readonly TraceEventV1[];
  readonly gitEvidence: RunGitEvidence | null;
  readonly currentAssessment: CurrentAssessment;
}
```

- [ ] **Step 1: Read all affected queries and compatibility branches**

Read `listRuns`, `getRunDetail`, `readEvents`, schema-capability detection, current assessments, Git evidence, artifacts, and event-artifact bindings. Preserve Task 5-schema compatibility in existing CLI methods; new Task 7 query methods may return a typed capability-unavailable error when migration 004 is absent.

- [ ] **Step 2: Write keyset and filter RED tests**

Seed runs with duplicate `startedAt` values, different IDs/statuses/repositories, projected and explicit assessments, and more records than one page. Assert stable descending `(startedAt, runId)` pages with no gap/duplicate:

```ts
const first = repository.listRunPage({ limit: 2 });
const second = repository.listRunPage({
  limit: 2,
  before: {
    startedAt: first.items.at(-1)!.startedAt,
    runId: first.items.at(-1)!.id
  }
});
expect(new Set([...first.items, ...second.items].map(({ id }) => id)).size)
  .toBe(first.items.length + second.items.length);
```

Test each status, repository, projected, explicit, and explicit-verdict filter at SQL level.

- [ ] **Step 3: Write event-window and binding RED tests**

Seed 1,001 events with relationships and assert head, tail, after, around, and before windows are chronological and bounded. Cover empty run and empty after-page semantics without sequence zero. Assert event lookup rejects a cross-run event ID. Assert assessment-note binding requires the exact same-run event, artifact, role, kind, and capture policy. Assert one `getRunSummaryBatch` call returns only summary-relevant observed/derived events, Git evidence, and current assessment for the requested page IDs; it must not call `getRunDetail` once per row.

- [ ] **Step 4: Run storage RED**

Run:

```bash
pnpm vitest --run packages/storage/test/runRepository.test.ts
```

Expected: FAIL because bounded query and binding APIs do not exist.

- [ ] **Step 5: Implement keyset/window SQL**

Use parameterized SQL and request `limit + 1` to calculate page flags. Refactor row-to-event projection so full-detail and window reads share one parser. Fetch relationships only for returned event IDs. Never load all events to answer a window request. Keep `getRunDetail` unchanged for existing CLI callers.

Add storage methods:

```ts
listRunPage(input: ListRunPageInput): RunPageRecord;
getRunSummaryBatch(runIds: readonly string[]): readonly RunSummaryBatchRecord[];
getEventWindow(runId: string, input: EventWindowInput): EventWindowRecord;
getEvent(runId: string, eventId: string): TraceEventV1 | null;
getEventArtifactBinding(
  runId: string,
  eventId: string,
  role: "assessment_note"
): EventArtifactBinding | null;
getArtifactForRun(runId: string, artifactId: string): StoredArtifact | null;
```

`getRunSummaryBatch` uses parameterized, chunked `IN` queries bounded by the current run page (maximum 100 IDs). Its event query allowlists only the evidence classes consumed by `summarizeRun`: terminal observed commands, terminal native file changes, provider usage events, recorder diagnostics/recovery, and Task 6 test derivations. It must not hydrate arbitrary event payloads, artifacts, or full `RunDetail` objects.

- [ ] **Step 6: Run GREEN and existing repository regressions**

Run the storage repository test. Expected: all new page/binding tests and existing 101+ repository tests pass. Then run:

```bash
pnpm vitest --run apps/cli/test/readCommands.integration.test.ts apps/cli/test/assess.integration.test.ts
```

Expected: CLI behavior and Task 6 assessment history remain unchanged.

- [ ] **Step 7: Verify and commit**

Run `pnpm typecheck`, `git diff --check`, and inspect SQL for unbounded reads, string interpolation, or writes. Commit:

```bash
git add packages/storage/src/runRepository.ts packages/storage/src/index.ts packages/storage/test/runRepository.test.ts
git commit -m "feat(storage): add bounded Task 7 queries"
```

---

### Task 7.4: Freeze closed API schemas, cursors, and browser projections

**Files:**
- Create: `packages/api-contract/package.json`
- Create: `packages/api-contract/tsconfig.json`
- Create: `packages/api-contract/src/errors.ts`
- Create: `packages/api-contract/src/evidence.ts`
- Create: `packages/api-contract/src/runs.ts`
- Create: `packages/api-contract/src/events.ts`
- Create: `packages/api-contract/src/git.ts`
- Create: `packages/api-contract/src/assessment.ts`
- Create: `packages/api-contract/src/index.ts`
- Create: `packages/api-contract/test/contracts.test.ts`
- Create: `packages/application/src/api/cursors.ts`
- Create: `packages/application/src/api/sourceRefs.ts`
- Create: `packages/application/src/api/projectors.ts`
- Create: `packages/application/test/apiProjection.test.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `packages/application/package.json`
- Modify: `packages/application/tsconfig.json`
- Modify: `tsconfig.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: Task 7.3 storage windows, Task 7.2 summaries, canonical events, and a dedicated random per-process HMAC key.
- Produces the exact Section 14 unions, including:

```ts
export type KnownOrUnsupportedV1<T extends string> =
  | Readonly<{ state: "known"; value: T }>
  | Readonly<{ state: "unsupported"; safeToken: string }>;

export interface BrowserSourceRefV1 {
  readonly opaqueRef: string;
  readonly provider: ProviderFieldV1;
  readonly hasSessionOrThread: boolean;
  readonly hasTurn: boolean;
  readonly hasItemOrTool: boolean;
  readonly hasCorrelation: boolean;
}

export type TrajectoryWindowV1 =
  | Readonly<{
      state: "nonempty";
      minSequence: number;
      maxSequence: number;
      latestCommittedSequence: number;
      hasEarlier: boolean;
      hasLater: boolean;
      earlierCursor: string | null;
      laterCursor: string | null;
    }>
  | Readonly<{
      state: "empty";
      latestCommittedSequence: number | null;
      hasEarlier: boolean;
      hasLater: false;
      earlierCursor: string | null;
      laterCursor: null;
    }>;
```

- [ ] **Step 1: Translate the design contract into strict Zod schemas**

Define exact `schemaVersion: 1` envelopes and the frozen error-code union. Use `.strict()` for every object. Define closed known enums plus bounded unsupported wrappers. Put the `[a-z0-9._-]{1,64}` sanitizer in the application projector, never in React.

`TrajectoryEventV1` contains only structural fields. `EventDetailV1` is a discriminated union for lifecycle, message, reasoning, command, file change, tool, plan, Git, recorder, recorder recovery, test, assessment, error, and structural-only unknown. `NormalizedContentV1` has only known allowlisted variants. There is no generic JSON content variant.

- [ ] **Step 2: Write schema RED tests for leakage and compatibility**

Construct a canonical event containing sentinels in normalized payload, native payload, raw source IDs, storage paths, and extra unknown fields. Assert the trajectory and unknown-detail schemas reject or omit every forbidden field:

```ts
expect(() => trajectoryEventV1Schema.parse({
  ...safeTrajectory,
  normalizedPayload: { sentinel: "MUST_NOT_CROSS_HTTP" }
})).toThrow();

expect(eventDetailV1Schema.parse(unknownDetail)).toEqual({
  schemaVersion: 1,
  presentationClass: "unknown",
  eventId: unknownDetail.eventId,
  runId: unknownDetail.runId,
  sequence: unknownDetail.sequence,
  kind: unknownDetail.kind,
  status: unknownDetail.status,
  provenance: unknownDetail.provenance,
  relationships: unknownDetail.relationships,
  content: { state: "unavailable", reason: "unsupported_kind" }
});
```

Test every canonical run/event status, bounded unsupported tokens, projected versus explicit assessment, evidence availability, empty/nonempty windows, and every stable API error code.

- [ ] **Step 3: Run contract RED**

Run:

```bash
pnpm vitest --run packages/api-contract/test packages/application/test/apiProjection.test.ts
```

Expected: FAIL because schemas, cursor/source HMAC, and projectors do not exist.

- [ ] **Step 4: Implement opaque cursors and source references**

Generate a dedicated 32-byte source-reference key and a separate 32-byte cursor key per server process. Encode cursors as base64url payload plus HMAC. Bind event cursors to run ID, mode/direction, page boundary, and `latestCommittedSequence`; bind run cursors to filters and `(startedAt, runId)`. Reject bad MACs, mismatched filters/runs, malformed bounds, and oversized cursor text with `invalid_cursor`.

Source refs are:

```ts
`src_${createHmac("sha256", sourceKey)
  .update(lengthDelimitedCanonicalSourceTuple)
  .digest("hex")}`
```

Use a separate lifecycle-group HMAC domain. Never concatenate raw IDs into a DTO.

- [ ] **Step 5: Implement projectors with exhaustive switches**

Use `assertNever` for known status/presentation cases, a bounded unsupported wrapper for future status/provider values, and structural-only fallback for unknown event kinds. Project recorder recovery only for `kind === "recorder.recovery"`. Preserve exact AgentLens relationship event IDs and derivation source IDs; do not infer causal edges.

- [ ] **Step 6: Run GREEN and privacy scans**

Run the focused contract/application tests. Serialize every DTO fixture and assert raw provider IDs, database/artifact paths, normalized/native sentinels, and redaction/HMAC keys are absent. Expected: all schemas and projectors pass.

- [ ] **Step 7: Verify and commit**

Run `pnpm typecheck`, `git diff --check`, and confirm `packages/api-contract` imports only Zod and its own files. Commit:

```bash
git add packages/api-contract packages/application/src/api packages/application/src/index.ts packages/application/package.json packages/application/tsconfig.json packages/application/test/apiProjection.test.ts tsconfig.json pnpm-lock.yaml
git commit -m "feat(api): add closed AgentLens browser contracts"
```

---

### Task 7.5: Build the loopback server, one-use bootstrap, and real `ui` command

**Files:**
- Create: `apps/server/package.json`
- Create: `apps/server/tsconfig.json`
- Create: `apps/server/src/security/tokens.ts`
- Create: `apps/server/src/security/requestPolicy.ts`
- Create: `apps/server/src/security/headers.ts`
- Create: `apps/server/src/bootstrap.ts`
- Create: `apps/server/src/staticAssets.ts`
- Create: `apps/server/src/router.ts`
- Create: `apps/server/src/startServer.ts`
- Create: `apps/server/src/index.ts`
- Create: `apps/server/test/security.integration.test.ts`
- Create: `apps/server/test/fixtures/web/.vite/manifest.json`
- Create: `apps/server/test/fixtures/web/assets/fixture.js`
- Create: `apps/cli/src/commands/ui.ts`
- Create: `apps/cli/src/developmentEntry.ts`
- Create: `apps/cli/test/ui.integration.test.ts`
- Modify: `apps/cli/src/args.ts:1-262`
- Modify: `apps/cli/src/main.ts:1-70`
- Modify: `apps/cli/test/args.test.ts`
- Modify: `apps/cli/test/packagedBinary.integration.test.ts`
- Modify: `apps/cli/package.json`
- Modify: `apps/cli/tsconfig.json`
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: Task 7.4 error envelope; no database route yet except authenticated health readiness injection.
- Produces:

```ts
export interface StartAgentLensServerOptions {
  readonly dataRoot: string;
  readonly webRoot?: string;
  readonly host?: "127.0.0.1";
  readonly port?: number;
  readonly tokenBytes?: () => Buffer;
}

export interface AgentLensServerHandle {
  readonly origin: string;
  readonly bootstrapUrl: string;
  close(): Promise<void>;
}

export interface UiCommand {
  readonly name: "ui";
  readonly dataRoot: string;
  readonly noOpen: boolean;
}
```

The bearer is never exposed on `AgentLensServerHandle`. Security tests obtain it exactly as a browser does: fetch and consume the one-use bootstrap response, then issue authorized requests from the token captured by the fixture module. A test-only fixture callback may observe that module argument, but production server interfaces and logs never expose the bearer.

- [ ] **Step 1: Write CLI parsing RED tests**

Assert exact supported forms and duplicates:

```ts
expect(parseAgentLensArgs(["ui"])).toEqual({
  name: "ui",
  dataRoot: expect.any(String),
  noOpen: false
});
expect(parseAgentLensArgs([
  "ui", "--data-root", "/tmp/agentlens-ui", "--no-open"
])).toEqual({ name: "ui", dataRoot: "/tmp/agentlens-ui", noOpen: true });
expect(() => parseAgentLensArgs(["ui", "--port", "9000"]))
  .toThrow(/unknown.*ui/i);
```

Update public usage to include `ui`. Do not add host/LAN configuration.

- [ ] **Step 2: Write security/bootstrap RED integration tests**

Start on `127.0.0.1:0` with deterministic test bytes and static fixtures. Assert:

- the selected address is exactly loopback;
- wrong/malformed Host is rejected;
- `/api/v1/health` requires the bearer;
- static hashed assets are accessible without auth and include no token;
- the bootstrap code succeeds once and then fails;
- direct reloads of `/runs` and `/runs/:runId` serve only a token-free shell that renders the intentional authentication-expired state without issuing an API request;
- bootstrap/API responses are `no-store` and carry `nosniff`, `no-referrer`, frame denial, and a nonce-bound restrictive CSP;
- bootstrap HTML contains no cookie/localStorage/sessionStorage/IndexedDB/query/fragment/global token transfer;
- bearer is absent from server logs and ordinary stdout;
- foreign and null Origin are rejected for mutation requests;
- oversized request bodies are rejected before route logic.

Core bootstrap assertions:

```ts
expect(html).toContain("history.replaceState(null, '', '/runs')");
expect(html).toMatch(/<script type="module" nonce="[^"]+">/);
expect(html).toContain('document.getElementById("agentlens-bootstrap")?.remove()');
expect(secondBootstrap.status).toBe(404);
```

- [ ] **Step 3: Run server/CLI RED**

Run:

```bash
pnpm vitest --run apps/server/test/security.integration.test.ts apps/cli/test/args.test.ts apps/cli/test/ui.integration.test.ts
```

Expected: FAIL because server, `UiCommand`, and UI startup do not exist.

- [ ] **Step 4: Implement the minimal Node HTTP server**

Use `node:http`; do not add a general web framework. Listen only on `127.0.0.1`. Derive the exact allowed Host from the selected port. Generate independent 32-byte bearer and bootstrap secrets. Compare tokens with constant-time buffers after exact-length validation.

Bootstrap HTML imports the Vite manifest entry from a nonce-bearing module script:

```html
<script id="agentlens-bootstrap" type="module" nonce="RESPONSE_NONCE">
const token = "JSON_ESCAPED_PROCESS_TOKEN";
history.replaceState(null, "", "/runs");
document.getElementById("agentlens-bootstrap")?.remove();
const { boot } = await import("/assets/HASHED_ENTRY.js");
boot(token);
</script>
```

Serialize the token as a JSON string and additionally escape `<`, `>`, `&`, U+2028, and U+2029 before embedding it in HTML. The `boot` function owns the token in an API-client closure. Do not assign it to `window`, DOM, history, storage, or a cookie. Static reload shells call `boot(null)` and contain no bearer or bootstrap secret.

- [ ] **Step 5: Implement CLI lifetime and development asset build**

`runUiCommand` starts the server and waits for an abort signal. With normal launch it calls an injected cross-platform browser opener and prints only the token-free origin. The default opener uses `execFile("open", [url])` on macOS, `execFile("rundll32", ["url.dll,FileProtocolHandler", url])` on Windows, and `execFile("xdg-open", [url])` elsewhere; it never invokes a shell. With `--no-open` it writes the one-use bootstrap URL exactly once to stdout. SIGINT/SIGTERM close the listener and return conventional exit codes without exposing credentials.

Make the root development script point to `apps/cli/src/developmentEntry.ts`. That entry runs:

```ts
if (normalizedArgv[0] === "ui") {
  await execFile("pnpm", ["--filter", "@agentlens/web", "build"], {
    cwd: workspaceRoot
  });
}
process.exitCode = await main(process.argv.slice(2));
```

Do not invoke a shell. Task 7.9 creates `@agentlens/web`; until then the UI integration test injects the fixture web root.

- [ ] **Step 6: Run GREEN and packaged-command regressions**

Run the focused server/CLI tests, then:

```bash
pnpm vitest --run apps/cli/test/packagedBinary.integration.test.ts apps/cli/test/args.test.ts
```

Expected: existing commands remain compatible; UI bootstrap works with a fixture asset manifest; token values appear only in the one-use HTML response and authorized request headers.

- [ ] **Step 7: Verify and commit**

Run `pnpm typecheck`, `git diff --check`, scan the diff for `0.0.0.0`, token logging, permissive CORS, and persistent browser storage. Commit:

```bash
git add apps/server apps/cli/src/commands/ui.ts apps/cli/src/developmentEntry.ts apps/cli/src/args.ts apps/cli/src/main.ts apps/cli/test/args.test.ts apps/cli/test/ui.integration.test.ts apps/cli/test/packagedBinary.integration.test.ts apps/cli/package.json apps/cli/tsconfig.json package.json tsconfig.json pnpm-lock.yaml
git commit -m "feat(server): add authenticated local UI bootstrap"
```

---

### Task 7.6: Implement run-list, run-detail, and event-window APIs

**Files:**
- Create: `packages/application/src/queries/runQueryService.ts`
- Create: `packages/application/src/queries/anchors.ts`
- Create: `packages/application/test/runQueryService.test.ts`
- Create: `apps/server/src/routes/health.ts`
- Create: `apps/server/src/routes/runs.ts`
- Create: `apps/server/src/routes/events.ts`
- Create: `apps/server/src/routes/routeContext.ts`
- Create: `apps/server/test/readApi.integration.test.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `apps/server/src/router.ts`
- Modify: `apps/server/package.json`

**Interfaces:**
- Consumes: `openDatabaseForServerRead`, Task 7.3 storage windows, Task 7.4 projectors/cursors, and injected process identity/capability lookups.
- Produces:

```ts
export interface RunQueryService {
  listRuns(input: RunListQueryV1): Promise<RunListPageV1>;
  getRun(runId: string): Promise<RunDetailV1 | null>;
  getEvents(runId: string, input: EventPageQueryV1): Promise<TrajectoryPageV1>;
  getEvent(runId: string, eventId: string): Promise<EventDetailV1 | null>;
}

export function createRunQueryService(input: {
  readonly databasePath: string;
  readonly artifactRoot: string;
  readonly cursorCodec: CursorCodec;
  readonly sourceRefProjector: SourceRefProjector;
  readonly processIdentityInspector: ProcessIdentityInspector;
  readonly providerCapabilities: ProviderCapabilitiesLookup;
}): RunQueryService;
```

- [ ] **Step 1: Write application query RED tests**

Seed terminal, starting, running, failed, interrupted, and recorder-error runs. Cover summaries, ownership diagnosis, provider limitations, Git/branch warnings, projected/explicit assessments, and jump anchors. Instrument the repository and assert a 100-row list page performs one `listRunPage` call plus one `getRunSummaryBatch` call and zero `getRunDetail` calls. Assert no route mutation by taking storage snapshots and row counts before and after queries.

For events, cover zero events, head/tail defaults by lifecycle, after, around, cursor-before/cursor-after, invalid cursor MAC, cursor from another run/filter/snapshot, unknown kind, unsupported status fixture, derivation relationships, and recorder recovery labels.

- [ ] **Step 2: Run application query RED**

Run:

```bash
pnpm vitest --run packages/application/test/runQueryService.test.ts
```

Expected: FAIL because `RunQueryService` and anchors do not exist.

- [ ] **Step 3: Implement pure read orchestration**

Open a short-lived server-read connection per request or snapshot operation; always close it in `finally`. Build summaries only in `packages/application`. For list pages, combine `listRunPage` with the single page-scoped `getRunSummaryBatch` result; never hydrate `RunDetail` per row. Compute anchors from bounded SQL queries or returned canonical evidence, not React. Return typed `active_snapshot_unavailable` on temporary active-lock failures.

Default event behavior is exact:

```ts
const mode = requestedSelector ??
  (run.status === "starting" || run.status === "running"
    ? { mode: "tail", limit }
    : { mode: "head", limit });
```

An empty page uses the explicit empty window; it never invents sequence zero.

- [ ] **Step 4: Write HTTP RED tests**

Exercise authenticated:

```text
GET /api/v1/health
GET /api/v1/runs
GET /api/v1/runs/:runId
GET /api/v1/runs/:runId/events
GET /api/v1/runs/:runId/events/:eventId
```

Assert query limits (runs 100, events 250), mutually exclusive event selectors, strict filter parsing, exact error envelopes, 404 ownership boundaries, retryable 503 for active snapshot failure, no paths/native/normalized objects, and no changes to DB/WAL/artifacts/lifecycle.

- [ ] **Step 5: Run HTTP RED**

Run:

```bash
pnpm vitest --run apps/server/test/readApi.integration.test.ts
```

Expected: FAIL because read routes are not registered.

- [ ] **Step 6: Implement routes as adapters only**

Route files validate URL/query values, call `RunQueryService`, parse the result with the response Zod schema, and serialize. They do not instantiate `RunRepository`, inspect storage rows, or compute summary semantics.

- [ ] **Step 7: Run GREEN, immutability, and unknown-kind tests**

Run application and server read tests plus:

```bash
pnpm vitest --run packages/codex/test/unknownNativeFields.test.ts apps/cli/test/readCommands.integration.test.ts
```

Expected: unknown canonical kinds do not crash HTTP; CLI read purity remains unchanged.

- [ ] **Step 8: Verify and commit**

Run `pnpm typecheck`, `git diff --check`, and inspect routes for storage/formatter imports. Commit:

```bash
git add packages/application/src/queries packages/application/src/index.ts packages/application/test/runQueryService.test.ts apps/server/src/routes apps/server/src/router.ts apps/server/test/readApi.integration.test.ts apps/server/package.json
git commit -m "feat(api): expose bounded run and event reads"
```

---

### Task 7.7: Implement explicit, role-bound evidence routes

**Files:**
- Create: `packages/application/src/evidence/contentProjector.ts`
- Create: `packages/application/src/evidence/evidenceService.ts`
- Create: `packages/application/src/evidence/gitDiffParser.ts`
- Create: `packages/application/test/evidenceService.test.ts`
- Create: `apps/server/src/routes/evidence.ts`
- Create: `apps/server/test/evidenceApi.integration.test.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `apps/server/src/router.ts`

**Interfaces:**
- Consumes: Task 7.2 validated artifact reader, exact Task 7.3 bindings, capture policy, and Task 7.4 content/Git schemas.
- Produces:

```ts
export interface EvidenceService {
  eventContent(runId: string, eventId: string): Promise<NormalizedContentV1>;
  eventNative(runId: string, eventId: string): Promise<NativeContentV1>;
  assessmentNote(runId: string, eventId: string): Promise<AssessmentNoteContentV1>;
  gitDiff(runId: string): Promise<GitDiffV1>;
  gitStatus(runId: string, phase: "initial" | "final"): Promise<GitStatusV1>;
  gitDiffCheck(runId: string): Promise<GitDiffCheckV1>;
  gitUntracked(runId: string): Promise<GitUntrackedV1>;
}
```

- [ ] **Step 1: Write binding/privacy RED tests**

For every route, test same-run success and cross-run, wrong-event, wrong-role, wrong-kind, wrong-media, path, symlink, inode, length, digest, truncated, invalid UTF-8/JSON, and response-limit failures. Test standard, metadata-only, and strict separately.

Assert historical notes use exact event binding:

```ts
const first = await service.assessmentNote(runId, olderAssessmentEventId);
const current = await service.assessmentNote(runId, currentAssessmentEventId);
expect(first.content).toBe("older redacted note");
expect(current.content).toBe("current redacted note");
```

Assert unknown/unprojectable normalized content returns `content_unavailable`, never generic JSON. Assert raw source IDs are absent from ordinary event detail and response-redacted only inside eligible standard native expansion.

- [ ] **Step 2: Write structured diff RED tests**

Cover file headers, quoted paths, hunks, context/add/delete lines, old/new line numbers, binary/rename metadata, sensitive-path exclusion markers, empty diff, malformed input, truncation, and the 2 MiB response cap. The parser returns text fields only; it never emits HTML.

- [ ] **Step 3: Run evidence RED**

Run:

```bash
pnpm vitest --run packages/application/test/evidenceService.test.ts apps/server/test/evidenceApi.integration.test.ts
```

Expected: FAIL because evidence service/routes and diff parser do not exist.

- [ ] **Step 4: Implement the exhaustive route matrix**

Register only:

```text
GET /api/v1/runs/:runId/events/:eventId/content
GET /api/v1/runs/:runId/events/:eventId/native
GET /api/v1/runs/:runId/events/:eventId/assessment-note
GET /api/v1/runs/:runId/git/diff
GET /api/v1/runs/:runId/git/status?phase=initial|final
GET /api/v1/runs/:runId/git/diff-check
GET /api/v1/runs/:runId/git/untracked
```

Do not register `/artifacts/:artifactId`. Resolve the authoritative artifact ID from canonical run/event references, enforce the spec’s role/kind/media/decoder/max matrix, then project a closed DTO.

- [ ] **Step 5: Run GREEN and sentinel scans**

Run the focused tests. Serialize all standard/metadata-only/strict responses and scan for unique raw prompt, message, command, output, diff, note, native, repository-path, database-path, artifact-path, source-ID, and key sentinels. Expected: only explicitly allowed already-redacted standard content appears.

- [ ] **Step 6: Verify and commit**

Run `pnpm typecheck`, `git diff --check`, and search the server routes to prove no generic artifact path exists. Commit:

```bash
git add packages/application/src/evidence packages/application/src/index.ts packages/application/test/evidenceService.test.ts apps/server/src/routes/evidence.ts apps/server/src/router.ts apps/server/test/evidenceApi.integration.test.ts
git commit -m "feat(api): add bound AgentLens evidence reads"
```

---

### Task 7.8: Make assessments shared and atomically conditional

**Files:**
- Create: `packages/application/src/assessmentService.ts`
- Create: `packages/application/test/assessmentService.test.ts`
- Create: `apps/server/src/routes/assessment.ts`
- Create: `apps/server/test/assessmentApi.integration.test.ts`
- Modify: `packages/storage/src/runRepository.ts:206-259,1450-1567`
- Modify: `packages/storage/test/runRepository.test.ts`
- Modify: `packages/application/src/index.ts`
- Modify: `apps/cli/src/commands/assess.ts:1-181`
- Modify: `apps/cli/test/assess.integration.test.ts`
- Modify: `apps/server/src/router.ts`

**Interfaces:**
- Consumes: existing artifact ordering/redaction, current assessment projection, and API `If-Match`.
- Produces:

```ts
export type AssessmentRevisionPrecondition =
  | Readonly<{ state: "unconditional" }>
  | Readonly<{
      state: "match";
      currentEventId: string | null;
    }>;

export interface UpdateAssessmentInput {
  readonly runId: string;
  readonly eventId: string;
  readonly receivedAt: string;
  readonly verdict: AssessmentVerdict;
  readonly taskCompleted?: TaskCompletion;
  readonly note?: AssessmentNoteRef;
  readonly expectedRevision: AssessmentRevisionPrecondition;
}

export class AssessmentConflictError extends Error {
  readonly current: CurrentAssessment;
}

export interface AssessmentService {
  assess(input: {
    readonly runId: string;
    readonly verdict: AssessmentVerdict;
    readonly taskCompleted: TaskCompletion;
    readonly note?: string;
    readonly expectedRevision: AssessmentRevisionPrecondition;
  }): Promise<ExplicitCurrentAssessment>;
}
```

- [ ] **Step 1: Write storage concurrency RED tests**

Open two writable connections. Read the same projected/current revision through each, then submit two distinct updates with the same `match` precondition. Assert exactly one commits and the loser throws `AssessmentConflictError`; count one new human event, one current row update, and one referenced note artifact.

Also assert conflict comparison occurs before artifact metadata, event insertion, and projection update inside the immediate transaction. A prewritten redacted note file may remain orphaned, but `artifacts` and `event_artifact_bindings` contain no row for it.

- [ ] **Step 2: Run storage RED**

Run:

```bash
pnpm vitest --run packages/storage/test/runRepository.test.ts
```

Expected: FAIL because `expectedRevision` and `AssessmentConflictError` do not exist.

- [ ] **Step 3: Implement atomic comparison**

Inside the existing immediate transaction, re-read `current_assessments`, derive current event ID or projected null, compare it to the precondition, and throw before `insertOrReuseAssessmentArtifact`, `insertEvent`, binding insertion, or current upsert. `unconditional` preserves explicit CLI behavior.

- [ ] **Step 4: Extract assessment application service with RED tests**

Port command validation, 16 KiB UTF-8 limit, unreviewed/uncertain rule, capture-policy handling, redaction, artifact creation, audits, and owner-only database cleanup from the CLI. Assert standard redacts before artifact write; metadata-only/strict never pass note bytes to redaction or storage.

Run:

```bash
pnpm vitest --run packages/application/test/assessmentService.test.ts
```

Expected first run: FAIL because the service is missing. Implement the service and make `runAssessCommand` a thin caller with `expectedRevision: { state: "unconditional" }`. Re-run application and CLI assessment tests; expected GREEN with unchanged CLI output.

- [ ] **Step 5: Write and implement HTTP assessment RED/GREEN**

Test missing `If-Match` → 428 `precondition_required`; malformed ETag → 400; stale ETag → 412 `assessment_conflict`; valid projected sentinel/current event ETag → one explicit human event and new ETag; ambiguous client retry is not automatic.

Use exact wire ETags:

```ts
const projectedAssessmentEtag = '"assessment:projected"';
const explicitAssessmentEtag = (eventId: string) =>
  `"assessment:${base64url(eventId)}"`;
```

The route parses the body with the strict assessment schema, passes the decoded revision to the shared service, and returns the current assessment DTO. Origin and bearer checks execute before body/application work.

- [ ] **Step 6: Run full assessment GREEN**

Run:

```bash
pnpm vitest --run packages/storage/test/runRepository.test.ts packages/application/test/assessmentService.test.ts apps/cli/test/assess.integration.test.ts apps/server/test/assessmentApi.integration.test.ts
```

Expected: all concurrency, provenance, note privacy, explicit-unreviewed, ETag, and CLI compatibility tests pass.

- [ ] **Step 7: Verify and commit**

Run `pnpm typecheck`, `git diff --check`, and inspect the transaction ordering. Commit:

```bash
git add packages/storage/src/runRepository.ts packages/storage/test/runRepository.test.ts packages/application/src/assessmentService.ts packages/application/src/index.ts packages/application/test/assessmentService.test.ts apps/cli/src/commands/assess.ts apps/cli/test/assess.integration.test.ts apps/server/src/routes/assessment.ts apps/server/src/router.ts apps/server/test/assessmentApi.integration.test.ts
git commit -m "feat(assessment): share atomic conditional updates"
```

---

### Task 7.9: Build the production web shell and evidence-dense run list

**Files:**
- Create: `apps/web/package.json`
- Create: `apps/web/tsconfig.json`
- Create: `apps/web/vite.config.ts`
- Create: `apps/web/index.html`
- Create: `apps/web/src/vite-env.d.ts`
- Create: `apps/web/src/bootstrap.tsx`
- Create: `apps/web/src/api/client.ts`
- Create: `apps/web/src/api/queryKeys.ts`
- Create: `apps/web/src/api/queries.ts`
- Create: `apps/web/src/app/App.tsx`
- Create: `apps/web/src/app/AppShell.tsx`
- Create: `apps/web/src/app/ErrorState.tsx`
- Create: `apps/web/src/runs/RunListPage.tsx`
- Create: `apps/web/src/runs/RunFilters.tsx`
- Create: `apps/web/src/runs/RunRow.tsx`
- Create: `apps/web/src/components/Availability.tsx`
- Create: `apps/web/src/components/ProvenanceMark.tsx`
- Create: `apps/web/src/components/StatusBadge.tsx`
- Create: `apps/web/src/styles/tokens.css`
- Create: `apps/web/src/styles/global.css`
- Create: `apps/web/src/styles/run-list.css`
- Create: `apps/web/test/setup.ts`
- Create: `apps/web/test/apiClient.test.ts`
- Create: `apps/web/test/runList.test.tsx`
- Create: `apps/web/test-support/fixtureDataRoot.ts`
- Create: `apps/web/test-support/startFixtureUi.ts`
- Modify: `apps/server/src/staticAssets.ts`
- Modify: `package.json`
- Modify: `tsconfig.json`
- Modify: `vitest.workspace.ts`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: authenticated bootstrap token, run-list API schemas, and hashed Vite manifest assets.
- Produces:

```ts
export interface AgentLensApiClient {
  listRuns(query: RunListQueryV1, signal?: AbortSignal): Promise<RunListPageV1>;
  getRun(runId: string, signal?: AbortSignal): Promise<RunDetailV1>;
  getEvents(
    runId: string,
    query: EventPageQueryV1,
    signal?: AbortSignal
  ): Promise<TrajectoryPageV1>;
  getEvent(runId: string, eventId: string, signal?: AbortSignal): Promise<EventDetailV1>;
}

export function createAgentLensApiClient(input: {
  readonly origin: string;
  readonly bearerToken: string;
  readonly fetchImpl?: typeof fetch;
}): AgentLensApiClient;

export function boot(bearerToken: string | null): void;
```

- [ ] **Step 1: Add the web workspace and local assets**

Add React/Vite/test dependencies to `@agentlens/web` and Playwright at the root. Use locally bundled imports:

```ts
import "@fontsource/geist-sans/400.css";
import "@fontsource/geist-sans/500.css";
import "@fontsource/geist-sans/600.css";
import "@fontsource-variable/geist-mono/wght.css";
```

Configure Vite with `manifest: true`, a stable entry at `src/bootstrap.tsx`, no source maps, and `outDir: ../server/dist/web`. Add root scripts:

```json
{
  "build": "tsc -b --pretty false && pnpm --filter @agentlens/web build",
  "build:web": "pnpm --filter @agentlens/web build",
  "test:e2e": "playwright test --config apps/web/playwright.config.ts"
}
```

Update the Vitest workspace so Node tests remain in Node and `apps/web/test/**/*.test.tsx` uses jsdom.

- [ ] **Step 2: Write authenticated-client RED tests**

Inject a fake fetch and assert bearer headers, same-origin URL construction, abort forwarding, non-JSON/error handling, and Zod validation. The token must exist only in the returned closure:

```ts
const client = createAgentLensApiClient({
  origin: "http://127.0.0.1:43123",
  bearerToken: "fixture-bearer",
  fetchImpl
});
await client.listRuns({ limit: 50 });
expect(fetchImpl).toHaveBeenCalledWith(
  "http://127.0.0.1:43123/api/v1/runs?limit=50",
  expect.objectContaining({
    headers: expect.objectContaining({ Authorization: "Bearer fixture-bearer" })
  })
);
expect(JSON.stringify(client)).not.toContain("fixture-bearer");
```

- [ ] **Step 3: Write run-list RED component tests**

Render projected, explicit-review, detected-test-history, capture-unavailable, HEAD-change, branch-change, untracked-metadata, recorder-error, and unsupported-status fixtures. Assert exact evidence language and keyboard-accessible filter URLs. Negative assertions include no `tests passed`, `run successful`, `agent changes`, or unavailable-as-zero copy.

- [ ] **Step 4: Run web RED**

Run:

```bash
pnpm vitest --run apps/web/test/apiClient.test.ts apps/web/test/runList.test.tsx
```

Expected: FAIL because the web package and components do not exist.

- [ ] **Step 5: Implement the smallest shell and run ledger**

When passed a bearer, `boot` constructs the API client and React Query client inside its lexical scope, then renders `/runs` and `/runs/:runId` routes. No provider token enters React context state that can serialize; expose only client methods. When passed `null` from a token-free direct-reload shell, it renders the intentional authentication-expired state and makes no API request.

Implement the compact instrument rail, local connection state, server-side URL-addressable status/repository/assessment filters, two-line 800-pixel run cards, availability components, and exhaustive status wrappers. Do not add KPI cards, search, fake navigation, settings, command palette, or recording controls.

- [ ] **Step 6: Run GREEN, build, and first real browser review**

Run focused tests and:

```bash
pnpm build
pnpm tsx apps/web/test-support/startFixtureUi.ts --no-open
```

Open the emitted one-use bootstrap URL in the real browser. Inspect `/runs` at 1440×1000, 1100×900, and 800×900. Check console, keyboard focus, semantic filters, evidence language, font loading, horizontal overflow, and loading/empty/error states. Save screenshots only in an OS temporary directory outside the repository. Correct visible hierarchy/spacing issues before continuing.

- [ ] **Step 7: Verify and commit**

Run focused web tests, `pnpm typecheck`, `pnpm build`, and `git diff --check`. Inspect the built manifest and confirm no external font/network URL or source map. Commit:

```bash
git add apps/web apps/server/src/staticAssets.ts package.json tsconfig.json vitest.workspace.ts pnpm-lock.yaml
git commit -m "feat(web): add production AgentLens run ledger"
```

---

### Task 7.10: Build the virtualized execution-spine trajectory

**Files:**
- Create: `apps/web/src/run-detail/RunDetailPage.tsx`
- Create: `apps/web/src/run-detail/RunHeader.tsx`
- Create: `apps/web/src/run-detail/RunWorkspace.tsx`
- Create: `apps/web/src/trajectory/types.ts`
- Create: `apps/web/src/trajectory/projectTrajectory.ts`
- Create: `apps/web/src/trajectory/mergePages.ts`
- Create: `apps/web/src/trajectory/useTrajectoryPages.ts`
- Create: `apps/web/src/trajectory/Trajectory.tsx`
- Create: `apps/web/src/trajectory/TrajectoryToolbar.tsx`
- Create: `apps/web/src/trajectory/TrajectoryRow.tsx`
- Create: `apps/web/src/trajectory/RelationshipOverlay.tsx`
- Create: `apps/web/src/styles/trajectory.css`
- Create: `apps/web/test/projectTrajectory.test.ts`
- Create: `apps/web/test/mergePages.test.ts`
- Create: `apps/web/test/trajectory.test.tsx`
- Modify: `apps/web/src/app/App.tsx`

**Interfaces:**
- Consumes: `TrajectoryEventV1`, page/window DTOs, jump anchors, React Query, and `?event=<eventId>` route selection.
- Produces:

```ts
export type TrajectoryLayoutRow =
  | Readonly<{
      type: "event";
      key: string;
      event: TrajectoryEventV1;
    }>
  | Readonly<{
      type: "lifecycle_group";
      key: string;
      events: readonly [TrajectoryEventV1, ...TrajectoryEventV1[]];
      expanded: boolean;
    }>;

export function projectTrajectory(input: {
  readonly events: readonly TrajectoryEventV1[];
  readonly expandedGroupKeys: ReadonlySet<string>;
}): readonly TrajectoryLayoutRow[];

export function mergeTrajectoryPages(
  pages: readonly TrajectoryPageV1[]
): readonly TrajectoryEventV1[];
```

- [ ] **Step 1: Write pure projection RED tests**

Assert canonical sequence sorting is validation, not reordering: contradictory input fails. Group only adjacent events with the same opaque lifecycle key; a same-key event separated by another event remains separate. Expanding restores each immutable source event in sequence. Recorder recovery remains its own row. Unknown kinds remain inspectable.

```ts
expect(projectTrajectory({
  events: [startA, unrelated, terminalA],
  expandedGroupKeys: new Set()
}).map((row) => row.type)).toEqual(["event", "event", "event"]);
```

- [ ] **Step 2: Write page-merge and deep-link RED tests**

Cover head/tail/after/around/cursor windows, prepend/append, exact `(eventId, sequence)` deduplication, contradictory duplicates, empty pages, and a selected event outside loaded windows. Assert resolving the selected event triggers `aroundSequence` and preserves the scroll anchor.

- [ ] **Step 3: Write virtualized interaction RED tests**

Use 10, 50, 250, and 1,000-event fixtures. Assert the DOM contains only the viewport plus bounded overscan, one roving tab stop, arrow keys act only while trajectory focus is inside, Enter/Space selects, Escape closes deep evidence, and relationship jumps select/load their event without rendering a global graph.

- [ ] **Step 4: Run trajectory RED**

Run:

```bash
pnpm vitest --run apps/web/test/projectTrajectory.test.ts apps/web/test/mergePages.test.ts apps/web/test/trajectory.test.tsx
```

Expected: FAIL because the trajectory model and components do not exist.

- [ ] **Step 5: Implement the execution spine**

Use TanStack Virtual with variable measured rows and limited overscan. Render one vertical spine plus provenance gutter, shape/icon/label markers, status glyph/text, safe summary, recorder/source time availability, and selection emphasis. Draw connectors only for selected visible AgentLens relationships; off-screen relationships are buttons/jump links.

Keep event DTO → pure projection → rendered row boundaries explicit. Do not embed linear layout assumptions in the API data types.

- [ ] **Step 6: Run GREEN and real-browser trajectory review**

Run focused tests and build. Start the fixture UI and inspect run detail at 1440 and 1100 with 10-, 250-, and 1,000-event runs. Verify scrolling remains smooth, rows do not replay entry motion after remount, selected event remains visible, provenance is understandable in grayscale, and relationship lines do not intercept clicks.

- [ ] **Step 7: Verify and commit**

Run focused tests, `pnpm typecheck`, `pnpm build`, and `git diff --check`. Commit:

```bash
git add apps/web/src/run-detail apps/web/src/trajectory apps/web/src/styles/trajectory.css apps/web/src/app/App.tsx apps/web/test/projectTrajectory.test.ts apps/web/test/mergePages.test.ts apps/web/test/trajectory.test.tsx
git commit -m "feat(web): add virtualized execution trajectory"
```

---

### Task 7.11: Add the event inspector and final Git evidence experience

**Files:**
- Create: `apps/web/src/run-detail/EventInspector.tsx`
- Create: `apps/web/src/run-detail/InspectorTabs.tsx`
- Create: `apps/web/src/run-detail/DeepEvidencePanel.tsx`
- Create: `apps/web/src/evidence/AvailabilityNotice.tsx`
- Create: `apps/web/src/evidence/CommandEvidence.tsx`
- Create: `apps/web/src/evidence/TextEvidence.tsx`
- Create: `apps/web/src/evidence/NativeEvidence.tsx`
- Create: `apps/web/src/evidence/GitEvidenceSummary.tsx`
- Create: `apps/web/src/evidence/GitDiffViewer.tsx`
- Create: `apps/web/src/evidence/GitStatusView.tsx`
- Create: `apps/web/src/evidence/UntrackedMetadataView.tsx`
- Create: `apps/web/src/api/evidenceQueries.ts`
- Create: `apps/web/src/styles/evidence.css`
- Create: `apps/web/test/eventInspector.test.tsx`
- Create: `apps/web/test/gitDiffViewer.test.tsx`
- Modify: `apps/web/src/run-detail/RunWorkspace.tsx`

**Interfaces:**
- Consumes: selected event detail, explicit content/native/evidence endpoints, final Git availability, and event relationships.
- Produces a desktop sticky inspector, a narrow inline inspector slot, and an on-demand spanning deep-evidence panel.

- [ ] **Step 1: Write lazy-fetch RED tests**

Assert selecting a row fetches event detail only. Normalized content, native payload, command output, assessment note, and Git artifacts are not requested until their explicit expand/open controls are activated. Assert provider-payload tab appears only when eligible and never for derived/Git/recorder/human events.

- [ ] **Step 2: Write evidence-state RED tests**

Cover available, capture-policy omitted, provider unavailable, not captured, not yet available, truncated, corrupt, unreadable, and unknown-kind states. Assert no state renders blank or zero. Commands show exact lifecycle, exit code availability, redacted command/output, and truncation without a terminal emulator.

- [ ] **Step 3: Write diff-view RED tests**

Render structured multi-file/hunk DTOs and assert file grouping, collapsed files, hunk headers, old/new line numbers, add/delete/context text labels, horizontal code scrolling, sensitive-path exclusion blocks, binary metadata, empty diff, and corrupt/unavailable messages. Ensure diff text is rendered as text nodes, never `dangerouslySetInnerHTML`.

- [ ] **Step 4: Run inspector RED**

Run:

```bash
pnpm vitest --run apps/web/test/eventInspector.test.tsx apps/web/test/gitDiffViewer.test.tsx
```

Expected: FAIL because inspector/evidence components are missing.

- [ ] **Step 5: Implement bounded evidence views**

Keep content blocks selectable, copy-friendly, monospace, horizontally scrollable, and height-bounded. Label raw provider evidence as redacted provider payload, not canonical truth. Show exact provider-source fields only when the native response includes response-redacted values. Label Git consistently as “Final Git evidence” and never “agent changes.”

- [ ] **Step 6: Run GREEN and browser review**

Inspect selected failure, recorder recovery, derived test result, unknown event, command output, native payload, final Git evidence, omitted diff, and 2 MiB long diff at 1440, 1100, and 800. At 800, quick evidence and deep panel must follow the selected row, not the entire trace. Verify no page-level horizontal overflow.

- [ ] **Step 7: Verify and commit**

Run focused tests, `pnpm typecheck`, `pnpm build`, and `git diff --check`. Search for `dangerouslySetInnerHTML`, generic artifact URLs, and eager evidence queries; none may remain. Commit:

```bash
git add apps/web/src/run-detail apps/web/src/evidence apps/web/src/api/evidenceQueries.ts apps/web/src/styles/evidence.css apps/web/test/eventInspector.test.tsx apps/web/test/gitDiffViewer.test.tsx
git commit -m "feat(web): add bounded evidence inspection"
```

---

### Task 7.12: Add compact human assessment UX with conflict handling

**Files:**
- Create: `apps/web/src/assessment/AssessmentSummary.tsx`
- Create: `apps/web/src/assessment/AssessmentEditor.tsx`
- Create: `apps/web/src/assessment/useAssessmentMutation.ts`
- Create: `apps/web/src/styles/assessment.css`
- Create: `apps/web/test/assessment.test.tsx`
- Modify: `apps/web/src/api/client.ts`
- Modify: `apps/web/src/run-detail/RunHeader.tsx`
- Modify: `apps/web/src/run-detail/EventInspector.tsx`

**Interfaces:**
- Consumes: run-detail assessment DTO + ETag and `PUT /api/v1/runs/:runId/assessment`.
- Produces:

```ts
export interface AssessmentDraft {
  readonly verdict: "unreviewed" | "success" | "partial" | "failure";
  readonly taskCompleted: "yes" | "no" | "uncertain";
  readonly note: string;
}

export interface AssessmentMutationInput {
  readonly runId: string;
  readonly etag: string;
  readonly draft: AssessmentDraft;
}
```

- [ ] **Step 1: Write provenance and form RED tests**

Assert projected state renders exactly “Not reviewed · projected state · no human evidence” and creates no human trajectory node. Explicit unreviewed renders timestamped human evidence. Validate verdict values, task completion, unreviewed→uncertain rule, and 16 KiB UTF-8 note limit client-side while retaining server authority.

- [ ] **Step 2: Write mutation/conflict RED tests**

Assert the client sends the current ETag in `If-Match`, never auto-retries, replaces cached assessment/run/trajectory only after a confirmed response, and displays stale conflicts with a “Review latest assessment” action. An ambiguous network failure must not claim the assessment saved.

- [ ] **Step 3: Run assessment RED**

Run:

```bash
pnpm vitest --run apps/web/test/assessment.test.tsx
```

Expected: FAIL because assessment components/mutation are missing.

- [ ] **Step 4: Implement the compact editor**

Use labeled segmented controls or radio groups for verdict and completion, a bounded optional textarea, associated errors, and explicit save/cancel actions. Preserve valid disagreement naturally:

```text
Latest likely test: passed
Reviewer: partial
```

After success, show the returned human event and retrieve its note only through the event-scoped note route.

- [ ] **Step 5: Run GREEN and browser review**

Test projected, explicit, success, partial, failure, explicit unreviewed, omitted note, stale ETag, and network failure. In the real browser, complete a valid assessment and verify one human trajectory event appears; then create a competing update and verify conflict UI does not overwrite it.

- [ ] **Step 6: Verify and commit**

Run focused web and server assessment tests, `pnpm typecheck`, `pnpm build`, and `git diff --check`. Commit:

```bash
git add apps/web/src/assessment apps/web/src/styles/assessment.css apps/web/test/assessment.test.tsx apps/web/src/api/client.ts apps/web/src/run-detail/RunHeader.tsx apps/web/src/run-detail/EventInspector.tsx
git commit -m "feat(web): add human assessment workflow"
```

---

### Task 7.13: Finish active polling, motion, responsiveness, and accessibility

**Files:**
- Create: `apps/web/src/run-detail/useActiveRunPolling.ts`
- Create: `apps/web/src/trajectory/useFollowTail.ts`
- Create: `apps/web/src/motion/motionPolicy.ts`
- Create: `apps/web/src/styles/responsive.css`
- Create: `apps/web/test/activePolling.test.tsx`
- Create: `apps/web/test/accessibility.test.tsx`
- Modify: `apps/web/src/run-detail/RunDetailPage.tsx`
- Modify: `apps/web/src/run-detail/RunWorkspace.tsx`
- Modify: `apps/web/src/trajectory/Trajectory.tsx`
- Modify: `apps/web/src/trajectory/TrajectoryRow.tsx`
- Modify: `apps/web/src/styles/global.css`
- Modify: `apps/web/src/styles/trajectory.css`
- Modify: `apps/web/src/styles/evidence.css`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: active lifecycle, tail/after event modes, current selection, virtual scroll state, and reduced-motion preference.
- Produces controlled one-second polling, unobtrusive new-event counts, follow-tail behavior, responsive inspector placement, and accessible motion/focus semantics.

- [ ] **Step 1: Write active-run RED tests with fake timers**

Cover starting/running polling every ~1 second, terminal stop, zero-event repeated tail request, switch to `afterSequence` after the first real event, temporary retryable 503 retaining old data, selection preservation, no forced scroll while inspecting history, and `N new events` jump control.

```ts
expect(requests).toEqual([
  { mode: "tail" },
  { mode: "tail" },
  { afterSequence: 4 },
  { afterSequence: 7 }
]);
```

- [ ] **Step 2: Write accessibility/motion RED tests**

Run automated axe assertions on run list, run detail, trajectory, inspector, diff, and assessment fixtures. Assert semantic headings/navigation/list/table/form roles, visible focus classes, non-color provenance/status text, `aria-selected`/`aria-expanded`, live region only for new-event count, reduced-motion disabling spatial transitions, and selection surviving responsive reflow.

- [ ] **Step 3: Run RED**

Run:

```bash
pnpm vitest --run apps/web/test/activePolling.test.tsx apps/web/test/accessibility.test.tsx
```

Expected: FAIL because polling, follow-tail, motion policy, and final responsive behavior are missing.

- [ ] **Step 4: Implement state-explanatory Motion**

Use Motion for React only for 120–180 ms selection/focus, 140–220 ms inspector transitions, measured lifecycle expansion, restrained panels/diffs, and immediate shared run identity. Do not add looping glow, bounce, particles, full-screen ignition, or remount entry animation. Under `prefers-reduced-motion`, use immediate layout/state changes.

- [ ] **Step 5: Implement the three frozen layouts**

- 1440: full ledger, compact rail, trajectory plus 340–420 px inspector, spanning evidence.
- 1100: wrapped header facts, ~340 px inspector, primary trajectory.
- 800: collapsed rail, wrapped filters, two-line run cards, full-width trajectory, inline selected quick evidence and immediate deep evidence, horizontally scrolling diff lines without page overflow.

No essential provenance, status, likely-test, assessment, Git, or availability fact disappears at 800.

- [ ] **Step 6: Run GREEN and real-browser accessibility review**

Run focused tests/build. Inspect active append, stopped polling, keyboard-only selection/expansion, focus rings, reduced motion, grayscale comprehension, diff scrolling, and assessment at 1440×1000, 1100×900, and 800×900. Check console and horizontal overflow after each state.

- [ ] **Step 7: Verify and commit**

Run focused tests, `pnpm typecheck`, `pnpm build`, and `git diff --check`. Commit:

```bash
git add apps/web/src/run-detail apps/web/src/trajectory apps/web/src/motion apps/web/src/styles apps/web/test/activePolling.test.tsx apps/web/test/accessibility.test.tsx apps/web/package.json pnpm-lock.yaml
git commit -m "feat(web): polish live accessible trajectories"
```

---

### Task 7.14: Complete privacy, packaging, Playwright, and release validation

**Files:**
- Create: `apps/web/playwright.config.ts`
- Create: `apps/web/e2e/run-list.spec.ts`
- Create: `apps/web/e2e/trajectory.spec.ts`
- Create: `apps/web/e2e/evidence.spec.ts`
- Create: `apps/web/e2e/assessment.spec.ts`
- Create: `apps/web/e2e/active-run.spec.ts`
- Create: `apps/web/e2e/privacy.spec.ts`
- Create: `apps/web/e2e/accessibility.spec.ts`
- Create: `apps/web/e2e/fixtures.ts`
- Create: `docs/verification/2026-08-30-agentlens-task-7.md`
- Modify: `apps/cli/test/packagedBinary.integration.test.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**
- Consumes: the complete Task 7 local product.
- Produces: repeatable full-workflow evidence and a verification record; no new product behavior.

- [ ] **Step 1: Build sanitized deterministic browser fixtures**

Use public storage/application APIs to create clean temporary data roots for:

- empty root;
- projected and explicit assessments;
- completed, failed, interrupted, recorder-error, starting, and running runs;
- command failure → file change → later command pass → derived latest passed with one previous failure;
- recorder recovery with unchanged original observed start;
- HEAD/branch change plus tracked diff and untracked metadata;
- metadata-only and strict omissions;
- unknown event kind/unsupported status;
- 10, 50, 250, and 1,000-event trajectories;
- long output and a multi-file near-limit diff.

All committed fixture strings are synthetic and path-neutral. Temporary databases/artifacts stay outside the repository.

- [ ] **Step 2: Write Playwright RED journeys**

Cover:

```text
launch agentlens ui --no-open
consume one-use bootstrap
filter/open a run
jump to first failure
inspect failure and recovery
load normalized/native evidence explicitly
open final Git diff
submit human assessment
observe one human event
reload and observe intentional authentication-expired state
```

Add separate 1,000-event multi-page scrolling/jump/selection, active append without forced tail, 800-pixel inline inspector, and keyboard/reduced-motion journeys. Assert no browser console errors, failed asset requests, external network requests, or page-level horizontal overflow.

- [ ] **Step 3: Run Playwright RED**

Run:

```bash
pnpm build
pnpm test:e2e
```

Expected initial failures identify missing fixture lifecycle/configuration or integration defects. Use `superpowers:systematic-debugging`; do not weaken assertions or add sleeps. Use locator/state waits and bounded polling.

- [ ] **Step 4: Add whole-root and HTTP privacy scans**

For standard, metadata-only, and strict fixtures, place unique sentinels in prompt, message, command, output, diff, note, native field, raw provider source ID, database path, artifact path, and repository path candidates. After UI reads/writes, scan every byte in the data root and every captured HTTP body/header/log.

Expected:

- metadata-only and strict content sentinels never appear in durable storage or HTTP;
- standard raw secret tokens never appear; only stable HMAC markers may appear where policy permits;
- source IDs/paths/keys never appear in ordinary DTOs;
- response-redacted native source fields appear only after explicit eligible native expansion;
- bearer/bootstrap secrets never appear in logs, static assets, history, persistent browser storage, screenshots, or error bodies.

- [ ] **Step 5: Verify packaged development and compiled invocations**

Extend packaged tests to run a production build, start both:

```bash
pnpm agentlens ui --data-root FIXTURE_ROOT --no-open
node apps/cli/dist/main.js ui --data-root FIXTURE_ROOT --no-open
```

Consume each printed bootstrap URL, verify hashed assets/API/run list, then send SIGTERM and assert conventional shutdown. Test a fresh offline install with the built server/web assets and no source-module resolution.

- [ ] **Step 6: Perform final real-browser visual review**

Capture and inspect temporary screenshots for run list, short trajectory, 1,000-event trajectory, selected failed command, recorder recovery, final Git diff, assessment, empty/degraded state, active append, and 800-pixel inline inspector at 1440, 1100, and 800 widths. Correct hierarchy, spacing, typography, clipping, focus, and motion defects through focused RED/GREEN tests.

- [ ] **Step 7: Run the complete fresh verification matrix**

Run exactly:

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm test:e2e
git diff --check
git status --short
```

Record exact exit codes, test counts, browser projects/viewports, privacy-scan result, active-WAL snapshot result, and packaged invocation result in `docs/verification/2026-08-30-agentlens-task-7.md`.

- [ ] **Step 8: Request independent adversarial code review**

Use `superpowers:requesting-code-review`. Require the reviewer to challenge:

- evidence overstatement and provenance flattening;
- closed DTO leakage and native/source/path exposure;
- auth/bootstrap/history/storage/log token handling;
- read-route mutation and active-WAL physical behavior;
- evidence role/binding/integrity enforcement;
- atomic ETag assessment ordering;
- pagination, empty windows, long-trace virtualization, and active append;
- responsive/accessibility/motion quality;
- prototype or roadmap scope leakage.

Resolve every Critical and Important finding with focused RED/GREEN evidence. Re-run the full matrix after the last correction.

- [ ] **Step 9: Commit verification artifacts only after final GREEN**

Review staged paths and preserve untracked prototype files. Commit:

```bash
git add apps/web/e2e apps/web/playwright.config.ts apps/cli/test/packagedBinary.integration.test.ts docs/verification/2026-08-30-agentlens-task-7.md package.json pnpm-lock.yaml
git commit -m "test: validate AgentLens Task 7 end to end"
```

## Final Acceptance Checklist

- [ ] `pnpm agentlens ui` and packaged `agentlens ui` start the loopback-only product with a one-use bootstrap.
- [ ] Run list and run detail use provider-neutral Task 6 semantics without importing CLI formatters or storage records into HTTP/React.
- [ ] `runs` and `inspect` remain immutable/no-WAL and non-mutating.
- [ ] Active-WAL reads pass the exact physical filesystem/SQLite gate or implementation has stopped for amendment.
- [ ] Unknown event kinds and unsupported future statuses remain inspectable without generic content leakage or crashes.
- [ ] Trajectory preserves canonical sequence and immutable events; only contiguous exact lifecycle siblings compact.
- [ ] 1,000-event multi-page trace remains virtualized, navigable, and selection/scroll stable.
- [ ] Failure, later activity, derived likely-test result, recorder recovery, and human assessment remain separate evidence.
- [ ] Final Git evidence exposes tracked diff plus untracked metadata with no authorship claim.
- [ ] Every content route is explicit, role-bound, integrity-checked, capture-policy checked, decoder-bounded, and size-bounded; no generic artifact route exists.
- [ ] Assessment comparison is atomic and stale writes append no human event or database artifact reference.
- [ ] Projected unreviewed creates no human event; explicit unreviewed creates one genuine timestamped human event.
- [ ] Metadata-only and strict contain no omitted content bytes in storage or HTTP; standard content remains redacted.
- [ ] Bearer/bootstrap secrets never reach logs, history, persistent browser state, static assets, screenshots, or error bodies.
- [ ] Direct reloads contain no token, make no API request, and render the intentional authentication-expired state.
- [ ] A maximum-size run-list page uses one page query and one batched summary-evidence query, never one full-detail query per row.
- [ ] 1440, 1100, and 800 layouts retain all essential evidence without page-level horizontal overflow.
- [ ] Keyboard, focus, non-color semantics, reduced motion, and automated accessibility checks pass.
- [ ] No prototype runtime import, generated prototype output, Claude/AGY/comparison/Insights/hosted/export/LLM/grading/WebSocket/SSE scope enters production.
- [ ] Complete unit, integration, typecheck, production build, Playwright, privacy, packaged-binary, and independent-review evidence is fresh and recorded.

## Specification Coverage Map

- Sections 1–5 and 26–29: frozen scope, validated foundation, prototype separation, risks, decisions, and stop rules are enforced by Global Constraints, Task 7.1, Task 7.14, and the Execution Stop Rule.
- Sections 6–8 and 19–24: shell, run ledger, run detail, visual system, motion, responsive behavior, accessibility, degraded states, and performance are implemented and verified by Tasks 7.9–7.14.
- Sections 9–11: immutable trajectory projection, inspector behavior, explicit evidence loading, and Final Git evidence are implemented by Tasks 7.6–7.7 and 7.10–7.11.
- Section 12: projected versus explicit human provenance, note policy, and atomic ETag assessment writes are implemented by Task 7.8 and surfaced by Task 7.12.
- Sections 13–15: package boundaries, closed schemas, authenticated cursors/source references, and every versioned API endpoint are implemented by Tasks 7.2–7.8.
- Sections 16–18: immutable CLI reads, the narrow active-WAL gate, active polling, loopback authentication, one-use bootstrap, and token-free reload behavior are implemented by Tasks 7.1, 7.5–7.6, 7.9, and 7.13.
- Section 25: unit, integration, privacy, packaged-binary, browser, accessibility, visual, and independent adversarial verification is completed by every task's RED/GREEN gate and Task 7.14's fresh matrix.

## Execution Stop Rule

Creating this plan does not authorize implementation. After this plan is approved, execute it in an isolated worktree with either subagent-driven development or the executing-plans workflow. Each task is separately reviewed and committed. Do not skip Task 7.1 or continue past its failed gate.
