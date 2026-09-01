# Task 7.14 implementation report

## Outcome

Implemented the Task 7 release-validation harness and verification record. Production
defects proven by release REDs were isolated into three earlier fix commits; the
remaining changes are fixture, Playwright, packaging-test, and evidence-record paths.

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
  matched once by exact method/path/status. Cancellation correlation uses exact method,
  origin, pathname, and search plus lifecycle order, and accepts only one exact duplicate
  fetch abort after its matching success. Deterministic unit mutations reject a different
  query and a second duplicate abort. Teardown retains every collected failure even when
  request settlement itself fails.
- The privacy journey starts and retains every same-origin response-body/header promise,
  exercises standard normalized/native plus metadata-only/strict detail and denied
  explicit content/native surfaces, drains the full promise registry, scans raw bytes,
  asserts four exact 404 `content_unavailable` envelopes, and requires the single exact
  permitted standard bearer-HMAC marker with no other redaction marker. The browser's
  bearer exists only in test/browser lexical memory and never enters a URL, DOM, log, or
  durable artifact.
- The 1,000-event journey validates all ten response pages, literal event identities and
  sequences, cursor chaining and window boundaries, per-append visible anchor offsets,
  bounded mounted rows, and exact focus/selection/query/inspector identities.
- Packaging checks build independent fresh temporary checkouts and cover source
  invocation, compiled Node invocation, offline execution without source directories,
  hashed assets, authenticated run list, SIGTERM 143, and dead-process cleanup. Each
  invocation is launched in a detached process group three times: success, deliberate
  post-start verification failure, and deliberate pre-return listener-discovery failure.
  Central shutdown records group/listener PIDs, sends SIGTERM, uses bounded state waits,
  escalates resistant groups to SIGKILL, and still applies its kill fallback when cleanup
  verification fails. All product paths assert absent PIDs, an empty group, and exact-port
  refusal before temporary-root removal; a real resistant helper proves SIGKILL cleanup.

## Fresh verification

- `pnpm test`: exit 0; 69 files and 1,353 tests passed.
- `pnpm typecheck`: exit 0.
- `pnpm build`: exit 0; 551 Vite modules transformed.
- `pnpm test:e2e`: exit 0; 10/10 Chromium-production journeys passed.
- `git diff --check`: exit 0.
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
- The first I-1 RED used an unfiltered response-path diagnostic, so its assertion output
  rendered one consumed one-use bootstrap path. It was not written to repository files
  or retained as an artifact, and later response-path assertions include API paths only.
  This is disclosed because the task explicitly prohibited printing bootstrap secrets.
- The main-repository `design-prototypes/` directory was not read or touched.
- The independent review at `4c5d145` rejected Task 7.14 with 0 Critical and 4 Important
  findings. Fix round 1 at `6cb07b2` was rereviewed and rejected with 0 Critical and 3
  Important findings plus an observed 9/10 Playwright instability. Fix round 2 addresses
  those findings and the reproduced race but does not declare acceptance; the controller
  must obtain a fresh adversarial review.

## Commits

- Product fixes: `4c2340c`, `6e45506`, `70f4a28`.
- Verification harness: this commit, with message
  `test: validate AgentLens Task 7 end to end`.
- Review fix round 1: `6cb07b2`.
- Review fix round 2: this focused commit, based on `6cb07b2`.
