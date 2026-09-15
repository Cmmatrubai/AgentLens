# Local evidence checks for insight findings

The `import-facts-v1` policy supplements AI support review with a conservative named-import check. It can withhold an AI-supported claim. It never upgrades an AI concern, rewrites the draft, or replaces the original provider response.

## Evidence boundary

A complete newly added JavaScript or TypeScript regular file can be reconstructed from its saved final Git diff. The extractor checks the source hash, truncation flag, exact file headers, a single full-file addition hunk and its line count before parsing with Babel. Modified-file hunks, command output, agent reports, unsupported languages, malformed syntax and incomplete captures remain unknown. Complete added files with no imports produce no positive import facts; that does not establish absence elsewhere in the repository.

Each positive named-import fact includes an ID, source ID/hash, attempt key, file path, line, module, imported/local binding names, type/value distinction and the saved declaration. Aliases and type-only imports are retained as facts but cannot satisfy the currently supported value-import claim form.

Matching is intentionally narrow: an observation such as `North imports both QUEUE_LIMIT and warnOverflow from "./policy" into src/entry.ts.` must identify its own attempt, exact module and path. All requested unaliased value bindings must occur in the same cited complete file. Matching proves declaration presence in that saved file, not runtime behavior, task success or general implementation quality.

Other wording that mentions imports remains unresolved. Import word spans are located in the original draft unit, so an AI reviewer cannot bypass the policy by splitting `imports` or `imported` between its claim fragments. This is a bounded language check, not a general detector of all code-relationship paraphrases. Causal, guard and other semantic claims still need separate evidence and evaluation.

## Persistence and presentation

The local policy version participates in the review identity and consent key. Reviews from an older policy become stale; reading does not launch a paid request. Raw saved drafts and provider outputs remain unchanged. Wire/schema validation and historical semantic scoring retain their existing meanings.

The claim inspector distinguishes “Local evidence check · Needs review” from the preserved original AI assessment. Matched facts show their declarations and saved identities on demand. A matched import does not upgrade a provider verdict of `needs_review` or `unsupported`.

## Regression evidence, 2026-09-14

The offline C01 replay uses the frozen original draft and the saved exact-unit reviewer output from run `12f8d39a-cdef-4bfd-8dc5-f8695e58468f`. The false import claim changes from the provider's `supported` to effective `needs_review`. No C01 sources qualify as complete added files, so no import facts are invented. The replay checks source guards and confirms all three input files remain unchanged; it makes zero provider requests.

Run the optional local replay with `node qa/insight-engine/check-c01-import-policy.mjs` from the desktop app directory. It requires the existing private fixtures. Portable tests use synthetic files and run without those private artifacts.

The automated controls cover a matching true import, local definition versus import, wrong attempt/module/path, aliases, type imports, comments/string literals, malformed/truncated sources, hash mismatch, provider claim splitting, persistence and the inspection UI. This is a regression result, not a semantic-accuracy estimate or human review. A human audit and fresh held-out tasks remain required before expanding automatic promotion.

### Verification of this development slice

- 189 desktop tests passed.
- Desktop and public-demo builds passed.
- Native Electron acceptance passed with temporary data and network access disabled: withheld claim, original AI assessment, matched declarations, source identity and reload.
- Claim labels now follow raw-draft attempt identity even when display ordering differs. The claim inspector was visually inspected; import declarations shared by multiple bindings are shown once.
- An independent agent review found the claim-splitting bypass; after its fix, 26 token split positions were rechecked. A further bounded review found no attribution issues.

These checks cover this slice. They do not replace the outstanding clean-checkout release check, human audit or fresh-task evaluation.
