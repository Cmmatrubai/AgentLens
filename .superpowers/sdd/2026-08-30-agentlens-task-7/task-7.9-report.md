# Task 7.9 implementation report

## Independent review hardening (2026-08-31)

The focused review-fix round from `898695c6300d996b44741ff1399573612e634083`
closed all five confirmed findings without entering Task 7.10:

1. Run IDs now use one exported browser-addressable contract across run-list/detail/
   trajectory DTOs, application projection, server route decoding, API-client paths,
   and ledger links. Slash, percent, spaces, and Unicode resolve through list and
   detail; URL dot segments, controls, overlength values, and malformed surrogates
   fail closed. The broader event-ID contract remains separate.
2. Response-body aborts now become sanitized non-retryable `request_aborted` errors.
   Redirect, invalid-media, invalid-length, read-error, and overflow paths perform
   best-effort cancellation without allowing cancellation failures or raw stream
   errors to escape, and every acquired reader is released.
3. Browser-visible millisecond timestamps are bounded to the ECMAScript Date domain
   (`0..8_640_000_000_000_000`) in the shared contract. Projectors reject larger
   persisted values before a DTO can reach an unguarded Date formatter.
4. Every bounded row text region is shrinkable and uses robust wrapping. Repository
   fingerprints no longer use ellipsis, so the 256-character stress fixture keeps
   the evidence visible instead of forcing multi-thousand-pixel overflow or hiding it.
5. Empty unfiltered first pages retain the first-trace prompt. Filtered or cursor
   pages now say exactly `No runs match these filters` and never display the recording
   command.

### Review-fix RED evidence

Each production correction followed a focused failing test:

```text
Run-ID contract RED
Test Files  3 failed | 1 passed (4)
Tests       6 failed | 37 passed (43)
Observed   exported run schema undefined; all four list/detail special IDs returned 400

Body-stream RED
Test Files  1 failed (1)
Tests       4 failed | 6 passed (10)
Observed   raw body AbortError escaped; early rejects did not cancel; cancel failure escaped

Timestamp RED
Test Files  2 failed | 1 passed (3)
Tests       2 failed | 51 passed (53)
Observed   timestamp schema absent; MAX_SAFE_INTEGER projector input did not fail

800px containment RED
Test Files  1 failed (1)
Tests       1 failed | 6 passed (7)
Observed   shrinkable row regions had no min-width containment

Filtered/cursor empty RED
Test Files  1 failed (1)
Tests       4 failed | 7 passed (11)
Observed   every constrained empty page rendered `No runs recorded`
```

### Review-fix GREEN evidence

```text
pnpm vitest run packages/api-contract/test/contracts.test.ts \
  packages/application/test/apiProjection.test.ts \
  apps/server/test/readApi.integration.test.ts \
  apps/server/test/security.integration.test.ts \
  apps/web/test/apiClient.test.ts \
  apps/web/test/runList.test.tsx \
  apps/web/test/buildOutput.test.ts \
  apps/web/test/fixtureDataRoot.test.ts
Test Files  8 passed (8)
Tests       101 passed (101)
```

The first repository-wide run exposed one timing failure in the pre-existing crash
recovery integration test (`Timed out waiting for durable open provider work`) while
the rest of the suite passed. The test passed alone (`1/1`, 1.62s), and a clean full
rerun passed:

```text
pnpm test
Test Files  56 passed (56)
Tests       1198 passed (1198)
```

Fresh type/build and containment checks after the final source edit:

```text
pnpm typecheck
$ tsc -b --pretty false
exit 0

pnpm build
112 modules transformed
assets/bootstrap-u5JZXtmU.css  12.01 kB
assets/bootstrap-HxuWf7Ls.js  293.85 kB
exit 0

git diff --check
exit 0

external asset / sourceMappingURL / design-prototype scan
no matches

fixture bearer / consumed one-use bootstrap token scan
no matches

find apps/server/dist/web -type f -name '*.map'
no files
```

## Result

Implemented the production AgentLens web workspace, closure-authenticated loopback API
client, compact instrument shell, and evidence-dense `/runs` ledger from base
`279ea8ba1afa7a213d52b5b0734d02ceee52f485`.

The ledger consumes the closed Task 7 run-list DTO, preserves server-owned evidence
semantics, provides URL-addressable server-side status/repository/assessment filters,
and renders canonical plus unsupported lifecycle states without inventing success,
authorship, file-read, test, Git, or human-review claims. `/runs/:runId` remains only a
bounded Task 7.9 shell. No Task 7.10 trajectory, evidence inspector, assessment editor,
polling, release journey, hosted behavior, recording control, grading, comparison, or
export was added.

## TDD evidence

### Authenticated client and run ledger RED/GREEN

The required client and run-ledger tests were written before implementation. After
the test setup import was corrected, the exact focused run failed because both
production modules were absent:

```text
pnpm vitest --run apps/web/test/apiClient.test.ts apps/web/test/runList.test.tsx
Test Files  2 failed (2)
Reason      Cannot resolve ../src/api/client.js and ../src/app/App.js
```

After the smallest client/shell/ledger implementation:

```text
pnpm vitest --run apps/web/test/apiClient.test.ts apps/web/test/runList.test.tsx
Test Files  2 passed (2)
Tests       9 passed (9)
```

Those suites cover closure-only bearer observability, loopback-origin validation,
deterministic closed URLs, exact-once ID encoding, authorization/JSON/abort behavior,
redirect/non-JSON/malformed/oversized/Zod rejection, sanitized typed errors, every
canonical and unsupported status, evidence-language negatives, projected and human
review, likely-test history, capture-policy unavailability, Git/HEAD/branch/untracked
facts, warnings/contradictions, URL filters, and explicit loading/empty/error/auth
states.

### Browser-found defects closed with RED/GREEN tests

The first real browser pass exposed narrow integration defects. Each received a
failing test before its fix:

1. Local `.woff` fallbacks were served as `application/octet-stream`.

```text
pnpm vitest --run apps/server/test/security.integration.test.ts -t "serves locally bundled WOFF"
Tests  1 failed (expected font/woff, received application/octet-stream)
```

After adding only the `.woff` media type, the focused test passed.

2. The built manifest entry did not retain the exported `boot` function.

```text
pnpm vitest --run apps/web/test/buildOutput.test.ts
Tests  1 failed (expected typeof module.boot to be function, received undefined)
```

`preserveEntrySignatures: "strict"` retained the stable entry export; the test passed.

3. Vite emitted entry CSS separately, but the server shell imported only JavaScript.

```text
pnpm vitest --run apps/server/test/security.integration.test.ts -t "loads only manifest-bound entry styles"
Tests  1 failed (bootstrap shell lacked the manifest-bound stylesheet link)
```

The static-asset loader now returns only validated entry stylesheet URLs, and both
bootstrap/reload shells include those exact allowlisted URLs. The combined WOFF/CSS
security run passed `2/2`.

4. A build invoked from Vitest inherited `NODE_ENV=test`, producing development React
bytes. A production-build assertion failed on `Download the React DevTools`. The
test-owned build now sets `NODE_ENV=production`; the focused build-output test passes
and prevents the fixture verifier from overwriting production assets with a test-mode
bundle.

5. The browser fixture's terminal commands used a noncanonical native event type and
legacy command payload shape, so the real list endpoint conservatively projected zero
terminal commands and no likely tests.

```text
pnpm vitest --run apps/web/test/fixtureDataRoot.test.ts
Tests  1 failed (expected 2 terminal commands, received 0)
```

The fixture now uses `item.completed`/`item.failed` plus structured
`commandEvidence`. The test passes and proves two attempts with latest `passed` and
one previous failure.

6. The bounded detail shell used a document-navigation anchor for its return link,
which would discard the memory-only bearer and intentionally land on auth expiry.

```text
pnpm vitest --run apps/web/test/runList.test.tsx -t "semantic destination"
Tests  1 failed (document navigation instead of authenticated client routing)
```

Replacing only that anchor with a router `Link` preserved the memory-only session;
the focused test passes.

7. A direct reload of a URL-filtered ledger returned 404 because the reload shell
accepted only an empty query string.

```text
pnpm vitest --run apps/server/test/security.integration.test.ts -t "serves a token-free expired-authentication shell"
Tests  1 failed | 2 passed (filtered /runs reload expected 200, received 404)
```

The reload route now ignores the untrusted query rather than reflecting it and serves
the same token-free `boot(null)` shell. The focused reload matrix passes `3/3`.

## Implemented behavior

- Added the React/Vite workspace with local Geist Sans/Mono assets, stable manifest
  entry, no source maps, and production output under `apps/server/dist/web`.
- Added a same-origin `127.0.0.1` HTTP client whose bearer remains in a private lexical
  closure. Public client values are methods only; no token is placed in React state,
  props, context, query keys, DOM, URL/history, browser storage, or logs.
- Added bounded streaming JSON reads, strict media-type/redirect/schema checks,
  sanitized typed client/API errors, exact-once caller ID encoding, and abort
  distinction/forwarding.
- Added `boot(token)` production composition and `boot(null)` authentication expiry
  with no API client or query construction.
- Added one real Runs navigation destination, local-only connection state, labeled
  semantic filters, URL canonicalization, cursor reset on filter changes, semantic
  run destinations, exhaustive status wrappers, availability/provenance components,
  and honest server-projected evidence copy.
- Added explicit loading, empty, API-error, auth-expired, and unsupported-value states.
- Extended the hardened static-asset path only enough to expose validated entry CSS
  and the locally bundled WOFF media type. Existing manifest allowlisting, no-follow,
  containment, bounded-read, identity, and size-stability checks remain in force.
- Kept existing tests in Node; only `apps/web/test/**/*.test.tsx` uses jsdom.

## Changed files and scope justification

Plan-listed production/configuration files:

- `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`,
  `apps/web/index.html`, `apps/web/src/vite-env.d.ts`
- `apps/web/src/bootstrap.tsx`
- `apps/web/src/api/client.ts`, `queryKeys.ts`, `queries.ts`
- `apps/web/src/app/App.tsx`, `AppShell.tsx`, `ErrorState.tsx`
- `apps/web/src/runs/RunListPage.tsx`, `RunFilters.tsx`, `RunRow.tsx`
- `apps/web/src/components/Availability.tsx`, `ProvenanceMark.tsx`, `StatusBadge.tsx`
- `apps/web/src/styles/tokens.css`, `global.css`, `run-list.css`
- `apps/web/test/setup.ts`, `apiClient.test.ts`, `runList.test.tsx`
- `apps/web/test-support/fixtureDataRoot.ts`, `startFixtureUi.ts`
- `apps/server/src/staticAssets.ts`
- `package.json`, `tsconfig.json`, `vitest.workspace.ts`, `pnpm-lock.yaml`

Narrow supporting files required by real browser verification:

- `apps/web/test/buildOutput.test.ts`: stable importable production entry and
  production React regression.
- `apps/web/test/fixtureDataRoot.test.ts`: behavior-preserving real fixture summary.
- `apps/server/src/bootstrap.ts` and `apps/server/src/router.ts`: pass only
  manifest-validated entry styles into bootstrap/reload shells.
- `apps/server/test/security.integration.test.ts`: WOFF and manifest-bound CSS
  integration without weakening static-asset security.

Narrow post-review contract and test-support files:

- `packages/api-contract/src/time.ts`, `runs.ts`, `events.ts`, `assessment.ts`, and
  `index.ts`: shared run-ID and browser-timestamp boundaries.
- `apps/server/src/routes/routeContext.ts` and
  `apps/server/test/readApi.integration.test.ts`: shared route parsing plus special-ID
  list/detail integration.
- `packages/api-contract/test/contracts.test.ts` and
  `packages/application/test/apiProjection.test.ts`: contract/projector regressions.
- `apps/web/test-support/fixtureDataRoot.ts`: one 256-character stress row for the
  outstanding real-browser width recheck.

No `design-prototypes/`, `.scratch-e2e-ONFuP0/`, Task 7.10+ production path, provider
adapter, recorder, storage schema, derivation, or CLI read/write behavior was changed.

## Fresh verification

Focused Task 7.9 plus adjacent static-asset matrix:

```text
pnpm vitest --run apps/web/test/apiClient.test.ts apps/web/test/runList.test.tsx apps/web/test/buildOutput.test.ts apps/server/test/security.integration.test.ts
Test Files  4 passed (4)
Tests       30 passed (30)
```

Fixture projection:

```text
pnpm vitest --run apps/web/test/fixtureDataRoot.test.ts
Test Files  1 passed (1)
Tests       1 passed (1)
```

Repository-wide regression suite:

```text
pnpm test
Test Files  56 passed (56)
Tests       1180 passed (1180)
```

Type and production build:

```text
pnpm typecheck
$ tsc -b --pretty false
exit 0

pnpm build
$ tsc -b --pretty false && pnpm --filter @agentlens/web build
vite v5.4.21 building for production...
111 modules transformed
assets/bootstrap-LeYxQ1IP.css  11.26 kB
assets/bootstrap-BAH7z5LO.js  292.61 kB
exit 0
```

Manifest and asset scan:

```text
entryKeys       ["src/bootstrap.tsx"]
entryFiles      ["assets/bootstrap-BAH7z5LO.js"]
entryCss        ["assets/bootstrap-LeYxQ1IP.css"]
sourceMaps      []
externalCssRefs []
totalFiles      15

rg -n "design-prototypes|sourceMappingURL|https?://[^\"']+\\.(woff2?|css|js|png|svg)" apps/server/dist/web
no matches

rg -n "fixture-bearer|<one-use browser token values>" apps/server/dist/web apps/web/src
no matches

git diff --check
exit 0
```

The bundle contains no external asset reference or runtime dependency on the design
prototype. React/router diagnostic documentation strings are library text, not asset
URLs; the real browser made no external resource request.

## Prior real-browser evidence (pre-review-fix build)

This section records the real-browser review performed for the original Task 7.9
implementation. It is historical evidence, not a claim that the post-review CSS and
copy were freshly observed in a browser.

The fixture server was started with:

```text
pnpm exec tsx apps/web/test-support/startFixtureUi.ts --no-open
http://127.0.0.1:49203/bootstrap/<one-use-token>
```

The one-use token is intentionally omitted from this report. No screenshot file was
written inside the repository.

Observed at 1440x1000 after the final production build:

- five real projected rows loaded from SQLite through the authenticated API;
- no current-origin console logs or errors;
- `Geist Sans` and `Geist Mono Variable` both reported loaded;
- no external resource URLs and document `scrollWidth === 1440`;
- the recovery row read `Command lifecycle: 2 terminal · 1 failed` and
  `Latest likely test: passed · 1 previous failure`;
- human review, tracked final diff/untracked metadata availability, HEAD/branch
  changes, duplicate coded warnings, and provider limitations remained separate.

Observed responsive checks:

```text
1100x900: scrollWidth 1100; all five evidence dimensions visible
 800x900: scrollWidth  800; all five evidence dimensions visible
```

At 800 px the evidence grid becomes two columns/two rows without hiding lifecycle,
latest likely-test history, human review, final Git evidence, or provider limitations.
The visible run destination, rail, form controls, and evidence blocks remained usable.

Interaction/state evidence:

- selecting `Interrupted` and applying filters produced
  `/runs?limit=50&status=interrupted` and exactly one matching server-projected row;
- keyboard Tab focus landed on the Apply button with a visible two-ring focus shadow;
- an unmatched repository produced `No runs recorded`; the independent review
  correctly identified that copy as inaccurate, and the post-review component tests
  now require `No runs match these filters` for repository/status/assessment/cursor
  pages;
- direct `/runs` reload produced `Authentication expired` with no console diagnostics;
- stopping the fixture server then changing a filter produced the sanitized
  `Run evidence unavailable` / `AgentLens could not reach the local server.` state;
- loading was directly observed during the first authenticated query and is covered
  deterministically by the component test.

## Deviations and residual risks

0. Fresh post-review browser inspection was attempted against the rebuilt local
   fixture, but the browser runtime reported `No browser is available` and its
   troubleshooting inventory was empty (`[]`). No alternate browser backend or
   screenshot was substituted, and this report does not claim fresh 1440/1100/800
   observation. The real-browser width recheck remains outstanding; automated
   computed-style coverage and the 256-character real SQLite fixture are in place.

1. Vite's entry stylesheet is a separate manifest asset. The frozen file list named
   only `staticAssets.ts`, but real rendering required the narrow bootstrap/router
   plumbing and security tests described above. No arbitrary stylesheet URL is
   accepted; URLs originate only from the validated entry manifest.
2. Additional build-output and fixture-summary tests were added after real browser
   defects. They are verification infrastructure only and do not expand product scope.
3. The root `test:e2e` script intentionally points to the planned later
   `apps/web/playwright.config.ts` from the frozen plan. Task 7.9 browser review used
   the required fixture and in-app real browser; the committed Playwright release
   journeys/config remain Task 7.14 work.
4. Browser authentication is deliberately memory-only and one-use. Direct reload
   cannot recover a token and intentionally requires restarting `agentlens ui`.
5. Client response buffering is bounded to 4 MiB and schema-validated after complete
   receipt. Task 7.11 evidence endpoints may impose tighter DTO-specific limits, but
   this client does not accept an unbounded stream.
6. Secret detection remains risk reduction, not a guarantee. This task consumes only
   already-projected/redacted API DTOs and does not broaden capture claims.
