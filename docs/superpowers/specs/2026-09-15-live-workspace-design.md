# Live split workspace

Approved direction: start in AgentLens, choose a Git project, give two Codex models the same task, and watch recorded actions in two calm workspaces. This is a real recorder-backed workflow, not the existing demo playback or a terminal emulator.

## Invariants

- A launch freezes one prompt, two model/reasoning selections, a clean committed Git revision, and a per-attempt deadline. Two detached worktrees start at that revision. Never stash, reset, commit, or copy uncommitted user changes. Reject dirty repositories, unborn branches, bare repositories, and submodules with actionable explanations in this first version.
- Models run in parallel with workspace-write sandboxing, no approval bypass, no inherited user MCP configuration, and no automatic retries. Unsupported models and authentication failures are recorded attempt failures. Agent execution uses the user's Codex authentication; optional insight analysis retains its separate BYOK preview/consent flow.
- The Electron main process owns launch state and the selected project capability. Renderer reloads and route changes do not own or restart processes. Only trusted local main frames may invoke launch IPC. Inputs are validated again in the main process. No renderer-provided executable, shell command, data-root, or extra CLI arguments.
- Each recorder runs in a separate Node child process. Live updates originate only from persisted, redacted events. A bounded activity preview does not replace the full recorder ledger. Never claim private reasoning, independently verified correctness, or complete output when evidence is missing or truncated.
- Each side can stop independently. Stop and timeout request recorder cancellation and its existing process-group cleanup. App quit waits for cancellation/finalization; parent disconnect also requests cancellation. Restart never automatically reruns or reattaches using a PID alone. Unfinished persisted jobs are marked interrupted, with evidence and worktrees retained.
- Freeze terminal states. Duplicated clicks, stale responses, navigation, and worker errors must not launch duplicate attempts or overwrite a different job. Worker exit without a final result is failure, never success. Disk errors stop the affected work and stay visible.
- Preserve partial recordings and output on failure. Show saved paths. Completed pairs open through the existing comparison/insight pipeline. No independent evaluator is scheduled by this release, so correctness is unknown. Failed/partial runs remain inspectable in the live workspace.

## UI

The own-comparison page offers a project picker, shared task, two model fields with recognizable suggestions, and a clear Start recorded comparison action. Explain committed revision, authentication, sandbox, local recording, and model usage before launch without a wall of technical detail. Imports remain available as a secondary disclosure.

The live workspace has a shared task header and two equally weighted lanes. Each lane shows model, real state, elapsed time, and meaningful recorded actions. Expand an action to inspect command output, changed paths, or an agent message. Recent activity is bounded and explicitly labeled. No fake progress percentage or simulated stage. Quiet runs show last activity time rather than guessing they are stuck.

Keep each lane's scroll independent. Appending events must not pull readers away from older evidence; an explicit Jump to latest action follows new activity. Do not announce every log line to screen readers. Announce lifecycle changes politely. All controls need keyboard focus, labeled fields, and visible disabled reasons. Use short entrance transitions, suppress them for reduced motion, and stack lanes at narrow widths.

## Lifecycle and edge-case acceptance matrix

| Condition | Required behavior | Verification |
| --- | --- | --- |
| No Git/Codex/Node runtime or signed-out Codex | Actionable prerequisite error; no worktrees or paid calls | Fixture command failures |
| Invalid/missing project, dirty tree, changed HEAD | Reject launch; preserve source; refresh project | Real temporary Git repositories |
| Same model twice, blank/oversized prompt, malformed input | Validate; same model requires different settings or explicit useful distinction | Controller tests |
| Double start/concurrent IPC | One accepted job; no duplicate process launches | Controller concurrency test |
| One side fails/finishes first | Other continues; separate states and preserved evidence | Fixture worker integration |
| Independent stop/deadline | Cancel only intended side; drain/finalize recorder | Real recorder plus fixture Codex |
| Quiet/bursty/oversized output | Honest waiting state, bounded UI, full ledger capture limits honored | Flood and quiet fixtures |
| Spawn error/crash/malformed IPC | Failed state; no synthesized completion | Worker transport tests |
| Disk write failure | Visible failure; stop work; no false saved claim | Fault injection at storage boundary |
| Reload/navigation/reopen | Restore state without relaunch; interrupted recovery after shutdown | Controller and native UI checks |
| Old job response/stop request | Cannot mutate active replacement job | Identity tests |
| Partial pair/no independent checks | No correctness winner; partial evidence preserved | Comparison handoff tests |
| Keyboard/reduced motion/narrow window | Operable controls, readable lanes, no forced motion | UI checks and CSS/build validation |
| Untrusted frame or arbitrary path/command input | IPC denies request; renderer cannot spawn arbitrary commands | IPC boundary tests |

## Explicit limits

Codex execution is the initial adapter. Interactive terminals, live follow-up prompts, automated environment installation, other agent adapters, independent evaluation setup, and packaged installer distribution are separate capabilities. Model account access cannot be proven without a provider call; overnight verification uses fixtures only. Runtime and UI results must be reported separately from real-provider validation.
