# Prototype 04 — explaining the comparison

Verified September 6, 2026 in the isolated desktop prototype. This increment adds three AI-assisted findings for the existing C01 Sol/high and Terra/high records; no model attempts or independent evaluations were rerun.

## Delivered behavior

- The comparison overview leads with the shared successful outcome and three differences: implementation structure, testing strategy and handling blocked validation.
- Each **Compare evidence** action opens a paired view with both model observations, a separately labeled interpretation, actual source excerpts, source switching where relevant, full-source disclosure and limitations.
- Final Git diffs, recorded command output and agent reports retain distinct labels. Terra's report is explicitly self-reported; its blocked integration command still displays exit 1. The shared independent conditions remain 7/7 for each attempt.
- Reviewed source identity includes manifest, model/reasoning, run, snapshot, independent result/artifact and excerpt digest bindings. Changed or missing inputs withhold the review instead of attaching its conclusions to different evidence.
- These are versioned notes for one pair, not an automatic analysis engine or a general model ranking. The editor's interpretations remain judgments; hash validation proves their association with the reviewed bytes, not the truth of those judgments.

## Verification

- All 35 prototype tests passed, including seven focused analysis-association cases covering reversed attempt order, foreign manifest/snapshot/model, incomplete work, changed independent output identity/outcomes, changed/missing/truncated source, invalid ranges, duplicate source IDs and a changed recorded exit status.
- TypeScript checking and the production build passed. The final browser preview and native Electron instance use that build.
- The actual read-only comparison reader returned all three findings, with both source sets resolved against the preserved C01 archive and fourteen original passing condition outcomes. Frozen experiment inputs and archived recorder/evaluator bytes passed the existing read-time integrity checks.
- A separate read-only reviewer approved the new projection, authored notes and paired UI within the reviewed scope, with no actionable P1/P2 findings. The reviewer also performed five additional in-memory mismatch checks. Graph tooling was unavailable; review used exact source and validated reader output.
- Browser overview and evidence views inspected at 1440×1000 and 820×800. At 640×800 evidence stacks into one column. No document horizontal overflow at these widths; long code remains within scrollable source panels. Modal header/footer stay visible while the body scrolls.
- Opened all three findings. Expanded Terra's full implementation diff, switched its testing evidence to the recorded 19-test output and its blocker evidence to the captured failing integration run. Model-specific observations and source labels remained correct.
- Both the return button and Escape restore focus to the originating finding in the browser. Native Electron's paired testing view opens through the existing local IPC reader, switches Terra's source correctly, prevents Command-K from stacking another dialog and restores focus after Escape.
- The browser reported no warning/error logs during these checks. Its viewport override was reset and the comparison overview left open.
- T01-A1's database and seven artifacts match original bytes, hashes and modification times. All 86 files in each final model snapshot retain their original hashes. See `historical-preservation.json` and `source-preservation.json`.
- Canonical AgentLens remains at `271b422ae5053bccc6d74fa5e86ba9b0e7aab01c` with the same two pre-existing untracked paths. Changes remain in the isolated prototype; nothing was committed, merged, pushed or published.

## Visual evidence

- `overview-1440.png`, `overview-820.png`: findings before the condition ledger.
- `implementation-1440.png`, `testing-1440.png`, `blocker-1440.png`: the three paired views.
- `paired-820.png`, `stacked-640.png`: compact layouts.
- `native-overview.png`, `native-paired.png`: actual Electron rendering.

The setup flow and other sample screens remain fictional fixtures. General real-task execution, history, repeat trials and automatic explanation generation remain separate work.
