# Live split workspace implementation plan

**Goal:** Deliver the approved recorder-backed split workspace and verify its lifecycle with deterministic local agents.

**Architecture:** A desktop-owned controller creates matched worktrees and launches separate recorder workers. Workers publish only persisted redacted activity and saved run projections. React polls snapshots and renders independent lanes; a completed pair can be opened in the existing insight workflow.

**Tech stack:** Electron, React/TypeScript, motion, Node child processes, Git, existing AgentLens recorder/storage/projectors.

**Spec:** `docs/superpowers/specs/2026-09-15-live-workspace-design.md`.

## Constraints

Preserve all existing changes and credentials. No paid model calls, pushes, publishes, merges, or destructive cleanup. No simulated terminal interactivity. Implement in this task; use independent review for bounded review gates.

## Stage 1: Durable controller and recorder worker

- [x] Add failing integration tests with real temporary Git repositories and fixture workers for matched revisions, input validation, duplicate starts, independent completion/cancellation, deadlines, and reopening.
- [x] Add `server/live/controller.mjs` for project validation, durable jobs, process ownership, bounded snapshots, cancellation, and recovery.
- [x] Add `server/live/worker.mjs` and `server/live/transport.mjs` for existing recorder invocation and projection. Extend the existing persistence callback with the already-redacted event, without changing recording semantics.
- [x] Add a fake `codex` executable fixture. Run actual record/inspect against it to prove event delivery and final evidence, including cancellation and failure. Do not invoke real models.

## Stage 2: Trusted desktop bridge and live UI

- [x] Add `electron/live-ipc.cjs`, narrow preload methods, and typed request/snapshot contracts. Validate local sender and selection capability before mutations.
- [x] Add `src/LiveWorkspace.tsx` and dedicated CSS, integrating setup into `OwnComparison` while preserving saved import access.
- [x] Preserve active work across navigation; show recent saved jobs, partial evidence, actionable errors, and explicit latest-activity controls.
- [x] Connect completed pairs to the existing selected comparison runtime with correct recording provenance and no invented independent checks.

## Stage 3: Verification and handoff

- [x] Run new controller/worker/IPC tests and existing desktop tests, affected CLI tests, typechecking, and both desktop/public-demo builds.
- [x] Obtain independent code review of lifecycle, data boundaries, and UI; fix material findings and add regressions.
- [x] Inspect native desktop setup and split workspaces with deterministic fixture runs, including keyboard navigation, scrolling, reduced motion/narrow layout, stop, failures, reopen, and comparison handoff.
- [x] Update the matrix with actual evidence and limitations. Leave a clear handoff and mark the goal complete only after the requested flow is proven.


## Verification checkpoint — 2026-09-15, 10:46 local

Implemented and regression-tested recovery of saved worker projections when the job journal lags, conservative cleanup uncertainty when a running worker has no final result, and durable manual cleanup acknowledgment. Acknowledgment never promotes a failed/interrupted attempt into a verified result. A failed acknowledgment save leaves the launch/quit gate closed.

Independent controller review reproduced a background-descendant hang with inherited stdout/stderr. Cleanup now begins on leader exit rather than waiting for pipe closure. The exact fixture regression completes without deadline cancellation. Reviewer independently reran this and three recovery/acknowledgment regressions successfully.

Current verification:
- Desktop suite: 239/239 passed (`/tmp/agentlens-live-desktop-tests.log`).
- Affected CLI processRunner and recordRun integration: 45/45 passed (`/tmp/agentlens-live-cli-tests.log`).
- Recorder/controller lifecycle: 22/22 passed (`/tmp/agentlens-live-lifecycle-tests.log`).
- Repository typecheck, desktop build, and public-demo build passed. `git diff --check` passed.
- All model execution used the local fixture executable; no paid provider requests.

Native Electron fixture acceptance, using `qa/live-workspace.cjs`:
- Reopened the earlier partial pair and retained its history.
- Chose the temporary clean Git project, entered one task, and started both fixture agents.
- Expanded Agent A's first command and tabbed into its full command. The visible focus ring and expanded text stayed in place while Agent B advanced from inspection 15 to 21. A showed New activity / Jump to latest.
- Reloaded during the run: same workspace UUID, advancing elapsed time/event count, no new launch.
- Both attempts completed with saved run IDs and recording directory paths visible.
- Reopened Electron and restored the completed workspace, then opened its comparison without running models again.
- Native comparison initially exposed hardcoded C01 metadata. Added a desktop-recorded provenance marker derived from the internal selection envelope, cleared it for imports, and corrected task/scope/evaluator/concurrency copy. Reverified YOUR TASK, the entered task, and independent correctness unknown in the native app.
- Native fixture workspace: `e125a2bf-50fd-4ddc-b432-387b70152810`; both final recorded IDs are in its saved job. QA data remains separate from normal app data.

Open at that checkpoint (subsequently closed; see final acceptance report):
- Finish native narrow-layout, reduced-motion, and graceful quit during an active run checks.
- Verify prerequisite failures and parent disconnect against explicit acceptance cases.
- Tighten damaged nested journal validation; current validation skips basic malformed jobs but does not yet validate every UI-facing event field.
- Complete independent review of the latest UI/provenance changes and address material findings.
- Update the requirement-by-requirement acceptance matrix with final evidence and leave the production desktop ready for the user.

### Review and recovery follow-up

- Independent UI review closed both additional provenance findings after fixes. Imported nested envelopes now stay imported on reopen even when unknown `source`/`comparison` fields were retained by the import parser. The exact exploit has a regression. Model source copy accurately describes requested launch settings, without claiming observed model verification.
- Damaged nested journal validation is now implemented. A regression covers invalid event kinds, null/non-string file lists, oversized previews, invalid counts/reasoning/project names/deadlines, and nonnumeric cleanup acknowledgments; damaged entries are excluded with recovery warnings while healthy history stays available.
- Controller suite after nested validation: 15/15 passed. The remaining native and prerequisite/disconnect acceptance checks above are still open; this checkpoint is not a completion claim.


## Final acceptance

All three stages are complete. See `apps/desktop/docs/live-workspace-acceptance.md` for the requirement-by-requirement matrix, native observations, repeatable commands, and limitations.

Final verification: 246 desktop tests passed; 45 affected CLI tests passed; repository typecheck, desktop build, and public-demo build passed; `git diff --check` passed. Native checks additionally covered motion-disabled/narrow layouts, quit during two active runs and reopen, a temporary snapshot outage with automatic reconnection, and independent stopping with outage controls available. A completed real fixture pair was accepted by the existing insight service as eligible with 24 evidence sources, two attempt-fact groups, and no invented independent checks. No provider calls were made.

Independent backend and UI reviews are closed after fixes and targeted reruns. The normal source-checkout Electron application is restored for handoff; fixture recordings remain separate. No changes were committed, merged, pushed, or published.
