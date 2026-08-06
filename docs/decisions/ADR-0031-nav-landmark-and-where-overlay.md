# ADR-0031: Keep the persistent nav landmark; fold the design's "Where" overlay into ⌘K

## Status

Accepted, implemented.

## Context

The Horizon design (`Lyra Horizon.dc.html`, DesignSync project
`2c81f410-f688-45f3-abb3-904498f9c06d`) has no sidebar. Its shell is a 50px top
bar and a full-bleed workspace; navigation lives in two overlays reached from
that bar — an **Ask** overlay (search and commands) and a **Where** overlay (the
list of workspaces). The rest of the design — hairlines instead of shadows, the
eyebrow/serif/mono type grammar, the 2px module hue, the ✦ marker — has been
adopted wholesale (ADR-0026 covers the palette and type swap).

Navigation is the one place adopting it wholesale would cost something the
design cannot see:

- **WCAG 2.2 AA is a stated requirement** (CLAUDE.md §8). SC 2.4.5 "Multiple
  Ways" wants more than one route to a page; an overlay-only nav leaves exactly
  one, and it is behind a keystroke or a button press.
- The shell's `<nav aria-label>` landmark is what a screen-reader user jumps to
  with the rotor. An overlay that only exists while open is not a landmark, so
  the primary structure of the product would disappear from the landmark list.
- Current location is read off the rail (the module hue beside the active item).
  Behind an overlay, "where am I" needs the overlay opened to answer.
- The rail is already grouped and already filters destinations this actor
  cannot open (`routedLeaves` in `shell.tsx`). That work has no home in a
  design that has no rail.

## Decision

1. **The persistent `<nav>` stays.** Two landmarks, same `nav.primary` label:
   a scrollable strip under the header on small screens, a sticky 240px rail
   from `md` up. This is the documented divergence from the Horizon shell; the
   top bar, its 50px height, the ask bar and everything below the header follow
   the design.
2. **The "Where" overlay is not built as a second overlay.** Its content —
   every destination this actor may open — becomes the first block of the
   existing ⌘K palette, under a `search.goTo` heading, above the `search.results`
   block. One overlay answers both of the design's questions: *what is this* and
   *where do I go*.
3. **The palette's destinations are the nav's own.** `Shell` passes the same
   already-filtered `items` it renders in the rail, so a path the rail refuses
   to link (unrouted, or not offered by `/v1/me`) is not reachable from ⌘K
   either. There is no second entitlement path to keep in step.
4. **`CommandBar` groups rows in the caller's order.** `groupCommandItems`
   collects a *run* of the same `group` into one block; the same name appearing
   again later starts a second block rather than being merged upward, because
   the caller's order is its answer about relevance. Each block renders as a
   `role="group"` with an `aria-label`, so the heading is announced and not just
   drawn.

## Consequences

- Two ways to every screen, both keyboard-reachable: the rail (a landmark, in
  the tab order) and ⌘K. SC 2.4.5 holds without a sitemap page.
- The design's uncluttered workspace survives on small screens, where the rail
  is a one-row strip and the ⌘K destination block is the practical nav.
- `CommandItem.group` stops being a declared-but-ignored field; anything else
  the palette grows (actions, docs) already has a place to sit.
- Divergence is contained to navigation. If a later horizon wants the
  overlay-only shell, the ⌘K destination block is already the whole overlay —
  what would change is only whether the rail also renders.
