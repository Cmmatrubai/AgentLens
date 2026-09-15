# Insight completion controls and C01 review

September 7, 2026. Development branch: `codex/insight-completion`, based on `75922c9`. This work remains local and uncommitted.

## Changes

Users can select bounded reasoning effort, output allowance and timeout in the existing settings dialog. These values appear in the evidence review and persist with the analysis. Default behavior remains 6,000 tokens, 90 seconds and no reasoning override. Old saved results retain their default-setting cache identity; changed controls require new evidence-review consent. Nothing retries automatically.

Incomplete responses retain only allowlisted status/finish enums and nonnegative integer usage/answer-length counters. Raw reasoning and provider error text are excluded. The UI distinguishes a reported response limit from an unknown incomplete response and keeps diagnostic details collapsed. Expanded settings scroll independently, keeping Save accessible on narrow windows.

## Live result and semantic qualifications

The [live report](TOKENROUTER-LIVE.md) records the failed JSON-object diagnostic and the subsequent complete production-service request. The original output is preserved unchanged in private local storage.

One agent reviewer evaluated three findings against the exact supplied excerpts, without seeing the authored example analysis. All 15 citation references resolved to the stated attempts. This is one reviewer, one controlled C01 pair and one completed generation.

| Finding | Support | Usefulness | Required qualification |
| --- | --- | --- | --- |
| persistEvent field gating | Partly supported | Useful | The guard differs within the displayed normalization block. Unseen outer conditions prevent generalizing to every other stdout/stderr payload. The selected evidence does not establish effects on other payloads. |
| Module placement and exported interfaces | Partly supported | Useful | Attribute Sol's diagnostic placement to its agent report. Terra's lineDecoder evidence consists of recorded search matches, not a displayed diff or full implementation. |
| Validation reporting granularity | Supported | Useful | The numeric-versus-qualitative reporting contrast is visible. Environmental root causes remain attributed to the reports, while truncated command excerpts corroborate process-identity failures. |

Both independent check sets passed; none of these findings ranks the models. Coverage remains 24 selected sources out of 64 candidates. Incomplete implementation excerpts and limited independent coverage remain visible. Two partly supported findings mean the semantic quality release gate remains open, as do repeatability, reversed order, a second real task and practical latency.

## Verification

- Backend regressions cover both API formats, controls/consent/cache invalidation, deadline/abort behavior, incomplete and schema-rejected outputs, diagnostic sanitization, legacy saved results and no automatic retries.
- Presentation checks prevent claiming reasoning exhaustion when usage evidence is missing.
- Native offline acceptance uses synthetic evidence and temporary settings with provider networking blocked. It exercises setting retention, limits in the consent screen, explicit generation, response-limit explanations, diagnostic counters, history after reload, and Save visibility at 1440 and 820 pixels.
- [Settings at 820 pixels](completion/settings-820.png) and [response-limit state](completion/limit-820.png) are synthetic QA captures, not live results.

The original private `.local` directory is still connected through the ignored link created during migration. It is not included in source or these reports.

Final checks: 1,519 existing tests and 100 desktop tests passed. Repository type checks and both production builds passed. Native offline completion acceptance passed; the actual Electron app displayed the completed C01 analysis and preserved earlier failed requests. The initial fresh-checkout packaging run omitted newly untracked modules; the complete source snapshot was added to the Git index and the full suite rerun successfully. No commit or push was performed.
