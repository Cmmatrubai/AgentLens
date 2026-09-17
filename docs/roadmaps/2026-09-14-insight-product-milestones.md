# AgentLens: insight product milestones

Latest priority additions: see **Tester readiness and sourced content — 2026-09-15** below. Earlier status sections describe their dated checkpoints.

Status: execution started in priority order. Milestone 1 has a local import-evidence safeguard implemented; broader fact coverage and human evaluation remain open. Later milestones are not marked complete.

## Product objective

Help a developer answer: **What changed between these attempts, why does it matter for my task, and what should I inspect or do next?**

The first sharing audience remains recruiters and hiring managers. The product workflow should also work for a developer comparing their own recorded attempts. A polished case study is the entry point; a useful, repeatable comparison is the product.

## Current basis

Reviewed the local `codex/insight-completion` checkout at `75922c9`, including its uncommitted desktop and insight work. This is not a claim that those changes are on GitHub or published.

- A standalone public-demo build shows the real C01 case, selected evidence and authored notes without a backend or API key. Public publication remains pending.
- The desktop can import a normalized saved comparison and use an OpenAI-compatible analysis endpoint. Importing raw provider logs or selecting two arbitrary recordings is not that existing workflow.
- Evidence hashes, fixed passage IDs, draft revisions, consent and conservative failure handling provide a foundation for traceability.
- The latest exact-unit C01 trial still accepted a false import relationship. Its ambiguous “unconditional” title is unsuitable as a clean accuracy label. Passing a citation check does not establish that a claim is true.
- The real-case quality gate is unmet. Repeated synthetic successes have not resolved this gap.

## Priority and dependency map

| Priority | Milestone | User-visible outcome | Dependency |
| --- | --- | --- | --- |
| P0 | 1. Findings that distinguish facts from judgments | Understand what is established and what still needs checking | Existing recorder/evidence contracts |
| P0 | 2. A comparison that explains practical consequences | Read at most three useful differences and open the decisive evidence | Start with authored notes; connect to milestone 1 |
| P0 | 3. Prove usefulness on fresh real tasks | See that the approach works beyond the development example | Prepare cases now; gate live findings after 1 and 2 |
| P1 | 4. Compare your own work without preparing JSON | Select compatible recorded attempts and reach a useful result | 1–3 for a trustworthy release |
| P2 | 5. Learn from repeated comparisons | See task-specific model patterns, sample counts and exceptions | Several compatible real comparisons from 3 and 4 |

### 1. Findings that distinguish facts from judgments

**Deliverable:** A finding has a concrete observation for each attempt, an explanation of why the difference matters, evidence links, stated limits, and a suggested inspection or check. Recorded measurements and judgments retain distinct labels.

Build structured facts for the narrow classes that are reliable to extract: independent outcomes, recorded command exits, selected final changes and, where complete suitable source is available, import relationships. Then let analysis explain those facts in the task's context. Investigate the C01 import error with a frozen regression and supported near-matches, rather than continuing to swap reviewers without a specific hypothesis.

Code relationship extraction must be tied to the correct attempt and source hash. Parse complete supported source when available; do not treat mixed search output, partial diffs or truncated snippets as a complete program. An absent symbol in selected evidence is not proof that the program lacks it. Record unsupported language/insufficient coverage as unknown. Guard semantics and causal attribution still need their own evidence; an import parser does not solve them.

**Done when:** The frozen false import is rejected or explicitly withheld; matching true import cases remain supported; wrong-attempt and truncated-source controls fail conservatively; a missing independent check remains unknown. Every displayed factual claim resolves to its saved fact/source, and judgments stay identifiable. Human-audited evaluation results must accompany any change to automatic promotion.

**Engineering value:** Typed evidence contracts, source-aware parsing, provenance, uncertainty handling and regression evaluation.

### 2. A comparison that explains practical consequences

**Deliverable:** One consistent reading path: outcome → up to three important differences → why each matters → evidence → next action. Secondary logs and identities remain on demand.

Proposed finding dimensions are correctness/validation, implementation approach, and recovery from blockers. Show elapsed time and cost only where the recorded data supports them; unavailable cost stays unavailable. Changes in code size, number of commands or test count must not become automatic quality scores.

Use the existing C01 notes to develop the presentation without waiting for an AI-quality breakthrough. For example, explain that an explicit split-byte test and a child-process test exercise different boundaries, then suggest checking the boundary relevant to the task. Do not turn this into an unsupported claim that one implementation is more maintainable or one model is generally better.

Start with one default ordering by relevance to the task. Add a compact user priority choice only if the usability trial shows it helps; avoid introducing another dashboard of controls. Preserve the existing evidence dialog and keyboard/reduced-motion behavior.

**Done when:** In a proposed five-person unfamiliar-reader trial, at least four can identify the task outcome, explain one consequential difference and open its evidence without guidance within two minutes. This is a proposed product gate, not an observed usability result. A comparison may legitimately say no meaningful difference is established.

**Engineering value:** A clear interface between findings and presentation, accessible progressive disclosure, and measured product usability.

### 3. Prove usefulness on fresh real tasks

**Deliverable:** Two new controlled task pairs, alongside C01: a bug fix and a behavior-preserving refactor. Include explicit success conditions, independent checks and cases where no meaningful difference should be claimed.

Freeze prompts, starting revisions, evaluator rules, budgets and controls before execution. Reserve at least one pair from prompt tuning. Preserve failed/incomplete attempts and omitted evidence. Separate coding-model execution from subsequent analysis-model requests and report their costs independently when measured.

Review findings against original evidence with a human reviewer. Resolve ambiguous labels before scoring. Reverse presentation order and repeat analysis on frozen recordings to detect material changes in attribution or conclusions. Repeated analysis of one recording does not count as independent model executions.

Measure factual support, unsupported-claim promotion, missed useful differences, abstention, analysis latency and recorded usage. Report counts and denominators; this small set is not a population-level accuracy estimate.

**Done when:** Fresh-task reports include exact inputs, independent outcomes, inspected findings, reviewer identity/type and known failures. No unresolved material unsupported claim is promoted in the reviewed release cases. If a case fails that gate, show authored notes or an unreviewed draft rather than relaxing the label. A human user can identify a concrete review or model-selection decision the comparison helped with.

**Engineering value:** Reproducible experiments, held-out evaluation, adversarial controls and honest quality reporting.

### 4. Compare your own work without preparing JSON

**Deliverable:** A real input path that selects two supported saved recordings, explains compatibility, previews the outgoing evidence and opens the same comparison experience used by the case study.

Build on the existing normalized-pair importer. Prefer a local run picker or recorder-supported export adapter over asking a user to author a 16 MiB JSON contract. Initially support the recorder format already validated in the repo; defer additional providers until their normalization and evidence gaps are explicit.

Validate task identity, repository base, model/reasoning metadata and independent-check comparability. Explain missing data or mismatch before analysis. Keep credentials OS-backed in the desktop flow, previews explicit, and revisions recoverable across cancellation/reload. Reuse identical saved analysis only when evidence and analysis configuration identities match.

**Done when:** A fresh user with two supported compatible recordings can select them, understand any omissions, approve analysis and inspect the resulting comparison without editing files or using developer-only paths. Unsupported or incompatible recordings produce an actionable explanation. Desktop packaging/writable-data migration is part of release readiness before describing this as install-and-use.

**Engineering value:** Recorder adapters, validation boundaries, durable jobs, configuration-aware caching and usable local-first onboarding.

### 5. Learn from repeated comparisons

**Deliverable:** A history grouped by task type and controlled model configuration, showing observed outcomes, validation gaps, elapsed time and measured cost, with every aggregate linked to its source attempts.

Keep model version, reasoning setting, task/evaluator revision and execution controls visible in the grouping rules. Do not silently pool incompatible experiments. Display sample counts, repeated attempts and failures. A pattern such as “fewer validation gaps on these refactors” must be bounded to the actual evidence, not a universal strength label.

**Done when:** A user can trace each summary to its runs, identify the sample and its limits, and see when there is too little comparable evidence to recommend a model. General rankings and opaque overall scores remain deferred.

**Engineering value:** Experiment lineage, comparable aggregates and auditable decision support.

## Recommended first development slice

Work on milestones 1 and 2 together:

1. Define the finding contract: observation, consequence, evidence, limits, next action, and provenance labels.
2. Add source-aware checks for the specific import-relationship failure, with supported and incomplete-source controls. Version the new fact representation and preserve old drafts.
3. Render one complete finding using that contract, initially with the existing authored C01 evidence. Keep source inspection one action away.
4. Prepare the two fresh tasks and freeze the held-out evaluation before changing prompts further.
5. Run the small usability trial and the fresh-case review before expanding the feature set.

This slice is complete when one useful, inspectable finding works end to end and its critical factual statements pass the declared checks. A second AI opinion alone is not the completion criterion.

## Parallel release work and deferred scope

Finish the normal clean-checkout build/test run with the new runtime files tracked, retain the explicit public content inventory, choose hosting and verify the eventual external demo link. The previous broad test runs hit timeouts; separate focused reruns do not replace a clean release check. This release work should not require live analysis to become trustworthy first, because the public case uses authored notes.

Defer autonomous live experiment orchestration, many-provider integration, team accounts, a general chat assistant, decorative analytics and global model leaderboards. Add them only when the core comparison workflow and evidence quality justify the work.

## Source anchors

- [Current semantic investigation](../../apps/desktop/qa/insight-engine/C01-GRANULARITY-EVALUATION.md)
- [Insight evaluation contract](../../apps/desktop/docs/insight-engine-evaluation.md)
- [Existing comparison import](../../apps/desktop/docs/insight-comparison-bundles.md)
- [Public release status](../../apps/desktop/docs/public-demo-release-checklist.md)
- Code starting points: `apps/desktop/server/insights/evidence.mjs`, `schema.mjs`, `support-schema.mjs`, `service.mjs`; `apps/desktop/src/comparison-types.ts`, `ComparisonFindings.tsx`, `RealComparisonView.tsx`, `InsightPanel.tsx`.

Direct source/document inspection was used because graph discovery tools were unavailable. Proposed extraction, prioritization, fresh-task evaluation, recording selection and aggregation are milestones, not claims of existing capabilities.

## Execution update — 2026-09-14

Milestone 1, first safety slice: added versioned named-import facts from complete added-file diffs, a conservative local support gate, and separate local/AI explanations in the claim inspector. The frozen C01 false import now remains **Needs review** in an offline replay; original artifacts are unchanged and no provider call is made. A supported near-match works with complete suitable source. Wrong-attempt, partial, malformed and type/alias controls stay unresolved. An independent code review caught a provider claim-boundary bypass; its regression is now covered.

See [the fact contract and replay scope](../../apps/desktop/docs/insight-local-facts.md). This does not mark milestone 1 complete: the general recorded-fact contract, broader relationship coverage and human-audited release evaluation remain open. Continue those before advancing to the comparison UX milestone. Subsequent priorities remain 2 → 3 → 4 → 5; human usability and real-case review outcomes must be recorded rather than inferred from automated tests.

### Recorded outcomes slice

Added the versioned recorded-fact ledger and a collapsed fact inspector available before AI analysis. Preview and analysis request share its contents. Missing planned checks stay unknown, selected command exits remain distinct from independent outcomes, and grouped/omitted sources are disclosed. Fixed the importer dropping checks missing from both attempts. See [recorded fact contract](../../apps/desktop/docs/insight-recorded-facts.md).

The general check/command fact contract is now implemented. Remaining milestone 1 work includes checking generated statements against those facts beyond import claims, extending supported source coverage where suitable, and human-audited evaluation. The milestone is still open; no human or fresh-task result has been inferred from automation.


## Tester readiness and sourced content — 2026-09-15

User-requested backlog additions after the real live-workspace trial. These are planned work, not completed capabilities. The live-launcher work has since advanced beyond the earlier deferred-scope paragraph; see [the real-work evaluation](../../apps/desktop/docs/live-workspace-real-work.md) for observed results and limits.

### P0 — Replace placeholder product content with sourced results

Audit the normal desktop journey: setup, live workspace, overview, findings, attempts, checks, history, and analytics. Every run-specific statement, metric, recommendation, and success condition must come from recorded evidence, a user-supplied criterion, or explicitly identified AI analysis with evidence links. Remove sample-derived fallbacks from users' own comparisons. Keep the deliberately selected example clearly identified, and distinguish ordinary instructional copy from fabricated task content.

The screenshot's “No independent evaluation supplied” message is an honest missing-data state, not a fabricated result. Complete the workflow behind it: let users define success conditions, supply or run independent checks against both isolated attempts, and inspect the saved results. Missing checks remain unknown until actually executed or imported; an AI-generated test proposal is not a passing test result. Explain the next action in the empty state instead of leaving a dead end.

For AI-generated explanations, surface the compatible endpoint/API-key requirement before the user starts that action. Keep analysis-provider setup separate from coding-agent authentication. Local evidence inspection and independently executed local checks should not be presented as requiring an analysis API key.

**Acceptance:** A fresh user's real comparison has no invented/example task results, every displayed conclusion has an inspectable source or an explicit interpretation label, and the checks section offers a clear path from missing evaluation to real evidence. Test empty, partial, failed, and completed comparisons as well as a disconnected analysis provider.

### P1 — Automatic dependency preparation

Replace the trial's manual dependency symlinks with an explicit preparation stage for supported repositories. Detect supported manifests/lockfiles and runtimes, explain the planned setup, and prepare both working copies consistently. Define how repository install scripts and network access are handled before execution. Record setup commands, versions, outcomes, and failures separately from agent work, with installation time distinct from coding time.

**Acceptance:** A fresh supported project reaches both agent runs without manual symlinks or shell preparation. Test missing runtimes, unavailable network/cache, lockfile mismatch, installation failure/cancellation, and asymmetric preparation. Preserve the source checkout, explain unsupported projects, and never silently compare different dependency environments.

### P1 — Installer readiness

Package the desktop with a documented runtime strategy; move runtime data to an appropriate application-data location instead of a source-tree or prototype path. Handle first-run checks, credential setup, storage permissions, upgrade compatibility, and platform signing/notarization as applicable to the initial target release.

**Acceptance:** Install and run on a fresh supported machine/account without a development checkout or globally prepared workspace. Verify first launch, a real comparison, reopening saved evidence, update behavior, and recoverable setup errors. Passing a development build is not installer validation.

### P2 — Easier sign-in: Codex subscription feasibility

Investigate whether an officially supported sign-in/OAuth or existing Codex authentication integration can simplify access for subscription holders. Verify supported third-party integration, allowed use, scopes, token handling, revocation, and which capabilities a subscription actually covers. Treat coding execution and insight analysis as separate capabilities until verified otherwise.

**Acceptance:** Document the supported route and its limitations, then prototype only that supported route. Keep compatible API-key configuration available. Do not promise that a Codex subscription supplies API access or that third-party OAuth is available before verification.

**Order:** Start with sourced content and the missing-evaluation workflow, then dependency preparation and installer readiness. Investigate sign-in feasibility early enough to inform onboarding, but do not make the first usable release depend on an unverified integration. Preserve the existing insight-reliability gates throughout.

### Execution update — sourced comparison content, first slice

Implemented the personal-comparison boundary: no saved selection now produces a genuine empty state; unreadable selected evidence remains unavailable and preserved. Neither state silently loads C01. The explicitly chosen recorded example remains separate.

The missing-check section now offers **Open evaluated comparison**. It validates a supplied normalized comparison bundle before replacing the selection, rejects bundles without evaluated checks, and retains author-supplied provenance. This opens the supplied pair; it does not attach arbitrary outcomes to the current recordings. The AI panel explains compatible endpoint/API-key requirements before generation, separately from local evidence inspection.

Validation: 265 desktop tests passed, root typecheck passed, desktop and public-demo builds passed, and native Electron QA exercised a new empty workspace, a real unevaluated recording, rejected evaluation import with selection preserved, and successful import of the existing seven-check C01 bundle. Native QA used temporary selection storage and production UI/parser/runtime with a minimal QA IPC wrapper; it did not run new independent checks or call an analysis provider. See [the contract and QA procedure](../../apps/desktop/docs/sourced-comparison-content.md).

P0 remains open. Next: define and execute independent checks against both isolated attempts, save command/output/snapshot evidence, and surface partial, failed, cancelled, and unavailable outcomes. The broader content audit, automatic dependency preparation, installer validation, and sign-in feasibility remain queued.

### Execution update — in-app command verification

Completed workspaces now run a user-named command on fresh copies of both retained attempts, save output and snapshot identities, and project the results into the comparison. Progress, stop, retry history, interruption recovery, save failures and missing evidence have explicit states. The UI labels this command verification; it does not claim independently authored assertions or whole-task correctness.

Native Electron testing on the real draft-retention pair produced a concrete difference: Sol passed the nested-field exclusion assertion, Terra failed it. No new model call was needed. Validation: 281 desktop tests, root typecheck, desktop build and public-demo build passed. See [command verification](../../apps/desktop/docs/command-verification.md).

Next priority: explicit, consistent dependency preparation for both agent and check copies, followed by installer/runtime readiness. The macOS-only command runner currently omits installed dependencies and denies network access. Broader assertion grading, cross-platform execution and the content audit remain open.

### Execution update — live dependency preparation, first path

Live setup now offers detected pnpm 11 dependency installation into both isolated copies on macOS. Both installs must finish successfully before either agent starts; setup output, versions and time are retained separately. Source-only runs remain available. Lockfile changes, asymmetric failure, cancellation and interrupted recovery have explicit handling. Real local dependency installation and native Electron fixture recording passed without provider calls. See [the supported path and validation limits](../../apps/desktop/docs/dependency-preparation.md).

The dependency milestone remains open: next prepare command-verification copies, validate remote registry/network failures, then complete installer/runtime readiness on a fresh machine. This implementation does not install global runtimes or establish general support for pnpm configuration, native build scripts or authenticated registries.


### Execution update — dependency preparation for verification

The check runner now offers pnpm 11 setup on both fresh result copies, including result-time manifest changes. Setup is recorded separately; neither check starts unless both installs succeed. Cancellation and setup failures remain unknown correctness outcomes. The native desktop exercised real installs, dependency-backed assertions and comparison projection; separate real regression checks preserve divergent pass/fail outcomes. All 294 desktop tests, root typecheck and desktop/public-demo builds passed. See [verification acceptance and limits](../../apps/desktop/docs/command-verification.md).

Next: installer/runtime strategy and application-data storage migration, followed by clean-machine install/upgrade verification. Remote registry failure acceptance, private registry support and broader platform support remain open; development tests are not installer readiness.

### Execution update — desktop storage and local setup

New native installations now route evidence/settings to application data. Existing installations persist a reference to their canonical data directory, preserving absolute worktree and evidence paths. Missing/corrupt locations block startup rather than opening an empty replacement. Preferences shows the actual location and detected required tools. Native restart preserved all four inspected personal evidence/config records byte-for-byte; 300 desktop tests, typecheck and both builds passed.

This is a storage-routing foundation, not a completed data relocation or installer. Next remove the recorder's source-TypeScript/monorepo runtime dependency and validate a distributable package. See [installation readiness and remaining release gates](../../apps/desktop/docs/desktop-installation-readiness.md).
