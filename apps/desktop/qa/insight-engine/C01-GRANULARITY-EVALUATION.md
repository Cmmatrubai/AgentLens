# Original C01 review granularity — September 14, 2026

Reviewing one exact original unit per request did not improve the known C01 semantic misses. The unchanged support-v5 reviewer detected one of the three frozen concerns, the same result as the earlier whole-review request. This is one repeatedly inspected development case, not a held-out benchmark or a production-quality estimate.

## Input and isolation

The harness reads the original completed draft `be0406bf-b8b8-40f5-89a1-c467757e33de` and evidence review `aa58e3de-caa7-445f-b459-d158f812dadd`. It verifies the original job-file hash, draft-output hash and evidence input hash before either offline or live execution.

Each provider request contains exactly one unchanged unit. It retains the full original task, coverage record and all 69 support-v5 passages derived from the 24 selected sources and saved attempt facts. No rubric label, expected verdict, scoring note or proposed correction is included. The production support-v5 provider builds the request; the QA adapter only narrows its `units` array and matching structured-output enum. The production validator checks the returned claim text, ordered full-unit coverage and passage IDs. Locally generated filler lets that validator exercise its unchanged full-draft contract; filler units are explicitly marked and are neither sent nor scored.

- Original job file SHA-256: `4640cd3da1680fddc723dc8856b86c77e620b0cab618dc781b46fc8035caf740`.
- Draft output SHA-256: `5ba6d09f32af9e6de48468407481af99d979740860db873cedcd0d59819867dc`.
- Evidence SHA-256: `4b7152c2391f7dd627e576581da6cc46af533d3ec7ee4aea702ea876cffc4d3c`.
- Task SHA-256: `cc2f9eedb4f84bd6b7688a4d97369a8b332537b50813e8e95e7d4ffb4b0a1294`.
- Coverage SHA-256: `b84f6a84a0575b62b28fb88f7e7a55b1c641fd9d6835a207d6aa842464ed6997`.
- Passage-catalog SHA-256: `1956b0b8fccf62fd793e0b84f49e559c9e9fff1948bbe820b234045540724ad5`.

## Bounded live result

Three sequential TokenRouter requests used `openai/gpt-5.6-terra`, Responses JSON schema, medium reasoning, at most 3,000 output tokens and a 90-second deadline. There were no retries. Private run `12f8d39a-cdef-4bfd-8dc5-f8695e58468f` is under `.local/insight-engine/c01-granularity-evaluation/`; raw outputs, diagnostics, usage, source snapshots and hashes remain private.

| Original unit | Result | Observation |
| --- | --- | --- |
| `f0:observation:1` | Missed; `supported` | The reviewer split the unit but still claimed the displayed `recordRun.ts` import contained both names. The cited passage actually imports `oversizedLineDiagnostic` and excludes `MAX_SOURCE_LINE_BYTES`. |
| `f1:title` | Not flagged; `supported` | The reviewer interpreted “unconditional” as “without a reason condition.” Numeric guards remain visible, so the frozen literal label is ambiguous and this is not a clean false-negative measurement. |
| `f2:summary` | Detected; `needs_review` | The reviewer separated recorded identity failures and agent reports from independently established IPC causality. |

Detection is **1/3** under the frozen concerns. Exact-label agreement is **1/3** using provisional expected labels (`unsupported`, `needs_review`, `needs_review`). All three outputs passed exact selected-unit coverage and production passage validation.

Total elapsed provider time was 19.114 seconds. Usage was 73,058 input tokens and 1,169 output tokens. At the September 14 Terra rates already used by the earlier evaluation ($2 input / $12 output per million tokens), estimated request cost is **$0.160144**. This is an estimate, not a bill. Narrowing reduced generated review text but retained the intentionally complete evidence context, so input usage stayed high.

Output SHA-256 values, in unit order:

- `f0:observation:1`: `222a0fa74e0292d4f919ce7e1d1a16fee5577e97e678e29fabe66bb110fcbe66`.
- `f1:title`: `11035800a6710e6df550c49a406688a386870be1a6e3329a99d03d9bff53d147`.
- `f2:summary`: `98d0158c351fe66ec5fd4425a9f992fb7ad40f7b5393342fd83ccd33a3cc3981`.

Snapshot SHA-256 is `1ff11025f2e4437ab07b740b67bc96c5ac971d161ed26811f41dc773d7ede5c1`. The run record SHA-256 after completion is `9815228cf39306fd3f181b838b884140f5dffaf4fc4bcfa43e669ab462030670`. The 11 original top-level private JSON files retained their hashes; the harness wrote only to its new private run subdirectory. The original draft and prior review were not promoted or modified.

## Diagnosis and limits

Whole-review overload is not supported as the cause of these misses: the same decisions persisted when only the problematic unit was requested. The import failure is more specific. A combined search-result passage places both definitions near a later import line, and the reviewer incorrectly turns that co-occurrence into a two-symbol import relationship despite the exact import syntax. This run does not distinguish whether passage layout, relation parsing or another model behavior dominates.

The title case remains unsuitable as a hard accuracy gate until a human resolves what “unconditional” is intended to mean. The causal case is the only unambiguous success here. This evidence does not support trusting automatic review, rewriting the original draft, changing the production protocol, or continuing synthetic expansion without a new hypothesis.

Offline contract check:

```sh
node qa/insight-engine/review-c01-granularity.cjs --check
```

The explicit native `--run` entry point makes the three paid requests only when the frozen originals, fresh catalog, encrypted credential and support-v5 version guards all pass.
