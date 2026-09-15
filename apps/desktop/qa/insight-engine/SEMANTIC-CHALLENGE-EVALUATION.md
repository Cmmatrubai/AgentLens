# Compound claims and attempt attribution — September 14, 2026

Two bounded development suites extend the frozen small-case baseline. The unchanged support-v5 / evidence-support-v5 reviewer detected all six target overclaims and retained all six supported controls across twelve requests. This does not resolve the known real C01 misses or establish production accuracy.

## Compound paragraphs

`semantic-compound-v1` preserves the exact evidence, task and attempt facts from all six baseline cases. It places the unchanged target sentence between two supported context sentences. The evaluator alone retains `targetText`; it is not sent as a label or special hint to the provider.

The scorer uses the validated claim spans to assess the target interval. A flagged neighboring sentence cannot count as target detection. If a flagged claim mixes the target with outside text, the score is `requires_audit`, not an automatic success. Missing or invalid outputs remain in the denominator. This score distinguishes a supported paragraph shell from a rejected target claim, but it does not replace semantic auditing of reasons.

- Frozen cases hash: `5f38369d723bd29f208eb1da9233b5adb694c9a4250ec352d40f75dc11103ff9`.
- Private run: `2b84be16-aa6f-4b15-bad1-8e33d8a1a502` under `.local/insight-engine/semantic-compound-evaluation/`.
- Completed and locally valid: 6/6. Detected: 3/3. Controls retained: 3/3. Exact verdict labels: 5/6. Mixed-scope flags: none in this run.
- Total provider elapsed: 70.978 seconds. Input/output tokens: 14,241 / 5,323.

All six summaries were split into their three component sentences. The target import error and numeric-guard error were identified using the correct North source. The causal assertion was rejected because its only causal basis was the agent's report; its `unsupported` label differed from provisional `needs_review`, as in the baseline. The explicitly attributed report remained supported. Context sentences were not substituted for the target decision.

This is a sentence-level compound test, not a test of deeply nested clauses, pronoun ambiguity, intertwined multi-symbol relations or three full findings.

## Similar evidence from the other attempt

`semantic-ownership-v1` puts the opposite import/type-guard implementation on South while keeping the original claim about North. Its last pair contrasts reports: one report attributes failure to DNS and the other explicitly says the cause is unknown. The claim in both cases concerns North's report. Provisional expected labels are recorded separately.

- Frozen cases hash: `671fd669edefc4dd9055b407b08d220a3365017013be71dac6524009e0ddc55f`.
- Private run: `e41f13b6-f136-4347-9241-0a81d60f3afa` under `.local/insight-engine/semantic-ownership-evaluation/`.
- Completed and locally valid: 6/6. Detected: 3/3. Controls retained: 3/3. Exact verdict labels: 6/6.
- Total provider elapsed: 56.327 seconds. Input/output tokens: 14,932 / 4,065.

All six target assessments cite North's decisive excerpt/report. The four implementation decisions identify the actual North import/guard instead of borrowing the opposite South implementation. The report decisions distinguish North's unknown-cause report from the DNS attribution and preserve “reported” versus independently established causality.

This is not a randomized identity-swap benchmark. Targets stay North, relevant catalog ordering is stable, excerpts are short, and labels were authored after inspecting C01's failure modes.

## Execution and evidence

Both suites used the same Terra/medium Responses + JSON schema plan: maximum 3,000 output tokens and 90 seconds per request, one request per case, no retries. The coordinator audited all twelve target reasons against their resolved passages. This is local agent review, not independent human ground truth. Untargeted finding fields are structurally validated but are not included in the target accuracy counts.

Using the same-day verified [TokenRouter Terra rates](https://www.tokenrouter.com/models/openai/gpt-5.6-terra/) of $2 input / $12 output per million tokens, estimated costs are $0.092358 for compound and $0.078644 for ownership: **$0.171002 combined**, not billed cost. Run snapshots retain exact inputs, outputs, protocol sources, hashes, labels and sanitized diagnostics without credentials. Results were not promoted into the real comparison.

```sh
# Offline; no credentials or network needed.
node qa/insight-engine/review-semantic-compound.cjs --check
node qa/insight-engine/review-semantic-ownership.cjs --check

# Each explicit native --run makes six paid requests.
pnpm exec electron qa/insight-engine/review-semantic-compound.cjs --run
pnpm exec electron qa/insight-engine/review-semantic-ownership.cjs --run
```

Verification: 11 focused semantic tests passed. The full suite passed **1,519 core + 167 desktop tests (1,686 total)**; desktop typecheck/build and whitespace checks passed. Eleven existing top-level private JSON files retained their hashes and modification times. Production prompts and review behavior did not change.

## Next decision

These simple perturbations do not reproduce the C01 failure. Avoid expanding synthetic variants indefinitely or claiming a root cause from passing fixtures. The next reviewer investigation should preserve the exact problematic C01 text/evidence and compare review granularity, with an explicit per-claim audit and the historical whole-review baseline. Keep the known failures visible. The user-selected public-demo release can proceed independently using reviewed, clearly authored case notes over a public-safe snapshot; it must not endorse the unresolved AI draft.
