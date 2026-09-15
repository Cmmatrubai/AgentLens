# Concise findings and claim-scope review

September 7, 2026. Implemented locally in `codex/insight-completion`.

## Change

`comparison-rubric-v3` requests one useful difference per finding, with short card text and supporting details in paired observations. Its instructions explicitly distinguish agent reports, search matches, partial diffs and independent checks, and require scope qualifications in the claim itself.

New output is validated against a separate concise profile: title 80 characters, category 40, summary 280, observation 500, interpretation 600, limitations and abstention reason 400. The existing schema and default saved-output validator retain their previous bounds. Prior prompt revisions become stale and remain in history; their output is not rewritten. Old review consent cannot authorize the new prompt revision. Overlong or structurally invalid output is withheld without an automatic retry.

These are presentation and structural controls. They do not prove that a generated claim is supported by its citations.

## Controlled live request

One further paid request used the existing reviewed C01 bundle, TokenRouter `z-ai/glm-5.3`, Chat Completions, Prompted JSON, low reasoning, 24,000 output tokens and a 300-second deadline. No new evidence or authored comparison notes were sent. Model, evidence selection and response controls match the prior successful request; prompt instructions and requested text bounds changed together.

- Evidence: 24 of 64 candidate sources; 38,737 excerpt characters.
- Input hash: `798eb07284607e207f07baa3cbced134a0d622d292279b112ee7d72adcf74aba`.
- Previous job: `51dcb157-6150-41ad-a625-7130075ed530`.
- New job: `be0406bf-b8b8-40f5-89a1-c467757e33de`.

| Observation | Previous v2 request | New v3 request |
| --- | ---: | ---: |
| Persisted elapsed time | 206.406 s | 182.061 s |
| Findings | 3 | 3 |
| Card summary characters, combined | 1,694 | 743 |
| Answer characters | 8,369 | 6,265 |
| Provider-reported input tokens | 19,580 | 19,784 |
| Provider-reported output tokens | 21,710 | 20,389 |
| Provider-reported reasoning tokens | 19,874 | 18,950 |
| Provider-reported total tokens | 41,290 | 40,173 |

The new request finished with `stop`, passed the concise output validator and saved three findings. The polling harness observed completion at 182.842 seconds. Card summaries are 56% shorter in this pair of outputs. One request per prompt does not establish a repeatable speed or cost improvement; reasoning-effort handling by the router is not independently verified.

The original v2 job remains byte-for-byte unchanged: SHA-256 `50548df32b3280e5f9dd3ddacde31dcfcd95f755f8d4bce91d1de718c4881a3c`. The unedited v3 job has SHA-256 `4640cd3da1680fddc723dc8856b86c77e620b0cab618dc781b46fc8035caf740`. Both are private local records. Credentials and provider reasoning text are excluded from this report.

## Semantic review: still needs work

One agent reviewer inspected the new output against its cited excerpts without authored C01 findings. All **12/12 citation references** resolve to the correct attempt and source. All text bounds pass. Each finding has a useful core contrast, but all three are **partly supported** under the stricter claim-level scope and provenance criteria:

| Finding | Supported contrast | Remaining qualification |
| --- | --- | --- |
| `oversized-logic-placement` | Recorded changed-file locations and displayed exports differ. | Sol's cited status/stat and partial framer diff do not establish diagnostic wiring placement. Say its recorded modified files are confined to the CLI. Passing selected checks is narrower than establishing the entire 1 MiB requirement. |
| `persistevent-field-gating` | The displayed numeric copies differ in their local reason guard. | The summary must say “within the displayed normalization branch”; outer conditions are missing. Selected evidence does not establish behavior for other payloads or exhaustive test absence. |
| `full-suite-report-granularity` | Sol's report gives full-suite totals; Terra's report omits them. | Attribute sandbox/IPC explanations to the agents. The recorded excerpts corroborate process-identity errors, not the entire causal explanation. Keep the declared historical test correction explicit when contrasting independent evaluation. |

Architecture source references: Sol `src_1bf2e2776b178f9d2a5f5df1`, `src_dcc29dfd5a34c8bda60cf088`; Terra `src_6a36fd4891a534ccd14f37c5`, `src_cc58529031cfddbbbf566df9`.

Field-gating references: Sol `src_207cf4f5f9b6d6e73611874f`; Terra `src_555ce992dc2fc873d58cf035`.

Reporting references: Sol `src_3029894c679a08489e328981`, `src_9d54ab090f1bbbe2bf87c395`, `src_062df57fd3561086de7f5b64`; Terra `src_f13d830e969e22d471ad5a0f`, `src_310742f0f6acd12aa287aab6`, `src_98ccee7189a2877f03bdd40d`.

The original reporting review treated the causal opening as an optional qualification. This review applies the new explicit rule that a caveat later in a finding does not repair an overclaim in its summary. These review labels should not be presented as a controlled quality trend.

No output was silently edited to incorporate these suggestions. The revised prompt improved brevity but did not satisfy the semantic quality gate. The next engineering step is a separate evidence-support review that can flag or withhold unsupported claims, followed by held-out-task, repeatability and attempt-order testing. That support review is not yet implemented.

Subsequent development: the separate review flow is now implemented. Its first live check missed these known overstatements; the revised section-level check returned no answer within its output allowance. The original draft remains unchanged and the quality gate remains open. See [the follow-up report](SUPPORT-REVIEW.md).

## Verification and native presentation

- Verification: 1,519 root tests and all 107 desktop tests passed. The root suite ran with the initial 106 desktop tests; after adding the v2-to-v3 compatibility regression, the complete 107-test desktop suite passed again.
- Desktop typecheck/build passed. A separate code reviewer found no actionable regression in the bounded schema, provider and completion changes.
- Native offline QA passed settings, consent review, bounded failure, diagnostics, reload and responsive footer checks.
- Read-only native acceptance of the exact saved v3 revision passed at 1440 and 820 pixels: three summaries of 246, 246 and 251 characters, paired evidence navigation and reload persistence. No additional generation was triggered.
- Captures: [1440-pixel findings](concise/c01-1440.png), [820-pixel findings](concise/c01-820.png), [820-pixel paired evidence](concise/c01-evidence-820.png). These show unedited generated interpretations with the qualifications above; they are not evidence of semantic correctness.

With AgentLens closed and this saved revision available locally, repeat the read-only native check from the repository root:

```sh
AGENTLENS_QA_REVISION=be0406bf-b8b8-40f5-89a1-c467757e33de node apps/desktop/qa/insight-engine/concise-ui.cjs
```
