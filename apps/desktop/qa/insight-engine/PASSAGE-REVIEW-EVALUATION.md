# Passage-review evaluation

Evaluation only. This report and the [frozen model-selection rubric](MODEL-SELECTION-RUBRIC.md) must never be included in provider prompts. Rubric labels are agent-authored and provisional, not human-adjudicated ground truth. No frozen labels were changed for this report. No credentials, full provider response bodies, or private reasoning are reproduced here.

## v3 disposition

**Neither v3 request produced a usable support review.** The first reached the provider output limit. The second completed at the provider but failed local exact-passage validation. Its parsed output is retained for evaluation, while its validated result remains null. Nothing should be promoted from either run.

Both requests used `openai/gpt-5.6-terra`, Responses with JSON schema, medium reasoning, a 120-second timeout, and the unchanged C01 draft/evidence. Schema version was `support-v3`; prompt version was `evidence-support-v3`.

| Saved run | Output limit | Elapsed | Provider input / output tokens | Provider outcome | Local outcome | Estimated cost |
| --- | ---: | ---: | ---: | --- | --- | ---: |
| `26fd37da-e2cf-43e6-94a9-d1e2c2754747` | 8,000 | 63.513 s | 22,135 / 8,000 | Incomplete; finish reason `length` | `provider_incomplete`; parsed output and result null | $0.14027 |
| `696ce579-07c4-40e6-9c7f-0c99212970b7` | 12,000 | 51.835 s | 22,135 / 7,150 | Completed | `support_validation_failed`; parsed output retained, result null | $0.13007 |

Each artifact is `candidate-1.json` under `apps/desktop/.local/insight-engine/model-selection/<run>/`. The first records 28,130 answer characters but no parsed output, so it cannot be semantically graded. The second records 28,291 answer characters. These lengths do not imply valid or trustworthy assessments.

Costs use the parent-verified router rates supplied for this audit: $2 per million input tokens and $12 per million output tokens. Formula: input tokens × $2/1,000,000 + output tokens × $12/1,000,000. Combined estimate: **$0.27034**. These are estimates from provider-reported usage, not bills or proof of the final charged amount.

## Input and inspection boundary

The original draft is `job-be0406bf-b8b8-40f5-89a1-c467757e33de.json`; the evidence snapshot is `support-aa58e3de-caa7-445f-b459-d158f812dadd.json`, both under the private insight root. Draft-output SHA-256 is `5ba6d09f32af9e6de48468407481af99d979740860db873cedcd0d59819867dc`; evidence input hash is `798eb07284607e207f07baa3cbced134a0d622d292279b112ee7d72adcf74aba`. The saved source-evidence hash matches the original snapshot for both runs.

This audit used the selected `excerpt` strings and the v3 canonical attempt-facts text, `JSON.stringify(attempt, null, 2)`. It did not use `fullSource` to rescue a quote. Graph tools were unavailable; this was a bounded direct-source/artifact inspection. Original jobs, evidence, candidate artifacts, and the frozen rubric were not edited. The evaluator made no provider calls.

## Exact-passage and claim coverage observations

The 12,000-limit output contains **21 distinct unit IDs, 47 proposed claims, and 72 passage occurrences**. Sixteen units were split into multiple claims; five remained single claims. This demonstrates that splitting occurred, not that every split is a semantically independent claim.

Independently reconstructing the historical v3 S/A reference map and testing each passage with exact `record.text.includes(quote)` yields **18 mismatched passage occurrences across 10 units**. Occurrences, rather than unique quote strings, are counted because the same malformed transcription is reused in multiple claims.

| Units containing mismatches | Mismatched occurrences |
| --- | ---: |
| `f0:interpretation` | 2 |
| `f0:limitations` | 2 |
| `f0:observation:0` | 1 |
| `f0:observation:1` | 1 |
| `f1:title` | 2 |
| `f1:summary` | 2 |
| `f1:interpretation` | 4 |
| `f1:observation:0` | 1 |
| `f1:observation:1` | 1 |
| `f2:limitations` | 2 |

Examples include removing diff-line prefixes from code quotations, composing noncontiguous lines into a purported contiguous quote, quoting truncation metadata as if it occurred inside excerpt text, and assigning a task-requirement sentence to a report that does not contain it. Some underlying observations may still be true, but v3 requires an exact quotation from the named record text. Provider completion therefore cannot override local rejection.

## Provisional semantic assessment of the invalid raw output

These are evaluation-only observations, not validated UI findings. For comparison with the frozen unit-level rubric, a unit is provisionally flagged when any of its proposed claims is flagged. Correct-looking reasons do not repair the contract failure.

| Primary gate | Provisional result | Reason assessment |
| --- | --- | --- |
| `f0:observation:1` — location/import | **Missed** | Its two claims remain supported. The second groups definitions, import, and exported consumer together and approves them. Even its proposed passage displays a recordRun import that includes the diagnostic but omits MAX_SOURCE_LINE_BYTES; the reason does not address that mismatch. |
| `f1:title` — conditional wording | **Missed** | Both split claims remain supported. Worse, the Terra reason-guard claim is paired with Sol's unguarded-by-reason evidence/explanation, while the Sol “unconditional” claim is paired with Terra's reason-guard evidence/explanation. Splitting has not ensured correct attempt association. |
| `f2:summary` — cause attribution | **Detected provisionally** | The opening causal sentence receives needs_review. Its reason distinguishes observed identity failures from IPC/environmental attribution supplied by agents, matching the frozen target defect. The reporting-count comparison is separately supported. |

Primary detection: **1/3**. Secondary conditional-wording check `f1:observation:0`: **0/1**, since it remains supported with unconditional-copy wording. These scores remain relative to the provisional frozen rubric.

| Frozen control | Provisional raw unit verdict | Agreement |
| --- | --- | --- |
| `f0:title` | supported | Yes |
| `f0:observation:0` | supported | Yes |
| `f1:observation:1` | supported | Yes |
| `f1:limitations` | needs_review | No; scope interpretation is debatable |
| `f2:title` | supported | Yes |
| `f2:limitations` | supported | Yes |

Control-label agreement: **5/6**. The disagreement challenges whether a test-absence claim can be established from selected names and omitted details. The frozen rubric interpreted that limitation within the excerpt context. Preserve both readings; this is not a proven false positive. Agreement elsewhere is label agreement only: for example, the f2 limitations verdict uses a metadata quotation that fails the exact-text contract.

Two further reason-quality concerns matter without changing the frozen gates. First, `f2:interpretation` flags wording that already attributes causal explanations to the reports, reasoning that these are reports rather than independent cause evidence; that criticism does not respect the statement's explicit attribution. Second, a compatibility requirement in `f0:interpretation` is treated as an unverified agent account even though the task prompt supplies that requirement. Neither is rescued by producing more claims or longer output.

## v4 protocol before execution

Following the v3 failures, the parent introduced a v4 design using line selections to avoid quote transcription and metadata confusion. The evaluation retained the historical v3 records and the unchanged rubric, and assessed v4 separately for structural validity and provisional semantic detection. The protocol change itself established no success, promotion, or quality improvement.

## v4 follow-up outcome

This subsection records the subsequent v4 result. It does not replace or reinterpret the historical v3 artifacts.

**V4 also produced no usable support review.** Run `3f35cbc7-aa35-46b5-b560-45730766c1d4`, `candidate-1.json`, completed at the provider in **45.054 s** but failed local validation with `support_validation_failed`. Parsed output is preserved; the validated result is null. No rule was relaxed to accept or promote it.

The request used `openai/gpt-5.6-terra`, medium reasoning, Responses with JSON schema, an **8,000-token output limit**, and versions `support-v4` / `evidence-support-v4`. Provider usage was **30,875 input / 5,355 output tokens**, including 562 reported reasoning tokens; answer length was 19,620 characters. Using the same parent-verified $2/$12 per-million-token rates gives **$0.12601 estimated cost**. The three passage-review requests total **$0.39635 estimated**, not billed or invoiced cost.

V4 selects numbered source-text or separately labeled metadata lines, with quotation reconstruction performed locally. The original C01 draft, selected evidence, and provisional frozen rubric remain unchanged.

### Independently checked range failures

The saved raw output has **21 units, 55 proposed claims, and 82 passage selections**; seventeen units were split. Rechecking selections against the frozen v4 evidence-line builder confirms **12 invalid range occurrences**:

- **Nine overlong attempt-fact selections:** A1/A2 lines 15–75 are **61 lines inclusive**, exceeding the fixed 60-line cap. These occur in f0 summary, f0 limitations, f1 interpretation, and f1 limitations.
- **Three out-of-bounds selections:** `f0:interpretation`, third claim, selects S21 lines 33–75 although S21 has 74 lines. `f1:limitations`, first claim, selects S19 lines 5–14 although S19 has 13 lines, and S20 lines 5–16 although S20 has 15 lines. Claim positions here are one-based.

These are failures of the published range contract. Provider completion, recoverable raw text, and potentially sensible reasons cannot override them. The audit did not clip ranges, enlarge the cap, repair the saved output, or construct a promotable result.

### Provisional semantic findings

As with v3, the following examines invalid raw content for evaluation only. A unit is provisionally flagged if any of its claims is flagged. This is not a validated result or an independent correctness assessment.

| Frozen primary gate | Provisional result | Source/reason assessment |
| --- | --- | --- |
| `f0:observation:1` — location/import | **Missed** | Three claims are supported. The middle claim again states that both symbols are imported by recordRun. S13 lines 9–24 contain the actual import, which lists the diagnostic but not MAX_SOURCE_LINE_BYTES; the reason nevertheless says recordRun imports the symbols. Splitting separated the consumer export, but did not detect the joined import assertion. |
| `f1:title` — conditional wording | **Missed** | Two claims are supported. The attempt associations are correct in this output: Terra's guard uses S20, and Sol's copy conditions use S19. However, the Sol reason acknowledges type checks while approving the title's unqualified unconditional wording. It does not request the frozen gate's qualification. |
| `f2:summary` — cause attribution | **Detected provisionally** | The opening causal sentence needs review because the recorded logs show identity failures while IPC restrictions are agent-reported. The selected S7/S8 text contains the identity errors, supporting that narrower observation. Reported counts and descriptions are separately supported. |

Primary detection remains **1/3**, and the secondary `f1:observation:0` unconditional-wording check remains **0/1**. The raw findings would have worst-unit flags, but no aggregate was validated or promoted; such hypothetical aggregate labels are not gate scores.

| Frozen control | Provisional raw unit verdict | Agreement |
| --- | --- | --- |
| `f0:title` | supported | Yes |
| `f0:observation:0` | supported | Yes |
| `f1:observation:1` | supported | Yes |
| `f1:limitations` | needs_review | No; scope interpretation remains debatable |
| `f2:title` | supported | Yes |
| `f2:limitations` | supported | Yes |

Control-label agreement remains **5/6**. The f1 limitations reason says omitted evidence prevents establishing universal test absence; the rubric's control interpreted the statement within the excerpt context. Preserve this as a label disagreement rather than a proven false positive. The other control explanations generally address the relevant local diff, file-status, or report distinction. For the f0 observation control, the selected constant/callback range shows only part of the callback signature; the broader original excerpt supports the local claim, but range selection is still not a semantic guarantee.

Two additional observations qualify any apparent improvement. V4 correctly distinguishes report attribution in the middle of `f2:interpretation`, unlike the v3 raw output. Yet it separately marks the task's exact-validation requirement unsupported, reasoning that task wording does not establish that requirement. It similarly rejects the compatibility requirement in f0 interpretation even though both requirements are explicitly in the supplied task prompt. These are reason-quality problems outside the primary gate count; no labels were added or changed after inspecting them.

### Bounded-iteration disposition

All three passage-review requests remain unusable: one provider-incomplete output, one v3 exact-quote validation failure, and one v4 range validation failure. The two preserved raw outputs each provisionally detect only the causal-attribution gate and agree with five controls. Line-based selection changed the failure mode; it did not establish successful completion or adequate semantic quality in this observation.

V4's 45.054 seconds is shorter than the completed-provider v3 request's 51.835 seconds **in these individual observations only**. They used different payloads, protocols, input lengths, and output limits (v4 8,000 versus that v3 request's 12,000). This is not evidence of a general speed improvement or a causal performance result.

According to the parent, no more paid calls are planned for this iteration. This audit made none and changed only this evaluation report. No model/configuration is promoted as a reliable reviewer, and the original evidence, failed outputs, schema rules, and agent-authored frozen rubric remain preserved.

## Implementation and verification

- Current protocol: `support-v4` / `evidence-support-v4`. Every original section must be covered by ordered, non-overlapping claim text, and every passage must select valid bounded source-text or source-metadata lines. Quotes are reconstructed locally, preserving original line endings and diff markers. Exact-but-irrelevant evidence remains semantically unverified.
- The desktop adds collapsed **Inspect claim checks**, with distinct labels for source text, source details, and attempt facts. The consent dialog exposes exact fact and metadata records alongside the original draft and selected excerpts. Older support versions become stale without rewriting their files.
- Fresh verification: **1,519 repository tests and 153 desktop tests passed**, along with desktop typecheck/production build and staged/unstaged diff checks. The v4 backend and presentation tests cover line/character bounds, invalid references, skipped text, provenance, full-source exclusion, stale consent, persistence, and fail-closed promotion. An independent bounded code audit found no P1/P2 defects; that is not an exhaustive security certification.
- Native visual QA used isolated offline fixtures for flagged and supported findings, exact quotations, metadata labels, collapsed claim inspection, and consent details. These fixture verdicts do not measure AI quality. The real desktop was restored to C01 and its original three findings remain unreviewed. The existing browser preview was refreshed; no generation was initiated from either real UI.
- All **11 pre-existing private JSON files** retained their SHA-256 hashes and modification times after the three live requests and UI checks. This includes original drafts, saved support jobs, settings and encrypted credentials. Trial records are separate, ignored local files.
- Reproduce only the current protocol with `node qa/insight-engine/review-passages-v4.cjs --plan qa/insight-engine/passage-review-plan.json --check` for offline validation. Native execution without `--check` makes the explicitly listed paid requests. Historical v3 entry points retain their version guards and will refuse execution against v4 modules. There are no automatic retries.
- No commit or push was performed. The held-out real comparison, repeated/reversed-order review, and semantic release gate remain outstanding.


## Later protocol

The September 14 follow-up uses a fixed passage catalog (`support-v5`) rather than generated ranges. See [CATALOG-REVIEW-EVALUATION.md](CATALOG-REVIEW-EVALUATION.md). The v4 snapshot is preserved in `protocol-snapshots/support-v4.json`; the historical entry points intentionally refuse newer production protocol modules. The results above remain unchanged.
