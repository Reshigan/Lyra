# ADR-0051 — The toast host is mounted; in-place notices stay the default

**Status:** accepted · 2026-08-11
**Context:** docs/ui.md §7.4 (P1-4), docs/15-experience-excellence.md §3

## Context

`ToastProvider` / `useToast` have shipped in `packages/ui/src/overlays.tsx`
since the design system was built and were mounted nowhere. docs/ui.md §7.4
counts the missing toast host among the five shell pieces the product never
wired up, and names the symptom: "a successful save is announced by an inline
green band that only appears if you happen to still be looking at that part of
the page".

The obvious over-correction is to move every outcome to a toast. docs/15 rules
that out: feedback belongs beside the work, quiet, and AI never toasts for
itself (docs/15 line 82).

## Decision

1. `ToastProvider` wraps the whole shell, so any screen can raise one without
   its own host. The dismiss control takes the caller's i18n string
   (`common.dismiss`), not the kit's English default.
2. Inline `role="status"` notices remain the default for an outcome whose
   control is still on screen — the settings save, the record action result.
   They are not migrated.
3. A toast is for an outcome whose origin has left the viewport: a background
   job that finishes while you are elsewhere, an action confirmed after a
   navigation, an error surfaced with a trace id to copy.

## Consequences

- The host renders nothing until something calls `useToast`, so mounting it
  costs one context provider and no pixels.
- A future background-completion surface has somewhere to speak from without
  re-opening this question per screen.
- Reviewers reject a toast that duplicates an adjacent inline notice.
