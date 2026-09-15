# AgentLens Public Demo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Do not delegate unless the current session authorizes delegation.

**Goal:** Ship a recruiter-friendly, browser-accessible recorded AgentLens case study that works without installation, credentials or this developer's machine.

**Architecture:** Reuse the desktop React interface with a public read-only capability profile and a reviewed bundled snapshot. Isolate local readers and live analysis from the static build. Keep authored narrative and evidence/AI provenance explicit.

**Tech Stack:** Existing React 19, TypeScript, Vite 8, Motion, Radix, Lucide; JSON snapshot assets and static hosting. No new runtime dependency is planned for the initial slice.

**Spec:** [Public demo design](../specs/2026-09-14-public-demo-design.md).

## Global constraints

- User-selected first audience: a recruiter-friendly public demo.
- No installation, login or API key is required.
- Keep the existing product interface.
- No production model ranking or correctness guarantee is inferred from the synthetic reviewer tests.
- Preserve recorded observations, independent checks, authored case-study notes and AI judgments as separate evidence categories.
- Preserve `design-prototypes/`, synced `sources/`, existing local records and native credential identity.
- Do not publish until the concrete public build and selected content are reviewed and publication is authorized.
- All paths below are relative to the canonical AgentLens repository. New filenames are planned, not existing functionality.

## Implementation update — September 14, 2026

Tasks 1–3 are implemented as a local release candidate. The build emits `apps/desktop/dist-demo/` and was exercised from an isolated static directory. Task 4 remains at local verification; no publication was attempted. See `apps/desktop/docs/public-demo-content.md` and `public-demo-release-checklist.md`.

Implementation adjustment: a separate `PublicDemoApp.tsx` shell reuses `RealComparisonView` and evidence dialogs. It avoids importing the sample App shell and conditionally excludes the live InsightPanel from the demo build. The desktop RecordedRunView and its native reads do not need a public adapter because that route is not exposed. `public-demo-data.ts` owns the shared public destination list and manifest-verified asset reader. No optional standalone recording asset was exported.

## Current inventory and consequences

- `apps/desktop/src/App.tsx`: visible Prototype 05/About labels, fixed sample navigation counts, fallback route to fictional task home, demo-only playback and mock repository navigation.
- `apps/desktop/src/dialogs.tsx`: About description/design references and a command palette that routes into sample tasks. Both must change together with the public navigation.
- `apps/desktop/src/RealComparisonView.tsx`, `src/InsightPanel.tsx`, `src/RecordedRunView.tsx`: current data reads are embedded in views; browser reads depend on `/api/*`.
- `apps/desktop/server/vite-recorded.mjs` and `vite.config.ts`: local read middleware is used in dev/preview. A successful local preview is not a static-hosting proof.
- `apps/desktop/server/insights/runtime.mjs`: chooses an imported pair or C01 from checkout-relative `.local/insight-engine`; not a public data source.
- `apps/desktop/server/comparison-reader.mjs` and `recorded-reader.mjs`: depend on local manifests, archives, connection files and, in some paths, repository/runtime locations.
- `apps/desktop/electron/identity.cjs`: the existing `agentlens-desktop-prototype` identity is intentionally retained for macOS safeStorage/preferences. Do not rename in the public-copy pass.
- `apps/desktop/package.json`: source build and Electron launch scripts exist; this manifest does not currently define a desktop distributable build. That is not needed for the first public browser demo.

## Task 1: Public-safe case snapshot

**Files:** Create `apps/desktop/scripts/export-public-demo.mjs`, `apps/desktop/public/demo/manifest.json`, `apps/desktop/public/demo/comparison.json`, optional `recording.json`, `apps/desktop/docs/public-demo-content.md`; test `apps/desktop/tests/public-demo-export.test.ts`. Read existing `server/insights/import-pair.mjs`, comparison/recorded types and the C01 evidence contracts.

- [x] Define an explicit export allowlist and public snapshot schema; never recursively copy `.local` or QA directories.
- [x] Build a reproducible export from the selected real case with original provenance and declared redactions. Review exact outgoing excerpts and metadata, including paths, logs and agent reports.
- [x] Record export version, hashes, source identifiers and omissions. If content changes, create new export identities and validate citations against those bytes.
- [x] Prepare a short authored case narrative with per-statement evidence; keep it separate from the known imperfect generated draft.
- [x] Test unknown-field exclusion, credentials/private paths, missing evidence, size bounds, deterministic output and hash/citation consistency. Inspect the actual emitted asset inventory.

**Acceptance:** A self-contained, locally reviewable packet with a manifest and a useful real case. No public upload yet.

## Task 2: Static read-only app mode

**Files:** Create `apps/desktop/src/app-capabilities.ts` and `src/comparison-data.ts`; modify `src/RealComparisonView.tsx`, `src/InsightPanel.tsx`, `src/RecordedRunView.tsx`, `vite.config.ts`, `package.json`; test `tests/public-demo-data.test.ts` and `tests/public-demo-capabilities.test.ts`.

- [x] Define a build-time public-demo mode with explicit read, import and generate capabilities; avoid incidental checks of hostname or key presence.
- [x] Centralize reads for comparison, insights and optional recorded evidence. Public mode reads versioned snapshot assets; existing native/local behavior remains available.
- [x] Add a `build:demo` script and omit local read middleware from that build. Keep host-relative/subpath asset loading and direct-route refresh working.
- [x] Hide provider settings, generation and imports in public mode; substitute a concise desktop explanation where helpful.
- [x] Test a clean static-server load with private folders absent and no Electron bridge. Verify all navigation produces no localhost, local `/api/*` or provider request.

**Acceptance:** The built product works on a generic static server independent of this checkout. No backend process or API key required.

## Task 3: Remove prototype presentation from the public journey

**Files:** Modify `src/App.tsx`, `src/dialogs.tsx`, `src/RealComparisonView.tsx`, `src/InsightPanel.tsx`, `src/SupportReview.tsx`, `src/styles.css`, `src/insights.css`; create a small `src/AboutAgentLens.tsx` if extraction keeps responsibilities clear. Keep sample implementations in `RunSetup.tsx`, `RunLive.tsx`, `views.tsx` isolated.

- [x] Default public entry to the recorded case; provide Case study, Evidence and About destinations only where they are functional.
- [x] Update navigation and command palette from one capability-aware destination list. Sample routes opened directly must land in a clear supported destination rather than a fake dashboard.
- [x] Replace visible iteration branding with AgentLens/recorded-case context. Remove fake task counts, mock repository navigation and simulated execution from the public path.
- [x] Explain the task, result and two or three evidence-linked differences in plain language. Preserve uncertainty and attribution; do not relabel failed AI drafts as reviewed.
- [x] Add a compact About view explaining the engineering and link to the verified repository `https://github.com/Cmmatrubai/AgentLens`. Keep implementation details secondary to the case story.
- [x] Visually verify desktop/narrow widths, keyboard navigation, focus after section jumps, dialogs, reduced motion, empty/error states and browser chrome. Unfamiliar-reader user testing has not happened and remains a release follow-up.

**Acceptance:** Every primary action is useful; a visitor can understand and inspect the case without decoding prototype states.

## Task 4: Share package and release verification

**Files:** Update repository `README.md`, `apps/desktop/README.md`, add `apps/desktop/docs/public-demo-release-checklist.md`, reviewed screenshots/walkthrough assets, and hosting configuration only after selecting the deployment target.

- [x] Write a brief demo introduction: the problem, what the visitor can explore, what the recorded case does and does not establish.
- [x] Capture screenshots from the actual finished build; optionally create a short walkthrough. Do not present mockups or local-only controls as live public features.
- [ ] Run the existing repository suite and demo-specific checks; verify built asset contents, console/network behavior, direct links and refresh from a clean browser profile.
- [ ] Prepare the exact deployable artifact and public content manifest. Obtain publication authorization for this concrete result if not already provided.
- [ ] Publish through one chosen hosting path, verify the external link from a clean session, then add that verified link to the README and portfolio material.

**Acceptance:** A verified external demo link and accurate supporting materials. Until the final verification, describe it as a local build or release candidate.

## Suggested implementation order

Start with Tasks 1 and 2: portability is the current sharing blocker. Then finish presentation and publish. Visible-label changes alone must not be presented as a completed release. Reviewer reliability work can continue independently, but the public recorded demo should not depend on a live model call or endorse the unresolved C01 AI claims.

## Follow-on desktop work (separate plan)

Inject writable app-data paths, design an explicit migration preserving native safeStorage identity, provide a real recording/import selection workflow, then package/sign and test installation on a clean machine. Replace simulated “new comparison” execution only when the actual execution backend exists and has separate controls/provenance tests.
