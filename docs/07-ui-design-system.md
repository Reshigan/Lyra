# 07 — Constellation Design System (web)

Package: `packages/ui`. React + Tailwind v4 (tokens as CSS custom properties) +
Radix primitives. Dark-first; the light theme is the same tokens re-mapped. RTL
via logical properties only.

**Horizon.** Since ADR-0026 (visual system replacement) the system's editorial
layer is called *Horizon*: hairlines instead of shadows, ramps instead of
three-step semantic colours, one serif sentence per surface, every figure in
mono. Horizon is not a second design system — it is Constellation's tokens with
a stricter grammar on top, and it lives in `packages/ui/src/horizon.tsx`.

**Where the truth is.** `packages/ui/src/tokens.css` is the single source of the
frame, palette, type and motion scales. `packages/ui/src/ui.test.ts` is the
invariant harness (token coverage, logical-properties-only, visible nav labels,
en/ar parity, index re-export completeness) and
`packages/ui/src/contrast.test.ts` is the contrast gate. If this document and
those files disagree, they are right and this file is stale.

**Per-component deliverables, as built.** Story: there is no Storybook — the
design-system playground CLAUDE.md's definition of done asks for is the
`/design` route (`apps/web/app/routes/design.tsx`), which renders the doctrine
and live specimens of the kit's load-bearing pieces. A11y: `axe-core` runs
inside the Playwright journeys (§5). RTL: enforced statically by `ui.test.ts`
rather than by per-component RTL stories, plus `e2e/pseudo-locale.spec.ts`.
Density: one global `[data-density="compact"]` switch, not per-component
variants.

## 1. Foundations

### 1.1 Tokens and tenant overrides

- Tokens from docs/01 §3–4 ship as `@lyra/ui/tokens.css` and are wired into
  Tailwind with `@theme inline`.
- Tenant overrides are **not** `:root[data-tenant]` variables injected at SSR.
  The shell writes an inline `style` on its root element from `brandStyle()`
  (`apps/web/app/components/shell.tsx`), and that function can emit exactly
  five custom properties: `--accent`, `--accent-hover`, `--accent-contrast`,
  `--font-display`, `--font-ui` (the last two together, from one setting,
  because the settings screen offers one typeface and says so).
- Tenant-controlled text is never interpolated into a custom property. A
  typeface *selects* a stack from `FONT_STACKS`, a `Map` of five allowed keys
  (`archivo`, `instrument-sans`, `space-grotesk`, `inter`,
  `ibm-plex-sans-arabic`); an unknown key selects nothing.
- Module identity accents (`--module-*`) are product identity, not brand.
  Tenants do not override them. `--font-serif` is likewise outside the contract.

### 1.2 Palette

Module hues (dark): AXIS `#e8a33d` · ORBIT `#3fc9b4` · SIGNAL `#f0764f` ·
SCOUT `#6c9ef0` · NORTH `#a98be8`. `--chart-1..5` alias them in that order —
there is no separate categorical chart palette.

Light re-map: AXIS `#b45309` · ORBIT `#00786a` · SIGNAL `#c2410c` ·
SCOUT `#1d4ed8` · NORTH `#6d28d9`. (docs/01 §3 names the light AXIS hue
`#A2660B`; the code ships `#b45309`. `ui.test.ts` asserts only the dark values,
so the light row is currently unguarded and the two documents are not
reconciled — resolving it needs a decision, not an edit here.)

Two palette facts are load-bearing and are recorded as comments in
`tokens.css`, not as assertions: `--star-500: #8a94a6` is the subtle-text stop
because it reaches 6.32:1 on `--ink-900`, and `--vega-700: #4a6a0f` exists
because `--vega-500: #c8f163` fails AA as text on light.

What `contrast.test.ts` actually asserts is narrower and mechanical: it parses
`tokens.css`, resolves one level of `var()`, and requires ≥ 4.5:1 in **both**
themes for seven pairs — `text`/`bg`, `text-subtle`/`bg`,
`accent-contrast`/`accent`, `success-contrast`/`success`,
`danger-contrast`/`danger`, `warning-contrast`/`warning`,
`info-contrast`/`info`.

### 1.3 Space, radius, elevation, motion

- Grid: `--space-base: 4px`.
- Radii are **2 / 3 / 6 px** (`--radius-sm` / `--radius-md` / `--radius-lg`)
  plus `--radius-orbit: 999px` for pills. The older 6/10/16 scale is gone:
  Horizon draws hairlines, not rounded slabs — the corner is a chamfer you
  notice only when it is missing, and the pill stays a pill.
- Elevation is lightness first (the surface ramp `s1..s4`) plus a hairline. The
  **dark theme has no drop shadow at all** — `--elev` and `--elev2` are `none`
  and the hairline carries the depth; the light theme defines both. The old
  glow recipe survives as `--shadow-glow`
  (`0 0 0 1px var(--ink-600), 0 8px 24px #000c`) and `--shadow-raised`, for the
  few surfaces that genuinely lift off the field.
- Density: comfortable by default (`--control-height: 40px`,
  `--row-height: 44px`); `[data-density="compact"]` re-maps them to 32px / 34px
  for ops screens.
- Motion: `--duration-fast` 120ms, `--duration-medium` 180ms,
  `--duration-slow` 240ms (docs/15 §3), with `--ease-out`,
  `--ease-observatory` and `--ease-settle`.

### 1.4 The frame

The app frame is one token scale. Every shell derives its bands, rail and
gutters from these, and no shell or route may write a frame pixel of its own —
`apps/web/app/components/frame.test.ts` gates it.

| Token | Value |
| --- | --- |
| `--chrome-top` | 50px — top bar |
| `--chrome-module` | 38px — module band; the mobile module/nav strip's floor |
| `--chrome-meridian` | 74px — today's strip (NORTH, ADR-0061) |
| `--chrome-status` | 28px — status strip |
| `--rail-width` | 196px, widening to 252px at ≥ 1240px |
| `--gutter` | 12px → 16px at ≥ 640px |
| `--gutter-canvas` | 16px → 24px at ≥ 640px |
| `--gutter-rail` | 12px |
| `--stack-gap` | 16px |
| `--companion-width` | 288px |
| `--measure-canvas` | 100rem |
| `--measure-prose` | 68ch |

The three band heights are the design's exact values and are deliberately off
the 4px grid; everything else is a multiple of `--space-base`. Both responsive
steps are declared on the tokens, so shells stay breakpoint-free.

**Bands, never overlays (ADR-0068).** The status strip used to be
`sticky bottom-0` — an overlay eating the last 28px of rail and canvas on every
page. It is now a `shrink-0` flex band below the split, so nothing is covered.
The same ADR settles the module band: the comp's 38px horizontal bar is the
*vertical rail* on desktop, and 38px survives as the mobile strip's floor.

## 2. Component inventory (as shipped)

`packages/ui/src/index.ts` re-exports the kit, and `ui.test.ts` fails the build
if a module's exports are not re-exported.

- **`cn.ts`** — `cn`, `focusRing`.
- **`primitives.tsx`** — Button, IconButton, Field, Input, Textarea,
  DatePicker (Hijri display option), Select (with a sentinel codec:
  `toSelectValue` / `fromSelectValue`), Checkbox, RadioGroup, Switch, Slider,
  Card, PageHeader, Badge (`Tag` is an alias), Avatar, Skeleton, Separator,
  Tabs, ProgressBar.
- **`overlays.tsx`** — Dialog, Drawer, Tooltip, Popover, Menu, ToastProvider /
  `useToast`, CommandBar (⌘K) with `groupCommandItems`.
- **`data.tsx`** — Table, Pagination, EmptyState, Stat, Sparkline, LineChart,
  DonutChart, KPIWall, Timeline, AuditTrail.
- **`horizon.tsx`** — `hueVar`, HueBar, Eyebrow, Lede, Hairline, Figure
  (+ `useTickOnChange`), AutoGrid, Panel, AnswerBanner, Provenance.
- **`flow.tsx`** — `flowPlan`, StateFlow, PostingFlow.
- **`format.tsx`** — `instantOf`, DateTime, `formatInstant`, `formatDate`,
  Money, MoneyField, `formatMoney`, `shortRef`, Ref, `isOpaqueRef`, NoData.
- **`nav.tsx`** — NavItem, NavSection, NavRail, ModuleSwitcher, Breadcrumbs,
  TopBar.
- **`ai.tsx`** — `AGENT_MARK`, AgentBadge, GhostText, ConfidenceMeter,
  EvidenceLink, GuardrailNotice, BudgetMeter, ApprovalStrip.
- **`text.tsx`** — `KIT_TEXT`, `uiText`, UiTextProvider, UiCalendarProvider,
  UiTimeZoneProvider and their hooks.
- **`post-card.ts`** — `POST_RATIOS`, `postCardSvg`, `wrap`, `esc` (the studio
  preview and the download route render the same bytes).

### 2.1 Named in earlier drafts of this doc but not built

Kept here as intent, not as description: **Combobox**, **Kanban**,
**FileDrop + DocViewer**, **ChatThread**, **PersonaCard**, **ConsentPanel**,
**JourneyCanvas**. The journey editor shipped as forms over the stored
node/edge graph rather than a canvas (`apps/web/app/routes/orbit-journey.tsx`;
scope in ADR-0014), and screens that need a document viewer or a message thread
build them locally in `apps/web`.

**ChartFrame is not built and will not be.** There is no echarts theme and no
charting dependency: ADR-0009 and ADR-0053 make charts hand-written SVG inside
the kit (Sparkline, LineChart, DonutChart, and the flow figures), which is why
`--chart-1..5` are aliases of the module hues rather than a library palette.

**Table is not virtualised.** It renders the rows it is given, sticky-headed by
default, wrapped in a `role="region"` with `tabIndex={0}` so a scrollable table
is keyboard-reachable (asserted in `ui.test.ts`); paging is the server's
(`Pagination`). Saved views and column pinning are per-screen where they exist,
not kit features. Sealed rows never gain hover elevation (docs/22 §1).

### 2.2 The Horizon grammar

`horizon.tsx` is the seven marks Horizon repeats on every surface, extracted so
a screen composes them instead of re-deriving inline styles:

1. **the eyebrow** — a small tracked-out label that says what a block is
2. **the lede** — one serif sentence that says what it means
3. **the figure** — every number in mono, tabular, with its unit set quietly
4. **the hue bar** — 2px of module colour, the only place a module signs itself
5. **the hairline** — a rule instead of a shadow
6. **the answer** — ✦, who it was answered for, and how long it took
7. **the provenance** — the "why" behind an AI artifact, inspectable in place

Plus two layout pieces and one helper: **`Panel`**; **`AutoGrid`**, which
defaults to `min = "17rem"` and clamps with `minmax(min(17rem, 100%), 1fr)` so
it cannot overflow a phone; and **`hueVar(module)`**, which returns
`var(--module-…)`, or `var(--accent)` for a surface belonging to no module.

### 2.3 Process flows

`flow.tsx` renders a transaction's life from two things that are already true —
the documented state machine and the journal lines it posted. `flowPlan()`
returns the spine (the path when nothing goes wrong) with exits drawn as
endings rather than steps; a state the data claims but the machine does not
document is reported as drift (`role="alert"`) and refused, never drawn.
`PostingFlow` re-adds the legs shown on screen to check they agree with the
ledger's own totals, and renders an em-dash rather than a figure when they do
not; sealed legs carry a `border-s-2` rule. Both are semantic `<ol>` /
`<figure>`, not SVG. Drawn on transaction, settlement, claim, case and policy
screens.

### 2.4 Dates that cannot be rendered

`instantOf(value)` guards `null`/`undefined` before `new Date` and `NaN` after,
and returns `Date | null`. An instant no `Date` can hold is *parked*, not
rendered: `DateTime` degrades to the em-dash with a `title` and an `sr-only`
reason from `uiText(locale)("dateUnavailable")` — the same treatment `NoData`
gives an empty cell, so a degraded date and an absent one explain themselves
the same way instead of printing `NaN`.

### 2.5 AI surfaces

`AGENT_MARK = "✦"` in `ai.tsx` is the one and only sparkle. Every AI artifact
carries the single ✦ and an inspectable "why" (CLAUDE.md §11, docs/15 §4); a
deterministic fallback sentence carries none. `ApprovalStrip` takes a
`blockedReason` rather than rendering a bare disabled control — gates are
always shown with their reason (docs/22 §5.4).

## 3. App shell & navigation

- **Left rail.** Grouped, always text-labelled, `--rail-width` wide, with the
  module hue on the active item. On small screens it becomes a scrollable strip
  under the header.

  **Stated override of this section's earlier text.** This doc used to specify
  a module switcher of five glyphs and a rail "collapsible to icons". Both are
  deliberately not built. `nav.tsx` carries the rule as a hard header comment —
  `label` is required on every component in the file, icons are decorative and
  `aria-hidden`, and there is no `collapsed` / `iconOnly` / `compact-rail` prop
  anywhere; `ui.test.ts` fails the build if a label ever becomes optional or a
  banned word appears. The reasoning is plain: an icon-only rail costs every
  user a hover to answer "what is this", and costs a screen-reader user the
  label outright — across five modules' worth of destinations there is no icon
  set that survives that. `shell.tsx` still carries `item.icon` through as a
  `data-icon` attribute, so a later icon pass can decorate the label without
  replacing it. Recorded in ADR-0011 (nav rail text labels), ADR-0052 (no
  module switcher — the rail is one) and ADR-0068.

- **Top bar.** 50px: tenant brand lockup, the ⌘K ask bar, the companion toggle
  where entitled, avatar. Brand name and mark arrive as props; no product name
  is hard-coded in `packages/ui`.

- **Two overlays folded into one (ADR-0031).** The Horizon design has no
  sidebar and reaches navigation through two overlays, *Ask* and *Where*. The
  persistent `<nav>` landmark stays — WCAG 2.2 SC 2.4.5 wants more than one
  route to a page, and an overlay that only exists while open is not a landmark
  a screen-reader user can jump to. The *Where* overlay is therefore not built
  as a second overlay: its content is the first block of the ⌘K palette, under
  a `search.goTo` heading above `search.results`. The palette is passed the
  same already-filtered items the rail renders, so there is no second
  entitlement path. `groupCommandItems` collects a *run* of the same group into
  one `role="group"` block, in the caller's order.

- **Meridian (ADR-0061).** The today-strip, `--chrome-meridian` tall, is a
  `role="slider"` over the day (0–1440 minutes) with an `aria-valuetext` clock,
  arrow/Home/End/Escape scrubbing, RTL-aware direction, 25 hour ticks in three
  weights, and local time rendered only after mount.

- **Companion rail (ADR-0059).** An `<aside>` of `--companion-width` showing
  the newest agent runs and the agent roster, footed by the autonomy envelope,
  linking to `/admin/ai/console` rather than carrying controls of its own.
  Three deliberate divergences from the comp: it **opens closed**; it **loads
  on first open** (the component mounts only when open, so the fetcher effect
  *is* the first-open load, and a rail nobody opens costs zero requests); and
  it is **absent, not disabled**, for an actor without `ai:runs:read` — no
  toggle renders at all.

- **Cold open (ADR-0055)** gates the entrance animation to once per session
  (`sessionStorage` key `lyra_opened`).

- **Home is composed by permission, not by a role layout table (ADR-0057).**
  There is no role→layout map: each panel asks whether the actor holds its
  permission and returns `denied` without a network call, and the tiles are the
  same `me.nav` the rail renders, so a rail entry and a home tile cannot
  disagree. The docs/06 landing intents (exec on the Brief, ops on the board,
  agent on the console) are expressed that way rather than by routing.

- **URLs are flat (ADR-0003).** Not `/m/{module}/{area}/{id}`. Workspaces are
  `/axis`, `/orbit`, `/signal`, `/scout`, `/north`, `/ledger`, `/distribution`,
  `/analytics`, `/compliance`, `/admin`, `/platform`, `/settings`, with
  purpose-built paths below them (`/ledger/money-map`,
  `/axis/policies/:id/detail`) and a generic `:module` / `:module/:resource` /
  `:module/:resource/:id` trio behind them — adding a module adds a spec file
  in `app/modules`, not a route. `apps/web/app/routing.ts` says which paths
  exist and where an actor lands; it says nothing about what a person may see —
  visibility and labels come from `/v1/me`, so a role change takes effect on
  the next request. `/design` is the doctrine route and every role may read it.

- Breadcrumbs only below module level.

## 4. Signature patterns

- **The Brief reading view (NORTH):** `--measure-prose` (68ch) column, evidence
  links as dotted-underline accent; print-perfect.
- **Case Room (AXIS):** timeline, work canvas and copilot; the approval strip
  docks when something is pending.
- **Agent Console (ORBIT):** queue / thread / context; latency-first, with
  streamed AI drafts as ghost text the human can accept, edit or discard.
- **Cockpit (SIGNAL):** spend, pacing and channel performance with the
  autopilot feed as a ledger. The money-flow sankey named here shipped in the
  ledger instead, as the Money Map (`/ledger/money-map`, docs/22 §1.2) — a
  hand-laid SVG flow whose nodes drill into the lines that sum to them.
- **Radar (SCOUT):** quadrant scatter; hover reads the theme, click opens the
  dossier. The hover reading is in the accessibility tree before any hover.
- **Hero figures:** the figure at the top of a screen counts rows, so clicking
  it lists exactly those rows — one predicate over one array, never a second
  query that can disagree with the first (`apps/web/app/components/hero.tsx`).
  A figure with no rows behind it (a median, a rate, an age) is plain text and
  does not pretend to be a door.
- Every list screen: keyboard nav, export respecting PII permission.

## 5. States, writing, a11y

- Empty states teach: one sentence, one action.
- Errors: what happened → what we did → what you can do; the request id is
  visible and copyable.
- Microcopy voice per docs/01: numbers first, no exclamation marks, `ar` copy
  written natively. `KIT_TEXT` holds the kit's own strings in `en` and `ar`,
  and `ui.test.ts` asserts key-for-key parity and that no component carries an
  English prop default.
- Latency doctrine: `useSettledFor(settling, 400)` in `shell.tsx` — a
  transition that resolves inside 400ms never shows a skeleton.
- **A11y gate.** WCAG 2.2 AA is asserted, not reported: `e2e/a11y.ts`'s
  `expectNoA11yViolations` runs `axe-core` with tags `wcag2a`, `wcag2aa`,
  `wcag22aa` and fails the test on any violation. It is called inside the
  existing journeys — `e2e/login.spec.ts`, `e2e/staff.spec.ts`,
  `e2e/horizon-shell.spec.ts`, `e2e/north.spec.ts`, `e2e/pseudo-locale.spec.ts`
  and the read-only `e2e/live/smoke.spec.ts`. There is **no separate a11y CI
  job**; the `e2e` job in `.github/workflows/ci.yml` is the gate.
- Focus rings are the accent on ink; hit targets ≥ 40px (`--control-height`).
- **Logical properties only**, across the whole kit: `ui.test.ts` scans every
  non-test `.ts`/`.tsx` file in `packages/ui/src` and fails on a physical
  direction property or class.

## 6. Theming & whitelabel behaviour

The tenant accent replaces the product accent across interactive elements;
module identity accents remain. The contract is the five custom properties and
the typeface allow-list in §1.1 — nothing else is tenant-writable, and tenant
text never becomes a property value. Light and dark are the same tokens
re-mapped, declared twice (a `prefers-color-scheme` block guarded against an
explicit light choice, and a `:root[data-theme="dark"]` block) so an explicit
choice wins in both directions. Faces are self-hosted `.woff2` with a
Latin/Arabic `unicode-range` split.

A brand-preview mode rendering key screens with the draft palette plus an auto
contrast report before save is **intent, not built**; what exists is the
settings brand form plus `contrast.test.ts` over the shipped palette.

## 7. Performance budgets

Route JS ≤ 170KB gz (app shell) + ≤ 90KB per module area; images via Cloudflare
Images; fonts self-hosted and subset (latin + arabic splits,
`font-display: swap`); LCP < 2.0s on 4G, INP < 200ms. "Charts lazy" and "tables
virtualize > 50 rows" no longer apply as written — charts are inline SVG in the
kit (§2.1) and paging is server-side. Whether the KB budgets are measured in CI
is not determined from code.
