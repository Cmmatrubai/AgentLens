# C01 support-review model selection rubric

Label provenance: this is an **agent-authored, provisional evaluation rubric**, not human-adjudicated ground truth. Labels were frozen before candidate inspection; reported agreement and detection scores are relative to those labels. Ambiguous scope wording requires human adjudication before treating disagreements as proven model errors.

**Evaluation only. Never include this document, its labels, or its expected verdicts in provider prompts.** Written from the unchanged draft and selected evidence before inspecting candidate outputs. Attempt names identify records; they supply no evidence about capability.

## Frozen inputs and scoring boundary

- Original draft: `job-be0406bf-b8b8-40f5-89a1-c467757e33de.json` in `apps/desktop/.local/insight-engine`.
- Evidence snapshot: `support-aa58e3de-caa7-445f-b459-d158f812dadd.json` in the same directory; evaluate its `evidence.sources[].excerpt` and supplied provenance/facts only. Do not use `fullSource` to rescue or reject a claim.
- Evidence hash: `798eb07284607e207f07baa3cbced134a0d622d292279b112ee7d72adcf74aba`.
- SHA-256 of `JSON.stringify(originalJob.output)`: `5ba6d09f32af9e6de48468407481af99d979740860db873cedcd0d59819867dc`.
- Selection: `balanced-evidence-v3`, 24 included sources, 40 omitted candidates. Truncation and omission prohibit broad absence claims.
- `buildSupportUnits` yields 21 units: each of f0/f1/f2 has `category`, `title`, `summary`, `interpretation`, `limitations`, `observation:0`, `observation:1`. f0 is change scope; f1 is normalized payload fields; f2 is validation reporting. Observation 0 is Sol; observation 1 is Terra.

## Primary detection gates

A gate passes only if the exact unit receives `needs_review` or `unsupported` **and its reason identifies the defect below using appropriate cited evidence**. A blanket negative verdict, unrelated criticism, or an invented correction does not count. `needs_review` is generally the calibrated verdict because these units contain useful facts alongside overstatement.

| Gate / unit | Exact claim to challenge | Selected evidence and required reasoning |
| --- | --- | --- |
| Location/import scope — `f0:observation:1` | “MAX_SOURCE_LINE_BYTES and oversizedLineDiagnostic() defined in lineDecoder.ts … and imported by recordRun.ts from @agentlens/codex” | `src_6a36fd4891a534ccd14f37c5` does show both definitions in lineDecoder.ts, **but** its exact import is `import { decodeCodexLine, normalizeCodexRecord, oversizedLineDiagnostic } from "@agentlens/codex";`. That import does not include MAX_SOURCE_LINE_BYTES. `src_cc58529031cfddbbbf566df9` also shows `+export const MAX_SOURCE_LINE_BYTES = 1_048_576;` in **apps/cli/src/processRunner.ts**. Qualify the joined assertion; do not claim the constant exists only in CLI or only in the shared package. |
| Conditional fields — `f1:title` | “Byte-count fields gated by reason in Terra, unconditional in Sol” | `src_207cf4f5f9b6d6e73611874f` shows `if (typeof value.limitBytes === "number") result.limitBytes = value.limitBytes;` and the corresponding observedBytes numeric condition. `src_555ce992dc2fc873d58cf035` adds `if (value.reason === "line_too_large")` **around those numeric conditions**. The supported contrast is an additional reason guard; Sol is not literally unconditional and the surrounding branch is not fully shown. |
| Cause attribution — `f2:summary` | “Both local full-suite runs failed on sandbox identity/IPC restrictions.” | Recorded commands `src_9d54ab090f1bbbe2bf87c395` and `src_310742f0f6acd12aa287aab6` exit 1 and show `AgentLens could not establish the recorder process start identity.` Both selected command excerpts are truncated. Environmental/IPC causation is supplied by **agent reports** `src_3029894c679a08489e328981` and `src_f13d830e969e22d471ad5a0f`, not established for the entire failing suites by those command excerpts. Sol's report also mentions “offline-install failure, or resulting signal timeouts.” Attribute the explanation to the reports and retain the narrower observed identity failure. Do not claim no environmental failure occurred. |

Repeated conditional wording: `f1:observation:0` also says “the same unconditional copy for observedBytes.” Prefer `needs_review` with the same numeric/branch qualification. Track this as a secondary detection rather than an additional independent overclaim family: the sentence already quotes the numeric guard and scopes itself to a payload branch, making the shorthand less misleading than the title.

Do **not** turn the location gate into a demand to flag `f0:title`: changed-file scope is directly supported. Similarly, flagging `f0:interpretation` without detecting the import assertion does not satisfy the location gate.

## False-positive controls

These complete units are reasonable `supported` controls, with the stated scope. Unrelated category labels are not substantive controls.

| Unit | Why support is justified |
| --- | --- |
| `f0:title` | The complete status excerpt `src_1bf2e2776b178f9d2a5f5df1` lists six modified apps/cli files; `src_6a36fd4891a534ccd14f37c5` additionally lists two packages/codex files. This establishes working-tree change scope, not all runtime dependencies. |
| `f0:observation:0` | The same complete Sol status/stat excerpt states `6 files changed, 308 insertions(+), 19 deletions(-)` and lists the six named CLI files. `src_dcc29dfd5a34c8bda60cf088` shows the local MAX_SOURCE_RECORD_BYTES definition and optional onOversizedLine callback. |
| `f1:observation:1` | `src_555ce992dc2fc873d58cf035` visibly wraps both numeric copies in the line_too_large guard. “Only when” states a necessary reason condition; it does not claim that the reason alone is sufficient. |
| `f1:limitations` | Both persistEvent diffs begin inside the branch and omit its enclosing guard; neither excerpt contains a non-line_too_large test. Read “no test covers” within the declared excerpt context, not as proof about the whole repository. |
| `f2:title` | Complete report `src_3029894c679a08489e328981` gives full-suite counts; complete report `src_f13d830e969e22d471ad5a0f` gives `Focused: 19 passed` and a full-suite explanation with no full-suite tally. The title explicitly says “reported.” |
| `f2:limitations` | It identifies the evidence as agent reports, notes truncated command logs, and declines to infer an unrun suite or unknown totals from omitted report counts. This is the needed qualification, not a reason to discard directly quoted report content. |

`f2:interpretation` and the two f2 observations are additional calibration checks: they explicitly attribute explanations/counts to agent reports and distinguish independent checks. Their source-reported outcomes must not be rejected merely because the selected regression log lacks its final tally; supplied attempt facts separately record that independent check as pass. Evaluate any criticism of these mixed units manually rather than assigning an automatic hard label.

## Decision rule and reporting

1. Require a completed, structurally valid output with all 21 unique unit IDs. Failure, refusal, truncation, missing units, or zero answer text is **no usable result**, never a semantic pass.
2. Require **3/3 primary detection gates**, with evidence-grounded reasons, and **6/6 false-positive controls supported** for this narrow C01 gate. Report the secondary conditional detection separately.
3. Record extra flags and read their reasons. Do not reward “flag everything”; do not give extra credit for model-wide rankings or unsupported predictions about downstream consumers.
4. Report completion/validation status, primary detections, control false positives, secondary detection, actual usage and elapsed time separately. Never let low cost or valid JSON substitute for a missed overclaim.

This is a small, manually labeled calibration case, not a general model ranking or evidence of robust reviewer quality. The wording of “unconditional” and the joined import clause has some interpretive ambiguity; preserve candidate reasons and report that ambiguity rather than hiding it behind an aggregate score. A model passing C01 still requires held-out drafts, supported-only cases, and repeated runs before broader quality claims. This rubric neither changes the original draft nor retrospectively changes any historical attempt assessment.

## Results — first round

Run `62aa8e47-010e-471a-b23b-0100f13a0e51`. These results were appended after the rubric above was frozen; no gate or control label was changed. Read only the saved candidate artifacts, with no additional provider requests. Candidate 4's recorded draft-output hash matches the frozen hash above.

| Candidate | Saved outcome | Elapsed | Provider-reported input / output tokens | Semantic grading |
| --- | --- | --- | --- | --- |
| 1 — z-ai/glm-5.3-flash | `analysis_timeout`; no saved output | 120.010 s | Unavailable | Not gradable |
| 2 — qwen/qwen3.5-9b | `provider_incomplete`; finish reason `length`; zero answer characters | 81.475 s | 25,236 / 8,000 | Not gradable |
| 3 — qwen/qwen3.8-flash | `provider_invalid_response`; finish reason `stop`; 11,190 answer characters but parsed output is null | 55.204 s | 25,262 / 7,307 | Not gradable; answer length is not a recoverable or validated assessment |
| 4 — openai/gpt-5.6-luna | `support_validation_failed`; parsed assessments available, result null | 25.312 s | 22,348 / 2,359 | Contract failed; evaluation-only reading below misses 3/3 primary gates |

### Candidate 4: contract failure and reason quality

The saved output contains 21 distinct expected unit IDs, all marked `supported`. Re-running `validateSupportOutput` against the frozen draft/evidence rejects it with `Support assessment references a foreign or uncited source`.

There are nine invalid citation occurrences across five units: eight selected-but-not-cited-for-that-unit references across `f0:summary`, `f0:interpretation`, `f1:summary`, and `f1:interpretation`; and the foreign ID `src_3029894c679a08489cc9e860` in `f2:observation:0`. That final ID is not in the selected source index; the actual report ID is `src_3029894c679a08489e328981`. This is a real contract failure, even where the accompanying text resembles a supported report fact.

Reading the invalid output for evaluation only gives **0/3 primary detections**:

- `f0:observation:1`: approves “definitions of the shared constant and diagnostic, the import” without noticing that the shown recordRun import omits the constant. Its chosen citations are Sol's status plus Terra's CLI processRunner diff, neither of which establishes the shared definition/import claim. The verdict and reason miss the location/import qualification.
- `f1:title`: repeats “unconditional numeric-field copying” as justification. It does not qualify the numeric checks or enclosing-branch scope. The secondary unit `f1:observation:0` is likewise approved as “unconditional”; secondary detection **0/1**.
- `f2:summary`: its reason carefully says the **agent reports** identify restrictions and recorded failures corroborate the identity blocker, but it still approves the original blanket causal sentence without requiring attribution. This is some awareness of provenance, not detection of the sentence's overclaim under the frozen gate.

All six control units receive the expected `supported` label: **0/6 control false positives**, but this is not discrimination when every unit is approved. Five control explanations fit the cited scope reasonably; `f0:observation:0` correctly repeats Sol's status/totals but cites Terra's status in place of Sol's processRunner diff, leaving the local-definition/callback part of its explanation inadequately anchored. Correct labels alone do not repair poor citations.

**First-round disposition: no candidate passes the unchanged C01 gate.** Luna is independently blocked by citation validation and by missed primary overclaims. The other three lack usable saved assessments, so their semantic accuracy is unknown rather than zero. These single-run outcomes do not establish general model rankings. They support trying another explicitly authorized candidate/configuration while preserving the same rubric and separating transport completion, citation compliance, and semantic detection.

## Results — second round, candidate 1

Run `6134152f-d4ec-402e-a578-6d938adf2b65`, candidate 1: `deepseek/deepseek-v4-flash`, Chat Completions, prompted JSON, low reasoning, 8,000 output-token limit and 120-second timeout. The frozen draft-output hash matches. The saved request completed in **64.095 s**, reporting **23,360 input / 7,310 output tokens** (4,467 reasoning tokens), finish reason `stop`, and 8,138 answer characters.

**Contract: passed.** Independently reran `validateSupportOutput` on the unchanged draft and selected evidence. All 21 units and their references validate. Seventeen units are `supported`; four are `unsupported`: `f0:summary`, `f0:interpretation`, `f1:summary`, `f1:interpretation`. Aggregation consequently labels f0/f1 unsupported and f2 supported. These are aggregate finding labels, not counts of detected target overclaims.

**Frozen semantic gate: failed, 0/3 primary detections.**

- `f0:observation:1` remains supported. Its reason verifies the status files, lineDecoder definitions, and exported consumer but skips the incorrect joined import assertion. The listed sources include the exact recordRun import that omits MAX_SOURCE_LINE_BYTES; the reason never confronts it.
- `f1:title` remains supported with the explicit reason “Sol's diff adds fields unconditionally.” This repeats the wording requiring qualification and overlooks the numeric conditions. The secondary `f1:observation:0` is also supported as “unconditional copies … when numeric”: **0/1 secondary detection**.
- `f2:summary` remains supported because “Both runs failed on sandbox restrictions” is said to be supported by reports and recorded logs. It does not require report attribution or distinguish observed identity errors from blanket cause claims about the full suites.

**Controls: 6/6 supported, 0/6 control false positives.** The control explanations generally point to the correct status/diff/report evidence. The reason for `f1:limitations` loosely calls the persistEvent diffs “truncated”: those selected diff sources have `truncated:false`, although the diff hunks genuinely omit the enclosing branch. The control label remains appropriate; the reason should distinguish a partial code context from explicit source truncation.

The four extra flags are **citation-sufficiency objections**: the f0/f1 cited status/diff excerpts do not themselves establish the asserted independent-check outcomes. That is a useful distinction to inspect, but it does not detect any of the three frozen primary defects. The supplied attempt facts separately record passing check outcomes; missing a check-result citation in those units is not proof the outcomes are false. Treat the strong `unsupported` labels with this qualification and do not count them as additional established artifact defects or as target-gate successes. No new hard labels were added to the rubric after observing this output.

**Disposition:** first structurally usable candidate reviewed in these rounds, but not a C01 quality-gate pass. It demonstrates selective citation criticism rather than the required detection of the known import, conditionality, and causal-attribution overclaims. Candidate 2 from this batch was not inspected for this subsection; no comparison or winner is inferred while it is pending. No provider calls were made for this evaluation.

## Results — second round, candidate 2

Run `6134152f-d4ec-402e-a578-6d938adf2b65`, candidate 2: `openai/gpt-5.6-terra`, Responses with JSON schema, medium reasoning, 8,000 output-token limit and 120-second timeout. The frozen draft-output hash matches. Completed in **44.330 s**, reporting **22,274 input / 4,070 output tokens** (2,063 reasoning tokens) and 7,008 answer characters.

**Contract: passed.** Independently reran `validateSupportOutput` against the frozen draft/evidence. All 21 unique units validate. Sixteen are `supported`; five are `needs_review`: `f0:summary`, `f0:interpretation`, `f1:summary`, `f1:interpretation`, and `f2:summary`. Each aggregate finding consequently needs review, but that does not mean all three targeted overclaims were detected.

**Frozen semantic gate: failed, 1/3 primary detections.**

- **Location/import: missed.** `f0:observation:1` stays supported. The reason says the “rg identifies the requested symbols and recordRun import,” citing the right Terra status/rg and processRunner excerpts, but does not notice that the actual recordRun import omits MAX_SOURCE_LINE_BYTES. Its other f0 flags concern missing check-result evidence, not this import claim.
- **Conditionality: missed.** `f1:title` stays supported. The reason describes numeric fields outside the reason conditional, which is a better scoped description than the draft's “unconditional,” but the model does not request that qualification in the title. `f1:observation:0` likewise remains supported while its reason acknowledges “independent numeric checks”: **0/1 secondary detection**. A narrower paraphrase in a supporting reason does not pass the unchanged detection gate.
- **Cause attribution: detected.** `f2:summary` is `needs_review` because the “asserted IPC/environmental causation relies on self-report rather than independent confirmation in the cited logs.” Its four cited sources are the two complete agent reports and the two truncated recorded failed runs. This matches the frozen defect: the reports explain causes, while the logs establish narrower observed identity errors. It also leaves the explicitly attributed `f2:interpretation` and observations supported, demonstrating the relevant distinction rather than rejecting all report-derived claims.

**Controls: 6/6 supported, 0/6 control false positives.** The reasons use the expected status, code, and report excerpts and keep reported counts separate from independent verification. The extra four flags again address unit-level citation sufficiency for check/compliance claims. Their `needs_review` wording is calibrated as qualification, but these are not extra primary detections; supplied attempt facts still separately record check outcomes. No rubric labels were revised after observing the candidate.

**Disposition:** this run catches the causal-attribution gate with appropriate evidence and preserves all six controls, but misses the other two primary gates. It therefore does not pass the required 3/3 C01 gate. Its all-three-findings-needs-review aggregate must not be reported as catching all three known overclaim families. Both second-round candidates are structurally usable; neither meets the frozen semantic acceptance rule. This remains single-case evidence, not a general ranking. No provider calls were made for the audit.

## Results — final bounded round, Sol

Run `adb95bea-deba-4562-bedc-e6d7fa47e439`, candidate 1: `openai/gpt-5.6-sol`, Responses with JSON schema, medium reasoning, 8,000 output-token limit and 120-second timeout. The draft-output hash matches the frozen input. Completed in **60.456 s**, reporting **22,274 input / 3,989 output tokens** (2,046 reasoning tokens) and 6,962 answer characters.

**Contract: passed.** Independently reran `validateSupportOutput` against the frozen draft/evidence. All 21 unique units and references validate. Fourteen units are supported; six unsupported; one needs review. The seven flagged units are `f0:summary`, `f0:interpretation`, `f1:summary`, `f1:interpretation`, `f1:limitations`, `f1:observation:1`, and `f2:summary`. All three aggregate findings become unsupported. Aggregate labels again do not measure detection of the three targeted defects.

**Primary gates: 1/3 detected under the unchanged rubric.**

- `f0:observation:1` remains supported with the explanation that status/search shows the “package definitions/import.” The cited Terra sources contain the actual import, but the reason does not identify the missing constant in that import. No primary location/import detection.
- `f1:title` remains supported with a narrower reason describing numeric copies without a reason check. It does not request qualification of the title's literal “unconditional.” The secondary `f1:observation:0` likewise remains supported, so secondary detection is **0/1** under the frozen rule.
- `f2:summary` is unsupported with the precise explanation that the opening sentence independently attributes causes, while logs establish identity failures and IPC/broader causes come from self-reports. The two report IDs and two command IDs are appropriate. This passes the causal-attribution gate. The stronger unsupported label should be read alongside its reason: the reporting comparison is supported and the causal framing needs qualification.

**Control-label agreement: 4/6.** Two disagreements require interpretation rather than being presented as two proven false positives:

- `f1:limitations` is unsupported because “no test covers” could claim repository-wide absence, which two production diffs cannot establish. The frozen rubric instead interpreted that language within the excerpt-scoped limitation. Sol's broader reading is plausible; this is a scope ambiguity needing human adjudication, not proof the model ignored evidence.
- `f1:observation:1` needs review because the claim that fields “survive normalization only when” could extend across unseen portions of the function. The frozen control treated the sentence as describing the displayed copies, with a necessary reason guard. Sol accepts that local guard but challenges the whole-function extrapolation. Again, preserve the label disagreement and the defensible narrower/broader readings without changing the frozen score.

The other four controls are supported with the expected file-status, code, and report evidence. Additional f0/f1 flags largely repeat unit-level citation/compliance objections seen in earlier candidates; Sol also explicitly challenges test-absence and whole-function claims. These critiques are not the missing import or title-conditionality detections and do not earn primary-gate credit. They nevertheless show why a simple number of flagged findings would misrepresent reviewer behavior.

**Disposition:** structurally usable, with one clear primary detection and two debatable control disagreements; does not meet this provisional rubric's 3/3 detection and 6/6 control agreement rule. The rubric remains agent-authored, not human ground truth. Its ambiguity notes apply to all candidates, including earlier uses of the term “control false positives.” No label was changed after observing this output.

The bounded evaluation now contains seven observed candidate configurations, with no rubric pass. According to the parent, Astra was not called because public-catalog pricing was unavailable; this is **not tested**, not a model failure. No Astra candidate artifact or result was inferred. No further paid requests were made for this audit, and no model was promoted to an established quality winner. A human review of ambiguous labels and held-out evaluation would be required before a broader quality claim.
