# AgentLens Task 7 release verification

Date: 2026-09-01

## Outcome

Task 7.14 adds a deterministic production Playwright suite, public-API fixtures,
whole-root/HTTP privacy scans, source/compiled/offline packaging checks, temporary
visual captures, and this release record. It does not add a product feature.

Validation exposed three original release defects. They were fixed in separate focused
commits:

- `4c2340c` — source/compiled web-root resolution and the favicon no-store response.
- `6e45506` — WCAG AA contrast for trajectory timestamp text.
- `70f4a28` — compiled CLI direct-entry identity across the macOS `/var` path alias.

The stricter round-three browser gates later exposed four additional product lifecycle
defects: fully settled active-poll, cursor-page, and event-selection requests retained
controller ownership, while an in-flight selection was also aborted when the selected
event arrived through a live append. The focused round-three product commits release
settled ownership, keep live selection ownership stable across ordinary event commits,
and retain abort cleanup for run or selection changes.

- `21392b1` — release settled active-poll controller ownership before terminal render.
- `5974688` — release settled cursor ownership after validated page commit.
- `96d3135` — release settled event-selection ownership while retaining in-flight aborts.
- `3819f6e` — retain live selection ownership when the selected event arrives in an append.

The request-boundary follow-up adds one shared E2E request-lifecycle ledger and one
focused initial-trajectory ownership correction. The ledger assigns every browser
request a monotonic start ID, exact active/finished/failed state, terminal order, and an
optional correlated run/events poll generation. Active run/events fetches share one
exact test-only correlation derived from their identical `AbortSignal`; every fetch has
a separate document-local request-instance identity. Checkpoints make action waits
ignore older duplicate requests. Raw transport and exact page-side fetch/body terminals
remain separately inspectable. The initial trajectory controller is released after
fulfilled or failed settlement, so later cleanup aborts only a genuinely in-flight
owned request.

## Automated verification

Fresh commands after the last source edit:

| Command | Exit | Result |
| --- | ---: | --- |
| final full `pnpm test` | 0 | 71 test files and 1,377 tests passed. |
| final focused ledger/guard tests | 0 | 2 files and 21 tests passed. |
| final `pnpm typecheck` | 0 | `tsc -b --pretty false` passed after the last TypeScript edit. |
| `pnpm build` | 0 | TypeScript and Vite production build passed; 551 modules transformed. |
| retained pre-review first strict `pnpm test:e2e` | 1 | 7/10 passed; exact request/poll instances `#16/4`, `#9/1`, `#10/1`, and `#13/3` were retained. |
| first post-review exact-ledger `pnpm test:e2e` | 1 | 9/10 passed; privacy retained four exact unconsumed native-JSON requests and timed out after 35 poll generations. |
| final post-fix `pnpm test:e2e` | 0 | 10/10 passed, one worker, zero configured retries; no active teardown request remained. |
| bounded strict privacy/active repetition | 0 | 30/30 passed: 10 privacy plus 20 active/recovery journeys; no active teardown request remained. |
| `git diff --check` | 0 | No whitespace errors. |
| safe tracked/scoped `git status --short` | 0 | Intended Task 7.14 changes remain in the current worktree; this follow-up does not represent them as committed. |

The production build emitted one advisory for the 516.16 kB JavaScript chunk. The
hashed release output was 29.05 kB CSS (6.01 kB gzip) and 516.16 kB JavaScript
(155.05 kB gzip). This advisory is recorded, not represented as a build failure.

Playwright exercised 1440 x 1000, 1100 x 900, and 800 x 900 layouts. The suite covers
the one-use bootstrap, run filter/detail, failure and recorder recovery, explicit
normalized/native evidence, Final Git evidence, one assessment append, deliberate
token-free reload expiry, exact 1,000-event pagination and virtualization, keyboard
selection, reduced motion, 800-pixel inline evidence, active zero/tail/history/append/
terminal behavior, and a retryable 503 that retains valid evidence.

Every journey installs the shared request ledger before navigation. Teardown rejects
warning/error console output, external HTTP(S), unexpected same-origin responses at or
above 400, and failed requests even when the test body fails. The active-snapshot test
alone permits one exact `GET /api/v1/runs/fixture-running/events` 503. Chromium's exact
automatic console diagnostic for that consumed 503 is paired with it; other console
output still fails. Cancellations retain stable Playwright request identity and raw
`requestfinished`/`requestfailed` evidence. Instrumented fetches additionally report the
exact request instance only after fetch rejection, body failure/cancellation, or full
body consumption. There is no cancellation exception or configurable allowance.
Mutations prove that the same request after headers, an unrelated abort, a different
query, and every duplicate abort remain failures; a genuine signal abort reports
`signal_aborted` even if another request succeeded.
Checkpoints and exact request identity replace URL-count bookkeeping throughout the
active, retry/recovery, assessment, privacy, run-list, and trajectory journeys. The
intentional token-free reload waits for the exact post-checkpoint completed-filter
request to finish before loading the successful authentication-expired shell.

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

The privacy journey synchronously registers every same-origin browser route, forwards
the original request without following redirects, captures each complete upstream
header/body promise, and fulfills the browser with the unchanged upstream bytes. It
exercises the standard event detail, normalized content, and eligible native
payload plus metadata-only and strict event-detail, `/content`, and `/native` surfaces,
and drains the growing registry at bounded interaction boundaries and after the final
request settles. A rejected body/header read is retained as a test failure rather than
substituted with empty bytes. All four denied explicit
surfaces return exact 404 `content_unavailable` envelopes. The existing browser bearer
is captured and reused only in lexical memory; it is never printed, persisted, placed in
the DOM, or added to a URL. Durable-root bytes, raw response header
bytes, raw response bodies, and raw stderr bytes contain none of the named fixture
sentinels. Their complete redaction-marker set is exactly
`[[REDACTED:auth-bearer:hmac-sha256:c40257ce4c2ffc291e2b3506f3852709]]`;
no other redaction marker is accepted. This is controlled fixed-key fixture evidence,
not general secret-detection proof.

The packaging suite passed three production UI modes from one private fresh temporary
checkout. It copies tracked files, installs offline, and builds exactly once, then uses
that checkout sequentially so no shared worktree output participates:

- root `pnpm agentlens ui --data-root ... --no-open`;
- compiled `node apps/cli/dist/main.js ui --data-root ... --no-open`;
- a fresh `pnpm install --offline --frozen-lockfile` checkout using locally built
  server/web assets after every application/package `src` directory was removed.

All three served a hashed JavaScript asset, no-store bootstrap/API responses, and an
authenticated empty run list. Each was exercised successfully, with a deliberate
post-start verification failure, and with a deliberate pre-return listener-discovery
failure: the original nine product server lifecycles. One additional compiled lifecycle
throws from the first post-spawn process-group hook. Every lifecycle ran in its own detached
process group and recorded wrapper/listener/group PIDs without logging authorization.
Central cleanup sends SIGTERM, awaits the wrapper/group/PIDs/port as one bounded state,
and sends SIGKILL if graceful or cleanup verification fails. Product lifecycles exited
with 143; a separate real SIGTERM-resistant helper exited by SIGKILL. Before temporary
root removal, every recorded PID was absent, the group was empty, and the exact origin
port refused a connection. A real dual-failure probe retains both the product-verification
and cleanup-verification errors after the resistant group is force-killed. The tracked-file copy uses `git ls-files`, so it does not
traverse unrelated untracked workspace directories.

The 1,000-event Chromium journey captured all ten production API pages through one exact
page-route transport: the original authorized browser request is forwarded to the
production server, the complete upstream body is parsed, and the same unchanged body is
fulfilled to the browser. Event-detail routes continue untouched. It asserted exact
sequence windows `0–99` through `900–999`, the
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
- The fix-round-1 rereview at `6cb07b2` rejected the gate with 0 Critical and 3
  Important findings: missing omitted-policy explicit HTTP routes, path-only/unbounded
  abort correlation, and absent pre-return cleanup/escalation. Its first exact browser
  matrix also failed 9/10 because one request remained active. Fix round 2 addresses all
  three findings and the browser race; acceptance remains pending another independent
  review.
- The fix-round-2 rereview at `94c5be4` rejected the gate with 0 Critical and 4
  Important findings: response-body capture could fail open, request completion and
  duplicate identity were conflated, the first post-spawn hook and dual-error provenance
  were incomplete, and its first exact unit matrix timed out in 3/1,353 cases. Fix round
  3 addresses those findings; acceptance remains pending another independent review.
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
- The rereview's first exact browser matrix passed 9/10; later reruns did not erase the
  failure. Round 2 reproduced it in a focused 4/5 run and identified the unsettled request
  as `GET /api/v1/runs?limit=50&status=completed`. The UI rendered the filtered response
  before Playwright emitted `requestfinished`; immediate reload could strand that tracked
  lifecycle. The normal journey now awaits that exact public network event before reload.
- Round 2's pre-return RED found one live group member after the synthetic listener-
  discovery rejection. Its resistant mutation also timed out when SIGKILL was removed.
  A later intermediate packaging run failed 1/4 because mutation restoration swapped the
  graceful and forced signals; inspection showed SIGKILL was sent first. Restoring the
  exact SIGTERM/SIGKILL order made focused packaging pass 4/4.
- Round 3's body-read mutation failed because a rejection became zero bytes; its request
  classifier mutations failed 2/5; its throwing-hook mutation observed a live group; and
  its dual-error mutation received only the cleanup error. The privacy and active browser
  journeys then exposed the exact navigation/polling races that the old exceptions had
  hidden. Focused final results were response capture 2/2, request classification 5/5,
  packaging 5/5, and active/privacy/reload 5/5.
- The rereview's first exact `pnpm test` passed 66/69 files and 1,350/1,353 tests. Its
  three failures were the bounded self-detached doctor, media-tamper read, and source
  packaging timeouts. The packaging file had performed three private offline installs
  and builds while Vitest ran other process tests in parallel. Focused measurement was
  29.83 seconds before consolidation and 18.06 seconds afterward; compiled and no-source
  cases fell to 0.66 and 0.58 seconds because they reuse the same private built checkout.
- The first decisive post-fix `pnpm test` passed 69/70 files and 1,357/1,358 tests but
  failed because the crash-recovery recorder exited before durable open work. The test
  then passed alone, beside packaging, and beside all six process-heavy files. A focused
  process-group assertion failed because the crash probe shared the suite group; the
  test-only recorder now owns an isolated POSIX group while its fake Codex child retains
  separate ownership. The real recovery journey passed 1/1 after that correction. This
  first failed full result is retained and is not replaced by focused evidence.
- The first corrected exact browser gate then passed 9/10 and reported one exact
  zero-event active `GET .../events?limit=100` abort. Replacing historical completion
  counts with next-request lifecycle boundaries reproduced settled
  `afterSequence=9`/terminal `afterSequence=11` abort behavior instead of hiding it.
  The focused hook regression failed because the last completed poll signal was
  aborted (`true` versus expected `false`). Clearing controller ownership immediately
  after both poll promises settle made that unit suite pass 14/14 and the real compiled
  active journeys pass 2/2. No cancellation allowance, retry, sleep, or timeout increase
  was added.
- The restarted exact browser gate then passed 8/10. Privacy failed closed while reading
  the strict event-page body because the capture drain had run before that response was
  registered; the exact 1,000-event journey reported an aborted cursor bounded after
  sequence 199. Privacy now awaits exact required-path registration before each drain
  and navigation. A focused cursor regression failed because loading the next page
  aborted the prior settled signal (`true` versus expected `false`). Clearing cursor
  ownership only after validated commit retained real in-flight cancellation; the
  focused unit set passed 24/24 and compiled privacy/trajectory passed 3/3. No failure
  allowance, retry, sleep, or timeout increase was added.
- The first exact browser gate after the two focused product commits then passed 7/10.
  Assessment ended with its post-save run refresh in flight; privacy had not required
  the run-list/run-detail bodies before navigation; trajectory parsed cursor bytes before
  Playwright's matching request lifecycle finished. Exact PUT/GET completion, required
  list/detail/events registration plus drain, and per-cursor body-plus-request completion
  now form those boundaries. The first combined focused run passed 3/4 and isolated the
  remaining initial run-list drain; the corrected privacy journey then passed 1/1. These
  failed gates remain release evidence rather than being replaced by later focused runs.
- The following exact browser gate passed 9/10 and isolated one final trajectory capture
  race at the cursor bounded after sequence 699. The synchronously registered response-
  body promise had invoked Chromium's raw-body API before that response's loading
  completion. Registration remains at the response boundary, while the byte read now
  follows the same response's fail-closed `finished()` result; focused compiled
  trajectory coverage then passed 2/2.
- The next exact browser gate also passed 9/10 and caught the deliberate-503 journey
  ending with its paired run-detail request live. Exact failed/recovered run waits then
  showed that the persistent interception handler could retain the recovery events
  request. The 503 route is now one-use at the routing layer, the recovered request uses
  the untouched production path, and both run/events pairs must finish; focused active
  coverage passed 2/2.
- The next exact browser gate passed 8/10. Assessment still ended with its newly selected
  human event's detail/around request live, and trajectory reproduced a headers-without-
  loading-completion stall under full-suite repetition. Assessment now awaits those exact
  selection lifecycles. The trajectory page route forwards the original request with
  Playwright's production fetch, parses the completed upstream bytes, and fulfills the
  same browser request unchanged. A first focused mutation showed the glob also caught
  event detail and failed schema parsing; an exact pathname guard leaves detail untouched,
  after which focused assessment/trajectory passed 3/3. This transport is automated
  upstream API/browser evidence, not a claim that raw CDP body capture itself is stable.
- A later exact browser gate again passed 8/10. Active validation reached terminal
  mutation before one idle `afterSequence=11` poll completed, while privacy's strict run
  detail still relied on Chromium's post-response body store. Active now waits that exact
  idle cursor. Privacy captures complete upstream bytes for every same-origin browser
  route and fulfills the original request unchanged. The first focused retryable run then
  showed its degraded banner could clear before a sequential assertion and its ordinary
  recovery request could stall; the assertion now observes concurrently with the 503,
  and later events requests use complete upstream bytes. Focused privacy passed 1/1 and
  active passed 2/2.
- The subsequent exact browser gate passed 9/10 and reproduced the same headers-without-
  loading-completion transport stall for three ordinary active event requests, including
  the initial tail. Active run/page responses now use the completed-upstream-byte
  transport while event detail remains untouched; the 503 is still the sole injected
  failure. Focused active coverage passed 2/2.
- The next exact browser gate passed 8/10 and proved completed event-selection requests
  still retained their controller: active and assessment detail requests were aborted
  after the UI consumed them. The direct hook regression failed with `true` rather than
  expected `false`; `96d3135` clears only settled selection ownership. Focused trajectory-
  request coverage passed 8/8 and typecheck passed.
- After correcting the recorded bundle bytes, the restarted exact matrix passed unit,
  typecheck, and build, then its browser gate passed 9/10. The active journey ended with
  exact aborted run-detail and event-11 requests. A first focused boundary treated the
  optional event-11 request as mandatory and timed out at the unchanged 30-second test
  bound. The hook-level RED then reproduced the actual ownership race: appending the
  selected event changed the in-flight selection signal from un-aborted to aborted.
  `3819f6e` removes ordinary event-list commits from that request's cleanup boundary;
  run and selection changes still abort it. The hook suite passed 9/9, typecheck passed,
  and the focused compiled active journey passed 1/1 without an allowance or longer wait.
- The next exact matrix passed unit, typecheck, and build before its browser gate passed
  8/10. Active had consumed an earlier running run-detail completion as its terminal
  boundary, leaving the real post-mutation request live. Privacy had captured complete
  metadata-only upstream bytes but navigated before the original browser request emitted
  `requestfinished`. Active now requires paired idle run/events completion before the
  terminal fixture mutation and paired terminal completion afterward. Privacy requires
  both captured bytes and the original browser lifecycle for every boundary. Focused
  active/privacy coverage passed 3/3 without retries, allowances, sleeps, or longer bounds.
- The following exact matrix again passed unit, typecheck, and build before the browser
  gate passed 9/10. Active retained one initial-tail page, one run detail, and the
  optional event-11 detail. Its early boundaries had paired only page completions, so a
  later run wait could consume an older instance. Every transition now awaits the exact
  run/page pair. Event-11 uses the same completed, unchanged upstream production response
  transport as the active run/page requests, avoiding the repeatedly stalled Chromium
  body path. Focused compiled active coverage passed 2/2 without an allowance or rerun.
- The restarted full unit gate then passed 69/70 files and 1,359/1,360 tests before the
  retained crash-recovery `kill ESRCH` recurred. A focused identity assertion failed
  because the detached `tsx` wrapper PID was not the durable Node recorder PID. Group
  isolation protected cleanup but did not stabilize the exact process being crashed.
  The test now pauses the persisted recorder after durable open work, performs its pure
  active inspection against that stable identity, and then sends the intentional
  SIGKILL; orphan-group and recovery assertions are unchanged. The focused journey
  passed 1/1 in 1.80 seconds.
- The final review repair replaced provider-start scheduling with a private Unix-socket
  barrier. The test first observes durable running ownership while the provider is
  blocked, releases the provider to persist the in-progress command, and only then
  begins the unchanged five-second crash bound. The final 71-file unit gate passed
  1,377/1,377, including this real crash/recovery journey in 2.943 seconds under suite
  contention.
- The pre-review request history remains retained: the first strict ledger gate passed
  7/10 with request/poll instances `#16/4`, `#9/1`, `#10/1`, and `#13/3`; focused active
  passed 5/5; the diagnostic full browser run passed 10/10. Exact later diagnostics
  observed HTTP 200, an un-aborted signal, no `AbortController.abort()` call, and full
  page body consumption for requests Playwright nevertheless labeled transport
  `net::ERR_ABORTED`. The ledger therefore preserves transport and page-consumption
  terminals independently. This explains the old harness false failures without adding
  a cancellation allowance or another product controller change.
- The first exact-ledger full E2E gate then passed 9/10 and retained four active privacy
  request instances (`#22`-`#25`) plus 35 poll generations. Chromium's native
  `Response.json()` had consumed those bodies without traversing the JavaScript reader
  hook. A browser-like unit RED reproduced the gap; exact `Response` consumption
  methods now report lifecycle alongside direct stream reads. Focused privacy passed
  1/1, the final gate passed 10/10, and the bounded strict repetition passed 30/30 with
  no active request instance at teardown.
- A temporary Final Git screenshot caught the bounded diff panel while its structured
  content was loading; the repeatable evidence journey separately waited for and
  asserted the loaded Final Git surface.
- During the first privacy RED, an unfiltered failed assertion rendered a consumed
  one-use bootstrap path in runner output. It was not committed or retained as an
  artifact; subsequent diagnostics filter to API paths. This is an implementation
  process deviation, not product evidence.
- During fix round 2, a codebase graph index-status response enumerated excluded path
  names beneath the protected scratch root. No scratch content was opened, changed,
  removed, staged, or used. This is retained as a separate process deviation.
- During final-review preparation, the required graph freshness check again enumerated
  excluded names beneath the scratch root in status metadata. No scratch content was
  opened, changed, removed, staged, or used. This name-only enumeration is retained as
  a third separate process deviation.
- No hosted, export, comparison, Claude, AGY, Insights, LLM, grading, WebSocket, or SSE
  scope was added.
