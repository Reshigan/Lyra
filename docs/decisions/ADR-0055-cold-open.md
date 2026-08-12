# ADR-0055 — The cold open is decoration that never holds the door

Status: accepted · 2026-08-12

## Context

Horizon opens with a cold open: the field lights, the constellation mark
draws, the tenant wordmark settles, and only then does the workspace read as
present. The product currently has none — the shell appears fully formed on
first paint.

A cinematic opening is easy to build badly. The failure modes are all the same
shape: something decorative gets in front of the work. A splash that blocks
paint costs LCP. A splash that owns focus costs a keyboard user their first
tab. A splash that animates for a user who asked for less motion is an
accessibility defect, not a flourish. And anything that renders differently on
first visit is a source of test flake.

## Decision

The cold open is a `pointer-events: none`, `aria-hidden` overlay painted over
an already-rendered shell, for one session, under three conditions — all of
which must hold or it does not render at all:

1. `prefers-reduced-motion` is `no-preference`.
2. `sessionStorage` has no `lyra_opened` mark (set on first render).
3. The document has already hydrated — the overlay mounts in an effect, so
   the server response never contains it and nothing waits on it.

It removes itself when its own animation ends, and its longest keyframe is
1.2s. It never traps focus, never renders text a screen reader must skip, and
never delays a route transition: the workspace beneath is interactive from the
first frame, including while the overlay is still fading.

## Alternatives rejected

**A route-level splash screen.** Anything that owns the route owns the wait —
the user is then looking at a logo instead of their queue, which is the exact
trade Horizon's own latency doctrine (docs/07) refuses.

**Play it on every navigation.** A transition effect between screens is a
different pattern with a different budget; repeating an opening makes it an
interruption. Once per session is what "opening" means.

**Persist the mark in a cookie.** A cookie is sent on every request for a
purely local, purely visual fact, and it makes the opening a once-per-device
event rather than a once-per-sitting one.

## Consequences

- e2e is unaffected: `playwright.config.ts` runs with `reducedMotion: "reduce"`,
  so condition 1 fails and the overlay never exists in a test run.
- The component is CSS-only — no dependency, matching the Horizon spec's
  non-goal "no new dependency; every effect in the design is CSS".
- A user who asked for reduced motion gets the workspace with no opening at
  all, which is the correct amount of cinema for that request.
