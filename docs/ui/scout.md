# SCOUT — UI design brief

*What is on the screen today, not what SCOUT should become. Every label, column,
permission string and piece of copy below was read out of the code on 2026-07-30.
Where a screen is thin, this file says so under "What is weak today" rather than
describing an improved version that does not exist.*

---

## 1. Orientation (read this first)

1. SCOUT is LYRA's market and demand intelligence workspace: raw observations in,
   an argument about what to build out.
2. Its data flows in one direction — **signals** (raw observations) → **clusters**
   (what clustering made of them) → **whitespace** (an opportunity with a demand
   estimate) → **experiments** (a landing page that tests the estimate) — plus two
   side tables: **panel benchmarks** (how each provider prices against the panel)
   and **data products** (aggregate cuts sold back to the panel).
3. Every row in SCOUT is an inference. Nothing here is a fact from an outside
   authority; every number was computed by GONXT from its own quote book or its
   own harvester. The screens exist to be argued with.
4. The nav label — and therefore the `<h1>` of every SCOUT screen — is **"Market"**,
   not "SCOUT". The word SCOUT never appears in the UI.
5. Who lives here: the product lead (`scout.lead`, `scout.pm`) all day; the SCOUT
   admin (`scout.admin`); executives and analysts who are allowed to see clusters
   and nothing else (`north.exec`, `north.analyst`); a tenant admin who can read
   everything and write nothing; a provider viewer who sees only panel benchmarks
   and data products.
6. Ten of the platform's other roles — `signal.lead`, `axis.lead`, `axis.agent`,
   `orbit.agent`, `orbit.partners`, `orbit.retention`, `finance.controller`,
   `finance.analyst`, `tenant.compliance`, `dev.admin` — hold **no SCOUT
   permission at all**. They do not see the nav item.
7. The three screens that matter most: **Whitespace** (the promotion decision,
   where a number commits a build team), **Clusters** (the only screen an
   executive ever sees), **Signals** (the evidence floor everything else rests on).
8. Experiments matter fourth: they are the only place SCOUT spends money.
9. Every SCOUT screen is generated. There is no bespoke SCOUT route, no SCOUT
   chart, no SCOUT dashboard, no radar, no dossier. Six tables and a record form.
10. There is no ✦ anywhere in SCOUT today, on any screen, even though clustering
    and demand estimation are the most AI-derived numbers in the product.

---

## 2. How SCOUT is built — say it plainly

**SCOUT owns no route file.** `apps/web/app/routes.ts` declares three generic
routes at the end of the workspace layout:

```
:module                      → routes/module.tsx     (list, first tab)
:module/:resource            → routes/module.tsx     (list, named tab)
:module/:resource/:id        → routes/record.tsx     (one record)
```

Other modules add bespoke routes (`/ledger/journal`, `/analytics/report/:id`,
`/orbit/conversation/:id`, `/compliance/...`, `/admin/ai`). **SCOUT adds none.**

What SCOUT does own is a *declaration*: `apps/web/app/modules/scout.ts` exports a
`WorkspaceSpec` — a path, a two-locale label table (en + ar), and six resource
tabs. `routes/module.tsx` renders any tab as a filter bar + table + create panel;
`routes/record.tsx` renders any row as a definition list + an edit form. The API
side mirrors this: `apps/api/src/resources.ts` registers six `Resource` entries
and `apps/api/src/crud.ts` builds a REST router for each. **There is no
`apps/api/src/routes/scout.ts`.** No bespoke SCOUT endpoint exists.

Consequences a designer must accept as constraints:

- Every SCOUT list looks structurally identical to every AXIS/ORBIT/LEDGER list.
- A column that is not in the spec's `columns` array **does not exist on screen**,
  even if the database stores it. Several important SCOUT columns are in this
  state (§10).
- No charts. No sparkline, no trend line, no radar, no scatter. The design system
  *ships* `Sparkline`, `Stat` and `ProgressBar` (`packages/ui/src/data.tsx`) and
  SCOUT uses none of them.
- No row-level actions, no bulk actions, no export button, no soft delete (none of
  the six SCOUT tables has a `deletedAt` column, so `?deleted=1` returns HTTP 400
  `"<path> has no soft delete"` — and the toggle is never rendered because no
  SCOUT tab declares a `remove` permission).
- No full-text search on any SCOUT tab: no SCOUT resource is registered
  `searchable`, so the search input is never rendered and `?q=` would answer 400
  `"scout/signals is not searchable"`.

---

## 3. The frame every SCOUT screen sits in

From `apps/web/app/components/shell.tsx`.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [logo] Tenant brand name          Signed in as Tariq  ·  Settings  Sign out  │ 56px sticky
├──────────┬───────────────────────────────────────────────────────────────────┤
│ • Home   │                                                                   │
│ • Cases  │   main, max-width 100rem, padding 16px (24px ≥sm)                  │
│ • Orbit  │                                                                   │
│ • Signal │   ← every SCOUT screen renders here                               │
│ ● Market │                                                                   │
│ • North  │                                                                   │
│ • …      │                                                                   │
│  240px   │                                                                   │
└──────────┴───────────────────────────────────────────────────────────────────┘
```

- Sidebar is `md:w-60` (240px); below the `md` breakpoint it collapses to a
  horizontally scrollable strip of the same text labels. Never an icon rail —
  the shell deliberately overrides docs/07 §3; nav items are always text.
- Each nav item carries a 6px accent dot. SCOUT's is `--module-scout: #6e9bff`
  (photon blue). Opacity 100% when active, 30% idle, 60% on hover.
- The nav item is present only if the actor holds `scout:signals:read`
  (`apps/api/src/routes/me.ts` gates `nav.scout` on that one permission). This is
  a bug in itself: an actor with only `scout:clusters:read` (every `north.*` role)
  **has no way to navigate to SCOUT** and must be linked or must type the URL.
- Skip link "Skip to content" precedes the header.

**Design tokens** (`packages/ui/src/tokens.css`, "Deep Field"):
background `--ink-900 #070b14`; surface-1 `--ink-800 #0c1322`; surface-2
`--ink-700 #131c31`; hover/elevated `--ink-600 #1c2842`; text `--star-100
#f4f7fc`; muted `--star-300 #aeb9cf`; subtle `--star-500 #5e6b87`; accent
(tenant-overridable) `--vega-500 #ffb020`; success `--ion-500 #37d3b2`; danger
`--flare-500 #ff5d5d`; info/links `--photon-500 #6e9bff`. Type scale 12 / 13 / 14
(body) / 16 / 18 / 22 / 28 / 36 / 48. Display face Space Grotesk, UI face Inter,
mono IBM Plex Mono, Arabic IBM Plex Sans Arabic. Radii 6 / 10 / 16 / 999. 4px
spacing grid.

---

## 4. Two facts from the data the design must accommodate

### Fact 1 — a dismissed signal has no status column

`scout_signals` (`packages/db/src/schema/scout.ts`) has **no `status` column**.
Signals are append-only: the tab buys `scout:signals:ingest`, which is create and
nothing else. There is no update permission, no delete, no soft delete.

So "this observation was looked at and rejected as noise" is expressed as three
things at once, none of which is a status:

1. `weight` is set to **0**,
2. `clusterId` is **null** (unclustered),
3. the `payloadJson` gains a `dismissed` block naming the person and the reason.

The seeded example is signal 11:

```json
{
  "terms": ["gonxt", "gonxt insurance"],
  "monthlyVolume": 9100,
  "growthBps": 11200,
  "dismissed": {
    "by": "tariq.mansour",
    "at": 1750000000000,
    "reason": "The spike is GONXT's own December brand campaign showing up in its own harvester. It is our spend, not market demand, so the weight is zero and the signal is unclustered."
  }
}
```

**What the Signals table shows today:** a row where the Weight cell reads `0`, the
Cluster cell reads `—`, and `payloadJson` is not a column at all. The reason is
invisible on the list. On the record screen the Payload is a JSON blob in
`text-11` mono, truncated at 60 characters in list contexts — in practice the
reader sees `{"terms":["gonxt","gonxt insurance"],"monthlyVolume":9100,…`. The
dismissal, the person and the reason are unreadable without opening dev tools.

**Design requirement:** make "dismissed" legible *without inventing a status
chip*, because there is no status field to drive one and adding one is a schema
change. Legitimate moves: treat `weight === 0 && clusterId === null` as a row
state (the `Table` primitive already accepts `rowState: (row) => "sealed" |
"draft"`); surface the `dismissed.reason` and `dismissed.by` as a readable line
rather than raw JSON; keep the row visible and never filter it out — the row
exists precisely so the next harvester run can see this pattern was already
rejected.

### Fact 2 — every estimate carries its method, and "market" is our own median

**(a) Demand estimates.** `scout_whitespaces.evidenceRefsJson` is not a bare list
of references. Every row is:

```json
{
  "refs": ["scout_cluster:clu_…", "funnel:gonxt-web/renewal-compare", "app-store:ae/gonxt-app/2026-01"],
  "demandEstimate": {
    "unit": "policies_per_year",
    "method": "own renewal book × observed abandonment rate at the compare step",
    "confidence": "high",
    "note": "The base is GONXT's own expiring motor policies, so the estimate cannot be larger than the book it came from."
  }
}
```

`confidence` is exactly `"low" | "medium" | "high"`. The `demandEstimate` **column**
is a bare integer (6200, 5400, 3400, 2100, 1900, 1800, 900) with the header
"Estimated demand" and no unit. The unit, method, confidence and caveat live in a
separate JSON column rendered as truncated mono text. Today a reader sees "6,200"
and "1,800" side by side with no way to know that the first is measured against
GONXT's own renewal book at high confidence and the second is "declined
commercial-use requests × an assumed shift count, no book to check it against" at
low confidence.

**Design requirement:** the number never appears alone. Wherever `demandEstimate`
renders, `unit`, `method` and `confidence` render with it — confidence as a
visible qualifier on the number, method and note reachable in one interaction.
`packages/ui/src/ai.tsx` already ships `EvidenceLink` (claim → dotted underline →
popover with the source) and `ConfidenceMeter`; neither is used in SCOUT.

**(b) The "market" price index is ours.** `scout_panel_bench.marketPriceIdx` is
labelled **"Market price index"** in the UI. It is basis points against the panel
median for the same risk, `10000` = the median — **and that median is GONXT's own
quote responses, not an industry price survey.** Every seeded row has
`marketPriceIdx: 10000` for exactly this reason: it is the normalisation baseline,
not an external measurement.

**Design requirement:** the UI must never present this as a third-party market
figure. The label is a live bug today. Whatever replaces it must say what the
baseline is (panel median of our own quote responses) at the point of reading, and
must show `10000` as a baseline rather than as a comparable value. Two rows
(Oryx/life, Meridian/loan) carry `null` for both indices — a life row with no
second life row has no median to index against, and a loan referral has no premium
— so "no index" is a real and meaningful state, not missing data.

Related: `winRate` (0–100) is meaningless without `volume`. Gulf Health's 34% is
**41 requests**. The two columns are adjacent in the table and nothing binds them.

---

## 5. Permission matrix — who sees what

Permission strings are `module:resource:action` (`packages/core/src/rbac.ts`).
SCOUT declares twelve, plus two AI permissions.

| Tab | Read | Create | Update |
|---|---|---|---|
| Signals | `scout:signals:read` | `scout:signals:ingest` | — (append-only) |
| Clusters | `scout:clusters:read` | — | — |
| Whitespace | `scout:whitespaces:read` | — | `scout:whitespaces:promote` |
| Panel benchmarks | `scout:panel_bench:read` | — | — |
| Experiments | `scout:experiments:read` | `scout:experiments:create` | `scout:experiments:decide` |
| Data products | `scout:data_products:read` | `scout:data_products:create` | `scout:data_products:publish` |

Also declared: `scout:ai:invoke`, `ai:suggestions:read`. Nothing in the web app
calls either from a SCOUT screen.

| Role | Signals | Clusters | Whitespace | Panel | Experiments | Data products |
|---|---|---|---|---|---|---|
| `scout.admin` | read + create | read | read + edit | read | read + create + edit | read + create + edit |
| `scout.lead` | **read only** | read | read + edit | read | read + create + edit | read + create, **no edit** |
| `scout.pm` | read only | read | read + edit | read | read + create, **no edit** | — (no read) |
| `tenant.admin` | read only | read | **read only** | read | read only | read only |
| `north.exec` | — | read | — | — | — | — |
| `north.analyst` | — | read | — | — | — | — |
| `provider.viewer` | — | — | — | read | — | read |
| `signal.lead`, `axis.lead`, `axis.agent`, `orbit.agent`, `orbit.partners`, `orbit.retention`, `finance.controller`, `finance.analyst`, `tenant.compliance`, `dev.admin` | — | — | — | — | — | — |

Rules that follow from the code:

- **Tabs the actor cannot read are absent, not disabled.** `visibleTabs()` filters
  the strip. A `north.exec` sees a single tab, so the tab strip is not rendered at
  all (it only renders when more than one tab is visible) — they land on a bare
  table with the heading "Market".
- **Write affordances are absent, not disabled.** No create permission → no create
  panel. No update permission → no edit form on the record screen. A `scout.lead`
  opening a Signals row sees a read-only definition list with nothing below it.
- **`/scout` with no resource** renders the first declared tab (Signals). If the
  actor cannot read Signals, the loader catches the 403 and redirects to the first
  tab they can read — so a `north.exec` typing `/scout` lands on `/scout/clusters`.
- **Denied deep link** (e.g. `provider.viewer` opening `/scout/whitespaces`): the
  API answers 403, `asRouteError` rethrows it as a route error, and root.tsx's
  boundary renders a centred `max-w-prose` column: `<h1>` "This did not load",
  body "Your roles do not include access to this area.", a mono line
  "Reference {request-id}", and a "Try again" link back to the same path. There is
  no navigation offered out of it beyond the shell.

---

## 6. Shared anatomy of a SCOUT list screen

All six list routes are `routes/module.tsx`. Read this once; the per-route
sections below only state what differs.

```
┌────────────────────────────────────────────────────────────────────────┐
│ Market                                              ← h1, display 24px │
│ ┌──────┬─────────┬───────────┬────────┬───────────┬──────────────┐     │
│ │Signals│Clusters│Whitespace │Panel…  │Experiments│Data products │     │  tab strip, 32px pills
│ └──────┴─────────┴───────────┴────────┴───────────┴──────────────┘     │
│                                                                        │
│ [ Source ▾ ]  [ Apply ]  [ Clear ]                    ← filter Form    │  only if filters exist
│                                                                        │
│ ┌────────────────────────────────────────────────────────────────┐     │
│ │ +  New — Signals                                               │     │  <details>, closed
│ └────────────────────────────────────────────────────────────────┘     │  only if create perm
│                                                                        │
│ ┌────────────────────────────────────────────────────────────────┐     │
│ │ SOURCE  SOURCE REF  CLUSTER  WEIGHT  OBSERVED ▼  CREATED ↕     │     │  sticky, 11px caps
│ ├────────────────────────────────────────────────────────────────┤     │
│ │ search  search-tre… clu_…        9   2 Jan 14:0  2 Jan 14:12   │     │  13px rows
│ │ …                                                              │     │
│ └────────────────────────────────────────────────────────────────┘     │
│ 12 shown                                          [Previous] [Next]    │
└────────────────────────────────────────────────────────────────────────┘
```

**Heading.** Always `t("nav.scout")` = **"Market"** (ar: "السوق"). It is the
*workspace* name, not the tab name. Six different tables share one heading; the
only indicator of which one you are on is the highlighted tab pill.

**Tab strip.** `<nav aria-label="Sections">`, `<ul>` of `<li><Link>`. Each pill is
`h-8 rounded-md px-3`, font-ui 13px. Active: `bg-surface-2`, `font-medium`,
`text-text`, `aria-current="page"`. Idle: `text-subtle`, hover
`bg-surface-2 text-text`. 150ms colour transition. Rendered only when more than
one tab is visible to this actor.

**Links strip** (`aria-label="Reports and tools"`): SCOUT declares no `links`, so
this never renders.

**Filter bar.** A `<Form method="get">`, `flex flex-wrap items-end gap-3`. Rendered
only if the tab has `search`, `filters`, or the actor can restore. SCOUT has no
search and no restore anywhere, so: **Signals, Whitespace, Experiments and Data
products have a filter bar; Clusters and Panel benchmarks have none.** Each filter
is a `<Select>` whose `aria-label` and placeholder are the field label and whose
first option is "All". Then a secondary "Apply" button; a ghost "Clear" link
appears only when a filter is currently applied. Filters are **exact match** on the
API side; `?source=news,regulatory` would mean "either", but the Select only ever
emits one value.

**Create panel.** A `<details>` with `border border-border bg-surface-1
rounded-lg`. Summary row: a `+` glyph that rotates 45° when open, then
`New — <tab label>` at 13px. Body: `border-t`, `p-4`, a `grid gap-4 sm:grid-cols-2`
of inputs, then a primary "Create" button. Closed by default; **re-opens
automatically when the last submit was rejected**, with a red alert above it.

**Problem alert.** `role="alert"`, `rounded-md border border-danger/40
bg-danger/10 p-3`, one line of 13px text showing `problem.detail ?? problem.title`
from the RFC 9457 body. Sits above the create panel and the table.

**Table** (`packages/ui/src/data.tsx`). `density="compact"` → cells `px-2.5 py-1.5`;
`stickyHeader`; wrapper `overflow-auto rounded-lg border border-border`; table
font-ui 13px. Headers: `border-b border-border bg-surface-1 font-medium uppercase
tracking-wider text-11 text-subtle`. Numeric and money columns align to the
inline-end edge with `tabular-nums`. Every table carries an sr-only `<caption>`:
`"Market — Signals"`.

**Sortable headers** are `<button>`s showing the header text plus a glyph: `↕`
inactive, `▲` ascending, `▼` descending; active header turns `text-accent`; the
`<th>` carries `aria-sort`. Clicking sets `sort`/`order` in the query string and
**drops the cursor** (back to page 1).

**Row link.** The **first column only** is a link into the record
(`/scout/<tab>/<id>`), `font-medium text-text` with hover underline. There is no
whole-row click target.

**Cell rendering** (`apps/web/app/components/fields.tsx`):

| Type | Rendering |
|---|---|
| null / undefined / `""` | `—` in `text-subtle` |
| `text` | truncated at 80 characters |
| `number` | `tabular-nums`, right-aligned, no unit, no formatting |
| `datetime` | `<DateTime precision="minute">`, locale-formatted |
| `json` | `font-mono text-11 text-subtle`, **truncated at 60 characters** |
| `badge` | `<Badge tone size="sm" dot>` — tone from a shared status map |

**Badge tones are a live problem in SCOUT.** The shared `TONES` map contains
`draft: neutral` and `running: info` and nothing else SCOUT uses. Every other
SCOUT status value — `candidate`, `validating`, `validated`, `parked`,
`concluded`, `abandoned`, `published`, `suspended` — falls through to `neutral`.
So on Whitespace all four statuses are the same grey pill; on Data products a
published product, a draft and a **suspended** product are visually identical.

**Empty state.** `EmptyState` — a dashed-border `rounded-lg p-10` centred block
with a thin-line constellation SVG, a 16px display title and a 13px subtle body.
Title "Nothing here yet"; body "No records match this view. Clear the filters, or
create the first one." — or, when a filter is applied, "No records match these
filters."

**Footer.** Left: `"{count} shown"` in 12px `tabular-nums` subtle — **the count of
rows on this page, not a total.** Right: "Previous" (only when a cursor is in the
URL; returns to page 1, keeping filters) and "Next" (only when the API returned a
cursor). Keyset pagination, forward-only.

**Loading.** There is no skeleton and no spinner on a list. React Router loaders
block navigation; the previous screen stays until the new one is ready. Buttons on
in-flight forms get `loading` (the `Button` primitive's busy treatment).

---

## 7. The six list routes

### 7.1 `/scout` and `/scout/signals` — Signals

| | |
|---|---|
| **Path** | `/scout/signals` (also served at `/scout`) |
| **Page title** | "Market" (`nav.scout`); tab label "Signals" (`signals`, ar "الإشارات") |
| **API** | `GET /v1/scout/signals`, `POST /v1/scout/signals` |
| **Generated?** | Yes — entirely. `r("signals", schema.scoutSignals, "sig", "scout", …)` |

**Who sees it.** Read: `scout:signals:read` — `scout.admin`, `scout.lead`,
`scout.pm`, `tenant.admin`. Create: `scout:signals:ingest` — **`scout.admin` only**.
`north.exec`/`north.analyst`/`provider.viewer` and the ten no-SCOUT roles get the
403 boundary ("Your roles do not include access to this area."), except that
`/scout` bare redirects a clusters-only reader to `/scout/clusters`.

**Purpose.** The evidence floor: every raw observation the harvester or a human
recorded, in the order it was observed.

**Layout.**

```
Market
[Signals][Clusters][Whitespace][Panel benchmarks][Experiments][Data products]

[ Source ▾ ] [Apply] [Clear]

+ New — Signals                                    (scout.admin only)

┌──────────────────────────────────────────────────────────────────────────┐
│ SOURCE   SOURCE REFERENCE          CLUSTER   WEIGHT   OBSERVED ▼  CREATED│
├──────────────────────────────────────────────────────────────────────────┤
│ search   search-trends:ae/ev-car…  clu_9f2…       9   2 Jan 14:02  14:14 │
│ quotes   dist_offering:GNX-MOT-STD clu_9f2…       7   2 Jan 07:11  07:23 │
│ …                                                                        │
│ search   search-trends:ae/brand-t…      —         0   7 Dec 09:40  09:52 │  ← dismissed
└──────────────────────────────────────────────────────────────────────────┘
12 shown                                                    [Previous][Next]
```

**Table columns** (in order, exactly):

| # | Column | Header (en / ar) | Type | Align | Sortable | Notes |
|---|---|---|---|---|---|---|
| 1 | `source` | Source / المصدر | text | start | no | **Raw enum value, untranslated.** Renders `search`, `quotes`, `abandonment`, `reviews`, `news`, `regulatory` — not "Search demand" etc., because the column is `type: "text"`, not `badge`, and only badges and select options go through `optionLabel`. The label table has the translations; the column does not use them. Also the row link. |
| 2 | `sourceRef` | Source reference / مرجع المصدر | text | start | no | e.g. `search-trends:ae/ev-car-insurance`, `dist_offering:GNX-MOT-STD`, `app-store:ae/gonxt-app/2026-01`, `rss:gulf-logistics-weekly/2025-12-18`. Truncated at 80 chars. |
| 3 | `clusterId` | Cluster / المجموعة | text | start | no | Raw id `clu_…`. **Not a link, not a theme name.** `—` when unclustered. |
| 4 | `weight` | Weight / الوزن | number | end | no | 0–9 in the seed. No scale, no max, no unit. |
| 5 | `observedAt` | Observed / تاريخ الرصد | datetime | start | **yes** | Default sort, descending. |
| 6 | `createdAt` | Created / (common) | datetime | start | **yes** | Always `observedAt + 12 minutes` — the harvester batches every quarter hour. Two near-identical timestamps sit side by side. |

Not shown anywhere on this screen: `payloadJson` (the entire observation),
`embeddingRef` (`vec:scout-search-0`).

**Filters.** One `<Select>`, `name="source"`, aria-label "Source", options: All /
Search demand / Quote flow / Abandonment / Reviews / News / Regulatory. Note the
mismatch: the filter dropdown shows the friendly labels, the table column shows
the raw values.

**Create form** (`scout.admin` only), 2-column grid:

| Field | Label | Control | Required | Default | Validation |
|---|---|---|---|---|---|
| `source` | Source | `<Select>` — Search demand / Quote flow / Abandonment / Reviews / News / Regulatory | **yes** | none | HTML `required`; API rejects unknown values |
| `sourceRef` | Source reference | `<Input type="text">` | no | none | free text |
| `payloadJson` | Payload | `<Textarea rows={6}>`, `font-mono text-12` | **yes** | none | Parsed with `JSON.parse` in the action. **Malformed JSON throws before the request is sent and reaches the route error boundary — the actor gets "This did not load" and loses the typed payload.** |
| `weight` | Weight | `<Input type="number" step={1}>` | no | DB default `1` | no min/max |
| `observedAt` | Observed | `<Input type="datetime-local">` | **yes** | none | parsed to epoch ms |

Submit: "Create". `id`, `tenantId`, `createdAt`, `updatedAt`, `deletedAt` are
server-owned and are stripped from any submitted body.

**States.**
- *Empty:* "Nothing here yet" / "No records match this view. Clear the filters, or
  create the first one." — offered even to an actor with no create permission.
- *Filtered empty:* "No records match these filters."
- *Loading:* nothing; the previous route stays.
- *Error (create rejected):* red alert with the API's `detail`, create panel
  re-opened, values retained by the browser.
- *Permission denied:* full-page boundary, "Your roles do not include access to
  this area."

**AI surfaces.** None. Zero ✦ on this screen. Signals are the input to clustering
and the embedding reference (`embeddingRef`) is written by the harvester, but
neither the fact that a signal was embedded, nor which cluster the model assigned
it to (beyond a raw id), nor any confidence is shown. If a ✦ belongs anywhere on
this screen it is on `clusterId` — that assignment is a model output, and its
"why" (which theme, how close) is exactly what an analyst would want on hover.

**Actions and consequences.** Create only. **Ingestion is irreversible**: there is
no edit, no delete, no soft delete, no restore. A mistyped signal is permanent and
can only be answered by another signal. The create writes an audit entry
`scout.signals.create` and emits `scout.signals.created` on the event bus.

**Mobile.** Expo maps `/scout` → `scout/signals` (`apps/mobile/src/nav.ts`), so
Signals **is** the whole of SCOUT on mobile. The list screen is a `FlatList` of
cards; each card shows a title from the first of `name, title, reference, subject,
code, email, key, id` that the row has — for a signal, **only `id` matches**, so
every card reads `sig_01H…`. Subtitle comes from `status, state, stage, kind,
type, email` — a signal has none, so there is no subtitle. The mobile SCOUT list
is a column of opaque identifiers. Header shows "Market", a "Back" button, and
"{n} shown". Empty: "There is nothing here yet." No filters, no create, read-only.

**RTL.** Arabic mirrors the whole layout (`dir="rtl"` on the document; the shell
uses logical properties throughout). Mirror: tab strip order, filter bar, table
column order, the sidebar. Do **not** mirror: the `sourceRef` values
(`search-trends:ae/ev-car-insurance`) and `clusterId` — these are LTR identifiers
inside RTL text and need `dir="ltr"` with `unicode-bidi: isolate`, or they render
with the colon and slashes in the wrong places. Numbers in the Weight column are
`tabular-nums`; keep them LTR. Dates go through `<DateTime>` with the locale, so
Arabic gets Arabic month names — correct.

**What is weak today.**
1. Fact 1 is unreadable. A dismissed signal is a row with `0` and `—` in it. The
   named person, the date and the whole reason are in a column that is not on the
   screen.
2. `source` shows raw enum values in the table while the filter beside it shows
   translated labels. Straight inconsistency.
3. `clusterId` is a raw id and not a link. To find out what `clu_9f2…` is you must
   go to the Clusters tab and eyeball ids.
4. `Observed` and `Created` differ by exactly 12 minutes on every row — two columns
   carrying one fact.
5. `weight` is a bare integer with no scale. 9 vs 0 has no visual weight.
6. The payload — the actual content of the observation — never appears in the list.
   You cannot skim signals for meaning; you can only skim them for shape.

---

### 7.2 `/scout/clusters` — Clusters

| | |
|---|---|
| **Path** | `/scout/clusters` |
| **Page title** | "Market"; tab label "Clusters" (`clusters`, ar "المجموعات") |
| **API** | `GET /v1/scout/clusters` only — registered read-only (`ro(...)`) |
| **Generated?** | Yes, entirely |

**Who sees it.** `scout:clusters:read` — `scout.admin`, `scout.lead`, `scout.pm`,
`tenant.admin`, **`north.exec`, `north.analyst`**. Nobody can write: there is no
create, update or delete permission on this resource at all. `provider.viewer` and
the ten no-SCOUT roles get the 403 boundary.

**This is the only SCOUT screen an executive ever sees.** For `north.exec` and
`north.analyst` it renders with **no tab strip** (only one visible tab) — heading
"Market" over a bare table.

**Purpose.** What clustering made of the signals: the themes, how much momentum
each has, and how many signals sit behind it.

**Layout.**

```
Market
[Signals][Clusters][…]                      ← absent for north.exec / north.analyst

                                            ← no filter bar, no create panel
┌────────────────────────────────────────────────────────────────────────────────┐
│ THEME          SUMMARY                        MOMENTUM ▼  SIGNALS  LAST SEEN   │
├────────────────────────────────────────────────────────────────────────────────┤
│ EV motor cover Battery damage, home-charger…        88      412    today 12:04 │
│ Agency repair… Renewal quotes drop agency r…        71      305    today 09:11 │
│ Domestic help… Motor and home shoppers ask …        64      218    yesterday   │
│ Delivery ride… Riders and their fleet opera…        57      164    2 days ago  │
│ Visa-applicat… Single-trip travel cover bou…        43      189    4 days ago  │
│ Maternity wai… Health shoppers want the wai…        36       96    3 days ago  │
│ Competitor br… A December spike in competit…         9       41    26 days ago │
└────────────────────────────────────────────────────────────────────────────────┘
7 shown
```

**Table columns:**

| # | Column | Header | Type | Align | Sortable |
|---|---|---|---|---|---|
| 1 | `theme` | Theme / الموضوع | text | start | no |
| 2 | `summary` | Summary / الملخص | text | start | no |
| 3 | `momentumScore` | Momentum / مؤشر الزخم | number | end | **yes** |
| 4 | `size` | Signals / عدد الإشارات | number | end | no |
| 5 | `lastSeen` | Last seen / آخر ظهور | datetime | start | **yes** |
| 6 | `updatedAt` | Updated / (common) | datetime | start | **yes** |

Default sort `momentumScore` descending — the code comment says this is "what the
radar quadrant is ordered by anyway".

**The summary column is the problem.** Seeded summaries are 220–330 characters:

> "Battery damage, home-charger damage and range-related towing come up in EV
> motor searches and in call-centre questions. None of the four motor rows on the
> panel prices them, so the comparison answers a question the shopper did not ask."

`Cell` truncates `text` at 80 characters. So the reader gets the first sentence
fragment of every cluster and must open each record to read the actual finding —
which is the entire content of this table.

**Not shown, though the table stores them:**
- `firstSeen` — how long this theme has existed. Absent from the spec's columns.
- `trailJson` — **the momentum trail**, one point per weekly clustering run,
  `[{at, momentum}, …]`. EV motor cover: 24 → 41 → 63 → 82 → 88. Visa travel:
  68 → 61 → 52 → 46 → 43 (declining). Competitor brand advertising: 47 → 31 → 14
  → 9 (dead). **This column is not rendered anywhere in the product — not in the
  list, not on the record screen.** The design system ships `Sparkline` (with a
  required text alternative) and it is unused. Today a cluster at 43 and falling
  and a cluster at 43 and rising look identical.

**Filters.** None declared. No filter bar renders.

**Forms.** None. Read-only resource; no create panel, no edit form on the record,
no delete.

**States.** Empty "Nothing here yet" (never filtered — there are no filters, so the
"filtered" variant is unreachable here). Denied → boundary.

**AI surfaces.** None — and this is the screen where their absence costs most.
Every row on this table is a model output: the theme name, the summary prose, the
membership count and the momentum score were all produced by clustering. Nothing
carries a ✦, nothing says which run produced it, nothing offers a "why". The
`AgentBadge` component in `packages/ui/src/ai.tsx` renders exactly this — an
accent-tone chip with the single `✦` mark and a popover of the explanation — and
SCOUT never imports it. An executive reading this table has no signal that these
are inferences rather than counted facts.

**Actions and consequences.** None. Nothing on this screen changes anything.

**Mobile.** Not reachable. Mobile maps `/scout` to `scout/signals` only.

**RTL.** Mirror the table. Do **not** mirror a momentum trail if one is added: a
time series runs left→right in Arabic too when it is a chart; mirroring it inverts
the meaning of "rising". The safe rule is the same one the tokens file implies —
mirror layout, never mirror data-time axes. Theme and summary are prose and should
be translated content; the seeded strings are English only.

**What is weak today.**
1. The summary — the actual finding — is cut at 80 characters.
2. `trailJson` exists, is populated, is meaningful, and is invisible. Momentum is a
   number with no direction.
3. `size` (412 signals) is not a link to those signals. There is no way from a
   cluster to its evidence.
4. No confidence, no run identity, no ✦ on machine-generated prose.
5. `lastSeen` and `updatedAt` are within hours of each other on every row.
6. This is an executive's only SCOUT screen, and it is a six-column grey table.

---

### 7.3 `/scout/whitespaces` — Whitespace

| | |
|---|---|
| **Path** | `/scout/whitespaces` |
| **Page title** | "Market"; tab label "Whitespace" (`whitespaces`, ar "الفجوات السوقية") |
| **API** | `GET /v1/scout/whitespaces`, `PATCH /v1/scout/whitespaces/:id` |
| **Generated?** | Yes. There is **no bespoke promote endpoint** — "promote" is a generic PATCH gated on `scout:whitespaces:promote` |

**Who sees it.** Read: `scout:whitespaces:read` — `scout.admin`, `scout.lead`,
`scout.pm`, `tenant.admin`. Edit: `scout:whitespaces:promote` — `scout.admin`,
`scout.lead`, `scout.pm` (**not** `tenant.admin`, who sees the record with no form
below it). Everyone else: 403 boundary.

**Purpose.** The promotion decision. This table is where a demand estimate turns
into a commitment to build.

**Layout.**

```
Market
[Signals][Clusters][Whitespace][Panel benchmarks][Experiments][Data products]

[ Status ▾ ] [Apply] [Clear]
                                                        ← no create panel: whitespace
                                                          is derived, never authored
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ OPPORTUNITY      CLUSTER  EVIDENCE          EST. DEMAND ▼ COMPETITION STATUS OWNER  PRO…│
├────────────────────────────────────────────────────────────────────────────────────────┤
│ A motor renewal… clu_…    {"refs":["scout…       6200          62   ●Validated tariq… │
│ Single-trip tra… clu_…    {"refs":["scout…       5400          84   ●Parked    tariq… │
│ Motor cover tha… clu_…    {"refs":["scout…       3400          38   ●Validating tariq…│
│ Domestic helper… clu_…    {"refs":["scout…       2100          45   ●Candidate    —   │
│ Cedar Home Cont…   —      {"refs":["dist_…       1900          22   ●Validating dana… │
│ Motor cover for… clu_…    {"refs":["scout…       1800          29   ●Candidate    —   │
│ A health row th… clu_…    {"refs":["scout…        900          51   ●Candidate    —   │
└────────────────────────────────────────────────────────────────────────────────────────┘
7 shown
```

**Table columns:**

| # | Column | Header | Type | Align | Sortable | Notes |
|---|---|---|---|---|---|---|
| 1 | `description` | Opportunity / الفرصة | text | start | no | Row link. Seeded values are 60–95 chars; the 80-char truncation bites: "Cedar Home Contents offered at the Meridian mortgage step, where the embed sells m…" |
| 2 | `clusterId` | Cluster / المجموعة | text | start | no | Raw id; `—` for the mortgage/home row, which has no cluster (it is a product × channel gap, not a theme) |
| 3 | `evidenceRefsJson` | Evidence / الأدلة | json | start | no | **The whole of Fact 2(a), rendered as 60 characters of 11px mono.** |
| 4 | `demandEstimate` | Estimated demand / الطلب المقدّر | number | end | **yes** | Default sort, desc. Bare integer, no unit, no thousands separator guarantee, **no confidence** |
| 5 | `competitionScore` | Competition / مؤشر المنافسة | number | end | no | 0–100. Higher = more contested (84 parked the visa idea) — nothing on screen says which direction is bad |
| 6 | `status` | Status / الحالة | text, **badge** | start | no | `candidate` / `validating` / `validated` / `parked` — **all four render the same neutral grey pill** |
| 7 | `owner` | Owner / المسؤول | text | start | no | A raw handle: `tariq.mansour`, `dana.aziz`, or `—`. Not a user record, not an avatar |
| 8 | `promotedAt` | Promoted / تاريخ الترقية | datetime | start | no | `—` for anything never promoted |
| 9 | `updatedAt` | Updated | datetime | start | **yes** | |

**Filters.** One `<Select>`, `name="status"`, aria-label "Status": All / Candidate
/ Validating / Validated / Parked. (Translated labels here; the badge in the table
does go through `optionLabel`, so status *is* consistently labelled — the one
column in SCOUT that is.)

**Forms.** No create. The record screen carries an edit form for holders of
`scout:whitespaces:promote`:

| Field | Label | Control | Required | Default | Notes |
|---|---|---|---|---|---|
| `status` | Status | `<Select>`: Candidate / Validating / Validated / Parked | no | current value | Any transition to any other is allowed — no state machine, no guard |
| `owner` | Owner | `<Input type="text">` | no | current | Free text. No user picker, no validation that the handle exists |
| `promotedAt` | Promoted | `<Input type="datetime-local">` | no | current | The spec comments why this is editable: "`promote` is a generic PATCH here (no bespoke route in the API), so the stamp has to be settable or the promotion has no date." **The actor types the date of their own promotion.** |

Submit: "Save changes". An empty string means "not supplied" and is dropped from
the PATCH body; a PATCH with nothing in it answers 400 "no fields to update".

**States.** Empty / filtered-empty as §6. Rejected save → red alert above the form
carrying the API's detail. Denied → boundary.

**AI surfaces.** None today. This is the second-most important place for them.
Every `demandEstimate` is a triangulation whose method, confidence and caveat are
already recorded structurally (Fact 2a). The pieces already exist in
`packages/ui/src/ai.tsx`: `EvidenceLink` (dotted accent underline → popover
labelled "Evidence"), `ConfidenceMeter` (0–1, tone-graded, with a floor below
which the UI should require review rather than offer acceptance), `AgentBadge`
(the single ✦ with a "why" popover). None are imported. The design brief for this
screen: **a demand number must never be readable without its confidence in the
same glance and its method one interaction away.** No modal — a popover or an
inline expansion, per the ambient AI grammar.

**Actions and consequences.** Editing `status` to `validated` is the act that tells
the business to build something; there is no approval step, no confirmation, no
audit surface on the screen (the API does write `scout.whitespaces.update` audit
entries with before/after images, but nothing in the UI shows them). It is
reversible in the sense that you can set it back, but the promotion date is
whatever anyone typed and the downstream build decision is not. No delete.

**Mobile.** Web only. Not reachable from the Expo app.

**RTL.** Mirror layout and column order. Keep `clusterId`, the `refs` strings
(`scout_cluster:clu_…`, `dist_offering:CDR-HOM-CONT`) and the owner handles LTR.
`demandEstimate` and `competitionScore` should keep Western digits with
`tabular-nums` for column comparison; if Arabic-Indic digits are ever used, they
must be used consistently down the whole column.

**What is weak today.**
1. Fact 2(a) is invisible. "6,200" and "1,800" look equally solid. One is measured
   against our own renewal book (high confidence); the other is "an assumed shift
   count, no book to check it against" (low).
2. No unit anywhere. The estimates are policies per year and the screen never says
   so.
3. All four statuses are the same grey. The pipeline this table represents has no
   visual shape.
4. `competitionScore` has no polarity. 84 killed the visa opportunity; 22 is why
   the mortgage row survives. Nothing says high is bad.
5. Promotion is a text field plus a hand-typed date, not an action. There is no
   "Promote" button, no reason capture, no record of who promoted.
6. No path from a whitespace to its cluster, its signals, or its experiments —
   even though `whitespaceId` on Experiments points straight back here.
7. `owner: null` renders as `—` with no "assign" affordance.

---

### 7.4 `/scout/panel-bench` — Panel benchmarks

| | |
|---|---|
| **Path** | `/scout/panel-bench` |
| **Page title** | "Market"; tab label "Panel benchmarks" (`panel-bench`, ar "مقارنة المزودين") |
| **API** | `GET /v1/scout/panel-bench` only — read-only resource |
| **Generated?** | Yes, entirely |

**Who sees it.** `scout:panel_bench:read` — `scout.admin`, `scout.lead`,
`scout.pm`, `tenant.admin`, **`provider.viewer`**. No writes exist for anyone.
For `provider.viewer` the tab strip shows two tabs (Panel benchmarks, Data
products) and nothing else.

**Purpose.** How each panel provider prices and wins against the panel median, by
line and month. It is the input to a negotiation conversation.

**Layout.**

```
Market
[…tabs…]
                                            ← no filter bar (none declared), no create
┌────────────────────────────────────────────────────────────────────────────────────┐
│ PROVIDER   LINE    PERIOD ▼  OUR PRICE IDX  MARKET PRICE IDX  WIN RATE  VOLUME  UPD│
├────────────────────────────────────────────────────────────────────────────────────┤
│ prv_cedar  motor   2026-01           9420            10000        44    1812   …   │
│ prv_falcon motor   2026-01          10380            10000        27    1640   …   │
│ prv_gonxt  motor   2026-01          10110            10000        19    1704   …   │
│ prv_oryx   motor   2026-01          10640            10000         6     388   …   │
│ prv_gulfh… health  2026-01           9880            10000        34      41   …   │
│ prv_gonxt  travel  2026-01           9240            10000        61     623   …   │
│ prv_cedar  home    2026-01          10050            10000        52     214   …   │
│ prv_oryx   life    2026-01              —                —        38      76   …   │
│ prv_merid… loan    2026-01              —                —        71     132   …   │
│ prv_cedar  motor   2025-12           9510            10000        47    1996   …   │
│ …                                                                                  │
└────────────────────────────────────────────────────────────────────────────────────┘
12 shown
```

**Table columns:**

| # | Column | Header | Type | Align | Sortable | Notes |
|---|---|---|---|---|---|---|
| 1 | `providerId` | Provider / المزود | text | start | no | Raw id. Not the provider's name. Row link. |
| 2 | `line` | Line / خط المنتج | text | start | no | `motor`, `health`, `travel`, `home`, `life`, `loan` — raw, untranslated |
| 3 | `period` | Period / الفترة | text | start | **yes** | `"YYYY-MM"` as a *string*. Default sort, desc — which happens to sort correctly, but it is lexical, not chronological |
| 4 | `ourPriceIdx` | Our price index / مؤشر سعرنا | number | end | no | Basis points; 10000 = panel median. `9420` means 5.8% below median. Nothing on screen explains basis points |
| 5 | `marketPriceIdx` | **Market price index** / مؤشر سعر السوق | number | end | no | **Always 10000. This is Fact 2(b): it is GONXT's own quote-response median, and the label says "Market".** |
| 6 | `winRate` | Win rate / نسبة الفوز | number | end | no | 0–100, no `%` sign rendered |
| 7 | `volume` | Volume / الكمية | number | end | no | Requests. Gulf Health's 34 win rate is on 41 requests |
| 8 | `updatedAt` | Updated | datetime | start | **yes** | |

**Not shown:** `coverageGapsJson`, which is the most decision-useful column in the
table. Examples: `{"term":"agency_repair","ours":false,"panelMedian":true,"note":"The
cheapest row is cheapest partly because of this."}`;
`{"term":"quote_latency","oursSeconds":118,"panelMedianSeconds":3,"note":"Priced by
hand against a 120s SLA, so most requests are decided before the row arrives."}`.
This is the explanation for the win rate sitting in the next column, and it is not
on the screen.

**Filters.** None declared. No filter bar. There is no way to look at one provider,
one line, or one period without reading the whole table.

**Forms.** None. Read-only.

**States.** Empty "Nothing here yet". Denied → boundary. No filtered state — no
filters exist.

**AI surfaces.** None. These are computed indices rather than model outputs, so the
absence is defensible — but the derivation ("basis points against the panel median
for the same risk, where the median is our own quote responses") is exactly the
kind of claim `EvidenceLink` exists for.

**Actions and consequences.** None.

**Mobile.** Web only.

**RTL.** Mirror the table. Numbers stay LTR with `tabular-nums`; a basis-point
index is a magnitude comparison down a column and must stay column-aligned.
`providerId` and `line` are LTR tokens. **Do not mirror a price-index scale** if
one is added — a bar that runs from the 10000 baseline reads as "cheaper" in one
direction, and mirroring it inverts the claim.

**What is weak today.**
1. "Market price index" is a false label (Fact 2b). It is our own median.
2. Every value in that column is `10000`. A whole column of identical numbers,
   because it is a baseline and not a measurement.
3. `winRate` and `volume` are adjacent, unlinked numbers. 34% on 41 requests reads
   the same as 44% on 1,812.
4. `coverageGapsJson` — the reason behind every win rate on the table — is not
   rendered at all.
5. No filters on a table that is inherently sliced by provider × line × period.
6. `providerId` is a raw id, so the reader must know which id is Cedar.
7. `null` indices (life, loan) render as `—` with no explanation, though the data
   explains them: no second life row to index against; a loan referral has no
   premium.
8. Basis points are shown as raw four- and five-digit integers.

---

### 7.5 `/scout/scout-experiments` — Experiments

| | |
|---|---|
| **Path** | `/scout/scout-experiments` (the doubled word is real — the resource is registered as `scout-experiments` under `/v1/scout/`) |
| **Page title** | "Market"; tab label "Experiments" (`scout-experiments`, ar "التجارب") |
| **API** | `GET/POST /v1/scout/scout-experiments`, `PATCH /v1/scout/scout-experiments/:id` |
| **Generated?** | Yes, entirely |

**Who sees it.** Read: `scout:experiments:read` — `scout.admin`, `scout.lead`,
`scout.pm`, `tenant.admin`. Create: `scout:experiments:create` — `scout.admin`,
`scout.lead`, `scout.pm`. Edit (conclude): `scout:experiments:decide` —
**`scout.admin` and `scout.lead` only**. A `scout.pm` can start an experiment and
cannot end one; the spec comment says why: "Concluding an experiment is a
decision, not an edit." `tenant.admin` reads only.

**Purpose.** The landing-page tests that turn a demand estimate into an observed
number, and the record of what each test concluded.

**Layout.**

```
Market
[…tabs…]

[ State ▾ ] [Apply] [Clear]

+ New — Experiments

┌──────────────────────────────────────────────────────────────────────────────────┐
│ WHITESPACE   LANDING PAGE             STATE      STARTED ▼   CONCLUDED   CREATED │
├──────────────────────────────────────────────────────────────────────────────────┤
│ wsp_…        x/agency-repair-renewal  ●Concluded  8 Jun      29 Jun      4 Jun   │
│ wsp_…        x/agency-repair-renewal  ●Concluded  6 Jul      27 Jul      4 Jul   │
│ wsp_…        x/ev-battery-cover       ●Running   21 Jul          —      20 Jul   │
│ wsp_…        x/domestic-helper-cover  ●Running   28 Jul          —      26 Jul   │
│ wsp_…             —                   ●Draft         —          —      18 Jul   │
│ wsp_…        x/single-trip-travel     ●Abandoned 10 Jul      14 Jul       8 Jul  │
└──────────────────────────────────────────────────────────────────────────────────┘
6 shown
```

**Table columns:**

| # | Column | Header | Type | Align | Sortable | Notes |
|---|---|---|---|---|---|---|
| 1 | `whitespaceId` | Whitespace / الفجوة | text | start | no | Raw `wsp_…` id. Row link. Two rows share one whitespace (the replication pair) and nothing on screen shows that |
| 2 | `landingRef` | Landing page / صفحة الهبوط | text | start | no | A path fragment: `x/agency-repair-renewal`. **Not a URL and not a link** — nothing on this screen opens the page being tested |
| 3 | `state` | State / الوضع | text, **badge** | start | no | `draft` → grey, `running` → **info blue** (the only coloured badge in SCOUT), `concluded` → grey, `abandoned` → grey |
| 4 | `startedAt` | Started / تاريخ البدء | datetime | start | **yes** | `—` on a draft |
| 5 | `concludedAt` | Concluded / تاريخ الانتهاء | datetime | start | no | `—` while running |
| 6 | `createdAt` | Created | datetime | start | **yes** | |

**Not shown in the list:** `trafficPlanJson` and `resultsJson` — the spend cap and
the outcome. So the list tells you an experiment ran and stopped, and nothing about
what it cost or what it found.

**Filters.** One `<Select>`, `name="state"`, aria-label "State": All / Draft /
Running / Concluded / Abandoned.

**Create form** (2-column grid):

| Field | Label | Control | Required | Notes |
|---|---|---|---|---|
| `whitespaceId` | Whitespace | `<Input type="text">` | **yes** | **A free-text id field.** No picker, no validation against the whitespace table on the client; a wrong id is accepted until the API objects |
| `landingRef` | Landing page | `<Input type="text">` | no | free text |
| `trafficPlanJson` | Traffic plan | `<Textarea rows={6}>` mono 12px | no | Hand-authored JSON |

The seeded traffic plans have a fixed shape the form does not hint at:

```json
{
  "channels": ["gonxt-web", "gonxt-app"],
  "dailyCapMinor": 120000,
  "currency": "AED",
  "maxDays": 21,
  "bannerKey": "scout.experiment.not_yet_available",
  "stopRule": "halt at the cap or at maxDays, whichever comes first"
}
```

`bannerKey` is the honesty banner: a landing page measuring demand for something
GONXT cannot yet sell must say so on the page. **The key `scout.experiment.not_yet_available`
has no entry in `apps/web/app/i18n/en.ts` or `ar.ts`.** It exists in seeded data and
resolves to nothing.

**Edit form** (`scout:experiments:decide` holders only):

| Field | Label | Control | Notes |
|---|---|---|---|
| `state` | State | `<Select>`: Draft / Running / Concluded / Abandoned | Any transition to any other; no guard, no confirm |
| `startedAt` | Started | `<Input type="datetime-local">` | hand-typed |
| `concludedAt` | Concluded | `<Input type="datetime-local">` | hand-typed |
| `resultsJson` | Results | `<Textarea rows={6}>` mono | The verdict, hand-authored JSON |

Seeded results carry a consistent vocabulary the form does not enforce:
`{visits, quoteStarts, waitlist, qualifiedDemandBps, verdict, note}` for a
concluded run (`"verdict": "supported"`, 686 bps); `{replicationOf, …, "verdict":
"did_not_replicate"}` for the repeat that failed on broker and call traffic (159
bps); `{interim: true, asOf, …, spentMinor}` with **no verdict** while running;
`{…, stoppedReason, spentMinor}` for the abandoned one.

**States.** Empty / filtered-empty as §6. Rejected create → alert + re-opened
panel. Denied → boundary. There is no "running" indicator beyond the blue badge —
no progress against `maxDays`, no spend against `dailyCapMinor`, even though
`spentMinor` is in the results blob (810,000 minor units on the EV waitlist).

**AI surfaces.** None.

**Actions and consequences.** Creating an experiment records an intent to spend;
setting `state` to `running` is the act that starts a public landing page pointed
at a product that does not exist. There is **no confirmation dialog**, no approval
gate, no budget display, no link to the page itself. Under CLAUDE.md §4 an
outbound public surface is the shape of a consequential action; this screen treats
it as a select box. Concluding is likewise a plain select. Nothing is deletable.

**Mobile.** Web only.

**RTL.** Mirror layout. Keep `landingRef` (`x/agency-repair-renewal`),
`whitespaceId` and the JSON blocks LTR — a JSON object rendered in an RTL run puts
the braces and colons in visually wrong places. The `<Textarea>` for JSON should
carry `dir="ltr"` regardless of locale.

**What is weak today.**
1. The results — the only reason an experiment exists — are not in the list and
   are raw JSON on the record.
2. `verdict: "supported"` vs `verdict: "did_not_replicate"` is the single most
   important word in this module and it is buried inside a blob.
3. The replication pair (same whitespace, same landing page, different channels,
   opposite outcomes) is invisible; `replicationOf` is inside the JSON.
4. No spend surface. `dailyCapMinor`, `spentMinor` and `maxDays` exist and none
   render. `BudgetMeter` exists in the design system and is unused here.
5. `landingRef` is not a link.
6. The honesty banner key has no translation.
7. `whitespaceId` is typed by hand.
8. `scout_experiments` has **no `updatedAt` column** at all — the record screen's
   "Updated" row simply never appears for this resource.

---

### 7.6 `/scout/data-products` — Data products

| | |
|---|---|
| **Path** | `/scout/data-products` |
| **Page title** | "Market"; tab label "Data products" (`data-products`, ar "منتجات البيانات") |
| **API** | `GET/POST /v1/scout/data-products`, `PATCH /v1/scout/data-products/:id` |
| **Generated?** | Yes, entirely |

**Who sees it.** Read: `scout:data_products:read` — `scout.admin`, `scout.lead`,
`tenant.admin`, **`provider.viewer`**. Create: `scout:data_products:create` —
`scout.admin`, `scout.lead`. Edit/publish: `scout:data_products:publish` —
**`scout.admin` only**. Note `scout.pm` has **no read** here at all: the tab is
absent from their tab strip. A `scout.lead` can create a data product and cannot
publish it.

**Purpose.** The catalogue of aggregate cuts sold or shared back to the panel, each
carrying what licenses it and the cell floor below which it is suppressed.

**Layout.**

```
Market
[…tabs…]

[ Delivery ▾ ] [Apply] [Clear]

+ New — Data products

┌───────────────────────────────────────────────────────────────────────────────────┐
│ NAME                                   CONSENT BASIS       AGG. FLOOR DELIVERY ST…│
├───────────────────────────────────────────────────────────────────────────────────┤
│ Motor demand curve by emirate and age…  consent:dataSharing        20   api  ●Publ…│
│ Motor coverage-gap map                  provider_agreement…        20   report ●Pu…│
│ Travel demand seasonality               consent:dataSharing        20   report ●Pu…│
│ Health quote-to-bind elasticity         consent:dataSharing        50   report ●Dr…│
│ Panel response-time benchmark           provider_agreement…        20   api  ●Susp…│
│ Home contents sum-insured distribution  consent:dataSharing        20   api  ●Draft│
└───────────────────────────────────────────────────────────────────────────────────┘
6 shown
```

**Table columns:**

| # | Column | Header | Type | Align | Sortable | Notes |
|---|---|---|---|---|---|---|
| 1 | `name` | Name / الاسم | text | start | no | Row link. "Motor demand curve by emirate and age band" is 44 chars, safely inside the 80-char cut |
| 2 | `consentBasis` | Consent basis / أساس الموافقة | text | start | no | Two seeded values: `consent:dataSharing` (points at GONXT's own recorded consent flags) and `provider_agreement:panel_wordings` (a cut with no customer data in it) |
| 3 | `aggregationMin` | Aggregation floor / الحد الأدنى للتجميع | number | end | no | k-anonymity floor. Module default 20; the health cut is 50 |
| 4 | `delivery` | Delivery / طريقة التسليم | text | start | no | Raw `api` / `report` — untranslated in the column, translated in the filter |
| 5 | `status` | Status / الحالة | text, **badge** | start | no | `published` / `draft` / **`suspended`** — all three neutral grey |
| 6 | `updatedAt` | Updated | datetime | start | **yes** | |

**Not shown:** `definitionJson` and `subscribersJson`. Both matter:

- `definitionJson` contains a `refresh` block: `{cadence, lastRunAt, state}` where
  `state` is `fresh` / `stale` / `never_run` / `halted`. One seeded product is
  **published and stale** — "Travel demand seasonality", last run 23 days ago on a
  weekly cadence, with `"failure": "the travel connector run has errored since the
  last successful build"`. A subscriber is reading a report three weeks behind its
  own cadence, and the catalogue screen — which the seed comment says "is meant to
  surface exactly this" — does not surface it.
- `subscribersJson` is who is receiving it, with `since` and sometimes
  `suspendedAt`.

**Filters.** One `<Select>`, `name="delivery"`: All / API / Report. **There is no
status filter**, so there is no way to list the suspended or draft products.

**Create form:**

| Field | Label | Control | Required | Notes |
|---|---|---|---|---|
| `name` | Name | `<Input type="text">` | **yes** | |
| `definitionJson` | Definition | `<Textarea rows={6}>` mono | **yes** | Hand-authored. Real shape: `{source, dimensions[], measures[], window, refresh{cadence,lastRunAt,state}, suppression}` |
| `consentBasis` | Consent basis | `<Input type="text">` | **yes** | **Free text**, though only two values are in use. The spec comment: "Selling aggregate insight without a recorded basis is the one thing this table exists to prevent." |
| `aggregationMin` | Aggregation floor | `<Input type="number" step={1}>` | **yes** | No minimum enforced in the UI; the module policy floor is 20 |
| `delivery` | Delivery | `<Select>`: API / Report | no | DB default `report` |

**Edit form** (`scout.admin` only):

| Field | Label | Control | Notes |
|---|---|---|---|
| `status` | Status | **`<Input type="text">`** | Not a select. The publish/suspend decision is typed as a string, with no option list and no validation |
| `aggregationMin` | Aggregation floor | number input | **Lowering this widens what is disclosed.** No confirmation |
| `delivery` | Delivery | `<Select>`: API / Report | |
| `subscribersJson` | Subscribers | `<Textarea rows={6}>` mono | Hand-edited JSON array |

**States.** Empty / filtered-empty as §6. Denied → boundary. Rejected write →
alert. There is no state for "stale", "halted" or "never run" — those live inside
the definition blob.

**AI surfaces.** None. Correctly so: nothing here is model-generated.

**Actions and consequences.** **This is the most consequential screen in SCOUT and
it looks like the least.** Setting `status` to `published` starts disclosing
aggregate data derived from customers' quote requests to named external
counterparties. Lowering `aggregationMin` changes the k-anonymity floor beneath
which cells are dropped. Editing `subscribersJson` adds or removes a recipient.
All three are plain form fields with a single "Save changes" button, no
confirmation, no approval gate, no diff, no audit surface. The seeded suspension
exists precisely because a cut keyed on `providerId` let a subscriber read a
competitor's latency straight off it.

**Mobile.** Web only.

**RTL.** Mirror layout. Keep `consent:dataSharing`, `provider_agreement:panel_wordings`
and the JSON blocks LTR. `aggregationMin` stays a Western-digit numeral aligned to
the inline-end edge.

**What is weak today.**
1. The refresh state — fresh / stale / never_run / halted — is invisible, including
   on a product that is published and 23 days stale with a recorded failure.
2. `published`, `draft` and `suspended` are the same grey pill.
3. No status filter, so the suspended product cannot be found by filtering.
4. `status` is edited as free text on the record screen while it renders as a badge
   in the list.
5. `consentBasis` is free text on a field whose entire purpose is to be a checkable
   basis.
6. Subscribers are invisible in the list and hand-edited JSON on the record.
7. Lowering the aggregation floor — a privacy decision — has no more friction than
   renaming the product.

---

## 8. The record route — `/scout/:resource/:id`

One file (`routes/record.tsx`) serves all six SCOUT resources. There is no
per-resource layout.

**Path.** `/scout/signals/sig_…`, `/scout/clusters/clu_…`,
`/scout/whitespaces/wsp_…`, `/scout/panel-bench/pnb_…`,
`/scout/scout-experiments/sxp_…`, `/scout/data-products/dtp_…`.

**Who sees it.** Same read permission as the parent tab. The edit form appears only
if the tab declares an `update` permission **and** the actor holds it **and** the
editable field list is non-empty. So: Signals, Clusters and Panel benchmarks are
read-only for everyone; Whitespace, Experiments and Data products show a form to
their respective holders. No SCOUT resource declares `remove`, so **the delete
button never renders anywhere in SCOUT**. No SCOUT resource declares `actions`, so
the "Actions" section never renders. No SCOUT resource declares `recordLink`, so
the secondary button under the heading never renders.

**Layout.**

```
Back to list                                        ← 12px subtle link
Motor cover that prices battery, home charger…      ← h1, display 24px = column 1's value
Whitespace · wsp_01H8…                              ← 12px subtle, id in mono

┌──────────────────────────────────────────────────────────────────────┐
│ Opportunity          Cluster              Evidence                   │  <dl>, 3 columns ≥lg
│ Motor cover that…    clu_9f2…             {"refs":["scout_cluster…   │  2 columns ≥sm
│                                                                      │  1 column below
│ Estimated demand     Competition          Status                     │
│ 3400                 38                   ●Validating                │
│                                                                      │
│ Owner                Promoted             Updated                    │
│ tariq.mansour        18 Jul 2026 09:12    21 Jul 2026 14:03          │
│                                                                      │
│ Created                                                              │
│ 2 Jun 2026 11:40                                                     │
└──────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────┐
│ Edit                                                                 │  h2, display 16px
│ ┌──────────────────────┐  ┌──────────────────────┐                   │
│ │ Status  [Validating▾]│  │ Owner  [tariq.mansour]│                  │  grid, 2 cols ≥sm
│ └──────────────────────┘  └──────────────────────┘                   │
│ ┌──────────────────────┐                                             │
│ │ Promoted [2026-07-18T09:12]                                        │
│ └──────────────────────┘                                             │
│ [ Save changes ]                                                     │
└──────────────────────────────────────────────────────────────────────┘
```

**Every element.**
- "Back to list" — `common.back`, 12px subtle, links to the parent tab.
- `<h1>` — **the value of the tab's first column**, not a title. So: a signal's
  heading is its `source` word (`"search"`); a cluster's is its theme; a
  whitespace's is its description sentence; a panel benchmark's is a raw
  `providerId`; an experiment's is a raw `wsp_…` id; a data product's is its name.
  Three of six SCOUT record screens are headed by something unreadable.
- Sub-line: `<tab label> · <id in mono>`.
- `<dl>` panel: `rounded-lg border border-border bg-surface-1 p-4`, `grid gap-x-8
  gap-y-4`, `sm:grid-cols-2 lg:grid-cols-3`. Every column in the tab's `columns`
  array gets a `<dt>` (12px subtle label) and a `<dd>` (13px value via the same
  `Cell` renderer as the table — **including the 60-character JSON truncation**).
  Then "Created" and "Updated" from `common.*` when the row has them.
- Edit form: `<h2>` "Edit", a 2-column grid of `Field`-wrapped inputs, and a
  primary "Save changes". Datetime inputs are pre-filled with
  `iso.slice(0, 16)`; JSON textareas are pre-filled with
  `JSON.stringify(value, null, 2)` — pretty-printed, 6 rows, mono 12px.

**States.**
- *Loading:* none — navigation blocks.
- *Not found / denied:* the root boundary, "This did not load" + "There is nothing
  at this address." (404) or "Your roles do not include access to this area."
  (403), plus "Reference {id}" and "Try again".
- *Rejected save:* red `role="alert"` above the definition list with the API's
  detail; the form keeps the typed values.
- *Successful save:* the loader re-runs and the values update. **There is no
  success message on a plain update** — `common.saved` is only shown for declared
  actions, and SCOUT declares none.
- *Malformed JSON in a textarea:* `JSON.parse` throws inside the action, which is
  not an `ApiError`, so it propagates to the error boundary: the actor gets the
  generic "This did not load" page and loses everything they typed.

**AI surfaces.** None on any SCOUT record. The record screen is the natural home
for the inspectable "why" the ambient grammar requires — a cluster's membership and
trail, a whitespace's method and confidence — and today it is a definition list of
truncated JSON.

**Mobile.** Only `/m/scout/<id>` exists, and only for signals. It renders **every
field the API returns**, in API order, as `key` (the raw camelCase field name, not
a translated label) over a selectable value; objects and arrays are
`JSON.stringify(value, null, 2)`. So — perversely — the mobile signal detail is the
only place in the product where a signal's full payload, including the `dismissed`
block and its reason, is actually readable. It is readable as raw JSON under a
label that says `payloadJson`.

**RTL.** The `<dl>` grid mirrors. Values that are identifiers, JSON or references
must not. The mono id in the sub-line needs `dir="ltr"`.

**What is weak today.**
1. The `<h1>` is column one's value, which for three of six SCOUT resources is an
   opaque id or a bare enum word.
2. JSON fields — Evidence, Payload, Traffic plan, Results, Definition, Subscribers
   — display truncated at 60 characters in the read panel while the *edit* textarea
   below shows the same value pretty-printed in full. The read view is strictly
   worse than the write view.
3. No history, no audit trail, no "who promoted this and when" beyond a hand-typed
   date, though the API writes before/after audit images on every update.
4. No links between records: a whitespace does not link to its cluster or its
   experiments; an experiment does not link to its whitespace; a signal does not
   link to its cluster.

---

## 9. Cross-cutting notes

### 9.1 AI surfaces — the summary

**There is no ✦ anywhere in SCOUT.** No `AgentBadge`, no `GhostText`, no
`EvidenceLink`, no `ConfidenceMeter`, no `GuardrailNotice`. Grepping the web app
for those imports returns eight files — approvals, dist-offers, ai-run,
quote-compare, conversation, ai-budget, ai-console, admin — and **not one SCOUT
screen**, because SCOUT has no screen of its own to put them on.

This matters more in SCOUT than anywhere else in the product, because SCOUT is the
only workspace whose rows are *all* inferences. Specifically:

| Where | What is model-derived | What the UI shows |
|---|---|---|
| Signals → `clusterId` | the model's cluster assignment | a raw id |
| Signals → `embeddingRef` | the vector written by the harvester | nothing |
| Clusters → `theme`, `summary` | generated prose | plain text, no marker |
| Clusters → `momentumScore` | volume × growth × novelty, 0–100 | a bare integer |
| Clusters → `trailJson` | the momentum series | nothing |
| Whitespace → `demandEstimate` | a triangulation | a bare integer |
| Whitespace → evidence `{method, confidence, note}` | the working | 60 chars of mono |

The grammar the platform requires (CLAUDE.md §11, docs/15 §4): ghost text, quiet
chips, background drafts. Never a modal. One ✦ marker per AI artifact, and a "why"
one interaction away. The components exist and are documented:

- `AgentBadge({agent, why})` — an accent `Badge` containing `✦` plus text; wrapped
  in a `Popover` labelled "Why this was drafted" when `why` is supplied.
- `EvidenceLink({children, source, sourceLabel})` — dotted accent underline on the
  claim; popover with an uppercase "Evidence" caption and the source detail. This
  is the right primitive for `demandEstimate` → `{method, confidence, note, refs}`.
- `ConfidenceMeter({value, label, floor})` — 0–1, labelled bar, tone flips at the
  floor (default 0.7); below the floor the UI is supposed to require review rather
  than offer acceptance. SCOUT's confidence is a three-value enum
  (`low`/`medium`/`high`), so it maps cleanly.

**Constraints for any AI surface added here:** no modal; no auto-send; the marker
is `✦` and only `✦`; the "why" must be inspectable, not a tooltip that vanishes;
and an estimate below high confidence must read as an argument, not a fact.

### 9.2 Vocabulary — a live rule

CLAUDE.md §14: never hard-code industry nouns. SCOUT's label table is clean — it
says "Opportunity", "Estimated demand", "Line", "Provider" rather than "product
gap", "policies", "insurer". Keep it that way. But the *data* is full of insurance
nouns (`motor`, `health`, `travel`, `agency repair`, `maternity waiting periods`)
and that is fine — those are tenant content, not chrome. The line: a word baked
into the design is a bug; a word that arrives from a row is data.

Related: the enum values `search`, `quotes`, `abandonment`, `reviews`, `news`,
`regulatory`, `motor`, `health`, `api`, `report` render **raw** in table columns
because those columns are `type: "text"`. Only `badge` columns and `select`
options run through `optionLabel`. Any redesign should route every enum through
the label table.

### 9.3 Mobile — the whole truth

`apps/mobile` maps `/scout` → `scout/signals` and nothing else. Clusters,
Whitespace, Panel benchmarks, Experiments and Data products are **web only**; they
are not merely unstyled on mobile, they have no route. A nav href with no mapping
renders "Not on mobile yet" — but `/scout` *is* mapped, so mobile users get a list
of signal ids and never learn the other five tables exist.

Mobile list copy: "Back", the workspace label "Market", "{n} shown", "There is
nothing here yet.", "Loading", "Try again", "Reference {id}". Errors:
"Your roles do not include access to this area." / "There is nothing at this
address." / "No connection to the server. Check the network and try again."

Cards are `minHeight: TOUCH_TARGET` with hairline borders and a pressed surface
change. `accessibilityRole="link"`, label = `"<title>, <subtitle>"`. The back
button aligns to `flex-end` when `dir === "rtl"`.

### 9.4 RTL — the general rule for this module

Mirror: page layout, sidebar, tab strip, filter bar order, table column order,
definition-list grid, form field order, button rows. The shell and every primitive
already use logical properties (`margin-inline-start`, `text-start`, `ps-`/`pe-`),
so this is free.

Do **not** mirror:
- Identifiers and reference strings — `clu_…`, `wsp_…`, `sig_…`,
  `search-trends:ae/ev-car-insurance`, `dist_offering:GNX-MOT-STD`,
  `x/agency-repair-renewal`, `consent:dataSharing`. Wrap in `dir="ltr"` +
  `unicode-bidi: isolate` or the punctuation lands in the wrong place.
- JSON, in read view and in textareas alike.
- Numeric magnitudes that are compared down a column (`demandEstimate`,
  `momentumScore`, price indices, win rates) — keep `tabular-nums` and one digit
  system for the whole column.
- **Any trend line, sparkline or momentum series that is ever added.** A time axis
  reads left→right in both locales; mirroring it inverts "rising" into "falling".
  This is the single most likely RTL mistake in a redesigned SCOUT, because the
  data most obviously missing from these screens is exactly the momentum trail.

Sorted-column arrow glyphs (`▲ ▼ ↕`) are direction-neutral and need no change.

---

## 10. What is weak across the whole module

In rough order of cost:

1. **No screen expresses SCOUT's actual shape.** Signals → clusters → whitespace →
   experiments is a chain, and the UI is six unrelated tables with raw foreign-key
   ids and no links between them.
2. **The most decision-relevant data is in JSON columns that render as 60
   characters of grey mono**: `evidenceRefsJson` (method, confidence, note),
   `payloadJson` (the observation, including the dismissal), `resultsJson` (the
   verdict), `trafficPlanJson` (the spend cap), `definitionJson` (the refresh
   state), `subscribersJson` (the recipients).
3. **Columns that exist in the database and on no screen:** `trailJson` and
   `firstSeen` (clusters), `coverageGapsJson` (panel bench), `embeddingRef` and
   `payloadJson` (signals — payload is on the record only, truncated).
4. **Status has no colour.** Eight of SCOUT's ten status values fall through the
   shared tone map to neutral grey. A suspended data product and a published one
   are the same pill.
5. **Zero AI markers on an all-inference workspace** (§9.1).
6. **Consequential actions have no ceremony**: publishing a data product, lowering
   a k-anonymity floor, starting a public landing page, promoting a whitespace to
   validated — each is a form field and a "Save changes" button.
7. **Every heading says "Market"**, on all six lists.
8. **No SCOUT-specific empty states.** "Nothing here yet / No records match this
   view. Clear the filters, or create the first one." is shown even on read-only
   resources nobody can create into (Clusters, Panel benchmarks).
9. **Untranslated enum values in table columns** while the filter above shows the
   translated labels.
10. **Nav gating is wrong**: the nav item requires `scout:signals:read`, so the
    roles whose only SCOUT permission is `scout:clusters:read` — every `north.*`
    role — cannot reach the one SCOUT screen they are entitled to see.
11. **Mobile shows one of six tables**, as a list of identifiers.
12. **`scout.experiment.not_yet_available`** is referenced by every seeded traffic
    plan and does not exist in either locale file.

---

## 11. Reference — files behind this brief

| Concern | File |
|---|---|
| Routes (three generic, none SCOUT-specific) | `apps/web/app/routes.ts` |
| List screen | `apps/web/app/routes/module.tsx` |
| Record screen | `apps/web/app/routes/record.tsx` |
| SCOUT tabs, columns, fields, labels (en + ar) | `apps/web/app/modules/scout.ts` |
| Spec types, `labelsFor`, `optionLabel`, `bodyFrom` | `apps/web/app/modules/spec.ts` |
| Cell + input rendering, status tone map | `apps/web/app/components/fields.tsx` |
| Shell, nav, brand tokens | `apps/web/app/components/shell.tsx` |
| Error boundary copy | `apps/web/app/root.tsx` |
| Shared copy (`common.*`, `error.*`, `nav.scout`) | `apps/web/app/i18n/en.ts`, `ar.ts` |
| Generated CRUD API + SCOUT resource registrations | `apps/api/src/crud.ts`, `apps/api/src/resources.ts` |
| Nav permissions | `apps/api/src/routes/me.ts` |
| Permissions and roles | `packages/core/src/rbac.ts` |
| Tables and column comments | `packages/db/src/schema/scout.ts` |
| Demo data (every value quoted above) | `packages/core/src/seed/scout.ts` |
| Table, EmptyState, Sparkline, Stat | `packages/ui/src/data.tsx` |
| Button, Input, Select, Textarea, Badge, Field | `packages/ui/src/primitives.tsx` |
| ✦ surfaces (all unused in SCOUT) | `packages/ui/src/ai.tsx` |
| Colour, type, spacing tokens | `packages/ui/src/tokens.css` |
| Mobile list / detail / nav mapping | `apps/mobile/app/m/[nav]/index.tsx`, `[id].tsx`, `apps/mobile/src/nav.ts`, `src/rows.ts` |
