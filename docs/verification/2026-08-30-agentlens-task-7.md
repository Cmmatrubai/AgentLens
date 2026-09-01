# AgentLens Task 7 release verification

Date: 2026-09-01

## Outcome

Task 7.14 adds a deterministic production Playwright suite, public-API fixtures,
whole-root/HTTP privacy scans, source/compiled/offline packaging checks, temporary
visual captures, and this release record. It does not add a product feature.

Validation exposed three product defects. They were fixed in separate focused commits:

- `4c2340c` — source/compiled web-root resolution and the favicon no-store response.
- `6e45506` — WCAG AA contrast for trajectory timestamp text.
- `70f4a28` — compiled CLI direct-entry identity across the macOS `/var` path alias.

## Automated verification

Fresh commands after the last source edit:

| Command | Exit | Result |
| --- | ---: | --- |
| `pnpm test` | 0 | 68 test files passed; 1,349 tests passed. |
| `pnpm typecheck` | 0 | `tsc -b --pretty false` passed. |
| `pnpm build` | 0 | TypeScript and Vite production build passed; 551 modules transformed. |
| `pnpm test:e2e` | 0 | Chromium project `chromium-production`: 10/10 journeys passed, one worker, zero retries. |
| `git diff --check` | 0 | No whitespace errors. |
| `git status --short` | 0 | Only the protected pre-existing `.scratch-e2e-ONFuP0/` directory was reported untracked. |

The production build emitted one advisory for the 515.82 kB JavaScript chunk. The
hashed release output was 29.05 kB CSS (6.01 kB gzip) and 515.82 kB JavaScript
(154.96 kB gzip). This advisory is recorded, not represented as a build failure.

Playwright exercised 1440 x 1000, 1100 x 900, and 800 x 900 layouts. The suite covers
the one-use bootstrap, run filter/detail, failure and recorder recovery, explicit
normalized/native evidence, Final Git evidence, one assessment append, deliberate
token-free reload expiry, exact 1,000-event pagination and virtualization, keyboard
selection, reduced motion, 800-pixel inline evidence, active zero/tail/history/append/
terminal behavior, and a retryable 503 that retains valid evidence.

Every journey installs an auto-used collector before navigation. Teardown rejects
warning/error console output, external HTTP(S), unexpected same-origin responses at or
above 400, and failed requests even when the test body fails. The active-snapshot test
alone permits one exact `GET /api/v1/runs/fixture-running/events` 503. Chromium's exact
automatic console diagnostic for that consumed 503 is paired with it; other console
output still fails. Canceled duplicate same-origin fetches are accepted only when the
same method/origin/path already completed successfully; failed assets and other failed
requests remain failures. The intentional token-free reload waits for the successful
authentication-expired shell to finish loading.

The active fixture asserted owner-only physical modes for the database, WAL, and SHM
as `[0600, 0600, 0600]` before active reads. The production server read the committed
WAL snapshot; terminal reconciliation remained separate evidence. Existing storage,
server, application, and CLI regression suites rechecked immutable/no-WAL reads,
Host/Origin/CSP/no-store/loopback/bootstrap policy, evidence binding/integrity/size/
capture gates, atomic assessment ordering, and the absence of a generic artifact route.

## Privacy and packaging

Transient prompt, message, command, output, diff, note, native, provider-source,
database-path, artifact-path, repository-path, and raw standard bearer sentinels were
passed through public redaction/native/artifact APIs. Whole-data-root bytes, captured
HTTP headers/bodies, and server stderr contained none of the raw sentinels. Standard
capture retained only policy-permitted redaction/HMAC markers; metadata-only and strict
native/content inputs became omission-safe values before persistence. Browser checks
found no cookies, local/session storage, IndexedDB databases, surviving bootstrap
script, or bootstrap material in the post-bootstrap URL. These checks reduce privacy
risk; they are not a general proof that arbitrary future secrets can never escape.

The privacy journey synchronously registers every same-origin response header/body
promise, exercises the standard event detail, normalized content, and eligible native
payload plus metadata-only and strict event-detail omission surfaces, and drains the
whole registry after the final request settles. Durable-root bytes, raw response header
bytes, raw response bodies, and raw stderr bytes contain none of the named fixture
sentinels. Their complete redaction-marker set is exactly
`[[REDACTED:auth-bearer:hmac-sha256:c40257ce4c2ffc291e2b3506f3852709]]`;
no other redaction marker is accepted. This is controlled fixed-key fixture evidence,
not general secret-detection proof.

The packaging suite passed three production UI cases from independent fresh temporary
checkouts, avoiding shared build-output races with parallel tests:

- root `pnpm agentlens ui --data-root ... --no-open`;
- compiled `node apps/cli/dist/main.js ui --data-root ... --no-open`;
- a fresh `pnpm install --offline --frozen-lockfile` checkout using locally built
  server/web assets after every application/package `src` directory was removed.

All three served a hashed JavaScript asset, no-store bootstrap/API responses, and an
authenticated empty run list. Each was exercised once successfully and once with a
deliberate post-start verification failure. Every lifecycle ran in its own detached
process group, captured the actual listening server PID plus group members without
logging authorization, received group SIGTERM, and exited with 143. Before temporary
root removal, every recorded PID was absent, the group was empty, and the exact origin
port refused a connection. The tracked-file copy uses `git ls-files`, so it does not
traverse unrelated untracked workspace directories.

The 1,000-event Chromium journey captured all ten production API pages synchronously at
the response boundary. It asserted exact sequence windows `0–99` through `900–999`, the
literal ordered fixture IDs, no sequence/ID gaps or duplicates, nine unique later
cursors, and exact request-to-previous-page cursor chaining. Before every append it
scrolled within the loaded tail, recorded the visible roving event and pixel offset, and
required both to remain stable afterward. Mounted rows remained below 30. Home,
ArrowDown, Enter, and End proved exact focused and selected rows, URL event values, and
event-inspector identities for the second and final events.

## Observed visual evidence

The exact in-app Browser consumed a disposable one-use bootstrap and was inspected at
1440 x 1000, 1100 x 900, and 800 x 900. The ledger, medium run workspace, and selected
failed-command inline inspector retained hierarchy, provenance, status, assessment,
likely-test, Git, focus, and availability evidence without page overflow.

Additional temporary Playwright screenshots were inspected for the run ledger,
1,000-event trajectory, recorder recovery, tracked Final Git diff, assessment editor,
zero-event active state, active append, and the 800-pixel inline inspector. The captures
contained synthetic/path-neutral data only and were deleted after inspection. No
screenshots, trace, video, browser data root, bootstrap URL, or bearer value is kept in
the repository.

## Reviewer state, limitations, and residuals

- The first independent adversarial review at `4c5d145` rejected the gate with 0
  Critical and 4 Important findings covering privacy response capture/surfaces, shared
  browser failure collection, packaging process-tree cleanup, and exact trajectory
  identity/anchor assertions. Fix round 1 addresses all four; acceptance remains pending
  a fresh independent review.
- Automated axe found no critical or serious violation in the ledger/detail journey
  after the focused contrast correction. Automated axe does not replace the visual and
  keyboard observations above.
- Vite's chunk-size advisory remains an observed release residual.
- The first post-commit full-suite run had one concurrency-sensitive process-test
  failure: the crash-recovery recorder PID was already absent at its explicit SIGKILL
  (`ESRCH`). The focused crash-recovery test then passed 1/1, and the required whole
  suite passed 1,349/1,349 on the single diagnostic confirmation run. No product or
  harness change was made to mask this occurrence.
- A later final-matrix run exposed a harness race against shared Vite output: the
  compiled packaging server exited 1 while another test temporarily rebuilt that
  directory. Packaging now builds and runs inside per-case temporary checkouts; the
  focused corrected suite passed 3/3 before the final matrix.
- A temporary Final Git screenshot caught the bounded diff panel while its structured
  content was loading; the repeatable evidence journey separately waited for and
  asserted the loaded Final Git surface.
- During the first privacy RED, an unfiltered failed assertion rendered a consumed
  one-use bootstrap path in runner output. It was not committed or retained as an
  artifact; subsequent diagnostics filter to API paths. This is an implementation
  process deviation, not product evidence.
- No hosted, export, comparison, Claude, AGY, Insights, LLM, grading, WebSocket, or SSE
  scope was added.
