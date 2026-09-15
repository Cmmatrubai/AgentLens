# Fixed-passage review evaluation — 2026-09-14

The v5 reviewer completed with valid citations, but remains insufficient for trusted automatic judgments. This is one development observation on a repeatedly inspected case, not a held-out benchmark or a general model ranking.

## Change and evidence boundary

`support-v5` / `evidence-support-v5` asks the reviewer to choose existing passage IDs. AgentLens partitions only the consent-selected source excerpts (up to 24 lines / 2,400 characters per passage), exact source metadata, saved attempt facts and task requirements (up to 6,000 characters per passage). It preserves original characters and resolves IDs locally; it does not accept provider-authored quotes, coordinates, unknown IDs, repeated IDs within a claim or empty passages. Structured-output mode enumerates actual passage and unit IDs. Other compatible output modes use the same local validator.

Task requirements are separately labeled in the consent preview and claim inspector. They establish what was requested, not what an attempt implemented. Source text, metadata and attempt facts retain their existing distinctions. Generic prompt guidance also checks named-entity relationships, conditions and reported versus established causes. No rubric labels, gate IDs or case-specific answer examples were sent.

Complete ordered original-text coverage remains required. Exact citations do not prove relevance, atomization or entailment. Fixed passages may include unrelated neighboring text and long excerpts may require multiple selections. These remain reviewer-quality limitations.

The private run contains a source snapshot and hashes for its precise schema and provider prompt. The pre-change v4 sources are preserved separately in `protocol-snapshots/support-v4.json`; no historical output was repaired or revalidated under a silently changed contract.

## Frozen input and bounded request

- Draft: `be0406bf-b8b8-40f5-89a1-c467757e33de`, `comparison-rubric-v3` / `insights-v1`.
- Draft file SHA-256: `4640cd3da1680fddc723dc8856b86c77e620b0cab618dc781b46fc8035caf740`.
- Raw draft output SHA-256: `5ba6d09f32af9e6de48468407481af99d979740860db873cedcd0d59819867dc`.
- Evidence hash: `798eb07284607e207f07baa3cbced134a0d622d292279b112ee7d72adcf74aba`.
- Original evidence source: `support-aa58e3de-caa7-445f-b459-d158f812dadd.json`; 24 selected sources, 38,737 excerpt characters, 40 omitted candidates.
- A fresh authenticated model-catalog read returned 137 models and confirmed `openai/gpt-5.6-terra` supports the Responses route. Catalog discovery did not send comparison evidence.
- One generation request: TokenRouter, Terra, Responses, JSON schema, medium reasoning, 8,000 output-token cap, 120-second deadline. No retry or settings change.
- Private run ID: `2bc70310-9fd4-4339-8c0b-01db84036ba2`; files under `.local/insight-engine/model-selection/<run-id>/`. This directory is ignored, with private files and no credentials in records.

## Observed result

| Check | Observation |
| --- | --- |
| Provider / local validator | Completed / passed |
| Elapsed | 38.249 seconds |
| Output coverage | 21 units, 52 proposed claims |
| Passage catalog / selections | 69 passages / 100 valid selections |
| Input / output usage | 26,332 / 4,095 tokens |
| Reported reasoning tokens | 442, already part of output usage |
| Answer size | 15,818 characters |
| Finding verdicts | 2 supported, 1 needs review |
| Promotion into saved comparison | None; evaluation-only record |

Estimated request cost is **$0.101804**, using the September 14 [TokenRouter Terra rates](https://www.tokenrouter.com/models/openai/gpt-5.6-terra/) of $2 input / $12 output per million tokens. This is an estimate, not a bill. The three September 7 passage trials plus this request total $0.498154 estimated; the separate model-selection sweep is excluded.

## Semantic audit against the frozen rubric

The coordinator read every returned claim and checked the three gates against the exact catalog text. This is a local agent audit, not independent human ground truth. The rubric was not revised after seeing this result.

| Gate | Outcome | Evidence and limitation |
| --- | --- | --- |
| `f0:observation:1`, import relationship | Missed | `S13:t1` lists both symbols but the actual `recordRun.ts` import includes only `oversizedLineDiagnostic`, not `MAX_SOURCE_LINE_BYTES`. The reviewer accepts the joined claim with a reason discussing only the imported function. |
| `f1:title`, “unconditional” | Missed under frozen literal rubric | `S19:t1` has numeric guards, while `S20:t1` adds the reason guard. The reviewer calls Sol's copies “unconditional numeric checks.” The title is ambiguous if “unconditional” means only independent of reason; this is not an unambiguous false-negative measurement. |
| `f2:summary`, causal attribution | Detected | The reviewer distinguishes recorded identity errors and exit 1 from the agents' reported sandbox/IPC explanation. It marks causality needs review and cites both logs/metadata and reports. |

Detection remains **1/3** under the frozen rubric. The six control units (`f0:title`, `f0:observation:0`, `f1:observation:1`, `f1:limitations`, `f2:title`, `f2:limitations`) remain supported, so label agreement is **6/6**; the prior rubric's scope caveats still apply. This tiny case does not estimate precision or recall.

Unlike the previous review, `f0:interpretation` correctly cites the compatibility requirement and `f2:interpretation` correctly cites the request for exact validation results, both through `T1:t1`. It also accepts explicitly attributed agent reports as report content without promoting their explanation to independent causality.

Valid citation completion improved on the v4 range failure. The clearest semantic error—the joined import claim—remains. The result does not meet the quality threshold for a recommendation to trust the reviewer. Next evaluation should focus on relation-level checks with unseen import, guard and attribution examples, with a human-reviewed rubric, before another broad model search or automatic rewriting.

## Verification and reproduction

- Focused support tests: 48 passed, including exact catalog reconstruction, invalid/legacy selection rejection, task attribution, consent and persistence.
- Repository suite: 1,519 core tests plus 156 desktop tests passed (1,675 total).
- Desktop typecheck and production build passed; whitespace diff check passed.
- Native offline visual QA: task requirements displayed in a collapsed claim passage without an attempt label or source-excerpt link; consent displayed exact task JSON and the requested-versus-implemented distinction. Provider network was disabled and all fixture state was temporary.
- Original top-level private JSON records, including drafts, settings and credentials, were checked by SHA-256 and modification time after the run. The benchmark did not modify them.

Offline contract check (no provider call):

```sh
node qa/insight-engine/review-passages-v5.cjs --plan qa/insight-engine/passage-review-plan.json --check
```

Native execution of that explicit entry point without `--check` makes the paid request in the plan. It requires the canonical encrypted credential, a fresh private catalog and frozen original input; it does not retry or promote results. Historical v3/v4 wrappers refuse the v5 production modules.
