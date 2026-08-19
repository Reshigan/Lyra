# ADR-0068 — Chrome bands: the status strip stays, the module band is a rail

Status: accepted · 2026-08-19
Context: docs/07-ui-design-system.md §3, the Horizon comp
(`horizon-1-shell.md` §5 in this build's scratch analysis), and the six
shells that ship today (`shell.tsx`, `axis-shell.tsx`, `north-shell.tsx`,
`orbit-shell.tsx`, `scout-shell.tsx`, `signal-shell.tsx`).

## Context

Tokenising the frame (`packages/ui/src/tokens.css` chrome/gutter/rail scale,
gated by `apps/web/app/components/frame.test.ts`) surfaced two places where
the shipped chrome and the design source disagree. Both had been settled in
code without being written down, so every later reader had to re-derive the
answer from the diff.

1. **Status strip.** The Horizon comp §5.10 says "No status bar / footer
   bar." All six shells render one — a 28px strip carrying live tenant,
   environment and clock state.
2. **Module band.** The comp puts a 38px horizontal module band under the
   50px top bar. docs/07 §3 describes a collapsible icon rail. The code
   ships a text-labelled vertical rail. Three sources, three answers.

## Decision

**The status strip stays, as a real layout band.** It carries state a user
needs continuously (which tenant is being served, which environment, the
sim clock) — exactly the content a footer strip is for, and content that has
nowhere else to live now that the top bar is full at 320px. What was wrong
was not its existence but its geometry: it was `sticky bottom-0`, an overlay
that ate the last 28px of both rail and canvas on every page. It is now a
`shrink-0` flex band of `--chrome-status` below the split, so nothing is
covered.

**The module band is the vertical rail, not a 38px horizontal bar.** This
confirms in writing the override already recorded inline in `shell.tsx`:
labels beat icons for ~130 tabs across five modules, and a vertical rail has
room for text where a 38px bar does not. `--chrome-module: 38px` survives as
the *mobile* module strip's minimum height — on a phone the rail collapses
and the horizontal strip is what remains, so the comp's number is still
load-bearing there.

Rail width follows the comp: `--rail-width` is `196px`, stepping to `252px`
at `min-width: 1240px`. The previous flat `240px` (`md:w-60`) matched
neither source.

## Consequences

- docs/07-ui-design-system.md §3's collapsible icon rail is superseded for
  the five module shells. It still describes the intent (a persistent
  module-scoped nav); it no longer describes the control.
- The comp's "no footer bar" line is superseded. A reviewer comparing a
  screenshot to the comp will see a 28px band that the comp does not have;
  that difference is intended and lives here.
- Removing the strip later is a six-shell change plus their tests, not a
  token change — the band height is one token but the markup is per shell.
- The Meridian scrubber ports the comp's three tick weights (13/7/4px) on
  hour semantics rather than the comp's 29-tick count: 29 ticks cannot land
  on 24 hourly intervals, and the hour is load-bearing (shift+arrow steps
  1/24, `aria-valuemax=1440`). The decision came across; the artifact did
  not.

## Not decided here

The overlay z-index ladder. The comp uses 90/88, `packages/ui/src/overlays.tsx`
uses 40/50, and `apps/web/app/routes/design.tsx` uses 95 — three ladders that
must move together or keep drifting. Left for its own change.
