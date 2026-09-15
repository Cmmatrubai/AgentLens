# Live split workspace — acceptance and handoff

Verified locally on macOS on 2026-09-15. This is the source-checkout desktop release, with real recorder workers and deterministic local fixture agents used for validation. No paid model execution, publication, push, or merge was performed.

## Try it

From the repository root:

```sh
pnpm --filter @agentlens/desktop desktop
```

Choose **Your comparison**, select a clean Git repository with at least one commit, enter one shared task, and choose two model IDs available to your Codex account. **Check setup** checks the local runtime and Codex login. Review the recording details and select **Start recorded comparison**.

Each agent receives its own detached working copy at the selected committed revision. Expand recorded actions to see output and changed paths. Opening details pauses following so new events cannot pull you away. **Jump to latest** resumes following. Each agent has its own Stop control. Once both finish, **Open comparison** opens the existing evidence and optional insight workflow.

Execution uses Codex CLI authentication. Optional AI insight analysis uses its separate compatible-endpoint/BYOK settings and consent flow. The recording checkbox authorizes real model usage when the normal app is used; fixture validation did not use those services.

## Acceptance evidence

| Requirement | Evidence and observed result |
| --- | --- |
| Choose project, task, two models; automatic recording | Native Electron picker and form started two actual recorder workers through `qa/live-workspace.cjs`, each using the fixture Codex executable. Persisted run IDs and captured final Git changes were inspected. |
| Same revision, isolated work | `live-controller.test.ts` verifies both detached working copies at the same commit, distinct paths, and unchanged source content/status. Both working copies are prepared before either runner starts. |
| Prerequisites | Actual subprocess probes in `live-worker.test.ts` distinguish missing Node/recorder runtime, missing Codex, old CLI flags, signed-out Codex, and successful setup. No model is executed by these probes. |
| Unsupported Git inputs | Real temporary repository tests reject missing directories, unborn repositories, bare repositories, dirty work, changed HEAD, and clean repositories containing submodules. |
| Input validation and duplicate starts | Controller tests reject invalid model types/arguments, blank/oversized tasks, absent acknowledgment, invalid deadlines, identical model/effort settings, concurrent starts, and startup during shutdown. |
| Live persisted evidence | Real worker test matches streamed event IDs to the saved recorder ledger, verifies redaction of a fake credential, and inspects final file changes. UI displays recorded actions, never private reasoning or estimated progress. |
| Stop independently and time out | Actual recorder stop test finalizes an interrupted result. Controller cancellation/deadline tests preserve the first stop reason. Native UI stopped A while B continued; partial output stayed available. |
| Failures and partial results | Fixture unavailable-model, worker crash, spawn error, malformed IPC, and one-sided failure tests preserve the other result and reject invalid comparison handoff. Native stopped pair reopens with both recordings preserved. |
| Process cleanup | Resistant-group, storage-failure, ignored-stdio descendant, and inherited-output-pipe descendant regressions pass. Cleanup starts at leader exit, before waiting on inherited pipe closure. Unknown cleanup remains a visible failure and blocks new starts until explicitly acknowledged. |
| Parent disconnect | An actual recorder worker loses its IPC connection, exits successfully after cancellation, saves an interrupted result, and leaves its fixture Codex PID gone. |
| App quit and reopening | Native quit during two active attempts produced stopped/interrupted saved outcomes for both. After restart, the same workspace UUID and partial events reappeared without another launch. |
| Abrupt interruption recovery | Journal-lag tests restore finalized worker projections. Missing final results for previously running/stopping attempts retain cleanup uncertainty. Acknowledgment is persisted before its live gate clears; failed acknowledgment writes cannot bypass the gate. |
| Damaged persistence | Nested journal validation rejects malformed activity fields/counts/timestamps/paths/settings without hiding healthy saved jobs. Storage fault injection cancels work and prevents claiming a saved comparison. |
| Navigation, reload, stale actions | Native reload retained the same running UUID and advancing counts. Navigation away/back and reopening restored saved work. A regression rejects an old job's stop request while a replacement pair remains running. |
| Temporary update outage | Native harness failed several snapshot reads while recorder workers continued. Last received activity stayed visible with a retry banner; updates resumed automatically on the same UUID. Stop controls remain available during read failures. |
| Excessive output and reading older events | Tests bound snapshots to 80 events, 30 file paths and 4,000-character preview fields, with truncation labels. A 190 kB fixture output is captured through the real recorder. Native command expansion and keyboard focus stayed fixed while the peer lane advanced. |
| Accessibility, motion, layout | Native Tab focus reached full command text with a visible focus ring. Interface motion was disabled in Preferences and retained across reopening. Narrow native window inspection showed readable stacked lanes and reachable lower controls. CSS also disables the recording pulse for system reduced-motion preference. |
| Comparison and insights | Native completed pairs opened the comparison with their own task, requested model settings, concurrent execution provenance, and no independent checks. A completed native fixture pair passed through `createInsightService.read`: eligible, 24 sources, facts for both attempts, state `not_analyzed`, zero provider calls. |
| Honest provenance | Live pairs no longer inherit the C01 demo's description, evaluator narrative, or sequential execution claims. Imported/nested-spoof regression tests prevent an imported bundle from becoming desktop-recorded provenance. Model labels identify requested launch settings, not independently verified model identity. |
| Trust boundary | IPC tests reject foreign frames before picker/controller access. The renderer supplies a selected-project capability, task, validated model settings, and deadline; it cannot supply an executable, arbitrary data root, or extra CLI flags. |
| Independent review | Separate backend and UI reviewers reproduced material findings, reviewed fixes, and reran targeted regressions. The final bounded backend review found no new material issue; UI provenance findings were independently closed. |

Native fixture data was kept outside normal app state. Representative workspace IDs: completed pair `e125a2bf-50fd-4ddc-b432-387b70152810`; quit/reopen pair `0f3be21a-f4fb-420f-abb0-e8541879618e`; reconnect pair `c73f8e4b-7d9f-44ea-bb72-e9f3ede94fa7`; stop-control regression `1bcd45fc-7520-442f-993c-edff67c97cbf`.

Final automated result: **246 desktop tests and 45 affected CLI tests passed**. Repository typecheck, both builds, and Git whitespace checks passed.

## Repeat verification

```sh
pnpm --filter @agentlens/desktop test
pnpm exec vitest run apps/cli/test/processRunner.test.ts apps/cli/test/recordRun.integration.test.ts
pnpm typecheck
pnpm --filter @agentlens/desktop build
pnpm --filter @agentlens/desktop build:demo
```

For native fixture-only testing, run `pnpm exec electron qa/live-workspace.cjs` from `apps/desktop`. Its temporary project is the picker's default. Optional `AGENTLENS_LIVE_QA_ROOT` reuses a previously created fixture root for reopen checks; `AGENTLENS_LIVE_QA_OUTAGE=1` injects a short snapshot outage. The harness uses temporary state and a local fixture executable and blocks browser HTTP(S). Its AI analysis panel is intentionally unavailable; the separate service acceptance described above verifies the real insight-input path.

## Limits and next priorities

- Real provider availability and account-specific model access were not exercised overnight. The first normal-user run may reveal authentication, model entitlement, or CLI-version issues; failures remain captured and actionable.
- This is a development checkout application. Node, workspace dependencies, Git, and compatible Codex CLI must be installed. A signed installer and bundled recorder runtime are the next distribution milestone.
- Execution currently supports Codex, clean committed repositories, and no submodules. It does not copy dependencies, ignored files, or uncommitted changes into working copies, or install environments automatically.
- There is no interactive terminal or follow-up messaging. The displayed process is recorded activity. Independent evaluation setup is a separate next milestone; agent completion and successful commands do not establish task correctness.
- A hard worker/app failure can leave process cleanup unconfirmed. The UI keeps that distinction and requires the user to check processes before acknowledging. Acknowledgment is a user assertion, never a retroactive success or verification claim. Recordings and working copies are retained; automatic cleanup is intentionally absent.
- OS-level force-kill or physical storage loss cannot guarantee complete final evidence. Interrupted/missing/corrupt evidence remains explicit. Cross-platform process-tree guarantees need separate validation before a Windows release.
- Form drafts are not persisted across leaving setup; started recordings are durable. Draft retention and an account-aware model picker are useful follow-up usability improvements.

Final handoff state: the normal Electron application was launched on **Your comparison**. Its actual **Check setup** action reported that the recorder and Codex are available. This was a local runtime/login check only; account-specific model execution was not attempted.

## Subsequent real-model validation — 2026-09-15

The later user-authorized real-work evaluation ran Sol high and Terra high through the normal desktop launcher. It found and fixed a symlinked writable-root defect, reran the comparison successfully, independently reviewed both implementations, and integrated session-only draft retention plus a calmer interface. See [the real-work evaluation](live-workspace-real-work.md) for actual run identities, original versus corrected outcomes, independent checks, design sources, and remaining environment limits. Earlier fixture-only results above remain historical evidence, not a description of all validation now performed.
