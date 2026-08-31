# AgentLens Task 7 production UI/API design

Status: frozen for user review
Date: 2026-08-30
Scope: design only; no Task 7 implementation or implementation plan is authorized

## 1. Purpose

Task 7 turns the accepted AgentLens Tasks 1-6 evidence foundation into a
local production interface for answering two questions:

1. What have my agents been doing lately, and which runs deserve inspection?
2. What happened during one run, in what order, where did it fail or recover,
   what final Git evidence exists, and what should I inspect?

The interface is an execution flight recorder, not a scorecard. It preserves
provider facts, AgentLens derivations, Git-recovered evidence, recorder facts,
recorder recovery, and human judgment as separate evidence classes. It never
turns a passing likely test, an agent completion message, a zero child exit, or
a human verdict into an unqualified statement that the run succeeded.

The production visual direction is a refined technical instrument: dark-first,
dense but calm, precise, and recognizably a developer tool. The execution
trajectory is the signature experience.

## 2. Frozen scope

### In scope

- a loopback-only local HTTP server;
- explicit versioned API DTOs;
- one-time browser bootstrap and process-local authentication;
- a production React run list;
- a production React run detail view;
- a virtualized execution trajectory;
- event evidence and relationship inspection;
- command, output, and normalized-event inspection when capture policy permits;
- final Git evidence and a structured diff viewer;
- current and historical human assessment evidence;
- active-run polling;
- production visual tokens, motion, responsiveness, and accessibility;
- contract, privacy, browser, and end-to-end testing.

### Out of scope

- Claude hooks, AGY, Codex interactive hooks, or another provider adapter;
- multi-provider comparison, benchmark cases, Insights, or quality scores;
- LLM summaries, automatic grading, or claims of task correctness;
- hosted accounts, teams, sharing, exports, or remote access;
- WebSockets, Server-Sent Events, or a mobile application;
- changing the accepted Tasks 1-6 evidence semantics.

No placeholder navigation or inert page for an out-of-scope feature is shown.

## 3. Verified foundation

The design maps to the merged Task 6 code at
`86775deae279d6c5a6b7e06d4934ac260aac55ba`.

The existing provider-neutral summary exposes:

- observed terminal and failed-terminal command counts;
- observed native file-change count;
- tracked-final-diff availability;
- validated untracked-file count when recoverable;
- recorder elapsed time;
- observed token usage when present;
- three-state likely-test semantics and attempt history;
- projected versus explicit human assessment;
- provider capability limitations.

The canonical event model exposes immutable chronological events, event status,
provenance, provider-native source identities, source relationships, redacted
normalized payload, native-payload storage metadata, and derivation identity.

The Codex adapter explicitly reports these current capability limits:

- source timestamps: unavailable;
- authoritative file reads: unavailable;
- tool output: partial;
- tool durations: unavailable;
- interruption signal: partial.

The UI represents these as availability facts. It never turns an unavailable
count into zero or manufactures duration/source time from a mock.

The existing CLI `runs` and `inspect` paths remain pure and retain their
fail-closed immutable/no-WAL behavior. Task 7 extracts their reusable summary,
artifact-validation, ownership-diagnosis, and projection logic into shared
application services; it does not make the browser call CLI formatters or
storage repositories directly.

## 4. Prototype audit

### Prototype inspected

`design-prototypes/trajectory-concept-v1`

The actual application was run and inspected in a real browser at:

- 1440 x 1000: run list, ignition transition, trajectory, event selection,
  derived evidence, and raw-event tab;
- 1100 x 900: run list and two-column run detail;
- 800 x 900: run list, trajectory, and the below-trajectory inspector state.

The rendered page had no horizontal overflow at the reviewed widths. At 1100,
the trajectory and inspector remained a 701/340 pixel split. At 800, the
inspector moved below a roughly 1,400 pixel trajectory. That layout preserved
content but separated a selected event from its evidence by too much distance.

### Carry into production

- the dark, restrained engineering-instrument visual language;
- the dense run ledger rather than dashboard KPI cards;
- a visible evidence-provenance legend;
- an execution spine with meaningful event nodes and temporal sequence;
- selection that focuses a node and updates a dedicated inspector;
- code, command, output, and diff treatments with bounded overflow;
- the visual motif connecting failure, intervening work, later test evidence,
  and derivation without declaring task success;
- a compact run header with lifecycle, likely-test, and human-review facts kept
  as separate dimensions;
- Motion-based focus, shared identity, panel, and layout transitions;
- reduced-motion support;
- the warning language that Git state is evidence rather than authorship.

### Rework for production

- Replace five widely separated physical provenance lanes with one vertical
  execution spine and a compact provenance gutter. The lane zigzag is striking
  for twelve mock events but wastes width, complicates virtualization, and
  becomes hard to scan at hundreds of events.
- Preserve provenance through marker shape, icon, label, border style, and a
  subtle tint rather than lateral position alone.
- Replace the fixed 108-pixel row and 1,340-pixel stage with variable-height,
  virtualized rows.
- Group exact provider lifecycle siblings by durable native identity while
  keeping every immutable source event individually inspectable.
- Replace the 800-pixel layout's inspector-at-the-end behavior with compact
  inline evidence at the selected row and a deep evidence panel immediately
  following it.
- Replace `19 likely passed` with the Task 6 contract: for example,
  `Latest likely test: passed · 1 previous failure`.
- Replace mock file-read counts, source timestamps, tool durations, and path
  overlap confidence with honest capability/availability states.
- Replace mock `Raw event` behavior with two distinct concepts: redacted
  normalized event detail and, only for eligible observed events after an
  explicit action, redacted native provider payload.
- Reframe file-change and Git copy to avoid forensic attribution.
- Scope arrow-key handling to the trajectory's roving-focus container instead
  of a global window listener.
- Keep all essential run evidence visible at 800 pixels; do not hide assessment
  merely to make the table fit.
- Reduce the run-list-to-detail transition to an immediate shared run identity
  transition. The full-screen ignition tracer is visually interesting but too
  disruptive for repeated dogfooding.

### Prototype only / discard

- all mock runs, mock events, invented repositories, and Claude rows;
- the single giant `page.tsx` component and embedded data model;
- Next.js/vinext, Sites hosting, Cloudflare development infrastructure, and
  prototype-local build configuration;
- Anime.js and the one-off ignition orchestration;
- the signal/KPI strip above the run list;
- inert search, settings, live-activity, repository, and record controls;
- prototype-only source claims such as complete native payload retention;
- `.next`, `dist`, `node_modules`, caches, screenshots, and generated output.

Production has no runtime dependency on `design-prototypes/`.

## 5. Screen architecture alternatives

### A. Five-lane flight map plus permanent inspector

This most closely preserves the prototype. It is memorable for short traces,
but wide lane travel, fixed card geometry, and relationship lines become costly
and visually noisy for 200 events. It is not selected.

### B. Conventional chronological log table plus drawer

This scales and virtualizes easily, but it discards the product's visual
signature and makes provenance/failure-recovery relationships feel like generic
log columns. It is not selected.

### C. Virtualized execution spine plus provenance gutter and hybrid inspector

This is selected. A narrow gutter communicates evidence class; one restrained
spine communicates chronology; aligned event cards carry the readable content.
Exact lifecycle siblings can compact without deleting evidence. A persistent
right inspector serves desktop, while a selected-row inline summary plus an
adjacent deep panel serves narrow layouts. Relationship connectors appear only
for the selected event and only when they clarify a durable relationship.

This approach keeps the prototype's identity while scaling to real evidence.
It also separates event DTOs, trajectory projection, and rendering so a future
hierarchical/multi-agent layout can be added without changing canonical event
data or browser DTOs.

## 6. Production application shell

Production has two routes:

- `/runs`
- `/runs/:runId`

The shell has a compact instrument rail and top bar. The rail contains only the
AgentLens identity and the functional Runs destination. The top bar shows the
local-only connection state and the current repository/run context when one is
selected. There are no fake navigation items.

The development invocation is:

    pnpm agentlens ui [--data-root PATH] [--no-open]

The packaged invocation is:

    agentlens ui [--data-root PATH] [--no-open]

The command chooses an ephemeral loopback port by default, starts the server,
and opens the one-time bootstrap URL unless `--no-open` is supplied. Task 7 has
no bind-address option and no LAN mode. A port override may exist only as a
test/development dependency injection, not as a public bind configuration.

## 7. Run list

The run list is a single information-dense ledger. It has no KPI-card row.

Each row presents, when available:

- label, otherwise a neutral `Unlabeled run` fallback;
- redacted repository display name and stable repository fingerprint;
- provider;
- run lifecycle status;
- start time and recorder duration;
- likely-test state, latest outcome, and previous failures;
- assessment state and verdict;
- final Git evidence availability, HEAD/branch warnings, and validated
  untracked-file count;
- contradiction and recorder/lifecycle warning indicators.

The list uses exact language:

    Latest likely test: passed · 1 previous failure
    Reviewer: partial
    Final Git evidence: tracked diff available · 3 untracked entries

It never says `tests passed`, `run successful`, `0 file reads`, or `agent
changes` unless an evidence source establishes that exact claim.

Initial filters are status, repository, and assessment. They are server-side,
URL-addressable, and keyboard accessible. Search, saved views, and complex
filter builders remain out of scope.

At 800 pixels a row becomes a two-line evidence card rather than hiding a
semantic column. Lifecycle, likely tests, assessment, and Git availability
remain present as labeled compact facts.

## 8. Run detail information architecture

The run detail page has four regions:

1. **Run header.** Label, provider, lifecycle, recorder time, repository,
   likely-test summary, assessment state, and warning indicators. Each fact is
   labeled by its own dimension.
2. **Trajectory toolbar.** Event count, provenance legend, jump controls, and
   active-run follow state.
3. **Trajectory workspace.** Virtualized execution spine plus inspector.
4. **Deep evidence surface.** A spanning panel for final Git diff or another
   large artifact. It opens on demand without replacing the run route.

At desktop/laptop widths the workspace is a resizable two-column grid with a
minimum 620-pixel trajectory and a 340-420-pixel sticky inspector. The selected
event remains visible when the inspector changes.

At 800 pixels the trajectory owns the full width. Each selected row exposes a
small inline evidence summary and the deep inspector is inserted immediately
after that row. Large diff evidence uses the full content width. The inspector
is never placed after the entire trace.

## 9. Trajectory model

### 9.1 Three layers

The implementation must keep three layers separate:

1. **Event data.** Versioned API DTOs with canonical AgentLens IDs,
   provenance, status, opaque browser source references, relationships,
   availability, and safe summaries.
2. **Trajectory projection.** A pure projection that assigns chronological
   order, exact lifecycle groups, collapsed/expanded state, jump anchors,
   selected relationships, and layout rows.
3. **Rendered components.** Virtualized rows, provenance gutter, spine,
   cards, connectors, inline detail, and inspector.

The Task 7 projector is linear, but the interface between layers does not make
linearity part of event data. A future tree projector may consume the same DTOs.

### 9.2 Ordering and time

Canonical `sequence` is the primary order. `receivedAt` is displayed as recorder
time. `sourceOccurredAt` appears only when present. The UI never relabels
recorder receipt time as provider occurrence time.

### 9.3 Provenance classes

The canonical provenance values remain:

- observed;
- derived;
- git_recovered;
- recorder;
- human.

`Recorder recovery` is a presentation class for canonical
`kind === "recorder.recovery"`; it is not a new provenance value. Its recovery
relationship is shown explicitly. Generic recorder events never inherit the
`Recorder recovery` label.

Projected unreviewed assessment is not a trajectory node because no human event
exists. Explicit `assessment.updated`, including explicit verdict unreviewed,
is a human node with its event ID and timestamp.

### 9.4 Lifecycle grouping

Events may group only when exact durable source identity supports the grouping:
provider, session/thread, turn, item/tool ID, and correlation ID as applicable.
Raw provider identity strings remain server-side. The browser receives a
process-local opaque source reference plus booleans describing which identity
dimensions exist. Grouping is presentation-only. Started and terminal events
remain separate, selectable immutable events. An open start followed by
recorder recovery shows the original start and the appended recovery; it never
fabricates a provider terminal event.

Canonical sequence is never reordered. Only contiguous exact lifecycle siblings
may share a collapsible presentation row. Noncontiguous siblings remain at their
original positions and receive labeled jump relationships. Expanding a compact
row restores every contained event in canonical sequence.

Default Task 7 grouping covers exact start/terminal lifecycle siblings. General
similar-event clustering is deferred until dogfooding proves it necessary.

### 9.5 Failure and recovery

Failure uses a visible status glyph, label, and edge treatment independent of
provenance. A selected failed command highlights:

- its exact terminal observed event;
- any durable `derived_from`, `recovers`, or `correlates_with` relationships;
- later likely-test attempts through source chips/jump links, not an inferred
  causal line;
- recorder recovery only when a recorder recovery event actually exists.

The likely-test summary says `latest: passed, previous failures: 1`. It does not
say the run succeeded.

### 9.6 Selection and relationships

Selection is stored in the route query as `?event=<eventId>` so it can be
restored and linked. Clicking a row, focusing it and pressing Enter, using the
trajectory arrow controls, or choosing a relationship chip updates the same
selection state.

The selected node receives emphasis; its direct related nodes receive a weaker
outline. A connector is drawn only between visible related rows. Off-screen
relationships appear as labeled jump controls in the inspector. No background
spaghetti graph is rendered.

### 9.7 Long traces

Task 7 uses variable-height virtualization with a small overscan. It renders
only visible rows plus overscan and does not run entry animations when an old
row is remounted.

The initial long-trace controls are deliberately small:

- jump to first failure;
- jump to recorder recovery;
- jump to latest likely-test result;
- jump to final Git evidence;
- jump to latest event.

The architecture supports later provenance filters and repetitive-sequence
compression, but Task 7 does not add them without dogfooding evidence.

## 10. Inspector behavior

The selected event inspector has three possible tabs:

- **Evidence:** safe presentation details, command/output preview, derivation,
  Git facts, assessment, and omission reason;
- **Relationships:** process-local opaque source grouping, identity-dimension
  presence, and exact AgentLens relationship IDs with jump controls;
- **Provider payload:** present only for eligible observed events. It requires
  an explicit user action and a separate authenticated request.

A derived or human event never labels its normalized representation as a native
provider payload. Only a known, allowlisted `NormalizedContentV1` variant may be
shown after the explicit event `/content` action. Unknown or unprojectable
normalized content remains unavailable; there is no generic object fallback.

Large output is collapsed to a bounded preview and expanded on demand. The UI
uses a code block, not a terminal emulator. It preserves text selection,
horizontal scrolling, a comfortable line height, and a visible truncation or
omission state.

Artifact content is never prefetched merely because a row is visible or
selected. The explicit expand/open action triggers the content request.

## 11. Final Git evidence and diff

The page consistently uses the name **Final Git evidence**.

The Git surface shows:

- initial and final HEAD;
- initial and final branch;
- explicit HEAD/branch-change warnings;
- initial and final status availability;
- tracked final diff availability;
- untracked-file metadata availability and validated entry count;
- `git diff --check` result.

It never calls this `changes made by the agent` or `exact final diff`.

The diff endpoint validates the existing redacted artifact before parsing it.
The server projects a structured file/hunk/line DTO; the browser never renders
untrusted diff text as HTML. The viewer provides file grouping, collapsed
files, hunk headers, old/new line numbers, added/deleted/context treatment,
horizontal overflow, and explicit omitted/truncated/corrupt states.

Sensitive-path markers embedded by capture remain visible as excluded evidence;
the UI does not try to recover or infer the omitted path/content. A lightweight
custom diff renderer is preferred over a full code editor.

Untracked entries remain metadata only. No control implies that their contents
are available.

## 12. Assessment UX

Before a human assessment exists, the header and assessment panel say:

    Not reviewed · projected state · no human evidence

They do not render a human provenance node.

The compact assessment control supports:

- verdict: success, partial, failure, or explicit unreviewed;
- task completed: yes, no, or uncertain;
- optional note up to the existing 16 KiB UTF-8 limit.

Explicit unreviewed requires task completed uncertain. After submission, it is
shown as a timestamped human assessment and appears in the trajectory.

Likely-test and human facts may disagree without an error state:

    Latest likely test: passed
    Reviewer: partial

The API write calls the same shared assessment application service as
`agentlens assess`. Standard notes are redacted in memory before durable
storage; metadata-only and strict notes persist only an explicit omitted state.

Assessment responses carry an ETag based on the current event ID, or a stable
projected sentinel when no event exists. The browser sends `If-Match` on PUT.
The shared assessment application service accepts that expected revision as an
input. The storage transaction re-reads and compares it inside the same
immediate transaction, before artifact metadata insertion, human-event append,
or current-projection update. A mismatch appends no event, commits no metadata,
returns 412, and asks the user to review the new current assessment.

Reviewer-note artifact bytes may already have been safely redacted and written
before the transaction, following the accepted artifact ordering. A stale
precondition may therefore leave an unreferenced redacted artifact file for
garbage collection, but no committed row may reference it. Assessment is
disabled when the current revision cannot be read reliably. An exact retry with
the old ETag fails rather than creating a second human event.

## 13. Production package boundaries

Task 7 introduces these production boundaries:

- `packages/application`: provider-neutral query services, validated artifact
  presentation, ownership diagnosis, summary projection, and the shared
  assessment application service;
- `packages/api-contract`: browser-safe Zod schemas and TypeScript DTOs with no
  Node, SQLite, filesystem, or storage-record dependency;
- `apps/server`: loopback HTTP server, authentication/bootstrap, static asset
  serving, route validation, and error mapping;
- `apps/web`: React/Vite application, trajectory projection/rendering, Motion,
  data cache/polling, and accessible UI components.

The CLI consumes `packages/application` for runs, inspect, validated artifact
reads, and assessment. Browser code imports only `packages/api-contract`.

Storage records, database handles, filesystem paths, redaction keys, and raw
artifact metadata never cross the HTTP boundary.

The production web stack is React with Vite, Motion for React,
`@tanstack/react-query` for request state/polling, and
`@tanstack/react-virtual` for the trajectory. Component primitives remain
small and local; no broad component library or prototype hosting stack is
adopted.

## 14. API conventions

All responses use `/api/v1`, JSON UTF-8, and an explicit `schemaVersion: 1`.
Errors have this shape:

```ts
type ApiErrorCodeV1 =
  | "invalid_request" | "authentication_required" | "forbidden_origin"
  | "run_not_found" | "event_not_found" | "invalid_cursor"
  | "precondition_required" | "assessment_conflict"
  | "content_unavailable" | "evidence_binding_mismatch"
  | "active_snapshot_unavailable" | "internal_error";

interface ApiErrorV1 {
  schemaVersion: 1;
  error: {
    code: ApiErrorCodeV1;
    message: string;
    retryable: boolean;
  };
}
```

Error messages never contain database paths, artifact paths, full repository
paths, secrets, raw native content, or internal stack traces.

Evidence-bearing fields use explicit availability instead of nullable numbers:

```ts
type EvidenceValueV1<T> =
  | {
      state: "available";
      value: T;
      origin:
        | { type: "event"; provenance: "observed" | "derived" |
            "git_recovered" | "recorder" | "human" }
        | { type: "provider_capability"; provider: ProviderFieldV1 };
      supportingEventIds: string[];
      supportingArtifactIds: string[];
    }
  | {
      state: "unavailable";
      reason: "provider_capability" | "capture_policy" | "not_captured" |
        "not_yet_available" | "artifact_omitted" | "artifact_unreadable";
      origin: null;
      supportingEventIds: string[];
      supportingArtifactIds: string[];
    };
```

DTO projectors adapt existing Task 6 summary types into this browser-safe
representation. They do not reinterpret evidence in React.

The HTTP contract is an allowlist, not a serialization of canonical or storage
objects. `packages/api-contract` defines strict Zod schemas for every response:

```ts
type RunStatusV1 =
  | "starting" | "running" | "completed" | "failed"
  | "interrupted" | "recorder_error";

type EventStatusV1 =
  | "in_progress" | "completed" | "failed" | "declined"
  | "interrupted" | "unknown";

type RunStatusFieldV1 =
  | { state: "known"; value: RunStatusV1 }
  | { state: "unsupported"; safeToken: string };

type EventStatusFieldV1 =
  | { state: "known"; value: EventStatusV1 }
  | { state: "unsupported"; safeToken: string };

type ProvenanceV1 =
  | "observed" | "derived" | "git_recovered" | "recorder" | "human";

type ProviderIdV1 = "codex-exec" | "claude-code";
type ProviderFieldV1 =
  | { state: "known"; value: ProviderIdV1 }
  | { state: "unsupported"; safeToken: string };

type PresentationClassV1 =
  | "lifecycle" | "message" | "reasoning" | "command" | "file_change"
  | "tool" | "plan" | "git" | "recorder" | "recorder_recovery"
  | "test" | "assessment" | "error" | "unknown";

interface BrowserSourceRefV1 {
  opaqueRef: string; // src_ + HMAC(process-local secret, canonical source tuple)
  provider: ProviderFieldV1;
  hasSessionOrThread: boolean;
  hasTurn: boolean;
  hasItemOrTool: boolean;
  hasCorrelation: boolean;
}
```

`opaqueRef` is stable only for this server process and uses a dedicated secret,
not the durable redaction-marker secret. It supports same-source grouping
without exposing arbitrary provider-native IDs. Persisted exact source IDs,
event type, and item type remain server-side. Standard-capture native expansion
may include an explicitly labeled provider-source section only after those
values pass the same in-memory redaction and bounds as native payload content;
metadata-only and strict omit them. No endpoint returns the persisted strings
directly.

`TrajectoryEventV1` is deliberately structural: exact event/run IDs, sequence,
bounded safe summary, recorder/source time availability, the status wrapper,
provenance and presentation-class enums above, `BrowserSourceRefV1`, allowlisted
AgentLens relationship IDs/types, derivation name/version/source event IDs,
native/content availability, and lifecycle group key. Run list/detail use the
equivalent run-status wrapper. Each `safeToken` is sanitized to the bounded
pattern `[a-z0-9._-]{1,64}` before projection. It preserves an unsupported
future value without accepting arbitrary text or pretending it is canonical.
The trajectory contains no normalized payload, raw source identity, artifact
record, filesystem path, or arbitrary object field. The lifecycle group key is
itself an opaque process-local token, not a concatenation of raw provider IDs.

`EventDetailV1` is a discriminated union on `presentationClass`. Each known
variant contains only its bounded presentation metadata: lifecycle phase;
message role and content availability; reasoning availability; command
lifecycle/exit/output availability; file-change count; tool name/status/content
availability; plan step counts; final-Git evidence availability; recorder
diagnostic/recovery class; likely-test derivation identity/result; assessment
revision/verdict/completion/note availability; or sanitized error class. The
`unknown` variant is structural only: kind label, status, provenance,
relationships and availability. It never carries normalized or native content.

Normalized content uses a separate authenticated `NormalizedContentV1`
discriminated union whose variants allow only bounded redacted text/arrays for
`message`, `reasoning`, `command`, `command_output`, `file_change`, `tool`,
`plan`, `git`, `recorder`, `test`, `assessment`, and `error`. Unknown kinds have
no generic content variant. Native expansion has its own bounded JSON/text
response and is never accepted by the normalized-content schema. No schema uses
`unknown`, an open-ended record, object spread from a canonical/storage value,
or the existing CLI formatter output at the HTTP boundary.

## 15. API endpoints

### `GET /api/v1/health`

Authenticated. Returns only API version, process readiness, and read-model
availability. It contains no path or environment detail.

### `GET /api/v1/runs`

Query parameters:

- `limit` (default 50, maximum 100);
- opaque `cursor` based on stable `(startedAt, runId)` ordering;
- optional `status`;
- optional `repository` fingerprint;
- optional `assessment` verdict/state.

Returns lightweight `RunListItemV1[]` and `nextCursor`. Items contain browser
run identity, lifecycle, ownership diagnosis, Task 6 summary, final Git evidence
availability, warnings, and capability limits. They do not contain events,
artifact records, native content, or filesystem paths.

### `GET /api/v1/runs/:runId`

Returns `RunDetailV1`: browser-safe run metadata, summary, current assessment,
Git metadata/availability, warnings/contradictions, capability limits, and event
count. It also returns exact `{ eventId, sequence }` anchors when present for
first failure, recorder recovery, latest likely-test result, final Git evidence,
and latest event. It does not eagerly include event payloads or artifact bytes.

### `GET /api/v1/runs/:runId/events`

Query parameters:

- `limit` (default 100, maximum 250);
- exactly zero or one selector: opaque `cursor`, `afterSequence`, or
  `aroundSequence`.

With no selector, a terminal run returns its earliest window and an active run
returns its latest window. `afterSequence` returns only later committed events
for polling. `aroundSequence` returns a balanced window containing the requested
sequence for deep links and jump anchors. A cursor encodes direction, run,
filters, page boundary, and the page's `latestCommittedSequence` snapshot; it is
invalid for any other run/filter/snapshot contract. Later append-only commits do
not invalidate that captured snapshot: cursor pages continue to query through
the encoded sequence while `afterSequence` collects new commits. Malformed or
mismatched cursors return the stable `invalid_cursor` error rather than silently
changing position.

Returns a `TrajectoryPageV1` containing chronological `TrajectoryEventV1`
items plus the effective mode (`head`, `tail`, `after`, `around`, or `cursor`)
and this explicit window union:

```ts
type TrajectoryWindowV1 =
  | {
      state: "nonempty";
      minSequence: number;
      maxSequence: number;
      latestCommittedSequence: number;
      hasEarlier: boolean;
      hasLater: boolean;
      earlierCursor: string | null;
      laterCursor: string | null;
    }
  | {
      state: "empty";
      latestCommittedSequence: number | null;
      hasEarlier: boolean;
      hasLater: false;
      earlierCursor: string | null;
      laterCursor: null;
    };
```

For an empty `afterSequence` poll, `latestCommittedSequence` is the current
latest sequence (or `null` only when the run has no events), `hasEarlier`
reflects whether that sequence exists, and `earlierCursor` may page backward in
the captured snapshot. `hasLater` is false and no later cursor is manufactured.
An empty zero-event head/tail page has null latest sequence, both direction
flags false, and both cursors null.

Each trajectory item has:

- event/run ID and sequence;
- recorder and optional source timestamp;
- kind, status, canonical provenance, and presentation class;
- safe summary;
- the opaque browser source reference and identity-presence booleans;
- exact relationships;
- derivation identity/source IDs when applicable;
- native-payload availability metadata, never native content;
- exact lifecycle group key when available;
- a detail-availability description.

Unknown event kinds are returned with presentation class `unknown`; they never
crash the endpoint or browser.

The client merges pages by exact `(eventId, sequence)`, rejects contradictory
duplicates, and preserves the selected row and virtual-scroll anchor when pages
prepend or append. A route deep link first resolves the event detail to its
canonical sequence, then requests `aroundSequence` if that event is outside the
loaded windows.

### `GET /api/v1/runs/:runId/events/:eventId`

Returns `EventDetailV1` only after verifying that the event belongs to the run.
It includes only the concrete per-presentation-class metadata described in
Section 14, relationship detail, content availability, and related evidence
availability without paths. It does not expand normalized or native content.

### `GET /api/v1/runs/:runId/events/:eventId/content`

Explicit normalized-content expansion. After run/event binding and capture
policy checks, it returns exactly one allowlisted `NormalizedContentV1` variant.
Unknown kinds, omitted content, or content without a defined safe projector do
not fall back to generic JSON; they return a typed unavailable response.

### `GET /api/v1/runs/:runId/events/:eventId/native`

Explicit native expansion. It is available only for standard-capture observed
events whose native payload exists. Inline content is projected from the
redacted stored payload. Artifact content passes the same canonical path,
no-follow, identity, length, digest, media-type, and truncation checks as CLI
inspection. Derived, Git, recorder, and human events cannot masquerade as
provider-native evidence.

There is no generic artifact endpoint. The remaining explicit evidence routes
are:

- `GET /api/v1/runs/:runId/git/diff`;
- `GET /api/v1/runs/:runId/git/status?phase=initial|final`;
- `GET /api/v1/runs/:runId/git/diff-check`;
- `GET /api/v1/runs/:runId/git/untracked`;
- `GET /api/v1/runs/:runId/events/:eventId/assessment-note`.

Every route resolves the authoritative artifact reference from the already
bound run/event record; callers never supply an artifact ID or role. Before
bytes are read, the shared validator enforces canonical containment, no-follow,
owner-only identity, expected length/digest, allowed media type, capture policy,
and the route-specific maximum. It then uses the fixed decoder/projector below:

| Route | Required bound role | Allowed stored kind/media | Projector | Max response |
|---|---|---|---|---:|
| event `/content` | event normalized-content/output reference | matching allowlisted event content; UTF-8 text or JSON | matching `NormalizedContentV1` variant | 256 KiB |
| event `/native` | same event native-payload reference | `native-payload`; JSON or UTF-8 text | bounded redacted JSON/text plus separately labeled, response-redacted provider source fields | 256 KiB |
| `/git/diff` | run tracked-final-diff | Git diff; UTF-8 text | structured files/hunks/lines | 2 MiB |
| `/git/status` | run initial/final status for requested phase | Git status; UTF-8 text/JSON | bounded status entries/summary | 256 KiB |
| `/git/diff-check` | run diff-check | Git diff-check; UTF-8 text/JSON | result plus bounded diagnostics | 256 KiB |
| `/git/untracked` | run untracked metadata | untracked metadata; JSON | bounded metadata entries only, never file bytes | 512 KiB |
| event `/assessment-note` | same-run assessment event's exact `assessment_note` reference | `assessment-note`; UTF-8 text | bounded redacted text under standard capture | 16 KiB |

The table is exhaustive for Task 7. A canonical command output that is inline
may be projected by event `/content`; an artifact-backed output must satisfy the
same event-bound role and kind. No route invents command output when Task 6 has
no allowlisted canonical reference. Role, kind, media, binding, or decoder
mismatch is an `evidence_binding_mismatch` error, never an arbitrary file read.

Historical and current notes use the same event-scoped route. It requires the
exact same-run `(eventId, artifactId, assessment_note)` binding and rejects
non-assessment events and non-standard capture. The current-assessment panel
uses its `currentEventId`; selecting an older `assessment.updated` uses that
historical event ID, so a later assessment cannot substitute a different note.

### `PUT /api/v1/runs/:runId/assessment`

Requires `If-Match` and accepts a full replacement of verdict, task-completed,
and optional note. It calls the shared Task 6 assessment service. It returns the
new explicit assessment, event ID, timestamps, note availability, and new ETag.
Each successfully matched PUT is one genuine human action. The required
expected revision is passed into the shared application service and checked in
the same immediate storage transaction before assessment metadata, event, or
projection is committed. The client does not auto-retry an ambiguous write.

Stable error codes used by these contracts are `invalid_request`,
`authentication_required`, `forbidden_origin`, `run_not_found`,
`event_not_found`, `invalid_cursor`, `precondition_required`,
`assessment_conflict`, `content_unavailable`, `evidence_binding_mismatch`,
`active_snapshot_unavailable`, and `internal_error`. HTTP status is preserved
separately; messages remain sanitized and are not parsed for behavior.

## 16. Read/write boundary and active runs

Ordinary API reads:

- issue no SQL writes;
- never apply migrations;
- never initialize or repair a data root;
- never recover stale runs;
- never append/fill derivations;
- never create assessments or artifacts;
- never invoke Git;
- never mutate lifecycle state.

Terminal/stable CLI reads continue using the accepted immutable/no-WAL path.

The server needs committed active-run events, which may reside in WAL. Task 7
therefore defines one narrow server-only amendment to the Task 6 read contract;
it does not alter `agentlens runs` or `agentlens inspect`.

For a terminal/no-WAL database, the server uses the accepted immutable path. For
an active WAL database, the database, `agentlens.sqlite-wal`, and
`agentlens.sqlite-shm` must already exist and each must be an owner-only,
same-owner, non-symlink regular file. If any prerequisite is absent or changes
during validation, the active snapshot fails closed. The server opens the
database with filesystem and SQLite read-only flags, immediately enables
`query_only=ON`, runs no migrations/initialization/recovery, and uses short
snapshot-scoped transactions.

The only physical write tolerated from an ordinary active-run read is
SQLite-managed read-mark/lock coordination inside the already-existing
`agentlens.sqlite-shm` file. The read may not create/delete/rename any file;
change the SHM inode, owner, mode, or size; change database or WAL bytes; change
artifact bytes/metadata; append rows/events/derivations; or mutate run lifecycle.
The server itself never opens SHM for application writes or edits it directly.
This is a deliberately precise SQLite coordination exception, not permission
for a writable application connection.

Implementation tests snapshot the entire data root before and after reads,
including paths, file types, symlink targets, inode/owner/mode/size, and hashes of
the database, WAL, SHM, and every artifact. The only allowed delta is SHM byte
content proven to be SQLite coordination while all stated SHM metadata and all
other bytes remain unchanged. To distinguish reader effects from legitimate
writer activity, the test writer commits an event and then holds quiescent while
the before/read/after snapshots are taken; it repeats after a second commit to
prove fresh committed-event visibility. Tests must also instrument/deny SQL
writes and prove rows and lifecycle remain unchanged. The design review and
approval of this frozen document are the approval for this narrow Task 7
server-path exception; CLI read purity remains exactly as accepted in Task 6.

If the installed SQLite driver/platform cannot satisfy and prove this exact
boundary, active-run inspection stops for a new design amendment. It must not
silently create SHM, fall back to a writable/migrating connection, hide the
limitation, or weaken `runs`/`inspect`.

The only Task 7 domain mutation is the assessment PUT. Static asset responses
and bootstrap authentication do not touch the AgentLens data root.

## 17. Active-run client behavior

While status is `starting` or `running`, the client polls run detail and
`events?afterSequence=<last>` approximately every one second. It stops when the
run is terminal.

An active run may initially have no event sequence. In that state the client
repeats the default tail request; it does not invent sequence zero. After the
first event arrives, it switches to `afterSequence=<last>` incremental polling.

New events append without replaying entry motion for existing rows. The current
selection and virtual scroll anchor remain stable. If the user is not following
the tail, the page shows `N new events` and does not force scroll. If the user
is already at the tail, a restrained follow mode keeps the latest activity in
view.

Temporary lock/snapshot failure returns a retryable 503 and a visible degraded
state; it does not blank the trace or report zero events.

## 18. Local security model

- Bind an operating-system-selected port on `127.0.0.1` only. Do not bind
  `0.0.0.0`, a LAN address, or a hostname vulnerable to rebinding.
- Reject any `Host` that is not the exact selected loopback origin.
- Generate a high-entropy per-process bearer token and a separate one-use
  bootstrap code. Neither is persisted or logged.
- By default, open `/bootstrap/<one-use-code>` in the browser. With `--no-open`,
  print that one-use bootstrap URL exactly once to stdout; the bearer token is
  never printed. The code is invalidated on the first successful response.
- The bootstrap HTML is generated in memory with `Cache-Control: no-store` and a
  response-specific CSP nonce. Its only nonce-bearing inline script closes over
  the bearer token in lexical memory, removes its own script element, calls
  `history.replaceState` to `/runs` before application rendering, and starts the
  bundled app. The token is held only in the in-memory API client closure.
- Do not use localStorage, sessionStorage, IndexedDB, a persistent cookie, URL
  query, URL fragment, DOM attribute, global variable, source map, or logs for
  the bearer token. Reload, duplicate-tab navigation, or token loss requires
  stopping/restarting `agentlens ui` to obtain a fresh bootstrap URL. There is
  no unauthenticated token-reissue endpoint. This is an intentional security
  tradeoff.
- Require `Authorization: Bearer ...` on every `/api/v1` route, including
  health. Static hashed assets and the one-use bootstrap shell are the only
  unauthenticated resources.
- Do not emit permissive CORS headers. Require the exact loopback Origin for
  browser mutation requests and reject `null`/foreign origins.
- Send `Referrer-Policy: no-referrer`, `X-Content-Type-Options: nosniff`,
  `frame-ancestors 'none'`, a restrictive Content Security Policy, and
  `Cache-Control: no-store` for bootstrap/API responses.
- Bound JSON request size and note bytes before application-service work.
- Never include redaction/HMAC material, database/artifact paths, full local
  repository paths, credentials, unredacted content, or stack traces in DTOs.
- Do not contact external networks. Fonts, icons, scripts, and styles are
  bundled locally.

The process token protects the loopback API from arbitrary local web pages; it
is not presented as protection against a fully compromised local account.

## 19. Visual system

### Surfaces and borders

- canvas: near-black graphite;
- shell: one step lighter than canvas;
- primary panel: calm charcoal;
- raised/selected panel: subtle luminance lift, not glow;
- primary borders: low-contrast neutral;
- focus/selected borders: higher-contrast neutral plus semantic accent;
- dividers: softer than container borders.

All hierarchy remains legible in grayscale.

### Typography

- locally bundled Geist Sans (or metrically verified equivalent) for navigation,
  labels, summaries, controls, and status;
- locally bundled Geist Mono for commands, paths, IDs, SHAs, code, output,
  structured values, and diffs;
- monospace is never applied to the whole application;
- code/output line height remains at least 1.5 and body text is not shrunk to
  simulate density.

### Spacing

A 4-pixel base rhythm uses 4, 8, 12, 16, 24, and 32-pixel steps. Row density
comes from hierarchy and alignment, not collapsed hit targets. Interactive
targets are at least 32 pixels visually and 44 pixels where touch use at the
800-pixel breakpoint is likely.

### Provenance

Provenance uses label, icon, marker geometry, and line style before color:

- observed: solid circular marker and solid spine attachment;
- derived: outlined diamond/calculation marker and dashed attachment;
- Git recovered: square/repository marker and double edge;
- recorder: neutral ring/system marker;
- recorder recovery: recorder marker plus recovery arrow/warning label;
- human: person marker with a distinct capped edge.

Subtle cyan, amber, indigo, neutral, warning, and coral accents reinforce these
shapes. They are not six saturated category colors.

### Status

Status is orthogonal to provenance and always has text plus a glyph:

- run `starting`: `Starting` plus pending indicator;
- run `running`: `Running` plus live indicator;
- run `completed`: `Completed` plus check;
- run `failed`: `Failed` plus X;
- run `interrupted`: `Interrupted` plus broken/stop glyph;
- run `recorder_error`: `Recorder error` plus system-warning glyph;
- event `in_progress`: `In progress` plus live indicator;
- event `completed`: `Completed` plus check;
- event `failed`: `Failed` plus X;
- event `declined`: `Declined` plus barred-action glyph;
- event `interrupted`: `Interrupted` plus broken/stop glyph;
- event `unknown`: `Unknown` plus question glyph.

These are exhaustive canonical Task 7 mappings. A future unsupported status is
shown as `Unsupported status: <safe enum token>` with the unknown glyph and a
compatibility warning; it is not silently collapsed into an existing status.

Likely-test state and assessment use their own labeled components.

### Commands and diff

Commands have a monospace header, lifecycle/status line, bounded output preview,
copy-friendly text, and explicit captured/omitted/truncated states. Diffs use
file/hunk hierarchy, line numbers, restrained add/delete backgrounds, and
visible excluded-sensitive-content blocks.

### Focus and selection

Keyboard focus uses a two-layer visible ring that works on all surfaces.
Selection uses a left-edge/spine emphasis plus a subtle surface lift. Focus and
selection remain distinguishable.

## 20. Motion

Motion explains state:

- row-to-header shared identity on route change;
- 120-180 ms selection/focus transition;
- 140-220 ms inspector content transition;
- measured height transition for lifecycle expansion;
- restrained panel/diff movement;
- no repeated animation for virtualized remounts.

There is no looping glow, bouncing control, particle effect, or full-screen
ignition in production. Route transitions never block input. Under
`prefers-reduced-motion`, movement becomes immediate state change with opacity
used only when it does not hide timing or focus.

## 21. Responsive behavior

### 1440 pixels

Full run ledger, compact rail, two-column trajectory/inspector, and a spanning
deep-evidence panel. The inspector may be resized within bounded widths.

### 1100 pixels

The ledger compresses secondary identity text but retains all evidence facts.
The trajectory remains primary and the inspector stays right at approximately
340 pixels. Run-header facts wrap into two compact rows.

### 800 pixels

The rail collapses, filters wrap, and each run row becomes a two-line evidence
card. The trajectory is full width. Selected quick evidence is inline and deep
evidence follows the selected row. No required provenance, assessment, Git, or
availability fact is removed. Diff is full width with horizontal line content
scroll, not a horizontally overflowing page.

Phone-first behavior is not a Task 7 goal.

## 22. Accessibility

- Semantic headings, lists/tables, navigation, buttons, tabs, and form fields;
- one logical tab stop per trajectory row with roving focus inside the trace;
- arrow-key navigation only while the trajectory has focus;
- Enter/Space selects or expands; Escape closes deep evidence;
- visible focus on every interactive element;
- provenance and status never conveyed by color alone;
- sufficient text, border, and code contrast;
- accessible names and expanded/selected relationships on event rows;
- diff additions/deletions announced with textual prefixes/labels;
- assessment errors associated with their controls;
- a live region for active-run new-event count, not for every event;
- reduced motion honored throughout;
- selection is preserved when panels reflow at a breakpoint.

## 23. Empty and degraded states

The design includes explicit states for:

- no runs recorded, with a copyable record command;
- missing data root/database;
- run not found;
- API disconnected or bearer bootstrap expired;
- active writer snapshot temporarily unavailable;
- interrupted run and recorder recovery;
- likely tests `none_detected`;
- likely tests `unavailable_due_to_capture_policy`;
- projected unreviewed versus explicit human unreviewed;
- command/output/native evidence omitted by policy;
- provider capability unavailable;
- final Git evidence unavailable;
- tracked diff absent versus omitted;
- artifact truncated, corrupt, or unreadable;
- unknown future event kind.

No unavailable or omitted state renders as a blank value or zero.

## 24. Performance strategy

- stable cursor pagination for runs and events;
- lightweight trajectory DTOs separate from event detail;
- variable-height row virtualization with limited overscan;
- exact lifecycle grouping before rendering;
- event detail fetched on selection;
- native, output, note, and diff content fetched only after explicit expansion;
- structured diff parsing on the server after artifact validation;
- React Query caching keyed by run/event/revision;
- memoized pure trajectory projection;
- active polling returns only sequences after the last committed event;
- Motion runs only on mounted/changed elements;
- long code/output blocks are bounded and independently scrollable.

Acceptance fixtures include 10, 50, 250, and at least 1,000 events, repeated
test attempts, long output, many file changes, interrupted lifecycle, and
recovery. The 1,000-event fixture proves multi-page merge, cursor navigation,
virtualization, selection, and scroll anchoring together.

## 25. Testing strategy

The later TDD plan must cover, without implementing in this design pass:

- exhaustive run/event-status rendering plus unsupported-future-status behavior;
- strict DTO allowlist/compatibility tests proving storage objects, arbitrary
  normalized fields, raw source IDs, paths, and unknown-kind content cannot
  cross the HTTP boundary;
- read-service tests proving no summary semantics are duplicated in React;
- immutable CLI read regression tests;
- active-WAL tests proving committed-event visibility, every Section 16
  prerequisite, full data-root before/after equivalence, and only the stated
  in-place SQLite SHM coordination-byte exception;
- auth, one-use bootstrap, `--no-open` stdout, history scrubbing, token-memory,
  reload failure, Host, Origin, CSP nonce, no-store, and request-bound tests;
- every explicit evidence route's run/event/role/kind/media binding,
  capture-policy, path, no-follow, identity, size, digest, decoder, response
  limit, and truncation tests, plus proof that no generic artifact route exists;
- assessment shared-service, ETag/If-Match, note privacy, and explicit-unreviewed
  tests, including two concurrent writers proving the expected revision is
  compared inside the same immediate transaction;
- whole-data-root and HTTP-response sentinel scans for standard,
  metadata-only, and strict capture;
- head/tail/after/around/cursor pagination, deep-link, active append, invalid
  cursor, deduplication, and prepend/append scroll-anchor tests;
- lifecycle compaction tests proving only contiguous exact siblings combine and
  canonical sequence never changes;
- component keyboard, focus, reduced-motion, and non-color semantics tests;
- virtualized 1,000-event multi-page interaction and active append/selection
  preservation;
- Playwright journeys at 1440, 1100, and 800 pixels;
- screenshot review at meaningful milestones, not only at completion;
- browser console, horizontal overflow, accessibility, and route-reload failure
  state checks.

## 26. Known limitations and risks

1. **Active WAL reads require proof.** Current pure CLI reads deliberately refuse
   a WAL. The Task 7 server's narrowly amended concurrent read-only path must
   pass every Section 16 invariant, including the bounded pre-existing-SHM
   exception, before active inspection is considered delivered.
2. **Task 6 summary is richer than the current list repository query.** Stable
   pagination and filters require provider-neutral query-service work; they
   must not be implemented by loading every run into React.
3. **Normalized payload shapes may evolve.** Presentation projectors must be
   allowlist/default-safe and retain an unknown-event state.
4. **Virtualization and variable expansion interact with motion.** Selection,
   focus, and scroll anchoring are release criteria, not polish tasks.
5. **Secret detection remains risk reduction.** Task 7 displays only already
   redacted content and does not claim redaction guarantees.
6. **Memory-only authentication trades reload convenience for token hygiene.**
   A reload requires a new bootstrap; this is intentional in Task 7.
7. **Git evidence remains final-state evidence.** Even when a native file-change
   event and Git path align, the UI does not claim forensic authorship.

## 27. Frozen decisions

- production uses the selected execution-spine/hybrid-inspector architecture;
- provenance and status remain separate dimensions;
- Task 6 provider-neutral semantics remain the backend source of truth;
- browser DTOs never expose storage records directly;
- browser event DTOs are closed allowlisted unions; persisted provider source
  identities stay server-side, and only response-redacted source fields may
  appear inside explicit eligible native expansion;
- native content requires explicit authenticated expansion;
- evidence uses only explicit role-bound routes; there is no generic artifact
  endpoint;
- final Git evidence is first-class but never described as agent attribution;
- run list filters are limited to status, repository, and assessment;
- active runs use one-second incremental polling, not WebSockets/SSE;
- event windows support head, tail, after-sequence, around-sequence, and opaque
  cursor modes without reordering canonical sequence;
- only contiguous exact lifecycle siblings may compact into one presentation
  row;
- production uses Motion for React and no Anime.js;
- the prototype remains isolated and untracked by production runtime;
- the server is loopback-only with memory-only per-process authentication;
- `--no-open` prints only a one-use bootstrap URL; bearer credentials never
  enter durable browser storage, browser history, or logs;
- the UI is dark-first and desktop/laptop-primary, with complete 800-pixel
  evidence access;
- no implementation plan or code begins before explicit user approval.

## 28. Independent adversarial review result

The design received a read-only adversarial review against the merged Task 6
contracts, privacy boundaries, and production requirements. The reviewer made
no file edits.

The initial pass blocked on eight Important findings: active-WAL purity,
generic DTO leakage, raw source-identity exposure, generic artifact routing,
non-atomic assessment preconditions, incomplete pagination/deep links,
incomplete canonical status presentation, and lifecycle compaction that could
reorder noncontiguous events. All were corrected in Sections 9 and 14-18.

The focused re-review found four additional Important contradictions: stale
generic normalized-content language, missing historical assessment-note
retrieval, a closed-status/future-fallback mismatch, and undefined empty-page
sequence bounds. It also found an unrestricted error-code type. All were
corrected in Sections 10, 14, and 15.

The approval pass found no Critical or Important findings and three Minor
contract details. The provider field now uses the bounded known/unsupported
wrapper, zero-event active polling is explicit, and a 1,000-event fixture now
proves multi-page virtualization and cursor merging. The final reviewer verdict
was **Approve for user review**, with no Critical or Important contradiction
introduced by those edits and no known review finding left unresolved.

## 29. Stop rule

This design pass ends after:

- real prototype/browser inspection;
- Task 6 contract verification;
- production screen, trajectory, visual, API, security, performance,
  responsive, accessibility, and test architecture;
- written specification;
- independent read-only review and resolution of Critical/Important findings.

After that, stop and ask the user to review this file. Only an explicit
`approved` authorizes the separate planning workflow. It does not authorize
implementation.
