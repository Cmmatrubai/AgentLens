# Public demo release candidate

Status: locally built and tested; not published. The first audience is recruiters and hiring managers inspecting a real engineering project.

## Local acceptance

- [x] Explicit public content selection, original provenance and declared omissions.
- [x] Authored notes separated from unverified generated claims.
- [x] Snapshot integrity validation and failure state.
- [x] Browser-only build without installation, login, API key or backend reads.
- [x] Same static build runs beneath a `/showcase/` subpath from an isolated directory.
- [x] Case study / Evidence / About routes and matching command palette.
- [x] Unsupported sample routes return to the real case.
- [x] Paired excerpts, individual check outputs and selected attempt records are inspectable.
- [x] Desktop, 820-pixel and 390-pixel layouts; reduced-motion setting.
- [x] Browser trial records zero `/api/*` requests, external requests or JavaScript errors.
- [x] Export integrity issues found in code review corrected and regression-tested.

Run from `apps/desktop` after building and serving the emitted directory with any static server:

```sh
AGENTLENS_DEMO_URL=http://127.0.0.1:5188/showcase/ node qa/public-demo.cjs
```

This acceptance script uses a clean headless browser. It writes local screenshots under `.local/public-demo-qa/`; it does not modify recordings or request model analysis. The Codex browser-control connection was unavailable during this pass, so screenshots and interaction checks came from this isolated browser harness.

## Before public publication

- [ ] Choose the hosting destination and review the exact public artifact.
- [ ] Obtain publication authorization for that destination and content.
- [ ] Publish the static build and verify its external URL in a clean browser.
- [ ] Verify deep links and asset loading on the actual host; inspect its headers and caching behavior.
- [ ] Add the verified public link to README/portfolio material.
- [ ] Observe an unfamiliar reader using the demo; the intended quick reading journey is not yet a measured usability result.

The live AI support-review quality gate is separate: the one-unit C01 trial still missed the false import claim, so this demo does not present that generated analysis as validated. See [C01 granularity evaluation](../qa/insight-engine/C01-GRANULARITY-EVALUATION.md).

## September 14 verification record

- Desktop tests: **177/177 passed**.
- Desktop typecheck and ordinary build passed; public demo build passed.
- Static browser acceptance passed at 1440, 820 and 390 pixels, with zero local API/external requests or JavaScript errors. Snapshot tampering rendered the error state with no findings.
- Original eleven top-level private insight JSON files retained both hashes and modification times.
- Core verification was not clean in one broad run: parallel process/integration checks hit timeouts and worker-reporting errors. A sequential run excluding packaging passed **1,513/1,514**; the sole timed-out malformed-quoting case then passed in isolation (560 ms). No timeout limits or assertions were weakened.
- Packaging passed **5/5** with a temporary Git index including the seven new runtime files/assets. That suite copies only Git-listed files, so untracked application files are otherwise missing from its fresh checkout. The real Git index was not changed. Applying that temporary index to unrelated Git-fixture suites was invalid and produced discarded test failures; those suites were rerun without it.

These results cover the complete core test inventory across separate runs, not a single clean `pnpm test` result. Recheck the normal full command after the new files are tracked and before a public release.
