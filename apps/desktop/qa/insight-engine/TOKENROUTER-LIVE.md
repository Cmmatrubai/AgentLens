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

Final state: TokenRouter and z-ai/glm-5.3 remain selected in the desktop with the existing encrypted key. The app's 6,000-token allowance and 90-second timeout remain unchanged; higher allowance and low reasoning were diagnostic overrides only. Authentication and a small structured completion succeeded, but full C01 insight generation did not. A semantic quality score cannot be assigned without a completed output.

The [Z.ai Chat Completions reference](https://docs.z.ai/api-reference/llm/chat-completion), fetched September 7, documents GLM-5.3 reasoning as enabled with low/high/max effort levels and max as the default. These are upstream semantics, not independently verified TokenRouter routing behavior.

## Scope

Original recordings, Sol/Terra outcomes and canonical repository source were not changed. A held-out real task, attempt-order reversal, repeatability and semantic finding quality remain outside the completed checks above. No general provider speed, cost, model ranking or insight quality claim follows from this test.
