# Insight engine v1 verification

September 6, 2026 · Prototype 05 · local implementation, live quality evaluation pending.

## Implemented

The reusable engine accepts the preserved C01 comparison or a supported normalized JSON pair. It builds typed facts and bounded, balanced source excerpts; retains control and coverage declarations; requests zero to three structured findings through a configured OpenAI model; validates every source association; and saves versioned local analysis jobs with their selected evidence. Reads do not generate or resume provider work. Keys are encrypted locally using Electron safeStorage with OS-backed protection, separate from comparison and analysis files.

Electron exposes explicit settings, import, evidence preview, generation, regeneration and retry actions. Browser preview reads saved state only. Generated findings and C01's authored example notes are separate. Missing checks, stale analysis, abstention and provider failure remain visible states.

## Observed verification

- Final `pnpm test`: **76/76 passed**. Final `pnpm build`: TypeScript and Vite passed.
- Independent bounded backend and frontend source reviews approved after fixes. Reports are in `../../../.superpowers/sdd/2026-09-06-insight-engine/`: `backend-review.md`, `frontend-review.md`.
- New review regressions were observed failing before fixes: lost import disclosures, omitted provider-visible controls, duplicate source identities, uppercase UUID duplicate starts and missing persisted evidence. Fixes preserve declarations, invalidate changed inputs and reject ambiguity before provider work.
- Job tests cover a structured response through persistence and readback, duplicate/cached starts, missing consent, changed evidence, sanitized provider errors, and a real child-process exit followed by an interrupted-state read. No automatic restart request occurs. The changed-evidence cleanup test now waits for the background job's persisted final state.
- Native macOS credential smoke: temporary placeholder encrypted, decrypted identically, and removed. Observed `{roundTrip:true, encrypted:true, removed:true, platform:"darwin"}`. No real key was used.
- Real desktop UI: blank initial model/key, disabled remote analysis, actual file picker import of a clearly labeled synthetic pair, generic model/check display, then **Use C01** restored the original comparison. No analysis request was made in the real runtime. The imported private selection was removed.
- Isolated offline Electron UI: save settings without generation; cleared password field on reopening; source preview and unchecked per-request consent; running job; generated finding; correctly paired independent evidence; Escape focus restoration; stale state after model change; no-findings abstention; provider failure; and Retry returning to unchecked consent. Switching to disjoint check sets produced “Some conditions remain unverified,” with missing cells marked “Not supplied.”
- Offline UI used the production built UI, preload and service with synthetic data and an injected local analyzer. Its HTTP/HTTPS requests were blocked, its state lived in a temporary directory, and closing the harness removed that state. These screenshots are **UI fixtures, not actual model output**.
- Browser: 1440×1000 and 820×920 layouts fit the viewport; compact paired-evidence view remained readable. Settings explained the desktop requirement. Escape restored focus, command search opened as a single dialog, and captured browser warning/error logs were empty. Temporary viewport override was reset.
- Current localhost endpoint: authorized read returned 200 with `no-store`; absent header, cross-site origin, POST and query-bearing requests returned 403. Real configuration remains empty model, disabled, no saved key. See `http-boundary.json`.
- C01 selection: 24 of 64 candidates, 38,737 excerpt characters; six distinct independent check outputs, twelve recorded commands, four final diffs and two agent reports. Forty omissions and thirteen coverage notices are disclosed; original evaluator controls are included. Selection version `balanced-evidence-v3`; see `c01-selection.json`.
- Preservation: historical database and seven artifacts retain identical bytes, SHA-256 and modification times; both attempt source trees retain all 86 snapshot file hashes. Canonical HEAD remains `271b422ae5053bccc6d74fa5e86ba9b0e7aab01c` with its two pre-existing untracked paths. See `preservation.json`.

## Limits and next validation

No real provider request was made. Actual provider compatibility, latency, usage and semantic usefulness have not been measured. Structural citation validation does not prove that a claim is supported by its cited text. Before broader use, run C01 with a user-configured key/model, then a held-out real recorded task, and score the outputs using `../../docs/insight-engine-evaluation.md`.

The normalized import format is implemented; arbitrary raw provider transcripts and a general task-execution/export workflow are not. Setup and homepage sample workflows retain their existing fictional data. This remains an isolated runnable prototype, without production integration or packaged-release verification. Nothing was committed or pushed.

## Artifacts

- `c01-overview-1440.png`, `c01-overview-820.png`, `c01-paired-820.png`: real preserved comparison.
- `desktop-settings.jpg`: real runtime with empty credentials and remote analysis off.
- `desktop-import.jpg`: clearly labeled synthetic import, subsequently removed from active selection.
- `offline-generated.jpg`, `offline-paired-evidence.jpg`, `offline-abstention.jpg`, `offline-failure.jpg`: isolated synthetic UI acceptance states.
- `offline-desktop.cjs`: repeatable offline acceptance harness; it cannot contact a provider or write real analysis state.
