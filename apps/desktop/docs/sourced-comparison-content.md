# Sourced comparison content

## Personal selection contract

- No selected file returns `comparison_not_selected`; the UI offers starting a comparison, opening saved work, or explicitly exploring the example.
- An unreadable or invalid saved selection returns `comparison_unavailable`. Preserve the file for recovery. Never substitute development-case results.
- Normal file import accepts a supported normalized comparison. The checks-section action additionally requires evaluated check data before writing the selection. Missing and unknown outcomes are not converted to passes.
- Imported results remain author-supplied evidence, even if the file asserts desktop provenance. Opening an evaluated comparison selects that pair; it does not evaluate or modify the prior recordings.
- AI explanations use the configured compatible endpoint and its authentication requirements. Local evidence inspection does not need an analysis key. Example navigation does not delete the personal selection.

## Verification on 2026-09-15

`pnpm test:desktop`: 265 passed. `pnpm typecheck`, `pnpm build:desktop`, and `pnpm --filter @agentlens/desktop build:demo` passed.

Native QA used `pnpm exec electron qa/sourced-content.cjs` after the desktop build. This harness uses temporary selection storage, the production reader/parser/runtime and built renderer, and a minimal QA IPC wrapper. It disables analysis generation. It is not a packaged-install test or a substitute for testing the production IPC security boundary.

Observed in Electron:

1. A fresh temporary selection displays **No comparison selected yet**, with explicit personal and example routes.
2. Opening the real Sol/Terra live recording without evaluations displays **No check results yet** and the evaluated-import action.
3. Choosing that same unevaluated file through the evaluated-import action displays a rejection and preserves the comparison. Automated coverage separately verifies exact saved-file bytes remain unchanged.
4. Explicitly importing `public/demo/comparison.json` through that action opens the real preserved C01 case, with seven supplied checks per attempt and the imported-provenance explanation. This occurred only in temporary QA selection storage.

## Remaining work

Desktop check execution is not implemented by this slice. Add success-condition definition, evaluation against both isolated attempt snapshots, durable evidence, and useful failure/cancellation states next. Complete the broader product-content audit before claiming all placeholder content has been removed. Dependency preparation and distributable installation remain separate release milestones.
