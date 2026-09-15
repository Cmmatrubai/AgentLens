# Evidence-volume evaluation — September 14, 2026

This development experiment measures one perturbation of the frozen `semantic-relations-v1` cases: add unrelated selected file excerpts while keeping each draft, relevant source, source citation ID, task and attempt facts identical. It uses the unchanged support-v5 / evidence-support-v5 reviewer. It does not claim to reproduce the complexity of a full real comparison.

## Design and controls

`semantic-context-v1` adds sixteen synthetic file diffs, eight per attempt, containing warehouse rows unrelated to imports, numeric guards or DNS explanations. The ordinary evidence builder selects these excerpts; the original sources are then kept at the beginning of the catalog so original S1/S2/S3 citation IDs remain stable. All added material is synthetic. The production evidence-selection algorithm and inference prompt are unchanged.

Each case retains the same seven-unit finding and provisional expected label as the small-case suite. The provider never receives labels, rationales, run case IDs, baseline outputs or paired counterparts. Test code checks that every original source and task/attempt fact is identical and every original source passage retains its ID and exact quote. All extra sources fit the selection and character limits without truncating or omitting decisive evidence.

| Case | Original excerpt characters | Expanded excerpt characters | Expanded sources | Catalog passages |
| --- | ---: | ---: | ---: | ---: |
| case-01 | 267 | 46,651 | 18 | 55 |
| case-02 | 256 | 46,640 | 18 | 55 |
| case-03 | 251 | 46,635 | 18 | 55 |
| case-04 | 199 | 46,583 | 18 | 55 |
| case-05 | 203 | 46,587 | 19 | 57 |
| case-06 | 203 | 46,587 | 19 | 57 |

Frozen expanded cases hash: `b4dbf6ef336968003e91043c11e9737f1441449545b53e41d26582bcc322dff5`. The baseline remains exactly `ecd4fd86360e5ef7ff2da02d13681caaa18c91964c1b67e2d29bc6745cb1af44`; no previous inputs or results were rewritten.

## Reproduction

From `apps/desktop`:

```sh
# Offline contract and input checks; no credentials or network.
node qa/insight-engine/review-semantic-context.cjs --check

# Six sequential paid requests, no retries or automatic promotion.
pnpm exec electron qa/insight-engine/review-semantic-context.cjs --run
```

The explicit wrapper uses the same `semantic-plan.json` as the baseline: one Terra/medium reviewer, Responses, JSON schema, maximum 3,000 output tokens and 90 seconds per case. The shared runner preserves partial progress and counts failed/invalid/unrun cases. Live model-catalog validation, native encrypted credentials and private persistence follow the [baseline harness](SEMANTIC-EVALUATION.md). Baseline and expanded runs have separate private directories. The current wrapper is pinned to the v5 protocol.

## Observed results

Private run ID: `ff514a7e-ef06-4706-9a14-64a83f4c5abf`. All six requests completed and passed local structural/citation validation.

| Measure | Earlier small-case baseline | Expanded evidence |
| --- | ---: | ---: |
| Overclaims detected | 3/3 | 3/3 |
| Supported controls retained | 3/3 | 3/3 |
| Exact three-label agreement | 5/6 | 6/6 |
| Input tokens, total | 14,133 | 149,331 |
| Output tokens, total | 4,320 | 5,043 |
| Total provider elapsed | 60.821 s | 70.753 s |

Expanded-case elapsed times were 11.075, 8.738, 17.833, 11.604, 12.107 and 9.396 seconds. These are single observations, not latency percentiles. The expanded run used about 10.6 times the input tokens. At the same-day verified [TokenRouter Terra rates](https://www.tokenrouter.com/models/openai/gpt-5.6-terra/) of $2 input / $12 output per million, its estimated total cost is **$0.359178**. This is not billed cost; the previous small baseline's $0.080106 is separate. No retries were made.

The coordinator inspected all six target explanations and their resolved passages. Every target cited the original decisive excerpts, not the unrelated warehouse files. The import overclaim was rejected because QUEUE_LIMIT is locally declared; the type-guard overclaim was split and its no-type-check clause rejected. The unqualified DNS explanation was marked needs_review, while the explicitly attributed report remained supported. The positive import and no-guard cases retained supported verdicts. This is a local agent audit of these target claims, not independent human evaluation or a score for all other units.

The DNS verdict's change from unsupported to needs_review matches the provisional label but does not establish that additional unrelated context improved calibration. Single-run variability and the prompt's overlapping verdict definitions remain possible explanations.

## Engineering outcome

The repository now has a reproducible large-input variant and regression checks that preserve the baseline inputs, keep decisive evidence and citation IDs stable, and verify request bounds and label isolation. Both offline entry points still work. Production prompts, source selection, review settings, saved comparisons and UI were not changed by this experiment.

Verification: eight focused semantic tests passed; the full suite passed **1,519 core + 164 desktop tests (1,683 total)**. Desktop typecheck/build and whitespace checks passed. Eleven pre-existing top-level private JSON files retained their SHA-256 values and modification times.

The result does not justify splitting production reviews merely because the evidence is lengthy: this run found no target-decision loss from this particular addition of irrelevant material. The next discriminating experiments should vary compound wording and attempt attribution while keeping relevant evidence fixed, followed by the original C01 claim as a real-case check. C01's known misses remain unresolved.

## Interpretation limits

The added files are irrelevant by vocabulary and are appended after the decisive excerpts. This does not test semantically similar distractors, wrong-attempt evidence, relevant evidence buried in the middle, ambiguous prose or compound claims. The comparison uses one request per condition and the earlier same-day small-case baseline, with no fixed sampling seed or repetition. Runtime differences cannot be attributed solely to input size. Exact-label agreement uses provisional agent-authored labels; it is not human ground truth.

A positive result here means only that this perturbation did not expose a target-decision failure in this observation. It cannot establish that context size is harmless in production or explain C01's errors by itself.
