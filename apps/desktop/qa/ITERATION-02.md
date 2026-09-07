# Prototype 02 verification — September 6, 2026

This report covers the new setup → live run → configuration-derived result journey. Prototype 01's separate report remains historical evidence for its original features.

## Build and model checks

- `pnpm test`: 8 tests pass, covering frozen configuration, invalid selections, cancellation against late ticks, interruption/resume, reload validation, selected-check/model mapping, excluded failures, and terminal-state persistence. The initial test-first implementation produced eight failures before the state model was completed.
- `pnpm build`: TypeScript and production build pass. Final JavaScript bundle: approximately 482.9 kB before gzip; no build warning was emitted.
- Final built browser preview produced no captured warning/error entries during this acceptance pass.

## Browser checks directly observed

- New comparison opens a three-step setup; all three cases are selectable. Arrow keys move the custom radio selection and keyboard focus.
- Removing all success conditions prevents continuation and displays an actionable error. Selecting one condition permits continuation.
- Choosing the same model for both roles prevents continuation. Swapping roles and changing the shared timeout are reflected in review and in the completed comparison's setup dialog.
- A completed one-condition comparison with Model B as baseline and Model A as candidate retains the correct evidence and full sample-attempt timings. Excluding the expired-session condition produces matching check results and removes the original failure headline.
- Model B's selected check opens the Model B output in the evidence drawer after roles are swapped.
- Playback continues while the viewer navigates to Tasks. The sidebar returns to the current comparison.
- Simulated interruption preserves progress. Resuming and immediately reloading restores an interrupted record with an explicit reload explanation. Playback resumes only through the Resume demo action.
- A running demo can be stopped through a confirmation dialog. Reload preserves its stopped status and recorded progress. Review setup restores the stopped run's case and selected conditions.
- The interrupted state exposes Stop comparison and a Back to comparison action in its dialog. Native confirmation of this path is recorded below.
- The oversized-event example completes playback but preserves an unknown check and unavailable elapsed time in its result. The final build also shows Partial evidence and a missing-result message in the ready-to-review live screen.
- Cmd+K opens action search. Searching for Start a new comparison and pressing Enter opens setup.
- Final built-preview reload retains the completed run and its results.

## Native desktop checks

- Reloaded the existing Electron window from bundled local files; Prototype 02 and the new comparison entry point appeared.
- Completed all three setup screens and started live playback in the native window.
- Used Preview an interruption, then stopped the interrupted demo through its dialog. Directly observed the stopped state and retained progress afterward.
- Review setup returned to the same sample case. Left the native app on setup for user exploration.
- Screenshots captured the native setup, live attempt and stopped state. This is a local macOS smoke check, not installer or cross-platform release validation.

## Visual checks

- Inspected setup and run/result layouts at 1440 × 900.
- Inspected model setup at 900 × 800 and recovery at 820 × 800. The latter uses collapsed navigation. Longer narrow views scroll vertically.
- Measured no document or main-content horizontal overflow at the checked sizes.
- Tightened first-screen vertical spacing after observing the main action at the bottom edge. The revised first screen exposes the footer action at the full desktop size.
- Checked native typography, action hierarchy, model role marks, restrained stage animation and progress indicators.
- Temporary browser viewport override reset before handoff.

## Selected artifacts

- `native-setup-02.jpg`: native first setup screen.
- `native-live-02.jpg`: native baseline in progress.
- `native-stopped-02.jpg`: native cancellation after interruption.
- `setup-case-1440.jpg`, `setup-models-1440.jpg`, `setup-review-1440.jpg`: three setup stages.
- `setup-models-900.jpg`, `run-recovered-820.jpg`: narrower layouts.
- `result-selected-1440.jpg`: one selected condition and swapped model roles.
- `run-ready-missing-1440.jpg`: completed playback with partial evidence.

## Boundaries

All runs, outputs, models, timings, revisions and repositories are fictional sample data. No real evaluations, AI judges, provider calls, repository modifications, charges or production integration occurred. The timeout is recorded configuration only. Browser and Electron store separate local state. Only the latest demo run is retained, and unsent setup drafts are not restored on reload. Saved cases remain the earlier prototype feature: edited case definitions do not launch real evaluations. Existing task-library and activity entries remain fixed examples rather than a growing run history.

These are focused model tests and observed UI smoke checks, not a full production accessibility audit, failure-injection campaign, packaging test or proof of provider recovery semantics. The real-data integration contract is proposed in `docs/comparison-data-contract.md`.
