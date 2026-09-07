# Prototype 04 — comparison verification

Verified September 6, 2026 in the isolated desktop prototype. The C01 experiment and complete result boundaries are documented in [the experiment report](../../../experiments/C01/REPORT.md).

## Results

- Sol/high and Terra/high each passed all seven independent conditions: five additional behavior tests, the 265-test corrected historical regression suite and TypeScript checking. All actual evaluator commands exited zero.
- Prototype tests: 28 passed, 0 failed. Evaluator result-classification tests: 4 passed, 0 failed. Production build and TypeScript checks passed.
- A separate read-only reviewer approved the final comparison reader, integrity checks, projection, evidence selection and IPC scope with no remaining actionable P1/P2 findings. The review found and prompted fixes for nonzero evaluator exits, completed-but-unknown evaluations and stale open drawers.
- Browser comparison reviewed at 1440×1000 and 820×800. No document horizontal overflow; all fourteen condition buttons remain reachable. Drawers keep long output within bounded scrolling areas.
- Opened Sol's stdout evidence and Terra's regression-suite evidence; verified model attribution and the actual 265-test output. Inspected Terra's process-runner diff and recorded failed full-suite command. Final Git evidence is labeled separately from per-action changes.
- Closing evidence restores focus to the originating condition. Native Electron loads the bundled real comparison through IPC; its Sol evidence drawer opens correctly, Command-K does not stack a command palette above it, and Escape closes it and restores focus.
- Temporarily made the private manifest unavailable without altering it. Refresh cleared the old successful results and displayed an explicit unavailable state. The original manifest was automatically restored. Recovery was checked through the visible retry action.
- Guarded HTTP read returned 200/no-store. Missing custom header, cross-origin, query selector and POST requests returned 403. Direct preview access to a private manifest returned only the SPA HTML fallback, never the file; Vite development private-file denial tests passed. See `http-boundary.json`.
- Historical T01-A1 database and seven artifacts retained identical bytes, SHA-256 and modification times. Both final model source trees still match their pre-evaluation snapshots. Canonical HEAD/status remain the original `271b422` and its two pre-existing untracked paths.

## Retained evidence

- `overview-1440.png`, `overview-820.png`: real comparison at desktop widths.
- `check-evidence.png`, `terra-final-diff.png`: independently sourced output and final Git evidence.
- `source-details-820.png`: controls, original identities and experiment disclosure.
- `native-overview.png`: native Electron comparison.
- `unavailable-state.png`: unavailable evidence does not retain a success projection.
- `historical-preservation.json`: original recording preservation check.
- `http-boundary.json`: actual local HTTP boundary responses.

The .local experiment bundle contains the private manifests, launches, evaluator output, hashes and archives. Real QA screenshots are excluded from Vite development file serving. None of this work was committed, merged, pushed or published.

This verification covers the local comparison prototype, not a packaged application release, general execution/cancellation backend or production security audit. Current comparison checks are fixed for C01; sample setup still starts a simulation.
