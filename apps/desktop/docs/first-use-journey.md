# First-use journey

The desktop app now starts at a welcoming, optional example journey. Existing
workspace and legacy deep links still resolve; a fresh or unknown URL opens
Start here. This changes the first-use presentation, not the insight engine.

## Flow

- `#/welcome`: explain the purpose, explore a real example without setup, or
  go directly to importing a comparison.
- `#/example`: load the integrity-checked bundled public case independently
  of the user's active comparison. Present the result, one authored difference
  at a time, its practical meaning and its limitations. Show evidence opens the
  matched sources. Included recordings and evaluator results remain accessible.
- `#/import`: open a saved comparison through the native file picker, or return
  to the current workspace. Browser users see the native import requirement.
  No claim is made that this screen launches new agents.
- `#/comparison`: retain the existing insight workspace and evidence ledger.

The example does not import evidence, change the active pair, run analysis,
load provider settings, or require an API key. It uses the existing public
manifest/hash check and authored case notes. It does not turn those notes into
verified AI findings or a general model ranking.

Primary navigation contains Start here, Explore an example, and Your comparison.
Fictional task counts, prototype badges, repository samples and the old command
palette are outside this journey. Legacy prototype URLs remain available.

## Design guidance

Applied Apple HIG guidance on interactive onboarding, progressive disclosure,
clear action labels and purposeful motion. The view reuses the existing desktop
palette, modal, focus restoration and reduced-motion settings.

- https://developer.apple.com/design/human-interface-guidelines/onboarding
- https://developer.apple.com/design/human-interface-guidelines/disclosure-controls
- https://developer.apple.com/design/human-interface-guidelines/writing
- https://developer.apple.com/design/human-interface-guidelines/motion

## Verification

- First-launch regression observed failing before implementation, then passing.
- All 208 desktop tests pass; desktop and public-demo builds pass.
- Native manual checks: welcome, bundled file loading, switching differences,
  matched evidence, Escape dismissal and focus restoration, included-evidence
  drilldown, import picker cancellation, narrow native window and scrolling.
- Independent bounded source review reported no actionable findings.

These are implementation checks. A first-time human usability session is still
needed: can someone explain one useful model difference, find its evidence, and
identify how to bring their own task without coaching? The public demo retains
its separate existing shell; this change targets the desktop and local preview.

## Analysis workspace handoff

The analysis action now matches the next reversible step: provider setup,
evidence preview, or an explanation of why a new request is unavailable.
Provider/import tools live under Analysis options. The reading flow presents
analysis status before the expandable recorded-facts ledger.

Provider authentication and compatibility failures recommend settings while
retaining a separate Preview retry action. This is necessary because rotating
a key does not change the saved job's settings hash: the old failure can remain
after the provider configuration is repaired. Preview retry retains eligibility,
desktop and concurrency guards and opens the existing explicit-consent dialog.
Saving settings and opening previews never initiate analysis automatically.

Verification for this slice: 212 desktop tests, desktop build and public-demo
build passed. A real service regression verifies key replacement with an unchanged
settings hash and persistent failure, no automatic provider call, then a successful
explicit retry through an offline provider fixture. Independent review found the
recovery trap and confirmed its fix. Native checks covered the current failed-state
presentation, opening retry preview with unchecked consent/disabled generation,
and returning with the saved failure/history intact. The existing completion UI
QA script's selectors were updated and syntax-checked; that script was not rerun
in this slice. The new narrow-layout CSS was not separately verified in this slice.
