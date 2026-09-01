# Task 7.11 implementation report

## Result

Implemented only the Task 7.11 selected-event inspector and Final Git evidence
experience from accepted base `436cb2dd0a668b60635589ded46d8a4fa552345c`:

- lazy bounded event detail plus explicit content, command-output, native-payload,
  assessment-note, Git-status, untracked-metadata, diff-check, and tracked-diff
  requests through the existing authenticated memory-token client;
- a desktop sticky inspector and an 800-pixel selected-row inline inspector with
  an on-demand spanning deep-evidence panel;
- eligibility-gated **Redacted provider payload** presentation, explicitly labeled
  provider evidence rather than canonical AgentLens truth;
- closed content rendering, exact relationship IDs/types, opaque source dimensions,
  command facts, and explicit nonblank availability states;
- a structured text-node-only Git diff renderer with collapsed files, hunks,
  line numbers and text labels, binary/exclusion metadata, bounded DOM pagination,
  horizontal code scrolling, and empty/malformed/truncated/unavailable states;
- Final Git status, diff-check, untracked metadata-only, and tracked-diff controls,
  with no authorship claim; and
- responsive inspector state/focus restoration across the desktop/800-pixel move.

No assessment mutation, active polling, browser storage, generic artifact URL,
unsafe HTML path, hosted behavior, terminal/editor dependency, or provider/storage/
CLI mutation was added. The ignored `.scratch-e2e-ONFuP0/` directory was not read,
edited, staged, or committed. The main-repository `design-prototypes/` directory was
not read, edited, staged, or committed.

## TDD evidence

All original Task 7.11 product tests were written before their implementations.
The required retained RED run was:

```text
pnpm vitest --run apps/web/test/eventInspector.test.tsx \
  apps/web/test/gitDiffViewer.test.tsx
Test Files  2 failed (2)
Tests       0
Failures    Cannot resolve ../src/evidence/AvailabilityNotice.js
            Cannot resolve ../src/evidence/GitDiffViewer.js
exit        1
```

During responsive review, a new focus-preservation regression test was added first.
Its retained RED correctly showed that the Relationships tab lost focus and the
newly mounted inspector reset to Evidence at the breakpoint:

```text
pnpm vitest --run apps/web/test/eventInspector.test.tsx \
  -t "restores the focused inspector control"
Test Files  1 failed (1)
Tests       1 failed, 16 skipped
Failure     Relationships expected focus; body received focus after reflow
exit        1
```

The smallest GREEN fix keeps the inspector request/tab session in `RunWorkspace`,
captures the focused inspector control before the placement change, and restores the
same semantic control after the move. The focused regression then passed `1/1`.

Two early GREEN failures were test-selector mistakes, not product failures: one
command assertion matched both the summary and evidence, and one raw-script assertion
expected a whole code node instead of contained text. Both selectors were narrowed.
The first typecheck failure was an `exactOptionalPropertyTypes` mismatch and was fixed
with conditional optional-prop spreading. An adjacent legacy `RunWorkspace` test then
exposed missing API context; production evidence rendering was correctly gated on the
real run DTO while the legacy pure trajectory harness remained API-free.

The production browser fixture itself failed closed twice before review: a synthetic
recovery used an invalid terminal state, and a synthetic Git-status record used an
invalid porcelain format. Source-contract inspection identified both causes; the
fixture now uses repository-generated recovery evidence and the accepted status form.

## Fresh automated verification

Final focused matrix:

```text
pnpm vitest --run apps/web/test/eventInspector.test.tsx \
  apps/web/test/gitDiffViewer.test.tsx apps/web/test/apiClient.test.ts \
  apps/web/test/fixtureDataRoot.test.ts
Test Files  4 passed (4)
Tests       33 passed (33)
exit        0
```

The earlier explicit adjacent Task 7.6-7.10 matrix passed `11/11` files and
`280/280` tests. The final repository-wide suite supersedes that matrix:

```text
pnpm test
Test Files  63 passed (63)
Tests       1280 passed (1280)
exit        0
```

Types, production build, and whitespace validation:

```text
pnpm typecheck
$ tsc -b --pretty false
exit 0

pnpm build
142 modules transformed
bootstrap CSS 23.51 kB (gzip 5.15 kB)
bootstrap JS  365.83 kB (gzip 107.26 kB)
exit 0

git diff --check
exit 0
```

Production-source scans found no `dangerouslySetInnerHTML`/raw HTML, browser storage,
polling, assessment mutation, generic artifact URL/link, or direct evidence fetch.
The only bearer-header match is the pre-existing centralized request path in
`apps/web/src/api/client.ts`; every new method delegates to that bounded authenticated
path and accepts `AbortSignal`. Browser rendering contained no external origin, token-
like text, bootstrap path, private fixture fingerprint, or body script element.

Graph coverage was checked once across every relied production path. The unchanged
API contracts, evidence route/service/projectors, and query context were
`metadata_match/no_recorded_issue`. Modified and new Task 7.11 paths were
`metadata_changed` or `not_tracked` against generation `2026-09-01T02:29:02Z`, with
no recorded parse gap; their complete source and diff were read directly. Tests and
`.superpowers` are graph-excluded by design and were read directly.

## Real-browser verification

Used only the in-app browser against the production build and a disposable real
SQLite/authenticated API fixture. The fixture contains failed command/output, an
eligible response-redacted native payload, derived likely-test evidence, repository-
generated recorder recovery, an unsupported future event, available Final Git
evidence, a capture-policy-omitted diff, and a 2,096,001-byte structured-diff artifact.

At 1440, 1100, and 800 pixels, semantic browser checks found each required selected
failure, command output, provider payload, recorder recovery, derived result, unknown
state, structured Final Git diff, omitted diff, and large-diff file group. At 1440 and
1100 the inspector remained in the sticky side column. At exactly 800, the desktop
aside count was zero and the inspector/deep panel appeared between the selected
virtual row and the next trajectory row, not at the trace end.

Additional evidence:

- tab ArrowRight moved active/selected focus from Relationships to Redacted provider
  payload; provider tab was absent for derived evidence;
- responsive reflow retained the selected/focused Relationships tab in the final
  production build;
- deep-panel heading received focus, and Escape closed the panel;
- relationship view showed exact `derived_from` and event ID plus only opaque source
  dimensions;
- all four explicit Git controls returned validated status, metadata-only untracked
  entry, diff-check result, and structured diff; omitted evidence rendered
  `Artifact omitted`;
- the 2 MiB-class diff mounted one file group and one line node by default; its code
  scroller contained the very wide line while `body.scrollWidth === body.clientWidth`
  at 800; computed `user-select` was `text`;
- browser console warning/error logs were empty and rendered links had no external
  origins; and
- full navigation reload discarded the memory-only token and rendered
  `Authentication expired`.

The in-app browser API did not expose an HTTP request log, and its isolated page
evaluation did not expose Resource Timing. Actual production responses were therefore
verified by activating each exact control and observing its real server-projected
content, while the no-request-before-action property is covered by the focused client
spy tests. This is the only browser-network observability residual; no standalone
browser or Playwright substitute was used.

## Changed files and narrow deviations

The frozen Task 7.11 file list is implemented as written. These narrow additions were
required to preserve accepted boundaries:

- `apps/web/src/api/client.ts`, `queryKeys.ts`, and `apps/web/test/apiClient.test.ts`:
  exact closed evidence methods/keys and direct route/validation/abort tests, because
  the accepted client previously exposed no evidence methods. No generic method or
  duplicated token/fetch logic was added.
- `apps/web/src/run-detail/RunDetailPage.tsx`, `apps/web/src/bootstrap.tsx`, and
  `apps/web/src/trajectory/Trajectory.tsx`: pass the already-fetched bounded run DTO,
  load the Task stylesheet, and provide the selected virtual-row insertion slot.
- `apps/web/test/runList.test.tsx`: extend the exact client test double for the new
  closed methods.
- `apps/web/test-support/fixtureDataRoot.ts`: add only synthetic redacted Task 7.11
  evidence fixtures needed for the mandated production-browser matrix.

## Review-fix round 1

Review base: `2bb80778302bab525f3373be725f6db8c192965d`.

The four Important findings were confirmed and closed without Task 7.12+ work:

- Event/content/native/note action state is synchronously keyed by exact run/event
  identity. Final Git status/untracked/diff-check/diff state is synchronously keyed by
  run or run/selection identity, so an effect cannot briefly enable a new identity.
- The closed run-detail-only contract now carries bounded actual initial/final HEAD
  plus attached/detached initial/final branch states. Run-list items remain unchanged.
  Active/missing final evidence remains explicitly `not_yet_available` or
  `not_captured`; the Final Git evidence UI renders the exact projected values and
  separate HEAD/branch warnings.
- Command `/content` now returns a closed `command_evidence` projection with
  independently explicit command and output availability and truncation. The UI
  renders both retained fields, lifecycle and exit availability. Binding mismatch is
  corrupt, policy/content omission stays omitted/not captured, and other client/read
  failures are unreadable rather than blanket corruption.
- The diff viewer renders at most 50 file groups, 100 hunks, 200 structural entries,
  and 400 lines at once. File pages and replacing line pages keep later evidence
  reachable without cumulative DOM growth. The bound applies across every expanded
  file, not per file. The controlled view state and one-shot focus request survive
  the 799/800/801 placement remount without a second immutable diff request.

### Retained review RED evidence

```text
pnpm vitest --run apps/web/test/eventInspector.test.tsx apps/web/test/gitDiffViewer.test.tsx
Test Files  2 failed (2)
Tests       3 failed, 20 passed
Failures    rapid event switch requested content for the new identity;
            note/native action state crossed identity;
            20,000-file fixture mounted 20,000 groups
exit        1

pnpm vitest --run packages/application/test/runQueryService.test.ts \
  -t "projects run anchors"
Test Files  1 failed (1)
Tests       1 failed, 11 skipped
Failure     gitState missing from run-detail projection
exit        1

pnpm vitest --run packages/application/test/evidenceService.test.ts \
  -t "independently available"
Test Files  1 failed (1)
Tests       1 failed, 146 skipped
Failure     output-only command response omitted retained command
exit        1

pnpm vitest --run apps/web/test/eventInspector.test.tsx \
  -t "Final Git evidence action"
Test Files  1 failed (1)
Tests       1 failed, 19 skipped
Failure     run B diff requested before a run-B action
exit        1

pnpm vitest --run apps/web/test/eventInspector.test.tsx \
  -t "preserves expanded diff"
Test Files  1 failed (1)
Tests       1 failed, 21 skipped
Failure     responsive remount collapsed the expanded file; after lifting state,
            the remount still duplicated the immutable diff request
exit        1

pnpm vitest --run apps/web/test/gitDiffViewer.test.tsx \
  -t "keeps a large response"
Test Files  1 failed (1)
Tests       1 failed, 3 skipped
Failure     cumulative per-file limit could not replace the first 400 mounted lines
exit        1
```

An early two-pattern Vitest invocation failed at CLI parsing because `-t` accepts one
value. It was immediately rerun as two focused commands; this was a command error,
not product evidence. One note-identity RED initially used an undefined mock response;
the mock was corrected to a valid closed note DTO while retaining the cross-identity
request assertion.

### Review-fix verification

The final full repository suite is recorded below after the last pagination change.
The focused final matrix covers contracts, run detail, authenticated server reads,
client routes, event/Final Git identity switching, responsive state, command evidence,
and bounded diff rendering. Typecheck, production build, diff validation, privacy and
scope scans were rerun after the final source edit.

Graph coverage was rechecked for all twelve changed production paths against
generation `2026-09-01T03:18:12Z`. Every path reports `no_recorded_issue`; all report
`metadata_changed`, so complete source and the full diff were read directly as the
authoritative fallback.

The required in-app browser skill was loaded and the exact in-app selector was tried.
It returned `Browser is not available: iab`. No Playwright, standalone browser, Chrome,
or Computer Use substitute was used. Therefore the 1440/1100/800/799/801 visual and
live-network review remains an explicit browser residual for this review round; the
responsive placement/focus/request behavior and large multi-file DOM bound are covered
by production-component regressions.

The review explicitly authorized the narrow API-contract/application/run-detail and
server-test expansion needed for stored Git refs and independent command evidence.
No generic evidence method, list-item expansion, storage shape change, raw fetch/token
duplication, browser persistence, polling, mutation, or later-task behavior was added.

Final fresh evidence after the last pagination edit:

```text
contract/run-detail/server/client/identity/diff matrix
Test Files  6 passed (6)
Tests       85 passed (85)

command/service/server/inspector/diff matrix
Test Files  4 passed (4)
Tests       179 passed (179)

pnpm test
Test Files  63 passed (63)
Tests       1288 passed (1288)
exit        0

pnpm typecheck
$ tsc -b --pretty false
exit 0

pnpm build
142 modules transformed
bootstrap CSS 23.51 kB (gzip 5.15 kB)
bootstrap JS  369.56 kB (gzip 108.20 kB)
exit 0

git diff --check
exit 0
```

Focused production scans across the changed web/API/application surfaces returned no
unsafe HTML, browser storage, polling timers, generic artifact URL, direct component
fetch, duplicated bearer handling, `changes made by the agent`, `agent changes`, or
`exact final diff` match. The ignored scratch directory remained the only untracked
path and was never read, edited, staged, or committed.

## Review-fix round 2

Review base: `ec95795f504f8fef215a567ef548f2cf326a2e04`.

The four Important UI findings are closed within the Task 7.11 web surfaces:

- The structured diff now permits exactly one expanded file at a time. A per-file
  evidence cursor replaces bounded pages while independently enforcing 50 mounted
  files, 100 hunk headers, 200 structural records, and 400 lines. Header-only,
  metadata-only, and zero-line-hunk pages have forward/back controls, so later
  evidence remains reachable after a 400-line file or a zero-line page.
- Breakpoint focus restoration is retained until the matching semantic destination
  mounts and accepts focus. A stable callback-ref/layout handoff covers the delayed
  selected virtual row in both 799-to-801 and 801-to-800 directions while preserving
  selection, expanded diff state, and the single immutable diff request.
- `Redacted command` and `Redacted command output` are always separate accessible
  slots. Before an explicit request each slot uses its own run-detail availability;
  after load it uses its own `command_evidence` field. A request failure is a third,
  separately labeled fact and does not erase either evidence slot.
- Git status and untracked metadata independently replace 100-row pages with
  previous/next controls and accessible exact ranges. Tests traverse a 10,000-entry
  status response and a 9,000-entry untracked response while asserting old rows are
  removed, later rows are reachable, focus is retained, and each list stays at 100.

### Retained review RED evidence

```text
initial pre-product regression run
Test Files  3 failed | 61 passed (64)
Tests       9 failed | 1287 passed (1296)
Failures    command/output had no separately labeled regions;
            Git status and untracked lists mounted every response row;
            a 400-line first file hid later-file evidence;
            100 zero-line hunks rendered only one hunk and no next control;
            responsive delayed-row fixtures could not retain the destination
exit        1

focused responsive implementation check
Test Files  1 failed | 2 passed (3)
Tests       1 failed | 34 passed (35)
Failure     real virtualized 801-to-800 handoff mounted the selected destination
            after the parent layout pass; BODY retained focus
exit        1
```

The second RED isolated the root cause in the first layout-only implementation: the
selected virtual row can mount in a child-only commit, so a parent-only retry never
runs. The final stable mount callback performs the same bounded semantic match at the
destination mount and clears the pending handoff only after focus succeeds; there is
no timer, polling loop, or duplicate request.

### Review-fix round 2 verification

```text
focused diff/command/responsive/collection suite
Test Files  3 passed (3)
Tests       35 passed (35)

Task 7.11 + contract/application/server + adjacent 7.6-7.10 matrix
Test Files  14 passed (14)
Tests       308 passed (308)

pnpm test
Test Files  64 passed (64)
Tests       1296 passed (1296)
exit        0

pnpm typecheck
$ tsc -b --pretty false
exit        0

pnpm build
142 modules transformed
bootstrap CSS 23.51 kB (gzip 5.15 kB)
bootstrap JS  372.19 kB (gzip 108.71 kB)
exit        0

git diff --check
exit        0
```

Fresh production-only scans across all six changed UI modules found no unsafe HTML,
browser persistence, polling/timers, raw fetch, generic artifact URL, duplicated
authorization handling, assessment mutation, prototype/scratch import, later-task
transport, or forbidden agent-change/final-diff language. The complete owned source,
tests, and diff were inspected after GREEN.

The browser-control skill was read in full and the exact in-app browser selector was
used. It returned `Browser is not available: iab`. No Chrome, Computer Use,
standalone browser, or Playwright substitute was used. Therefore the mandated live
1440/1100/800/799/801 checks for both focus directions, later/zero-line diff pages,
separate omitted command/output slots, near-bound status/untracked pagination,
overflow, console, network, token/private text, and reload remain the sole explicit
round-2 residual. Their behavioral and DOM-bound portions are covered by the fresh
production-component regressions above.

Round 2 adds no contract, server, storage, API-client, fixture, or later-task surface;
there is no plan-file-list deviation. The pre-existing ignored scratch directory was
not edited or staged.

## Review-fix round 3

Review base: `f220b35cc3d5f0573594b3c2c7b1c48cea1ab414`.

### Root cause and hypothesis

The production implementation is `apps/web/src/trajectory/Trajectory.tsx`; the
review-candidate `VirtualizedTrajectory.tsx` does not exist. Graph generation
`2026-09-01T04:28:18Z` reported the real `Trajectory.tsx` and `RunWorkspace.tsx`
paths as `metadata_match/no_recorded_issue` before editing, while the nonexistent
candidate had missing freshness. All affected source and excluded tests were read
directly.

The confirmed root cause was the virtual range, not focus matching. At desktop width,
deep evidence can be focused in the sticky inspector while its selected trajectory
row is outside the current virtual window. Changing to narrow supplies inline
evidence, but `selectedIndex` itself does not change, so the existing selection-scroll
effect does not rerun. The range extractor previously pinned only a pending roving-
focus row; it did not pin the selected row that owns inline evidence. Consequently no
selected row, inline inspector, or destination control mounted, leaving focus on
`BODY`.

The tested hypothesis was that pinning exactly the selected layout-row index only
while non-null inline evidence is active would make the narrow destination mount
without disabling virtualization or moving evidence to the trace end. This was
confirmed. The range remains the normal visible/overscan set plus at most one selected
row, and the existing mount callback restores the semantic control. Desktop behavior,
scroll anchoring, canonical selection, and evidence query identity are unchanged.

### Retained RED

```text
pnpm exec vitest --run apps/web/test/eventInspector.test.tsx \
  -t "preserves selected virtual-row deep state"
Test Files  1 failed (1)
Tests       1 failed | 1 passed | 24 skipped (26)
Failure     801-to-800 could not find [data-testid="inline-event-inspector"];
            only virtual rows 0-2 were mounted while selected event-79 was absent
exit        1
```

The regression performs the real breakpoint transition without programmatically
scrolling the selected row. The reverse 799-to-801 case starts with a naturally
visible selected row; both cases preserve the expanded diff control, selected event,
focus, and exactly one immutable diff request.

### Fresh GREEN and verification

```text
no-manual-scroll breakpoint regression
Test Files  1 passed (1)
Tests       2 passed | 24 skipped (26)

Task 7.11 + 10/50/250/1000 trajectory/merge/page matrix
Test Files  7 passed (7)
Tests       90 passed (90)

pnpm test
Test Files  64 passed (64)
Tests       1296 passed (1296)
exit        0

pnpm typecheck
$ tsc -b --pretty false
exit        0

pnpm build
142 modules transformed
bootstrap CSS 23.51 kB (gzip 5.15 kB)
bootstrap JS  372.27 kB (gzip 108.74 kB)
exit        0

git diff --check
exit        0
```

The existing 10/50/250/1,000-event virtualization tests remain green with bounded
overscan and one roving tab stop. The responsive regression proves both directions,
selected-row ownership, focused expanded state, and one `getGitDiff` call without a
manual scroll. Production-only scans of the two changed code/test paths found no raw
HTML, persistence, timers/polling, fetch/auth duplication, generic artifact URL,
prototype/scratch import, later-task transport, or forbidden Git wording. There is no
page-level layout or evidence-query code change.

After the source change, coverage remained `no_recorded_issue`; `Trajectory.tsx`
correctly reported `metadata_changed`, so its complete source and full diff were read
directly. `RunWorkspace.tsx` remained unchanged and `metadata_match`.

The exact in-app browser selector was retried after the production build and returned
`Browser is not available: iab`. No Chrome, Computer Use, standalone browser, or
Playwright substitute was used. The production 801/800/799 visual, overflow, console,
network, external-asset, token/private-text, and reload checks therefore remain the
only round-3 residual; their responsive state, request-count, selection, focus, and
DOM-bound behavior is covered by the fresh component and virtualization suites.

Round 3 changes only `Trajectory.tsx`, the existing responsive regression, and this
report. It adds no Task 7.12/7.13 behavior, API or persistence surface, global
virtualization disablement, duplicated evidence, or trace-end inspector. The existing
ignored scratch directory was not edited or staged.
