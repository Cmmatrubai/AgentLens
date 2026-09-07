# Insight Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Generate and preserve source-bound insights for any supported saved comparison using a user-configured API key.

**Architecture:** Normalize recorded comparisons into a bounded evidence bundle, call a tools-free structured analyzer, validate citations against the supplied bundle, and persist versioned jobs/results separately from evidence. Electron owns credentials and mutations; browser previews can read saved insights but cannot configure credentials or start paid generation.

**Tech Stack:** Existing React/TypeScript, Node ESM, Electron, node:test; OpenAI Responses HTTP adapter as first provider. No new runtime dependencies.

**Spec:** `docs/insight-engine-v1-proposal.md` (approved in conversation, BYOK chosen).

## Global Constraints

- Isolated existing desktop-prototype-v1 worktree only. Do not edit canonical AgentLens, synced sources, frozen C01 inputs or original recordings. Do not commit/push this untracked prototype.
- Facts/check outcomes are deterministic; generated interpretation is labeled AI analysis. Exact citations establish association, not semantic correctness.
- No API call on reads/settings saves. No default API model inferred from the models being compared. User supplies model and key in desktop settings; no credentials in logs, renderer responses or localStorage.
- No automatic retry after ambiguous provider/network failure. Completed and failed revisions are retained. No claim of real-provider or held-out-task validation without those runs.
- Generic model names and attempt keys. Zero findings and unknown independent correctness are supported. Capture completeness and independent evaluation are separate.

### Task 1: Generic bounded evidence and finding validation

**Files:** create `server/insights/evidence.mjs`, `server/insights/schema.mjs`, `tests/insight-evidence.test.ts`, `tests/fixtures/insight-comparisons.mjs`.

**Interfaces:**
```js
export function buildInsightBundle(comparison, options = {}) // maxCharacters default 60000, maxSources default 24
// {schemaVersion:1,comparisonId,inputHash,eligible,reason,task:{title,prompt,baseCommit,manifestHash},
// attempts:[{key,model,reasoningEffort,runId,facts:{elapsedMs,commandCount,failedCommandCount,checks}}],
// sources:[{...FindingSource,attemptKey}],coverage:{includedSources,totalSources,omittedSources,characters,limits:string[]}}
export function validateInsightOutput(bundle, output) // returns {findings:ComparisonFinding[],abstentionReason:string}
export const insightOutputSchema // strict JSON Schema
export const INSIGHT_VERSION // 'insights-v1'
```
Provider output shape: `{findings:[{id,category,title,summary,interpretation,limitations,sides:[{attemptKey,observation,sourceIds:string[]}]}],abstentionReason:string}`. All keys required, no unknown properties, all text bounded, maximum three findings, two distinct sides with at least one own-attempt source each. Server assembles excerpts/model labels from bundle, never model-returned source text. Zero findings requires nonempty abstention reason. Reject foreign IDs/keys, duplicate IDs and malformed structures.

Input is existing RealComparison with optional `taskPrompt` text; no C01 paths or imports. Two unique completed run IDs/attempt keys, shared nonempty base commit matching each run.git.initialHead, manifestHash and promptHash required. `ready` can be false when independent evaluation is absent; run.status completed controls generation eligibility. Full input hashing ignores fetchedAt and attempt order but includes task identity/configuration, all supplied source content and checks, including omitted sources. Hash changes on any material evidence change.

Selection: deterministically alternate attempts, prioritize independent checks and failed commands with later commands, then final diffs and agent reports. Bound individual excerpts and total characters; source IDs are opaque stable digests with full-source provenance identity. Include source omissions/truncation disclosures. Avoid dumping full omitted content into provider payload. Retain actual referenced excerpt and identity for paired UI.

- [ ] Write failure cases first. Example:
```js
const b = buildInsightBundle(pairWithoutChecks);
assert.equal(b.eligible, true);
assert.equal(b.attempts[0].facts.checks.length, 0);
assert.throws(() => validateInsightOutput(b, foreignSourceFinding));
assert.equal(buildInsightBundle({...pair,attempts:[...pair.attempts].reverse()}).inputHash, buildInsightBundle(pair).inputHash);
```
- [ ] Run `node --test tests/insight-evidence.test.ts`; record expected failures with a minimal export stub if necessary.
- [ ] Implement shape/identity validation, source extraction, bounded selection, hashing and strict output validation. Synthetic fixtures represent at least two tasks with different model names and independent expected facts.
- [ ] Test missing checks, partial capture, task/base mismatch, changed omitted evidence, bounded input, swapped sides, invented sources, excessive output, empty findings and instruction-like recorded text. Run focused tests and record results.

### Task 2: Provider, private revisions and explicit generation jobs

**Files:** create `server/insights/provider.mjs`, `server/insights/service.mjs`, `server/insights/private-files.mjs`, `electron/insight-credentials.cjs`, `tests/insight-service.test.ts`, `tests/insight-provider.test.ts`.

**Interfaces:**
```js
export async function analyzeOpenAI({bundle,model,apiKey,signal}) // {output,usage,providerResponseId}; fetch only fixed api.openai.com/v1/responses
export function createInsightService({root,readComparison,credentialStore,analyze})
// {read(), configure({model,apiKey?,enabled}), generate({inputHash,requestId,regenerate?}), forgetKey()}
// read => {ok:true,settings:{provider:'openai',model,enabled,hasKey,desktopRequired:boolean},
// input:{hash,eligible,reason,coverage,sources:[{id,attemptKey,label,path,provenance,excerpt}]},
// state:'not_analyzed'|'running'|'available'|'no_findings'|'insufficient_evidence'|'stale'|'failed'|'interrupted',
// analysis:null|{id,model,createdAt,inputHash,findings,abstentionReason,usage},history:[{id,state,createdAt,model}],error:string|null}
// credentialStore => {get():Promise<string|null>,set(string),remove()}; never return key.
```

- [ ] Test missing/disabled configuration, input hash mismatch, foreign request keys, idempotent double start, saved read without analyzer calls, failure sanitization, stale completion, process restart recovery and changed model invalidation. Stub only provider and credential boundary; real temp file persistence.
- [ ] Implement fixed OpenAI Responses POST with `store:false`, `tools:[]`, `text.format:{type:'json_schema',name:'agentlens_insights',strict:true,schema:insightOutputSchema}`, max_output_tokens 6000. Treat refusal/incomplete/non-JSON/HTTP errors as safe typed failures; do not log response body or secrets. Timeout 90 seconds and response body byte cap.
- [ ] Private files use owner-only directory/files, atomic writes, symlink rejection and bounded reads. Serialize mutations and reserve a persisted running job before network activity. Job key includes inputHash, model, analyzer version; requestId UUID makes retries idempotent. Reread evidence before publishing. Interruptions do not resume automatically. Preserve previous revisions.
- [ ] Credential adapter uses Electron safeStorage encryption backed by OS key protection, refusing unavailable/basic_text backends. Store only encrypted bytes locally; no key in settings JSON. Document that the key briefly exists in the settings input/main-process memory.
- [ ] Run provider and service focused tests. Provider fakes assert outbound body/data boundaries and return complete Responses-style objects; no real paid calls without user configuration.

### Task 3: Desktop integration and reusable comparison selection

**Files:** modify `electron/main.cjs`, `electron/preload.cjs`, `src/recorded-types.ts`, `server/vite-recorded.mjs`; create `server/insights/runtime.mjs`, `server/insights/import-pair.mjs`, `tests/insight-import.test.ts`.

- [ ] Add restricted IPC handlers `agentlens:insight-read`, `agentlens:insight-configure`, `agentlens:insight-generate`, `agentlens:insight-forget-key`, `agentlens:insight-open-pair`, `agentlens:insight-use-c01`. Validate exact local main frame before every call and exact object schemas in service. Request a single instance lock so separate Electron processes cannot generate duplicate paid jobs.
- [ ] Native open-file dialog accepts a bounded JSON comparison bundle with explicit imported-provenance disclosure; validate through buildInsightBundle before copying into private storage. No arbitrary paths from renderer, no external resource lookup. Selected bundle can be cleared back to original C01; original reader remains untouched. Input selected for analysis is also the comparison displayed by the UI.
- [ ] Runtime resolves selected normalized comparison or original readComparison; add guarded read-only `/api/insights` for browser preview. Browser cannot save keys, import files or generate; desktop carries these actions. Bind saved insights to current input/version/model on every read.
- [ ] Test imported valid different task, invalid/mismatched pair and size/path handling. Existing HTTP request guard remains mandatory. No mutation endpoint in Vite.

### Task 4: Calm generation/settings experience and verification

**Files:** create `src/InsightPanel.tsx`, `src/insight-types.ts`, `src/insights.css`; modify `src/RealComparisonView.tsx`, `src/ComparisonFindings.tsx`, `src/comparison-types.ts`, `README.md`, approved design status. Create `qa/insight-engine/REPORT.md` and `docs/insight-comparison-bundles.md`.

- [ ] Add `InsightPanel({comparison,onComparisonChange})`, owning read/poll/settings/source-consent modal, generated results and paired dialog. Preserve authored notes under explicit **Example analysis** disclosure; do not present them as newly generated. Dynamic model names and finding counts.
- [ ] Settings: fixed OpenAI provider, user-entered model ID/password key, enable remote analysis checkbox, save/remove actions. Clear key field on save/close. Preview exact selected evidence categories/excerpts and omissions before generate. Never use browser localStorage for credentials or enable flags.
- [ ] State-specific UI for not analyzed/running/zero findings/insufficient/stale/failed/interrupted, explicit retry/regenerate, prior revision metadata. Generation does not clear recorded facts. Cancel request UI must not claim provider billing was reversed; omit cancellation in v1.
- [ ] Whole prototype tests and build, independent source/quality review, actual browser and Electron checks of settings, evidence preview, unavailable-key path, keyboard and compact layout. Test successful async integration using an isolated test harness, never fake generated results in the user's saved C01 data.
- [ ] Retain quality evaluation harness/rubric for C01 plus unseen real task. If no user API key/second real pair exists, explicitly record that live quality validation remains outstanding, without manufacturing a pass or calling this release-ready.
- [ ] Recheck original recording hashes, canonical status, frozen input integrity. Leave updated preview running and provide next concrete user step (enter key/model in desktop, then Generate insights).
