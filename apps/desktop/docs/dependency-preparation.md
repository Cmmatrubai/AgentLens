# Dependency preparation

Live comparison setup can install dependencies into both detached working copies before either coding agent starts. Project selection detects committed package manifests and a pnpm lockfile. The setup option explains package downloads, script restrictions and the five-minute timeout per copy; users can also choose a source-only run.

## Supported first path

- macOS, installed Node and pnpm 11 available on the desktop process's PATH. An exact declared `packageManager` version must match. AgentLens does not install global tools or download a managed runtime.
- A tracked root `package.json` and `pnpm-lock.yaml`, with `node_modules` ignored. Workspace package manifests are included in the input fingerprint.
- Custom npm configuration/hooks, mixed lockfiles, managed runtimes and direct external file/link/URL dependency declarations are rejected. This detection is conservative; it is not a full parser or policy validator for all pnpm workspace settings or transitive lockfile sources.

Installation uses `--frozen-lockfile`, `--ignore-scripts`, `--ignore-pnpmfile`, `--no-runtime`, strict engine/version checks, no automatic package-manager switching, no side-effects cache, and separate stores/home directories. The saved command retains all effective options with the store path represented as `<per-copy-store>`. See [pnpm's install documentation](https://pnpm.io/cli/install); the implementation is specifically tested with pnpm 11.25.0.

Package downloads may use the network. The installer receives a small environment allowlist without inherited provider credentials. macOS write restrictions limit writes to the working copy and its setup directory. Local reads and network access remain allowed: this is not isolation for hostile repositories. Lifecycle scripts are disabled, so native or generated dependencies may still be unusable. Private authenticated registry setup is not supported in this first path.

## Saved evidence and recovery

Each side retains tool versions, input fingerprint, command, bounded output and its hash, exit status, setup duration and timestamps. Install time is separate from agent time. Both successful installations are required before either agent is launched. A failure on one side prevents both launches. Stop and app shutdown cancel preparation; uncertain process-group cleanup remains visible. Escaped descendants are outside that process-group guarantee.

An interrupted saved installation is never retried automatically. Damaged saved preparation data is skipped with a recovery warning. Output is retained on completion, rather than streamed during the install; the live UI shows the current phase without an invented percentage. Saved output is bounded and common key-shaped strings are masked, but this is not comprehensive secret detection.

## Validation, 2026-09-15

Final validation: all 289 desktop tests passed, root typecheck passed, desktop and public-demo builds passed, and `git diff --check` passed.

Real subprocess tests installed a local workspace dependency, loaded its export, preserved the lockfile and skipped a post-install sentinel. They also exercised a stale lockfile, a process timeout, changed input rejection and pre-cancellation. Controller tests cover both-copy ordering, asymmetric failure, stop and shutdown cancellation, plus malformed saved preparation data.

Native Electron QA used the production renderer/controller/recorder with real pnpm installs and local fixture agents. Job `ca8ca662-8c55-4c2d-821d-39d45e7e8cbf` completed both recordings after both installs finished; each fixture loaded `setup-helper` from its prepared copy. The source checkout and lockfile were unchanged, and the actual post-install sentinel was absent from all three directories. No model/provider requests were made. This proves the local workspace path, not remote registry or fresh-machine installation readiness.

Reproduce the native fixture with `AGENTLENS_LIVE_QA_DEPENDENCIES=1 pnpm exec electron qa/live-workspace.cjs` from `apps/desktop` after building. Select the fixture project, keep dependency setup enabled and launch the comparison. Fixture storage remains separate from personal recordings.

## Remaining work

Post-run command verification now offers separately recorded dependency preparation before executing network-disabled check commands. It uses each copied result’s manifest list, including uncommitted files, without adding Git metadata. Both successful setups are required; versions must match across the pair, while each result can have distinct dependency inputs. See [command verification acceptance](command-verification.md). Further validation of unavailable remote downloads, private registries and runtime discovery remains open. Installer packaging, application-data migration, clean-machine runtime provisioning, signing and broader platform/package-manager support remain separate release milestones.
