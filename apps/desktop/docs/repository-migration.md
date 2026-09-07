# Desktop source migration

The iterated desktop app is now the **@agentlens/desktop** package at **apps/desktop** in the AgentLens repository. The UI and evidence/analysis behavior were preserved; this migration does not turn sample execution into real orchestration or resolve the recorded provider output-limit failures.

## Commands

Run from the repository root, using Node.js 22.12 or newer:

| Command | Purpose |
| --- | --- |
| pnpm desktop | Build and open Electron |
| pnpm dev:desktop | Browser development at 127.0.0.1:5177 |
| pnpm build:desktop | Desktop type check and production build |
| pnpm preview:desktop | Serve the built browser preview at 127.0.0.1:5177 |
| pnpm test:desktop | Desktop tests through Node and tsx |
| pnpm test | Existing repository tests, then desktop tests |
| pnpm typecheck | Existing repository type check and desktop type check |
| pnpm build | Existing TypeScript/web build and desktop build |

The desktop and existing web package retain their own React, Vite and TypeScript versions. Dependencies are pinned by the single root pnpm-lock.yaml; the prototype's standalone lockfile is superseded.

## What moved

Source/UI, Electron integration, read-only evidence readers, the insight engine, tests and synthetic fixtures, frozen C01 experiment inputs and tooling, documentation, review reports/screenshots, and the original small source archive were imported. Dependencies, generated builds, Python caches, private runtime files and local QA data snapshots were excluded from imported source.

The original prototype source remains available as a backup. New development belongs in apps/desktop.

## Existing local evidence

On the migration machine, apps/desktop/.local is a **Git-ignored symbolic link** to the original private runtime directory. This keeps the preserved comparison, recording connection, encrypted provider key and analysis history available without copying any of them into tracked source. No live provider request is part of migration verification.

The link is local setup, not part of a fresh clone. Do not delete the original private data directory while using it. To relocate data later, stop both app instances, copy that private directory with its owner-only permissions intact, then point the ignored .local link at the new location. Keep frozen manifests, permission records, hashes, recording archives and original failed analyses intact.

A new checkout can run sample flows immediately after installation. Supply a recorded-run connection as described in [real-run-connection.md](real-run-connection.md), or use Electron's **Open saved comparison** with the [saved comparison format](insight-comparison-bundles.md), to inspect real evidence.

## Scope

This source migration was prepared on codex/desktop-integration. It is not a signed installer, a replacement of the existing web UI, an integration of the separate Flight Console work, or evidence that live AI findings are validated. The initial verification reports record the state before the subsequent user-authorized merge and push to main.

## Migration compatibility

Electron retains the previous native app identity and user-data location so existing encrypted credentials remain compatible with the renamed workspace package. This was verified using synthetic ciphertext; migration verification did not decrypt the real provider key.

The development server only allows the desktop directory and workspace dependencies, with sensitive paths denied. Historical QA reports are retained as history; excluded local data snapshots are not supplied by a fresh clone. See [verification results](../qa/REPOSITORY-MIGRATION.md).
