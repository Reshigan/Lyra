# 07 — Constellation Design System (web)

Package: packages/ui. React + Tailwind v4 (tokens as CSS variables) + Radix
primitives. Dark-first; light theme = same tokens re-mapped. RTL via logical
properties only. Every component ships with: story, a11y test, RTL story,
density variants.

## 1. Foundations

- Tokens from docs/01 (§3–4) exported as `@lyra/ui/tokens.css`; tenant
  overrides injected as `:root[data-tenant]` variables at SSR.
- Grid: 4px base; radii 6/10/16 ("orbit" full-round for pills); shadows are
  subtle glows on dark (`0 0 0 1px ink-600, 0 8px 24px #0009`).
- Density: `comfortable` (default) / `compact` (ops screens auto-default).
- Elevation language: surfaces get lighter as they rise (ink-800→600), never
  drop-shadow-only.

## 2. Component inventory (build in this order)

Core: Button, IconButton, Input, Select, Combobox, DatePicker (Hijri display
option), Checkbox/Radio/Switch, Tag/Badge, Tooltip, Toast, Modal/Drawer,
Tabs, Table (virtualized, sticky, column pins, saved views), Kanban,
CommandBar (⌘K), EmptyState (constellation illustrations), Skeleton,
Stat (Space Grotesk tabular, delta chip with ion/flare), Sparkline,
ChartFrame (echarts theme "deepfield"), Timeline, FileDrop + DocViewer
(pdf/image, extraction overlay boxes), ChatThread (streaming, tool-call
chips, redaction shimmer), ApprovalStrip, AuditTrail, JourneyCanvas (nodes/
edges editor), PersonaCard, ConsentPanel, KPIWall.

AI-specific: ✦AgentBadge (marks AI-generated content — the only sparkle),
ConfidenceMeter, EvidenceLink (claim→source popover), GuardrailNotice,
BudgetMeter (AI tokens).

## 3. App shell & navigation

- Left rail: module switcher (5 glyphs, module-accent active dot), then
  module nav; collapsible to icons. Top bar: tenant/brand mark, global
  search (⌘K — entities, actions, docs), notification bell, help, avatar.
- Home per role = their primary workspace (docs/06): exec lands on NORTH
  Today; ops on Production Board; agent on Console. Role-based routing map in
  apps/web/app/routing.ts.
- Breadcrumbs only below module level. URL scheme `/m/{module}/{area}/{id}`.

## 4. Signature patterns

- **The Brief reading view (NORTH):** 68ch column, 18px/1.6, evidence links as
  dotted-underline vega; print-perfect.
- **Case Room (AXIS):** three panes — timeline (left), work canvas (center),
  copilot (right, collapsible); approval strip docks bottom when pending.
- **Agent Console (ORBIT):** queue 320px / thread fluid / context 360px;
  latency-first: optimistic sends, streamed AI drafts appear as ghost text
  the human can Tab-accept, edit, or discard.
- **Cockpit (SIGNAL):** money-flow sankey as hero; autopilot feed as a ledger
  with undo (7-day window where reversible).
- **Radar (SCOUT):** quadrant scatter with momentum trails; hover = theme
  card; click = dossier.
- Every list screen: saved views, bulk bar, keyboard nav (J/K/Enter/E),
  export (respecting PII permission).

## 5. States, writing, a11y

- Empty states teach ("No exceptions. The factory is quiet. ☼" — small
  constellation art, one action).
- Errors: what happened → what we did → what you can do; trace_id visible,
  copyable.
- Microcopy voice per docs/01: numbers first, no exclamation marks, ar copy
  written natively (never machine-translated for UI chrome).
- A11y: WCAG 2.2 AA; focus rings vega on ink; charts get data-table toggles;
  chat streams announced politely to screen readers; hit targets ≥ 40px.

## 6. Theming & whitelabel behaviour

Tenant accent replaces vega across interactive elements; module identity
accents remain (they're product identity, not brand); logo swaps; email +
hosted pages inherit the same tokens. A "brand preview" mode in tenant admin
renders key screens with the draft palette + auto contrast report before save.

## 7. Performance budgets

Route JS ≤ 170KB gz (app shell) + ≤ 90KB per module area; charts lazy;
tables virtualize > 50 rows; images via Cloudflare Images; fonts subset
(latin + arabic splits, `font-display: swap`); LCP < 2.0s 4G, INP < 200ms.
