# Task 7.14 implementation report

## Outcome

Implemented the Task 7 release-validation harness and verification record. Three
production defects proven by the original release REDs were isolated into earlier fix
commits. Four settled-request ownership defects were proven by the round-three browser
gates and corrected in separate focused round-three commits alongside regression tests.

## Retained RED/GREEN evidence

1. Server release RED: `apps/server/test/security.integration.test.ts` reported 2/23
   failures: source-mode default web-root resolution was unavailable and
   `/favicon.ico` returned 404 instead of 204. Commit `4c2340c` made the same focused
   suite 23/23 green, with typecheck and diff-check passing.
2. Accessibility release RED: axe reported the trajectory time text at 4.25:1 against
   the required 4.5:1. Commit `6e45506` changed only the dim text token; the same axe
   production journey then passed with zero serious/critical violations.
3. Offline packaging RED: the copied compiled UI exited 0 before startup when its
   temporary path used macOS's `/var` alias. Commit `70f4a28` realpath-normalized the
   direct-entry comparison; the no-source-module offline case then passed.
4. Harness REDs retained during construction included missing pinned Chromium, invalid
   recorder process-event correlation, token loss from full-document detail navigation,
   active-WAL file modes, and early pagination-state checks. Chromium was installed as
   an environment prerequisite; fixture/navigation/timing corrections used public APIs
   and locator/state waits without retries or arbitrary sleeps.
5. A final full-suite RED found the compiled packaging journey racing the web build
   output: 67 files and 1,348 tests passed, while that test exited 1 with
   `AgentLens web assets are unavailable`. The packaging cases now build and run in
   independent tracked-file temporary checkouts; the focused suite passed 3/3.
6. Fix round 1 retained four review-driven REDs. The privacy journey observed none of
   the five required standard/omitted-policy endpoints; the shared browser guard first
   let an injected Final Git warning false-green 1/1, then failed teardown on that exact
   warning after installation; the packaging test had no recorded server/group PID;
   and the trajectory journey captured 0/10 response pages. The corrected focused
   privacy and trajectory journeys passed 1/1, the guard-focused set passed after its
   mutation was removed, and packaging passed 3/3 across six server lifecycles.
7. Fix round 2 retained the three rereview-driven REDs and the observed browser race.
   Privacy requested 5/9 required paths and timed out without the four omitted-policy
   explicit routes. The pure cancellation classifier passed its exact-duplicate case
   but failed 2/3 because a different query and a second identical abort were both
   ignored. A focused five-journey browser run reproduced the rereview failure at 4/5
   and identified the unsettled request as the completed-filter ledger fetch. The
   compiled pre-return probe found one live process-group member after listener-
   discovery failure. A resistant-helper mutation that removed SIGKILL timed out with
   its group still live.
8. Round 2 GREENs were privacy 1/1; cancellation classification 3/3; active/privacy/
   reload browser coverage 5/5; resistant escalation 1/1; and packaging 4/4 across the
   resistant helper plus nine product server lifecycles. An intermediate combined
   packaging run failed 1/4 after mutation restoration accidentally swapped graceful
   and forced signals; inspection proved the harness sent SIGKILL first. Restoring the
   exact SIGTERM-then-SIGKILL order made the complete focused suite 4/4.
9. Fix round 3 retained the four second-rereview RED classes. The response-capture
   mutation failed 1/1 because a rejected body read resolved as a zero-byte capture.
   Request classification failed 2/5 because a headers-only abort of the same request
   and an unrelated unconfigured abort were both suppressed. A real throwing
   `onProcessGroup` hook left one group member alive, while the dual-failure probe
   returned only the cleanup error instead of an `AggregateError`. The reviewer also
   retained its first exact `pnpm test` result: 66/69 files and 1,350/1,353 tests passed,
   with the self-detached doctor, media-tamper read, and source-packaging cases timing
   out at their existing bounds.
10. Fail-closed capture then exposed real journey races rather than hiding them. The
    first privacy rerun reported unreadable run-list and event-page bodies; a later
    rerun isolated the strict-detail body. Draining registered captures before every
    navigation and selection boundary made privacy pass 1/1. The guard also exposed
    active-poll aborts at the exact `limit=100` and `afterSequence=9` queries. A
    pre-navigation completion collector now waits for an idle completed poll before
    each fixture write and for the exact post-write completion afterward; the focused
    active/privacy/reload set passed 5/5 without a cancellation allowance.
11. Packaging diagnosis measured the unchanged focused file at 29.83 seconds: source,
    compiled, and no-source cases each copied, offline-installed, and built a checkout.
    Reusing one private fresh offline-built checkout sequentially removed two complete
    installs/builds. The focused packaging file then passed 5/5 in 18.06 seconds
    (source 12.20 seconds, compiled 0.66 seconds, no-source offline 0.58 seconds), while
    retaining the resistant helper, the original nine product lifecycles, one real
    throwing-hook lifecycle, and the dual-error forced-cleanup probe.
12. The first decisive post-fix `pnpm test` remained red at 69/70 files and
    1,357/1,358 tests: the crash-recovery recorder exited before durable open work.
    The crash test passed alone, beside packaging, and beside the six process-heavy
    files, narrowing the failure to full-suite lifecycle isolation rather than resource
    duration. A focused assertion then proved the crash probe recorder did not own an
    isolated process group. Launching that test-only recorder as its own POSIX group
    made the real recovery journey pass 1/1 without weakening its recorder-crash,
    orphan-child, or durable-recovery assertions. The failed full result remains part
    of the release history; only the subsequent matrix is reported as final evidence.
13. The first corrected exact browser gate then passed 9/10. The active zero-event
    journey reported an exact `GET .../events?limit=100` `net::ERR_ABORTED`; a more
    precise next-request boundary subsequently reproduced settled `afterSequence=9`
    and terminal `afterSequence=11` lifecycle failures rather than permitting them.
    A focused hook assertion proved the last completed poll's signal was still aborted
    (`true` rather than `false`) after the terminal status render. The polling hook now
    releases controller ownership immediately after both fetch promises settle, while
    retaining cleanup aborts for genuinely in-flight work. The unit hook suite passed
    14/14 and the real compiled active journeys passed 2/2 after that correction.
14. The restarted exact browser gate then passed 8/10. Privacy failed closed on an
    unreadable strict event-page body because the drain began before that response was
    registered; the 1,000-event journey reported a cursor request aborted after its
    page had settled. Privacy now waits for each exact required route to register before
    draining and before navigating. A focused cursor regression failed because starting
    the next page changed the prior completed signal from un-aborted to aborted. Cursor
    ownership now clears only after the validated page commits, retaining real rapid-
    request and navigation cancellation. The combined focused unit set passed 24/24,
    and compiled privacy plus trajectory passed 3/3.
15. The first post-product-commit exact browser gate passed 7/10 and retained three
    remaining harness boundaries: the assessment journey ended before its post-save
    run refresh finished; privacy had not required the run-list/run-detail bodies before
    navigation; and the trajectory journey consumed a cursor body before Playwright
    emitted `requestfinished`. The assessment now awaits its exact PUT and following
    run GET, privacy requires every list/detail/events response to register and drain,
    and each cursor step awaits both parsed raw body and exact request completion before
    the next click. The combined focused browser set first passed 3/4 with only the
    still-unrequired initial run list failing closed, then privacy passed 1/1 after that
    final exact registration boundary was added.
16. The next exact browser gate passed 9/10 and isolated the remaining trajectory
    capture race at the cursor bounded after sequence 699: its response-boundary body
    promise called Chromium's body API before that response emitted loading completion.
    Capture remains synchronously registered at `response`, but now gates the raw byte
    read on the same response's fail-closed `finished()` result. The focused compiled
    trajectory set then passed 2/2.
17. The following exact browser gate passed 9/10 and caught the retryable-503 journey
    ending with its paired run-detail request live. Adding exact failed/recovered run
    lifecycle waits then exposed the persistent route handler itself retaining the
    recovery events request until teardown. The injected 503 route is now one-use at
    the Playwright routing layer; the recovered poll uses the untouched production
    network path, and both run/events request pairs are awaited. Focused active coverage
    then passed 2/2.
18. The next exact browser gate passed 8/10. Assessment still had its selected human
    event's detail/around request in flight, so it now awaits both exact selection
    requests as well as PUT/run refresh. Trajectory reproduced a headers-without-loading-
    completion stall under the repeated full suite. The exact page route now forwards
    the original authorized browser request with `route.fetch`, parses the complete
    upstream production body, and fulfills that same browser request with the unchanged
    body; non-page event-detail paths continue untouched. An initial focused mutation
    proved the glob also matched event detail and failed schema parsing; the exact
    pathname guard corrected that, and focused assessment/trajectory then passed 3/3.
19. A later exact browser gate again passed 8/10: active polling had not completed one
    idle `afterSequence=11` snapshot before terminal mutation, and privacy's strict run
    detail still depended on Chromium's post-response body store. Active validation now
    requires that exact idle cursor before finishing the run. Privacy synchronously
    registers every same-origin route, forwards it with redirects preserved for the
    browser, captures complete upstream headers/body, and fulfills the original request
    unchanged. The first focused retryable run then failed because its degraded banner
    cleared before a sequential assertion and normal recovery transport stalled; banner
    observation now begins with the injected response, while later event requests use
    completed upstream bytes. Focused privacy passed 1/1 and active passed 2/2.
20. The subsequent exact browser gate passed 9/10 and reproduced the same headers-
    without-loading-completion transport stall for three ordinary active event requests,
    including the initial tail. Active run/detail page requests now use the same exact
    completed-upstream-byte transport as trajectory and privacy; event-detail requests
    continue untouched, and the intentional 503 remains the only injected failure.
    Focused active coverage passed 2/2.
21. The next exact browser gate passed 8/10 and proved that completed event-selection
    requests also retained controller ownership: both active and assessment detail
    requests were aborted after the UI consumed them. The direct hook regression failed
    with `true` rather than expected `false`. Commit `96d3135` clears selection ownership
    on resolved/unavailable completion and aborts only the still-owned in-flight request;
    the focused trajectory-request suite passed 8/8 with typecheck clean.
22. After the evidence record was corrected to the fresh bundle-byte values, the exact
    matrix restarted and its browser gate passed 9/10. The active terminal journey
    reported exact aborted run-detail and selected event-11 requests. A first focused
    harness attempt treated event-11 completion as mandatory and timed out at the
    existing 30-second test bound, proving that request was an earlier optional
    selection-resolution race rather than a terminal contract. The direct hook RED then
    appended the selected event while resolution was in flight and observed its signal
    change from un-aborted to aborted. Commit `3819f6e` keeps selection ownership stable
    across ordinary event-list commits while retaining cleanup on run or selection
    changes. The hook suite passed 9/9, typecheck passed, and the focused compiled active
    journey passed 1/1 without a cancellation allowance or timeout increase.
23. The following exact matrix passed unit, typecheck, and build, then its browser gate
    passed 8/10. Active had matched an earlier running run-detail poll before terminal
    mutation, leaving the real post-mutation request to abort, while privacy had drained
    complete upstream metadata-only bytes before Chromium emitted `requestfinished` for
    the original browser request. Active now requires the paired idle run/events poll
    before finishing the fixture and then the paired terminal poll. Privacy records the
    original browser lifecycle before navigation as well as draining every fail-closed
    capture. The focused active/privacy set passed 3/3 without retries, allowances,
    sleeps, or increased bounds.
24. The next exact matrix again passed unit, typecheck, and build, then its browser gate
    passed 9/10. The active failure retained one initial-tail page, one run detail, and
    the optional event-11 detail. The journey had paired only page completions for its
    earlier active polls, allowing later run waits to consume stale instances. Every
    active transition now requires the exact run/page pair. The selected event-11 detail
    uses the same completed, unchanged upstream production response transport as the
    active run/page requests, rather than relying on Chromium's repeatedly stalled body
    path. The focused compiled active set passed 2/2 without an exception or retry.
25. The restarted full unit gate then passed 69/70 files and 1,359/1,360 tests before
    reproducing the retained crash-recovery `kill ESRCH`. A focused identity assertion
    failed because the detached `tsx` wrapper PID differed from the durable Node recorder
    PID. Group isolation therefore protected cleanup without pinning the exact process
    that the test intended to crash. After durable open work, the test now pauses the
    persisted recorder PID, performs the read-only active diagnosis against that stable
    identity, and delivers the deliberate SIGKILL; whole-group orphan cleanup remains
    unchanged. The focused real recovery journey passed 1/1 in 1.80 seconds.
26. The request-boundary review replaced duplicated URL-count waits with one shared
    append-only browser request ledger. Every Playwright `Request` receives a monotonic
    ID at start, an exact active/finished/failed terminal state, and a terminal-order
    sequence. Checkpoints exclude older duplicates, while exact run-detail and bounded
    event-page requests share a poll generation. The guard, active polling, assessment,
    privacy, run-list, and trajectory journeys now consume this ledger. The initial
    trajectory request separately releases its controller owner after fulfilled or
    failed settlement; its cleanup aborts only the exact request that remains owned.
    The first strict full E2E run passed 7/10 and retained three unconfigured aborts:
    active retry request `#16` in poll generation 4, evidence request `#9` in generation
    1, and trajectory request `#9` in generation 1. No cancellation allowance or local
    wait was added. A five-run focused active probe passed 5/5, and the subsequent
    diagnostic 10-journey run passed 10/10 with no failed or active request at teardown.
27. The accepted independent review then rejected the ledger's temporal run/events
    pairing, the remaining cancellation-allowance API, and the crash probe's scheduler-
    dependent provider-start boundary. Active polling now exposes exact test-only
    correlation through the identical `AbortSignal` shared by its run and events
    fetches; each fetch also carries a separate document-local monotonic request-instance
    identity. This correlates duplicates and events-before-run without URL ordering and
    leaves initial requests unclassified. The cancellation allowance and every related
    type/helper/test path were removed. The fake provider now uses a private Unix-socket
    barrier: the test observes the recorder's durable running ownership before releasing
    the provider to emit its in-progress command, then applies the unchanged five-second
    crash bound. The full unit suite passed the real crash journey under contention in
    2.943 seconds.
28. Exact page-side diagnostics reproduced Playwright transport
    `requestfailed net::ERR_ABORTED` after HTTP 200 resolution and complete body
    consumption while the exact fetch signal remained un-aborted and no
    `AbortController.abort()` call occurred. The earlier retained instances `#16/4`,
    `#9/1`, `#10/1`, and `#13/3` are therefore explained by the prior transport-only
    harness authority, not by evidence of another product owner defect. The shared
    ledger now preserves the raw transport terminal independently while requiring the
    exact instrumented fetch instance to report fetch/body success or failure. A true
    signal abort remains a terminal failure; missing, mismatched, duplicate, or
    unconsumed page evidence fails closed. No additional product controller changed.
29. The first full E2E gate after that repair passed 9/10 and retained its privacy
    timeout. Requests `#22`-`#25` had finished transport but remained active because
    Chromium's native `Response.json()` consumption bypassed the JavaScript stream-reader
    hook; the waiting strict run consequently produced 35 poll generations. A browser-
    like unit RED reproduced the missing exact completion. The wrapper now observes all
    native `Response` body-consumption methods as well as direct stream reads, without a
    completion allowance. Focused ledger/guard passed 21/21, focused privacy passed 1/1,
    the final full browser gate passed 10/10, and ten privacy plus twenty active/recovery
    repetitions passed 30/30 with no active request at teardown.

## Implementation scope

- Deterministic disposable fixture roots are created under the operating-system temp
  directory and removed after each test. They cover projected/explicit assessments;
  completed/failed/interrupted/recorder-error/starting/running lifecycles; observed,
  derived, recorder, recovery, Git, and human provenance; standard/metadata-only/strict
  capture; unknown events; 10/50/250/1,000 exact trajectories; long output; and a
  multi-file near-limit diff.
- Artifact bytes use `ArtifactStore.writeRedacted`; native inputs use `redactJson` and
  `prepareNativePayload`; content uses `redactText`. No sensitive sentinel is directly
  written to storage.
- Production Playwright launches the built compiled CLI/server/web path, uses Chromium,
  one worker, zero retries, OS-temp output, and no retained screenshots/traces/videos.
- An auto-used pre-navigation guard applies to every Playwright journey. It fails
  teardown for browser warning/error output, external HTTP(S), unexpected same-origin
  HTTP failures, and failed requests. Only the intentional active-snapshot 503 is
  matched once by exact method/path/status. Lifecycle evidence uses stable Playwright-
  request identities plus exact method, URL, and order. Instrumented fetches additionally
  report exact page-side fetch/body settlement by a unique request-instance header. Raw
  transport and page-consumption terminals remain independently inspectable; a real
  page-side abort/fetch/body failure always fails. The cancellation-allowance API no
  longer exists. Deterministic mutations reject a headers-only abort of the same request,
  an unrelated abort, a different query, and every duplicate abort. Teardown retains
  every collected failure even when request settlement itself fails.
- The privacy journey starts and retains every same-origin upstream body/header promise
  at the exact browser route,
  exercises standard normalized/native plus metadata-only/strict detail and denied
  explicit content/native surfaces, drains the full promise registry, scans raw bytes,
  asserts four exact 404 `content_unavailable` envelopes, and requires the single exact
  permitted standard bearer-HMAC marker with no other redaction marker. Body or header
  read rejection is retained and fails the drain; no empty-buffer substitution remains.
  Required responses are drained at bounded interaction boundaries before their page
  can navigate away. Each captured upstream response is fulfilled back to the original
  browser request with unchanged bytes. The browser's
  bearer exists only in test/browser lexical memory and never enters a URL, DOM, log, or
  durable artifact.
- The 1,000-event journey validates all ten upstream production API pages, literal event identities and
  sequences, cursor chaining and window boundaries, per-append visible anchor offsets,
  bounded mounted rows, and exact focus/selection/query/inspector identities. Its exact
  page route forwards the original authorized browser request, captures the completed
  upstream body, and fulfills the browser with that unchanged body; event-detail routes
  are not intercepted.
- Packaging checks use one private fresh temporary checkout, populated with tracked
  files and installed offline once, then exercise source, compiled, and final no-source
  modes sequentially. They cover source invocation, compiled Node invocation, offline
  execution without source directories,
  hashed assets, authenticated run list, SIGTERM 143, and dead-process cleanup. Each
  invocation is launched in a detached process group three times: success, deliberate
  post-start verification failure, and deliberate pre-return listener-discovery failure.
  Central shutdown records group/listener PIDs, sends SIGTERM, uses bounded state waits,
  escalates resistant groups to SIGKILL, and still applies its kill fallback when cleanup
  verification fails. The first post-spawn hook is inside that protection; one additional
  compiled lifecycle throws from it. Simultaneous product-verification and cleanup errors
  are retained together after forced cleanup. All product paths assert absent PIDs, an empty group, and exact-port
  refusal before temporary-root removal; a real resistant helper proves SIGKILL cleanup.
- The existing crash-recovery integration probe now owns a test-only POSIX process
  group, matching a standalone foreground CLI job and preventing unrelated suite
  lifecycle signals from terminating its recorder. A private Unix-socket readiness
  barrier releases provider command emission only after durable recorder ownership is
  observable. The test still kills only the recorder PID first, proves the child group
  remains orphan-active, then removes that group and exercises durable recovery.
- Active-run validation awaits the next exact events request instance before every
  fixture transition instead of accepting a historical completion count. The polling
  hook clears only a fully settled controller before applying the returned run/page;
  unmount and dependency cleanup still abort genuinely in-flight requests.
  Active run/page responses are forwarded to the compiled production server, read to
  completion upstream, and fulfilled unchanged to the original browser request; event
  detail continues over the untouched browser path.
- The shared request ledger is the only E2E request-lifecycle authority. It retains
  exact `Request` identity, monotonic start ID, terminal order/state, checkpoint
  boundaries, exact same-signal run/events poll generations, and separate raw-transport
  and page-consumption terminals. Failure-only diagnostics list every redacted
  same-origin request instance; they do not weaken the strict guard.

## Fresh verification

- Final full `pnpm test`: exit 0; 71 files and 1,377 tests passed.
- Final focused ledger/guard verification: exit 0; 2 files and 21 tests passed.
- Final `pnpm typecheck`: exit 0.
- `pnpm build`: exit 0; 551 Vite modules transformed; the existing chunk-size advisory
  remains.
- Retained pre-review first strict `pnpm test:e2e`: exit 1; 7/10 journeys passed, with
  exact instances `#16/4`, `#9/1`, `#10/1`, and `#13/3` retained above.
- First post-review exact-ledger `pnpm test:e2e`: exit 1; 9/10 passed; privacy retained
  four exact unconsumed native-JSON requests and timed out after 35 poll generations.
- Final post-fix `pnpm test:e2e`: exit 0; 10/10 Chromium-production journeys passed,
  one worker and zero configured retries; no request instance remained active at teardown.
- Bounded strict privacy/active repetition: exit 0; 30/30 passed (10 privacy and 20
  active/recovery journeys), with no active request instance at teardown.
- Final `git diff --check`: exit 0.
- Safe tracked/scoped status checks: exit 0; the intended Task 7.14 changes remain in
  the current worktree and are not represented as committed by this follow-up.
- Exact test/browser/privacy/active-WAL/packaging/visual evidence and limitations are in
  `docs/verification/2026-08-30-agentlens-task-7.md`.

## Visual review and cleanup

The exact in-app Browser was used at 1440 x 1000, 1100 x 900, and 800 x 900. Temporary
Playwright captures covered the ledger, 1,000-event, recovery, Final Git, assessment,
empty, active, and inline states. All captures and disposable data roots were removed.

## Scope deviations and reviewer handoff

- During the first status inspection, `git status --short --untracked-files=all`
  enumerated names beneath the protected pre-existing scratch directory. No file in it
  was opened, read for content, changed, removed, or staged, and no later command
  traversed it. This violates the stricter instruction not to read/touch that directory
  and is disclosed for the controller's acceptance decision.
- During fix round 2, the codebase graph's index-status response itself enumerated names
  beneath the protected scratch directory while reporting intentional exclusions. No
  scratch file was opened for content, changed, removed, staged, or used by the fix. This
  is a second protected-path enumeration deviation and is disclosed independently.
- During final-review preparation, the required graph freshness check again enumerated
  excluded names beneath that scratch directory in its status metadata. No scratch file
  was opened for content, changed, removed, staged, or used; this third name-only
  enumeration is disclosed separately.
- The first I-1 RED used an unfiltered response-path diagnostic, so its assertion output
  rendered one consumed one-use bootstrap path. It was not written to repository files
  or retained as an artifact, and later response-path assertions include API paths only.
  This is disclosed because the task explicitly prohibited printing bootstrap secrets.
- The main-repository `design-prototypes/` directory was not read or touched.
- The independent review at `4c5d145` rejected Task 7.14 with 0 Critical and 4 Important
  findings. Fix round 1 at `6cb07b2` was rereviewed and rejected with 0 Critical and 3
  Important findings plus an observed 9/10 Playwright instability. Fix round 2 addressed
  those findings and the reproduced race. The second rereview at `94c5be4` rejected the
  gate with 0 Critical and 4 Important findings covering fail-open response bodies,
  request-instance correlation, hook/dual-error cleanup, and its first red unit matrix.
  Fix round 3 addresses those findings but does not declare acceptance; the controller
  must obtain a fresh adversarial review.

## Commits

- Product fixes: `4c2340c`, `6e45506`, `70f4a28`, `21392b1` (settled active
  polling), `5974688` (settled cursor paging), and `96d3135` (settled event
  selection).
- Verification harness: this commit, with message
  `test: validate AgentLens Task 7 end to end`.
- Review fix round 1: `6cb07b2`.
- Review fix round 2: this focused commit, based on `6cb07b2`.
- Review fix round 3: product commits `21392b1`, `5974688`, and `96d3135`, followed
  by this focused harness/evidence commit, based on `94c5be4`.
