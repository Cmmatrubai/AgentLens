# Evidence-support review

September 7, 2026. Local development on `codex/insight-completion`.

## Product boundary

A support review is a separate, explicitly requested provider call on an existing saved analysis. It uses the configured OpenAI-compatible endpoint, model and response limits. The review dialog shows the draft, selected evidence, destination and request allowance. Saving settings or reading a result never starts a review. Browser previews can read saved reviews; generation requires Electron.

Review records are stored separately from draft jobs. The review identity binds the draft ID and raw-output hash, evidence hash, settings snapshot, review schema and prompt version. Changed inputs invalidate consent and cached review results. Late results are marked stale; failed requests do not resume or retry automatically. Original draft and recording files are not rewritten.

Only findings with a complete current AI support assessment are eligible for the main cards. Flagged findings remain in “Needs review,” with original text, reviewer concerns and source excerpts. Unreviewed, interrupted, failed and stale results retain accessible drafts. The UI identifies the reviewer as AI and does not certify code correctness.

## First live review: a failed quality check

The first protocol requested one overall verdict for each finding, with issue quotations and citations for flagged claims. It passed structural, source-association, consent and persistence tests.

One paid TokenRouter `z-ai/glm-5.3` request reviewed the original unedited v3 C01 draft `be0406bf-b8b8-40f5-89a1-c467757e33de`. It used the same selected 24-source bundle and input hash `798eb07284607e207f07baa3cbced134a0d622d292279b112ee7d72adcf74aba`, plus the draft. No authored comparison notes or previous review qualifications were sent.

- Review ID: `f79f4225-b9f3-4916-8bea-abcef8b5dd1d`.
- Versions: `support-v1` / `evidence-support-v1`.
- Controls: Chat Completions, Prompted JSON, low reasoning, 24,000 output tokens, 300-second deadline.
- Persisted elapsed: 207.752 seconds; harness observed 208.294 seconds.
- Provider-reported usage: 21,162 input, 19,522 output, 40,684 total; 19,194 reasoning tokens.
- Answer: 1,547 characters, finish reason `stop`.
- Result: all three findings marked supported, zero issues.

This is a failed quality check against the known claim-scope/provenance qualifications in [the draft review](CONCISE-FINDINGS.md). The reviewer repeatedly accepted the core contrast and later caveats without flagging stronger claims elsewhere. The result is preserved unchanged as a failed evaluation example; it is not evidence that the findings are reliable.

## Revised review contract

The next protocol separates each finding's category, headline, summary, interpretation, limitations and two observations into seven identified text sections. The provider must assess every section exactly once, with a reason and citations. It cannot use caveats in another section to approve a broad claim. The server derives the overall finding verdict: every section must be supported before that finding can appear in the main cards. Issue quotations are copied from the original section by the server, not invented by the reviewer.

The schema/prompt version change invalidates the v1 review's cache identity. This is still AI judgment, not a deterministic semantic proof.

## Revised live review: incomplete, no verdicts published

One further paid request used the same original draft and selected evidence, without authored qualifications or additional sources. Its payload was exactly selected evidence plus 21 identified original-text units. The endpoint, model and response controls stayed unchanged.

- Review ID: `aa58e3de-caa7-445f-b459-d158f812dadd`.
- Versions: `support-v2` / `evidence-support-v2`.
- Persisted elapsed: 248.648 seconds; harness observed 249.033 seconds.
- Provider-reported usage: 22,960 input, 24,000 output, 46,960 total; 23,998 reasoning tokens.
- Answer: zero characters; finish reason `length`; saved error `provider_incomplete`.
- Result: failed, no review verdicts and no promoted findings. No further live requests followed.

The stricter protocol has not yet produced a completed live result. This does not demonstrate better semantic judgment or usable latency. The original v1 false approval remains an evaluation failure; the v2 output-limit failure is separate. Completing an accurate review within a practical response budget remains the next quality gate, before held-out-task, repeated and attempt-order-reversed evaluation.

## Preservation and acceptance

Both original analysis records remained byte-for-byte unchanged after both reviews:

| Draft | SHA-256 |
| --- | --- |
| `be0406bf-b8b8-40f5-89a1-c467757e33de` | `4640cd3da1680fddc723dc8856b86c77e620b0cab618dc781b46fc8035caf740` |
| `51dcb157-6150-41ad-a625-7130075ed530` | `50548df32b3280e5f9dd3ddacde31dcfcd95f755f8d4bce91d1de718c4881a3c` |

Native Electron acceptance used a separate temporary comparison and blocked all provider networking. The original draft stayed collapsed until opened. The support-review dialog disclosed the draft, excerpts, endpoint and additional request; submission remained disabled until the checkbox was selected. A synthetic flagged result stayed out of main cards, exposed its original claim and reviewer concern, opened paired evidence, and survived reload without a new request. This validates the interaction, not live AI quality.

Automated checks cover complete section coverage and valid citations, all seven fields including legacy long text, worst-verdict aggregation, supported-only card promotion, all six API/JSON combinations, explicit consent, UUID deduplication, cache and late-result invalidation, browser mutation rejection, private record preservation and no automatic retry.

- Root suite: 1,519 tests passed across 72 files after the v2 integration.
- Final desktop suite: 131 tests passed after adding sanitized failure diagnostics and the explanatory failure message.
- Final desktop typecheck and production build passed; both staged and unstaged diff checks passed.
- The canonical native app was restarted with the final build. C01 shows “Response limit reached,” an enabled “Review & retry” entry to the consent flow, and three collapsed unreviewed findings. No live request was made during UI inspection.
- The existing browser preview was restarted and reloaded. At its 375-pixel viewport the failure panel and draft disclosure wrap within the content area; browser review submission remains disabled.
- Original draft hashes were checked again after reload; both still match the table above. No commit or push was performed.

These results establish the implemented request and presentation behavior. They do not turn either live provider result into a passed semantic evaluation.
