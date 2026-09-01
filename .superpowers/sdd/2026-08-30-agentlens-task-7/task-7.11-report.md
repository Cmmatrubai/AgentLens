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

The API-bound run detail still exposes only HEAD/branch change booleans, not initial
and final HEAD/branch values. The UI therefore renders all four fields separately as
`Unavailable in the bounded run-detail DTO` rather than fabricating values. Closing
that wire-contract gap would require changing the already accepted API/application
projection and was intentionally left as a disclosed residual rather than broadening
Task 7.11.
