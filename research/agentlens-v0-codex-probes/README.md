# AgentLens v0 Codex telemetry probe report

**Observed with:** `codex-cli 0.149.0-alpha.4` on 2026-08-26, in a disposable Git repository. These are compatibility evidence, not a forever schema promise.

## Probe inventory

| Trace | Scenario | Child exit | Key result |
|---|---|---:|---|
| `01-read-only-success.log` | Read two files with a shell command | 0 | One `command_execution` item exposes the shell command, complete aggregated output, `exit_code`, and final agent message. No first-class per-file-read event exists for the `sed` command. |
| `02-edit-and-test-success.log` | Add `multiply`, add its test, run `npm test` | 0 | The stream contains `file_change` start/completion records, command output, diff text only because the agent itself ran `git diff`, and token usage at turn completion. |
| `03-failure-recovery.log` | Start from a broken `subtract`, test, repair, retest | 0 | A failed command is an `item.completed` with `status: "failed"`, `exit_code: 1`, and output. A later command succeeds. This is the core trajectory AgentLens must show. |
| `04-interrupted.log` | Interrupt while shell `sleep 30` runs | 1 | The stream stops after `command_execution` is `in_progress`, followed by a diagnostic error. There is no terminal turn event. The recorder, not the provider stream alone, must close the run and resolve open items. |

The logs retain the exact merged harness output. The leading `Reading additional input from stdin...` line is a CLI/harness diagnostic and is deliberately **not** valid JSONL. The production recorder must pipe stdout and stderr separately; it must preserve any unexpected stdout line as an ingest diagnostic rather than discard it.

## Direct observations

### JSONL envelope

Successful streams began with:

```text
thread.started -> turn.started -> item.* -> turn.completed
```

The `thread.started` event carries `thread_id`; `turn.started` did not carry a turn identifier in these samples. Items had stable `id` values and a native `type`. The completion record for a command repeats the complete item rather than emitting a patch.

### Items observed

| Native item type | Observed fields useful to AgentLens | Canonical handling |
|---|---|---|
| `agent_message` | `id`, `text` | observed `message.agent` |
| `command_execution` | `id`, `command`, `aggregated_output`, `exit_code`, `status` | observed `command` lifecycle |
| `file_change` | `id`, absolute changed paths, `kind`, `status` | observed `file.change` lifecycle; no diff text supplied |
| `mcp_tool_call` | server, tool, arguments, result/error/status | observed generic tool lifecycle; payload is highly sensitive |
| `error` | error message | observed `error` |
| turn completion | token counts | observed `usage.reported` plus terminal run state |

The official [Codex non-interactive-mode documentation](https://learn.chatgpt.com/docs/non-interactive-mode) likewise describes `thread.*`, `turn.*`, `item.*`, and `error`, and names agent messages, reasoning, commands, file changes, MCP calls, web searches, and plans as item types. Its [App Server documentation](https://learn.chatgpt.com/docs/app-server) says completed items are authoritative and supports generating a version-matched JSON Schema bundle. The v0 wrapper should still tolerate any unknown event or item type.

### Not directly observable in this integration

- A tool-neutral, authoritative per-file read list. A shell command may read any number of files, or none.
- A file diff from the `file_change` item. A diff is recoverable from Git for a clean repository, not from that item.
- Source event timestamps. The probe events had ordering but no per-event timestamp. AgentLens must use recorder receipt time and a monotonic sequence.
- Test semantics. `npm test` is recognizable by a versioned heuristic; it is not a provider truth assertion.
- The agent's private reasoning or causal intent. Exposed reasoning summaries, if emitted, are observable content—not ground truth about internal reasoning.
- Reliable code-change attribution when the worktree is dirty or another process edits it during recording.

## Event-coverage matrix

| Product question | Coverage | Evidence / rule |
|---|---|---|
| What prompt initiated this run? | **direct from wrapper** | Persist the explicitly supplied prompt; it is not present in the sampled `--json` stream. |
| Which Codex thread ran? | **direct** | `thread.started.thread_id`. |
| What did the agent say? | **direct, content policy applies** | `agent_message.text`. |
| Which shell command ran? | **direct** | `command_execution.command`. |
| Did that command fail? | **direct** | completed command `status` + `exit_code`; do not infer from message text. |
| What did the command print? | **direct, content policy applies** | `aggregated_output`; externalize large content. |
| Which files did native edit tooling changed? | **direct but incomplete** | `file_change.changes`; absolute paths must be redacted/relativized. |
| What files did the agent read? | **unavailable as a complete fact** | Shell output can suggest candidates only; no v0 `file.read` claim. |
| What changed overall? | **recoverable from Git** | Clean-repo before/after snapshot + diff/untracked metadata. |
| Were tests run/passing? | **derived from observed commands** | Versioned command classifier plus command exit; label as `likely_test`. |
| Was the task actually correct? | **human assessment** | `unreviewed | success | partial | failure`, never an automatic v0 score. |
| Did the run end cleanly? | **direct + recorder inference** | terminal event and child exit when present; otherwise the recorder marks interruption/recovery. |
| How many tokens were used? | **direct when emitted** | `turn.completed.usage`; nullable, never estimated. |

## Portability check: Claude Code hooks

The canonical model is portable if it normalizes *lifecycle facts*, not Codex item names. Current [Claude Code hooks](https://code.claude.com/docs/en/hooks) provide a compatible second adapter shape:

| Claude hook | Canonical event | Important limitation |
|---|---|---|
| `UserPromptSubmit` | `run.started` + `prompt` | It occurs for every prompt in a session, so one prompt-to-stop span is one AgentLens run. |
| `PreToolUse` | `tool.started` | `@` prompt-file references do not invoke a `Read` hook. |
| `PostToolUse` | `tool.completed` | Provider-specific payload determines output granularity. |
| `PostToolUseFailure` | `tool.failed` | Does not cover pre-execution validation or permission denials; model these separately if exposed. |
| `Stop` / `SessionEnd` | `run.completed` / `run.interrupted` | A session may hold many runs. |
| transcript enrichment | optional native artifact | Useful for enrichment, never the sole source of lifecycle truth. |

Claude's hook documentation confirms `UserPromptSubmit` includes session id, transcript path, cwd, and prompt; `PreToolUse` has tool name/input/use id; and `PostToolUseFailure` has error, interruption, and duration fields. This validates the canonical envelope's provider-neutral lifecycle, correlation identifier, status, source payload, and capture-policy fields. It does **not** validate identical coverage: Claude's hooks observe `Read` tool calls, while Codex `exec --json` cannot make that same promise for shell-driven reads.

## Conclusion

The proposed first vertical slice is validated: **a local wrapper around `codex exec --json` can faithfully record a reviewable observable trajectory—commands, output, failures, file-tool changes, Git outcome, messages, and usage—without terminal scraping.**

The validation also changes the design in three material ways:

1. The recorder owns interruption closure and receipt timestamps.
2. Raw event preservation is mandatory, but it must be redacted before durable storage.
3. The model must distinguish observed, derived, recovered-from-Git, and human-assessed facts everywhere.
