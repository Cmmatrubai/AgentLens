# Controlled comparison C01 implementation plan

> Execute the approved next milestone in the current isolated prototype worktree. Use the executing-plans workflow for the implementation and requesting-code-review for a bounded independent check.

**Goal:** Record one Sol/high and one Terra/high attempt on the same real historical coding task, evaluate both with a frozen external check bundle, and expose the evidence in the desktop prototype.

**Architecture:** Existing canonical AgentLens recorder captures each real CLI invocation into separate fresh data roots. Identical shallow historical repositories contain no future commits or prior attempts. Evaluation uses fresh copies of each final tree, frozen checks and the previously verified one-test historical supplement. A read-only comparison projection supplies the existing desktop shell.

**Stack:** Existing TypeScript AgentLens reader/recorder, Node harness, Vitest independent checks, React/Motion desktop UI, restricted Electron IPC/local browser reads.

**Spec:** Approved comparison direction in `docs/comparison-data-contract.md`; exact task in `experiments/C01/prompt.md`.

## Constraints

- Exactly one intended coding attempt per requested model, `gpt-5.6-sol` and `gpt-5.6-terra`, `model_reasoning_effort=high`, 900-second cap each. Preserve failed invocations; no silent model fallback.
- Historical base `45e56bd1eecdcf42e0a052726c479da9db5b303e`; identical prompt, check bundle, dependencies, recorder and CLI. Sequential model runs avoid concurrent benchmark CPU contention.
- Separate new comparison experiment C01; do not rewrite or resume historical T01-A1/A2 study records. No canonical source or Flight Console changes.
- Only externally verified check results become comparison pass/fail. Agent output, Git changes, human review and evaluator outcomes remain distinct. No general model ranking from one pair.

## Task 1 — freeze and verify experiment controls

- [x] Create an isolated shallow baseline and two identical local attempt repositories; verify the same HEAD/tree and no remote/future-reference resolution. Install frozen dependencies offline.
- [x] Write independent behavior tests covering oversized stdout/stderr discard, recovery, exact size/framing, content-free diagnostics and callback backpressure. Verify the baseline fails the new behavior and the known reference passes. Copy the existing one-test boundary supplement without modification; hash task/tests/supplement before either model starts.
- [x] Write a bounded runner using canonical `recordRun` with an AbortController at 900 seconds. Store launch parameters, exact invocation, local timestamps and returned run identity. Use a native Codex permission profile with deny-read controls for known canonical/history/evaluator/sibling roots, proved with benign probes; keep workspace writes and disable tool network access. Preserve the failed outer-sandbox startup separately.
- [x] Record the launch manifest and baseline results under `.local/comparison-C01` and experiment documentation. Do not expose private connection/evaluation files through Vite.

## Task 2 — execute and independently evaluate

- [x] Run Sol/high once through the recorder; preserve terminal status and final patch. Start Terra/high only after Sol terminates.
- [x] Evaluate each frozen final tree in separate copies, with original baseline tests restored, the declared one-test supplement and the identical external behavior bundle. Store output hashes, command exit status, condition results and typecheck separately from provider events. Preserve modifications/new tests for inspection without letting agent-authored assertions determine external grades.
- [x] Validate matching manifest hashes and provenance. If a model or evaluator cannot run, present the attempt as failed/unavailable; do not invent comparison metrics.

## Task 3 — connect and verify the comparison

- [x] Add tests for mismatched manifests, incomplete attempts, unknown/missing evaluator output and attempt identity before implementing the comparison projection.
- [x] Add one allowlisted argument-free comparison read through the existing browser/native boundary. Render task outcome, both model identities/reasoning settings, check matrix, measured durations and inspectable evaluator/provider evidence with the existing restrained visual system.
- [x] Run focused tests/typecheck/build; review actual native/browser comparison and evidence drawers at wide/narrow widths, empty/error states and keyboard focus. Obtain bounded code/evidence review and fix concrete findings.
- [x] Verify historical data/canonical tree remain unchanged, update experiment report/coordinator ledger, and leave the real comparison open. No commit, push, publishing or human assessment mutation.

Completion evidence: `experiments/C01/REPORT.md` and `qa/real-run/comparison-C01/REPORT.md`. Both model attempts and all independent commands completed successfully; all seven conditions passed for each. General execution from setup remains outside this milestone.
