# ADR-0052 — No separate module switcher: the labelled rail is one

**Status:** accepted · 2026-08-11
**Context:** docs/ui.md §7.4 (P1-4), docs/07 §3, `packages/ui/src/nav.tsx`

## Context

docs/ui.md §7.4 lists a missing module switcher among the shell's unmounted
chrome. `ModuleSwitcher` (nav.tsx) renders a vertical list of `NavItem`s, one
per module, each carrying the module hue, the active mark and an optional
unread badge.

The shell's sidebar already renders exactly that: every workspace the actor may
open, in rail order, grouped under headings, labelled in words, each carrying
its module hue and its active state. Mounting `ModuleSwitcher` beside it would
put the same destinations on screen twice — the switcher's whole content is a
subset of the rail's.

docs/07 §3 describes a rail that collapses to icons, which is where a separate
switcher would earn its place. The shell overrides that deliberately (see the
header comment in `shell.tsx`): the rail never collapses, so the labels never
go away, so nothing needs recovering with a second control.

## Decision

No module switcher is mounted. The labelled sidebar is the module switcher.
`ModuleSwitcher` stays in `packages/ui` for a future surface where the rail is
absent — a compact or embedded shell.

## Consequences

- P1-4's "missing module switcher" is closed as covered, not as deferred.
- If the rail is ever made collapsible, this ADR is superseded: the switcher
  becomes the way back to the module list.
