# Guided execution graph implementation plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the compact event rows with the approved physically stable guided graph, exact evidence branches, adjacent clarification, and preserved raw inspector.

**Spec:** `docs/superpowers/specs/2026-09-05-guided-execution-graph.md`

**Architecture:** A pure presentation projection wraps the existing canonical event/lifecycle projector. Semantic graph nodes and non-interactive SVG render virtual vertical regions. A reserved adjacent clarification lane shares selection identity with the existing inspector. URL initial-focus logic consumes existing run anchors, never new server inference.

**Tech stack:** React/TypeScript, existing TanStack virtualizer and query client, Motion, CSS tokens, Vitest and Playwright. No new dependencies.

## Global Constraints

- Work only in `/Users/chaitanyamatrubai/Agent lens/.worktrees/agentlens-flight-console` on `codex/agentlens-flight-console`. Keep main and `design-prototypes/` untouched. No merge/push.
- This graph correction is inserted after old Task 6 and supersedes uniform 68px row density; old later tasks remain pending. Stop for visual review after all four tasks below, not between them.
- Preserve DTO/API/storage/CLI contracts, exact immutable event identity, pagination, invalid link states, run-scoped selection and explicit raw/native/note/Git loading. No inferred causal branch or generated explanation.
- Keep semantic DOM targets with non-interactive SVG; clarification and raw inspector controls outside the listbox. Preserve keyboard access to every grouped event and existing Escape/focus restoration.
- Desktop selection must not change node coordinates. Narrow views retain graph/path and inline evidence. Honor reduced motion and bounded virtualization. No animation or new data fetch caused solely by clarification mount.
- Each task uses TDD for behavioral changes, targeted regression runs while iterating, one relevant broader test run before its commit, and a fresh task review. Controller performs final cumulative suite/typecheck/build/browser verification.

## File responsibility map

- New `apps/web/src/trajectory/graphTypes.ts`: graph projection types only.
- New `apps/web/src/trajectory/projectExecutionGraph.ts`: pure regions, exact edges, safe clusters and geometry hints.
- Existing `projectTrajectory.ts`, `types.ts`, `relationships.ts`: preserve lifecycle/domain helper contracts; use without changing unless tests identify an actual necessary compatibility issue.
- New `ExecutionNode.tsx`, `NodeClarification.tsx`, `ExecutionGraphEdges.tsx`: semantic node presentation/actions, bounded clarification, pointer-free sequence/relationship paths respectively.
- Existing `Trajectory.tsx`: virtual region integration, focus, viewport stability, clarification placement.
- Existing `RunWorkspace.tsx`: inspector focus integration and narrow placement, minimal copy adjustment.
- Existing `styles/trajectory.css`, `styles/run-detail.css`, `styles/responsive.css`: replace row styling/geometry, retain console tokens. New graph CSS may be isolated into `styles/execution-graph.css` and imported from existing CSS entry if it makes responsibility clearer.
- New `initialGraphSelection.ts`, existing `RunDetailPage.tsx`: one-time server-anchor initial selection.
- Tests: `projectExecutionGraph.test.ts`, `trajectory.test.tsx`, `graphSelection.test.tsx`, existing focused inspector/polling/accessibility tests, `e2e/execution-graph.spec.ts`, fixtures and existing trajectory/flight-console browser assertions.

### Task 1: Pure graph regions, safe clusters, and recorded edges

**Files:** Create `apps/web/src/trajectory/graphTypes.ts`, `apps/web/src/trajectory/projectExecutionGraph.ts`, `apps/web/test/projectExecutionGraph.test.ts`.

- [ ] Add failing tests using valid `TrajectoryEventV1` factories like `projectTrajectory.test.ts`. Assert no mutation; increasing sequence validation; routine/action/landmark weights; failure/recovery/test/Git/human/unknown preservation; loaded incoming/outgoing relationship endpoints not collapsed; exact lifecycle pair reuse; clusters 3–6 completed observed message/reasoning events only; stable immutable keys and expand/member identity; no provenance-only branch; exact directional deduplication; off-window/self/backward relationship handling; deterministic output unaffected by selection (selection is not an input).
- [ ] Implement and export `projectExecutionGraph({ events, expandedGroupKeys, clusterRoutine?: boolean }): ExecutionGraph`. Default clusterRoutine true. Reuse `projectTrajectory` validation/compatible lifecycle groups but split any lifecycle group containing a failure or relationship endpoint into immutable single-event regions. Routine groups use stable first-member identity keys, at most six members, never span nonconsecutive sequence gaps or differing presentation classes. Preserve selected member access in the consumer rather than changing projection on selection.
- [ ] Export interfaces: `ExecutionGraph { nodes: readonly ExecutionGraphNode[]; edges: readonly ExecutionGraphEdge[]; eventNodeIndex: ReadonlyMap<string, number> }`; `ExecutionGraphNode { key: string; type: 'event'|'lifecycle_group'|'routine_cluster'; events: readonly TrajectoryEventV1[]; expanded: boolean; weight: 'routine'|'action'|'landmark'; lane: 0|1; estimatedHeight: number }`; `ExecutionGraphEdge { key: string; sourceEventId: string; targetEventId: string; type: TrajectoryEventV1['relationships'][number]['type']; sourceNodeIndex: number; targetNodeIndex: number|null }`.
- [ ] Edges express each recorded event's relationship TO target exactly as DTO, dedup by source/type/target, retain missing target null, ignore self edge for drawing but preserve original DTO for textual inspector. `lane=1` only for the source of an exact loaded relationship that references an earlier node; no provenance-only lane assignment. Use bounded two-lane hints, not recursive layout. Default estimates routine128/action160/landmark184; expanded regions add member space. Geometry hints are UI presentation only.
- [ ] Run `pnpm exec vitest run apps/web/test/projectExecutionGraph.test.ts apps/web/test/projectTrajectory.test.ts` RED then GREEN, `pnpm --filter @agentlens/web typecheck` if script exists (otherwise root `pnpm typecheck`), self-review and commit `feat(web): project evidence-grounded execution graph regions`.

### Task 2: Spatial graph, adjacent clarification, and stable navigation

**Files:** Create `ExecutionNode.tsx`, `NodeClarification.tsx`, `ExecutionGraphEdges.tsx`; modify `Trajectory.tsx`, `RunWorkspace.tsx`, relevant CSS from responsibility map, `apps/web/test/trajectory.test.tsx`; add focused component test file if separation helps. Legacy `TrajectoryRow.tsx`/`RelationshipOverlay.tsx` may remain unused until graph correctness is verified; do not broaden refactor.

- [ ] Read Task 1 exported contract and approved visual reference. Add failing component tests for selected adjacent summary/provenance and no raw-content request; persistent exact edge while selecting unrelated event; semantic grouped member access/expansion; branch navigation; selected/focused pinning; narrow clarification/inspector outside listbox.
- [ ] Replace compact row rendering using Task 1 nodes. Render bounded-width cards with hierarchy and compact metadata, small sequence/shape markers, real spaced connecting backbone, and curved separate exact relationship routes. SVG is aria-hidden/pointer-events none. Keep existing role option/data-event-id/data-sequence hooks for exact selection tests; introduce data-graph-node/weight/lane and data-graph-edge/source/target hooks for graph assertions. Do not keep visible full-width timestamp rows.
- [ ] Provide an accessible `Group routine events` checkbox/switch above the graph, enabled initially, controlling only pure presentation clustering. Disabling it exposes all routine event regions without changing selected event identity, fetched pages, or evidence. This supports deliberate detailed traversal and the unchanged 1000-event pagination regression contract.
- [ ] Keep the virtualizer and use node estimates/actual measurements, stable key maps, selected/focus pinning plus at most four immediate selected relationship endpoints and immediate neighbors. All loaded edges remain projected; only draw paths intersecting mounted/visible regions, use explicit offscreen endpoint labels. Preserve the existing event-anchor/offset restore and follow-tail hook. Resolve first/last/member identity through eventNodeIndex.
- [ ] Render clarification once outside listbox as a positioned sibling beside selected region on wide layout, below selected node where lateral width is insufficient. Reserve lane before selection so cards/path never reflow on desktop. Expose factual summary, status, provenance, sequence/time, and relationship navigation; no raw fetch. Keep existing EventInspector and deep panel as source of raw controls. Measure inline clarification/raw space and reserve it in the selected region only on narrow layouts.
- [ ] Implement keyboard: Up/Down and Home/End projected-node traversal, Enter/Space selected immutable event; Left/Right follow exact loaded outgoing/incoming branch context, with documented Alt+Left/Right cycling lifecycle/cluster actions and Enter invoking them. Expose grouped actions in clarification outside listbox as real buttons too. Preserve existing pointer and keyboard jump to unloaded relationship via onRelationshipJump, Escape, roving focus, and breakpoint focus restoration. Keep selected visible node stationary; align newly offscreen deliberate selection near upper third without scrolling after every append.
- [ ] Use existing Motion policy <=200ms reveal, instantaneous reduced motion; no desktop layout animation, repeating effects, or expensive new package. CSS at 1440/1024/768/390 must retain node path and no horizontal page overflow.
- [ ] Run focused graph/trajectory/inspector/polling/accessibility unit tests and typecheck, fix genuine regressions (update only superseded row-specific assertions with equivalent stronger behavior checks). Self-review and commit `feat(web): render the guided spatial execution journey`.

### Task 3: Evidence-first initial focus without history or polling resets

**Files:** Create `apps/web/src/trajectory/initialGraphSelection.ts`, `apps/web/test/graphSelection.test.tsx`; modify `apps/web/src/run-detail/RunDetailPage.tsx` and existing route test assertions only where intentional initial selection changes expectations.

- [ ] Add RED tests for explicit valid/invalid/duplicate URL preservation; firstFailure > recorderRecovery > latestLikelyTest > first loaded priority; anchor outside head uses existing around-event resolver; empty run; once-per-run behavior on polling/pages/user selection/back-forward and run changes. Contradiction codes cannot fabricate an anchor.
- [ ] Export pure `initialGraphEventId(anchors: RunDetailV1['anchors'], events: readonly TrajectoryEventV1[]): string|null`. Use exact anchor eventId fields. Add an effect to `TrajectoryDetail` that chooses once per run only after run and initial trajectory readiness and only when `event` query is absent. Preserve unrelated query parameters; use replace for automatic initialization, normal history for user selection. Gate before empty/invalid data and never override a present event query. Run changes reset initialization safely.
- [ ] Run focused selection/trajectoryPages/activePolling/accessibility unit tests and typecheck. Self-review and commit `feat(web): focus the first actionable recorded graph event`.

### Task 4: Production fixtures, browser fidelity, and graph regression gate

**Files:** Add `apps/web/e2e/execution-graph.spec.ts`; modify `apps/web/e2e/fixtures.ts`, existing `trajectory.spec.ts`/`flight-console.spec.ts` and unit assertions that explicitly encode old density; bounded fixes to graph rendering/CSS if browser checks expose issues.

- [ ] Add a clearly named mixed-evidence graph fixture through existing fixture helpers: routine messages, command start/completion, observed failure, exact derived-test relation, file change, recorder recovery, Git evidence and human assessment where supported. Do not change real captures or test data roots. Ensure text labels do not masquerade as user activity.
- [ ] Add browser assertions before fixes: 1440 desktop actually has bounded node widths, spaced path, persistent exact branches, adjacent clarification and fixed inspector; selecting visible nodes preserves coordinates; cluster expansion/member selection works; no raw/native request on clarification mount; narrow 1024/768/390 retains graph and no page overflow; reduced motion disables transitions; branch/member keyboard actions operate. Capture actual screenshots in ignored artifacts and visually inspect them.
- [ ] Update old 68px/12-visible assertions to graph-specific spacing/bounded DOM checks. Adapt old 1000-event test to disable grouping through a visible grouping control (or explicitly expand clusters) while retaining its exact API pagination, identities, anchors, URL and bounded virtualization assertions. Do not weaken those contracts. Active-tail overflow fixture remains sufficient with new geometry.
- [ ] Run the full `pnpm test`, `pnpm typecheck`, `pnpm build`, `pnpm --filter @agentlens/web test:e2e` (confirm existing script name first). Fix in-scope failures with focused reruns, record any pre-existing warnings separately. Self-review and commit `test(web): verify guided graph fidelity and evidence stability`.
- [ ] Controller performs independent whole-slice review, resolves findings, launches production fixture preview, verifies real browser desktop and narrow output, and returns for visual checkpoint. Keep original later Flight Console tasks pending and leave branch unmerged/unpushed.
