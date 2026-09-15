# Model picker

The live setup uses a searchable Radix Popover and cmdk list for each agent. Names and descriptions come from the local Codex `models_cache.json`, read in the main process. Only visible entries with valid IDs and a reasoning level supported by the launcher are offered. This is cached metadata, not an entitlement check; access is checked by Codex when execution starts. No model or analysis request is made when opening the list.

The source date is visible below the controls. Reload rereads the local cache; it does not refresh it from the network. Missing or incompatible cache data offers recovery instructions. Previously selected IDs remain visible and are labeled when absent from the cache. Provider instructions and unrelated cache metadata never cross the model-list IPC boundary. The reader bounds file size, rejects nonregular files and symlinks, and ignores renderer-supplied paths.

Selecting a model preserves a compatible reasoning level, or switches to a supported one, and resets launch consent. Identical model/effort pairs are explained before launch. Draft retention remains confined to the renderer session.

The dropdown supports search, arrow-key navigation, Enter selection, Escape dismissal, focus return, scrolling and viewport collision handling. Short origin-aware entry/exit animations and a rotating chevron provide feedback. OS reduced motion and the app's motion preference suppress movement. Built using the [Radix Popover interaction and positioning API](https://www.radix-ui.com/primitives/docs/components/popover).

Native Electron verification on 2026-09-15: real cached model names loaded, searching for a nonexistent model showed the empty state, searching for Luna and pressing Enter selected it and restored trigger focus, and Escape dismissed the menu without changing the choice. Visually inspected both the controls and the menu flipping above a trigger near the bottom edge. No paid model run was started. Parser and IPC tests cover malformed/missing/oversized catalogs, hidden/duplicate entries, supported reasoning, normalized output, foreign frames and ignored renderer paths.

The Codex cache is an internal integration boundary and may change across CLI versions. A supported live model-discovery API can replace this adapter later without changing the picker contract. Installer readiness and automatic dependency preparation remain separate work.
