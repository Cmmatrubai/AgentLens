# In-app command verification

Completed desktop workspaces now offer **Verify the result**. Name a condition, enter a shell command, choose a time limit and confirm execution. AgentLens snapshots both retained attempts before running that same command sequentially in separate copies. The panel shows progress, cancellation, saved results and expandable output; **See comparison** opens the outcomes alongside the recordings.

This is command verification. Exit zero means the supplied command passed; a normal nonzero exit means it failed. Missing tools or dependencies can also produce nonzero exits. The command and its assertions determine what the result proves. Timeouts, cancellation, interrupted execution, preparation failures and unconfirmed process-group cleanup remain unknown. Agent claims stay separate.

## Evidence and recovery

- Original workspaces are never the command working directory. Both snapshots include tracked edits, deletions and nonignored untracked files, with content and executable-mode hashes. Copying rejects symlinks, files over 16 MiB, totals over 64 MiB and more than 10,000 files. A second source check detects changes during copying.
- A snapshot describes the retained workspace at verification time, including any manual edits after recording. It is not automatically proof of the exact original final state.
- Each evaluation has a unique ID, snapshot manifests, bounded command output and an output hash. Finalized runs are archived before the UI offers another run. The comparison displays the current run; earlier runs remain on disk.
- One evaluation runs at a time. Shutdown cancels it, including a launch racing with the initial save. Restart never retries a command automatically; interrupted work requires explicit confirmation that its processes have stopped.
- Failed acknowledgment writes do not unlock a new run. Missing/corrupt evidence does not turn into a passing result or hide the original recordings.

Files live under the configured desktop live-workspace root: `<job>/check-state.json`, `<job>/check-runs/<evaluation>/`, and `<job>/check-history/<evaluation>.json`. The existing local development root may resolve through a symlink; moving that data root is a separate migration.

## Current execution boundaries

The first runner requires macOS and `/usr/bin/sandbox-exec`, with no unrestricted fallback. The profile denies network access and file writes outside the evaluation copy. Commands can still read local files: this is not a hostile-code isolation environment. Only a small environment allowlist is inherited, with isolated HOME and TMPDIR. Timeout/stop sends TERM then KILL to the process group; confirmed group termination is not proof against a deliberately escaped descendant.

The snapshot omits Git metadata, ignored files and installed dependency directories (`node_modules`, `.pnpm-store`, `.venv`). The optional **Install locked dependencies before checking** step supports pnpm 11 on macOS. It installs from each snapshot’s own manifests and lockfile, with scripts disabled and network downloads allowed only during setup. Both setups must succeed before either command runs; setup failure leaves both correctness outcomes unknown. Dependency fingerprints, tool versions, command, bounded output and durations are saved separately from test execution. Uncommitted result manifests are included; no Git metadata is added to evaluation copies. Without this option, use commands that work with copied sources and available tools. Packaged runtime discovery, private registries and Windows/Linux runners remain follow-ups. See [dependency preparation](dependency-preparation.md).

Only the first 16 KiB of combined stdout/stderr is retained. ANSI/control characters and local home paths are sanitized; this is not comprehensive secret redaction. Avoid commands that print credentials. The command itself is saved locally with the evidence.

## Real desktop trial — 2026-09-15

The normal Electron UI ran a newly authored check on the earlier real GPT Sol high and GPT Terra high draft-retention attempts. It injects an extra nested model field, saves the draft using each implementation's exported API, and asserts that the field was excluded. The small API adapter is part of the saved command.

- Workspace: `687edb0d-61a3-45ae-a168-565cda1f96a6`.
- Evaluation: `8b3a799d-3dc0-4892-8bf9-5768d46cf755`.
- Sol: exit 0, 127 ms; output confirms nested non-draft fields were excluded.
- Terra: exit 1, 111 ms; `AssertionError: Unexpected nested metadata was retained in the saved draft`.
- Both outputs and snapshot hashes were saved. No new model/provider call was made for this check.

These are results for one post-hoc condition on these retained attempts, not a general model ranking. The desktop review confirmed the result panel, collapsed command disclosure, readable sub-second durations and navigation to the comparison.

## Validation

`tests/live-checks.test.ts` exercises real local commands, copying, executable modes, deletion, symlink/size rejection, output limits, external-write denial, timeout and cancellation. `tests/live-check-service.test.ts` exercises real pass/fail persistence and reopening, retry history, interruption, failed acknowledgment saves, shutdown during initial save and missing snapshot evidence. Existing controller and IPC tests cover the trusted desktop boundary.


## Dependency preparation acceptance — 2026-09-15

Native Electron QA reused the isolated local fixture workspace `ca8ca662-8c55-4c2d-821d-39d45e7e8cbf`. Evaluation `f0abb125-9624-42aa-87f2-f9cf13473369` installed a local workspace package independently into both Git-free check copies, then ran a real Node assertion on its exported value. Both passed: setup took 397/403 ms, commands 94/96 ms. Saved timestamps establish that neither command began until both installs ended. Original manifests and lockfiles were unchanged, and no post-install sentinel was produced. The native UI showed saved installation output and promoted the checks into the comparison. No model calls occurred.

A separate real subprocess regression runs the project’s pnpm test script and produces pass/fail on deliberately divergent fixture results. Additional regressions cover missing lockfiles, setup failure, stop/shutdown during setup and missing saved preparation evidence. Final validation: 294 desktop tests passed, root typecheck and desktop/public-demo builds passed. Network registry failures are currently simulated at the setup boundary, not a fresh-machine remote-registry acceptance test.
