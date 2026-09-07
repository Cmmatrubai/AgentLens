# Prototype 03 — real-run verification

Verified September 6, 2026, in the isolated desktop prototype. Canonical reader HEAD: `271b422ae5053bccc6d74fa5e86ba9b0e7aab01c`. This report covers the new read-only connection and focused regressions, not the complete AgentLens production test suite.

## Result

The Electron desktop window and built browser preview at `http://127.0.0.1:5178/#/recorded` both display T01-A1 from the real local recording. Reads return all 102 stored events, 21 terminal command actions, three failed commands and eight files from the validated final Git diff. The older fictional comparison flow remains reachable and labeled sample data.

`pnpm test`: **17 passed, 0 failed**. This includes eight existing sample lifecycle/projection tests, eight new evidence/HTTP-boundary tests and one real Vite private-file integration test. New evidence tests were observed failing against stubs before implementation. The file-serving regression reproduced the exposure before its fix and passed afterward.

`pnpm build`: **TypeScript check and production build passed**, no bundle-size warning. The recording screen is a separate lazy-loaded chunk. Native verification used Electron 44.2.0 with sandbox/context isolation enabled; Vite 8.2.2 and Node 26.7.0 were installed locally.

## Observed interface checks

| Check | Observed result |
| --- | --- |
| Real entry points | Recorded run navigation and the task-library card both open the real recording. |
| Desktop connection | Native bundled app loads the run through the restricted preload/main reader; reload retains the connected route and rereads evidence. |
| Failure evidence | Event #88 opens the full recorded failed-suite output and exit 1; this historical output includes 49 failed and 222 passed tests. Those are historical run results, not this prototype's test results. |
| Later validation | Event #92 opens output with 20 focused passes and one integration pass, while its compound test outcome stays unknown. |
| Command filters | All commands = 21, failed = 3, test-bearing = 6. An unmatched query shows an empty state; Clear filters restores results. |
| Final diff | Eight file entries are reachable. `packages/codex/src/lineDecoder.ts` opens actual diff lines and its validated final-artifact context. The view explicitly separates final Git evidence from action patches. |
| Ledger | Counted 102 rendered event rows. Search reaches event #101 and its historical Partial / completed Yes assessment. |
| Message wording | Event #12's forward-looking progress text is labeled AGENT MESSAGE, not a completion claim. |
| Provenance | Shows original run/event/artifact identity, reader revision, historical model unavailable, token usage redacted, current test-command/2 read derivation and incomplete stored derivations. |
| Refresh/error | Temporarily renamed only the prototype's private connection file. Refresh cleared the prior results and displayed unavailable evidence; restored the file, then Try again recovered the real record. No original evidence file was moved. |
| Keyboard | Cmd+K inside a recorded-evidence dialog no longer opens a second modal. Escape closes the diff and returns focus to its original file button. |
| Responsive layout | Visually inspected wide desktop/native, 900×800 overview and 820×800 evidence drawer. Browser document had no horizontal overflow; the 680px drawer fit the 820px viewport. Temporary browser viewport overrides were reset. |
| Sample regression | Task library and three-step sample setup remain available with sample-case checks and demo labels. Existing lifecycle tests remain green. |
| Browser logs | No warning/error entries returned by the final preview log check. |

## Read-only preservation

Compared the original replay SQLite database and all seven original artifact files before and after the reader and UI checks. **All eight match exactly on SHA-256, byte length and nanosecond modification time.** The comparison manifests are `preservation-before.json` and `preservation-after.json`. The secrets directory was excluded and not inspected.

Canonical Git status retained only its two pre-existing untracked entries (`design-prototypes/` and the Flight Console plan). This work did not modify canonical source, protected prototypes, Flight Console, the replay study, synced project sources, or stored assessments. It did not commit, merge, push or execute a provider model.

## Review and local-file protection

A separate reviewer inspected the bridge/projection/native boundary and reported two P2 issues: Vite development serving exposed private connection metadata, and all agent messages were labeled completion claims. Both were fixed. Live HEAD checks on port 5177 returned 403 for the connection file, encoded-dot path, absolute `/@fs` path and real-run QA manifest. No private file contents were printed during the exposure check. The new synthetic-marker integration test also preserves default environment/key-file protection.

The browser endpoint guard has focused tests for method, host, exact route, custom read header, Origin and fetch-site metadata. These are local development safeguards, not a production authentication system or a comprehensive security audit.

## Remaining work

`comparison-targets.json` records `gpt-5.6-sol` / `high` and `gpt-5.6-terra` / `high`, matching the user's selection. Both identifiers and high reasoning support were checked against the installed Codex model metadata. Status remains **requested_not_run**.

The controlled task/check manifest, two isolated provider attempts, independent evaluation, real comparison projection, persistent comparison history and packaged desktop distribution remain future work. The historical T01-A1 recording is not relabeled as either requested model and establishes no comparative model ranking.

## Local screenshots

- `native-overview.jpg`: native overview with the three primary evidence landmarks.
- `native-failed-command.jpg`: actual captured output in the native evidence drawer.
- `browser-final-diff.jpg`: actual final Git patch.
- `browser-unavailable.jpg`: cleared results and recoverable connection error.
- `browser-900.jpg`: compact desktop overview.
- `browser-820-evidence.jpg`: narrow evidence drawer.

These real-evidence QA files are blocked from Vite static serving and are not included in the renderer bundle.
