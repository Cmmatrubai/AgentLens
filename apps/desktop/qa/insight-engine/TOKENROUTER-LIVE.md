# TokenRouter live verification

Date: September 7, 2026. The user supplied this endpoint and credential explicitly for testing. No credential is included in this report.

## Connection and protocol

- Endpoint: https://api.tokenrouter.com/v1.
- Authenticated GET /models returned HTTP 200 and listed one model: z-ai/glm-5.3-free.
- A small non-streaming Chat Completions request with strict JSON schema returned HTTP 200 in 19.56 seconds, finish_reason stop, and valid JSON containing status ok.
- Provider-reported usage for that small request: 23 prompt tokens, 60 completion tokens, 83 total; 53 reasoning tokens reported within completion details.
- This demonstrates authentication and one structured-output completion. It does not prove enforcement of every JSON schema constraint.

## Desktop C01 request

- Configured the actual Electron settings with this endpoint, its listed model, bearer authentication, Chat Completions and JSON schema mode.
- Saved credential file permissions were 0600. The desktop credential store uses OS-backed encryption. The key was entered through the protected desktop field and is excluded from comparison artifacts and this report.
- Reviewed and sent the existing bounded C01 evidence: 24 excerpts, 38,737 characters, 40 omitted candidates. No authored example findings were included.
- Input hash: 798eb07284607e207f07baa3cbced134a0d622d292279b112ee7d72adcf74aba.
- Desktop job: ba19c437-5e77-4528-a6b4-e1e1e2adc880.
- Outcome: analysis_timeout after 90.012 seconds. No analysis was published.
- Native UI correctly displayed “Analysis did not complete” and the time-limit explanation, with an explicit Retry action.

## Longer diagnostic

A separate bounded diagnostic uses the same saved evidence, model, API format and output format with a 240-second limit. It calls the production adapter and output/source validator. Its record is kept in .local/insight-engine/tokenrouter-diagnostic.json, separate from desktop jobs; it does not relabel the failed desktop request.

The diagnostic was interrupted without a result when the user enabled the non-free model and requested using it. No finding was published from that diagnostic; it is not counted as another observed timeout. Its local process was confirmed stopped.

## Non-free model test

After the user enabled z-ai/glm-5.3, authenticated model discovery returned both z-ai/glm-5.3-free and z-ai/glm-5.3. The desktop model setting was changed to z-ai/glm-5.3, retaining the endpoint and encrypted credential. A fresh evidence review started job b826d851-4b42-4f00-87a8-6146ac1fdbfb with the same input hash, Chat Completions and JSON schema settings.

The desktop request returned provider_incomplete after 70.712 seconds and published no analysis.

A diagnostic with the same evidence, 6,000-token budget and reasoning_effort low returned finish_reason length after 68.446 seconds. Provider metadata reported 6,000 completion tokens, including 5,999 reasoning tokens, and zero final-content characters. This establishes token-budget exhaustion for that diagnostic. It does not establish whether TokenRouter honored or remapped reasoning_effort.

The next bounded diagnostic increases max_tokens to 12,000 and allows 210 seconds, retaining low reasoning and the same evidence. Its result is stored separately in .local/insight-engine/tokenrouter-diagnostic-12000.json.

That request returned finish_reason length after 127.058 seconds: 12,000 completion tokens, including 11,999 reasoning tokens, and zero final-content characters. No findings passed validation or were published. Testing stopped after this result; no larger-budget requests were sent.

State after the initial diagnostics: TokenRouter and z-ai/glm-5.3 remain selected in the desktop with the existing encrypted key. The app's 6,000-token allowance and 90-second timeout remain unchanged; higher allowance and low reasoning were diagnostic overrides only. Authentication and a small structured completion succeeded, but full C01 insight generation did not. A semantic quality score cannot be assigned without a completed output.

The [Z.ai Chat Completions reference](https://docs.z.ai/api-reference/llm/chat-completion), fetched September 7, documents GLM-5.3 reasoning as enabled with low/high/max effort levels and max as the default. These are upstream semantics, not independently verified TokenRouter routing behavior.

## Scope

Original recordings, Sol/Terra outcomes and canonical repository source were not changed. A held-out real task, attempt-order reversal, repeatability and semantic finding quality remain outside the completed checks above. No general provider speed, cost, model ranking or insight quality claim follows from this test.

## Completion-controls follow-up

After migration to the canonical repository, the user requested continued development. Two further explicit requests used the same previously reviewed C01 evidence and input hash; no new source excerpts or authored findings were added.

1. JSON object / low reasoning / 6,000 output tokens / 90 seconds: incomplete after 65.726 seconds. Provider reported 19,580 input tokens and 6,000 output tokens, including 5,994 reasoning tokens; no answer text. Changing JSON mode alone did not establish a solution. This remains a separate diagnostic record.
2. Production insight service, Prompted JSON / low reasoning / 24,000 output tokens / 300 seconds: job `51dcb157-6150-41ad-a625-7130075ed530` completed in **206.406 seconds** (the polling harness observed it at 206.76 seconds). Provider reported 19,580 input tokens, 21,710 output tokens, 41,290 total tokens and 19,874 reasoning tokens. The answer contained 8,369 characters and three findings. `finish_reason` was `stop`; output shape and all source associations passed the existing validator.

The second request used the production settings, consent identity, credential boundary, provider adapter, validation and job persistence. The test orchestrator reviewed the existing evidence hash and initiated one request under the user's prior test authorization. The original failed requests remain unchanged in local history. Credentials and raw provider reasoning were never printed or saved in this report.

These requests changed multiple controls; they do not isolate whether allowance, JSON mode or their combination enabled completion. GLM-5.3 always uses reasoning according to [Z.ai's current model documentation](https://docs.z.ai/guides/llm/glm-5.3), but this does not independently prove how TokenRouter routes or applies effort settings.

One agent reviewer assessed the completed output against its cited excerpts, without consulting authored C01 findings. All 15 citation references resolved correctly. One finding was supported and two were partly supported; all three underlying differences were useful. The original generated result is retained unchanged. See [review qualifications](COMPLETION-CONTROLS.md). This is not a held-out, repeated or attempt-order-reversed quality evaluation.

## Concise-findings follow-up

One further production-service request used the same C01 evidence and response controls with `comparison-rubric-v3`. It completed in 182.061 seconds and saved three shorter findings. All 12 citation associations and the new text bounds passed; claim-level review still found overstatements in all three. The [full follow-up report](CONCISE-FINDINGS.md) preserves timings, usage, source references, review qualifications and original-record integrity. This is a brevity improvement on one case, not a semantic-quality or general speed claim.

## Evidence-support review follow-up

Two separately requested support reviews used the unchanged v3 draft and selected C01 evidence. The first completed but incorrectly approved all three known problematic findings. A revised protocol required a separate assessment for every text section; its request reached the 24,000-token output limit with zero answer characters after 248.648 seconds. It failed without promoting findings or modifying the draft. No automatic retries or further live calls followed. See [the support-review evaluation](SUPPORT-REVIEW.md) for versions, usage, failure evidence and offline acceptance.

## Model-selection follow-up

After the user removed the model restriction and authorized further testing, seven separate candidate requests used the same original draft and evidence. Three configurations completed with structurally valid reviews, but none passed the frozen semantic gate. Terra/medium is the most promising configuration to develop further: 44.330 seconds and an uncached list-price estimate of $0.093388, with one of three target overclaims detected and six of six control labels retained. No benchmark result was promoted into the application. The [model-selection report](MODEL-SELECTION.md) retains all failures, actual usage, price sources, plans and scoring limitations.
