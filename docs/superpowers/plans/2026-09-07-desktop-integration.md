# Desktop integration implementation plan

> Execute inline using the executing-plans workflow. The user requested migrating the iterated desktop app into the actual AgentLens repository.

**Goal:** Make the existing desktop application a runnable and testable AgentLens workspace package.

**Architecture:** Import the isolated desktop app into apps/desktop, retaining its existing UI and evidence contracts. Keep the CLI, server and web packages in place. Integrate package scripts and dependency locking, without adding provider calls or changing original recordings.

**Tech stack:** Electron, React, TypeScript, Vite, the existing pnpm workspace and Node test runner.

**Constraints:** Work in the requested canonical checkout on codex/desktop-integration. Preserve existing untracked work. No push or commit is requested. Exclude dependencies, generated builds, credentials and runtime data from imported source. Preserve frozen C01 input bytes. Retain the original prototype as a rollback copy.

- [x] Import source, tests, experiment inputs, documentation, QA reports/screenshots and historical source archive into apps/desktop. Exclude .local, node_modules, dist, Python caches and the standalone dependency lockfile. Retain the synthetic import fixture; exclude local QA data snapshots.
- [x] Name the package @agentlens/desktop. Add root desktop, dev:desktop, preview:desktop, build:desktop and test:desktop scripts, and include desktop build/typecheck/test in root checks. Set the workspace floor to Node 22.12 for the desktop toolchain; execute desktop TypeScript tests through tsx rather than requiring native type stripping.
- [x] Merge dependencies into the root pnpm lockfile and enable the Electron install hook. Verify that an unchanged frozen install succeeds.
- [x] Attach existing private .local data through a Git-ignored local-only link. Check that source candidates contain no credentials and that private artifacts cannot be served by the development server.
- [x] Run the migrated desktop suite and build, then repository typecheck/build/tests. Inspect the migrated app in Electron and the browser with the same saved C01 evidence. No live provider requests.
- [x] Update the repository README and migration report with actual paths, launch commands, verification results and remaining product limitations. Leave the migrated application running from the canonical checkout.
