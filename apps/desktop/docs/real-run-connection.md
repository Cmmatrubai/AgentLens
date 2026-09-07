# Real recording connection — prototype 03

Implemented September 6, 2026 in the isolated desktop prototype. This is a local, read-only connection to one existing historical run, not a general run launcher or a packaged production integration.

## Configure locally

Create `apps/desktop/.local/connection.json` from the repository root with absolute paths appropriate to the machine. On the migration machine, the ignored `.local` link already supplies this file:

```json
{
  "repository": "/absolute/path/to/AgentLens",
  "dataRoot": "/absolute/path/to/recorded-data",
  "runtime": "/absolute/path/to/AgentLens/node_modules/.bin/tsx",
  "runId": "2049e5b9-c88e-4e95-8e7c-69d879ad6f1a",
  "title": "Keep oversized agent output under control"
}
```

The current interface is curated for this T01-A1 recording; pointing the configuration at another run is not a supported general import workflow. No credential belongs in this file. It is ignored by Git and denied by Vite file serving. The canonical checkout must have its dependencies installed. This implementation was verified against reader revision `271b422ae5053bccc6d74fa5e86ba9b0e7aab01c`.

From the repository root, use `pnpm desktop` for Electron or `pnpm dev:desktop` for browser development on `127.0.0.1:5177`. A built preview can run on port 5178 using `pnpm --filter @agentlens/desktop exec vite preview --host 127.0.0.1 --port 5178 --strictPort` after `pnpm build:desktop`. Open `#/recorded`. The UI reports a missing configuration as unavailable evidence.

## Read path

1. The UI calls one argument-free `readRecordedRun` operation. Electron exposes only that operation through an isolated, sandboxed preload. Main validates the sender is the bundled top-level page.
2. The local reader loads the private configuration. Renderer input cannot choose a path, executable, run or command. Simultaneous reads share one pending request; refresh starts a new read after completion.
3. A child helper runs under the canonical checkout's installed TypeScript runtime. This avoids sharing Electron's native SQLite ABI. It calls the existing `runInspectCommand` with JSON/native inspection and an explicit data root. The existing reader refuses unsafe paths and active WAL state; no migration, repair or backfill is performed.
4. Native command output is expanded by the canonical reader. Final Git diff bytes come from `readValidatedArtifact`, requiring the expected kind, media type, complete owner-only artifact and matching identity/hash, with a two-megabyte bridge limit.
5. A whitelist projection returns display fields. It excludes reviewer-note contents, arbitrary normalized/native payloads and private connection paths. It validates event ownership, sequence/ID uniqueness and test source references. It retains observed, derived, provider, Git and human provenance.

The child process is bounded by a 20-second timeout and 12 MiB output buffer. Event lists above 10,000 records fail validation. Output and per-file diff display are bounded to 180,000 characters and disclose truncation. Home and replay-workspace path prefixes are shortened for display; these substitutions are not a claim of universal secret detection. Canonical capture redaction remains the content boundary.

## Browser boundary

The browser reader accepts only `GET /api/recorded-run`, exact loopback hosts on ports 5177/5178, `X-AgentLens-Read: 1`, and same-origin browser metadata when present. No query arguments or arbitrary read endpoints are accepted. Responses use no-store, nosniff and same-origin resource policy. The API does not enable CORS.

Vite's default private-file exclusions are preserved, with additional exclusions for `**/.local/**` and `**/qa/real-run/**`. An integration regression checks ordinary and `/@fs` routes with synthetic private markers. This development boundary is not authentication against other local processes and is not suitable for a public deployment.

## Evidence interpretation

- The current run has 102 stored events, 21 terminal command actions, three failed commands and eight final-diff files. Its recorder elapsed time is 736.108 seconds.
- Event #88 is the recorded failed full-suite command. Event #92 is later compound validation: its output includes passing test text, but the derived individual test outcome is unknown. Six test-bearing commands are derived at read time: one failed, five unknown.
- The historical human assessment is `partial` / task completed `yes`; it is not a new correctness verdict. Later independent evaluation is outside this capture.
- Historical model identity is absent from run metadata, and token usage is unavailable because it was redacted. Neither is invented. Prototype 04 links the separately completed Sol/high and Terra/high comparison; this older recording is not attributed to either new model.
- Final Git changes describe the recovered repository state, not per-action patches. File-change events with paths only say that no action patch is attached.
- An unavailable or unsafe read clears prior UI results and shows a recoverable error. No fixture silently replaces real evidence.

## Remaining integration

Freeze a shared task/check manifest, execute the two requested models in separate clean workspaces, capture exact invocation settings, run independent checks and project comparable results. Then add real setup/lifecycle state and stored comparison history. This bridge performs no model executions, edits, evaluations, aggregate analytics or provider comparisons.
