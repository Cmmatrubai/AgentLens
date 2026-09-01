# Task 7.13 implementation report

## Outcome

Implemented active-run polling, follow-tail behavior, restrained Motion for React
state transitions, frozen responsive layouts, and the Task 7.12 accessibility
carry-forward. The implementation preserves immutable trajectory ordering, canonical
selection, bounded virtualization, assessment provenance, and the existing local-only
security boundary.

Task 7.13 production and test changes are confined to the web application, its two
new dependencies, and this report. No storage, application, server, API-contract,
fixture, Playwright, release, or Task 7.14 code was changed.

## Requirements implemented

### Active polling

- Polls only `starting` and `running` runs with one cancellable `setTimeout` loop at
  exactly 1,000 ms.
- Refreshes the run snapshot and trajectory page together.
- Requests `{ limit: 100 }` while the run has no real event, then
  `{ limit: 100, afterSequence: <last real sequence> }` after the first event.
- Does not start the polling timer until the initial trajectory snapshot has settled,
  preventing a slow initial request from overlapping with a duplicate tail request.
- Stops on terminal lifecycle, run identity change, unmount, abort, or non-retryable
  failure without leaking timers or requests.
- Treats only retryable HTTP 503 `active_snapshot_unavailable` as temporary
  degradation: valid run/evidence state remains visible and polling continues.
- Contains page-merge contract contradictions as explicit polling errors, keeps the
  previously valid trajectory, and stops instead of producing an unhandled rejection.
- Empty tail lineage is replaced by the first real tail snapshot, while empty after
  responses do not accumulate duplicate page entries.

### Follow tail

- Counts only genuinely appended event identities (`eventId:sequence`).
- A viewport within 32 px of the tail follows appended evidence.
- Inspecting history never forces scrolling or selection changes.
- History mode exposes one deliberate `N new event(s)` action and one polite live
  region; the jump selects and scrolls to the latest event, then clears the count.
- Canonical selection and the existing virtual anchor remain authoritative.

### Motion and accessibility

- Motion timing is state-explanatory and bounded: selection 150 ms, inspector 180 ms,
  lifecycle expansion 200 ms.
- `prefers-reduced-motion: reduce` is observed through a live media-query subscription
  and makes the relevant layout/state transitions immediate.
- Motion has no entry animation (`initial={false}`), decorative loop, bounce, glow,
  particle effect, broad remount behavior, or external asset.
- Roving trajectory focus remains one tab stop; lifecycle rows expose
  `aria-expanded`; visible focus is distinct and does not obscure evidence.
- Provenance and lifecycle remain available as text and symbols, not color alone.
- Automated axe coverage exercises real run-list, run-detail, trajectory, inspector,
  diff, and assessment components.
- The stale-assessment `Review latest assessment` action now queues focus to the
  semantic assessment form after removing its own focused button. It does not submit,
  retry, overwrite the stale draft, or alter provenance.
- The real diff viewer hunk heading is now level 3, removing the heading-order defect
  caught by axe without changing diff evidence.

### Responsive layout

- The new responsive stylesheet retains the wide three-area workspace, a compact
  1,100 px layout with a 340 px inspector, and an 800 px trajectory-first layout with
  an inline selected inspector.
- At 800 px, filters use two columns, evidence remains inline, and diff content owns
  horizontal scrolling rather than the page.
- The existing provenance, lifecycle/status, likely-test, assessment, Final Git, and
  availability facts remain in the DOM at every breakpoint; CSS changes only their
  placement and containment.

## TDD evidence

### Initial RED

Command:

```text
pnpm vitest --run apps/web/test/activePolling.test.tsx apps/web/test/accessibility.test.tsx
```

Result before production changes: expected failure, two files failed with six intended
failures and one passing baseline axe assertion. The failures proved the production
breaks named by the tests: no one-second active polling/degraded-state continuation,
no history-safe new-event action, invalid diff heading order, missing lifecycle
`aria-expanded`/reduced-motion behavior, and focus falling to `BODY` after Review latest.

The fixtures were first corrected to use complete valid DTO states (`none_detected`
likely tests and complete command lifecycle/content/exit fields); only the intended
production failures were retained.

### Self-review RED

Command:

```text
pnpm vitest --run apps/web/test/activePolling.test.tsx
```

Result before the containment change: three passed, one failed, plus the expected
unhandled rejection `Trajectory event ID maps to contradictory sequences.` The new
test proved that a contradictory append was not exposed as an alert and escaped the
poll loop. After adding callback containment, the same file passed all four tests with
no unhandled error.

A separate slow-initial-snapshot fake-timer case then failed with six event requests
where only the single in-flight initial request was permitted. Gating polling on the
initial trajectory reaching `ready` made the case pass: no request occurs during five
elapsed seconds of the unresolved initial snapshot, and the first poll occurs exactly
1,000 ms after it settles.

### Final focused GREEN

Command:

```text
pnpm vitest --run apps/web/test/activePolling.test.tsx apps/web/test/accessibility.test.tsx
```

Result: two files passed, nine tests passed.

### Accepted adjacent regressions

Command:

```text
pnpm vitest --run apps/web/test/activePolling.test.tsx apps/web/test/accessibility.test.tsx apps/web/test/trajectory.test.tsx apps/web/test/trajectoryPages.test.tsx apps/web/test/mergePages.test.ts apps/web/test/eventInspector.test.tsx apps/web/test/assessment.test.tsx apps/web/test/apiClient.test.ts apps/web/test/runList.test.tsx apps/web/test/runHeader.test.tsx apps/web/test/gitDiffViewer.test.tsx apps/web/test/evidenceCollections.test.tsx apps/server/test/readApi.integration.test.ts
```

Result: 13 files passed, 143 tests passed. This covers the accepted trajectory,
pagination/merge, inspector, assessment, client, run-list/header, diff/evidence, and
server read behavior adjacent to Task 7.13.

## Final verification

Fresh commands after the last production change:

```text
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Results:

- Full test suite: 67 files passed, 1,332 tests passed.
- Typecheck: passed (`tsc -b --pretty false`).
- Production build: passed; Vite transformed 551 modules.
- Production output: JS 514.10 kB (154.39 kB gzip), CSS 28.92 kB
  (5.98 kB gzip), manifest 5.46 kB; 15 files total and 856 KiB allocated on disk.
- Vite emitted its advisory for a JS chunk above 500 kB. This is not a build failure;
  the increase from the accepted Task 7.12 JS output (383.74 kB / 111.70 kB gzip) is
  attributable to the explicitly required Motion for React runtime. No additional
  animation framework or external asset was added.
- Diff whitespace validation: passed with no output.

The build-output regression also passed inside the full suite, including importability
of the manifest bootstrap entry.

Privacy, token, static, prototype, and scope review:

- Changed web production/tests contain no `localStorage`, `sessionStorage`,
  authorization/bearer handling, WebSocket, EventSource, external URL, Playwright,
  design-prototype, scratch, interval, or animation-frame additions.
- The production browser address no longer contained the bootstrap path or query and
  no token-like text appeared in visible DOM content.
- The production page produced zero console warnings/errors during inspection.
- The build contains local Vite assets only; no source maps or external assets were
  introduced.
- The changed-file and staged-file review contains no Task 7.14 fixture/harness,
  release, server, storage, application, or API-contract paths.
- The pre-existing untracked `.scratch-e2e-ONFuP0/` directory remained unstaged and
  was not opened, edited, or used. The main-repository `design-prototypes` directory
  was not read or touched.

## Exact in-app browser evidence and residuals

The exact in-app Browser was used against a production build at the meaningful
post-implementation milestone. The normal
source-mode `pnpm agentlens ui --no-open` command could not find web assets because it
resolved `apps/web/dist`, while this accepted build writes `apps/server/dist/web`.
Without changing server/packaging semantics, the existing production server was
therefore started directly with that explicit built `webRoot`, loopback origin, and
the default local AgentLens data root. The one-time bootstrap path was consumed before
inspection; no token is recorded here.

Observed in the exact in-app browser:

- 1440 x 1000: document/body scroll width 1440 px; no page overflow.
- 1100 x 900: document/body scroll width 1100 px; no page overflow.
- 800 x 900: document/body scroll width 800 px; no page overflow.
- Console warnings/errors: none.
- Address after bootstrap: `/runs?limit=50`; no bootstrap material in the address and
  no token-like visible text.

The default local CLI truthfully reported an empty run ledger (`{"runs":[]}`), but the
production browser route displayed the existing generic `Run evidence unavailable`
surface rather than an empty list, with no console detail. Because Task 7.14 owns the
disposable production fixtures/harness and this brief forbids beginning that work, I
did not create or copy a run database to make the required active/detail states
browser-reachable. Therefore active zero-event/tail/append/terminal/retryable-503,
follow-tail on/off, keyboard selection/expansion, Review-latest focus, diff scrolling,
assessment, reduced-motion emulation, and grayscale checks remain exact-browser
residuals. They are covered by real production-component automated tests and real
state transitions, but that coverage is not represented as browser evidence.

## Dependencies and lockfile

- `motion` 12.43.0 is the sole new runtime dependency, used only by trajectory rows
  and inspector placement for the bounded state-explanatory transitions above.
- `axe-core` 4.13.0 is the sole new development dependency, used directly by the
  automated accessibility tests.
- `pnpm why` found one resolved version of each in the web workspace. Lockfile review
  showed only their expected dependency graph (`framer-motion`, `motion-dom`,
  `motion-utils`, and `tslib` for Motion) and no unrelated importer changes.

## Changed files

Created:

- `apps/web/src/run-detail/useActiveRunPolling.ts`
- `apps/web/src/trajectory/useFollowTail.ts`
- `apps/web/src/motion/motionPolicy.ts`
- `apps/web/src/styles/responsive.css`
- `apps/web/test/activePolling.test.tsx`
- `apps/web/test/accessibility.test.tsx`
- `.superpowers/sdd/2026-08-30-agentlens-task-7/task-7.13-report.md`

Modified:

- `apps/web/src/run-detail/RunDetailPage.tsx`
- `apps/web/src/run-detail/RunWorkspace.tsx`
- `apps/web/src/trajectory/useTrajectoryPages.ts`
- `apps/web/src/trajectory/Trajectory.tsx`
- `apps/web/src/trajectory/TrajectoryRow.tsx`
- `apps/web/src/assessment/AssessmentEditor.tsx`
- `apps/web/src/evidence/GitDiffViewer.tsx`
- `apps/web/src/styles/global.css`
- `apps/web/src/styles/trajectory.css`
- `apps/web/src/styles/evidence.css`
- `apps/web/package.json`
- `pnpm-lock.yaml`

Small integration deviations from the narrow new-file list:

- `AssessmentEditor.tsx` received the deterministic semantic focus destination required
  by the Task 7.12 carry-forward. No assessment mutation semantics changed.
- `GitDiffViewer.tsx` changed one hunk heading from `h5` to `h3` because axe against the
  real component proved the existing heading-order violation. Diff semantics did not
  change.
- `useTrajectoryPages.ts` exposes its existing validated append operation and avoids
  retaining empty polling pages so active snapshots can use the same immutable merge
  contract. No API selector, storage, or chronology semantics changed.

## Graph and direct-source evidence

Parent graph context was `AgentLens-task7`, moderate generation
`2026-09-01T05:47:36Z`. Initial discovery covered `RunDetailPage` / trajectory detail,
`RunWorkspace`, `Trajectory`, `TrajectoryRow`, `useTrajectoryPages`,
`mergeTrajectoryPages`, client `getRun` / `getEvents`, and
`AssessmentEditor.reviewLatest`, with inbound/outbound traces where material.

Final coverage checking reported `no_recorded_issue` for all 15 production/config
paths relied on. Existing edited paths were `metadata_changed`; the four new production
paths were `not_tracked`, as expected because the graph generation predates them. Every
current shared source and each new file was read directly, and tests/config/lockfile
were reviewed from source. Graph coverage remains best-effort and is not represented
as proof of completeness.

## Self-review

- Polling uses one timeout and one abort controller, never an interval or overlapping
  request loop.
- Zero-event and after-sequence selectors are asserted exactly, including terminal
  cancellation and retryable degradation recovery.
- Contract-invalid appended evidence is validated before state mutation and stops the
  loop visibly.
- Follow-tail never selects or scrolls on append while history is being inspected.
- Existing rows never receive remount entry motion; reduced motion uses zero duration.
- The live region exists only for the new-event count.
- Roving focus, selected-row inspector count, bounded virtualization, evidence fetch
  behavior, and assessment no-retry semantics remain covered by accepted regressions.
- No broad animation, external asset, token persistence, eager evidence fetch,
  assessment retry, or Task 7.14 expansion was found in the final diff.

## Residual concern

Exact-browser interaction evidence is incomplete because the default production route
could not render an accessible run and Task 7.14 fixtures were explicitly out of scope.
All automated, type, build, diff, dependency, privacy, and scope gates are green.

## Fix round 1 — live append provenance, jump focus, and sole live region

The adversarial Task 7.13 review identified three Important findings. This focused
round fixes all three without changing API, server, application, storage, assessment
mutation, evidence chronology, or Task 7.14 fixture/harness behavior.

### Fix RED evidence

Before production edits, the following command exercised the new real-component
regressions:

```text
pnpm vitest --run apps/web/test/activePolling.test.tsx
```

Result: 6 of 12 tests failed for the intended production breaks and 6 passed.

- Earlier and later cursor merges incorrectly produced `1 new event`.
- A deferred around-selection backfill incorrectly produced `1 new event`.
- A same-component run change retained an incorrect pending count (`2 new events`).
- Enter and Space activation selected the latest item but left focus on `BODY`.
- A history-mode active page with a pending append, paging, and retryable 503 exposed
  three polite status/live regions instead of one.
- The exact duplicate active append regression already passed, proving the merged
  event collection deduplicated evidence but did not yet establish the required
  append-source boundary.

After the production change, the same file reported 8 passing and 4 failing tests.
Those four were older direct `Trajectory` setups that still relied on the rejected
implicit collection-difference behavior. Updating those fixtures to provide the same
explicit live-append source used by `RunDetailPage` made the complete focused file
green.

### Fix implementation

- `useTrajectoryPages` now publishes a run-scoped, revisioned live-append ledger only
  from its validated polling `appendPage` commit. Exact `eventId:sequence` identities
  are deduplicated. Initial tail loads, earlier/later cursor pages, and around-selection
  pages still merge immutably but never enter this live source. The ledger resets when
  `runId` changes.
- `useFollowTail` consumes only that explicit source. It no longer infers appends from
  identities newly appearing anywhere in the merged trajectory collection.
- `Trajectory` focuses the latest canonical virtual row, selects its event, and then
  clears/follows the tail when the new-event button is activated. Enter and Space both
  retain focus on the latest selected row after the button unmounts.
- The pending new-event count is the sole polite live region in the rendered detail
  page. Degradation, initial/paging/selection loading, empty trajectory, availability,
  Git loading/corruption, inspector loading, deep-evidence loading, and assessment
  success remain visible text but no longer have `role=status` or `aria-live` semantics.

### Fix GREEN evidence

Focused command:

```text
pnpm vitest --run apps/web/test/activePolling.test.tsx
```

Result: 1 file passed, 12 tests passed.

Focused plus adjacent web regressions:

```text
pnpm vitest --run apps/web/test/activePolling.test.tsx apps/web/test/accessibility.test.tsx apps/web/test/trajectoryPages.test.tsx apps/web/test/trajectory.test.tsx apps/web/test/eventInspector.test.tsx apps/web/test/assessment.test.tsx apps/web/test/apiClient.test.ts apps/web/test/gitDiffViewer.test.tsx apps/web/test/evidenceCollections.test.tsx
```

Result: 9 files passed, 113 tests passed. An intermediate run caught that
`aria-live="off"` still violated the existing standalone accessibility assertion;
systematic source review led to removing live/status semantics entirely from non-count
facts. The repeated command then passed all 113 tests.

Fresh full verification after the last production edit:

```text
pnpm test
pnpm typecheck
pnpm build
git diff --check
```

Results:

- Full suite: 67 files passed, 1,339 tests passed.
- Typecheck: passed.
- Production build: passed; Vite transformed 551 modules, emitted JS 514.89 kB
  (154.69 kB gzip), CSS 28.92 kB (5.98 kB gzip), and manifest 5.46 kB. The existing
  greater-than-500-kB advisory remains non-fatal.
- Diff whitespace check: passed with no output.

### Exact Browser residual

At the required meaningful post-build milestone I invoked the exact in-app Browser.
The host returned `Browser is not available: iab`. Per the binding constraint I did
not substitute Chrome, standalone Playwright, or another backend. Therefore there is
no new exact-browser interaction evidence in this fix round. The active append,
historical paging/backfill, duplicate, run-change, retryable-503/live-region, and
Enter/Space focus behaviors are instead covered by the real production-component
integration tests above. The earlier Task 7.13 responsive production-browser evidence
and its fixture-limited residual remain unchanged.

### Fix scope, privacy, dependency, and graph review

- The changed-source diff contains no browser storage, authorization/Bearer handling,
  WebSocket, EventSource, external request/asset, Playwright, prototype, interval, or
  animation-frame addition.
- Production output contains the same local Vite JS/CSS/font asset set and no source
  maps. Minified React contains its upstream diagnostic documentation URL strings;
  no app-authored external asset or request was added.
- `apps/web/package.json` and `pnpm-lock.yaml` are unchanged in this fix round, so the
  accepted Motion/axe dependency rationale and lockfile remain unchanged.
- Changed-file review contains no server, storage, application, API-contract,
  fixture/harness, release, or Task 7.14 path.
- The pre-existing untracked `.scratch-e2e-ONFuP0/` remained unstaged and was not read,
  edited, or used. The main-repository `design-prototypes/` directory was not read or
  touched.
- Graph project `AgentLens-task7` remains the moderate generation recorded at
  `2026-09-01T06:28:00Z` with no recorded parse/skipped issues. Final coverage reports
  `no_recorded_issue` but `metadata_changed` for every relied-on production file;
  both edited web tests are deliberately excluded by the graph's fast pattern. All
  current changed production and test sources were therefore reviewed directly.
  Coverage remains best-effort rather than proof of completeness.

### Fix changed files and deviations

Modified:

- `apps/web/src/trajectory/useTrajectoryPages.ts`
- `apps/web/src/trajectory/useFollowTail.ts`
- `apps/web/src/trajectory/Trajectory.tsx`
- `apps/web/src/run-detail/RunWorkspace.tsx`
- `apps/web/src/run-detail/RunDetailPage.tsx`
- `apps/web/src/run-detail/DeepEvidencePanel.tsx`
- `apps/web/src/run-detail/EventInspector.tsx`
- `apps/web/src/evidence/AvailabilityNotice.tsx`
- `apps/web/src/evidence/GitEvidenceSummary.tsx`
- `apps/web/src/evidence/GitDiffViewer.tsx`
- `apps/web/src/assessment/AssessmentEditor.tsx`
- `apps/web/test/activePolling.test.tsx`

The loading/availability/assessment files are the smallest integration deviation from
the review's named core files: each can coexist within `RunDetailPage` while a pending
new-event count is present, so their implicit polite `role=status` semantics had to be
removed to satisfy the frozen sole-live-region contract. Their visible facts and all
mutation/evidence behavior are unchanged.

### Fix self-review

- Live counts now have an auditable producer boundary at the accepted polling append
  commit; collection merge topology cannot increment them.
- Exact event identity dedupe prevents duplicate polling pages from incrementing the
  count, while merge validation continues to contain contradictions before mutation.
- Run identity is present in both producer and consumer state, preventing cross-run
  carryover.
- The jump action uses the existing bounded virtual focus mechanism and does not force
  scrolling while merely receiving new events in history mode.
- Exactly one `role=status`/`aria-live=polite` remains under the detail trajectory
  surfaces, and it exists only while announcing the pending new-event count.
- No evidence was rewritten/reordered; no assessment was retried/resubmitted; and no
  Task 7.14 work was introduced.
