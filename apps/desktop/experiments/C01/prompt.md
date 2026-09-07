# C01: Keep oversized agent output under control

Implement this task in the supplied historical AgentLens repository. Leave your changes in the working tree and report exact validation results. You have a 15-minute execution limit. The installed dependencies are available offline.

The recorder currently handles Codex stdout and stderr as JSONL. One extremely large record can consume excessive memory and interfere with the following valid record.

Requirements:
- Enforce a maximum source-record size of 1,048,576 bytes, excluding LF or CRLF delimiters, independently for stdout and stderr.
- Discard oversized content before UTF-8 decoding, JSON parsing, redaction or persistence. Do not parse truncated JSON.
- Emit exactly one content-free recorder diagnostic for each oversized record: event kind `recorder.stream_diagnostic`, no native payload, and normalized payload fields `stream` (`stdout` or `stderr`), `reason: "line_too_large"`, `limitBytes: 1048576`, and the observed byte count. The byte-count property may be named `observedBytes` or `observedByteLength`; no specific summary text or module layout is required.
- Resume with the next record. Correctly handle split byte/UTF-8 boundaries, multiple records per chunk, blank lines, CRLF including split delimiters, and a final record without a newline.
- Await persistence callbacks and apply input backpressure so a blocked callback cannot create an unbounded in-memory record/promise queue.
- Add regression tests for the 64 MiB case, boundary framing and backpressure. Keep production interfaces compatible where possible.
- Run focused tests, the full suite with `pnpm vitest --run --no-file-parallelism --maxWorkers=1`, and `pnpm typecheck`. Report failures and uncertainty honestly.

Known historical evaluator issue: the existing test `returns bounded truncation metadata instead of parsing or emitting truncated native JSON` in readCommands.integration.test.ts expects a provider record over 10 MiB to be retained as a native artifact. That contradicts this task's new 1 MiB source limit. Do not edit or weaken that existing test. The independent evaluator will replace only that assertion with a source-limit assertion, accepting either byte-count property above. Report this known failure separately if encountered. Other existing tests must remain unchanged.

Use only this repository and installed dependencies. Do not read other projects, prior attempts, evaluator files, user skills or task history. No web search, MCP, subagents, external services, dependency upgrades, Git history beyond HEAD, remotes, pushes or commits. Work directly from the task; no approval or planning pause is required. Do not alter existing test assertions, configuration, instruction files or captured AgentLens data. New tests may be added. Your final working tree will be evaluated independently.
