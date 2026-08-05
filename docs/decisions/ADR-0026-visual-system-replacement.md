# ADR-0026: Replace "Deep Field" palette/type with the mockup visual system

## Status

Accepted, implemented.

## Context

The imported Claude Design mockup (`Lyra Platform.dc.html`, DesignSync project
`d7cc4e0e...`) ships its own palette, module accents, and type stack, and the
user's binding instruction is to replace the current "Deep Field" system with
it wholesale, not graft it on screen-by-screen.

The mockup's `<style>` block (`:root` + `[data-theme="light"]`) gives exact
values:

- Dark: `--bg:#0B0E13 --s1:#10141D --s2:#161C28 --s3:#1C2432`,
  borders `#1B212C/#232B38/#333D4E`, text `#EDF1F7/#AEB6C6/#8A94A6/#5C6779/#3F4959`,
  accent (lime) `#C8F163` / hover `#DBFF85` / fg `#0B0E13`, status
  `ok:#55D68C warn:#E8C266 bad:#F08A80`, module accents
  `axis:#E8A33D orbit:#3FC9B4 signal:#F0764F scout:#6C9EF0 north:#A98BE8`.
- Light: `--bg:#F5F6F2 --s1:#FFFFFF ... --acc:#4A6A0F` (a darker lime for AA on
  white — same pattern the old palette already used for vega-600).
- Type: Archivo 500/600/700 (display/headings), Instrument Sans 400/500/600
  (UI/body), Instrument Serif italic (Login hero only, 5 occurrences in the
  mockup — not a new typography role), IBM Plex Mono 400/500 (metrics/ids/code).
  The mockup loads these from `fonts.googleapis.com`; CLAUDE.md/docs/02 §9
  does not list a font CDN, and self-hosting is already this repo's pattern
  (Space Grotesk/Inter/IBM Plex Mono/IBM Plex Sans Arabic are all self-hosted
  today via Fontsource-sourced `.woff2` in `apps/web/public/fonts`) — so the
  new faces are self-hosted the same way, not linked from Google's CDN.

## Decision

1. **Values change, token names don't.** `packages/ui/src/tokens.css`'s raw
   palette keeps its existing custom-property names (`--ink-900`, `--star-100`,
   `--star-300`, `--star-500`, `--vega-500`, `--vega-600`, `--module-axis`,
   etc.) and Tailwind utility names (`bg-ink-900`, `text-star-300`,
   `module-axis`, ...) — only the hex values move to the mockup's. Five files
   already consume these utilities directly (`shell.tsx`, `primitives.tsx`,
   `overlays.tsx`, `nav.tsx`, `ui.test.ts`); renaming would touch all of them
   and every Tailwind class string in ~49 screens for zero behavioural gain.
   New tokens the mockup introduces with no existing equivalent (`--acc-soft`,
   `--acc-line`, `--warn-bg`, `--warn-line`, `--bad-bg`, `--hatch`, `--heat-fg`)
   are added additively under those same descriptive names.
2. **Faces are self-hosted**, not linked from `fonts.googleapis.com`, matching
   the existing five-face pattern in this file: `font-display: swap`,
   `woff2`-only, Latin/Arabic `unicode-range` split. Instrument Serif ships as
   one static italic cut (Login only — not wired into `--font-display`/
   `--font-ui`, so no other surface can accidentally pick it up).
3. **Semantic role tokens** (`--bg`, `--surface-1..3`, `--border`,
   `--border-strong`, `--text`, `--text-muted`, `--text-subtle`, `--accent`,
   `--accent-hover`, `--accent-contrast`, `--success`, `--danger`, `--warning`,
   `--info` + their `-contrast` pairs) keep their existing names and dark-first/
   light-remap structure; only the values they resolve to change, re-verified
   for AA per `--text-subtle`/`--success`'s existing failed-AA comments in this
   file (same discipline applied to the new lime accent on light: `#4A6A0F`
   text on white, not the dark-mode `#C8F163`, which fails AA as text).
4. **Tenant override contract is unchanged** — still exactly `--accent`,
   `--accent-hover`, `--accent-contrast`, `--font-display`, `--font-ui`
   (docs/01 §6). Module identity accents (`--module-*`) remain non-overridable
   product identity, not brand, per docs/07 §6.

## Consequences

- Near-zero blast radius on existing component code: no `bg-ink-900` /
  `text-star-300` / etc. class string anywhere in the ~49 screens needs to
  change for the palette swap to take effect.
- `docs/01-brand.md` §3-4 and `docs/07-ui-design-system.md` §1 are updated to
  describe the new values under the same token names, so they stay the single
  source of truth `tokens.css`'s header comment already claims them to be.
- Font migration is additive at the `FONT_STACKS` level (`shell.tsx`): existing
  tenant-facing stack keys are untouched, so a tenant mid-contract keeps
  rendering on its chosen stack; new keys expose Archivo/Instrument Sans as
  selectable options.
