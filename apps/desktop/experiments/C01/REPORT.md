# C01 — a real Sol/high and Terra/high comparison

Completed September 6, 2026. Both attempts met the seven checked conditions on the same historical AgentLens task. This is one controlled pair, not a general model ranking.

| Observed result | GPT-5.6 Sol / high | GPT-5.6 Terra / high |
| --- | --- | --- |
| Independent conditions passed | 7 / 7 | 7 / 7 |
| Independent regression suite | 265 passed, 0 failed | 265 passed, 0 failed |
| Additional behavior tests | 5 passed, 0 failed | 5 passed, 0 failed |
| TypeScript check | Passed | Passed |
| Recorder elapsed, excluding external evaluation | 487.865 seconds | 419.411 seconds |
| Recorded events | 89 | 73 |
| Completed command actions / failed commands | 20 / 3 | 13 / 2 |
| Final tracked files changed | 6 | 8 |

Terra finished this attempt 68.454 seconds sooner. Execution order, one repetition, shared hardware, and different agent validation work prevent treating that difference as a reliable model-wide speed advantage. No cost, peak-memory, aggregate-quality, or general model-strength claim is made.

## The task and controls

The task asks an agent to keep a malformed 64 MiB output record from overwhelming the recorder: enforce a 1,048,576-byte source-record limit before decoding, parsing, redaction or persistence; emit a content-free recorder diagnostic; resume subsequent records; and apply callback backpressure. The exact prompt and tests are adjacent to this report.

- Starting commit: `45e56bd1eecdcf42e0a052726c479da9db5b303e`; starting tree: `88ec80a74ceecc315a7108dcc8842ce810fab73a`.
- Separate shallow repositories, no remotes or future reference commits; matching frozen dependencies installed offline. The clean baseline's original suite passed 265 tests before execution.
- Models: `gpt-5.6-sol` and `gpt-5.6-terra`, both explicitly configured with `model_reasoning_effort="high"`; no fallback.
- Codex CLI `0.153.4`; canonical AgentLens recorder at `271b422ae5053bccc6d74fa5e86ba9b0e7aab01c`; 15-minute limit each, including agent validation.
- Sequential order: Sol, then Terra. Native Codex workspace permission profiles disabled tool network access and denied reads of known canonical/history/sibling/evaluator locations. Benign probes verified the relevant read boundaries. User configuration, rules, Chronicle, web search and multi-agent execution were disabled. These controls do not establish perfect isolation from every possible side channel.
- The same prompt, behavior bundle, one-test supplement, recorder runner and permission arguments were hashed before the completed coding attempts. The external evaluation orchestration was implemented afterward; it did not change the frozen prompt or assertions. Its result classification was hardened to keep a passed assertion with nonzero runner exit unknown. Both actual external runners exited zero, so that hardening changed neither result.

The [official Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference) documents native permission profiles and reasoning settings. Private launch files retain the exact actual arguments.

## Independent evaluation

Each final source tree was hashed and copied into a separate evaluator checkout. The original attempt was never patched by the evaluator. Baseline test assertions and fixtures were restored in evaluator copies, and new agent-authored test files were excluded from grading. Agent-authored changes and tests remain preserved for inspection. No agent changed package or test-runner configuration.

One inherited 10 MiB truncation test contradicted the requested 1 MiB source-record limit. The exact one-test correction was disclosed in the prompt and frozen before execution. It changes an assertion, not product code. All other baseline tests remained intact.

Five additional behavior tests check oversized stdout, oversized stderr, the exact byte boundary and CRLF, text/final-record framing, and backpressure. Before launch, the unmodified baseline passed 1 and failed 4; the known historical reference passed all 5. This supplies a negative and positive control, not exhaustive correctness proof.

Seven displayed conditions comprise these five behavior tests, the complete corrected regression suite, and TypeScript checking. A suite is one condition, not 265 extra points. Actual command output and its SHA-256 accompany every condition; missing output cannot become a pass.

Both agents reported sandbox restrictions during their own full-suite validation. The recorded failures remain visible in the attempt inspectors. The independent evaluator subsequently ran outside those agent tool restrictions and passed both final submissions. Agent explanation, observed command exit, final Git state, and external check results remain separate evidence.

## Identities and preserved startup failure

| Identity | Value |
| --- | --- |
| Comparison | `C01-20260906-sol-terra-high` |
| Frozen manifest SHA-256 | `8f7aa61872a532d98fb593375fe40703f4070a211e4d542acb19d2386015d6aa` |
| Sol completed run | `8ab28f60-f273-4b9d-a2f2-96c59026aa82` |
| Terra completed run | `6e2db9e4-d6a1-44a8-b9bb-ec39e3caf181` |
| Sol final source snapshot SHA-256 | `93e9457ccab361ac442be7a2a70f13e27ec85fe1142c078c7ea8223bdc99f3d9` |
| Terra final source snapshot SHA-256 | `80d11fc206988c921aabaf2f6e60cc42070dcc3d5845527e33774644bb90dcb2` |

The first Sol launcher failed before any provider/model event: `bafa0225-c64d-410e-a42d-33db8cf7997e`, with `Operation not permitted`. The outer process sandbox blocked CLI initialization. That recording and original manifest are preserved separately; it is not counted as Sol coding quality. The launcher was changed to native tool permission profiles, then the final manifest was frozen before the two completed coding attempts. There were two completed coding attempts plus this preserved startup failure.

## Evidence retention and reader boundary

Private evidence lives under `.local/comparison-C01/`, excluded from source control and Vite development file serving. Each attempt retains launch/result metadata, evaluator JSON and text output, hashes, a full final-source archive and patch. The archive also retains byte-identical recorder databases/artifacts and canonical-inspector JSON with expanded, validated native and final Git evidence.

Canonical artifact paths are absolute, so relocating a raw database does not itself make a portable recording. The comparison reader uses the preserved validated inspection JSON and verifies its hash, archived recording bytes, manifest/input hashes, exact recorded invocation/prompt, source-snapshot identity and evaluator output on every read. It does not rewrite a database to change artifact paths. Original temporary roots are retained, but the completed comparison display does not depend on them.

These hashes detect drift in the local bundle; they are not a signed public attestation. The browser receives a bounded, selected projection through a guarded, argument-free read. Electron exposes only allowlisted reads to the bundled top-level page. Viewing or refreshing runs no model and changes no recorded evidence.

## Limits and next product boundary

- The stderr test checks oversized stderr discard and subsequent stdout recovery; separate stderr recovery is not established.
- One-byte producer writes can be coalesced by the OS. Exhaustive split UTF-8 coverage is not established.
- Backpressure uses a two-second blocked interval and a baseline negative control; it does not measure peak RSS.
- One pair cannot establish reliability, run-to-run variance, broad model rankings or production readiness. No human success assessment or AI judge was added.
- This is a functioning local prototype integration. Setup still launches sample playback, and the homepage's illustrative analytics remain demo data. General case execution from setup, cancellation/recovery against live jobs, repeatable comparison history, packaging/signing, and production integration remain future milestones.

The historical T01-A1/A2 study is separate. Its database and seven artifacts retained identical bytes, hashes and modification times. Canonical source and the other AgentLens worktrees were not modified; no merge, commit, push or publication was performed.

See the [interface verification report](../../qa/real-run/comparison-C01/REPORT.md) for the desktop/browser checks and saved screenshots.
