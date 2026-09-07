# AgentLens insight engine v1 — approved design

Status: approved September 6, 2026, with bring-your-own-API-key analysis. The first local implementation uses OpenAI Responses behind Electron, accepts normalized saved comparison bundles, and validates evidence references before displaying interpretations. Offline and desktop verification are documented in `../qa/insight-engine/REPORT.md`; live quality evaluation remains pending. The C01 example notes remain authored demonstrations, separate from generated revisions.

September 7 implementation update: the user requested other OpenAI-compatible endpoints. The adapter now supports configurable base URLs, Chat Completions or Responses, three JSON output modes, and optional authentication. This extends the original provider choice while retaining local storage and explicit evidence review. See [endpoint setup](insight-compatible-endpoints.md) and the [verification addendum](../qa/insight-engine/COMPATIBLE-ENDPOINTS.md).

## Product promise

Given two captured attempts at the same coding task, help the user understand what differed, why that difference matters to the task, and what the available evidence supports. Present at most three findings, each with evidence from the relevant attempts, a practical implication and a limitation. Zero findings is a valid result.

The goal is a useful decision or review direction, not a recap of tool calls. A finding can identify different implementation structures, validation coverage, recovery from failures, or a tradeoff between observed completion time and verified outcomes. It must not infer internal model reasoning, unmeasured resource usage or a general model ranking.

## Options and recommendation

1. **Deterministic facts plus AI interpretation — recommended.** Software computes observable facts and supplies a bounded evidence bundle. AI proposes explanations. Software validates source associations and structural constraints; evaluated editorial behavior determines whether the explanations are useful and supported.
2. **Rules and templates only.** Good for exact check differences and measured durations, but limited for explaining unfamiliar code changes and task-specific strategies. Retain this as the factual fallback when AI is unavailable.
3. **An unrestricted model reading entire transcripts.** Convenient for an exploratory prototype, but source selection, context limits, reproducibility and unsupported claims are harder to control. Do not use this as the production contract.

## Smallest useful scope

- Accept two supported AgentLens recordings and a shared task description. Start with the normalized Codex recordings already supported by this project, while treating model identities as data rather than Sol/Terra-specific names.
- Check shared task identity, starting revision and declared controls. Different tasks or bases are ineligible for matched comparison in v1; disclose other control differences that limit interpretation.
- Keep capture completeness separate from independent evaluation. Finished, inspectable attempts can support workflow findings even without independent checks. Correctness remains unknown in that case. Partial captures may show factual evidence coverage, but v1 does not generate comparative AI conclusions from them.
- Generate on an explicit **Generate insights** action. Opening or refreshing a comparison remains read-only. Reuse saved results for unchanged evidence; regeneration is a separate action.
- Reuse the existing finding cards and paired evidence view. Keep authored C01 notes visibly separate from newly generated analysis revisions.
- General task execution, provider orchestration for coding attempts, cross-task leaderboards and hosted account/billing services remain separate milestones.

## Data flow

**1. Normalize the comparison.** Introduce a versioned input contract with comparison/task identity, task text, declared controls, two attempt IDs and model configurations, capture status, available event/file evidence and optional independent check results. An adapter maps the existing C01 reader into this contract. A general saved-recording adapter follows the same interface; analysis code must not read a C01 path or use model-specific branches.

**2. Build facts and an evidence index.** Compute check outcome differences, recorded durations, recorded command exits, available changed-file scope and capture limitations from the normalized records. Check counts never come from the summarizer. Keep observed commands, agent-authored assertions, final Git diffs and independent evaluator findings distinct. A command exit of zero is not automatically proof that the task succeeded.

Create opaque evidence references for bounded source excerpts, each bound to its attempt, source identity, provenance, digest and display range. The model chooses references from this index; the server supplies the source text shown in the UI. Include task goals, independent outcomes and relevant evidence around failures, subsequent validation and final implementation changes. Bound total input and per-source size; record selection rules, included ranges and omissions. Insufficient coverage must not become an assertion that an action never happened.

**3. Propose findings.** Supply the same task-aware rubric for every pair: relevance to the request, observable differences, practical implications, verification strength and limits. Require structured results with zero to three findings. Each finding includes a title, category, summary, per-attempt observations, cited evidence IDs, interpretation and limitations. Comparative statements need support from both attempts. Absence claims require coverage evidence. Task-specific recommendations must state the supporting criterion; no overall winner is required.

Record the analysis model/configuration, prompt and rubric versions, source-selection version, input digest, timestamp and provider-reported usage when available. Logs, patches and agent messages are untrusted evidence, not instructions. The analyzer has no shell, repository-editing or external-action tools.

**4. Validate and persist.** Reject malformed output, foreign references, swapped attempts, invalid excerpt ranges and unsupported evidence types. Independent outcomes and measured metrics remain typed facts outside the AI-authored text. Recheck input identity before publishing a result; evidence changed while a job was running makes that result stale. Save generated analysis separately from recordings and evaluator records, with immutable revision metadata.

Reference validation establishes which source was used, not whether the source entails the interpretation. Do not label a structurally valid finding as independently proven or assign an invented confidence percentage. Quality evaluation and user feedback handle semantic correctness. A later contradiction can mark an analysis revision superseded while preserving the original revision and evidence.

**5. Present the answer.** Show a short outcome summary and at most three meaningful findings. Each opens paired evidence. Distinguish not analyzed, analyzing, findings available, no supported differences found, insufficient evidence, stale analysis and generation failure. API failure must leave recorded facts readable and offer a deliberate retry. Show coverage limits next to the conclusions they constrain.

## Execution and privacy

Run insight generation as a persisted desktop job behind the Electron main-process boundary. Use a stable job key derived from input digest, analyzer configuration and version metadata so double clicks or refreshes do not duplicate generation. Apply a configured input/output budget and timeout. After a crash, reconcile an interrupted job before retrying; preserve completed analysis versions.

The selected initial deployment stores recordings and insights locally and uses the user's own API key and configured analysis model. Clearly explain that selected source excerpts leave the machine when remote analysis is enabled. Keep credentials in the OS credential store, outside renderer state, logs and comparison artifacts. Reuse existing redacted evidence, exclude unrelated workspace content, and show the categories/ranges selected for analysis. Redaction is not a guarantee that proprietary source contains no sensitive information. The first provider/model adapter will be selected during implementation planning; the shared engine contract does not depend on that choice.

Local-only analysis can implement the same analyzer interface later. A hosted AgentLens service is also possible, but introduces account, storage, quota and billing requirements beyond this first engine. Provider calls begin after the user configures a key/model, enables remote analysis and starts an insight job.

## Acceptance and quality evaluation

- Feed different attempt/model identities through the same engine without modifying source code or adding a curated finding file.
- For C01, generate findings from the saved evidence without supplying the existing authored notes as prompt content. Evaluate against evidence, not wording similarity to those notes.
- Before calling the feature ready for other users, evaluate on at least one additional real recorded task held out from prompt development. Synthetic fixtures exercise edge cases but do not substitute for this demonstration.
- Include fixtures for a meaningful difference, equivalent outcomes with different approaches, no material difference, missing independent checks, incomplete capture, malformed provider output, changed source hashes, misleading agent self-reports and instruction-like content embedded in logs.
- Measure valid evidence-reference rate, whether each material claim is supported, whether significant contradictions are surfaced, whether findings are useful for the task, and whether the engine abstains appropriately. Human-reviewed labels anchor the quality set; a second model's agreement alone is insufficient.
- Swapping left/right attempt order should preserve supported conclusions and correct source attribution. Repeated analysis should be checked for materially contradictory recommendations. Report observed variation rather than assuming determinism.
- Verify no recording mutation, no false pass from absent checks, no stale insight reuse, duplicate-job prevention, retry/restart behavior, bounded inputs, and observed latency/usage on the chosen provider.
- Browser and Electron verification covers generation, no findings, failure/retry, stale results, source switching and keyboard navigation at desktop and compact widths.

## Suggested delivery order

1. General comparison input and evidence-reference contract, plus C01 adapter and fixtures. This establishes the reusable boundary independently of provider choice.
2. Analyzer interface, structured generation, validation and versioned local result storage with failure handling.
3. Generate/retry/regenerate UI, persisted jobs, source-coverage disclosure and paired evidence integration.
4. Quality evaluation on C01 and a held-out real task; use observed failures to refine selection and the rubric before a broader release.

The first demonstration of success is a new recorded task producing useful, inspectable findings without a developer writing its conclusions. Reliable facts, evidence selection, reproducible analysis and evaluation quality are the engineering substance of this milestone.
