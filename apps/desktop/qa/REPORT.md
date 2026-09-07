# Prototype 01 verification — September 6, 2026

## Observed build checks

- TypeScript check and Vite production build pass via `pnpm build`.
- Electron 44.2.0 launches the bundled `dist/index.html` in a native window.
- The built preview at loopback port 5178 reports no captured browser warnings or errors during the acceptance pass.
- An earlier development-only live-reload trace reported duplicate React-hook initialization while the first dependency imports were being introduced. It did not reproduce in the fresh built preview or native app. No speculative React dependency changes were made.

## Browser interactions verified through the UI

- Three distinct comparison outcomes, including a captured failure and a missing check result that remains unknown.
- Choosing a check on Model A or B opens that model's output.
- Evidence Result, Patch and Context tabs, including arrow/Home/End keyboard navigation.
- Dialog Escape, restoration to the originating check, and Shift+Tab wrapping within the evidence dialog.
- Command search with Cmd+K, text filtering, arrow selection and Enter navigation.
- Empty case form rejection and rejection when no success condition is checked.
- Valid case saved with one selected condition; case name, objective and selected condition remained available after a reload.
- User-created test cases removed through the UI; the final library contains its one original sample.
- Task search empty state, clearing filters and repository filtering.
- Replay finishes all five sample stages; cancel closes an active replay without running a model.
- Compact spacing and motion preferences persist after reload. Design defaults restored afterward.
- Execution switches between model-specific elapsed times and check counts; comparison setup identifies its sample starting revision and repeated-trial limitations.
- Six sample activity items; browser back/forward preserves route navigation.
- Collapsed navigation retains explicit accessible names.

## Native checks

- Home opens from bundled local files; Review comparison opens the session comparison.
- The decisive difference opens the native evidence drawer with the expected Model B failure.
- Native Cmd+K filters a task and Enter opens the selected comparison.
- Found and fixed a rapid-dialog focus race: closing evidence and immediately opening command search previously allowed the exiting dialog to restore focus behind the new dialog. Repeating Escape → Cmd+K after the repair leaves focus in the command input, and immediate typing/Enter navigates correctly.

## Visual checks

- Full desktop: 1440 × 900.
- Narrow desktop comparison: 900 × 800.
- Minimum native-width evidence drawer: 820 × 800.
- No document or main-content horizontal overflow at the measured desktop sizes. Evidence drawer stayed within the viewport at 820.
- Inspected typography, hierarchy, panel spacing, selected states, evidence output, native chrome, and native command search.
- Temporary browser viewport override is reset before handoff.

Screenshots:

- `workspace-1440.jpg` — task library and comparison entry point.
- `native-comparison.jpg` — comparison running in Electron.
- `native-evidence.jpg` — native evidence drawer.
- `evidence-820.jpg` — narrow desktop drawer.
- `execution-1440.jpg` — the deeper execution view.

## Limits

These are interactive smoke checks and visual review of a disposable prototype, not a production accessibility certification or cross-platform release test. The system reduced-motion preference is respected by Motion and CSS in source; the in-product motion toggle was tested, but OS settings were not changed. No real evaluations, provider cost measurements, production integration, signed installer or deployment were performed.
