# ADR-0053 — Charts are SVG in the kit, not a charting library

**Status:** accepted · 2026-08-12
**Context:** docs/ui.md §7 (P3-12), docs/15 §3, `packages/ui/src/data.tsx`,
`apps/web/app/routes/analytics-dashboard.tsx`

## Context

docs/ui.md §7 P3-12 says the product has no charting: `/analytics/dashboard/:id`
degraded a line tile to a 100×28 sparkline with no scale, a donut tile to a row
of meters, and anything else to a table. It asked for a decision — a chart
library, or a deliberate no-chart language.

The two are not the whole choice. What a dashboard tile is actually asked is
"how much, when, and against what", which needs a named scale and a share of a
whole. That is two shapes. A charting library (Recharts, visx, Chart.js) brings
a bundle, a second theming system that does not read our tokens, its own
accessibility story, and a dependency on the Workers build — for two shapes.

The kit already draws SVG for `Sparkline`, `ProgressBar` and `ConfidenceMeter`,
already animates them on the 400ms draw-once rule docs/15 §3 fixes, and already
reads its colours from the token layer that tenants theme.

## Decision

No charting library. `packages/ui` draws what the product needs:

- **`LineChart`** — the series with a scale beside it: the high and the low as
  formatted figures, three gridlines, the first and last x label. Axis words are
  HTML beside the plot, not `<text>` inside it, so a stretched viewBox never
  stretches the type. The y floor is zero, not the smallest reading — a series
  running 10 to 40 is a third taller than it is if the axis starts at 10.
- **`DonutChart`** — share of a whole as a ring with a named legend: one circle
  per slice, dashed to its own share of a circumference normalised to 100 units
  and rotated past the ones before it. No arc paths, no trigonometry.
- **A bar tile stays one labelled meter per row.** A horizontal bar carries its
  own name in a tile narrow enough to sit three-across; a vertical bar chart
  rotates the labels or drops them. This is the no-chart language, chosen, not
  the absence of a chart.

Both new shapes take a required `label` and render as `role="img"`.

## Consequences

- P3-12 closes: a line tile has a scale, a donut says share, a bar says rank.
- The arithmetic is ours, so it is tested (`packages/ui/src/charts.test.tsx`)
  rather than trusted to a library.
- The ceiling is explicit: zoom, brushing, stacked or multi-series, dual axes,
  and tooltips-on-hover are not built. A tile needing any of them is where a
  library earns its place, and supersedes this ADR.
- Tenant brand tokens keep working on charts, because charts read the same
  CSS variables as everything else.
