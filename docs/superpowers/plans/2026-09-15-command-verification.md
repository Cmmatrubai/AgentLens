# Command verification implementation plan

**Goal:** Run one user-named command against fresh copies of both completed desktop attempts and display durable, source-linked command outcomes.

**Design:** The live controller supplies trusted completed-run identities and canonical workspace paths. A separate check service copies bounded tracked and untracked nonignored files, hashes the snapshots, runs the same command sequentially in macOS write-restricted/network-disabled sandboxes, and journals each check run. This is command verification, not independent test-assertion grading. Original attempts and earlier evaluation runs stay preserved. Missing dependencies are not installed automatically.

**Execution:** Implement inline in the existing checkout, preserving unrelated work. No commit, merge or push in this slice.

- [x] Add snapshot and subprocess tests: copy original changes/deletions, reject symlinks and oversized inputs, preserve original files, real pass/fail/timeout/cancellation, bounded output, external-write denial.
- [x] Implement `server/live/check-snapshot.mjs` and `check-process.mjs`. Restrict writes to the new copy, disable network, scrub inherited credentials, kill the process group on stop/timeout, and report interrupted execution as unknown.
- [x] Add `check-service.mjs`: validated title/command/time limit/consent; durable unique run journal; one active check run; no automatic retries; restart marks in-progress work interrupted and requires cleanup acknowledgment; validate saved outcomes and artifact hashes before projection.
- [x] Connect trusted live-controller context, IPC, preload and shared types. Preserve original recording status; add check results only to explicit comparison projections with command-verification provenance. Shut down checks before app quit.
- [x] Add a compact `LiveChecks` UI with condition, command, duration limit, consent, progress, stop, reload recovery, output inspection and open-comparison action. Make it reachable from the completed workspace and the missing-check section.
- [x] Verify with real local fixture commands, controller/projection tests, desktop regression suite, typecheck/build and native Electron UI. Record limitations and exact results in the desktop docs.

**Failure semantics:** Nonzero normal exit means the command failed. Timeout, cancellation, launch/snapshot failure, interruption or unconfirmed cleanup means unknown. Preserve output limits and distinguish environment/setup failures from an assertion-level correctness conclusion. A stopped or failed evaluator does not invalidate the underlying agent recordings.

**Platform boundary:** First implementation targets macOS, using the system sandbox with no unsandboxed fallback. The CLI sandbox probe showed version-dependent invocation semantics; the native macOS profile was directly verified to allow writes in the evaluator copy and reject an external write. Other platforms receive an explicit unavailable state.

**Execution result (2026-09-15):** Implemented and tested in the normal Electron app with the real retained Sol/Terra draft-retention attempts. The same post-hoc nested-field check passed for Sol and failed for Terra with its assertion output preserved. 281 desktop tests, root typecheck, desktop build and public-demo build passed. See `apps/desktop/docs/command-verification.md` for identities, boundaries and follow-up work.
