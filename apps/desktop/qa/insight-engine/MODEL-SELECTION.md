# Selecting a practical support reviewer

September 7, 2026. The user authorized testing any model available through the existing TokenRouter endpoint to improve speed and cost. This is a bounded engineering evaluation of AgentLens's evidence-support task, not a general model leaderboard.

## Availability and prices

Authenticated `GET https://api.tokenrouter.com/v1/models` returned 135 entries. Metadata includes endpoint types but no pricing or per-parameter capabilities. Public catalog prices were checked separately. Availability in the list does not prove a successful request.

| Candidate | Input / 1M tokens | Output / 1M tokens | Listed supported transport used |
| --- | ---: | ---: | --- |
| [GLM-5.3 Flash](https://www.tokenrouter.com/models/z-ai/glm-5.3-flash/) | $0.075 | $0.25 | Chat Completions |
| [Qwen3.5-9B](https://www.tokenrouter.com/models/qwen/qwen3.5-9b/) | $0.10 | $0.15 | Chat Completions |
| [Qwen3.8 Flash](https://www.tokenrouter.com/models/qwen/qwen3.8-flash/) | $0.1177 | $0.3971 | Chat Completions |
| [GPT-5.6 Luna](https://www.tokenrouter.com/models/openai/gpt-5.6-luna/) | $0.20 | $1.20 | Responses |

These are router-listed USD rates, not measured charges. Cost estimates use reported input/output token counts and these uncached rates; caching, routing, discounts, billing granularity and failed-request charges can change the actual bill. Reasoning tokens are part of output usage, not an additional amount to add twice.

Other inspected available candidates included GPT-5.4 Nano, DeepSeek V4 Flash, Gemini Flash variants and Claude Haiku. The current adapter supports Chat Completions and Responses; the inspected Gemini and Haiku listings advertise different native formats. They are not silently sent through an unadvertised route. [TokenRouter's guide](https://www.tokenrouter.com/docs/tokenrouter-feature-guide/) describes the catalog and usage-log boundaries. [OpenAI's Luna documentation](https://developers.openai.com/api/docs/models/gpt-5.6-luna) lists low reasoning support; TokenRouter's actual handling remains an empirical compatibility check.

## Frozen first-round protocol

- Same unchanged C01 draft, selected evidence and support-v2 / evidence-support-v2 prompt as the previous failed review. No authored qualifications or evaluation labels enter the request.
- 21 original-text units; exact complete coverage and valid citations required before semantic scoring.
- Prompted JSON, low reasoning requested, 8,000 output tokens and 120-second deadline for every candidate. API route differs only according to the model's advertised transport. Providers may interpret reasoning effort differently.
- Four sequential requests, one per model, no automatic retry. Failures remain results, not omitted samples. This smaller allowance differs from the historical GLM-5.3 24,000-token/300-second request, so latency comparisons to that run are descriptive rather than controlled speed estimates.
- The [evaluation-only rubric](MODEL-SELECTION-RUBRIC.md) was written before candidate outputs were inspected: three specific overclaim gates and six supported controls. Verdicts alone do not pass a gate; the explanation must identify the actual problem.
- The [explicit candidate plan](model-selection-plan.json) is consumed by `review-models.cjs`. Results are saved privately under `.local/insight-engine/model-selection/`. Original drafts, application settings and application support-review records remain unchanged during screening.

A candidate must first meet the scoped quality checks. Then observed completion time and estimated cost guide selection. A single run cannot establish stable latency, reliability or quality on unseen tasks; a promising candidate needs a repeat and separate evidence before a broad usefulness claim.

## First-round results

Run `62aa8e47-010e-471a-b23b-0100f13a0e51` preserved all four outcomes. A native launcher check initially found that Electron's `require.main` identifies its default app; that launcher attempt made no provider request. After the entry-point fix, Node and native `--check` passed before the four real requests below.

| Candidate | Observed seconds | Input / output tokens | Estimated USD | Result |
| --- | ---: | ---: | ---: | --- |
| GLM-5.3 Flash | 120.010 | Unavailable | Unknown | Client deadline reached; no answer or usage returned. |
| Qwen3.5-9B | 81.475 | 25,236 / 8,000 | $0.003724 | Output limit, zero answer characters; 5,616 reasoning tokens reported. |
| Qwen3.8 Flash | 55.204 | 25,262 / 7,307 | $0.005875 | Finish `stop`, 11,190 answer characters, but answer was not valid JSON. No parsed assessment retained. |
| GPT-5.6 Luna | 25.312 | 22,348 / 2,359 | $0.007300 | Completed JSON with 21 assessments; rejected for invalid source references. Missed all three primary overclaim gates. |

The three requests with usage data total an estimated **$0.016899** at uncached list rates. GLM Flash's charge is unknown, not zero. TokenRouter usage logs were not consulted for billed cost. Luna's 384 reported reasoning tokens and short runtime do not offset its all-supported verdicts: it detected 0/3 primary problems. The [independent rubric audit](MODEL-SELECTION-RUBRIC.md) records nine invalid citation occurrences and the semantic misses. No candidate passed; none was installed as a recommended reviewer or promoted into application results.

## Bounded follow-up

The [follow-up plan](model-selection-followup.json) keeps the same original draft, evidence, versions, 8,000-token cap and 120-second deadline. It adds [DeepSeek V4 Flash](https://www.tokenrouter.com/models/deepseek/deepseek-v4-flash/) at $0.44 input / $1.32 output per 1M tokens (Chat Completions, low reasoning, Prompted JSON) and [GPT-5.6 Terra](https://www.tokenrouter.com/models/openai/gpt-5.6-terra/) at $2 / $12 (Responses, medium reasoning, strict JSON schema). The different effort and output-format settings mean this compares practical configurations, not model identity alone. Neither request is an automatic retry of a prior failure.

The existing application response settings now also support an explicit **Off (if supported)** reasoning choice. It sends `none`, preserves the existing default, invalidates old consent when changed, and never silently retries an unsupported setting. This choice is not used in either follow-up candidate; lower reasoning is not presumed to improve judgment.

### Follow-up results

Run `6134152f-d4ec-402e-a578-6d938adf2b65` completed both requests with structurally valid, fully cited 21-unit results.

| Configuration | Seconds | Input / output tokens | Estimated USD | Primary detections | Supported control labels |
| --- | ---: | ---: | ---: | ---: | ---: |
| DeepSeek V4 Flash / low / Prompted JSON | 64.095 | 23,360 / 7,310 | $0.019928 | 0/3 | 6/6 |
| GPT-5.6 Terra / medium / JSON schema | 44.330 | 22,274 / 4,070 | $0.093388 | 1/3 | 6/6 |

DeepSeek flagged four summary/interpretation sections for lacking check-result citations, but missed all three targeted wording problems. Terra correctly distinguished the causal explanation in an agent report from the narrower failure shown in recorded logs; it missed the import assertion and conditional wording. Although Terra's aggregated result marks all three findings as needing review, this is **not** three successful detections of the target problems. The independent agent audit records the exact reasons in the rubric.

## Final quality probe and decision

The [final executed plan](model-selection-quality-check.json) used GPT-5.6 Sol / medium / Responses / JSON schema with the same 8,000-token and 120-second caps. Run `adb95bea-deba-4562-bedc-e6d7fa47e439` completed in **60.456 seconds**, with 22,274 input and 3,989 output tokens, including 2,046 reported reasoning tokens. At [TokenRouter's listed Sol rate](https://www.tokenrouter.com/models/openai/gpt-5.6-sol/) of $5 input / $30 output per 1M tokens, the uncached estimate is **$0.231040**. These router rates differ from upstream OpenAI pricing and were checked directly.

Sol produced a structurally valid result but detected only **1/3 primary gates**, again causal attribution. It agreed with **4/6 supported control labels**. The two disagreements involve plausible interpretations of excerpt scope, so they are reported as disagreements with the agent-authored rubric, not proven false positives or human-adjudicated errors.

`openai/gpt-6-astra` appeared in the authenticated available-model list, but its TokenRouter price could not be verified in the accessible public catalog. The planned Astra probe was held before execution; no Astra request was sent, and upstream prices were not substituted.

**Terra / medium / JSON schema is the most promising development configuration among those tested**, because it produced valid output, detected the causal overclaim, retained all six control labels, and used less time and estimated cost than Sol in these single observations. It still fails the predeclared gate. No model is approved as a reliable automated reviewer, and the application configuration and saved review state remain unchanged. Luna was the fastest completed provider response, but it failed citation validation and detected no primary problem. There is no qualified “fastest and cheapest” winner yet.

Seven paid requests were sent across three explicit batches. The six requests with returned usage total **$0.361255 in uncached list-price estimates**; the timed-out GLM Flash charge remains unknown. These are not reconciled billed charges. No candidate was retried automatically, and no follow-up calls ran after the Sol result.

The next engineering experiment should isolate individual factual claims with their exact supporting passages and validate quoted evidence, while keeping recorder facts and source-attributed reports explicit. That follow-up is now implemented and evaluated separately in [the claim-and-passage review report](PASSAGE-REVIEW-EVALUATION.md); the results below remain the frozen model-selection evaluation. The present results suggest that changing model alone did not resolve the missed import/conditional claims under this protocol. Human adjudication of ambiguous rubric labels, repeat runs and a held-out real task remain necessary before broader quality claims.

## Implementation and verification

- Added the explicit reasoning-off choice through the existing settings, typing and provider-control boundary; defaults and automatic-retry behavior are unchanged.
- Added the bounded `review-models.cjs` harness and explicit plans. It validates source-file, output, evidence, catalog and version hashes before requests; original provider answers and validated aggregates are stored separately. Native entry detection is verified in Electron, not inferred from Node execution.
- 132 desktop tests passed after the final production changes. Typecheck and production build passed. Focused tests cover `none` in both API formats, low-to-none consent/cache invalidation, persistence, and exactly one attempt when a provider rejects `none`.
- Offline harness checks cover all three JSON modes in both API formats, explicit `none`, plan bounds, endpoint/model mapping and invalid fields. Node/native `--check` validations passed; they make no generation request.
- Native visual QA selected **Off (if supported)** in the settings dropdown and closed without saving. The updated browser preview was reloaded. No provider request ran during UI QA.
- All 11 pre-existing private JSON files, including settings, encrypted credentials, drafts and support jobs, retain their original SHA-256 hashes and modification times after all seven calls and UI checks. Benchmark records live in a separate ignored directory.
- Credential-pattern scan of changed code/reports found no matches. Staged and unstaged diff checks passed. No commit or push was performed.
