# AgentLens Flight Console Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the existing production AgentLens web interface as the approved **Flight Console**: a compact neutral-graphite developer instrument with a flat evidence ledger, a dense and physically stable execution trajectory, a fixed inspector, a full-width Git inspection mode, and unmistakably separate human judgment.

**Architecture:** Keep the Task 7 data, API, security, query, polling, pagination, and evidence boundaries unchanged. The work is a presentation-layer refactor inside `apps/web`: semantic React components retain their existing DTOs and query hooks, focused CSS ownership is clarified, Motion for React is constrained by one duration/easing policy, TanStack Virtual continues to own the long trajectory, and the real production server plus deterministic fixtures remain the browser-validation path. The only new production components are a compact run-evidence strip and a terminal-evidence dock; the only CSS split extracts shell and run-detail geometry from files that currently mix those responsibilities.

**Tech Stack:** React 18, TypeScript, React Router, TanStack Query, TanStack Virtual, Motion for React, locally bundled Geist Sans and Geist Mono, CSS custom properties, Vitest, React Testing Library, axe-core, and Playwright Chromium.

**Spec:** `docs/superpowers/specs/2026-08-30-agentlens-task-7-design.md`, especially Sections 4-12 and 17-20, plus the approved Flight Console direction frozen on 2026-09-03. Release evidence and existing browser boundaries are recorded in `docs/verification/2026-08-30-agentlens-task-7.md`.

## Global Constraints

- Begin implementation from synchronized `main` at `1aebc25e` or later, but reconfirm `HEAD`, `origin/main`, remote URL, worktree ownership, and status immediately before creating the implementation worktree.
- Create an isolated `codex/agentlens-flight-console` worktree before production edits. Do not implement directly on `main`.
- `design-prototypes/` is intentionally untracked, is read-only visual reference material, and must never be edited, formatted, staged, copied into production, or traversed by bulk rewrite commands.
- Do not reopen the approved visual direction. Change it only if a concrete accessibility, usability, or performance failure is demonstrated and documented.
- Do not change event order, provenance, evidence availability, likely-test wording, assessment semantics, Git semantics, authentication, privacy, loopback-only behavior, API DTOs, read-only boundaries, active polling, cursor behavior, pagination, or lazy evidence loading.
- Do not import storage, application services, prototype code, or provider payloads into React presentation components.
- Keep TanStack Virtual, measured variable-height rows, overscan, bounded rendering, focus identity, page-anchor preservation, follow-tail behavior, and the current `<30` mounted-row release gate for 1,000 events.
- Selection styling must not change row geometry. Inspector selection changes must not change the inspector's x/y position, width, or outer height. Lifecycle expansion and switching between trajectory and full Git inspection are the only approved large geometry changes.
- Motion must use Motion for React and CSS transitions already in the project. No Anime.js, no 21st.dev dependency, no component library, no icon library, and no remote font or asset request.
- No bounce, spring overshoot, infinite pulse, entrance choreography, staggered trace reveal, ambient glow loop, or per-row append animation. All functional motion is a tween of 200 ms or less and becomes effectively zero under reduced motion.
- Preserve full evidence text in the DOM. Visual truncation may use CSS ellipsis or line clamping only when the same full value remains available to assistive technology and in the stable inspector.
- Keep pointer-event-free relationship overlays so connectors never intercept rows, buttons, links, text selection, or scroll input.
- Keep one logical tab stop per trajectory row, current arrow/Home/End behavior, exact action labels, selection URL identity, inline inspector ownership at 800 px, and focus restoration when responsive placement changes.
- Use existing synthetic/path-neutral browser fixtures. Never capture a README screenshot from private run data, a real repository path, a bearer URL, browser chrome, or a provider payload containing uncontrolled content.
- Each behavior-sensitive task follows: add or preserve a failing/characterization test, run it and observe the expected RED, make the smallest implementation change, run GREEN, run focused regressions, run `pnpm typecheck`, review the scoped diff, run `git diff --check`, and commit only that task.
- If a test fails for an unexpected reason, use `superpowers:systematic-debugging` before changing the implementation.
- Before every completion claim and commit, use `superpowers:verification-before-completion` with fresh command output.
- README imagery and status copy are Task 13 only. Do not update documentation to claim the redesign before the production build and complete browser matrix pass in Task 12.

## Current Production Findings That Shape the Plan

- The semantic and information architecture is already strong: two real routes, one functional Runs destination, URL-addressable filters and event selection, honest evidence wording, canonical ordering, bounded deep evidence, lazy content/native/Git requests, explicit human assessment, and active-run polling should all stay.
- The production shell is structurally useful but visually generic: a 172 px rail, 56 px blurred top bar, circular `AL` mark, broad content padding, radial background, and raised cards consume space without adding evidence.
- The run ledger retains every required fact, but each run is a rounded gradient card with a second four-column evidence block and a separate signal row. The content is correct; the visual container hierarchy is too dashboard-like and too tall.
- The run-detail header exposes all required facts, but a large title, two-column definition list, assessment editor, toolbar, and generous spacing delay the actual trajectory.
- The current trajectory estimates each row at 144 px and enforces a 132 px minimum. On a typical desktop viewport this makes roughly four to six events meaningful at once rather than the approved target of about ten.
- The current row adds selected relationship actions into normal flow and uses `layout="size"` on the card. Both can cause selection-driven geometry changes; selected styling must become paint-only while intentional lifecycle expansion keeps measured size animation.
- The current desktop inspector is sticky but content-sized with `max-height`; Final Git evidence is appended inside it. The queries and semantics are correct, but ordinary selection, Git summary, and tracked diff compete for a 340-380 px column.
- The existing `DeepEvidencePanel` already provides the correct lazy, bounded Git viewer. It should become a run-scoped full-width inspection mode while preserving trajectory component state behind a hidden, non-focusable surface.
- Human assessment is semantically correct but visually embedded in the machine-evidence header. It needs a dedicated human station with explicit provenance language and a separate accent treatment.
- `global.css` imports `responsive.css` before later stylesheet imports in `bootstrap.tsx`, which makes responsive ownership difficult to reason about. Responsive rules should be imported last, while shell-only and run-detail-only rules move to focused files.
- The old prototype contributes compact instrument chrome, a flat ledger, small provenance markers, a clear temporal spine, a spatially fixed inspector, and code/diff craft. It does **not** contribute its ignition tracer, page entrances, repeated pulses/scans, mock KPI strip, freeform five-lane canvas, or responsive rules that hide semantic columns.
- The live production browser confirms that the current inspector can contain selected event detail, long normalized content, Final Git facts, Git status, and Git checks at once; the problem is presentation density and spatial allocation, not missing evidence.

## Exact File Responsibility Map

### Must stay untouched

- `design-prototypes/**` — read-only, untracked visual reference; never stage it.
- `packages/api-contract/**` — the browser contracts remain frozen.
- `packages/application/**`, `packages/storage/**`, `packages/core/**`, `packages/codex/**`, `packages/derivations/**` — no evidence, storage, derivation, or provenance change.
- `apps/server/**` and `apps/cli/**` — no server, bootstrap, authentication, packaging, or CLI behavior change.
- `apps/web/src/api/**` — API client, query keys, response validation, and lazy evidence queries stay unchanged.
- `apps/web/src/run-detail/useActiveRunPolling.ts` — polling cadence, retry, abort ownership, and terminal stop behavior stay unchanged.
- `apps/web/src/trajectory/mergePages.ts`, `projectTrajectory.ts`, `relationships.ts`, `types.ts`, `useFollowTail.ts`, and `useTrajectoryPages.ts` — canonical order, projection, grouping semantics, cursor paging, selection resolution, and append semantics stay unchanged.
- `apps/web/e2e/browserGuard.ts`, `requestLifecycle.ts`, and `apps/web/e2e/privacy.spec.ts` — privacy and exact request-lifecycle gates stay unchanged and must keep passing.
- `docs/assets/agentlens-header.svg` and `docs/assets/agentlens-trajectory-concept.jpg` — keep the existing assets; Task 13 adds production screenshots rather than overwriting history.

### Production files to modify

- `apps/web/src/bootstrap.tsx` — deterministic stylesheet ownership/import order.
- `apps/web/src/app/App.tsx` — global Motion reduced-motion enforcement only.
- `apps/web/src/app/AppShell.tsx` — compact functional shell and brand treatment.
- `apps/web/src/runs/RunListPage.tsx` — integrated ledger heading/column frame.
- `apps/web/src/runs/RunFilters.tsx` — compact integrated filter chrome; query behavior remains unchanged.
- `apps/web/src/runs/RunRow.tsx` — flat scanline markup and evidence grouping; every current text fact remains.
- `apps/web/src/run-detail/RunDetailPage.tsx` — pass assessment confirmation to the terminal dock and retain routing/polling behavior.
- `apps/web/src/run-detail/RunHeader.tsx` — compact identity and summary composition.
- `apps/web/src/run-detail/RunWorkspace.tsx` — stable trajectory/inspector geometry, terminal dock, and run-scoped Git mode.
- `apps/web/src/run-detail/EventInspector.tsx` — stable inner scrolling and keyed content transition.
- `apps/web/src/run-detail/DeepEvidencePanel.tsx` — full-width Git mode heading, close semantics, and focus return support.
- `apps/web/src/trajectory/Trajectory.tsx` — compact size estimate and singleton new-event motion only.
- `apps/web/src/trajectory/TrajectoryRow.tsx` — compact event scanline and paint-only selection.
- `apps/web/src/trajectory/TrajectoryToolbar.tsx` — compact toolbar/legend organization without changing commands.
- `apps/web/src/trajectory/RelationshipOverlay.tsx` — restrained selected-relationship emphasis without pointer events.
- `apps/web/src/evidence/GitEvidenceSummary.tsx` — terminal-dock composition and explicit diff-trigger ref.
- `apps/web/src/evidence/GitDiffViewer.tsx` — full-width presentation hooks only; all bounds and paging algorithms remain unchanged.
- `apps/web/src/assessment/AssessmentEditor.tsx` and `AssessmentSummary.tsx` — human-station presentation hooks; mutation behavior remains unchanged.
- `apps/web/src/motion/motionPolicy.ts` — named Flight Console tween durations/easing and zero-duration reduced motion.
- `apps/web/src/styles/tokens.css`, `global.css`, `run-list.css`, `trajectory.css`, `evidence.css`, `assessment.css`, and `responsive.css` — visual implementation.

### Test and documentation files to modify

- `apps/web/test/runList.test.tsx`
- `apps/web/test/runHeader.test.tsx`
- `apps/web/test/trajectory.test.tsx`
- `apps/web/test/eventInspector.test.tsx`
- `apps/web/test/gitDiffViewer.test.tsx`
- `apps/web/test/assessment.test.tsx`
- `apps/web/test/accessibility.test.tsx`
- `apps/web/test/activePolling.test.tsx` only if a characterization assertion is needed; do not change polling expectations.
- `apps/web/e2e/run-list.spec.ts`
- `apps/web/e2e/trajectory.spec.ts`
- `apps/web/e2e/evidence.spec.ts`
- `apps/web/e2e/assessment.spec.ts`
- `apps/web/e2e/accessibility.spec.ts`
- `README.md` only after Task 12 is green.

### Focused files to create

- `apps/web/src/run-detail/RunEvidenceStrip.tsx` — renders the existing header facts in one compact named region; no data transformation.
- `apps/web/src/run-detail/TerminalEvidenceDock.tsx` — composes run-scoped Git evidence and the separate human assessment station; no fetching or mutation logic of its own.
- `apps/web/src/styles/shell.css` — only `AppShell` chrome.
- `apps/web/src/styles/run-detail.css` — only run-detail header, toolbar, workspace, inspector frame, terminal dock, and Git-mode geometry.
- `apps/web/test/visualFoundation.test.ts` — tokens, local typography, stylesheet order, and dependency-free visual contract.
- `apps/web/test/motionPolicy.test.tsx` — standard and reduced-motion policy.
- `apps/web/e2e/flight-console.spec.ts` — measured desktop/laptop/800 px visual geometry and temporary review captures.
- `docs/verification/2026-09-03-agentlens-flight-console.md` — fresh redesign verification record created in Task 12.
- `docs/assets/agentlens-flight-console-ledger.png` — sanitized production ledger screenshot created only in Task 13.
- `docs/assets/agentlens-flight-console-trajectory.png` — sanitized production trajectory screenshot created only in Task 13.

## Proposed Component and Style Decomposition

| Boundary | Owns | Explicitly does not own |
| --- | --- | --- |
| `AppShell` + `shell.css` | brand, real navigation, local-only state, rail/top-bar geometry | route data, fake navigation, evidence rendering |
| `RunListPage` / `RunFilters` / `RunRow` + `run-list.css` | URL-backed controls and a flat semantic run ledger | client-side filtering, new summary semantics, hidden mobile facts |
| `RunHeader` + `RunEvidenceStrip` + `run-detail.css` | run identity and existing run-level facts | assessment mutation, Git loading, event projection |
| `Trajectory` / `TrajectoryRow` / `RelationshipOverlay` + `trajectory.css` | virtualization, measured rows, focus, selected relationship geometry, compact temporal scanlines | event reordering, evidence derivation, deep content requests |
| `RunWorkspace` / `EventInspector` + `run-detail.css` and `evidence.css` | stable two-column geometry, inline placement at 800 px, inner inspector transition | polling, selection URL, evidence availability rules |
| `TerminalEvidenceDock` | composition of `GitEvidenceSummary`, `AssessmentSummary`, and `AssessmentEditor` | Git parsing, assessment mutation, truth aggregation |
| `DeepEvidencePanel` / `GitDiffViewer` + `evidence.css` | full-width bounded Git mode, readable diff, focus entry/return | authorship claims, unbounded DOM, raw artifact reads |
| `motionPolicy.ts` | durations, easing, reduced-motion values | page choreography, springs, ambient animation |

The two new React components are the smallest useful split. `RunEvidenceStrip` keeps the compact header testable without enlarging `RunHeader`; `TerminalEvidenceDock` prevents Git and human review from remaining accidental children of the event inspector while preserving their existing query and mutation components.

---

### Task 1: Establish Flight Console tokens, typography, and CSS ownership

**Files:**
- Create: `apps/web/src/styles/shell.css`
- Create: `apps/web/src/styles/run-detail.css`
- Create: `apps/web/test/visualFoundation.test.ts`
- Modify: `apps/web/src/styles/tokens.css`
- Modify: `apps/web/src/styles/global.css`
- Modify: `apps/web/src/styles/trajectory.css`
- Modify: `apps/web/src/bootstrap.tsx`

**Interfaces:**
- Keep locally bundled `Geist Sans` for prose/control labels and `Geist Mono Variable` for IDs, timestamps, evidence classes, statuses, and code.
- Add semantic tokens for graphite surfaces, ink, evidence provenance, status, focus, compact control heights, row geometry, shell geometry, and tween durations.
- Import `responsive.css` last from `bootstrap.tsx`; it is no longer imported from `global.css`.

- [ ] **Step 1: Add the visual-foundation RED test**

Create a source-level contract that fails until the new ownership and tokens exist:

```ts
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

describe("Flight Console visual foundation", () => {
  it("defines local technical typography, evidence colors, compact geometry, and final responsive precedence", () => {
    const tokens = read("apps/web/src/styles/tokens.css");
    const bootstrap = read("apps/web/src/bootstrap.tsx");
    const global = read("apps/web/src/styles/global.css");
    expect(tokens).toContain("--font-ui:");
    expect(tokens).toContain("--font-code:");
    expect(tokens).toContain("--evidence-observed:");
    expect(tokens).toContain("--evidence-human:");
    expect(tokens).toContain("--trajectory-row-compact:");
    expect(tokens).toContain("--chrome-topbar-height:");
    expect(global).not.toContain('@import "./responsive.css"');
    expect(bootstrap.indexOf('"./styles/responsive.css"'))
      .toBeGreaterThan(bootstrap.indexOf('"./styles/assessment.css"'));
  });
});
```

- [ ] **Step 2: Run RED**

Run:

```bash
pnpm vitest --run apps/web/test/visualFoundation.test.ts
```

Expected: FAIL because the Flight Console tokens, split files, and final responsive import do not exist.

- [ ] **Step 3: Implement the neutral graphite foundation**

Keep current variable names as compatibility aliases while introducing intent-specific tokens. Use a palette close to:

```css
:root {
  --font-ui: "Geist Sans", system-ui, sans-serif;
  --font-code: "Geist Mono Variable", ui-monospace, monospace;
  --canvas: #07090b;
  --shell: #0a0d10;
  --panel: #0e1215;
  --panel-raised: #12181c;
  --border-soft: #1a2126;
  --border: #283139;
  --text: #e7ecef;
  --text-muted: #8b969e;
  --text-dim: #626e76;
  --evidence-observed: #70cbd0;
  --evidence-derived: #d8ae65;
  --evidence-git: #9aa5ff;
  --evidence-recorder: #8b949d;
  --evidence-human: #ef987d;
  --status-positive: #76c99b;
  --status-warning: #e4bd73;
  --status-danger: #ef8b7f;
  --chrome-rail-width: 56px;
  --chrome-topbar-height: 46px;
  --control-height-compact: 32px;
  --trajectory-row-compact: 68px;
  --radius: 6px;
}
```

Remove the decorative radial body gradient. Keep surface contrast quiet, borders crisp, and radii between 3-6 px for routine controls/panels. Reserve semantic color for provenance, lifecycle, warnings, selection, and focus.

Extract current shell-only rules to `shell.css` and current run-detail outer geometry rules to `run-detail.css` without changing behavior in this task. Leave row/spine/relationship rules in `trajectory.css`.

- [ ] **Step 4: Run GREEN and local-asset regressions**

Run:

```bash
pnpm vitest --run apps/web/test/visualFoundation.test.ts apps/web/test/buildOutput.test.ts
pnpm typecheck
pnpm --filter @agentlens/web build
```

Expected: foundation and build-output tests pass; the build contains bundled fonts and no remote visual dependency.

- [ ] **Step 5: Review and commit**

Run:

```bash
git diff --check
git diff -- apps/web/src/bootstrap.tsx apps/web/src/styles apps/web/test/visualFoundation.test.ts
git status --short design-prototypes
```

Expected: only the intentional untracked `design-prototypes/` entry appears for that directory.

Commit:

```bash
git add apps/web/src/bootstrap.tsx apps/web/src/styles/tokens.css apps/web/src/styles/global.css apps/web/src/styles/trajectory.css apps/web/src/styles/shell.css apps/web/src/styles/run-detail.css apps/web/test/visualFoundation.test.ts
git commit -m "style(web): establish Flight Console foundation"
```

---

### Task 2: Replace generic app chrome with a compact instrument shell

**Files:**
- Modify: `apps/web/src/app/AppShell.tsx`
- Modify: `apps/web/src/styles/shell.css`
- Modify: `apps/web/src/styles/responsive.css`
- Modify: `apps/web/test/runList.test.tsx`

**Interfaces:**
- Preserve one functional Runs destination and one `<main>` landmark.
- Keep `Local only` visible and textual; the status dot is supplementary.
- Use CSS-native line/node geometry for the AgentLens mark; do not add icon packages or copy prototype assets.

- [ ] **Step 1: Add shell characterization and RED assertions**

Extend the run-list render test to require the new concise shell copy and semantics:

```ts
expect(screen.getByLabelText("AgentLens Flight Console")).toBeVisible();
expect(screen.getByRole("navigation", { name: "Primary navigation" }))
  .toHaveTextContent("Runs");
expect(screen.getByText("Flight Console")).toBeVisible();
expect(screen.getByText("Local only")).toBeVisible();
expect(document.querySelectorAll("main")).toHaveLength(1);
```

Run:

```bash
pnpm vitest --run apps/web/test/runList.test.tsx
```

Expected: RED on the new accessible brand name and `Flight Console` shell label.

- [ ] **Step 2: Implement compact shell chrome**

Change only presentation markup:

```tsx
<aside className="instrument-rail" aria-label="AgentLens Flight Console">
  <div className="brand-mark">
    <span className="brand-mark__lens" aria-hidden="true"><i /><i /></span>
    <span className="brand-mark__word">AgentLens</span>
  </div>
  <nav aria-label="Primary navigation">
    <NavLink
      to="/runs"
      className={({ isActive }) => isActive ? "rail-link rail-link--active" : "rail-link"}
    >
      <span aria-hidden="true" className="rail-link__glyph">≋</span>
      <span className="rail-link__label">Runs</span>
    </NavLink>
  </nav>
</aside>
<header className="top-bar">
  <span className="top-bar__product">Flight Console</span>
  <span className="connection-state">
    <span aria-hidden="true" className="connection-state__dot" />
    Local only
  </span>
</header>
```

At wide widths use the 56 px rail and 46 px top bar. Use a one-pixel active rail indicator, not a raised navigation card. At 800 px retain the compact horizontal shell and a 44 px touch target without hiding `Local only`.

- [ ] **Step 3: Run GREEN and browser shell regression**

Run:

```bash
pnpm vitest --run apps/web/test/runList.test.tsx apps/web/test/accessibility.test.tsx
pnpm typecheck
```

Then build and run the existing layout journey:

```bash
pnpm build
pnpm exec playwright test --config apps/web/playwright.config.ts apps/web/e2e/run-list.spec.ts
```

Expected: shell semantics pass at 1440, 1100, and 800 px with no page overflow.

- [ ] **Step 4: Review and commit**

```bash
git diff --check
git diff -- apps/web/src/app/AppShell.tsx apps/web/src/styles/shell.css apps/web/src/styles/responsive.css apps/web/test/runList.test.tsx
git add apps/web/src/app/AppShell.tsx apps/web/src/styles/shell.css apps/web/src/styles/responsive.css apps/web/test/runList.test.tsx
git commit -m "style(web): compact the Flight Console shell"
```

---

### Task 3: Turn the run list into a flat, integrated evidence ledger

**Files:**
- Create: `apps/web/e2e/flight-console.spec.ts`
- Modify: `apps/web/src/runs/RunListPage.tsx`
- Modify: `apps/web/src/runs/RunFilters.tsx`
- Modify: `apps/web/src/runs/RunRow.tsx`
- Modify: `apps/web/src/styles/run-list.css`
- Modify: `apps/web/src/styles/responsive.css`
- Modify: `apps/web/test/runList.test.tsx`
- Modify: `apps/web/e2e/run-list.spec.ts`

**Interfaces:**
- Preserve exact filter inputs, query parsing, server request arguments, URL behavior, pagination, semantic links, and all existing evidence wording.
- Add a presentational column guide at desktop widths; it is `aria-hidden` because each run continues to expose real `<dt>` labels.
- Critical facts remain rendered at every supported width.

- [ ] **Step 1: Add RED assertions for ledger structure and density**

Require an integrated ledger frame and a real-browser density measurement:

```tsx
expect(container.querySelector(".run-ledger-frame")).not.toBeNull();
expect(container.querySelector(".run-ledger__columns")).toHaveAttribute("aria-hidden", "true");
for (const label of ["Lifecycle", "Likely tests", "Human review", "Git"]) {
  expect(screen.getByText(label)).toBeVisible();
}
```

In `flight-console.spec.ts`, add:

```ts
test("the desktop ledger is flat, dense, and evidence-complete", async ({ page, productionUi }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openBootstrapped(page, productionUi);
  const visibleRows = await page.locator(".run-ledger__item").evaluateAll((rows) =>
    rows.filter((row) => {
      const box = row.getBoundingClientRect();
      return box.top >= 0 && box.bottom <= innerHeight;
    }).length
  );
  expect(visibleRows).toBeGreaterThanOrEqual(6);
  await expect(page.getByText("Likely tests").first()).toBeVisible();
  await expect(page.getByText("Human review").first()).toBeVisible();
  await expect(page.getByText("Git").first()).toBeVisible();
  await expectNoHorizontalOverflow(page);
});
```

- [ ] **Step 2: Run unit RED, then browser RED**

```bash
pnpm vitest --run apps/web/test/runList.test.tsx
pnpm build
pnpm exec playwright test --config apps/web/playwright.config.ts apps/web/e2e/flight-console.spec.ts --grep "desktop ledger"
```

Expected: the structure test fails first; the density test fails or records the current card-heavy baseline below the new gate.

- [ ] **Step 3: Implement the flat ledger**

Wrap filters, column guide, rows, and pagination in `.run-ledger-frame`. Use shared one-pixel separators and one graphite surface, not a card per run. Reduce desktop controls to 32-34 px and rows to roughly 78-104 px depending on warnings/limitations. Keep hover and focus as border/ink changes without scale or shadow lift.

On wide layouts, align identity, recorder/lifecycle, likely tests, human review, Git, and timing into repeatable scan columns. Preserve the existing `<ol>`, `<li>`, full-row link, `<dl>`, and evidence labels. On medium layouts use two evidence columns. At 800 px stack the identity/status band and two-column evidence grid. At 520 px use one column. Never use `display: none` on lifecycle, tests, review, Git, provenance, or warnings.

- [ ] **Step 4: Run GREEN and semantic regressions**

```bash
pnpm vitest --run apps/web/test/runList.test.tsx apps/web/test/accessibility.test.tsx
pnpm build
pnpm exec playwright test --config apps/web/playwright.config.ts apps/web/e2e/run-list.spec.ts apps/web/e2e/flight-console.spec.ts --grep "ledger|layouts"
pnpm typecheck
```

Expected: URL/server filtering, exhaustive lifecycle/evidence language, long unbroken text, authentication/empty/error states, and all three widths remain green; at least six complete fixture rows fit at 1440 x 1000.

- [ ] **Step 5: Review and commit**

```bash
git diff --check
git diff -- apps/web/src/runs apps/web/src/styles/run-list.css apps/web/src/styles/responsive.css apps/web/test/runList.test.tsx apps/web/e2e/run-list.spec.ts apps/web/e2e/flight-console.spec.ts
git add apps/web/src/runs/RunListPage.tsx apps/web/src/runs/RunFilters.tsx apps/web/src/runs/RunRow.tsx apps/web/src/styles/run-list.css apps/web/src/styles/responsive.css apps/web/test/runList.test.tsx apps/web/e2e/run-list.spec.ts apps/web/e2e/flight-console.spec.ts
git commit -m "style(web): flatten the run evidence ledger"
```

---

### Task 4: Compact the run-detail header and page geometry

**Files:**
- Create: `apps/web/src/run-detail/RunEvidenceStrip.tsx`
- Modify: `apps/web/src/run-detail/RunHeader.tsx`
- Modify: `apps/web/src/run-detail/RunDetailPage.tsx`
- Modify: `apps/web/src/styles/run-detail.css`
- Modify: `apps/web/src/styles/responsive.css`
- Modify: `apps/web/test/runHeader.test.tsx`

**Interfaces:**
- `RunEvidenceStrip` accepts `run: RunDetailV1` and renders existing facts only.
- `RunHeader` keeps `onAssessmentSaved` until Task 8 moves the editor; this avoids combining the geometry change with mutation relocation.
- Started/ended timestamps, duration availability, provider, repository, event count, likely tests, assessment, warnings, and contradictions remain visible.

- [ ] **Step 1: Add the evidence-strip RED test**

```tsx
const summary = screen.getByRole("region", { name: "Run evidence summary" });
expect(summary).toHaveTextContent("Lifecycle");
expect(summary).toHaveTextContent("Provider");
expect(summary).toHaveTextContent("Repository");
expect(summary).toHaveTextContent("Events");
expect(summary).toHaveTextContent("Recorder started");
expect(summary).toHaveTextContent("Recorder ended");
expect(summary).toHaveTextContent("Recorder duration");
expect(summary).toHaveTextContent("Likely tests");
expect(summary).toHaveTextContent("Assessment");
```

Run:

```bash
pnpm vitest --run apps/web/test/runHeader.test.tsx
```

Expected: RED because the named compact summary region does not exist.

- [ ] **Step 2: Extract and style `RunEvidenceStrip`**

Move formatting-free definition-list markup from `RunHeader` into the new component. Keep `durationText`, `likelyTestsText`, `providerText`, `AssessmentSummary`, and unsupported/unavailable wording unchanged. Use a compact primary band for lifecycle, duration, likely tests, and assessment; use a secondary mono metadata band for provider, repository, event count, and exact timestamps. CSS grid changes visual order only when DOM reading order stays logical.

Reduce the back link, eyebrow, title, run ID, header gaps, and toolbar separation. The trajectory heading should begin substantially higher in a 1000 px viewport without collapsing or omitting evidence.

- [ ] **Step 3: Run GREEN and detail regressions**

```bash
pnpm vitest --run apps/web/test/runHeader.test.tsx apps/web/test/runList.test.tsx apps/web/test/accessibility.test.tsx
pnpm typecheck
```

Expected: every frozen fact and unsupported/unavailable case remains exact.

- [ ] **Step 4: Review and commit**

```bash
git diff --check
git diff -- apps/web/src/run-detail/RunEvidenceStrip.tsx apps/web/src/run-detail/RunHeader.tsx apps/web/src/run-detail/RunDetailPage.tsx apps/web/src/styles/run-detail.css apps/web/src/styles/responsive.css apps/web/test/runHeader.test.tsx
git add apps/web/src/run-detail/RunEvidenceStrip.tsx apps/web/src/run-detail/RunHeader.tsx apps/web/src/run-detail/RunDetailPage.tsx apps/web/src/styles/run-detail.css apps/web/src/styles/responsive.css apps/web/test/runHeader.test.tsx
git commit -m "style(web): compact the run evidence header"
```

---

### Task 5: Redesign the execution trajectory as a dense, stable scanline

**Files:**
- Modify: `apps/web/src/trajectory/Trajectory.tsx`
- Modify: `apps/web/src/trajectory/TrajectoryRow.tsx`
- Modify: `apps/web/src/trajectory/TrajectoryToolbar.tsx`
- Modify: `apps/web/src/styles/trajectory.css`
- Modify: `apps/web/src/styles/run-detail.css`
- Modify: `apps/web/test/trajectory.test.tsx`
- Modify: `apps/web/e2e/trajectory.spec.ts`
- Modify: `apps/web/e2e/flight-console.spec.ts`

**Interfaces:**
- Keep `projectTrajectory`, exact row keys, group membership, action cycling, relationship targets, row role/selection semantics, measured virtual indices, focus ownership, Home/End behavior, inline evidence anchoring, and `overscan: 3`.
- Change the virtual estimate from 144 px to the measured compact default near 68 px. Expanded groups and inline evidence remain variable height and continue using the virtualizer's measurement callback.
- Selection is paint-only. It may change ink, border, background, node, and connector emphasis but not padding, margin, border width, min-height, or flow content.

- [ ] **Step 1: Add compact-density and no-shift RED coverage**

Keep all existing trajectory unit tests. Add assertions that relationship actions remain part of the row composite but no selected-only flow wrapper is introduced. In `flight-console.spec.ts` add:

```ts
test("about ten trajectory events remain visible and selection does not move adjacent rows", async ({ page, productionUi }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await openBootstrapped(page, productionUi);
  await navigateToRun(page, "fixture-trajectory-50");
  const viewport = page.locator(".trajectory-viewport");
  const visible = await viewport.evaluate((viewportElement) => {
    const viewportBox = viewportElement.getBoundingClientRect();
    const rows = [...viewportElement.querySelectorAll<HTMLElement>('[role="option"]')];
    return rows.filter((row) => {
      const box = row.getBoundingClientRect();
      return box.bottom > viewportBox.top && box.top < viewportBox.bottom;
    }).length;
  });
  expect(visible).toBeGreaterThanOrEqual(9);
  expect(visible).toBeLessThanOrEqual(13);
  const second = page.getByRole("option").nth(1);
  const third = page.getByRole("option").nth(2);
  const before = await third.boundingBox();
  await second.click();
  const after = await third.boundingBox();
  expect(Math.abs((after?.y ?? 0) - (before?.y ?? 0))).toBeLessThanOrEqual(1);
});
```

- [ ] **Step 2: Run focused RED**

```bash
pnpm vitest --run apps/web/test/trajectory.test.tsx
pnpm build
pnpm exec playwright test --config apps/web/playwright.config.ts apps/web/e2e/flight-console.spec.ts --grep "about ten trajectory"
```

Expected: the browser density gate fails against the 132 px minimum and 144 px estimate.

- [ ] **Step 3: Implement the compact temporal row**

Use a 76-92 px provenance gutter, a narrow spine, and one compact event surface. Keep kind/status, full safe summary, recorder time, provider-time availability, group count, and exact actions in the DOM. Arrange kind/status and time metadata on dense one-line bands; visually clamp ordinary summaries to one line while the inspector exposes the full selected value.

Remove `layout="size"` from the ordinary event card and remove selected-only relationship controls from normal flow. Keep lifecycle group expansion measured and intentional. Relationship action names remain in the row's accessible composite and selected connectors remain visible. Use one-pixel provenance accents and semantic node shapes; avoid giant cards and five-lane freeform placement.

Set the viewport height from available screen space, for example:

```css
.trajectory-viewport {
  height: clamp(560px, calc(100vh - 248px), 790px);
  contain: strict;
}
```

Tune the exact subtraction against the real compact header so 9-13 ordinary rows are meaningful at 1440 x 1000 without pushing terminal evidence off the document.

- [ ] **Step 4: Run GREEN plus long-trace gates**

```bash
pnpm vitest --run apps/web/test/trajectory.test.tsx apps/web/test/projectTrajectory.test.ts apps/web/test/trajectoryPages.test.tsx apps/web/test/mergePages.test.ts
pnpm build
pnpm exec playwright test --config apps/web/playwright.config.ts apps/web/e2e/trajectory.spec.ts apps/web/e2e/flight-console.spec.ts --grep "1000-event|about ten trajectory"
pnpm typecheck
```

Expected: 1,000 exact events still page in order, visible anchors remain within one pixel, mounted rows stay below 30, keyboard identity is unchanged, compact rows do not overlap, and the desktop viewport shows roughly ten events.

- [ ] **Step 5: Review and commit**

```bash
git diff --check
git diff -- apps/web/src/trajectory apps/web/src/styles/trajectory.css apps/web/src/styles/run-detail.css apps/web/test/trajectory.test.tsx apps/web/e2e/trajectory.spec.ts apps/web/e2e/flight-console.spec.ts
git add apps/web/src/trajectory/Trajectory.tsx apps/web/src/trajectory/TrajectoryRow.tsx apps/web/src/trajectory/TrajectoryToolbar.tsx apps/web/src/styles/trajectory.css apps/web/src/styles/run-detail.css apps/web/test/trajectory.test.tsx apps/web/e2e/trajectory.spec.ts apps/web/e2e/flight-console.spec.ts
git commit -m "style(web): densify the execution trajectory"
```

---

### Task 6: Make the event inspector physically fixed and internally fluid

**Files:**
- Modify: `apps/web/src/run-detail/RunWorkspace.tsx`
- Modify: `apps/web/src/run-detail/EventInspector.tsx`
- Modify: `apps/web/src/styles/run-detail.css`
- Modify: `apps/web/src/styles/evidence.css`
- Modify: `apps/web/test/eventInspector.test.tsx`
- Modify: `apps/web/test/accessibility.test.tsx`
- Modify: `apps/web/e2e/flight-console.spec.ts`

**Interfaces:**
- Preserve exact detail/content/native/note query gates and identity-scoped `EventInspectorSession` reset behavior.
- The outer desktop inspector has one fixed grid track and one fixed height matched to the trajectory viewport.
- Only the inner evidence body transitions; heading, tabs, outer border, x/y, width, and height do not animate.
- At 800 px, selected evidence remains inside the selected virtual row and outside the execution listbox exactly as existing tests require.

- [ ] **Step 1: Add inspector-stability RED tests**

Extend `eventInspector.test.tsx` to require a dedicated scroll/transition body with the selected identity:

```tsx
expect(screen.getByTestId("event-inspector-body"))
  .toHaveAttribute("data-inspector-event", selected.eventId);
```

Add a browser geometry test:

```ts
const inspector = page.locator(".trajectory-inspector");
const before = await inspector.boundingBox();
await page.getByRole("option").nth(1).click();
await expect(inspector.locator("[data-inspector-event]")).toHaveAttribute("data-inspector-event", /event-1$/);
const after = await inspector.boundingBox();
expect(after).toEqual(before);
```

Use per-coordinate tolerance of at most 1 px if the browser returns fractional layout values.

- [ ] **Step 2: Run RED**

```bash
pnpm vitest --run apps/web/test/eventInspector.test.tsx apps/web/test/accessibility.test.tsx
pnpm build
pnpm exec playwright test --config apps/web/playwright.config.ts apps/web/e2e/flight-console.spec.ts --grep "inspector"
```

Expected: the new body identity is absent and the current content-sized inspector does not satisfy the fixed geometry assertion.

- [ ] **Step 3: Implement the stable inspector frame**

Give `.trajectory-inspector` the same CSS height as `.trajectory-viewport`, `overflow: hidden`, and a stable `minmax(340px, 380px)` desktop grid track. Make `.event-inspector` a height-constrained flex/grid column and `.event-inspector__body` the sole vertical scroller.

Use `AnimatePresence mode="wait" initial={false}` around only the active panel body. Key it by `${event.eventId}:${session.selectedTab}` and animate opacity plus at most 4 px horizontal translation using `motionPolicy.inspector`; do not use layout animation. Keep tab semantics and lazy requests unchanged.

Remove `layout="position"` from the desktop aside. Retain the narrow inline placement/measurement code and focus restoration; do not turn the inspector into a modal or accordion.

- [ ] **Step 4: Run GREEN and identity/focus regressions**

```bash
pnpm vitest --run apps/web/test/eventInspector.test.tsx apps/web/test/accessibility.test.tsx apps/web/test/trajectory.test.tsx
pnpm build
pnpm exec playwright test --config apps/web/playwright.config.ts apps/web/e2e/trajectory.spec.ts apps/web/e2e/evidence.spec.ts apps/web/e2e/flight-console.spec.ts
pnpm typecheck
```

Expected: event requests never carry across identity changes, provider/note/content remain explicit, breakpoint focus restores, inline evidence remains associated with the selected row, and desktop inspector bounds remain stable across selections and tabs.

- [ ] **Step 5: Review and commit**

```bash
git diff --check
git diff -- apps/web/src/run-detail/RunWorkspace.tsx apps/web/src/run-detail/EventInspector.tsx apps/web/src/styles/run-detail.css apps/web/src/styles/evidence.css apps/web/test/eventInspector.test.tsx apps/web/test/accessibility.test.tsx apps/web/e2e/flight-console.spec.ts
git add apps/web/src/run-detail/RunWorkspace.tsx apps/web/src/run-detail/EventInspector.tsx apps/web/src/styles/run-detail.css apps/web/src/styles/evidence.css apps/web/test/eventInspector.test.tsx apps/web/test/accessibility.test.tsx apps/web/e2e/flight-console.spec.ts
git commit -m "style(web): stabilize the event inspector"
```

---

### Task 7: Promote Git evidence to a full-width terminal inspection mode

**Files:**
- Create: `apps/web/src/run-detail/TerminalEvidenceDock.tsx`
- Modify: `apps/web/src/run-detail/RunWorkspace.tsx`
- Modify: `apps/web/src/run-detail/DeepEvidencePanel.tsx`
- Modify: `apps/web/src/evidence/GitEvidenceSummary.tsx`
- Modify: `apps/web/src/evidence/GitDiffViewer.tsx`
- Modify: `apps/web/src/styles/run-detail.css`
- Modify: `apps/web/src/styles/evidence.css`
- Modify: `apps/web/test/eventInspector.test.tsx`
- Modify: `apps/web/test/gitDiffViewer.test.tsx`
- Modify: `apps/web/e2e/evidence.spec.ts`
- Modify: `apps/web/e2e/flight-console.spec.ts`

**Interfaces:**
- `TerminalEvidenceDock` initially composes the existing `GitEvidenceSummary`; Task 8 adds the human station.
- Add `openDiffButtonRef?: Ref<HTMLButtonElement>` to `GitEvidenceSummary` so `RunWorkspace` can restore focus after Git mode closes.
- Key `GitDiffViewState` by `runId`, not selected event ID. Git evidence is run-scoped and selection changes must not discard an open file/page state.
- `GitDiffViewer` keeps its 400-line, 50-file, 100-hunk, 200-structure bounds and single-expanded-file rule exactly.

- [ ] **Step 1: Add full-width-mode RED coverage**

Add unit assertions that Final Git evidence is no longer inside `.event-inspector` and that opening the diff produces one named deep-evidence region. Extend the browser evidence test:

```ts
await page.getByRole("button", { name: "Open tracked final diff" }).click();
await expect(page.locator(".run-workspace")).toHaveAttribute("data-workspace-mode", "git");
await expect(page.locator(".run-workspace__trajectory-mode")).toBeHidden();
const panel = await page.locator(".deep-evidence-panel").boundingBox();
const frame = await page.locator(".content-frame").boundingBox();
expect((panel?.width ?? 0) / (frame?.width ?? 1)).toBeGreaterThanOrEqual(0.9);
await page.getByRole("button", { name: "Return to trajectory" }).click();
await expect(page.getByRole("button", { name: "Open tracked final diff" })).toBeFocused();
```

- [ ] **Step 2: Run RED**

```bash
pnpm vitest --run apps/web/test/eventInspector.test.tsx apps/web/test/gitDiffViewer.test.tsx
pnpm build
pnpm exec playwright test --config apps/web/playwright.config.ts apps/web/e2e/evidence.spec.ts apps/web/e2e/flight-console.spec.ts --grep "Git|full-width"
```

Expected: Git summary is still inside the inspector, the workspace has no Git mode, and the tracked diff does not own most of the content width.

- [ ] **Step 3: Implement run-scoped Git mode without unmounting trajectory state**

Wrap the normal trajectory/inspector/dock in `.run-workspace__trajectory-mode`. When Git opens, set `hidden` on that wrapper so it is removed from layout and the accessibility tree but remains mounted, preserving virtual scroll, selected event, expanded lifecycle groups, inspector session, and queries. Render `DeepEvidencePanel` as the only visible full-width child and autofocus its heading.

On close or Escape, hide the deep panel, restore the normal wrapper, and focus the exact diff trigger. Label the action `Return to trajectory`. Keep the authorship disclaimer visible above the diff.

Use nearly the full content-frame width. The diff itself scrolls horizontally inside its code viewport; the document never scrolls horizontally. Do not widen lines by reducing code size below the existing readable mono baseline.

- [ ] **Step 4: Run GREEN and bounded-diff regressions**

```bash
pnpm vitest --run apps/web/test/gitDiffViewer.test.tsx apps/web/test/eventInspector.test.tsx apps/web/test/evidenceCollections.test.tsx apps/web/test/accessibility.test.tsx
pnpm build
pnpm exec playwright test --config apps/web/playwright.config.ts apps/web/e2e/evidence.spec.ts apps/web/e2e/trajectory.spec.ts apps/web/e2e/flight-console.spec.ts
pnpm typecheck
```

Expected: diff state variants and global DOM bounds remain exact; full Git mode is at least 90% of the content frame, Escape/close returns focus, and returning reveals the same trajectory selection/scroll state.

- [ ] **Step 5: Review and commit**

```bash
git diff --check
git diff -- apps/web/src/run-detail/TerminalEvidenceDock.tsx apps/web/src/run-detail/RunWorkspace.tsx apps/web/src/run-detail/DeepEvidencePanel.tsx apps/web/src/evidence/GitEvidenceSummary.tsx apps/web/src/evidence/GitDiffViewer.tsx apps/web/src/styles/run-detail.css apps/web/src/styles/evidence.css apps/web/test/eventInspector.test.tsx apps/web/test/gitDiffViewer.test.tsx apps/web/e2e/evidence.spec.ts apps/web/e2e/flight-console.spec.ts
git add apps/web/src/run-detail/TerminalEvidenceDock.tsx apps/web/src/run-detail/RunWorkspace.tsx apps/web/src/run-detail/DeepEvidencePanel.tsx apps/web/src/evidence/GitEvidenceSummary.tsx apps/web/src/evidence/GitDiffViewer.tsx apps/web/src/styles/run-detail.css apps/web/src/styles/evidence.css apps/web/test/eventInspector.test.tsx apps/web/test/gitDiffViewer.test.tsx apps/web/e2e/evidence.spec.ts apps/web/e2e/flight-console.spec.ts
git commit -m "feat(web): add full-width Git inspection mode"
```

---

### Task 8: Separate human assessment from machine and repository evidence

**Files:**
- Modify: `apps/web/src/run-detail/TerminalEvidenceDock.tsx`
- Modify: `apps/web/src/run-detail/RunWorkspace.tsx`
- Modify: `apps/web/src/run-detail/RunDetailPage.tsx`
- Modify: `apps/web/src/run-detail/RunHeader.tsx`
- Modify: `apps/web/src/assessment/AssessmentEditor.tsx`
- Modify: `apps/web/src/assessment/AssessmentSummary.tsx`
- Modify: `apps/web/src/styles/run-detail.css`
- Modify: `apps/web/src/styles/assessment.css`
- Modify: `apps/web/test/runHeader.test.tsx`
- Modify: `apps/web/test/assessment.test.tsx`
- Modify: `apps/web/test/accessibility.test.tsx`
- Modify: `apps/web/e2e/assessment.spec.ts`
- Modify: `apps/web/e2e/flight-console.spec.ts`

**Interfaces:**
- Move the existing `AssessmentEditor` composition from `RunHeader` to `TerminalEvidenceDock`; do not change `AssessmentDraft`, ETag behavior, validation, mutation, cache updates, event selection, conflict handling, or note semantics.
- `RunHeader` continues to show the current assessment summary as a run-level fact.
- The human station uses `data-provenance="human"` only for explicit human evidence; projected unreviewed remains visibly and semantically `no human evidence`.

- [ ] **Step 1: Add human-separation RED tests**

Extend the projected and explicit assessment tests:

```tsx
expect(screen.getByRole("region", { name: "Human assessment" })).toBeVisible();
expect(screen.getByText("Reviewer-authored judgment, separate from system evidence.")).toBeVisible();
expect(document.querySelector(".run-detail-header .assessment-editor")).toBeNull();
expect(document.querySelector(".terminal-evidence-dock .assessment-workflow")).not.toBeNull();
```

For projected state, assert the station contains `Not reviewed · projected state · no human evidence` and does not render a human provenance mark. For explicit state, assert `Human evidence` is visible next to the timestamped assessment.

- [ ] **Step 2: Run RED**

```bash
pnpm vitest --run apps/web/test/runHeader.test.tsx apps/web/test/assessment.test.tsx apps/web/test/accessibility.test.tsx
```

Expected: the named human region and terminal-dock placement do not exist.

- [ ] **Step 3: Implement the human assessment station**

Pass `onAssessmentSaved` from `RunDetailPage` into `RunWorkspace`, then into `TerminalEvidenceDock`. Compose `AssessmentSummary` and `AssessmentEditor` there under a visible Human label and boundary copy. Keep the Git station and Human station as separate sibling regions with different labels and accent tokens.

Use the human provenance color sparingly: a small marker, one border rule, selected radio state, and focus-adjacent emphasis. Remove pill-heavy styling from the editor; use compact segmented controls with 4-5 px radii. Keep clear legends, radio inputs, note help, errors, conflict panel, pending state, success copy, and focus restoration.

- [ ] **Step 4: Run GREEN and mutation regressions**

```bash
pnpm vitest --run apps/web/test/runHeader.test.tsx apps/web/test/assessment.test.tsx apps/web/test/accessibility.test.tsx apps/web/test/eventInspector.test.tsx
pnpm build
pnpm exec playwright test --config apps/web/playwright.config.ts apps/web/e2e/assessment.spec.ts apps/web/e2e/evidence.spec.ts apps/web/e2e/flight-console.spec.ts --grep "assessment|human"
pnpm typecheck
```

Expected: one deliberate save still appends exactly one human event, uses current `If-Match`, selects only the confirmed returned event, preserves draft/conflict behavior, and returns focus to the editor trigger. Human and Git/System evidence remain visually and semantically separate.

- [ ] **Step 5: Review and commit**

```bash
git diff --check
git diff -- apps/web/src/run-detail apps/web/src/assessment apps/web/src/styles/run-detail.css apps/web/src/styles/assessment.css apps/web/test/runHeader.test.tsx apps/web/test/assessment.test.tsx apps/web/test/accessibility.test.tsx apps/web/e2e/assessment.spec.ts apps/web/e2e/flight-console.spec.ts
git add apps/web/src/run-detail/TerminalEvidenceDock.tsx apps/web/src/run-detail/RunWorkspace.tsx apps/web/src/run-detail/RunDetailPage.tsx apps/web/src/run-detail/RunHeader.tsx apps/web/src/assessment/AssessmentEditor.tsx apps/web/src/assessment/AssessmentSummary.tsx apps/web/src/styles/run-detail.css apps/web/src/styles/assessment.css apps/web/test/runHeader.test.tsx apps/web/test/assessment.test.tsx apps/web/test/accessibility.test.tsx apps/web/e2e/assessment.spec.ts apps/web/e2e/flight-console.spec.ts
git commit -m "style(web): separate human assessment evidence"
```

---

### Task 9: Freeze a restrained motion language and reduced-motion contract

**Files:**
- Create: `apps/web/test/motionPolicy.test.tsx`
- Modify: `apps/web/src/app/App.tsx`
- Modify: `apps/web/src/motion/motionPolicy.ts`
- Modify: `apps/web/src/trajectory/Trajectory.tsx`
- Modify: `apps/web/src/trajectory/TrajectoryRow.tsx`
- Modify: `apps/web/src/trajectory/RelationshipOverlay.tsx`
- Modify: `apps/web/src/run-detail/EventInspector.tsx`
- Modify: `apps/web/src/run-detail/DeepEvidencePanel.tsx`
- Modify: `apps/web/src/styles/trajectory.css`
- Modify: `apps/web/src/styles/evidence.css`
- Modify: `apps/web/test/trajectory.test.tsx`
- Modify: `apps/web/test/accessibility.test.tsx`
- Modify: `apps/web/e2e/trajectory.spec.ts`

**Interfaces:**
- Standard tweens: selection 120-140 ms, inspector 150-170 ms, lifecycle 180-200 ms, Git-mode surface 160-180 ms.
- Use an ease-out cubic Bézier such as `[0.22, 1, 0.36, 1]`; never use spring configuration.
- Under reduced motion, every policy duration is `0`, Motion receives `reducedMotion="user"`, CSS transitions become zero, and scroll behavior is `auto`.
- Active arrival animation applies only to the singleton `new events` control, never to all appended rows.

- [ ] **Step 1: Add motion-policy RED tests**

Create tests that stub `matchMedia`, render a small consumer, and assert:

```tsx
expect(motionDurations).toEqual({
  selectionMs: 130,
  inspectorMs: 160,
  lifecycleMs: 190,
  surfaceMs: 170
});
expect(screen.getByTestId("motion-policy")).toHaveTextContent("130:160:190:170");
```

Toggle the media query and assert `0:0:0:0`. Extend trajectory tests to ensure rows use `initial={false}` behavior and expanded lifecycle is the only row-size animation.

- [ ] **Step 2: Run RED**

```bash
pnpm vitest --run apps/web/test/motionPolicy.test.tsx apps/web/test/trajectory.test.tsx apps/web/test/accessibility.test.tsx
```

Expected: the surface duration/easing contract and MotionConfig are absent.

- [ ] **Step 3: Implement functional motion only**

Wrap the application in `MotionConfig reducedMotion="user"`. Return named transitions with explicit `type: "tween"` and the shared easing. Apply them to selected border/node emphasis, the inspector body, expanded lifecycle members, selected relationship connector opacity, the singleton new-event control, and Git-mode content. Every motion component uses `initial={false}`.

Do not animate page load, ledger rows, ordinary trajectory layout, inspector outer geometry, diff lines, evidence text, or scrolling. Remove any remaining default layout transition from selected rows. Keep CSS reduced-motion coverage for all affected classes.

- [ ] **Step 4: Run GREEN and reduced-motion browser checks**

```bash
pnpm vitest --run apps/web/test/motionPolicy.test.tsx apps/web/test/trajectory.test.tsx apps/web/test/eventInspector.test.tsx apps/web/test/accessibility.test.tsx
pnpm build
pnpm exec playwright test --config apps/web/playwright.config.ts apps/web/e2e/trajectory.spec.ts apps/web/e2e/flight-console.spec.ts --grep "reduced motion|selection|inspector"
pnpm typecheck
```

Expected: standard motion is at most 200 ms, reduced motion reports zero-duration policy, no page entrance runs, and selection/inspector geometry remains within the one-pixel stability gate.

- [ ] **Step 5: Review dependencies and commit**

```bash
git diff --check
git diff -- package.json pnpm-lock.yaml apps/web/package.json
git diff -- apps/web/src/app/App.tsx apps/web/src/motion apps/web/src/trajectory apps/web/src/run-detail apps/web/src/styles apps/web/test/motionPolicy.test.tsx apps/web/test/trajectory.test.tsx apps/web/test/accessibility.test.tsx apps/web/e2e/trajectory.spec.ts
```

Expected: `package.json`, `apps/web/package.json`, and `pnpm-lock.yaml` have no diff.

Commit:

```bash
git add apps/web/src/app/App.tsx apps/web/src/motion/motionPolicy.ts apps/web/src/trajectory/Trajectory.tsx apps/web/src/trajectory/TrajectoryRow.tsx apps/web/src/trajectory/RelationshipOverlay.tsx apps/web/src/run-detail/EventInspector.tsx apps/web/src/run-detail/DeepEvidencePanel.tsx apps/web/src/styles/trajectory.css apps/web/src/styles/evidence.css apps/web/test/motionPolicy.test.tsx apps/web/test/trajectory.test.tsx apps/web/test/accessibility.test.tsx apps/web/e2e/trajectory.spec.ts
git commit -m "style(web): constrain Flight Console motion"
```

---

### Task 10: Complete wide, laptop, and 800 px responsive behavior

**Files:**
- Modify: `apps/web/src/styles/shell.css`
- Modify: `apps/web/src/styles/run-list.css`
- Modify: `apps/web/src/styles/run-detail.css`
- Modify: `apps/web/src/styles/trajectory.css`
- Modify: `apps/web/src/styles/evidence.css`
- Modify: `apps/web/src/styles/assessment.css`
- Modify: `apps/web/src/styles/responsive.css`
- Modify: `apps/web/test/runList.test.tsx`
- Modify: `apps/web/test/eventInspector.test.tsx`
- Modify: `apps/web/test/accessibility.test.tsx`
- Modify: `apps/web/e2e/run-list.spec.ts`
- Modify: `apps/web/e2e/trajectory.spec.ts`
- Modify: `apps/web/e2e/flight-console.spec.ts`

**Responsive contract:**
- `>= 1101 px`: 56 px rail, 46 px top bar, flat wide ledger, trajectory plus 360-380 px fixed inspector, full-width terminal dock/Git mode.
- `801-1100 px`: compact shell, two-column ledger facts, trajectory plus 320-340 px inspector, smaller gutters, no semantic omission.
- `<= 800 px`: horizontal shell, one-column workspace, selected inline inspector anchored to the selected virtual row, stacked terminal evidence, full-width Git mode, 44 px touch controls.
- `<= 520 px`: robust one-column fallback; phone-first redesign remains out of scope, but no fact or control disappears.

- [ ] **Step 1: Strengthen responsive RED assertions**

For every viewport `{1440,1000}`, `{1100,900}`, and `{800,900}`, assert all of these strings remain visible on at least one ledger/detail fixture: lifecycle, likely tests, human review, Final Git evidence, warning/contradiction where present, and an explicit provenance label.

At 800 px assert:

```ts
await expect(page.locator(".trajectory-inspector")).toHaveCount(0);
await expect(page.getByTestId("inline-event-inspector")).toBeVisible();
await expect(page.getByRole("region", { name: "Human assessment" })).toBeVisible();
await expectNoHorizontalOverflow(page);
```

At 1100 px assert the inspector remains to the right by comparing bounding boxes, not by checking a class alone.

- [ ] **Step 2: Run RED**

```bash
pnpm vitest --run apps/web/test/runList.test.tsx apps/web/test/eventInspector.test.tsx apps/web/test/accessibility.test.tsx
pnpm build
pnpm exec playwright test --config apps/web/playwright.config.ts apps/web/e2e/run-list.spec.ts apps/web/e2e/trajectory.spec.ts apps/web/e2e/flight-console.spec.ts
```

Expected: new terminal-dock and measured-layout assertions expose unfinished breakpoint rules.

- [ ] **Step 3: Implement responsive reflow without semantic hiding**

Keep all breakpoint behavior in the final-imported `responsive.css`; component styles define only defaults. Reduce spacing/gutters before changing layout. At 800 px switch the shell and workspace, allow the existing inline inspector measurement to own row height, stack Git/Human stations, and constrain horizontal code scrolling to the evidence viewport.

Do not use `display: none` for content-bearing lifecycle, test, assessment, Git, warning, provenance, or availability elements. Hiding decorative column guides, decorative marks, or duplicated chrome words is allowed when accessible names remain.

- [ ] **Step 4: Run GREEN across the responsive matrix**

```bash
pnpm vitest --run apps/web/test/runList.test.tsx apps/web/test/eventInspector.test.tsx apps/web/test/accessibility.test.tsx apps/web/test/trajectory.test.tsx
pnpm build
pnpm exec playwright test --config apps/web/playwright.config.ts apps/web/e2e/run-list.spec.ts apps/web/e2e/trajectory.spec.ts apps/web/e2e/evidence.spec.ts apps/web/e2e/assessment.spec.ts apps/web/e2e/flight-console.spec.ts
pnpm typecheck
```

Expected: all three viewports preserve critical evidence, 800 px inline selection remains inside the selected virtual row, and no page has horizontal overflow.

- [ ] **Step 5: Review and commit**

```bash
git diff --check
git diff -- apps/web/src/styles apps/web/test/runList.test.tsx apps/web/test/eventInspector.test.tsx apps/web/test/accessibility.test.tsx apps/web/e2e/run-list.spec.ts apps/web/e2e/trajectory.spec.ts apps/web/e2e/flight-console.spec.ts
git add apps/web/src/styles/shell.css apps/web/src/styles/run-list.css apps/web/src/styles/run-detail.css apps/web/src/styles/trajectory.css apps/web/src/styles/evidence.css apps/web/src/styles/assessment.css apps/web/src/styles/responsive.css apps/web/test/runList.test.tsx apps/web/test/eventInspector.test.tsx apps/web/test/accessibility.test.tsx apps/web/e2e/run-list.spec.ts apps/web/e2e/trajectory.spec.ts apps/web/e2e/flight-console.spec.ts
git commit -m "style(web): finish responsive Flight Console layouts"
```

---

### Task 11: Harden focus, keyboard, contrast, and compact target accessibility

**Files:**
- Modify: `apps/web/test/accessibility.test.tsx`
- Modify: `apps/web/e2e/accessibility.spec.ts`
- Modify: `apps/web/e2e/flight-console.spec.ts`
- Modify only if the new gates fail: `apps/web/src/styles/tokens.css`, `shell.css`, `run-list.css`, `run-detail.css`, `trajectory.css`, `evidence.css`, `assessment.css`
- Modify only if the new gates fail: `AppShell.tsx`, `RunRow.tsx`, `RunEvidenceStrip.tsx`, `EventInspector.tsx`, `DeepEvidencePanel.tsx`, `TerminalEvidenceDock.tsx`

**Accessibility contract:**
- One `<main>` landmark; named navigation, ledger, evidence summary, trajectory, inspector, Git mode, and Human assessment regions.
- Provenance/status never rely on color alone; text and shapes remain.
- Desktop interactive targets are at least 32 px high; controls at 800 px are at least 44 px high.
- Focus is never lost to `BODY` after breakpoint changes, assessment conflict replacement, inspector transitions, or Git mode close.
- Focus rings meet 3:1 non-text contrast; body/evidence text meets WCAG AA for its rendered size.

- [ ] **Step 1: Add keyboard/target/region RED or characterization tests**

Extend unit accessibility tests to assert named regions and that hidden Git/trajectory modes do not both remain in the accessibility tree. Extend Playwright accessibility coverage to:

1. Tab from shell navigation to the first ledger row and activate it.
2. Use ArrowDown, Enter, Home, and End in the trajectory.
3. Switch inspector tabs without moving the inspector frame.
4. Open Git mode, close with Escape, and verify exact trigger focus.
5. Open/cancel assessment and verify exact trigger focus.
6. Measure visible button/input/select/link heights at desktop and 800 px.

- [ ] **Step 2: Run the strengthened gates**

```bash
pnpm vitest --run apps/web/test/accessibility.test.tsx apps/web/test/runList.test.tsx apps/web/test/eventInspector.test.tsx apps/web/test/assessment.test.tsx
pnpm build
pnpm exec playwright test --config apps/web/playwright.config.ts apps/web/e2e/accessibility.spec.ts apps/web/e2e/flight-console.spec.ts --grep "accessibility|keyboard|targets"
```

Expected: use failures as concrete evidence. Do not loosen axe severity, selector scope, geometry minimums, or focus expectations.

- [ ] **Step 3: Apply only proven accessibility corrections**

Correct accessible names/relationships in the owning component and contrast/target geometry in the owning stylesheet. Do not add ARIA that duplicates native semantics. Do not animate focus, auto-focus ordinary selection, or trap focus in non-modal Git mode.

- [ ] **Step 4: Run GREEN and full keyboard regression**

```bash
pnpm vitest --run apps/web/test/accessibility.test.tsx apps/web/test/trajectory.test.tsx apps/web/test/eventInspector.test.tsx apps/web/test/assessment.test.tsx
pnpm build
pnpm exec playwright test --config apps/web/playwright.config.ts apps/web/e2e/accessibility.spec.ts apps/web/e2e/trajectory.spec.ts apps/web/e2e/assessment.spec.ts apps/web/e2e/flight-console.spec.ts
pnpm typecheck
```

Expected: zero serious/critical axe violations in ledger, trajectory/inspector, Git, and assessment states; all focus and target assertions pass.

- [ ] **Step 5: Review and commit**

```bash
git diff --check
git diff -- apps/web/test/accessibility.test.tsx apps/web/e2e/accessibility.spec.ts apps/web/e2e/flight-console.spec.ts apps/web/src
git add apps/web/test/accessibility.test.tsx apps/web/e2e/accessibility.spec.ts apps/web/e2e/flight-console.spec.ts
git add -u apps/web/src
git commit -m "test(web): harden Flight Console accessibility"
```

Before committing, inspect `git diff --cached --name-only` and unstage any production file that was not required by a failing accessibility gate.

---

### Task 12: Run the complete visual, performance, privacy, and E2E release gate

**Files:**
- Modify: `apps/web/e2e/flight-console.spec.ts`
- Create: `docs/verification/2026-09-03-agentlens-flight-console.md`

**Interfaces:**
- Keep Playwright's repository configuration `screenshot: "off"`; explicit review captures are attached from the test and remain under the temporary `outputDir`.
- Use only existing fixtures: lifecycle/status variety from the run ledger; `fixture-completed-recovery` for failed command, derived test result, recorder recovery, Git diff, and explicit assessment; `fixture-running` for active state; `fixture-trajectory-1000` for long-trace bounds; metadata-only/strict fixtures for unavailable evidence.

- [ ] **Step 1: Add temporary screenshot attachments and state matrix**

Use a helper inside `flight-console.spec.ts`:

```ts
async function attachViewport(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true, animations: "disabled" }),
    contentType: "image/png"
  });
}
```

Attach sanitized images for:

- 1440 x 1000 ledger;
- 1100 x 900 ledger and trajectory/inspector;
- 800 x 900 ledger and selected inline inspector;
- compact 50-event trajectory;
- 1,000-event trajectory after paging;
- grouped lifecycle collapsed and expanded;
- failed command plus derived likely-test evidence;
- recorder recovery;
- full-width tracked diff;
- projected and explicit human assessment;
- active run before and after append;
- loading, API error, unavailable/omitted, empty diff, and malformed/corrupt evidence states using existing unit fixtures or controlled same-origin Playwright responses.

Do not add permanent screenshot baselines in this task.

- [ ] **Step 2: Run focused Flight Console browser validation**

```bash
pnpm build
pnpm exec playwright test --config apps/web/playwright.config.ts apps/web/e2e/flight-console.spec.ts
```

Expected: all geometry, density, overflow, target, state, and focus assertions pass with temporary attachments available for inspection.

- [ ] **Step 3: Inspect every capture at native scale**

Check the actual images, not only test status. Record pass/fail for hierarchy, clipping, text wrapping, row density, selected evidence, stable inspector, provenance distinction, Git readability, human distinction, focus visibility, and reduced-motion state. Fix any observed defect in the owning earlier task boundary and rerun its focused unit/browser tests before proceeding.

- [ ] **Step 4: Prove no performance or request-boundary regression**

Run:

```bash
pnpm vitest --run apps/web/test/activePolling.test.tsx apps/web/test/trajectory.test.tsx apps/web/test/trajectoryPages.test.tsx apps/web/test/gitDiffViewer.test.tsx apps/web/test/apiClient.test.ts
pnpm build
pnpm exec playwright test --config apps/web/playwright.config.ts apps/web/e2e/trajectory.spec.ts apps/web/e2e/active-run.spec.ts apps/web/e2e/privacy.spec.ts
```

Required observations:

- 1,000 events still mount fewer than 30 rows;
- page append keeps the visible anchor within one pixel;
- selecting an event does not move the inspector or adjacent rows by more than one pixel;
- no new eager detail/content/native/Git request is introduced;
- active polling remains one second with current retry/terminal behavior;
- Git viewer remains globally bounded;
- no external request, browser secret, privacy sentinel, or unconsumed request appears.

- [ ] **Step 5: Run the full release matrix**

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm test:e2e
git diff --check
git status --short
```

Record exact test counts, exits, Vite CSS/JS sizes, browser counts, and any advisory in `docs/verification/2026-09-03-agentlens-flight-console.md`. Compare JavaScript gzip size with the Task 7 baseline of 155.05 kB; absent a reviewed reason, reject growth greater than 5 KiB because this plan adds no dependency or data behavior.

- [ ] **Step 6: Verify the protected prototype and changed-file scope**

```bash
git status --short design-prototypes
git diff --name-only 1aebc25e -- design-prototypes
git diff --name-only 1aebc25e
```

Expected: the prototype has no tracked diff and remains only the pre-existing untracked directory; changed files are limited to this plan's web/tests/verification scope.

- [ ] **Step 7: Commit the verification record**

```bash
git add apps/web/e2e/flight-console.spec.ts docs/verification/2026-09-03-agentlens-flight-console.md
git commit -m "test(web): verify the Flight Console redesign"
```

Do not begin Task 13 unless this commit records a fully green production/browser matrix and inspected screenshots.

---

### Task 13: Replace README concept framing with verified production imagery

**Files:**
- Create: `docs/assets/agentlens-flight-console-ledger.png`
- Create: `docs/assets/agentlens-flight-console-trajectory.png`
- Modify: `README.md`

**Interfaces:**
- Capture only the deterministic path-neutral fixture UI after Task 12.
- Keep `docs/assets/agentlens-header.svg` and the old concept image unchanged.
- README copy may claim only functionality directly verified in Task 12.

- [ ] **Step 1: Capture sanitized production frames**

Use Playwright page screenshots, not browser-window screenshots, at 1440 x 1000. Capture the ledger and a selected failed-command trajectory with the stable inspector. Ensure no URL bar, bootstrap token, full local path, uncontrolled native payload, or real user run appears.

Write the approved captures to:

```text
docs/assets/agentlens-flight-console-ledger.png
docs/assets/agentlens-flight-console-trajectory.png
```

- [ ] **Step 2: Inspect assets before editing README**

```bash
file docs/assets/agentlens-flight-console-ledger.png docs/assets/agentlens-flight-console-trajectory.png
sips -g pixelWidth -g pixelHeight docs/assets/agentlens-flight-console-ledger.png docs/assets/agentlens-flight-console-trajectory.png
```

Open both at native scale and verify legibility, no clipping, synthetic evidence only, and no browser/auth material.

- [ ] **Step 3: Update README truthfully**

Replace the outdated “UI concept preview / CLI remains the current interface” block with a production Flight Console section containing the two screenshots and concise captions. Update the production UI status row and roadmap wording from “in progress/next” to the state proven by Task 12. Preserve evidence-boundary warnings and do not invent providers, commands, metrics, users, adoption, or results.

- [ ] **Step 4: Verify docs and source remain clean**

```bash
rg -n "UI concept preview|Task 7 — in progress|CLI remains the current interface|Polished local UI and dogfooding — next" README.md
git diff --check
git diff -- README.md docs/assets
git status --short design-prototypes
```

Expected: outdated copy has no matches, both new assets are referenced, and `design-prototypes/` remains untouched.

- [ ] **Step 5: Commit README only after stable production proof**

```bash
git add README.md docs/assets/agentlens-flight-console-ledger.png docs/assets/agentlens-flight-console-trajectory.png
git commit -m "docs: show the production Flight Console"
```

---

## Test Strategy by Risk

| Risk | Primary automated evidence | Required browser observation |
| --- | --- | --- |
| Evidence wording or semantics drift | `runList`, `runHeader`, `eventInspector`, `assessment`, `gitDiffViewer` Vitest suites | Compare failed command, derived test, recorder, Git, and human labels |
| Event order/grouping/selection drift | `trajectory`, `projectTrajectory`, `trajectoryPages`, `mergePages`; 1,000-event Playwright journey | Confirm temporal order and selected event identity |
| Virtualization/performance regression | mounted rows `<30`, 10 exact cursor pages, visible anchor delta `<=1 px` | Scroll long fixture before/after paging and selection |
| Inspector physical instability | Playwright bounding-box equality across event/tab changes | Watch several selections with short and long content |
| Git mode state/focus loss | Git viewer unit bounds plus evidence/Flight Console E2E | Open a file, page evidence, close, and confirm trajectory/trigger state |
| Human judgment conflation | assessment and accessibility unit tests; assessment E2E mutation count | Confirm projected and explicit states look different from system truth |
| Responsive semantic loss | run-list, trajectory, evidence, assessment E2E at 1440/1100/800 | Inspect all critical facts and overflow at each width |
| Motion/accessibility regression | motion-policy unit tests, reduced-motion E2E, axe, keyboard paths | Confirm no bounce/entrance/shift and visible focus |
| Security/privacy/request regression | unchanged privacy, browser guard, request lifecycle, active-run suites | Confirm no new network or eager evidence requests |

## Visual Acceptance Gates

- **Desktop ledger:** one integrated flat ledger; filters read as its control strip; at least six complete representative rows fit in 1440 x 1000; no KPI cards, row lift, large radius, or decorative gradient.
- **Desktop detail:** 9-13 ordinary trajectory events intersect the 1440 x 1000 trajectory viewport; selected event is unmistakable through node, rule, and ink; adjacent row y-position changes by at most 1 px on ordinary selection.
- **Inspector:** outer x, y, width, and height change by at most 1 px across event and tab changes; only its inner content scrolls/transitions.
- **Git:** tracked diff owns at least 90% of the content-frame width; line numbers and code remain readable; horizontal overflow stays inside the code viewport; close/Escape returns to the same trajectory state and exact trigger.
- **Human assessment:** explicit human provenance and boundary copy are visible; projected state says no human evidence; styling never implies a human verdict was observed, derived, provider-native, recorder, or Git truth.
- **Motion:** all functional tweens are 200 ms or less, have no bounce/overshoot, and do not reorder or resize ordinary evidence; reduced motion uses zero-duration policy and automatic scroll behavior.
- **Responsive:** 1100 px keeps the side inspector; 800 px uses selected-row inline inspection; lifecycle, likely tests, review, Git, provenance, warnings, and availability never disappear; no document-level horizontal overflow.
- **States:** loading, empty, API error, authentication expired, unavailable, omitted, unreadable/corrupt, active, failed, interrupted, recorder recovery, grouped lifecycle, Git diff, and assessment conflict/success remain legible and semantically accurate.

## Performance Risks and Controls

- **Compact estimate mismatch:** an underestimate can cause virtual overlap or anchor drift. Keep ResizeObserver measurement, update only the default estimate, rerun wrapped/grouped/around-window tests, and preserve the one-pixel anchor gate.
- **Selection-driven remeasurement:** selected-only content or border changes can move later rows. Keep selection paint-only and move relationship affordances out of flow.
- **Per-row Motion cost:** 1,000-event traces can still churn if every mounted row animates. No entry/append animation on rows; only selected paint, one expanded group, one connector overlay, and one new-event control may move.
- **Hidden trajectory during Git mode:** unmounting would lose scroll/virtual state. Keep it mounted with a hidden wrapper and verify return state.
- **Inspector content churn:** keyed transitions can refetch or reset tabs if identity ownership changes. Keep queries and `EventInspectorSession` untouched; transition the rendered body only.
- **Bundle growth:** no new dependencies; reject unexplained JavaScript gzip growth above 5 KiB from the 155.05 kB Task 7 baseline.
- **Diff width:** full width must not remove DOM bounds. Keep the existing line/file/hunk/structure budgets and internal horizontal scroll.

## Accessibility Risks and Controls

- **Muted graphite contrast:** validate text/focus/status tokens in the actual browser with axe and visual inspection; do not solve density by making essential text too dim or too small.
- **Color-only provenance:** retain textual provenance names plus distinct node/mark shapes everywhere color is used.
- **Compact targets:** keep 32 px desktop controls and 44 px controls at 800 px; measure actual rendered boxes.
- **CSS visual order:** do not make reading/focus order diverge from logical evidence order when building desktop scan columns.
- **AnimatePresence announcements:** do not wrap the outer region or tabs in keyed motion; keep stable labels and animate only the body.
- **Git-mode hiding:** the non-active trajectory wrapper must be absent from the accessibility tree and non-focusable while Git is visible.
- **Breakpoint focus:** preserve the existing exact-control restoration logic and add Git trigger/assessment trigger coverage.
- **Clamped summaries:** keep complete text in the DOM/accessible row name and stable inspector; never replace evidence with a visually shortened string.

## Dependency Decision

No new dependency is approved or needed.

- Motion for React already supplies reduced-motion-aware tweens, `AnimatePresence`, and the one intentional lifecycle size transition.
- TanStack Virtual already supplies measured bounded rows; replacing it would be a performance and semantics risk.
- Geist Sans/Mono are already bundled locally and match the technical direction.
- CSS supplies the mark, graphite system, grid, focus, responsive behavior, and code surfaces.
- Anime.js would duplicate Motion and encourage the rejected ignition choreography.
- 21st.dev patterns may be consulted visually, but importing a primitive or package is unnecessary for these focused components.

## Responsive Strategy

Implement desktop defaults first, then medium compression, then 800 px reflow. The semantic DOM is constant across widths; CSS changes placement. Run detail retains one selected inspector instance that moves between fixed right column and selected-row inline anchor through the existing responsive ownership logic. Git is full-width at every size. The terminal dock is two columns on wide screens and stacked at 800 px. Code/diff surfaces own horizontal scrolling; the page never does.

## Estimated Implementation Sequence and Review Checkpoints

1. **Foundation checkpoint:** Tasks 1-4 produce the graphite system, compact shell, flat ledger, and compact run header. Review ledger and header at 1440/1100/800 before trajectory work.
2. **Signature interaction checkpoint:** Tasks 5-6 produce the dense trajectory and stable inspector. Review real selection, long content, grouped lifecycle, relationships, and 1,000-event behavior before Git work.
3. **Evidence-boundary checkpoint:** Tasks 7-8 create full-width Git and separate human assessment. Review provenance boundaries, focus return, diff readability, and one real fixture mutation.
4. **Polish checkpoint:** Tasks 9-11 freeze motion, responsive behavior, keyboard/focus, contrast, and targets. No broad visual changes after this checkpoint.
5. **Release checkpoint:** Task 12 runs the complete unit/build/browser/privacy/performance matrix and records inspected temporary captures.
6. **Documentation checkpoint:** Task 13 alone adds sanitized production screenshots and updates README claims.

The critical path is `1 -> 2 -> 3 -> 4 -> 5 -> 6 -> 7 -> 8 -> 9 -> 10 -> 11 -> 12 -> 13`. Each task ends in one scoped commit. Review should pause after Tasks 4, 6, 8, and 12.

## Exact Plan Path

`docs/superpowers/plans/2026-09-03-agentlens-flight-console-redesign.md`
