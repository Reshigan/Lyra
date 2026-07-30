# 01 — Brand System: LYRA & the Constellation design language

Status: LYRA passed preliminary trademark screening; formal clearance via
counsel required pre-launch. All brand elements below are implemented as tokens
so a whitelabel tenant (or a forced rename) is a configuration change.

## 1. Brand idea

**"The instrument you navigate by."**
Lyra is the small northern constellation that carries Vega — for millennia one
of the brightest fixed points used to find your way. The business is flying
through a sky of data it cannot see; Lyra is the instrument that resolves it.
Five instruments, one sky, one bright star to steer by.

Voice: precise, warm, unhurried. We say "we watched this happen and here's why"
— never "AI-powered synergy". Numbers before adjectives. Short sentences.

Tagline system:
- Master: **"See everything. Act first."**
- AXIS: "The factory that never sleeps."
- ORBIT: "Every relationship, in orbit."
- SIGNAL: "Spend follows signal."
- SCOUT: "Find the gap before it's priced."
- NORTH: "The whole business, narrated."

> **Naming status — read before any public use.** LYRA has *not* cleared
> screening. Known conflicts in our classes: Lyra Network (payments/fintech,
> FR, since 2001), Lyra Health (registered LYRA, health benefits, US), Lyra
> Client Solutions (fintech services, US, 2025), a registered LYRA in software
> services, and Lyra Software (MX, business applications). Treat LYRA as the
> working/internal mark. Options: (a) file a distinctive variant — **LYRAE**
> (the genitive used in star names, e.g. *Alpha Lyrae*) is coined-adjacent and
> keeps the whole brand story; (b) retain the previously screened **QIVANTA**
> as the registrable house mark with Lyra as the internal platform codename;
> (c) proceed with counsel-led clearance accepting coexistence risk.
> Because `brand.houseMark` is a config token (§6), switching costs one line.

## 2. Wordmark & symbol

- Wordmark: `LYRA` set in Space Grotesk Medium, +3% tracking, all caps. The
  crossbar of the `A` is lifted 1 unit and extended right as a fine 45° stroke
  — a string plucked, a sightline taken.
- Symbol: the **Vega mark** — Lyra's actual asterism reduced to its geometry:
  a slim parallelogram of four points with the top-left point (Vega) enlarged
  and filled in accent. It reads as a constellation at 32px and as a single
  bright star at 16px favicon (draw only Vega plus two faint points below).
- Optional string motif: three hairline verticals inside the parallelogram for
  large-format use only (hero, print). Never at UI scale.
- Module lockups: `LYRA` in Ink + module name in module accent, separated by a
  middot: `LYRA · AXIS`. Standalone module logo = Vega mark recolored to the
  module accent.
- Clear space: height of the `L` on all sides. Never distort, outline, rotate,
  or add drop-shadow. The parallelogram angle is fixed at 68°/112°.

## 3. Color — "Deep Field" palette

Dark-first. Light theme derives from the same tokens.

| Token | Hex | Use |
|---|---|---|
| `ink-900` (Deep Field) | `#070B14` | App background (dark) |
| `ink-800` | `#0C1322` | Surface 1 |
| `ink-700` | `#131C31` | Surface 2 / cards |
| `ink-600` | `#1C2842` | Elevated / hover |
| `star-100` (Starlight) | `#F4F7FC` | Text on dark; light-mode bg |
| `star-300` | `#AEB9CF` | Muted text on dark |
| `vega-500` (Vega) | `#FFB020` | Primary accent — actions, focus, the "star" |
| `vega-600` | `#D98E0B` | Accent hover / on-light accent text |
| `ion-500` (Ion) | `#37D3B2` | Success, positive deltas |
| `flare-500` | `#FF5D5D` | Errors, negative deltas |
| `photon-500` | `#6E9BFF` | Links, info, selected states |

Module accents (used ONLY as identity tint in nav, lockups, chart series 1):
AXIS `#FFB020` (vega) · ORBIT `#37D3B2` (ion) · SIGNAL `#FF7A45` (comet) ·
SCOUT `#6E9BFF` (photon) · NORTH `#C08BFF` (nebula).

Rules: one accent per screen dominates; module accent ≤ 10% of surface area;
data-viz uses the 5 module accents as the categorical scale (colour-blind safe
at these values on ink backgrounds); never place vega text on ion, etc.

## 4. Typography

- Display / headings: **Space Grotesk** (500/700). On-theme, geometric, ownable.
- UI / body: **Inter** (400/500/600), tabular numerals ON for all metrics.
- Mono (code, IDs, API): **IBM Plex Mono**.
- Arabic: **IBM Plex Sans Arabic** across all roles; display fallback to it too.
- Scale (rem): 12, 13, 14 (body), 16, 18, 22, 28, 36, 48. Line-height 1.5 body,
  1.15 display. Numbers in KPIs use Space Grotesk 700 tabular.

## 5. Iconography, illustration, motion

- Icons: Lucide, 1.5px stroke, 20px grid; module glyphs custom: AXIS=flywheel,
  ORBIT=two orbits, SIGNAL=radiating arc, SCOUT=crosshair-star, NORTH=polar star.
- Illustration: thin-line constellations on Deep Field; star points = vega dots.
  No stock 3D robots. Ever.
- Motion: 150–250ms ease-out; "twinkle" (opacity 0.85→1) for live-updating
  numbers; orbit-spin only on loading states. Reduced-motion honored.

## 6. Whitelabel token contract

Tenant config supplies: `brand.name`, `brand.logo.{light,dark,mark}`,
`brand.palette.{accent,accentHover}`, `brand.font?` (from approved set),
`brand.domain`, `brand.email.{from,replyTo}`, `legal.{company,footer,privacyUrl}`.
Everything in §2–5 is the default skin; tenants override accent + logo + name.
Contrast is auto-validated on save (WCAG AA) — reject palettes that fail.

## 7. Brand don'ts

No gradients on text · no glassmorphism · no emoji in product UI · no "AI
sparkle" icons on every button (one ✦ marks agent-generated content, nothing
else) · never use module accents for semantic success/error.
