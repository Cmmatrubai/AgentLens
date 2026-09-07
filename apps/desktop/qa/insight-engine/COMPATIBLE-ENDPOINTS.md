# Configurable endpoints — verification addendum

Date: September 7, 2026. Scope: the isolated desktop-prototype-v1 insight engine. This supplements the original REPORT.md; it does not revise the frozen C01 results or claim live AI quality acceptance.

## Implemented

- Configurable base URL with Chat Completions and Responses adapters.
- Provider bearer keys or explicit no-key mode.
- Strict JSON schema, JSON object, and prompted JSON compatibility settings. All results pass the existing local schema and source-reference checks.
- Encrypted credential binding to the full normalized endpoint; no forwarding a saved key to a changed provider.
- Provider settings participate in cache identity, saved revision provenance and reviewed consent.
- Consent freezes the reviewed settings/evidence hashes and resets if they change. Preview and generation are blocked while a settings mutation is pending.

## Observed verification

- Full suite: **84/84 tests passed**, including 8 endpoint tests.
- Production TypeScript and Vite build passed.
- Actual Node HTTP loopback mock server received a non-streaming Chat Completions request with JSON object mode; the adapter parsed its response. The mock was closed after the test.
- Mocked provider tests covered another bearer key, keyless prompted JSON, invalid/insecure destinations, refusals, truncated/tool responses, endpoint credential binding, stale provider settings, cache separation and consent rejection.
- Existing reviewer rechecked the consent fix and approved it within the bounded scope; see compatible-review.md.

Native Electron UI acceptance used offline-desktop.cjs with a synthetic pair, temporary settings/jobs and an injected analyzer. HTTP/HTTPS renderer requests were blocked; the injected analyzer made no provider request. In that harness:

1. Set API base URL to http://127.0.0.1:1234/v1 and analysis model to offline-findings.
2. Selected no-key mode; the key field became disabled with “No key will be sent.”
3. Expanded API compatibility, confirmed Chat Completions was selected on destination change, and selected Prompted JSON.
4. Enabled and saved settings.
5. Opened Preview & generate and verified its displayed destination/model. Scrolling reached the explicit consent control and generation stayed disabled until checked.
6. Generated one synthetic finding, then opened Analysis revision details. The saved endpoint and both format settings matched the configuration.

The desktop form and evidence preview were inspected visually. No external provider credential was used and no original recording or real comparison was analyzed. Live third-party compatibility, model-specific parameter support, latency and generated finding quality remain unverified.
