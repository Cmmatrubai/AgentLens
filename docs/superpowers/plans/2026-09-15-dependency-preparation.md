# Dependency preparation: first supported path

Continue the approved dependency-preparation milestone with a pnpm 11/macOS path. Project selection detects committed manifests and a lockfile. The user explicitly chooses installation; source-only runs remain available with a clear limit. Installation uses frozen dependencies, disables lifecycle scripts and pnpm hooks, isolates its home/store, and records local tool versions. No global tools are installed or credentials inherited.

Both detached copies must finish preparation before either agent starts. A failed, stopped or interrupted preparation starts no agents. Setup gets its own duration, output and outcome; agent time starts after preparation. Cancel and app shutdown abort preparation. Reopening an interrupted setup never retries it automatically and requires cleanup review if process termination is uncertain.

Implementation order: bounded plan detection and real subprocess tests; controller barrier and failure tests; compact setup UI and saved preparation details; native review plus regression checks. Preserve design-prototypes and the committed checkpoint.

The first path supports committed pnpm lockfiles with installed pnpm 11 and Node. Custom npmrc/pnpm hooks and external file dependencies require manual setup. Scripts-disabled installation does not guarantee native dependencies are usable. Preparation of post-run command-check copies and automatic runtime installation remain distinct follow-ups; the current check runner continues to state that installed dependencies are omitted.
