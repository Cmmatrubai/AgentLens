# Real-work validation and interface refinement — 2026-09-15

This evaluation runs the normal Electron application, native project picker, and live launcher against actual Codex models. It complements the deterministic recorder tests; neither test style establishes correctness by itself.

## Reproducible task

Both GPT Sol and GPT Terra, high reasoning, receive the same prompt: preserve unfinished comparison setup across route navigation, without retaining launch consent or project capabilities. The implementation must clear the draft after a successful launch, retain it after a failed launch, provide a Clear draft action, validate inputs, and include targeted tests.

The source is a clean local snapshot of current AgentLens source/configuration at `/Users/chaitanyamatrubai/AgentLens-live-evaluation`, commit `74a605b4`. It excludes private runtime state, recordings, historical QA artifacts, and design prototypes. Both agents get isolated worktrees at that commit. Existing installed dependencies are supplied read-only through local symlinks; this is a prepared developer environment, not installer validation. No implementation is accepted solely because an agent reports success.

## First run: launcher defect reproduced

Workspace: `ff8eacce-5164-4fc7-b474-79e5205d52a0`.

Both providers responded, but every command was rejected by Codex because the writable root contained the `.local` symlink. Both agents explicitly reported the blocker. Both worktrees remained unchanged and no tests ran. A completed recording therefore did not represent a completed implementation.

Fix: canonicalize the storage root with `realpath` after creating it and before deriving worktree/recording paths. The regression test launches against a symlinked storage directory and requires physical working-copy paths. It failed before the fix and passed afterward. All 18 controller tests passed. The test wait helper now waits for the controller's active-job gate to clear after journal finalization, avoiding a race between terminal display state and permission to start another comparison.

## Corrected run

Workspace: `687edb0d-61a3-45ae-a168-565cda1f96a6`.

The same prompt, models, settings, baseline, and ten-minute limit were launched through the native UI. Actual commands execute in both physical worktrees. Final implementation review and independent validation are recorded below when complete.

## Design decisions and sources

- [Linear's 2026 interface refresh](https://linear.app/now/behind-the-latest-design-refresh): predictable actions, restrained navigation, quieter separators, and less saturated surfaces. Applied through neutral lane panels, consistent action placement, and fewer competing treatments.
- [Apple layout guidance](https://developer.apple.com/design/human-interface-guidelines/layout): clear hierarchy and graceful adaptation. Applied through a compact workspace header and two lanes that stack in narrower windows.
- [Apple typography guidance](https://developer.apple.com/design/human-interface-guidelines/typography): readable type and preservation of hierarchy. Applied through larger activity text and secondary metadata that remains readable.

The setup screen now has one introduction. The task remains visible as an expandable summary; the full prompt is available without dominating the workspace. Agent colors are limited to identity accents. Recorded state remains text-labelled, independent of color. Full commands and captured output remain inspectable. Existing keyboard focus, stop controls, scroll-following, and reduced-motion support are retained.

## Observed results and independent review

Both corrected runs completed and produced changes to `LiveSetup.tsx`, a draft helper, and targeted tests. Sol took approximately 7:06 with 82 live activity records; Terra took approximately 5:45 with 52. These live-feed counts are a subset of each full recorder ledger, not token usage or cost. This is one controlled task, not evidence of a general performance ranking.

The agents' requested filtered pnpm typecheck was blocked by pnpm 11's external dependency-symlink guard. Direct compilation also exposed a test-preparation omission: the snapshot allowlist excluded `server/vite-recorded.d.mts`. These were evaluation-environment failures, not defects introduced by either model. Separate verification copies restored that original declaration and used the installed TypeScript executable directly. Neither original model worktree was altered for these checks.

Independent reruns:

| Variant | Targeted tests | TypeScript with complete declarations | Additional boundary probe |
| --- | --- | --- | --- |
| Sol high | 5 passed | Passed | Stripped unexpected nested model fields; accepted an oversized write |
| Terra high | 3 passed | Passed | Rejected oversized writes; preserved unexpected nested model fields |

The probe supplied a synthetic extra property on a model entry and separately an overlong task. This tests the storage boundary; it does not claim that normal UI input leaked a real credential. Test counts reflect differently grouped suites and are not a quality score.

Both variants used browser sessionStorage. The integrated implementation starts from Sol's explicit field projection, adds validation before writes, and replaces browser storage with module memory. It preserves drafts across route navigation but clears them on a fresh renderer/app session. Clear draft also resets launch acknowledgment. A successful launch clears both stored and visible draft state; rejected/failed launches preserve it. Regression tests cover these additional boundaries and were observed failing before the integration fixes.

The real recordings were opened through the normal Open comparison action. The comparison correctly reports independent correctness as unknown: the review-time checks above have not been imported as evaluator evidence into that recorded pair. No provider-generated insight report or independent check result was fabricated.

## Final checks

- Desktop suite: 255 tests passed, including the physical-path regression and seven draft tests.
- Root typecheck, desktop production build, public-demo build, and `git diff --check`: passed.
- Native real-run checks: renderer reload and navigation away/back preserve the same running workspace ID; narrow window stacks lanes; wider view restores the split; both recordings open in the comparison screen.
- Native integrated-form checks are listed in the final handoff below.

This validates source-checkout operation with the existing Codex account and prepared dependencies. It does not validate a packaged installer, automatic dependency preparation for arbitrary repositories, or every provider/model. The symlinked dependency workaround is specific to this evaluation and should not become the default tester experience.

### Native integrated-form handoff

Verified in the normal desktop after integration: entered a task and a custom model ID, selected launch acknowledgment, navigated to Start here and back. Task and model ID restored; acknowledgment was unchecked. Clear draft removed the task and restored Sol/Terra defaults. Entering another draft and reloading the renderer cleared it. No extra model run was launched for these form checks.
