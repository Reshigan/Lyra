# ADR-0009 — No charting library; SVG polyline and meter instead

- Status: accepted for now — adopting a chart package is the user's call, and
  this ADR recommends rather than decides
- Date: 2026-07-30
- Context: docs/07 §2 (component inventory), docs/02 §9 (approved third-party
  services), CLAUDE.md guardrail "prefer boring technology; novelty needs an ADR"

## Context

docs/07-ui-design-system.md:25 lists `ChartFrame (echarts theme "deepfield")` in
the component inventory. **`ChartFrame` does not exist.** A repo-wide search for
`ChartFrame`, `echarts`, `recharts`, `chart.js` and `d3` returns matches only in
docs/07 itself — no package manifest in the workspace declares any charting
dependency.

What exists instead is two primitives and a fallback:

- `Sparkline` (`packages/ui/src/data.tsx:389-419`) — an SVG `<polyline>`,
  `viewBox="0 0 100 28"`, min/max normalised, stroke from a theme CSS variable
  (`packages/ui/src/data.tsx:402-407`), `role="img"` with a **required**
  `aria-label` (`packages/ui/src/data.tsx:382-383`, `:412-413`). The whole
  component is 30 lines.
- `ProgressBar` (`packages/ui/src/primitives.tsx:669`) — a Radix `Progress`
  whose fill is sized with `inlineSize` rather than `width`, so it flips
  correctly under RTL without a second stylesheet.
- Everything else falls through to `Table`
  (`apps/web/app/routes/analytics-dashboard.tsx:356-386`) — the rows the report
  engine already returned.

The dashboard maps every declared `viz` onto those three
(`apps/web/app/routes/analytics-dashboard.tsx:293-386`): `line` becomes a
`Sparkline`; `bar` and `donut` become a list of meters, a bar measured against
the largest row and a donut against the sum
(`apps/web/app/routes/analytics-dashboard.tsx:326-329`), capped at
`MAX_BARS = 8` (`apps/web/app/routes/analytics-dashboard.tsx:25`); anything else
is a table. The reasoning is recorded in place at
`apps/web/app/routes/analytics-dashboard.tsx:18-20`:

> "ponytail: no charting library — none is installed. A sparkline is a polyline
> (@lyra/ui), a bar is a ProgressBar and everything else is the table the report
> engine already returns. Add a real chart package when a tile needs axes."

## Decision

No charting dependency is added. Analytics tiles render as sparkline, meter list
or table.

Four constraints made this the default rather than a preference:

1. **docs/02 §9** lists the approved third-party services — Cloudflare,
   Anthropic via AI Gateway, Resend, Twilio/Unifonic, Sentry, Stripe — and ends
   "Anything else requires an ADR" (docs/02-architecture.md:121-126). A charting
   library is not on that list. This ADR is the required record; it records a
   *declined* addition.
2. **Budget.** docs/07-ui-design-system.md:80 sets "Route JS ≤ 170KB gz (app
   shell) + ≤ 90KB per module area; charts lazy". A general-purpose chart engine
   spends a large share of a route's budget before drawing anything.
3. **SSR on Workers.** Every analytics route loads server-side through
   `context.get(cloudflare).env`
   (`apps/web/app/routes/analytics-dashboard.tsx:138`). A chart library that
   measures the DOM at mount either does not render on the server or renders
   twice.
4. **RTL and WCAG 2.2 AA** (CLAUDE.md §7, §8). The two primitives satisfy both
   by construction: `Sparkline` cannot be constructed without a text
   alternative, `ProgressBar` is a Radix `Progress` with correct roles and sizes
   in logical properties. Chart libraries generally require configuration to get
   there, and regress there on upgrade.

## What this genuinely cannot do

Stated plainly, because the alternative is discovering it during a demo:

- **No axes, no ticks, no gridlines, no scale labels.** A `Sparkline` shows
  shape only. The dashboard compensates by printing the final value beside it
  (`apps/web/app/routes/analytics-dashboard.tsx:299-311`), which gives one
  number out of forty.
- **No time axis.** Points are evenly spaced by array index
  (`packages/ui/src/data.tsx:397`). A series with gaps or irregular sampling is
  drawn as if it were regular — the line is wrong, not merely coarse.
- **No zero baseline.** The polyline normalises min-to-max
  (`packages/ui/src/data.tsx:392-394`), so a series moving from 1000 to 1002
  looks identical to one moving from 0 to 1002.
- **No donut.** A donut is rendered as a stack of meters against the sum
  (`apps/web/app/routes/analytics-dashboard.tsx:326-329`). It is a defensible
  substitution and it is not what the report author asked for.
- **No legends, no multi-series, no stacking, no tooltips, no hover readout, no
  brush/zoom, no click-through on a datum.**
- **Truncation is silent.** `MAX_BARS = 8` drops rows 9+ with no "and 14 more"
  affordance (`apps/web/app/routes/analytics-dashboard.tsx:321`).
- **The data-table toggle in docs/07-ui-design-system.md:68 does not exist** as
  a toggle. Non-line, non-bar tiles *are* tables, which arrives at the same
  accessibility outcome by accident rather than by design; a `line` tile has no
  table view at all.

## Recommendation, not a decision

Adopting a chart package is a product call about how much analytics matters,
and the honest answer is that it depends on tiles nobody has specified yet. What
a real evaluation should weigh, in order:

1. **Does a real report need an axis?** If the answer is no across the whole
   report catalogue, this ADR needs no revisiting. If one board pack needs a
   labelled time axis, the primitives are already insufficient and no amount of
   polyline work fixes it.
2. **Gzipped cost against docs/07's 90KB module budget**, measured after
   tree-shaking, on the actual tiles — not the vendor's headline number.
3. **SSR behaviour on workerd**, tested, not assumed.
4. **RTL correctness and keyboard/screen-reader access out of the box**, since
   CLAUDE.md makes both non-negotiable and neither is optional-extra work.
5. **Theme integration**: tokens are CSS variables
   (`packages/ui/src/data.tsx:403-406`). A library that wants hex values at
   config time fights the token system and breaks the light/dark switch.
6. **Lazy-loadability**, per docs/07-ui-design-system.md:80 ("charts lazy"), so
   the cost lands on analytics routes only.

If a package is adopted, the cheapest path is to keep `Sparkline` and
`ProgressBar` for the small cases they already handle well and introduce the
library behind a new `ChartFrame` — matching docs/07's existing name — used only
by tiles that need an axis. Replacing the primitives wholesale spends the budget
on tiles that never needed it.

Note that docs/07-ui-design-system.md:25 names echarts specifically. That naming
predates any evaluation; it should be treated as a placeholder, not a decision,
and the evaluation above should be run before it is honoured.

## Consequences

- docs/07-ui-design-system.md:25 describes a component that does not exist.
  Anyone implementing to the spec will look for `ChartFrame` and find nothing.
  That line should be amended to describe the primitives, or marked as future.
  The edit is not made here.
- Reports whose author expected a chart get a table. There is no warning, on
  screen or at authoring time, that a requested `viz` was substituted.
- `Sparkline` has no test. Its normalisation (`packages/ui/src/data.tsx:392-401`)
  has two edge cases already handled in the code — a flat series
  (`span = max - min || 1`) and a single point (`x = w / 2`) — and nothing
  asserts either. It is thirty lines of arithmetic rendering numbers people will
  make decisions from.
- The decision is easy to reverse. Nothing in `@lyra/ui` prevents adding a chart
  package later, and the substitution logic is confined to one function
  (`apps/web/app/routes/analytics-dashboard.tsx:293-386`).
