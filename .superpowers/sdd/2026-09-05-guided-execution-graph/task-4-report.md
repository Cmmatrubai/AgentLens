# Task 4 report: source prepared; browser acceptance BLOCKED

This is safe source preparation against base `67e08bb` on `codex/agentlens-flight-console`. It is not full Task 4 completion. The controller's `task-4-preparation-constraints.md` prohibits browser execution because admin-enforced browser policy verification is unavailable. No browser, Playwright execution, CUA, preview, screenshot capture, alternate client, or workaround was used. Screenshot calls exist only in the unexecuted acceptance source.

## Prepared changes

- Added `fixture-synthetic-mixed-graph`, labeled "Synthetic mixed-evidence graph fixture", in the existing isolated temporary data-root helper. It contains three synthetic routine messages, a successful compatible command start/completion pair, a separate observed command start/failure, two existing likely-test derivations with exact `derived_from` links, a paths-only provider `fileChange`, an open command recovered through the repository recovery API, process/provider/reconciliation facts, supported synthetic Git artifacts, and a human assessment through the existing API.
- Synthetic Git final state remains separate from observed file-change evidence; no action patch or authorship claim was invented. Existing fixture IDs, statuses, timestamps, sentinel bytes/redaction, and temporary-root behavior were not changed.
- Added one fixture test covering separate identity/label, contiguous immutable event sequences, routine messages, successful correlation identity, observed failure, derived provenance and exact links, paths-only file change, recorder recovery, Git artifact evidence, human assessment, and preservation of the existing completed fixture status.
- Added seven browser acceptance cases in `execution-graph.spec.ts`: 1440/1024/768/390 geometry, meaningful chronological spine and exact branches, desktop lane offset and bounded widths, visible-node coordinate stability, branch persistence after changing selection, adjacent/below clarification placement, fixed desktop inspector, inline evidence outside the listbox, no horizontal overflow, short non-layout card transitions, routine/lifecycle expansion and Alt-arrow member selection, exact Left/Right relationship navigation, request gates, focus restoration across the 800px boundary, and computed reduced-motion styles. Four screenshot outputs target Playwright's ignored temporary output directory when execution is allowed.
- Clarification request checks permit exactly the existing one automatic bounded inspector detail request; they reject new raw/content/native/assessment-note/Git/artifact requests before deliberate controls. Explicit command-content and provider-payload controls must produce their own corresponding requests.
- The old density test now checks bounded graph widths, breathing room, bounded DOM and adjacent coordinate stability. The fixed-inspector/frame assertions remain intact, with grouping disabled through the visible checkbox for event-1 identity.
- The 1000-event test changed only by disabling grouping through the visible checkbox. Its exact ten captured pages, all 1000 immutable IDs and sequences, authenticated cursor chain, <=1px anchor offset, URL selection, <30 mounted options and Home/End identities remain unchanged.

## Verification performed

1. Fixture RED: `pnpm test apps/web/test/fixtureDataRoot.test.ts` failed at the new synthetic run label assertion (missing fixture), with the existing test passing.
2. Fixture implementation initially exposed an unsupported absent Git status state, corrected by writing supported synthetic status/check artifacts. A draft expectation counted reconciliation as likely-test evidence; narrowed it to the two actual test kinds. Focused GREEN: 2/2 tests passed; the successful lifecycle addition also passed 2/2.
3. `pnpm test`: 74 files passed, 1418 tests passed, exit 0 (24.21 seconds). This suite includes the final fixture implementation.
4. `pnpm typecheck`: exit 0.
5. `pnpm build`: exit 0; 558 modules transformed. Existing Vite >500kB chunk warning remains (main JS 527.44kB, gzip 158.91kB). No production renderer/CSS changes were made.
6. `pnpm test:e2e --list`: 20 tests discovered in nine files, including seven new graph cases. Discovery is not browser execution and proves no browser assertions passed. Repeated after final browser-source edits.
7. `git diff --check`: clean.
8. Optional standalone strict source check: `pnpm exec tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --esModuleInterop apps/web/e2e/execution-graph.spec.ts apps/web/e2e/fixtures.ts apps/web/e2e/flight-console.spec.ts apps/web/e2e/trajectory.spec.ts apps/web/test/fixtureDataRoot.test.ts` exits 2. It reports 12 diagnostics in pre-existing code: nullable run lookup in fixtures, implicit `this` and mutable/readonly record mismatch in requestLifecycle, readonly derivation relationships in the fixture helper, and the existing two-argument openDatabase test call. These statements were checked against `67e08bb`; no isolated baseline compilation was performed. One newly introduced extra openDatabase argument was corrected. No diagnostic was reported in the new browser spec. The root project typecheck excludes e2e/test-support files, so its success does not clear these optional diagnostics.

## Self-review and evidence boundaries

Read the task brief, preparation constraints, visual/integration notes, applicable AGENTS and TDD/verification/graph guidance. Used Tier 2 graph discovery with project `AgentLens-flight-console`, generation `2026-09-04T05:17:37Z`. Coverage checks reported excluded e2e/test files and stale/untracked graph-renderer paths; exact source was read for the relevant contracts. Graph metadata is best-effort and is not current browser evidence.

Reviewed the owned diff for scope, provider/derived/recorder/Git/human boundaries, synthetic labels, supported persistence APIs, original fixture preservation, keyboard action order, source/target identities, raw endpoint patterns, and unchanged pagination/frame assertions. Browser geometry assertions remain acceptance requirements, not observed outcomes. Existing requestLifecycle and browserGuard implementations are unchanged. No dependencies, main files, design-prototypes, real captures, merge/rebase/push, or production rendering changes were made.

## Mandatory pending gates

- Restore permitted browser access through the controller; do not work around the policy failure.
- Execute the full root `pnpm test:e2e` suite (the web package defines only `build`). Diagnose actual failures before any production fix; do not weaken assertions based on guessed geometry.
- Capture and visually inspect actual desktop/narrow screenshots, including crowded labels, exact branches, viewport boundaries, last-node clarification and inspector collisions. The prepared screenshots have not been generated or reviewed.
- Controller independent source/whole-slice review, production-fixture preview and real browser visual checkpoint remain pending. Later Flight Console tasks remain pending; branch remains unmerged and unpushed.

Commit subject: `test(web): prepare guided graph fixtures and browser acceptance source`.
