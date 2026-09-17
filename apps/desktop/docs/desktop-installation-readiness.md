# Desktop installation readiness

## Implemented: persistent storage and setup visibility

Native bootstrap resolves storage before opening a renderer. New installations use `<userData>/data`; the location setting is kept in `<userData>/storage/location.json`. This follows [Electron's recommendation to use a subdirectory of userData](https://www.electronjs.org/docs/latest/api/app#appgetpathname).

Existing checkouts with a `.local` directory or symlink retain the canonical existing folder. AgentLens writes a persistent reference instead of moving data. Git worktrees, journals and comparison evidence contain absolute paths; blindly copying or renaming the directory is not a supported migration. A missing, changed or unreadable saved location blocks startup rather than silently creating an empty replacement. A write probe checks basic file creation and sync, not future disk capacity or all subdirectory permissions.

The desktop's existing native identity remains `agentlens-desktop-prototype` to preserve its Electron profile and credential behavior. That internal identity is not a public product name change. No credential re-encryption, worktree relocation or source-file deletion occurs. Once a location is pinned, subsequent checkouts using this same native profile share it. Browser development without native bootstrap continues to use its checkout's `.local` path.

The common root now routes live recordings, insight settings/credentials, selected comparisons, and the legacy recorded-run connection. The renderer cannot choose arbitrary roots through the environment IPC. The new Preferences section displays actual storage and probes Node, Git, Codex CLI and pnpm through the desktop process environment, with bounded subprocess time/output. Tool detection is not authentication, recorder compatibility, project-specific engine compatibility or a readiness certification. The existing Check setup action remains the launch preflight. No tool is downloaded or installed by this scan.

## Verification, 2026-09-15

- Fresh-directory tests verify application-data routing and persistence across a different checkout path.
- Existing-location tests resolve a symlink, preserve evidence, and reopen after the checkout symlink disappears.
- Missing saved storage, dangling legacy links and malformed settings fail closed.
- Environment tests distinguish missing tools from unsupported versions, suppress raw error text, reject foreign renderer frames, and ignore renderer-supplied paths.
- Native Electron restart pinned the existing canonical storage. Hashes of four existing selected-comparison, credential and workspace journal files remained unchanged. Preferences displayed the real root and installed versions: Node v26.7.0, Git 2.55.0, Codex CLI 0.154.0-alpha.6.2, pnpm 11.25.0. These are observed local versions, not declared minimum support for all features.
- All 300 desktop tests, root typecheck, desktop build and public-demo build passed. This was a development desktop test, not a packaged or fresh-machine acceptance test.

## Next release gates

1. **Distributable recorder runtime.** The live transport still imports source TypeScript through `tsx` and expects the monorepo layout. Bundle/compile the recording worker and dependencies, including SQLite compatibility, and prove it runs outside a development checkout. Specify supported Node/runtime versions and discovery for GUI launches with a restricted PATH. Do not present the existing build as installable.
2. **Installer packaging.** Choose the initial macOS architecture and packaging format, exclude `.local`, QA artifacts and prototype directories, and verify package contents. A signed/notarized installer and update strategy require their own acceptance evidence.
3. **Existing-workspace relocation.** Design an explicit move with quiescence, Git worktree repair, path/reference rewriting, verification and rollback. The current pointer preserves access but still depends on the old physical folder. Back up that folder before deleting any old checkout.
4. **Clean-machine acceptance.** Launch without development dependencies; test runtime discovery, credential setup, a real comparison, dependency preparation, check execution, reopening evidence, upgrade behavior and recoverable storage/tool errors.
5. **Broader preparation support.** Validate remote download failures, private registries and native dependency scripts before expanding the current conservative pnpm 11/macOS support contract.

Installer readiness remains incomplete until those gates have direct evidence.
