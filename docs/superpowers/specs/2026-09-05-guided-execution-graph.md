# Guided execution graph — approved direction

Date: 2026-09-05. Status: user approved implementation in the existing isolated `codex/agentlens-flight-console` worktree.

## Scope and authority

This is a focused replacement for the compact trajectory treatment delivered through Flight Console Task 6. The existing Flight Console plan remains the record for completed shell, ledger, run header, and inspector work. Its uniform 68px row-density requirement is superseded by this specification. Finish this graph slice and its browser review before resuming old Tasks 7–13; retain the user's review pauses after old Tasks 8 and 12. No main merge, push, or change to `design-prototypes/` is authorized here.

The approved visual references are the disposable `trajectory-graph-direction.html` and `responsive-graph-direction.html` in `.superpowers/brainstorm/10876-1788538076/content/`. They are visual references, not evidence sources. Synthetic descriptions in them must never become invented production analysis.

## Experience

A premium developer console with a guided vertical action journey. Readable bounded-width action nodes sit on an actual connecting path with quiet spatial offsets for recorded relationship context. Routine messages are compact; commands, tools, and file actions have medium weight; failures, tests, Git, human judgments, and recorder recoveries are landmarks. No giant full-width rows, freeform canvas, drag/zoom controls, infinite beams, or decorative AI glow.

Selecting a node reveals its concise clarification adjacent to it without moving desktop nodes or connectors. The clarification uses only bounded safe event DTO facts: summary, kind, status, sequence, provenance, recorder/provider timestamps and exact relationship labels. It is not a generated explanation of hidden reasoning or causality. Raw normalized content, provider-native content, reviewer notes, and Final Git diff remain explicit-load controls in the existing inspector. A clarification action may focus the inspector without fetching raw data.

The existing graphite/cyan evidence palette, type system, flat shell, and fixed inspector are retained. The graph needs breathing room: approximately 260–300px nodes with 110–180px vertical regions and a reserved clarification lane on wide screens. A region may be taller to accommodate expanded lifecycle/cluster content. Use measured heights rather than text clipping that loses access to facts. Sequence/provenance/status remain legible; detailed timestamps belong in clarification/inspector rather than every compact node.

## Graph and evidence contract

1. The chronological backbone expresses sequence only. Label it as such; it is not a causal edge.
2. Relationship edges exist only for exact DTO relationships, are separately styled/labeled, deduplicated, and preserve type and direction. They remain contextually visible when selection moves away. Self-relations do not form misleading loops; offscreen/unloaded endpoints use explicit boundary markers and existing exact-event navigation. Lateral offset is assigned only from an exact loaded relationship, never provenance alone. Cross/backward edges do not imply an unrecorded merge.
3. Existing compatible start/terminal lifecycle grouping remains exact. A failure or meaningful relationship endpoint cannot be hidden inside a collapsed group.
4. Routine clustering is available and initially enabled for at least three consecutive completed, observed, relationship-free message/reasoning events with no lifecycle or derivation. Incoming loaded relationship endpoints also prevent clustering. Limit a cluster to six events. Preserve each member's event ID, order, and selection access. Explicit expansion is allowed to change layout; selection alone must not silently regroup the graph. Chunk keys derive from immutable event identity, never index. A cluster's label is a factual event count, not invented synthesis.
5. The projection is pure and deterministic and never mutates DTOs. Existing API/storage/CLI evidence contracts are unchanged.

## Navigation and stability

Explicit URL event selection wins, including exact out-of-window resolution. Invalid/duplicate event query parameters retain their error; do not silently replace them. With no explicit event, choose the server's firstFailure anchor, then recorderRecovery, then latestLikelyTest, then the first loaded event. Contradiction codes alone are not an event locator. Apply initial choice once per run; never override user selection or browser history during polling. Preserve unrelated URL parameters.

Semantic keyboard-operable nodes remain the source of interaction, with pointer-free decorative SVG. Up/Down traverses chronological projected nodes; Enter/Space selects the active immutable member. Left/Right enters/exits a loaded recorded relationship when available; lifecycle and cluster member selection/expansion must remain separately keyboard accessible (for example through a documented modified-arrow action mode). Home/End reaches boundaries. The stable inspector and clarification controls live outside the listbox. Expose every collapsed member through accessible actions. Preserve Escape deep-evidence close and breakpoint focus restoration.

Selection reveals clarification immediately. Deliberate traversal can align a newly offscreen selection around the upper third of the graph viewport; selecting a visible node should preserve its physical position. Natural scrolling remains free. Live append while inspecting history preserves the event and pixel offset; the explicit new-events action still follows the tail. Cluster changes on append/page arrival must not remove the anchor's identity.

Virtualize vertical graph regions with stable keys and variable measurements. Pin selected/focused regions and a bounded set of immediate relationship endpoints, not a recursive subgraph. DOM remains bounded on 1000-event traces. Paginated events remain immutable and chronological.

## Responsive and motion

At wide desktop widths reserve separate graph, clarification, and fixed-inspector lanes. At intermediate widths place clarification below the selected node if lateral space cannot fit. At <=800px use the same graph path, with clarification and existing inline raw inspector below the selected node, outside listbox semantics. No horizontally overflowing page or stacked full-width event-log fallback.

Use the existing Motion dependency and policy. A short opacity/translate clarification reveal and one-time selected relationship emphasis are sufficient; <=200ms, no repeating animation, no layout animation of the desktop graph or inspector. Reduced motion is instantaneous. Prefer source-inspired restraint over importing component libraries. No new dependency without demonstrated need.

## Acceptance

Pure tests prove identity, landmark classification, exact relationship direction, non-inference, safe clusters, deterministic geometry hints, and anchor priority. Component tests prove selection/clarification, keyboard member and branch access, raw-load boundaries, live stability, invalid URL handling, and narrow semantic placement. Browser tests prove a representative mixed-evidence graph, node-coordinate stability, persistent branches, explicit raw loading, reduced motion, no page overflow at 1440/1024/768/390, and bounded 1000-event virtualization. Retain existing production bootstrap, pagination, privacy, inspector, and evidence invariants; update assertions tied only to the superseded compact density with stronger graph assertions.

Deliver a live production preview seeded with clearly labeled fixture data and inspected desktop/narrow screenshots. This is a visual review checkpoint, not a claim that the entire original Flight Console plan or main integration is complete.
