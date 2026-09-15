# AgentLens recruiter-facing public demo

Status: proposed release design, grounded in the current desktop checkout. The user selected **a recruiter-friendly public demo** as the first sharing milestone. This document plans the work; nothing has been published and no demo assets are approved for public distribution yet.

## Intended experience

A visitor opens one link and understands within roughly 90 seconds what AgentLens does: compare two coding-agent attempts on the same task, distinguish their approaches, and inspect the evidence behind a conclusion. No installation, login or API key is required. Keep the existing product interface; this is an accessible recorded case study rather than a new marketing-site project.

The main journey is: **Understand the task → see the result → compare the approaches → inspect a decisive excerpt → learn how it was built**. The existing Overview / Findings / Attempts / Checks navigation can support this journey. Technical details remain available on demand. The 90-second journey is a design target to validate with unfamiliar readers, not a measured usability result.

Primary navigation: **Case study**, **Evidence**, **About AgentLens**. A repository link is a secondary action. No synthetic task counts, fictional saved-case library, simulated live execution or nonfunctional provider controls appear as primary actions. Use “AgentLens” as the product name and “Recorded case study” for this mode. Remove visible iteration numbers and design-reference copy from the public product surface. Preserve a concise distinction among recorded observations, independent check outcomes, authored case-study notes and AI judgments.

## Public content and trust boundary

Start with the real C01 historical pair; it has existing evidence and independent checks. Any public statement must be checked against the release snapshot. The existing real-case AI review still misses claims; its unsupported output is not a release-ready endorsed narrative. Use concise, separately attributed case-study notes whose individual statements have been reviewed, with links to retained passages. If AI drafts are exposed for illustrating the engine, retain their draft/review status and known limits. Do not silently promote or relabel them as verified insights.

Ship only an explicit, reviewed list of snapshot assets. Do not copy `.local`, raw QA output directories, credential stores, model request logs, user settings, absolute workspace paths or unrelated recordings into the public build. Inventory the exact selected excerpts and metadata before release. Removing or replacing content creates a new sanitized export: record its hashes, provenance and redaction notes, and regenerate/revalidate affected citations. Never keep an old integrity hash or “verbatim original” claim over modified bytes.

The snapshot preserves the task, attempt identities, selected recorded events, check definitions/results, source provenance, missing/truncated evidence notices and the one-pair limitation. Do not claim a universal model ranking, proven causal explanation, unmeasured memory usage or fresh live evaluation. Historical outcomes remain distinct from later evaluator results.

## Runtime architecture

Reuse the existing React/TypeScript/Vite interface with explicit capabilities for a **public demo** build. Public reads use checked, bundled JSON assets; local browser development and native Electron continue to use their existing readers. Centralize this selection in a small data-access module rather than scattering demo conditions through views. Unsupported public actions are omitted or replaced with useful explanatory actions, not dead buttons.

Public demo builds contain no local reader middleware and no provider-generation or file-import action. No backend, credential store, visitor account, live agent execution or provider key is required for the first milestone. Loading and interacting with the demo must not contact localhost, `/api/*`, a provider endpoint or the author's computer. A developer can run the built output on an ordinary static server with the repository's private data absent.

Host selection is an implementation/deployment choice to make after the local static build is verified; no hosting account, site or publication is assumed by this plan. Keep one hosting path for the eventual deployment. Publishing remains a separate explicitly authorized action after the concrete build and content inventory are reviewable.

## What changes and what remains internal

| Current element | Planned public behavior |
| --- | --- |
| Prototype 05 badge, About this prototype, Quiet Lab/design reference copy | Product identity, recorded-case context and a concise About view |
| Tasks 3, Saved cases, Activity, mock repository list | Removed from primary public navigation; demo-only flows remain isolated internally |
| RunSetup / RunLive simulated execution | Excluded from the public journey; never renamed to imply real execution |
| Existing C01 authored example | Review and adapt into explicitly authored case-study notes, without changing the historical raw record |
| Generated drafts and review diagnostics | Honest optional engine demonstration; pending/failed/stale states never appear as endorsed findings |
| API-key and regeneration actions | Absent in public mode; explain the desktop capability in About |
| Fixed read-only localhost connection | Bundled, versioned public snapshot; no local filesystem dependency |
| Keyboard palette | Same real destinations and actions as public navigation; no hidden links to fictional task screens |
| Browser fake window chrome | Simplified browser presentation; native Electron chrome remains native |
| Storage prefixes and native identity containing “prototype” | Preserve internally until a tested migration exists; cosmetic cleanup must not break encrypted credentials or preferences |

The `design-prototypes/` archive and ChatGPT mirror `sources/` are out of scope and remain untouched. Do not globally replace the word “prototype” across identifiers, storage keys or archives.

## Definition of shareable

- A clean browser profile can open the built app without local services, developer files, credentials or configuration.
- The first screen explains the practical problem and the result of one actual case.
- Every visible primary control works; navigation, reload, direct routes and keyboard focus are coherent.
- A visitor can inspect at least one meaningful difference and its evidence without reading raw logs first.
- Authored explanations, observed facts, check results and AI assessments are distinguishable.
- Public assets have an explicit reviewed manifest, fresh hashes and no secrets or unintended private content.
- Tested at desktop and narrow browser widths, with reduced motion, keyboard navigation, readable text and intact dialogs.
- README links, screenshots and any walkthrough describe the actual public build and its limits.
- A production static build works outside this checkout; deployment and link verification are still required before claiming it is publicly shareable.

## Later desktop milestone

Desktop usability and inference reliability continue alongside this work, but a signed desktop installer is not a prerequisite for the public recorded demo. Before distributing a desktop release, replace checkout-relative `.local` state with an injected writable application-data root, preserve/migrate credentials and preferences, generalize recording selection beyond the fixed C01/connection files, and validate packaging/signing on a clean machine. These are separate functional changes, not string renames.
