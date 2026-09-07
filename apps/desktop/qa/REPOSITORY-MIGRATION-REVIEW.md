# Repository migration review

Reviewed September 7, 2026. Canonical checkout `/Users/chaitanyamatrubai/Agent lens`, branch `codex/desktop-integration`, committed HEAD `271b422ae5053bccc6d74fa5e86ba9b0e7aab01c`. Migration changes are uncommitted. Review used direct source Verify fallback because graph tools/index coverage were unavailable; no indexed-completeness claim. Source prototype remained preserved. Only this review report was written by the reviewer; no commits/pushes, external provider calls, or credential-content reads/decryption occurred.

## Findings and remediation

### P2 — Fresh checkouts lacked a first-import entry point (source fix verified)

The migration notes correctly exclude private `.local` data from a fresh checkout and direct users to Electron's Open pair. Initially, the only import button was inside InsightPanel, which RealComparisonView mounted only after a comparison had loaded. Without private C01 evidence or an already imported pair, users received an unavailable view with only Try again, so they could not perform their first supported import.

Parent added Open saved comparison directly to the unavailable Electron state. Source verification confirmed a guarded native import call, cancellation/error handling, stale-response protection, and a comparison refresh after successful selection. The offline QA harness now has an empty-start mode. Desktop typecheck passed after the fix. Native cold-start interaction is the parent's QA responsibility, not independently claimed here.

### Documentation correction — Root/package launch commands were mixed

`apps/desktop/README.md` initially told users to work from the repository root, then prescribed `pnpm dev` and `pnpm preview`, which exist only inside the desktop package. Root scripts are `pnpm dev:desktop` and `pnpm preview:desktop`. Use root command names consistently or explicitly scope package commands to `apps/desktop`. The linked real-run connection guide should similarly identify its `.local/connection.json` path relative to `apps/desktop`, rather than referring only to “this prototype.” Parent notified and owns documentation updates.

## Independently observed checks

- Branch and committed HEAD match the assigned migration target.
- Before the targeted cold-start fix, complete SHA-256 comparisons of the assigned migrated trees matched the preserved prototype: src 19 files, electron 4, server 18, tests 16, experiments 8. Python cache files were excluded from this comparison as intended. Subsequent UI/harness remediation is intentionally beyond byte parity.
- Git's source candidates contain no `.local`, node_modules, dist, credential.json, settings.json, or connection.json paths. `git check-ignore` confirms runtime link, dependencies, and builds are ignored. The runtime `.local` symlink exists and its target exists; the reviewer did not traverse credential contents.
- The imported historical source ZIP contains 17 members and no `.local`, node_modules, dist, .git, credential.json, or connection.json members.
- A bounded scan of textual source candidates found no high-confidence literal private-key header or long `sk-` token matches. This is not a universal secret-detection guarantee; screenshots/binary artifacts were not OCR-audited.
- Root `pnpm test` passed: **72 Vitest files / 1,519 existing repository tests**, followed by **84 desktop tests** through `node --import tsx --test`. No duplicate desktop collection occurs in the root Vitest globs, which target `test/`, whereas desktop uses `tests/` and its own Node runner.
- `pnpm --filter @agentlens/desktop typecheck` passed after the cold-start fix.

## Integration assessment

Root scripts now include desktop build, tests, and typecheck while retaining existing web/CLI paths. Desktop has a unique workspace package name and resolves its own React/Vite/TypeScript versions; its importer is present in the single root lockfile. Electron's install hook is enabled alongside existing permitted hooks. The desktop test command explicitly imports tsx, avoiding reliance on Node's newer native TypeScript stripping.

Readers and Electron load paths resolve relative to the migrated package, so canonical app code and existing private runtime data remain separate. The recording connection supplies its external reader runtime/repository explicitly, and archived comparison evidence uses the imported package's preserved frozen inputs. The migration makes no provider call by opening or reading the app. Vite's private-path exclusions are retained; the desktop regression denying private connection and real-run QA routes passed as part of the 84 tests.

## Evidence limits and disposition

Tests above ran on observed Node v26.7.0 and pnpm 11.25.0. The Node 22.12 floor is reflected in configuration and the tsx test wrapper, but this reviewer did not execute Node 22.12 or perform a new frozen install. Root build and frozen-install results reported by the parent were not independently repeated. Actual browser/Electron visual acceptance and reusable safeStorage ciphertext across the package-name change are also parent-owned validation boundaries; no real credential was accessed by this review.

At report time, the substantive cold-start migration defect is source-fixed and typechecked. The command/documentation correction is pending parent confirmation. No additional substantive migration, root-test integration, or private-source-exclusion defect was found in the bounded review. This report does not certify a packaged release, imported insight quality, or historical live-provider results.

## Migration follow-up — September 7, 2026

The root-command and connection-path documentation corrections are source-verified. The parent reports successful manual native empty-start import; this reviewer independently verified its source path earlier but did not duplicate the native session.

The parent also confirmed the native-identity concern with synthetic noncredential ciphertext: old-name encryption did not decrypt under the renamed package identity and did decrypt after restoring the legacy native identity. Source review confirms `electron/identity.cjs` sets both the app name and userData path to `agentlens-desktop-prototype`, and `main.cjs` applies it before requesting the instance lock or installing the credential boundary. The smoke helper operates on its fixed noncredential marker and explicit artifact path; it does not load real saved credentials. These native results remain parent-observed, not reviewer-executed.

`pnpm test:desktop` independently passed **85/85**. However, a new material migration privacy finding prevents final approval:

### P2 — Restrict Vite's workspace-wide filesystem allow list

The resolved migrated Vite configuration allows the entire canonical repository (`server.fs.allow` contains the AgentLens root), not just apps/desktop and its dependencies. The newly added neighboring-file regression passes on macOS because `tmpdir()` returns `/var/...`, while Vite canonicalizes the allowed directory to `/private/var/...`; requesting the alias fails incidentally.

A reviewer-run isolated synthetic reproduction canonicalized the temporary workspace with `realpath`, supplied workspace/package metadata, and requested the canonical `/@fs` path of `private-marker.txt` outside apps/desktop. It returned **HTTP 200** and the synthetic marker. No real private file or credential contents were read. This shows the imported configuration broadens access to neighboring repository files.

Set an explicit development `fs.allow` limited to the desktop package plus the necessary dependency location, and canonicalize test paths so the regression proves the actual intended boundary. Parent notified and owns remediation. Disposition is pending that correction; the initial import/docs/identity findings are now resolved at their stated evidence levels.

## Final filesystem remediation verification — September 7, 2026

**Final disposition: approved within this bounded migration review. All reported material migration findings are resolved at the evidence levels recorded here.** Earlier findings remain as review history, not outstanding defects.

Independently checked the final Vite configuration: the resolved filesystem allow list is now exactly `apps/desktop` and the repository `node_modules` directory, rather than the entire repository. Existing sensitive-path deny patterns remain in place. The new regression canonicalizes its temporary workspace through `realpath`, so it no longer relies on the incidental macOS `/var` alias refusal.

Reran `node --import tsx --test tests/private-files.test.ts`: **2/2 passed**. This includes the canonical neighboring-workspace denial and the existing private connection/QA route denial, while retaining HTTP 200 for an ordinary desktop public file. The full desktop suite's previously observed 85/85 result precedes this small configuration fix; the parent owns the final full-suite rerun and development-asset/browser acceptance under the narrowed allow list.

No real private/credential contents, provider calls, commits, or pushes were involved in verification. Remaining release/quality/Node-version/native evidence limitations above are unchanged and are not unresolved code-review findings.
