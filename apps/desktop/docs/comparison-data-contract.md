# From the preview to real comparisons

Status: Prototype 05 adds a reusable local insight engine to the controlled historical pair and read-only evidence projection. Electron supports importing normalized comparison bundles, configuring BYOK analysis, previewing selected evidence, explicit generation and persisted analysis revisions. Live semantic quality evaluation and the general case-execution backend remain pending. See `insight-engine-evaluation.md` and `../experiments/C01/REPORT.md`.

## First integration checkpoint — September 6, 2026

The desktop and browser now read T01-A1 through AgentLens's existing safe inspection and artifact validation APIs. The interface preserves source identities, 102 stored events, captured command output, the final Git diff, unavailable metadata and a separate historical human assessment. See `real-run-connection.md` and `../qa/real-run/REPORT.md` for the implemented boundary and verification.

The user selected `gpt-5.6-sol` with `high` reasoning and `gpt-5.6-terra` with `high` reasoning for the upcoming controlled comparison. These targets are now completed and independently evaluated in C01. A frozen manifest, independent checks, separate attempt workspaces, bounded recorder orchestration and a comparison projection are implemented for this local experiment. The connected historical recording is not one of these new attempts.

The next production milestone is one complete, inspectable comparison: a real coding task, two controlled attempts, independent checks, and a result whose claims link to the evidence ledger. Keep the interface outcome-first: answer what happened, show the decisive condition, then reveal the recorded details on demand.

## What should fill each screen

| Surface         | Source of truth                                     | Completion condition                                                                                                                                                |
| --------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup           | Versioned task manifest and selected check bundle   | Both attempts reference the same frozen task, starting revision, tool permissions and check definitions.                                                            |
| Live comparison | Recorder events plus execution lifecycle            | The display distinguishes running, stopping, stopped, disconnected, completed and incomplete capture. A terminal agent message alone is insufficient.               |
| Attempt summary | Independent check results and measured run metadata | Pass/fail comes from check artifacts. Missing results remain unknown. Elapsed time and usage indicate their source and availability.                                |
| Comparison      | A reproducible projection of two attempt records    | Each condition is aligned by stable check ID/version. A changed setup is disclosed and may prevent a direct comparison.                                             |
| Evidence drawer | Immutable evidence references                       | Every displayed result opens its source, with observed, derived, provider, Git and human evidence distinguished.                                                    |
| Homepage        | Stored comparison projections                       | Show recent work, unfinished comparisons and meaningful changes. Aggregate metrics show their denominator and scope. Empty data has a useful first-run entry point. |

## Minimum records

**Task manifest.** Stable case ID/version; task text; starting commit and cleanliness or captured starting-state artifact; check IDs, definitions and bundle hash; allowed tools; harness version; timeout; repetitions; provider/model identifiers and relevant generation/reasoning settings. Record differences that cannot be matched across providers.

**Attempt.** Unique attempt and comparison IDs; baseline/candidate role separate from model identity; manifest reference; lifecycle timestamps and terminal reason; recorder status; event sequence/checkpoints; command/check/artifact references; usage and cost only when actually available. Preserve a terminal result against late or duplicate events.

**Check result.** Stable check and attempt IDs; pass/fail/unknown; independent runner metadata; exit status when relevant; evidence IDs for output and artifacts; unavailable reason when capture or execution is incomplete. Agent claims and judge opinions are separate fields, never replacements for missing check output.

**Comparison projection.** Source attempt IDs; task/check versions; projection version; matched settings and disclosed differences; check-by-check outcomes; measured durations; claim-to-evidence references. No aggregate model ranking from one pair of attempts.

## Role of AI

Check counts, recorded timings and outcomes are computed from captured data, without an AI judge. For C01, three AI-assisted notes explain implementation, testing and handling blocked validation. They are authored and independently code-reviewed for this exact recorded pair, stored separately from the frozen experiment inputs in `server/c01-review.mjs`. Reading the comparison does not generate new analysis or call a model.

Each note binds to the comparison manifest, both model/reasoning identities, run IDs, final snapshot hashes and reviewed independent check outcomes/artifact hashes. Each excerpt resolves against an exact final Git artifact or event ID/sequence plus an evidence digest and validated line range. The projection withholds this review when those references do not match. These digests guard source association and changes; they do not prove the editorial interpretation is correct. Findings remain visibly labeled analysis, with observations, agent reports, recorded failures and independent outcomes distinct. The UI can reveal the full displayed source and its identity. Final diffs are not presented as per-action provider patches.

General explanation generation is implemented behind the Electron main-process boundary. It uses bounded, balanced evidence selection, explicit user consent, a configured OpenAI model, a closed output schema, source-association validation and a versioned local job record. Reads never trigger paid work. Input changes invalidate cached conclusions. Imported controls and coverage disclosures survive normalization, and missing independent checks remain unknown. This establishes the application contract; the live quality gate still requires C01 and a second held-out real task. AI-assisted case creation remains separate work.

If qualitative judging becomes necessary, store the judge model, prompt/rubric version, source evidence, output and review separately. An AI summary must not turn missing evidence into a pass or a broad model-strength claim.

## Recovery and cancellation

The preview resumes a local animation from a stored step. Real execution needs a stronger contract: reconnect to the existing recorder/job, reconcile sequence IDs, discover actual process state, then decide whether to continue observing, resume a supported checkpoint, or start a new attempt. Do not restart tools blindly on reconnect. Preserve partial evidence and distinguish stopped execution from a disconnected viewer.

## Delivery sequence

1. Pick one reproducible task and freeze independent checks. Use two explicitly chosen model configurations with a disclosed shared harness.
2. Connect the setup manifest and recorder lifecycle to the existing evidence system. Display a real comparison end to end before adding aggregate analytics.
3. Exercise interruption, cancellation, incomplete capture, duplicate events and unavailable metrics against real records.
4. Repeat the controlled task enough to report variation, then turn one useful debugging finding into a case study with inspectable artifacts.
5. Add homepage aggregation and optional evidence-linked AI explanations once trustworthy records exist.

Provider choice, paid-run budget, production storage schema and desktop packaging remain integration decisions. The C01 harness made two completed provider attempts plus a preserved startup failure. The interface remains read-only for real evidence, and these broader production systems are not shipped.
