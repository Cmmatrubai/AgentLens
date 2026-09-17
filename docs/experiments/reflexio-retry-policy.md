# Testing Reflexio: retry-policy adherence without a score improvement

September 17, 2026 · One controlled pair · Recorded with AgentLens

**Both coding attempts passed the same five checks. The attempt receiving Reflexio guidance matched the taught retry policy more closely, but took longer.** This small experiment demonstrates a working extraction → retrieval → recorded execution workflow. It does not establish a causal effect or a general performance benefit.

| Observation | Control: no retrieved guidance | Treatment: Reflexio guidance |
| --- | --- | --- |
| Fixed evaluator | 5/5 | 5/5 |
| Public tests | 2/2 | 2/2 |
| Retryable GET responses in the implementation | `408/429/500/502/503/504` | `502/503/504` |
| Maximum GET attempts | 3 | 3 |
| Payment POST replayed in the failure test | No | No |
| Recorded agent duration | 81.114 seconds | 103.433 seconds |
| Completed commands | 7 | 8 |

The narrower retry set is a **code-inspection observation**, not an extra scored test added after the experiment. The broader control policy is not inherently wrong: the exact status-code convention was supplied only through the learned guidance.

## What we wanted to learn

Could a correction stored in Reflexio become relevant guidance for a fresh coding-agent run? Would the resulting implementation respect the correction's scope without blindly retrying payment requests?

AgentLens supplied the recording layer: run identities, provider events, commands, usage counters, and final Git evidence. A separate deterministic evaluator checked the resulting implementations. Neither an agent's completion message nor a successful recording counted as a passing test.

## Setup and controls

Two fresh `gpt-5.6-sol` sessions, both with high reasoning, started from independent copies of the same tiny Python HTTP-client fixture. The implementation used injected fake transports and sleep callbacks; no real HTTP requests or payments were made by the fixture.

The [starting code](reflexio-retry-policy/fixture/http_client.py), [public tests](reflexio-retry-policy/fixture/test_public.py), [base task](reflexio-retry-policy/prompts/control.txt), and [external evaluator](reflexio-retry-policy/evaluate.py) were frozen before execution. The order was fixed: control first, treatment second. The evaluator stayed outside both agents' writable workspaces. Each run used a fresh ephemeral session, ignored user configuration and project rules, and disabled the chronicle feature.

The base task disclosed the five evaluation categories to both conditions. It did **not** specify the exact retryable status codes or the numerical attempt cap. The three-attempt cap was therefore a seeded project-policy detail; both implementations happened to choose it. The two public tests covered ordinary successful GET and POST requests.

This is a synthetic teaching intervention, not a naturally observed agent failure. No repeat runs were selected or discarded to obtain a favorable result, and evaluation attempts were not published back into Reflexio during the comparison.

## The correction and the actual retrieved lesson

The [teaching conversation](reflexio-retry-policy/evidence/teaching-input.json) deliberately proposed indiscriminate retries, then corrected that proposal:

> Retry only safe GET requests when the response is 502, 503, or 504, and use at most 3 total attempts. Never automatically replay a payment POST unless an explicit idempotency contract is present; surface the first failure instead.

Reflexio completed extraction with status `done` / reason `covered`, producing one profile and one user playbook. The experiment used explicit extraction controls for the short teaching fixture instead of assuming publication meant learning was ready.

Retrieval returned those artifacts. Their actual text was placed in a delimited block before the otherwise identical task prompt, with a statement that it could not override system instructions, authorization, security policy, or tool permissions. The treatment was not supplied with the original teaching conversation.

- [Exact treatment prompt](reflexio-retry-policy/prompts/treatment.txt)
- [Learning IDs, injected text, prompt hashes, and AgentLens run mapping](reflexio-retry-policy/evidence/learning-to-run.json)

## What the evaluator established

The five cases checked normal GET success, recovery from a `503`, a persistent `503` capped at three requests, immediate failure on `400`, and no replay of a payment POST after a `503`. Both implementations produced request counts of `1, 2, 3, 1, 1` and passed all five.

Inspect the [control implementation](reflexio-retry-policy/control/http_client.py) and [treatment implementation](reflexio-retry-policy/treatment/http_client.py) to see the policy difference. Their backoff sequences also differed (`0.1/0.2` versus `1/2`), but backoff magnitude was not scored and test sleeps were injected.

The evaluator is intentionally preserved unchanged. It checks whether an error occurred in the expected failure cases, but does not enforce the exception class despite an overly narrow source comment. It also does not test every status code in either implementation. Passing these checks is not comprehensive HTTP-client validation.

## Inspect or reproduce without a model or API key

From the repository root, using Python 3.10 or newer (the original runtime was Python 3.12.14):

```sh
python3 -B docs/experiments/reflexio-retry-policy/evaluate.py docs/experiments/reflexio-retry-policy/control
python3 -B docs/experiments/reflexio-retry-policy/evaluate.py docs/experiments/reflexio-retry-policy/treatment
python3 -B -m unittest discover -s docs/experiments/reflexio-retry-policy/control -p test_public.py -v
python3 -B -m unittest discover -s docs/experiments/reflexio-retry-policy/treatment -p test_public.py -v
```

These commands **recheck the saved code**, not rerun extraction or coding agents. To perform a new live experiment, use fresh copies of the starting fixture, configure an isolated Reflexio service with your own provider, publish the synthetic teaching input, wait for completed extraction, retrieve for the task, and record fresh matched attempts. Record the newly returned learning IDs and text; do not pass off the published treatment prompt as a newly retrieved lesson. Model access and behavior may differ.

The relevant upstream entry points are Reflexio's [integration guide](https://github.com/ReflexioAI/reflexio/blob/6d2459b46e8e4bc871c559bf06463d56ee99f5af/AI_AGENT_INTEGRATION.md) and [integration skill](https://github.com/ReflexioAI/reflexio/blob/6d2459b46e8e4bc871c559bf06463d56ee99f5af/skills/integrate-reflexio/SKILL.md). The skill helps implement search/publish in an agent application; installing it alone does not give Codex persistent learning.

## Evidence and provenance

| Component | Recorded version or identity |
| --- | --- |
| Reflexio | `0.2.30`, revision `6d2459b46e8e4bc871c559bf06463d56ee99f5af` |
| Codex CLI | `0.154.0-alpha.6.2` |
| Coding model | `gpt-5.6-sol`, high reasoning |
| Python / linked SQLite | `3.12.14` / `3.53.1` |
| Embeddings | Local `minilm-l6-v2` |
| AgentLens base revision | `2a3aba3ccef3f81ab825673614333205d931de34`, with pending desktop work present; not a clean release checkout |
| Original disposable fixture revision | `1f172ab2514894997b86afa06ae58100f4e909af` (local identity, not a commit in this public repo) |
| Control AgentLens run | `7328c8d0-53ac-40c0-9ca6-c67617c7e1b7` |
| Treatment AgentLens run | `3cf7862d-23a8-43ad-81ac-bc24e284ba20` |

AgentLens retained 40 events for control and 42 for treatment. The public bundle contains [curated results](reflexio-retry-policy/evidence/results.json), the learning/run mapping, prompts, and exact source snapshots. Full native logs, the local database, credential-loading scripts, and machine-specific settings are not published. The run IDs correlate local records; they are not public trace URLs. The [SHA-256 manifest](reflexio-retry-policy/evidence/sha256.json) lets readers check the exported files' integrity, but is not an independent attestation.

### Unresolved extraction-model discrepancy

Reflexio configuration and extractor-level logs named `openai/z-ai/glm-5.3-flash`. Lower-level LiteLLM request and usage logs instead labeled four calls `gpt-5.5`. No fallback event was logged. Neither the outbound request model field nor the provider response model field was captured, so **the serving model and the cause of the mismatch remain unresolved**.

Those four calls logged 16,985 input tokens, 963 output tokens, and a $0.113815 client-side cost estimate. That estimate is not a billing receipt and does not include the coding runs. The mismatch limits exact reproduction and cost attribution; it is not evidence of a confirmed Reflexio or TokenRouter defect. A follow-up should capture sanitized request/response model metadata before additional runs.

## What this result does and does not support

Real extraction and retrieval produced relevant guidance, which reached a recorded coding run. Its implementation matched the seeded policy more narrowly, while measured correctness tied and elapsed time was higher.

There was only one run per condition, a fixed execution order, and no replication. This cannot distinguish the effect of retrieved guidance from ordinary model variation, establish a speed difference, or support a general performance claim. The original success criteria already told both agents to avoid duplicate payments. A stronger transfer test would use a separate held-out task and matched repeated trials. Lesson revocation, cross-user aggregation, long-term behavior, and production integration were not tested.

The useful follow-up question is whether exact adherence to a user's stored policy is itself the intended benefit here, and how reliably that adherence transfers to related tasks without expanding beyond the policy's scope.
