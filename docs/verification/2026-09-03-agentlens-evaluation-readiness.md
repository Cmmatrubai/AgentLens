# Evaluation-readiness release verification

## Scope and release boundary

- Implementation baseline: `main@1aebc25e8122af99d0f8b55b27ae99110d808ab8`.
- Feature implementation verified at `abb42182c87716c9fb87c8187cca9b69b268381e` on `codex/agentlens-evaluation-readiness`.
- Documentation release commit: this commit.
- The only pre-existing untracked worktree inputs were the approved evaluation-readiness plan and design specification. The plan is included unchanged; the specification has only the controller-approved replacement of three Markdown hard breaks with equivalent `<br>` tags so whitespace checks can pass.
- T01-A2, the experiment protocol, and the visual redesign did not begin. No push, pull request, merge, migration, assessment, repair, or data-root normalization was performed.

The post-Task-7 fix `abb4218` makes bounded shell parsing treat literal metacharacters inside single-quoted text as literals while retaining conservative rejection of expansion and unquoted control syntax. Its Task 7 gate rerun and independent review were clean.

## Task verification commands

The task reports preserve the RED evidence; this release record lists the final successful commands and their exit status.

| Task | Final command(s) | Exit status and recorded result |
| --- | --- | --- |
| 1 | `pnpm vitest --run packages/codex/test/normalizeFixtures.test.ts packages/codex/test/unknownNativeFields.test.ts`<br>`pnpm vitest --run apps/cli/test/recordRun.integration.test.ts apps/cli/test/privacy.integration.test.ts packages/core/test/redaction.test.ts`<br>`pnpm typecheck`<br>`pnpm test` | 0; 30 focused adapter tests, 83 persistence/privacy tests, typecheck, and 1,383 tests in 71 files. |
| 2 | `pnpm vitest --run packages/derivations/test/runSummary.test.ts packages/api-contract/test/contracts.test.ts packages/application/test/apiProjection.test.ts`<br>`pnpm vitest --run packages/core/test/events.test.ts packages/codex/test/unknownNativeFields.test.ts packages/storage/test/runRepository.test.ts apps/cli/test/readCommands.integration.test.ts apps/cli/test/format.test.ts apps/web/test/fixtureDataRoot.test.ts apps/web/test/runHeader.test.tsx apps/web/test/accessibility.test.tsx apps/web/test/activePolling.test.tsx apps/web/test/assessment.test.tsx apps/web/test/runList.test.tsx`<br>`pnpm test -- --reporter=dot`<br>`pnpm typecheck` | 0; 109 derivation/contract/projection tests, 271 compatibility tests, 1,406 tests in 71 files, and typecheck. |
| 3 | `pnpm vitest --run packages/derivations/test/shellTokenizer.test.ts packages/derivations/test/classifyTestCommand.test.ts packages/derivations/test/testDerivations.test.ts packages/derivations/test/runSummary.test.ts`<br>`pnpm typecheck`<br>`pnpm test`<br>`pnpm test:e2e` | 0; final focused parser/classifier suite, typecheck, 1,468 tests in 71 files, and 10 browser tests. |
| 4 | `pnpm vitest --run apps/web/test/projectTrajectory.test.ts apps/web/test/trajectory.test.tsx apps/web/test/runHeader.test.tsx apps/web/test/accessibility.test.tsx`<br>`pnpm typecheck`<br>`pnpm test` | 0; 63 focused tests, typecheck, and 1,480 tests in 71 files. |
| 5 | `pnpm vitest --run apps/web/test/activeSnapshotRetry.test.ts apps/web/test/apiClient.test.ts apps/web/test/trajectoryPages.test.tsx apps/web/test/activePolling.test.tsx apps/web/test/runList.test.tsx apps/web/test/requestLifecycle.test.ts`<br>`pnpm vitest --run packages/storage/test/readOnlyDatabase.test.ts packages/application/test/runQueryService.test.ts packages/application/test/evidenceService.test.ts apps/server/test/readApi.integration.test.ts apps/server/test/evidenceApi.integration.test.ts apps/server/test/security.integration.test.ts`<br>`pnpm playwright test --config apps/web/playwright.config.ts apps/web/e2e/active-run.spec.ts`<br>`pnpm test`<br>`pnpm typecheck`<br>`pnpm build` | 0; 82 focused web tests, 228 storage/server boundary tests, 2 targeted browser journeys, 1,498 tests in 72 files, typecheck, and build. |
| 6 | `pnpm vitest --run apps/web/test/trajectoryPages.test.tsx apps/web/test/mergePages.test.ts apps/web/test/trajectory.test.tsx apps/web/test/assessment.test.tsx`<br>`pnpm exec playwright test --config apps/web/playwright.config.ts apps/web/e2e/trajectory.spec.ts`<br>`pnpm test`<br>`pnpm typecheck`<br>`pnpm build` | 0; 87 focused tests, 4 trajectory browser tests, 1,511 tests in 72 files, typecheck, and build. |
| 7 | `pnpm vitest --run` with the 22 named cross-cutting suites<br>the ten-iteration privacy/storage/server loop<br>`pnpm test`<br>`pnpm typecheck`<br>`pnpm build`<br>focused Playwright, `pnpm test:e2e`, and the ten-iteration active-run/privacy browser loop | 0; 539 focused tests in 22 files in 12.27 s; 10/10 privacy/storage/server iterations with 72 tests each (720 total); 1,519 tests in 72 files in 25.49 s; typecheck; 552-module build in 642 ms; focused browser 8/8 in 16.3 s; full browser 12/12 in 18.3 s; high-risk browser 10/10 with 30 journeys, about 12.3–12.4 s each. |
| 8 | `pnpm agentlens inspect 2049e5b9-c88e-4e95-8e7c-69d879ad6f1a --data-root <dedicated replay root> --json`<br>`pnpm agentlens ui --no-open --data-root <dedicated replay root>`<br>complete before/after metadata and SHA-256 snapshots with `diff -u` | 0; CLI and loopback UI reads completed without requesting native or assessment contents; both snapshot comparisons exited 0. |

Task 7's 22-suite focused invocation was:

```text
pnpm vitest --run \
  packages/codex/test/normalizeFixtures.test.ts \
  packages/codex/test/unknownNativeFields.test.ts \
  packages/core/test/redaction.test.ts \
  packages/derivations/test/shellTokenizer.test.ts \
  packages/derivations/test/classifyTestCommand.test.ts \
  packages/derivations/test/testDerivations.test.ts \
  packages/derivations/test/runSummary.test.ts \
  packages/api-contract/test/contracts.test.ts \
  packages/application/test/apiProjection.test.ts \
  packages/application/test/runSummary.test.ts \
  apps/cli/test/deriveTests.test.ts \
  apps/cli/test/recordRun.integration.test.ts \
  apps/cli/test/privacy.integration.test.ts \
  apps/web/test/activeSnapshotRetry.test.ts \
  apps/web/test/apiClient.test.ts \
  apps/web/test/projectTrajectory.test.ts \
  apps/web/test/trajectoryPages.test.tsx \
  apps/web/test/trajectory.test.tsx \
  apps/web/test/activePolling.test.tsx \
  apps/web/test/runHeader.test.tsx \
  apps/web/test/runList.test.tsx \
  apps/web/test/accessibility.test.tsx
```

`git diff --check` passed in every task gate. Task 7 also rechecked the complete range with `git diff --check main...HEAD` and found no worktree-owned process after its gates.

## Historical T01-A1 read-only verification

The operator-resolved replay root was confirmed to be a dedicated external root containing the expected database, not a home directory, repository root, or default AgentLens data root. A fresh whole-root baseline was taken before the first product read.

| Snapshot | Metadata entries | Regular-file SHA-256 entries | Metadata-list digest | SHA-256-list digest |
| --- | ---: | ---: | --- | --- |
| Before reads | 20 | 9 | `74013ed629f78a09a3aa461c4bb9b12374ffef7f7590c1106ff3d07e1b96c757` | `61b7be2d166e298e55b059f438a4c5670300e43e07357210d6718da0f2bd4018` |
| After CLI/UI reads and normal UI shutdown | 20 | 9 | `74013ed629f78a09a3aa461c4bb9b12374ffef7f7590c1106ff3d07e1b96c757` | `61b7be2d166e298e55b059f438a4c5670300e43e07357210d6718da0f2bd4018` |

Both `diff -u` commands exited 0 with zero differing lines. The final owned-UI process check found zero entries. No database, sidecar, artifact, directory entry, metadata field, or file digest changed.

The CLI summary reported explicit human assessment `partial` with task completion `yes`. It detected six source terminal commands as test-bearing: five bounded compound shapes and one shell-wrapped shape. The five compound entries have individually unavailable outcomes; they do not inherit the aggregate shell exit code. The read-time summary is `test-command/2`, has `incomplete` durability, and has zero persisted v2 derived-event IDs. The legacy token state is `redacted_by_policy`, not zero or provider absence. Provider file-read telemetry and provider tool duration remain unavailable.

The loopback UI presented the same assessment and redacted-by-policy explanation, the file-read and tool-duration boundary copy, and `102 of 102 immutable events loaded`. It rendered a compatible command lifecycle with `Recorder-observed elapsed · derived from receipt timestamps` (1 ms) while retaining provider duration as unavailable. The terminal `run.reconciled` event was visible without a manual `Load later` action. Native payload, normalized content, and assessment-note controls were not invoked.

The live ledger contains the additional immutable assessment event, so it is not the authoritative exact 101-event assertion. The sanitized Task 6 browser fixture is that proof: an initial 100-event terminal page auto-loads the final page for 101 events and makes `run.reconciled` selectable; a 201-event fixture sends no automatic second cursor request and leaves manual later paging available.

## Preserved boundaries and advisories

- Standard capture preserves only the five approved provider-emitted counters; metadata-only and strict omit content, and native token-like fields remain subject to the existing redaction boundary.
- Test-bearing detection is intentionally bounded. It does not claim universal shell support, and an individual result remains unknown for supported compounds.
- Recorder-observed elapsed is derived from compatible receipt timestamps; it is not provider-native duration.
- Codex file-read telemetry and provider tool duration are unavailable. Shell text is not promoted into complete file-read evidence.
- Active snapshots can fail closed while the UI retries the typed retryable refusal; non-retryable failures do not retry.
- The configured Vite advisory for a 523.40 kB minified JavaScript chunk and the `NO_COLOR`/`FORCE_COLOR` browser-environment advisory were non-blocking; all associated gates exited 0.

No A2 result, visual redesign, universal shell claim, complete file-read claim, provider-native duration claim, or historical backfill is asserted here.
