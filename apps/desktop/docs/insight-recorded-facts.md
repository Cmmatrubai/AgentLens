# Recorded facts in the insight engine

`recorded-facts-v1` is a deterministic projection of saved comparison records. It is available before an AI request, in the collapsed Recorded facts panel, and in the analysis request. It contains no generated interpretation or overall task score.

## Contract

- Every fact has an ID, comparison input hash, attempt key, kind, reason and selected source IDs. IDs change when the frozen input changes, and remain stable across attempt ordering/fetch-time changes.
- Independent checks use the saved normalized pass/fail/unknown result. A declared check missing on either attempt becomes unknown, including a check missing on both. Missing output or artifact identity cannot establish pass/fail.
- Evidence availability is separate from outcome: a recorded unknown result may have selected or omitted output. A recorded pass/fail whose output was omitted by selection retains its recorded outcome and explicitly reports the omission. That outcome does not authorize assertions about unseen output.
- Grouped check outputs carry explicit check IDs. Several conditions may refer to one source without confusing identities or implying that several independent executions took place.
- Command exits describe selected output-bearing command records only. Exit zero is not converted into a check pass, overall task success or a model-quality score. Missing exits remain unavailable; agent reports do not become command facts.
- The panel exposes saved identities and selected evidence on demand, preserves attempt ownership and hides stale ledgers. It does not claim to authenticate the original recording process; imported provenance remains supplied by the author.

The analysis request receives the same ledger as the preview. Fact IDs are not source IDs; the model must cite the supplied source IDs. The local import policy remains a separate check. Adding a ledger does not establish that every free-form AI statement agrees with it, or satisfy the human-audit release gate.

## Import behavior

The saved-pair importer now retains the declared check plan. Previously it reconstructed the comparison check list only from recorded results, losing a planned check that neither attempt ran. The importer validates plan IDs/titles, merges planned and observed checks, counts absent union checks as unknown and leaves readiness false while a check is missing from either attempt. It does not create fictional output records, and repeated imports recompute counts without inflation.

## Versioning and historical evaluation

Production evidence is `balanced-evidence-v4`; the recorded-facts version participates in the input identity. Analysis instructions are `comparison-rubric-v4`. Prior analyses become stale under the changed evidence contract, with their files preserved. Reads do not regenerate them or call a provider.

The original six-case semantic evaluation still uses the frozen v3 evidence builder in `qa/insight-engine/protocol-snapshots/evidence-v3.mjs`, sourced from commit `75922c9` with adjusted schema import paths. Its original case hash assertion remains unchanged and passing. The snapshot is used only by historical QA, not production. New fact tests use the current builder.

## Verification

Portable coverage includes source/attempt ownership, missing plans/results/artifacts, grouped check sources, omitted output, unavailable exits, order stability, preview/request parity, stale UI data and imported plan persistence. Native QA uses temporary records with network access disabled and no analysis request; it opens evidence, checks unknown outcomes, verifies the 820px layout and reloads.

A real browser preview was also checked separately against the local read-only bridge. These checks validate this slice; they do not constitute human semantic evaluation or a clean-checkout release result.

### Final verification of this slice

207 desktop tests passed, desktop/public-demo builds passed, and the native fact-panel acceptance passed. The local browser bridge returned the real C01 fact ledger (26 facts, including 14 independent check entries) while leaving the prior analysis stale. The frozen C01 import-policy replay still withheld its unsupported relationship and preserved its original files. No paid provider request was made for this work.

Independent review identified and rechecked two corrected issues: availability being confused with outcome, and malformed optional availability metadata sharing an input identity while changing outcomes. The projector now preserves whether actual evaluator output exists instead of deriving availability from its display placeholder. Hashing and extraction share the same availability normalization; imports reject malformed availability flags. Legacy records without the flag still require output and an artifact identity before becoming check evidence.

Milestone 1 remains open for broader checking of generated claims against the ledger and human-audited evaluation.
