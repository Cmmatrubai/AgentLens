# OpenAI-compatible endpoint review

Reviewed September 7, 2026, using exact source with Verify fallback. Graph tools were unavailable; no graph completeness claim. Scope: new endpoint behavior in `server/insights/{endpoint,provider,service,runtime}.mjs`, `electron/insight-credentials.cjs`, `src/{InsightPanel.tsx,insight-types.ts,insights.css}`, `tests/insight-compatible.test.ts`, and updated service tests. No source changes, provider/network calls, native/browser interactions, or subagents; only this requested report was written. The prototype is untracked, so this review used current source rather than an empty Git diff.

## P2 — Bind the preview checkbox to the reviewed settings snapshot

Locations at review: `src/InsightPanel.tsx:333-341`, `378-409`, `867-890`.

A pending Save settings request can outlive closing the settings modal (Close remains enabled). The user can then open Preview & generate because that entry point does not check `actionBusy`, and check consent while the old endpoint is still displayed. When Save resolves, `accept()` replaces `insight`, including destination and settingsHash, without clearing the open consent or checked checkbox. Generate becomes enabled after busy clears and sends the new live `insight.settingsHash`/endpoint. The server's settingsHash validation therefore succeeds even though the checkbox was checked against the previous destination.

Fix by capturing the reviewed input/settings identity when preview opens and using it for generation, closing/resetting consent whenever either identity changes, and disallowing preview entry during pending settings mutations. This is a concrete source-derived async ordering finding, not a claimed native/browser reproduction. Parent notified and owns the fix.

## Observed verification

- `node --test tests/insight-*.test.ts`: **47 passed, zero failures**.
- `pnpm exec tsc --noEmit`: **passed**.
- The new compatible endpoint suite uses injected fetch responses and temporary local state; no actual provider calls occurred.

## Verified boundaries

- Endpoint normalization permits HTTPS and named/canonical loopback HTTP, rejects credentials/query/fragment components, and retains API prefix paths. Fetch redirects are rejected.
- Both Responses and Chat Completions payloads are selected explicitly. JSON-schema, JSON-object, and prompted-JSON modes remain explicit choices; source shows one fetch attempt and no automatic retry/fallback. All successful responses still pass the existing source-bound output validator in the service.
- No-key mode passes null credentials and omits the Authorization header. Bearer credentials are encrypted locally and bound to the complete normalized base URL, including path; legacy credential binding defaults only to the former OpenAI base URL. Changing a bearer destination without providing a matching key cannot start enabled analysis.
- The server validates the submitted settings hash before fetching credentials/reserving a paid job. Provider base URL, API format, output format, auth mode, model, and analyzer versions enter job/cache identity. Changing the endpoint makes the prior result stale and rejects old consent hashes.
- The renderer clears typed keys on endpoint/auth-mode edits, uses a password field, and displays the configured destination in the consent modal and saved analysis details. No browser key storage or logging was introduced.
- Provider response failures remain sanitized, refusal/incomplete/tool-request cases are rejected, request/response limits persist, and both usage formats are normalized to the shared shape.

No additional substantive P1/P2 endpoint or credential-binding issue was found in the bounded review. The outstanding consent race above prevents approval until corrected. Actual endpoint/network interoperability, native UI behavior, provider latency/billing, and semantic insight quality were not verified here; the parent owns native and loopback mock integration QA.

## Consent remediation re-verification — September 7, 2026

**Final disposition: approved within the bounded endpoint/source review. The reported P2 consent race is resolved.** The initial finding above is retained as review history.

Independently inspected the exact UI fix: preview opening captures `inputHash` and `settingsHash` into `consentInput`; generation submits those frozen values, not the subsequently mutable insight state. Changes to either current hash close the consent dialog, clear its checkbox, and discard the frozen identity. Both preview entry and generation reject an active mutation, and the normal generation control is disabled during mutation. Thus a delayed settings response cannot silently substitute a newly approved destination; even a transient render before the clearing effect would send the old frozen hash, which the reviewed backend rejects before provider activity.

`pnpm exec tsc --noEmit` passed after this fix. This is exact-source and type-check re-verification only; native interaction and provider/network calls were not performed by this reviewer. No additional P1/P2 finding remains in the assigned change scope. The earlier 47/47 focused backend test result and acceptance limits remain as recorded above.
