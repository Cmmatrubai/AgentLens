# Task 7.10 implementation report

> Review-fix updates (2026-08-31): the original implementation evidence below is
> retained as history. The final sections record the focused fix rounds after review
> rejected `69ccffa4ca95c85e974bdc4c20d5ef2018e0a68a` and then
> `7efa195a2d88ddbf66d07794164e6b8b2627dade` and
> `cf2463191a351322d45766eee3bdb89c7ad58e4a`, followed by the focused
> measurement fix after `d49bd5f9a7326a16f7486d35c94ef15003b455c2` and
> collapsible-group fix after `29c5e053c01be6a183641165781a4bc165bd2fc2`; the latest results and
> residuals supersede the earlier completion/browser claims.

## Result

Implemented only the Task 7.10 execution-trajectory spine from accepted base
`d2ac777bdcc2e4fb8bad2f12d272436dbbcf5781`:

- strict chronological projection with no repair-by-reordering;
- exact, contiguous immutable lifecycle sibling grouping;
- inspectable recovery and unknown rows;
- conflict-rejecting `(eventId, sequence)` page merging;
- bounded head/cursor/around-sequence loading and `?event=` deep links;
- variable-height TanStack virtualization with overscan `3`;
- one roving row tab stop, scoped arrows, Enter/Space selection, and bounded Escape;
- selected/visible relationship connectors plus labeled off-screen relationship jumps;
- explicit loading, empty, error, invalid-link, resolving, unavailable, and unsupported states;
- run header, provenance legend, server-projected jump anchors, and a deliberately
  bounded inspector placeholder for the next task.

No content, native payload, evidence, artifact, assessment-write, active-polling,
release-harness, favicon, provider, recorder, storage, or CLI behavior was added or
changed. The ignored `.scratch-e2e-ONFuP0/` directory was not read, edited, staged, or
committed.

## TDD evidence

The required RED stages ran before production implementation.

### 1. Pure projection RED

```text
pnpm vitest --run apps/web/test/projectTrajectory.test.ts
Test Files  1 failed (1)
Reason      Cannot resolve ../src/trajectory/projectTrajectory.js
exit        1
```

### 2. Merge and deep-link RED

```text
pnpm vitest --run apps/web/test/mergePages.test.ts
Test Files  1 failed (1)
Reason      Cannot resolve ../src/trajectory/mergePages.js
exit        1
```

### 3. Virtual interaction RED

The suite included independent bounded-DOM cases for 10, 50, 250, and 1,000 events.

```text
pnpm vitest --run apps/web/test/trajectory.test.tsx
Test Files  1 failed (1)
Reason      Cannot resolve ../src/trajectory/Trajectory.js
exit        1
```

The required combined RED run then confirmed all three production seams were absent:

```text
pnpm vitest --run apps/web/test/projectTrajectory.test.ts \
  apps/web/test/mergePages.test.ts apps/web/test/trajectory.test.tsx
Test Files  3 failed (3)
exit        1
```

Subsequent focused RED/GREEN corrections covered jsdom virtual measurement, focus
transfer, overlay pointer behavior, terminal-page stale cursors, disjoint head/around
cursor gaps, server-projected toolbar jumps, and sanitized cursor-page read failure.
The last additional RED failed to find the bounded paging alert and reported the
private rejection as an unhandled error; its focused GREEN passed `1/1` with no
unhandled rejection. The final focused run was:

```text
pnpm vitest --run apps/web/test/projectTrajectory.test.ts \
  apps/web/test/mergePages.test.ts apps/web/test/trajectory.test.tsx \
  apps/web/test/runList.test.tsx
Test Files  4 passed (4)
Tests       30 passed (30)
```

## Fresh automated verification

Adjacent Tasks 7.6-7.9 regression matrix:

```text
pnpm vitest --run packages/application/test/runQueryService.test.ts \
  apps/server/test/readApi.integration.test.ts \
  packages/codex/test/unknownNativeFields.test.ts \
  apps/cli/test/readCommands.integration.test.ts \
  packages/application/test/evidenceService.test.ts \
  apps/server/test/evidenceApi.integration.test.ts \
  packages/storage/test/runRepository.test.ts \
  packages/application/test/assessmentService.test.ts \
  apps/cli/test/assess.integration.test.ts \
  apps/server/test/assessmentApi.integration.test.ts \
  apps/web/test/apiClient.test.ts apps/web/test/buildOutput.test.ts \
  apps/web/test/fixtureDataRoot.test.ts
Test Files  13 passed (13)
Tests       459 passed (459)
```

Repository-wide suite:

```text
pnpm test
Test Files  59 passed (59)
Tests       1217 passed (1217)
exit        0
```

Types and production build:

```text
pnpm typecheck
$ tsc -b --pretty false
exit 0

pnpm build
127 modules transformed
assets/bootstrap-BBTq7kuF.css  17.43 kB (gzip 4.10 kB)
assets/bootstrap-Coy23BU9.js  334.85 kB (gzip 99.31 kB)
exit 0

git diff --check
exit 0
```

Source scans found no Task 7.13 polling, browser storage, bearer/token handling,
content/native/artifact/evidence fetches, absolute user paths, design-prototype edits,
or source maps in Task 7.10 production paths. A built-asset sentinel scan found no
browser bootstrap token, disposable data-root path, or absolute user path.

## Real-browser verification

Ran the production build against a disposable ignored real SQLite/API fixture in the
in-app browser. The fixture contained exact 10-, 250-, and 1,000-event completed runs.
No fixture or helper is part of the commit.

At 1440 x 1000:

- 10 events: bounded mounted rows, one roving tab stop, no horizontal overflow.
- 250 events: bounded 100-event page loads reached all 250; selection, URL, focus,
  and scroll stayed stable.
- 1,000 events: initial 100; latest-anchor deep link resolved through event detail and
  `aroundSequence`; bounded cursor loading reached all 1,000 while only 8 rows were
  mounted; the selected latest row remained visible with one tab stop and URL state.
- a visible selected relationship rendered one connector with computed
  `pointer-events: none`;
- an off-screen relationship exposed a labeled jump that selected and scrolled to
  `trajectory-1000-event-0`, updating `?event=`;
- keyboard ArrowDown plus Enter changed selection and URL without affecting global
  focus handling.

At 1100 x 900, the 10-, 250-, and 1,000-event routes each had zero document-level
horizontal overflow, stayed within the workspace boundary, retained exactly one row
tab stop, and kept mounted row counts bounded (7 rows in the measured viewport).

The browser warning/error log was empty. DOM inspection found no external-resource
requests and no bootstrap-token text. The browser tab was closed, viewport reset, and
the temporary server stopped after verification.

## Changed files and scope justification

- `apps/web/src/trajectory/*`: the Task 7.10 projector, merge/deep-link loader,
  virtualized trajectory, rows, toolbar, relationship overlay, and local types.
- `apps/web/src/run-detail/*`: real run-detail composition, header, workspace, and
  bounded inspector placeholder required to host the trajectory.
- `apps/web/src/styles/trajectory.css`: Task 7.10 responsive/accessibility layout.
- `apps/web/src/app/App.tsx`, `apps/web/src/bootstrap.tsx`: replace the inert detail
  shell and load its stylesheet.
- `apps/web/package.json`, `pnpm-lock.yaml`: add only TanStack React Virtual.
- `apps/web/test/projectTrajectory.test.ts`, `mergePages.test.ts`,
  `trajectory.test.tsx`: Task 7.10 pure and interaction coverage.
- `apps/web/test/runList.test.tsx`: narrow route-integration fixture update and latest
  anchor/deep-link assertion after the inert shell became the real detail route.
- this report.

## Review-fix round 3 after `cf24631`

The remaining Important finding was reproduced across the real server projector and
browser trajectory before implementation. The root cause was status inference in the
browser: any same-key command/tool records with `in_progress` then terminal-looking
status compacted, even when the provider source names were non-lifecycle records such
as `item.progress` and `item.snapshot`. Conversely, a real provider terminal with
unknown or future canonical status could not compact.

The fix adds one required, nullable, closed `TrajectoryLifecycleV1` descriptor to the
strict trajectory DTO. The application projector derives it only from an exact
allowlist of provider source event names for `item`, `tool`, `thread`, and `turn`, with
the phases `started`, `completed`, `failed`, `declined`, and `interrupted`. Every other
or future source event name projects `null`. Raw provider event names and item/tool IDs
remain server-side. The browser now requires an exact same-domain, same-presentation
start-to-terminal descriptor and opaque group key; status remains display evidence and
is no longer lifecycle classification input.

### Round-3 RED evidence

```text
pnpm vitest --run apps/web/test/projectTrajectory.test.ts \
  packages/api-contract/test/contracts.test.ts \
  -t "progress and snapshot|explicit item|true tool|trajectory events structural"
Test Files  2 failed (2)
Tests       5 failed, 34 skipped
Failures    item.progress + item.snapshot collapsed to lifecycle_group;
            real item.completed/item.failed with unknown or unsupported status
            remained two rows; true tool lifecycle remained two rows; strict DTO
            rejected the missing lifecycle contract field
```

The privacy assertion initially caught raw provider names placed by the test itself in
browser event IDs/summaries. Those fixture-generated names were removed; the same
projected response then proved that only the closed descriptor crosses the boundary.

Final diff review added a real-projector unknown-kind case. It correctly failed RED
because recognized `item.started`/`item.completed` descriptors still compacted two
future presentation kinds:

```text
pnpm vitest --run apps/web/test/projectTrajectory.test.ts \
  -t "projected unknown kinds"
Test Files  1 failed (1)
Tests       1 failed, 18 skipped
Failure     projected unknown events collapsed to lifecycle_group
```

The smallest preservation fix restricts compactable presentations to the accepted
closed `lifecycle`, `command`, and `tool` classes. The same test then passed `1/1`.

### Round-3 GREEN and fresh verification

```text
Focused projector/contract/browser GREEN
Test Files  2 passed (2)
Tests       5 passed, 34 skipped

Full Task 7.10 plus API contract/application projection matrix
Test Files  8 passed (8)
Tests       114 passed (114)

Adjacent Tasks 7.6-7.9 matrix
Test Files  13 passed (13)
Tests       459 passed (459)

pnpm typecheck
$ tsc -b --pretty false
exit 0

pnpm build
129 modules transformed
bootstrap CSS 17.66 kB (gzip 4.13 kB)
bootstrap JS 342.82 kB (gzip 101.57 kB)
exit 0

pnpm test
Test Files  61 passed (61)
Tests       1254 passed (1254)
exit 0
```

Coverage includes non-lifecycle same-key progress/snapshot records; item completed,
failed, declined, and interrupted terminals with unknown or unsupported status; true
tool lifecycle; same-key mixed item/tool domains; repeated phase mismatches; repeated
start/start/terminal and start/terminal/terminal segments; separated true pairs with
unique instance keys; recorder recovery and unknown-kind independence; and strict DTO
rejection of future descriptor values or raw event type/item/tool fields.

Fresh `git diff --check` and scope/privacy/static scans passed. The round-3 production
diff contains only the API contract descriptor, application projection, and Task 7.10
browser grouping. Fixture migrations add the required nullable field. There are no
content/native/evidence/artifact fetches, polling, browser storage, token handling,
absolute user paths, source maps, prototype references, favicon work, or Task 7.11-7.14
changes. `.scratch-e2e-ONFuP0/` remains untouched and untracked.

### Round-3 browser limitation and residual

The required in-app browser binding again returned `Module not found: agent/browser`.
No standalone substitute was used. Fresh 1440/1100 visual confirmation that a true
command pair compacts while progress/snapshot stays separate remains the only release
residual. The exact projector-to-browser behaviors are covered automatically.

### Round-3 changed files

- `packages/api-contract/src/events.ts` and `packages/api-contract/test/contracts.test.ts`:
  closed lifecycle descriptor and strict/privacy contract coverage.
- `packages/application/src/api/projectors.ts` and
  `packages/application/test/apiProjection.test.ts`: exact allowlisted source-event
  projection with null fallback and raw-source privacy assertions.
- `apps/web/src/trajectory/projectTrajectory.ts` and
  `apps/web/test/projectTrajectory.test.ts`: descriptor-only grouping and end-to-end
  projector-to-browser regression coverage.
- `apps/web/test/mergePages.test.ts`, `runList.test.tsx`, `trajectory.test.tsx`, and
  `trajectoryPages.test.tsx`: required closed DTO fixture migration only.
- this report.

## Residual risk

The relationship overlay intentionally renders only a compact selected/visible
connector treatment; richer geometry and inspector evidence expansion remain outside
Task 7.10. Browser verification used deterministic disposable fixtures rather than a
live recording, and covered the required 1440/1100 widths, not the Task 7.13 800-pixel
final polish target. No other known Task 7.10 residual remains.

## Review-fix round after `69ccffa`

All seven confirmed Important findings were fixed within Task 7.10:

- abortable initial/selection/cursor request ownership checks every identity and
  abort signal before state commits and resets all run-scoped state;
- exact compatible `thread`/`turn` start-terminal pairing, immutable per-instance
  keys, per-run expansion reset, and event-identity scroll anchoring;
- candidate merge validation before state commits, bounded contradiction errors,
  cursor snapshot lineage, compatible gap rules, and canonical structural equality;
- present-invalid duplicate/empty/malformed `?event=` handling without resolution;
- a bounded extra virtual focus row so End/Home destinations mount with the sole
  `tabIndex=0`, with nested controls non-tab and row-accessible;
- exact relationship dedupe and live selected-visible SVG geometry between row
  centers, updated on layout/scroll/resize, with `pointer-events: none`;
- labeled recorder start/end/duration, likely tests, assessment provenance,
  warnings, and contradictions in the header via shared run-fact formatters.

### Review-fix RED evidence

```text
pnpm vitest --run apps/web/test/trajectoryPages.test.tsx -t "trajectory request ownership"
3 failed: old run, selection, and cursor results committed after replacement/abort.

pnpm vitest --run apps/web/test/projectTrajectory.test.ts
4 failed, 3 passed: incompatible/repeated phases grouped; instance keys collided.

pnpm vitest --run apps/web/test/mergePages.test.ts apps/web/test/trajectoryPages.test.tsx \
  -t "snapshot|topology|structurally|merge containment"
4 failed: snapshot/topology/canonical equality failed and render merge escaped containment.

pnpm vitest --run apps/web/test/runList.test.tsx -t "present .* event query"
1 failed, 2 passed: duplicate query values were silently absent.

pnpm vitest --run apps/web/test/trajectory.test.tsx \
  -t "virtual End|relationship controls|resets expanded"
2 failed, 1 passed: End focus ownership and nested tab stop failed.

pnpm vitest --run apps/web/test/projectTrajectory.test.ts -t "scroll anchor"
1 failed: immutable event-to-row anchor resolver was absent.

pnpm vitest --run apps/web/test/trajectory.test.tsx -t "selected visible connectors"
1 failed: duplicates rendered and the fixed spans exposed no row geometry.

pnpm vitest --run apps/web/test/runHeader.test.tsx
2 failed: frozen timing/test/assessment/signal facts were absent.
```

### Review-fix GREEN and regression evidence

```text
Focused Task 7.10 matrix
Test Files 6 passed (6)
Tests      50 passed (50)

Adjacent Tasks 7.6-7.9 matrix
Test Files 13 passed (13)
Tests      459 passed (459)

pnpm typecheck
$ tsc -b --pretty false
exit 0

pnpm build
129 modules transformed
bootstrap CSS 17.51 kB (gzip 4.11 kB)
bootstrap JS 341.21 kB (gzip 101.13 kB)
exit 0

pnpm test
Test Files 61 passed (61)
Tests      1237 passed (1237)
exit 0

git diff --check
exit 0
```

Source scans found no active polling, browser storage, bearer/token handling,
content/native/evidence/artifact fetches, absolute user paths, or design-prototype
references in changed source/tests. The existing untracked `.scratch-e2e-ONFuP0/`
directory was not read, edited, staged, or committed.

### Browser limitation and residual

The in-app browser runtime returned `No browser is available` during this fix round.
No standalone substitute was used. The earlier browser observations therefore are not
fresh evidence for this changed build. Fresh 1440/1100 checks for 10/250/1,000 events
remain a release residual, especially real scroll stability, connector placement after
resize, overflow, console/network cleanliness, and stale-race browser timing.

Automated DOM coverage does verify bounded 10/50/250/1,000 rows, virtual End/Home,
one row tab stop, non-tab nested controls, dedupe, row-center geometry, off-screen
jumps, deep-link cardinality, group reset, and stale promises. No other known Task
7.10 code residual remains after the focused, adjacent, type, build, and full suite.

## Review-fix round 2 after `7efa195`

The four confirmed Important findings were reproduced and fixed within Task 7.10:

- the closed browser projector now compacts exact contiguous command/tool
  start-terminal pairs, validates domain and phase, and treats each maximal repeated
  segment as non-groupable rather than reconsidering a trailing pair;
- each committed cursor page records its requested direction and opaque cursor, so a
  terminal empty response clears only that exact current outer boundary;
- the virtualizer pins a distant row only during an explicit keyboard focus transfer;
  after outside focus plus manual scrolling, the sole roving entry moves to a truly
  visible row while Home/End/Arrow remount behavior remains intact;
- each row is a documented single-tab-stop keyboard composite. Left/Right chooses
  primary/immutable-event/expand/relationship actions and Enter/Space invokes the
  current action. Exact relationships remain independently labeled even when their
  events share a collapsed row, same-element SVG lines are suppressed, and geometry
  also remeasures through a bounded window-resize fallback.

No DTO expansion was needed: grouping uses the existing closed presentation-class and
status enums plus the opaque lifecycle key. The existing API projection/privacy tests
remain green and continue to prove that raw item/tool/source identifiers do not cross
the HTTP projection boundary.

### Round-2 RED evidence

```text
pnpm vitest --run apps/web/test/projectTrajectory.test.ts \
  -t "item start|mismatched command"
Tests       2 failed, 1 passed
Failure     command and tool start-terminal pairs each remained two rows

pnpm vitest --run apps/web/test/mergePages.test.ts \
  -t "empty cursor response|repeated or nonmatching"
Tests       2 failed
Failure     terminal empty cursor responses left the consumed outer cursor available

pnpm vitest --run apps/web/test/trajectory.test.tsx \
  -t "outside focus and manual scroll"
Tests       1 failed
Failure     the only tabIndex=0 row remained event-1 after scrolling to row 41

pnpm vitest --run apps/web/test/trajectory.test.tsx \
  -t "selected visible connectors|grouped-event, expansion|same-group relationship"
Tests       3 failed
Failures    resize retained y2=230; nested buttons remained; same-row relationship
            had neither a labeled action nor a suppressed zero-length connector
```

An explicit repeated-command regression added during diff review found one further
edge in the same first root cause before completion:

```text
pnpm vitest --run apps/web/test/projectTrajectory.test.ts \
  apps/web/test/trajectoryPages.test.tsx
Test Files  1 failed, 1 passed
Tests       1 failed, 17 passed
Failure     after rejecting start/start/terminal, the projector reconsidered the
            second start plus terminal as a fresh compact pair
```

The maximal-segment guard fixed that edge; the same command then passed `18/18`.

### Round-2 focused GREEN and fresh verification

```text
pnpm vitest --run apps/web/test/projectTrajectory.test.ts \
  apps/web/test/mergePages.test.ts apps/web/test/trajectoryPages.test.tsx \
  apps/web/test/trajectory.test.tsx apps/web/test/runList.test.tsx \
  apps/web/test/runHeader.test.tsx packages/application/test/apiProjection.test.ts
Test Files  7 passed (7)
Tests       84 passed (84)

Adjacent Tasks 7.6-7.9 matrix
Test Files  13 passed (13)
Tests       459 passed (459)

pnpm typecheck
$ tsc -b --pretty false
exit 0

pnpm build
129 modules transformed
bootstrap CSS 17.66 kB (gzip 4.13 kB)
bootstrap JS 343.04 kB (gzip 101.68 kB)
exit 0

pnpm test
Test Files  61 passed (61)
Tests       1247 passed (1247)
exit 0
```

Fresh `git diff --check` passed. Scope/privacy/static scans found no active polling,
browser storage, cookie/bearer/token handling, content/native/evidence/artifact fetch,
absolute user path, source map, prototype reference, favicon change, or Task 7.11-7.14
file in the round-2 diff. The untracked `.scratch-e2e-ONFuP0/` directory remains
untouched and excluded from staging.

### Round-2 browser limitation and residual

The required in-app browser binding was queried after the production build and
returned `Module not found: agent/browser`. No standalone or prohibited substitute
was used. Fresh 1440/1100 browser checks for 10/250/1,000 events therefore remain a
release residual, specifically the real command-pair presentation, manual-scroll Tab
re-entry, delayed Home/End/Arrow transfer, accessibility snapshot/action keys,
ordinary and same-row relationship presentation, resize geometry, overflow, console,
network, local-resource, and token checks.

Automated coverage verifies all corresponding structural behavior, including exact
command/tool pairing, repeated/mismatched/separated protection, hook-level empty-cursor
consumption, 1,000-row manual scroll re-entry, single-tab-stop keyboard access to both
immutable grouped events and every relationship action, same-row labels without a
connector, connector resize geometry, dedupe, DTO privacy, and the complete prior
Task 7.10 review-fix matrix. No other known Task 7.10 residual remains.

### Round-2 changed files

- `apps/web/src/trajectory/projectTrajectory.ts` and
  `apps/web/test/projectTrajectory.test.ts`: closed command/tool compatibility and
  maximal repeated-segment validation.
- `apps/web/src/trajectory/useTrajectoryPages.ts`,
  `apps/web/test/mergePages.test.ts`, and `apps/web/test/trajectoryPages.test.tsx`:
  request-aligned cursor lineage and pure/hook boundary-consumption coverage.
- `apps/web/src/trajectory/Trajectory.tsx`, `TrajectoryRow.tsx`,
  `RelationshipOverlay.tsx`, `apps/web/src/styles/trajectory.css`, and
  `apps/web/test/trajectory.test.tsx`: visible roving entry, composite row actions,
  same-row relationship semantics, resize fallback, and focused virtual interaction
  coverage.
- this report.

## Review-fix round 4 after `d49bd5f`

The remaining Important browser finding was reproduced before implementation. The
inner event option carried canonical sequence in TanStack Virtual's reserved
`data-index`, and that same inner element was passed to `measureElement`. A compact
row whose primary event was sequence 42 therefore attempted to measure virtual item
42 rather than virtual item 0; an around-sequence window beginning at 500 attempted to
measure virtual item 500. Both were outside their two-row virtual windows, leaving the
144-pixel estimate and overlapping the taller first row.

The narrow fix gives each complete positioned `.trajectory-virtual-row` wrapper its
actual virtual `data-index` and TanStack measurement ref. The inner role-option keeps
only `data-sequence` plus its event ID and remains the sole focus and relationship-
geometry element. Overscan, row bounds, selection, scroll anchoring, and relationship
geometry are otherwise unchanged.

### Round-4 RED evidence

The first run used the repository test script with a file argument; that script runs
the whole workspace. It produced the two new offset failures plus the existing manual-
scroll assertion after the test was updated to the intended `data-sequence` contract:

```text
pnpm test -- apps/web/test/trajectory.test.tsx
Test Files  1 failed, 60 passed (61)
Tests       3 failed, 1253 passed (1256)
Failures    compact virtual row 1 stayed at 144px instead of 220px;
            around-window virtual row 1 stayed at 144px instead of 196px;
            inner rows did not yet expose data-sequence for manual-scroll entry
```

These failures directly demonstrated the production break: TanStack could not apply
the measured wrapper heights when the measured nodes advertised canonical sequences.

### Round-4 GREEN and fresh verification

```text
Focused trajectory GREEN
pnpm exec vitest --run apps/web/test/trajectory.test.tsx
Test Files  1 passed (1)
Tests       15 passed (15)

Full Task 7.10 matrix
Test Files  8 passed (8)
Tests       116 passed (116)

Adjacent Tasks 7.6-7.9 matrix
Test Files  13 passed (13)
Tests       459 passed (459)

pnpm typecheck
$ tsc -b --pretty false
exit 0

pnpm build
129 modules transformed
bootstrap CSS 17.66 kB (gzip 4.13 kB)
bootstrap JS 342.80 kB (gzip 101.56 kB)
exit 0

pnpm test
Test Files  61 passed (61)
Tests       1256 passed (1256)
exit 0

git diff --check
exit 0
```

The focused regression suite now proves that a 220-pixel compact lifecycle wrapper at
virtual index 0 advances its adjacent wrapper to 220 pixels even though its primary
canonical sequence is 42, and that a 196-pixel around-window wrapper does the same for
canonical sequences 500/501. It also verifies non-overlap, virtual indices only on
wrappers, canonical sequence only on inner rows, inner-option focus ownership, and
connector endpoints measured from the actual inner event rows.

Fresh source-addition scans found no polling/timers, browser storage/cookies,
bearer/bootstrap-token handling, unsafe HTML, content/native/artifact/evidence fetches,
external URLs, or absolute user paths. The production build contains no source maps,
absolute user paths, scratch/prototype references, or source-map trailers. The round-4
diff contains no Task 7.11-7.14, favicon, Playwright/E2E, assessment, evidence, or
prototype files. `.scratch-e2e-ONFuP0/` remains untouched, untracked, and excluded from
staging.

### Round-4 browser limitation and residual

After the latest production build, the in-app browser runtime reported `No browser is
available`; the required troubleshooting discovery returned an empty browser list.
No standalone or prohibited substitute was used. Fresh 1440x1000 and 1100x900 checks
for compact wrapped lifecycle rows, nonzero-sequence around windows, real rectangle
overlap, hit testing, focus/connectors, 10/250/1,000 bounded rows, overflow,
console/network cleanliness, token absence, and reload therefore remain an explicit
release residual. Automated tests cover the underlying measurement and interaction
contracts, but they are not claimed as visual browser evidence.

### Round-4 changed files

- `apps/web/src/trajectory/Trajectory.tsx`: measure the complete positioned wrapper
  by virtual index while keeping event-row refs separate.
- `apps/web/src/trajectory/TrajectoryRow.tsx`: expose canonical sequence as
  non-reserved `data-sequence` metadata.
- `apps/web/test/trajectory.test.tsx`: variable-height compact/around measurement,
  non-overlap, wrapper/inner metadata, focus, connector, and manual-scroll coverage.
- this report.

## Review-fix round 5 after `29c5e05`

The final Important finding was reproduced before implementation. Expansion removed
the stable `lifecycle_group` projection and replaced it with two independently keyed
event rows. Only `lifecycle_group` rows expose the group toggle, so the expanded
presentation had no way to collapse. The key replacement also unmounted the focused
composite and discarded its current action state.

The fix retains the exact lifecycle-instance row and key in both states. Its
`expanded` flag now controls whether the measured wrapper shows the compact terminal
presentation or both immutable source events as distinct, canonical-order member
cards. The same one-tab-stop composite continues to select either event, announce and
invoke Expand/Collapse, and expose relationship actions. An inline wrapper measurement
callback remeasures the stable DOM node when its expanded content grows or shrinks.

### Round-5 RED evidence

```text
pnpm exec vitest --run apps/web/test/projectTrajectory.test.ts \
  apps/web/test/trajectory.test.tsx
Test Files  2 failed (2)
Tests       5 failed, 30 passed (35)
Failures    expanded projection returned two event rows instead of one stable group;
            separated expanded pair lost its instance row/key;
            expanded UI had no immutable member cards or Collapse action;
            same-group relationships became separate rows;
            per-run reset test observed two expanded options
```

### Round-5 GREEN and fresh verification

```text
Direct projector/trajectory GREEN
Test Files  2 passed (2)
Tests       35 passed (35)

Full Task 7.10 plus contract/projection matrix
Test Files  8 passed (8)
Tests       117 passed (117)

Adjacent Tasks 7.6-7.9 matrix
Test Files  13 passed (13)
Tests       459 passed (459)

pnpm typecheck
$ tsc -b --pretty false
exit 0

pnpm build
129 modules transformed
bootstrap CSS 18.04 kB (gzip 4.18 kB)
bootstrap JS 343.61 kB (gzip 101.74 kB)
exit 0

pnpm test
Test Files  61 passed (61)
Tests       1257 passed (1257)
exit 0

git diff --check
exit 0
```

Coverage verifies compact -> expand -> collapse -> expand with the identical instance
key; canonical immutable-member order; independent separated groups; run-navigation
reset; keyboard and mouse toggles; event selection in both states; correct current-
action announcements; one tab stop; stable focused row/wrapper identity; wrapper
growth from 220 to 360 pixels and shrink back without overlap; ordinary connector
geometry; and same-row relationship labeling without a zero-length connector. No
entry animation or motion behavior was added.

Fresh source-addition scans found no polling/timers, browser storage/cookies,
bearer/bootstrap-token handling, unsafe HTML, content/native/artifact/evidence fetches,
external URLs, absolute user paths, or animation/transition additions. The production
build contains no source maps, absolute user paths, scratch/prototype references, or
source-map trailers. The diff contains only Task 7.10 trajectory source, styles,
tests, and this report; `.scratch-e2e-ONFuP0/` remains untouched and untracked.

### Round-5 browser limitation and residual

The in-app browser runtime was retried against the latest production build and again
reported `No browser is available`. No standalone or prohibited substitute was used.
The mandatory 1440x1000 and 1100x900 visual matrix therefore remains unverified:
repeated real Expand/Collapse interaction, wrapped hit testing, focus/action keys,
rectangle boundaries, connector presentation, 10/250/1,000 bounded DOM, nonzero
around windows, overflow, console/network cleanliness, token absence, local assets,
and reload are explicit release residuals. Automated DOM coverage is not claimed as
visual browser evidence.

### Round-5 changed files

- `apps/web/src/trajectory/projectTrajectory.ts`: retain one stable expanded group.
- `apps/web/src/trajectory/TrajectoryRow.tsx` and `apps/web/src/styles/trajectory.css`:
  canonical member cards plus accessible repeated Expand/Collapse presentation.
- `apps/web/src/trajectory/Trajectory.tsx`: remeasure the stable wrapper after toggles.
- `apps/web/test/projectTrajectory.test.ts` and `apps/web/test/trajectory.test.tsx`:
  pure identity, repeatable interaction, measurement, focus, selection, relationship,
  separated-group, and run-reset regressions.
- this report.

## Review-fix round 6 after `e878bed`

The final accessibility finding was reproduced with real controlled selection state.
Although the URL/inspector selection could move to the immutable start event, the
stable composite row continued to derive its presentation and first action from the
terminal member. Its selection-change effect also reset the action cursor to that
terminal action. The focused option therefore announced and reselected the terminal
event after the start event had become the actual selection.

The narrow fix derives an active member from the controlled `selectedEventId`, falling
back to the terminal presentation only when no group member is selected. Presentation,
metadata, relationships, click behavior, and the first select action now use that
active member. A member-scoped action cursor is reset synchronously when the controlled
member changes, so no effect race can revive an action belonging to a previously
selected member. Stable group identity, canonical member order, the single tab stop,
repeatable Expand/Collapse, wrapper measurement, and relationship geometry remain
unchanged.

### Round-6 RED evidence

```text
pnpm exec vitest --run apps/web/test/trajectory.test.tsx \
  -t "controlled selected lifecycle member"
Test Files  1 failed (1)
Tests       1 failed, 16 skipped (17)
Failure     controlled selection changed to controlled-start, but the focused option
            still exposed data-event-id="controlled-terminal"
```

The first GREEN attempt correctly changed the row presentation but exposed a second
part of the same action-cursor bug: after switching terminal -> start, the old start
context resumed its prior Collapse action. The final member-scoped cursor reset keeps
the current action at `Select event <selected member>` for every external or internal
selection transition.

### Round-6 GREEN and fresh verification

```text
Focused controlled-selection regression
Test Files  1 passed (1)
Tests       1 passed, 16 skipped (17)

Direct projector/trajectory GREEN
Test Files  2 passed (2)
Tests       36 passed (36)

Full Task 7.10 plus contract/projection matrix
Test Files  8 passed (8)
Tests       118 passed (118)

Adjacent Tasks 7.6-7.9 matrix
Test Files  13 passed (13)
Tests       459 passed (459)

pnpm typecheck
$ tsc -b --pretty false
exit 0

pnpm build
129 modules transformed
bootstrap CSS 18.04 kB (gzip 4.18 kB)
bootstrap JS 343.66 kB (gzip 101.77 kB)
exit 0

pnpm test
Test Files  61 passed (61)
Tests       1258 passed (1258)
exit 0

git diff --check
exit 0
```

The new controlled regression exercises the production rerender path rather than
merely spying on `onSelect`. It proves terminal default presentation, keyboard
selection of the start member, active start summary/status/sequence/relationship and
current-action announcements, Enter stability, external movement between both
members, expanded mouse selection of both immutable members, stable focus, and exactly
one roving tab stop.

Fresh source-addition scans found no polling/timers, browser storage/cookies,
bearer/bootstrap-token handling, unsafe HTML, content/native/artifact/evidence fetches,
external URLs, or absolute user paths. The production build contains no source maps,
absolute user paths, scratch/prototype references, or source-map trailers. The source
still reserves `data-index` exclusively for virtual wrappers and uses `data-sequence`
for inner event metadata. The round-6 diff is limited to the grouped-row component,
its focused trajectory regression, and this report; `.scratch-e2e-ONFuP0/` remains
untouched, untracked, and excluded from staging.

### Round-6 browser evidence boundary and residual

No browser verification was performed or claimed in this round; the reviewer owns the
real-browser acceptance evidence. Automated controlled-state coverage verifies the
reported semantics but is not a substitute for confirming the focused option's spoken
announcement in the in-app browser.

### Round-6 changed files

- `apps/web/src/trajectory/TrajectoryRow.tsx`: selected-member presentation and
  deterministic member-scoped current action.
- `apps/web/test/trajectory.test.tsx`: controlled keyboard/mouse selection regression.
- this report.
