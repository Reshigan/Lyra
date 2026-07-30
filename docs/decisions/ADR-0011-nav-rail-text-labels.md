# ADR-0011 — The navigation rail carries text labels

- Status: accepted
- Date: 2026-07-30
- Context: docs/07 §3 (app shell), CLAUDE.md §8 (WCAG 2.2 AA), CLAUDE.md §7 (RTL)

## Context

docs/07-ui-design-system.md:36-37 specifies the left rail as a "module switcher
(5 glyphs, module-accent active dot), then module nav; **collapsible to icons**".
Read literally, the primary navigation for the whole product can be reduced to
five glyphs.

The shell as built does the opposite: every nav item renders its translated
label as text, at every breakpoint, with no collapse affordance
(`apps/web/app/components/shell.tsx:208`, the `<span className="truncate">`
holding `t(item.labelKey)`).

The driver was a direct user instruction during the build — *"menu must have
text as well"*. That is the honest reason this decision exists, and it is
recorded here rather than dressed up as a discovery. The supporting arguments
below are real, but they were assembled after the instruction, not before it.

- Discoverability. An icon-only rail costs every user a hover, or a memorised
  mapping, to answer "where am I and where can I go". LYRA ships eleven routed
  workspaces (`apps/web/app/routing.ts:7-19`), not five, so the "5 glyphs" the
  spec assumed no longer covers the rail.
- Accessibility. An icon whose only text is a tooltip is not equivalent to a
  label for a screen-reader user or for anyone at high zoom. CLAUDE.md §8 sets
  WCAG 2.2 AA as non-negotiable.
- i18n and RTL. Glyph sets carry cultural assumptions that a translated label
  does not. Every rail string already routes through `t(item.labelKey)`, and
  `apps/web/app/shell.test.ts:22-30` fails the build if a routed path has no
  `nav.*` key, so the labels are guaranteed to exist in every shipped locale.

## Decision

The rail is text-labelled, always. There is no collapsed state and no icon-only
mode.

- The module accent survives as a 1.5-unit dot marked `aria-hidden="true"`
  beside the label (`apps/web/app/components/shell.tsx:198-207`) — decoration
  that answers "which workspace" pre-reading, never the item itself.
- `item.icon` is still carried to the DOM as a `data-icon` attribute
  (`apps/web/app/components/shell.tsx:184`) so a later icon pass can decorate
  the label without a schema change or an API change.
- Below the `md` breakpoint the rail becomes a horizontally scrollable strip
  under the header rather than an off-canvas drawer
  (`apps/web/app/components/shell.tsx:141-146`). Labels stay on screen, nothing
  has to be opened to find out where you are, and the component holds no state.

docs/07 §3 is now wrong on this point. Per CLAUDE.md's definition of done
("Docs touched if behaviour diverges from /docs — spec-first, code follows"),
docs/07 §3 should be amended to describe a labelled rail. That edit is not made
here; this ADR is the record until it is.

## Consequences

- Horizontal space: the sidebar is fixed at `md:w-60`
  (`apps/web/app/components/shell.tsx:145`) and cannot be reclaimed. On a
  1280px-wide laptop that is roughly 19% of the viewport permanently spent on
  navigation. Dense screens — the trial balance, wide report tables — pay for
  this, and `overflow-x: auto` scroll containers inside the main column are the
  only remedy available.
- Long labels in verbose locales (German, and several Arabic renderings) will
  truncate rather than wrap; `truncate`
  (`apps/web/app/components/shell.tsx:208`) means the visible text can become
  ambiguous between two similarly-prefixed items. No `title` fallback is
  rendered, so a truncated label is currently unrecoverable without widening the
  window.
- The mobile strip scrolls horizontally. With eleven workspaces, items past the
  fourth or fifth are off-screen on a phone and require a swipe that has no
  visual affordance beyond the clipped item.
- docs/15 §4 pattern 5 ("whisper dots" — a 4px pulse on the *module glyph* in
  the rail) has no glyph to attach to. The accent dot is the nearest anchor but
  is currently `aria-hidden` and purely decorative. Implementing whisper dots
  will require deciding whether the dot becomes semantic, which is a separate
  decision.
- The design-system playground has no icon-rail story to regress against,
  because the mode does not exist. Reintroducing collapse later is a new
  component state, not a flag flip.
