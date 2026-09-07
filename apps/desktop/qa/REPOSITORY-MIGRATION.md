# Repository migration verification

Verified September 7, 2026 in the canonical AgentLens checkout, branch `codex/desktop-integration`. Changes remain uncommitted; no remote push was performed.

## Result

The desktop application is integrated at `apps/desktop` as `@agentlens/desktop`. Root scripts and the shared dependency lock include its build, type checks and tests. The original prototype remains a backup. Existing unrelated untracked work was preserved.

## Checks

- Frozen workspace installation succeeded across 11 packages.
- Repository type checks and production build passed; a final desktop build also passed after the filesystem restriction.
- Existing tests: 1,519 passed in 72 files. Final desktop suite: 85 passed.
- Existing web browser tests: 12 passed.
- Native Electron launch from the canonical checkout showed the preserved C01 comparison. A fresh browser tab also loaded the real comparison through the restricted development server.
- The recorded reader returned 102 events, and the comparison retained both attempts and their seven independent passing checks. Six frozen manifest input hashes remained unchanged.
- A synthetic empty-start native harness exercised the first-import entry point. This used an injected import response; it was not an end-to-end test of the operating-system file picker.
- Synthetic encryption failed under the renamed native identity and succeeded through the production legacy-identity helper. No real provider key was decrypted for migration verification.
- Canonical-path filesystem regressions passed: neighboring workspace and sensitive files were denied while ordinary desktop files remained available.
- Source candidate and archive checks found no credential patterns. Private runtime data, environment files, dependencies and build output are ignored. The tracked diff check passed during migration. Before committing newly imported files, the staged check flagged two required blank context lines inside the frozen `native-boundary.patch`; that artifact was preserved byte-for-byte, and the check passed for all other staged files.
- Independent bounded review approved the migration after import, documentation, native identity and filesystem findings were resolved. See [review history](REPOSITORY-MIGRATION-REVIEW.md).

## Boundaries

Validation ran on Node 26.7.0 with pnpm 11.25.0; Node 22.12 is the declared supported minimum, not an independently tested runtime in this migration. The existing web build still reports its nonblocking chunk-size warning.

Local private data is connected through an ignored symbolic link to the original prototype's private directory. That directory remains necessary on this machine until explicitly relocated. No live provider request was made. Previously incomplete provider analyses remain incomplete; this migration does not validate insight quality, implement general model orchestration, or produce a signed installer.

Run `pnpm desktop` from the repository root. The native app is left running, with a browser review preview at port 5178; documented development defaults use port 5177.
