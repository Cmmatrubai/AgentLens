# Semantic relation evaluation

This suite checks whether the insight reviewer distinguishes a supported statement from a closely related overclaim. Citation validity is checked separately before semantic labels are scored. These are six synthetic development cases with provisional agent-authored labels, not human ground truth, held-out production examples or a general model ranking.

## Cases and expected labels

| Case | Target claim / contrast | Expected label |
| --- | --- | --- |
| case-01 | Both names imported; one actually defined locally | unsupported |
| case-02 | Same claim; both names actually imported | supported |
| case-03 | Copy without a type check; numeric guard present | unsupported |
| case-04 | Same claim; displayed function has no type guard | supported |
| case-05 | DNS outage presented as established cause; only agent report says it | needs_review |
| case-06 | Same evidence; claim explicitly attributes DNS explanation to agent | supported |

The import and condition pairs keep identical target text and change the evidence. The attribution pair keeps identical evidence and changes the claim's attribution. Each case is sent in its own request, without previous outputs, the paired counterpart, labels, rationales or case IDs. Names and snippets differ from C01. These examples were authored after studying C01 failure modes, so they are development coverage rather than held-out validation.

Each request uses a valid two-attempt synthetic comparison and the existing seven-unit finding contract. The target is `f0:summary`; six other units provide neutral context and are validated but not semantically scored. All recordings and code snippets are synthetic. No real comparison is changed.

The scorer distinguishes:

- **detected**: an expected overclaim receives `needs_review` or `unsupported`;
- **missed_overclaim**: an expected overclaim receives `supported`;
- **retained**: an expected supported claim stays supported;
- **false_flag**: an expected supported claim is flagged;
- **invalid / unavailable**: local validation failed or no complete output is available.

Exact three-label agreement is also reported separately. All six cases remain in the result set, including aborted and unusable requests. Detection alone does not establish that the cited reason is correct; inspect the actual claim, reason and passages as a separate audit.

## Run locally

From `apps/desktop`:

```sh
# No credentials, network, catalog file or paid requests needed.
node qa/insight-engine/review-semantics.cjs --check

# Explicitly performs six sequential paid requests, with no retries.
pnpm exec electron qa/insight-engine/review-semantics.cjs --run
```

`semantic-plan.json` selects one reviewer and compatibility configuration, capped at 3,000 output tokens and 120 seconds per case (currently 90 seconds). Live execution requires native Electron, the canonical encrypted endpoint credential and a private model catalog at `/tmp/agentlens-model-catalog.json` no more than one hour old. Plan validation checks the model's advertised route. Offline validation uses a synthetic catalog only to check the plan's shape; it makes no claim about live model availability.

A unique private run folder under `.local/insight-engine/semantic-evaluation/` retains source snapshots and hashes, all six inputs and provisional labels, the explicit plan, sanitized diagnostics, raw structured answers, scores and timestamps. Labels are stored locally for scoring and are never passed to the provider. API keys are never persisted in the run. Reads and offline checks cannot trigger generation. Results are evaluation artifacts and are not promoted into saved comparisons or used to alter provider settings.

The wrapper is pinned to support-v5 / evidence-support-v5 so later protocol changes cannot silently masquerade as a baseline rerun. Source snapshots capture the precise implementation. Interrupted runs preserve completed cases and mark remaining cases unrun; there is no resume that silently spends more.

## Baseline results

On September 14, 2026, the unchanged **support-v5 / evidence-support-v5** reviewer completed all six requests using **Terra / medium**, Responses, JSON schema, a 3,000-output-token cap and 90-second deadline per request.

- Private run: `a61e6701-bfab-4aaa-8000-1f9f4eb97cc4`.
- Frozen cases hash: `ecd4fd86360e5ef7ff2da02d13681caaa18c91964c1b67e2d29bc6745cb1af44`.
- Local output validation: **6/6 passed**.
- Overclaims detected: **3/3**; supported controls retained: **3/3**.
- Exact verdict agreement: **5/6**. Case-05 received `unsupported` instead of provisional `needs_review`.
- Per-request times: 10.364, 10.417, 8.778, 11.333, 9.642 and 10.287 seconds; total provider elapsed **60.821 seconds**.
- Usage: **14,133 input / 4,320 output tokens**. At the same-day verified [TokenRouter Terra rates](https://www.tokenrouter.com/models/openai/gpt-5.6-terra/) ($2 input / $12 output per million), estimated total cost is **$0.080106**, not billed cost. No retries were made.

### Explanation and passage audit

The coordinator inspected all six target assessments and their resolved passages after scoring. This is a separate local agent audit, not an independent human evaluation.

- **case-01:** identifies that QUEUE_LIMIT is local while warnOverflow is imported; cites the actual North module excerpt.
- **case-02:** identifies both names in North's import specifiers; cites the changed North excerpt.
- **case-03:** splits the assignment from the no-type-check clause, supports the assignment and rejects the latter using the numeric guard. Ordered original-text coverage is retained.
- **case-04:** cites the displayed complete assignment and source metadata. The absence claim is local to this displayed function; nothing is established about callers.
- **case-05:** cites the failed command and agent explanation, correctly distinguishing observation from causal attribution. The severity differs from the provisional label. The existing prompt allows `unsupported` for scope beyond evidence, which overlaps `needs_review` for incomplete support; do not present this label disagreement as a proven reasoning failure.
- **case-06:** cites the report and its provenance, accepting the statement as an attributed report without endorsing its cause.

These explanations support the six target decisions within the narrow fixture scope. Neutral non-target units were not given a semantic pass/fail score. No real comparison was edited or given a new review. Eleven existing private JSON files, including draft records, settings and the encrypted credential, retained their SHA-256 values and modification times.

### What this establishes, and what comes next

The reviewer handles these isolated examples while the prior [C01 catalog review](CATALOG-REVIEW-EVALUATION.md) still misses the joined import claim and accepts ambiguous “unconditional” wording. The cases differ in evidence size, wording, code completeness and claim complexity. Therefore this observation does **not** establish that context length alone caused the C01 misses, nor does it establish production precision or recall.

Keep this baseline frozen. The next investigation should control one variable at a time: identical target claims with added irrelevant passages, swapped attempt identities, and compound versus separated claims. If narrower review units improve detection without increasing false flags, evaluate that workflow on real saved comparisons before changing production review behavior. The verdict taxonomy also needs a clear distinction between contradicted claims and claims that simply lack enough evidence.

Verification: six offline evaluator tests passed, including leakage checks, scoring, invalid-output handling and cancellation. The full repository suite passed **1,519 core + 162 desktop tests (1,681 total)**; desktop typecheck/build and whitespace checks passed. No UI or production inference behavior changed in this evaluation pass.


The subsequent [evidence-volume experiment](SEMANTIC-CONTEXT-EVALUATION.md) preserved these exact six drafts and decisive sources while adding sixteen unrelated file excerpts per case. It retained all six target decisions, with higher input usage; the result does not explain the real C01 misses.


The [compound and attempt-attribution extensions](SEMANTIC-CHALLENGE-EVALUATION.md) add twelve bounded cases and target-span scoring. Both retained the expected detection/control decisions, but they do not resolve the original C01 misses.
