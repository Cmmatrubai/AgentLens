# Task 7.10 implementation report

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

## Residual risk

The relationship overlay intentionally renders only a compact selected/visible
connector treatment; richer geometry and inspector evidence expansion remain outside
Task 7.10. Browser verification used deterministic disposable fixtures rather than a
live recording, and covered the required 1440/1100 widths, not the Task 7.13 800-pixel
final polish target. No other known Task 7.10 residual remains.
