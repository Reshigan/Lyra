# AXIS — UI design brief

*Written from the code as it stands on 2026-07-30. Every label, permission string,
column, filter option and piece of copy below was read out of the repository, not
imagined. Where a screen does not exist, this file says so instead of describing it.*

---

## Orientation (read this first)

1. AXIS is the operations workspace: the case is the unit of work, and every other
   screen either feeds a case (documents, tasks, quotes) or is what a case produced
   (policies, claims, escrow).
2. It is reached at `/axis`. The nav label an English user actually reads is
   **"Operations"** — the string `nav.axis` resolves to `"Operations"`, never to "AXIS".
3. Who lives in it all day: the **motor desk agent** (`axis.agent`, seeded as Layla
   Hassan) and the **desk lead** (`axis.lead`, seeded as Omar Farouk). Everyone else is
   a visitor.
4. The agent's day is: open a case, chase the missing document, raise the claim, close
   the task. The lead's day is: verify documents, bind policies, approve settlements.
5. The 3 screens that matter most: **Cases list** (`/axis/cases`), **Documents list**
   (`/axis/documents`), **Claims list + record** (`/axis/claims`, `/axis/claims/:id`).
6. Everything in `/axis` today is **generated CRUD**: 10 list screens and 10 record
   screens, all rendered by exactly two React files from one declarative spec.
7. There is not a single bespoke screen, chart, board, timeline or wizard in AXIS.
8. There is not a single AI surface in AXIS — no ✦ marker, no ghost text, no
   confidence meter — even though the model's output sits in the data.
9. Quote requests and the multi-underwriter comparison are **not** in AXIS. They live
   in `/distribution`. Customers and consents live in `/admin`. Both are covered at the
   end of this file, clearly marked as outside AXIS.
10. The single largest design problem: all ten AXIS screens have the same `<h1>`
    ("Operations"), the same shape, and no sense of priority, urgency or workflow.

---

## 1. How AXIS is built (the constraint every redesign works inside)

### 1.1 Two route files render twenty screens

`apps/web/app/routes.ts` gives AXIS **no bespoke routes at all**. It is served entirely
by three catch-all entries:

```
route(":module",                       "routes/module.tsx")   // /axis  -> first readable tab
route(":module/:resource",             "routes/module.tsx")   // /axis/cases
route(":module/:resource/:id",         "routes/record.tsx")   // /axis/cases/cas_...
```

The data those two files render comes from one declaration,
`apps/web/app/modules/axis.ts` (`WorkspaceSpec`). It contains:

- `path: "/axis"`
- `labels: { en: {...}, ar: {...} }` — the workspace's own vocabulary, ~70 keys per locale
- `tabs: [...]` — ten `ResourceSpec` entries

and **no `links`, no `actions`, no `recordLink`**. Those three mechanisms exist in the
spec type and are used by other workspaces (`/admin` declares links to the AI console;
`/distribution` declares a `recordLink` to the quote comparison). AXIS uses none of
them. That is why AXIS has no report links, no verb buttons and no deep screens.

Each `ResourceSpec` carries: `key`, `api`, `read`/`create`/`update`/`remove`
permissions, `columns`, optional `search`, `filters`, `fields` (create form),
`editable` (edit form), `sort`, `order`.

The API side is the mirror image: `apps/api/src/resources.ts` registers the same ten
resources against Drizzle tables with the same permission strings, plus an
`approval` config on three of them. The only hand-written AXIS endpoint in the whole
API is `POST /v1/axis/documents/:id/verify` — and **the web UI never calls it** (see
§4.3).

### 1.2 The shape every list screen has

```
+--------------------------------------------------------------------------+
|  Operations                                             (h1, 24px display)|
|  [Cases][Quotes][Documents][Tasks][Policies][Claims][Escrow][Procedures]  |
|  [Process events][Case approvals]                       (tab strip, 32px) |
+--------------------------------------------------------------------------+
|  [ Search        ] [Status v] [Priority v] [Apply]  Clear                 |
+--------------------------------------------------------------------------+
|  ! problem banner (only after a rejected write)                           |
+--------------------------------------------------------------------------+
|  > + New — Cases                          (collapsed <details>, if create)|
+--------------------------------------------------------------------------+
|  Reference | Kind | Status | Priority | Owner | ... | SLA due | Created    |
|  GNX-...   | Bind | ●Issued| ●Normal  | user:.| ... | 12 Jan  | 10 Jan     |
|  ...                                                     (compact, sticky)|
|  ---------------------------------------------------------------------- |
|  1 shown                                            [Previous] [Next]     |
+--------------------------------------------------------------------------+
```

### 1.3 The shape every record screen has

```
+--------------------------------------------------------------------------+
|  Back to list                                        (12px subtle link)   |
|  GNX-2601-0001                                       (h1, 24px display)   |
|  Cases · cas_01JW...                                 (12px, id in mono)   |
+--------------------------------------------------------------------------+
|  ! problem banner  /  ✓ status banner                                     |
+--------------------------------------------------------------------------+
|  +--------------------------------------------------------------------+  |
|  | Reference        Kind             Status                            |  |
|  | GNX-2601-0001    bind             ●Issued                           |  |
|  | Priority         Owner            Quote request                     |  |
|  | ●Normal          user:usr_...     qr_01JW...                        |  |
|  | Value            SLA due          Closed                            |  |
|  | AED 4,125.00     —                12 Jan 2026, 09:14                |  |
|  | Created          Updated                                            |  |
|  | 10 Jan 2026, 09:00   12 Jan 2026, 09:14                             |  |
|  +--------------------------------------------------------------------+  |
|      (a <dl>, 1 col mobile / 2 col sm / 3 col lg, every column + timestamps)|
+--------------------------------------------------------------------------+
|  Edit                                                                     |
|  [Status v]  [Priority v]                                                 |
|  [Owner   ]  [Team     ]                                                  |
|  [SLA due ]  [Value    ]                                                  |
|  [Risk    ]  [Details (json textarea, 6 rows, mono)                    ]  |
|  [Save changes]                                                           |
+--------------------------------------------------------------------------+
|  ------------------------------------------------------------------------|
|  [Delete]  (danger, sm — only where a remove permission exists and is held)|
+--------------------------------------------------------------------------+
```

There is **no separate edit mode**. The record page shows values in a `<dl>` and then
repeats the writable subset as a form below it. A field that is both readable and
editable therefore appears twice on the page.

---

## 2. The chrome every AXIS screen sits inside

Source: `apps/web/app/components/shell.tsx`, `apps/web/app/routes/workspace.tsx`.

```
+==========================================================================+
| [logo or product name]        Signed in as Layla Hassan  Settings  Sign out| h-14, sticky
+==========================================================================+
| Home              |                                                      |
| ● Operations      |    <main id="workspace" tabindex=-1>                 |
| ● Conversations   |      max-w-[100rem], p-4 / sm:p-6                    |
| ○ Growth          |                                                      |
| ○ Research        |                                                      |
| ○ Insight         |                                                      |
| Distribution      |                                                      |
| Ledger            |                                                      |
| Analytics         |                                                      |
| Compliance        |                                                      |
| Administration    |                                                      |
+-------------------+------------------------------------------------------+
  md:w-60, sticky top-14, h-[calc(100vh-3.5rem)], border-e
```

- **Skip link**: first focusable element, copy `"Skip to content"` (`app.skipToContent`),
  targets `#workspace`.
- **Brand**: `brand.logo.dark ?? brand.logo.light ?? brand.mark`, else the tenant's
  product name as text. Wrapped in `NavLink to="/"`. Never the literal string "LYRA".
- **Header right group** (`ms-auto`): `"Signed in as {name}"` (`header.signedInAs`,
  hidden below `sm`), `"Settings"` (`header.settings`) as a NavLink, and a
  `<Form method="post" action="/logout">` whose submit reads `"Sign out"`
  (`header.signOut`).
- **Sidebar**: nav labels are always text, never icon-only. Each module item carries a
  `size-1.5 rounded-full` dot, `aria-hidden`, coloured `var(--module-axis)` = `#ffb020`
  for `/axis`. Opacity 100 when active, 30 when idle, 60 on hover. Below `md` the
  sidebar becomes a horizontally scrollable strip above the content.
- **The `/axis` nav item only appears for an actor holding `axis:cases:read`.** This is
  the nav gate in `apps/api/src/routes/me.ts`, and it is *not* the same as the per-tab
  gate. An actor with `axis:policies:read` but no `axis:cases:read` (tenant.compliance,
  orbit.retention) can reach `/axis/policies` by typing the URL but has no link to it.
- **Page title** (`<title>`): `brand.name ?? tenantName`. Not the screen name.
- **Shell failure**: a 401 from `/v1/me` redirects to `/login?next=<path>`. Any other
  API error is thrown to the route error boundary carrying the request id.

### Design tokens available (`packages/ui/src/tokens.css`)

| Role | Dark (default) | Light |
| --- | --- | --- |
| `--bg` | `#070b14` | `#f4f7fc` |
| `--surface-1` | `#0c1322` | `#ffffff` |
| `--surface-2` | `#131c31` | `#eef2f9` |
| `--surface-3` | `#1c2842` | `#e2e8f4` |
| `--border` / `--border-strong` | `#1c2842` / `#2a3a5e` | `#d3dbe9` / `#b6c1d5` |
| `--text` / `--text-muted` / `--text-subtle` | `#f4f7fc` / `#aeb9cf` / `#5e6b87` | `#070b14` / `#47536b` / `#6a768c` |
| `--accent` / `--accent-hover` / `--accent-contrast` | `#ffb020` / `#d98e0b` / `#412402` | `#d98e0b` / `#b8760a` / `#070b14` |
| `--success` / `--danger` / `--warning` / `--info` | `#37d3b2` / `#ff5d5d` / `#ff7a45` / `#6e9bff` | `#0f7f68` / `#c02626` / `#b8410f` / `#2a55bf` |

Module identity: `--module-axis: #ffb020`. Tenants may override only `--accent`,
`--accent-hover`, `--accent-contrast`, `--font-display`, `--font-ui`. Module accents are
product identity and are **not** tenant-overridable.

Type: `--font-display` Space Grotesk, `--font-ui` Inter, `--font-mono` IBM Plex Mono,
Arabic fallback IBM Plex Sans Arabic in both display and UI stacks. Scale: 12, 13, 14
(body), 16, 18, 22, 28, 36, 48. Radii 6 / 10 / 16 / 999. Elevation is a hairline plus a
soft drop (`--shadow-glow`, `--shadow-raised`). Motion 150ms / 250ms,
`cubic-bezier(.2,.8,.2,1)`, fully disabled under `prefers-reduced-motion`.

Density: `[data-density="compact"]` drops control height 40→32px and row height
44→34px. **Every AXIS table renders `density="compact"`.**

### Primitives available (`packages/ui/src/primitives.tsx`)

`Button` (primary / **secondary = default** / ghost / danger; sm 32px, md 40px, lg 44px;
`loading` sets `aria-busy` and blocks activation), `IconButton` (label required),
`Field` (label above control, red `*` for required, hint, `role="alert"` error),
`Input`, `Textarea` (`min-h-24`), `DatePicker` (native `<input type="date">` /
`datetime-local`, optional `calendar="islamic-umalqura"`), `Select` (Radix, `▾` glyph,
placeholder defaults to `"…"`), `Checkbox`, `RadioGroup`, `Switch`, `Card`
(flat / raised / floating), `Badge`/`Tag` (neutral, accent, success, danger, warning,
info; optional leading dot; pill radius), `Avatar`, `Skeleton`, `Separator`, `Tabs`
(underline, active border `--accent`), `ProgressBar`, `Table`, `EmptyState`, `Money`,
`DateTime`, `AgentBadge`, `ConfidenceMeter`, `GuardrailNotice`.

`AgentBadge`, `ConfidenceMeter` and `GuardrailNotice` exist and are used on the
distribution comparison screen. **No AXIS screen imports any of them.**

---

## 3. Mechanics shared by all twenty AXIS screens

Rather than repeat these per screen, they are stated once. Per-screen sections below
only note deltas.

### 3.1 Cell rendering (`apps/web/app/components/fields.tsx`)

| Column `type` | Rendering |
| --- | --- |
| `text` | plain, truncated at 80 chars with `…`; if `badge: true`, a `Badge size="sm" dot` toned by value |
| `money` | `<Money amountMinor currency locale>` **only if** the spec names `currencyFrom` and the row actually has that currency; otherwise a bare `tabular-nums` integer of minor units |
| `number` | `tabular-nums` |
| `date` | `<DateTime precision="day">` |
| `datetime` | `<DateTime precision="minute">` |
| `boolean` | the words `Yes` / `No` |
| `json` | `JSON.stringify` truncated to 60 chars, `font-mono text-11 text-subtle` |
| null / undefined / `""` | an em dash `—` in `text-subtle` |

Badge tone map (the only status colouring in the product):

- **success**: active, approved, matched, verified, settled, issued, done, posted, paid, live
- **info**: running, reconciling, assessing, quoting, review, in_progress, extracting
- **neutral**: closed, intake, draft, open, and anything unlisted
- **warning**: pending, approval, awaiting_docs, blocked, variance, high
- **danger**: urgent, failed, rejected, cancelled, withdrawn, lapsed, breached, error

Note the consequences of that map in AXIS: an escrow batch in `closed` is grey while
one in `variance` is orange; a `high` priority case is orange and `urgent` is red, but
`low` and `normal` are both grey; `withdrawn` claims are red even though nothing went
wrong.

### 3.2 Label resolution

Three steps, in order: the workspace's own `labels[locale]` table → the shared
`common.*` catalogue → the raw key. Enum *values* resolve `<column>.<value>` →
`<value>` → `humanise(value)` (`awaiting_docs` → `Awaiting docs`).

**AXIS declares no value labels at all.** Its label table has `status: "Status"` but no
`status.issued`, no `intake`, no `bind`. So every status chip, every filter option and
every select option in AXIS is machine-humanised English: `Awaiting docs`, `In
progress`, `Renewal ops`, `Group medical`, `Tradelicense`, `Mulkiya`, `Eid`. In Arabic
they render as **the same humanised English**, because the fallback never reaches an
Arabic string. This is a real, visible, shipped defect on every AXIS screen.

### 3.3 States, with today's exact copy

| State | What renders |
| --- | --- |
| Loading | Nothing screen-local. React Router loads server-side; the browser shows its own navigation state. There is no skeleton and no spinner on any AXIS screen. Buttons show `aria-busy` while a form posts. |
| Empty (no filters) | `EmptyState` inside the table body — title `"Nothing here yet"`, body `"No records match this view. Clear the filters, or create the first one."` |
| Empty (filtered) | title `"Nothing here yet"`, body `"No records match these filters."` |
| Empty (deleted view) | title `"Deleted records"`, body `"Nothing has been deleted here."` |
| API rejected a write | `Problem`: `role="alert"`, `rounded-md border border-danger/40 bg-danger/10 p-3`, one line of `problem.detail ?? problem.title` |
| Permission denied — tab | The tab is **absent** from the strip. Not disabled, not greyed. Same rule for create panels, edit forms and delete buttons. |
| Permission denied — whole workspace | Route error boundary: `"This did not load"` / `"Your roles do not include access to this area."` plus `"Reference {id}"` and `"Try again"` |
| Session expired | Redirect to `/login?next=…`; the login page says `"Your session has ended. Sign in to continue."` |
| Not found | `"There is nothing at this address."` |
| Deleted view banner | `role="status"`, warning band: `"You are looking at deleted records. They stay out of the live list until you restore them."` + link `"Back to live records"` |

### 3.4 Pagination

Keyset, forward-only. Footer left: `"{count} shown"` (e.g. `6 shown`). Footer right:
`Previous` appears only when a cursor is in the URL and returns to the **first** page of
the current view (it does not step back one page); `Next` appears only when the API
returned a cursor. Both are `secondary sm` buttons. A source comment records that a
cursor stack would give true back-paging and has deliberately not been built.

### 3.5 Sorting and filtering

Sorting is server-side, triggered from the table header on columns marked `sortable`.
Changing sort writes `?sort=&order=` and **drops the cursor**. Filters submit as a GET
form; every filter is a `Select` whose first option is `"All"` (value `""`). The
`Apply` button is `secondary`; `Clear` appears as a `ghost` link only when a filter or
search term is active. Search is a single `type="search"` input, `w-64`, placeholder
and `aria-label` both `"Search"` — **only the Cases tab has it**, because `cases` is the
only AXIS resource registered `searchable` in the API (on `ref`).

### 3.6 Create and delete

Create is a `<details>` panel above the table, closed by default, re-opened
automatically when the last create failed. Summary reads `+ New — Cases` (a `+` glyph
that rotates 45° when open, then `common.new` + em dash + the tab label). The form is a
`sm:grid-cols-2` grid of `Field`s; submit is a **primary** button reading
`"Create"`. There is no cancel — closing the `<details>` is the cancel.

Delete is a soft delete. On the record page only, a `danger sm` button reading
`"Delete"` sits below a top border, and fires a native `confirm()` with the text:
`"Delete this record? It is retained for audit and can be restored by an
administrator."` Restore is available only from the list, only in the deleted view,
only to an actor holding the same `remove` permission, as a trailing `Actions` column
with a `secondary sm` `"Restore"` button.

### 3.7 Form validation (all AXIS forms)

There is no client-side validation beyond the browser's own. Required fields carry
`required` (native browser blocking) and a red `*` beside the label. Types map to
native inputs: `money`/`number` → `<input type="number" step="1">`, `date` →
`<input type="date">`, `datetime` → `<input type="datetime-local">`, `select` → Radix
Select, `json`/`textarea` → `<Textarea rows={6}>` (json also gets `font-mono text-12`),
everything else → `<input type="text">`.

Server-side rules that a designer must know:

- An **empty string means "not supplied"**, not "clear this value". There is no way to
  null a field from any AXIS form except through the JSON editor.
- A **money input takes minor units**. To set a premium of AED 4,125.00 an agent types
  `412500`. Nothing on screen says so. There is no currency symbol, no hint, no
  formatter, no thousands separator in the input.
- A **malformed JSON textarea throws**, producing the generic error boundary rather
  than a field-level message.
- A `date` field is parsed as `${value}T00:00:00Z` — UTC midnight, not local.
- `Field` supports a `hint`, and `FieldSpec` supports `hintKey`. **No AXIS field
  declares one.** Every input in AXIS is a bare label over a bare box.

### 3.8 Mobile (`apps/mobile/app/`)

Expo app, three real screens: `index.tsx` (nav list), `m/[nav]/index.tsx` (a generic
collection list), `m/[nav]/[id].tsx` (a generic record). The nav mapping is a ten-entry
table; `"/axis"` maps to exactly one resource: **`axis/cases`**.

So on mobile:

- **Cases have a screen.** List: a title from `t("nav.axis")` = "Operations", a
  `nav.back` button, `"{n} records"` (`list.count`), then a `FlatList` of pressable
  cards. Each card shows `titleOf(row)` — the first of `name, title, reference,
  subject, code, email, key, id` that the row has. `axis_cases` has **none** of those
  (its human name is `ref`, not `reference`), so **every case renders its raw id**, e.g.
  `cas_01JW3K...`, with the subtitle taken from `status`. Detail: every field of the
  record, in API order, as `key` (the raw camelCase name, untranslated) over value,
  hairline-separated, selectable text; objects rendered as pretty JSON.
- **The other nine AXIS resources have no mobile screen at all.** There is no way to
  reach quotes, documents, tasks, policies, claims, escrow, procedures, process events
  or case approvals from the phone.
- Mobile is **read-only**. No create, no edit, no delete, no filters, no search, no
  pagination, no badges, no money formatting.
- Mobile states: `t("app.loading")` as muted text, a `Notice` with the request id plus a
  `"Try again"` button on error, `t("list.empty")` when empty, `t("nav.unavailable")`
  when the workspace has no mobile screen.

Every per-screen "Mobile" note below is therefore either *"Cases only"* or
*"web only"*.

### 3.9 RTL

The UI package forbids physical-direction utilities; `packages/ui/src/ui.test.ts`
enforces it. Everything is logical (`ms-`, `me-`, `ps-`, `pe-`, `border-e`,
`text-start`, `start-`, `end-`). What that means for a redesign:

**Mirrors in `ar`:** sidebar to the right, header actions group to the left, table
column order, tab strip order, back-link chevron position, `Switch` thumb travel
(`rtl:-translate-x-4`), all paddings and margins.

**Must not mirror:** the digits inside a money value, the currency code position
(delegated to `Intl.NumberFormat` with the locale — `AED 4,125.00` in `en`, and the
Arabic locale's own arrangement in `ar`), the ISO-ish identifiers (`cas_01JW…`,
`GNX-2601-0001`, `CDR-MOT-2601-778201`) which are `font-mono` LTR runs and need
`dir="ltr"` isolation to avoid the leading `GNX` jumping to the wrong end of the
string, JSON blobs in the mono cells, `durationMs` values, and any future chart axis.

Arabic support today is partial and visibly so: the AXIS label table is fully
translated for column and tab names, but **no value labels are translated**, so an
Arabic user reads Arabic headers over English humanised statuses.

---

## 4. The ten AXIS screens

---

### 4.1 Cases

#### Route + title

| | List | Record |
| --- | --- | --- |
| Path | `/axis/cases` (also `/axis`, which resolves to the first readable tab) | `/axis/cases/:id` |
| Page `<h1>` | `"Operations"` — `t("nav.axis")` | the row's `ref`, e.g. `GNX-2601-0001` |
| Sub-line | — | `Cases · cas_01JW…` (label + mono id) |
| API | `GET /v1/axis/cases` | `GET /v1/axis/cases/:id` |
| Browser title | tenant brand name | tenant brand name |

#### Who sees it

- Read: `axis:cases:read` — held by `axis.agent`, `axis.lead`, `axis.admin`,
  `tenant.admin` (via `axis:*:read`), `orbit.agent`, `orbit.lead`, `orbit.admin`,
  `platform.admin`.
- Create: `axis:cases:create` — `axis.agent`, `axis.lead`, `axis.admin`, `orbit.agent`,
  `orbit.lead`, `platform.admin`. Without it the `+ New — Cases` panel is absent.
- Update: `axis:cases:update` — `axis.agent`, `axis.lead`, `axis.admin`,
  `platform.admin`. Without it the record page has no Edit form.
- Delete/restore: `axis:cases:delete` — **`axis.admin` and `platform.admin` only.**
  Everyone else sees no Delete button and no Live/Deleted switch.
- Denied: the tab is absent from the strip. An actor with no AXIS read at all
  (`finance.*`, `signal.*`, `scout.*`, `dev.*`, `partner.*`, `customer`) has no
  Operations item in the sidebar and gets `"Your roles do not include access to this
  area."` on the URL.

#### Purpose

Find the piece of work that is about to breach its SLA and open it.

#### Layout skeleton — list

```
Operations
[Cases*][Quotes][Documents][Tasks][Policies][Claims][Escrow][Procedures][Process events]

[ Search               ] [Status  v] [Priority v] [Live records v] [Apply]  Clear
                                                   ^ admin only

> + New — Cases

Reference     Kind  Status   Priority  Owner        Quote request  Value      SLA due  Closed        Created
GNX-2601-0001 bind  ●Issued  —         user:usr_…   qr_01JW…       AED 4,125.00  —     12 Jan 09:14  10 Jan 09:00
                                                                        ^ right-aligned
1 shown                                                                    [Next]
```

Column proportions today are pure `auto` — the table gives ten columns equal
opportunity, so `Reference` and `Status` are as wide as `Quote request` needs to be for
its 26-character opaque id.

#### Every element

| Element | Label (key) | Source | Behaviour |
| --- | --- | --- | --- |
| Tab strip | `Cases` (`cases`) | spec | `<nav aria-label="Sections">`, `aria-current="page"` on the active one. Only 8–10 tabs render, depending on permissions |
| Search box | `Search` (`common.search`) | — | GET `?q=`; the API matches on `ref` only |
| Status filter | `Status` (`status`) | spec filter | 9 options: `All`, `Intake`, `Quoting`, `Awaiting docs`, `Review`, `Approval`, `Issued`, `Failed`, `Cancelled` |
| Priority filter | `Priority` (`priority`) | spec filter | 5 options: `All`, `Low`, `Normal`, `High`, `Urgent` |
| Records-shown filter | `Records shown` (`common.deleted.state`) | — | `Live records` / `Deleted records`; only for `axis:cases:delete` holders |
| Apply | `Apply` | — | submits the GET form |
| Clear | `Clear` | — | ghost link back to `/axis/cases`; only when filtered |
| Create disclosure | `New — Cases` | — | `<details>`; opens automatically after a failed create |
| Row link | — | first column | the `ref` cell is the only clickable target in the row; whole-row click is deliberately not implemented |
| Footer count | `{n} shown` | — | client count of the current page, not a total |

#### Table columns

Default sort: **`slaDueAt` ascending** — the most-overdue work first. That is the only
AXIS list whose default sort is a deadline.

| # | Header (key) | Field | Type | Align | Sortable | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Reference (`ref`) | `ref` | text | start | yes | the link into the record; seeded value `GNX-2601-0001` |
| 2 | Kind (`kind`) | `kind` | text | start | no | raw enum, humanised: `Bind`, `Quote`, `Renewal ops`, `Group medical`, `Kyc`, `Claim`, `Endorse` |
| 3 | Status (`status`) | `status` | text | start | no | **badge**; `Issued` green, `Approval`/`Awaiting docs` orange, `Failed`/`Cancelled` red, `Quoting`/`Review` blue, `Intake` grey |
| 4 | Priority (`priority`) | `priority` | text | start | no | **badge**; `Urgent` red, `High` orange, `Normal`/`Low` grey |
| 5 | Owner (`ownerRef`) | `ownerRef` | text | start | no | a raw actor ref, `user:usr_01JW…` — **no name resolution anywhere** |
| 6 | Quote request (`quoteRequestId`) | `quoteRequestId` | text | start | no | opaque id, not a link |
| 7 | Value (`valueMinor`) | `valueMinor` | money (`currencyFrom: currency`) | **end** | no | `AED 4,125.00` on the seeded case |
| 8 | SLA due (`slaDueAt`) | `slaDueAt` | datetime | start | **yes** | rendered to the minute; **nothing marks it as breached** |
| 9 | Closed (`closedAt`) | `closedAt` | datetime | start | no | `—` while open |
| 10 | Created (`createdAt`) | `createdAt` | datetime | start | yes | |

#### Forms

**Create — 13 fields, `sm:grid-cols-2`:**

| Field | Label | Type | Required | Options / notes |
| --- | --- | --- | --- | --- |
| `ref` | Reference | text | **yes** | free text; no format enforced, no uniqueness feedback |
| `kind` | Kind | select | **yes** | Quote, Bind, Endorse, Renewal ops, Group medical, Kyc, Claim |
| `customerId` | Customer | text | no | must be pasted; **no picker, no search, no autocomplete** |
| `productLine` | Product line | text | no | free text |
| `channelId` | Channel | text | no | opaque id, typed by hand |
| `priority` | Priority | select | no | Low, Normal, High, Urgent |
| `source` | Source | select | no | Web, Orbit, Partner, Import, Api, Agent |
| `valueMinor` | Value | number | no | **minor units** |
| `currency` | Currency | text | no | free text; nothing validates it is ISO 4217 |
| `slaDueAt` | SLA due | datetime-local | no | |
| `ownerRef` | Owner | text | no | free text actor ref |
| `teamId` | Team | text | no | opaque id |
| `metaJson` | Details | json textarea | no | 6 rows, mono |

Submit: `Create` (primary). Error copy: whatever the API returns, one line, in the red
banner above the form.

**Edit — 8 fields** (`status`, `priority`, `ownerRef`, `teamId`, `slaDueAt`,
`valueMinor`, `riskScore`, `metaJson`). Submit `Save changes`. Note `riskScore` is
editable but is **not a column**, so it appears in the form pre-filled from a value the
user has never been shown.

#### States

Per §3.3. Specific to Cases: the empty body invites creation ("…or create the first
one") even for an actor who has no create permission and therefore sees no create
panel.

#### AI surfaces

**None.** `riskScore` on the case is a model-produced number; it appears only as a bare
`number` input in the edit form with the label `Risk`, no scale, no ✦, no explanation,
no source. Seed data has cases and tasks created by `agent:copilot` and `agent:renewal`,
but `createdBy` is not a column on cases, so the agent's authorship is invisible.

#### Actions and consequences

- Create and update are ordinary writes; both audit as `axis.cases.create` /
  `axis.cases.update`.
- **No approval gate on cases.** (`axis.case_issue` exists as a policy at a 50,000.00
  threshold with dual control above it, but the generated CRUD registration for `cases`
  declares no `approval` config, so nothing triggers it from this screen.)
- Delete is soft and reversible by an admin. Nothing here writes to the ledger.

#### Mobile

**Cases is the one AXIS resource on mobile.** See §3.8 — read-only, and every row
displays its raw `cas_…` id rather than `GNX-2601-0001`, because the mobile title
heuristic looks for `reference` and the column is called `ref`.

#### RTL

Standard mirroring. Keep `GNX-2601-0001` and `cas_01JW…` in LTR isolation. The `Value`
column is `numeric`, so its alignment flips to the logical end in `ar` automatically.

#### What is weak today

1. `slaDueAt` is the default sort and the whole reason this screen exists, yet an
   overdue case looks identical to one due next month. There is no red, no relative
   time ("2 days ago"), no grouping.
2. `Owner` shows `user:usr_01JWQ…`. Nobody can scan a queue by that.
3. Ten equal-weight columns, three of them opaque ids (`quoteRequestId`, and the ids
   inside `ownerRef`), one of them almost always `—` (`closedAt`).
4. `Kind` and `Status` are separate grey/coloured chips that together encode the
   workflow, but the screen never draws the workflow.
5. The `<h1>` says "Operations", not "Cases". The only thing telling you where you are
   is a 32px tab pill.
6. Creating a case means typing a customer id from memory.

---

### 4.2 Quotes

#### Route + title

List `/axis/quotes` (`<h1>` "Operations"); record `/axis/quotes/:id`, whose `<h1>` is
the first column, `caseId` — so **every quote record page is titled with an opaque case
id**. Sub-line `Quotes · qt_01JW…`. API `/v1/axis/quotes`.

#### Who sees it

- Read: `axis:quotes:read` — `axis.agent`, `axis.lead`, `axis.admin`, `tenant.admin`,
  `platform.admin`. Note `orbit.retention` holds `axis:quotes:create` and
  `axis:quotes:compare` but **not** `axis:quotes:read`, so the tab does not render for
  it at all.
- Create **and** update both gate on `axis:quotes:create` — the spec deliberately reuses
  one permission for both. Held by `axis.agent`, `axis.lead`, `axis.admin`,
  `orbit.retention`, `platform.admin`.
- No `remove`: **quotes can never be deleted from the UI.** No Delete button, no
  Live/Deleted switch.

#### Purpose

See what an underwriter actually quoted on a case, and mark which one won.

#### Layout skeleton — list

```
Operations
[Cases][Quotes*][Documents][Tasks][Policies][Claims][Escrow][Procedures][Process events]

(no filter row at all — no search, no filters, no deleted switch)

> + New — Quotes

Case          Provider      Premium       Won   Valid until   Source  Created
cas_01JW…     prv_01JW…     AED 4,125.00  Yes   24 Jan 2026   ●Api    10 Jan 09:00

1 shown
```

The absence of the filter row is structural: `search`, `filters` and `remove` are all
undeclared, so `module.tsx` renders no form element between the tabs and the table.

#### Table columns

Default sort: the API default, `createdAt` descending.

| # | Header | Field | Type | Align | Sortable |
| --- | --- | --- | --- | --- | --- |
| 1 | Case (`caseId`) | `caseId` | text | start | no |
| 2 | Provider (`providerId`) | `providerId` | text | start | no |
| 3 | Premium (`premiumMinor`) | `premiumMinor` | money (`currency`) | **end** | no |
| 4 | Won (`winFlag`) | `winFlag` | boolean | start | no — renders the words `Yes` / `No` |
| 5 | Valid until (`validUntil`) | `validUntil` | date | start | no |
| 6 | Source (`source`) | `source` | text | start | no — **badge**, seeded value `Api` (grey, unmapped) |
| 7 | Created (`createdAt`) | `createdAt` | datetime | start | **yes** |

#### Forms

**Create — 8 fields:** `caseId`* (text), `providerId`* (text), `offeringId` (text),
`premiumMinor`* (number, minor units), `currency`* (text), `validUntil` (date),
`coverageJson` (json), `declineReason` (text).

**Edit — 5 fields:** `premiumMinor` (number), `validUntil` (date), `winFlag`
(**Checkbox**, labelled `Won`), `declineReason` (text), `coverageJson` (json).

The `winFlag` checkbox is the only boolean input anywhere in AXIS. It carries its own
label and sits outside a `Field`, so it looks different from every other control on the
form.

#### States

Per §3.3. Empty body: "No records match this view. Clear the filters, or create the
first one." — there are no filters to clear on this screen.

#### AI surfaces

**None.** The quote a case actually won came out of the distribution fan-out, where the
model ranked four responses and produced `valueScore` and `rationaleKey`. None of that
survives into `axis_quotes`; the AXIS row records only premium, validity and
`winFlag: true`.

#### Actions and consequences

No approval gate. Ticking `Won` is a plain PATCH — it records a commercial outcome but
triggers nothing: no policy is created, no commission is accrued, no event is raised
from this screen. Nothing is irreversible.

#### Mobile

Web only.

#### RTL

Standard. `Yes`/`No` are translated (`common.yes` / `common.no`). Provider and case ids
need LTR isolation.

#### What is weak today

1. Every row is two opaque ids and a number. There is no way to tell Cedar from Falcon.
2. The screen is called Quotes but shows one quote per row with no notion of the panel
   they came from — the actual comparison lives in a different workspace.
3. `Won` as the word "Yes" in a text column is the weakest possible rendering of the
   single most important fact on the row.
4. `declineReason` is writable but is not a column, so a declined quote looks identical
   to a live one.
5. No filters at all — not even by case, provider or won/lost.

---

### 4.3 Documents

#### Route + title

List `/axis/documents`; record `/axis/documents/:id` titled by `caseId`. API
`/v1/axis/documents`.

#### Who sees it

- Read: `axis:documents:read` — `axis.agent`, `axis.lead`, `axis.admin`, `tenant.admin`,
  `platform.admin`.
- Create: `axis:documents:upload` — `axis.agent`, `axis.lead`, `axis.admin`.
- Update: `axis:documents:verify` — **`axis.lead`, `axis.admin`, `platform.admin` only.**
  The agent who uploads a document cannot change its status.
- No `remove`. No delete, no restore.

#### Purpose

See which document on a case the model could not read, and get a human to look at it.

#### Layout skeleton — list

```
Operations
[Cases][Quotes][Documents*][Tasks][Policies][Claims][Escrow][Procedures][Process events]

[Status v] [Apply]  Clear

> + New — Documents

Case      Document type  Status       Extraction confidence  Extraction model                     Verified by   Verified          Created        Extraction
cas_01JW… mulkiya        ●Rejected                       41  workers-ai/llama-3.2-11b-vision      —             —                 10 Jan 10:12   {"plate":null,"chassis":null,"note":"Photog…
cas_01JW… mulkiya        ●Verified                       94  workers-ai/llama-3.2-11b-vision      user:usr_…    10 Jan 11:40      10 Jan 11:02   {"plate":"Dubai J 44182","chassis":"JTDBR32E…
cas_01JW… eid            ●Verified                       97  workers-ai/llama-3.2-11b-vision      user:usr_…    10 Jan 09:58      10 Jan 09:31   {"nameEn":"Rania Haddad","eid":"784-1990-…
cas_01JW… other          ●Extracting                      —  —                                    —             —                 10 Jan 12:20   —
```

This is the widest table in AXIS: nine columns, one of which is a truncated JSON blob
and another a 31-character model name.

#### Every element

- **Status filter** — `Status`, 6 options: `All`, `Received`, `Extracting`, `Extracted`,
  `Verified`, `Rejected`.
- No search (the API does not register `documents` as searchable).
- Create panel `+ New — Documents`.

#### Table columns

| # | Header | Field | Type | Align | Sortable | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Case (`caseId`) | `caseId` | text | start | no | link into the record |
| 2 | Document type (`docType`) | `docType` | text | start | no | `Eid`, `Mulkiya`, `Census`, `Medical`, `Tradelicense`, `Other` — all humanised, none translated |
| 3 | Status (`status`) | `status` | text | start | no | **badge**: Verified green, Extracting blue, Rejected red, Received/Extracted grey |
| 4 | Extraction confidence (`extractionConfidence`) | number | number | **end** | no | 0–100 integer, or `—`. Seeded: 97, 41, 91, 94, null, null |
| 5 | Extraction model (`extractionModel`) | text | start | no | `workers-ai/llama-3.2-11b-vision` |
| 6 | Verified by (`verifiedBy`) | text | start | no | raw actor ref |
| 7 | Verified (`verifiedAt`) | datetime | start | no | |
| 8 | Created (`createdAt`) | datetime | start | **yes** | |
| 9 | Extraction (`extractionJson`) | json | start | no | mono 11px, truncated at 60 chars, placed last on purpose |

The seed deliberately distinguishes `extractionConfidence: null` (the model has not run
or produced nothing) from a low number — the source comment says zero "would read as
'the model was certain it read nothing'". The UI collapses both to `—` versus `41`, so
the distinction survives, but nothing signals that 41 is bad and 97 is fine.

#### Forms

**Create — 3 fields:** `caseId`* (text), `fileId`* (text), `docType`* (select).

There is **no file input**. Uploading a document in AXIS means going to
`/admin/files`, creating a file record, copying its id, coming back here and pasting it.

**Edit — 1 field:** `status` (select, 5 options). That is the entire edit form on a
document record.

#### States

Per §3.3.

#### AI surfaces

**This is the screen where AI is most present in the data and least present in the
design.** Every row carries a model name, a confidence and a full extraction payload.
Per docs/15 the model's work should carry a ✦ marker and an inspectable "why". Today:

- No ✦ anywhere.
- Confidence is a bare integer in a numeric column. `ConfidenceMeter` exists in the UI
  package and is used on the distribution screen; it is not used here.
- The "why" — `extractionJson`, including the seeded note *"Photograph of a screen;
  glare over the plate and chassis fields."* — is rendered as 60 truncated characters
  of monospace grey. That sentence is exactly the explanation a verifier needs, and it
  is unreadable in the list and only marginally better on the record (still a truncated
  60-char `json` cell inside a `<dd>`).
- Nothing distinguishes a value the model read from a value a human confirmed.

#### Actions and consequences

Here is the sharpest gap in AXIS:

`apps/api/src/routes/axis.ts` implements `POST /v1/axis/documents/:id/verify`, the only
bespoke AXIS endpoint. It takes no body. It stamps `verifiedBy` from the session and
`verifiedAt` from the clock, sets `status: "verified"`, 409s if the document is already
verified, and audits `axis.documents.verify`. Its header comment says plainly that a
PATCH must not be allowed to do this, because it "would let the caller name its own
verifier".

**The web UI never calls it.** `modules/axis.ts` declares no `actions`, so no Verify
button is ever rendered. Instead the edit form offers `status` as a free select
containing `verified`, and a `axis.lead` sets it there — which is the exact write the
API author designed the bespoke endpoint to prevent. A redesign must surface a
**Verify** action (and probably a **Reject** with a reason) as a first-class button on
the record, and remove `verified` from the status select.

Nothing on this screen is approval-gated or irreversible; verification does have a 409
guard against being applied twice.

#### Mobile

Web only.

#### RTL

Standard mirroring. `extractionJson` must stay LTR (it contains English keys, Latin
plate strings such as `Dubai J 44182` and chassis numbers). `extractionModel` is a
slash-separated LTR token. Confidence numbers stay LTR digits in a logical-end aligned
cell.

#### What is weak today

1. **You cannot see the document.** Nine columns about a file, and no thumbnail, no
   preview, no link to the file itself — only `fileId` on the create form.
2. Verification, the entire job of this screen, is a dropdown.
3. Confidence 41 and confidence 97 look identical.
4. The extraction — the model's actual reading of an Emirates ID or a mulkiya — is a
   truncated JSON string, so a verifier cannot compare what the model read against what
   the document says without opening a JSON blob in a monospace grey run.
5. Nine columns is too many; `extractionModel` is the same string on every row.

---

### 4.4 Tasks

#### Route + title

List `/axis/tasks`; record `/axis/tasks/:id` titled by `titleKey` — which is an i18n
key, never a sentence, so the record heading reads
**`task.chase_no_claims_certificate`** in 24px display type. API `/v1/axis/tasks`.

#### Who sees it

- Read: `axis:tasks:read` — `axis.agent`, `axis.lead`, `axis.admin`, `tenant.admin`,
  `platform.admin`.
- Create / update / **remove** all gate on the single permission `axis:tasks:write` —
  `axis.agent`, `axis.lead`, `axis.admin`. This is the one AXIS tab where a plain agent
  can delete and restore rows.

#### Purpose

Know what the desk owes and what is stuck.

#### Layout skeleton — list

```
Operations
[Cases][Quotes][Documents][Tasks*][Policies][Claims][Escrow][Procedures][Process events]

[State v] [Live records v] [Apply]  Clear

> + New — Tasks

Title                                Type       Case       Assignee     State          Due
task.verify_vehicle_registration     document   cas_01JW…  agent:copilot ●Done         09 Jan 18:00
task.chase_no_claims_certificate     chase      cas_01JW…  user:usr_…   ●In progress   11 Jan 12:00
task.resolve_escrow_variance         escrow     —          user:usr_…   ●Open          28 Jul 09:00   <- 2 days overdue, unmarked
task.assess_collision_claim          claim      cas_01JW…  user:usr_…   ●Blocked       —
task.collect_claim_evidence          claim      cas_01JW…  user:usr_…   ●Cancelled     —
```

#### Every element

- **State filter** — `State`, 6 options: `All`, `Open`, `In progress`, `Blocked`,
  `Done`, `Cancelled`.
- **Records shown** — Live/Deleted, since `remove` is held by everyone who can read and
  write tasks.
- Create panel `+ New — Tasks`.

#### Table columns

Default sort: API default (`createdAt` desc). `dueAt` is sortable but not the default —
an odd choice on a task list.

| # | Header | Field | Type | Align | Sortable |
| --- | --- | --- | --- | --- | --- |
| 1 | Title (`titleKey`) | `titleKey` | text | start | no |
| 2 | Type (`type`) | `type` | text | start | no |
| 3 | Case (`caseId`) | `caseId` | text | start | no |
| 4 | Assignee (`assigneeRef`) | `assigneeRef` | text | start | no |
| 5 | State (`state`) | `state` | text | start | no — **badge**: Done green, In progress blue, Blocked orange, Open grey, Cancelled red |
| 6 | Due (`dueAt`) | `dueAt` | datetime | start | **yes** |

#### Forms

**Create — 6 fields:** `titleKey`* (text), `type`* (text), `caseId` (text),
`assigneeRef` (text), `dueAt` (datetime-local), `checklistJson` (json).

**Edit — 4 fields:** `state` (select), `assigneeRef` (text), `dueAt` (datetime-local),
`checklistJson` (json).

`checklistJson` is a real checklist in the data — the seeded
`task.verify_vehicle_registration` carries three items — and it is edited as raw JSON in
a 6-row monospace textarea. There is no checkbox list anywhere.

#### States

Per §3.3. Deleted view available to all task writers.

#### AI surfaces

**None rendered**, though two seeded tasks were created by agents: `agent:copilot`
created `task.verify_vehicle_registration` and `agent:renewal` created
`task.prepare_renewal_terms`. `createdBy` is an actor column on the API side but is not
a spec column, so an agent-authored task is indistinguishable from a human one. This is
precisely the case docs/15 calls a background draft, and it carries no ✦ and no "why".

#### Actions and consequences

No approval gate. Delete is soft and restorable. Setting `state` to `done` does nothing
beyond writing the column — no completion timestamp is set from the UI (`completedAt`
has a label in the table but is neither a column nor an editable field).

#### Mobile

Web only.

#### RTL

Standard. `titleKey` is a Latin snake_case token and needs LTR isolation; it will look
wrong flush against Arabic column headers.

#### What is weak today

1. Titles are i18n keys. `task.chase_no_claims_certificate` is shown to a human, as the
   page heading on the record.
2. An overdue task (the seeded `task.resolve_escrow_variance`, due two days ago) is
   visually identical to one due next week.
3. Checklists are JSON.
4. The list is sorted by creation, not by what is due.
5. No grouping by assignee, no "mine", no counts by state.

---

### 4.5 Policies

#### Route + title

List `/axis/policies`; record `/axis/policies/:id` titled by `policyNo` — the one AXIS
record page with a genuinely human heading, e.g. **`CDR-MOT-2601-778201`**. API
`/v1/axis/policies`.

#### Who sees it

- Read: `axis:policies:read` — the widest read in AXIS: `axis.agent`, `axis.lead`,
  `axis.admin`, `tenant.admin`, `tenant.compliance`, `orbit.agent`, `orbit.lead`,
  `orbit.retention`, `orbit.admin`, `platform.admin`.
- Create: `axis:policies:create` — `axis.lead`, `axis.admin`, `platform.admin`. **An
  agent cannot bind.**
- Update: `axis:policies:update` — `axis.lead`, `axis.admin`, `platform.admin`.
- No `remove`. A policy can never be deleted.
- Special case: `tenant.compliance` holds `axis:policies:read` and nothing else in
  AXIS, so its Operations workspace would contain exactly one tab — except that the nav
  item is gated on `axis:cases:read`, which it lacks, so **there is no link to it at
  all**. Same for `orbit.retention`. Reaching `/axis` in that state redirects to the
  first readable tab; reaching `/axis/policies` directly works and renders a single-tab
  workspace where the tab strip does not render (it only renders when `tabs.length > 1`).

#### Purpose

Find the policy behind a customer's question, and see when it ends.

#### Layout skeleton — list

```
Operations
[Cases][Quotes][Documents][Tasks][Policies*][Claims][Escrow][Procedures][Process events]

[Status v] [Apply]  Clear

> + New — Policies                        (lead/admin only)

Policy number         Customer    Provider   Premium       Commission  Status    Ends         Escrow batch  Documents  Payment plan
CDR-MOT-2501-664118   cus_01JW…   prv_01JW…  AED 4,125.00  AED 515.63  ●Active   19 Aug 2026  —             —          —
CDR-MOT-2601-778201   cus_01JW…   prv_01JW…  AED 4,125.00  AED 515.63  ●Active   12 Jan 2027  —             —          —

2 shown
```

#### Every element

- **Status filter** — `Status`, 5 options: `All`, `Active`, `Lapsed`, `Cancelled`,
  `Renewed`.
- Create panel `+ New — Policies` for `axis:policies:create` holders only.
- No search, no deleted view.

#### Table columns

Default sort: **`endAt` ascending** — expiry first, which is what makes this the
retention desk's screen.

| # | Header | Field | Type | Align | Sortable | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Policy number (`policyNo`) | text | start | no | the link; seeded `CDR-MOT-2601-778201`, `CDR-MOT-2501-664118` |
| 2 | Customer (`customerId`) | text | start | no | opaque id |
| 3 | Provider (`providerId`) | text | start | no | opaque id |
| 4 | Premium (`premiumMinor`) | money (`currency`) | **end** | no | AED 4,125.00 |
| 5 | Commission (`commissionMinor`) | money (`currency`) | **end** | no | 125,000 ppm of premium |
| 6 | Status (`status`) | text | start | no | **badge**: Active green, Lapsed/Cancelled red, Renewed grey (unmapped) |
| 7 | Ends (`endAt`) | date | start | **yes** | day precision |
| 8 | Escrow batch (`escrowBatchId`) | text | start | no | opaque id, usually `—` |
| 9 | Documents (`docsJson`) | json | start | no | truncated mono |
| 10 | Payment plan (`paymentPlanJson`) | json | start | no | truncated mono |

`startAt` is a required create field but is **not a column** — a policy list that shows
when cover ends and never when it started.

#### Forms

**Create — 12 fields:** `policyNo`* , `customerId`*, `providerId`*, `caseId`,
`productId`, `offeringId`, `channelId` (all text), `startAt`* (date), `endAt`* (date),
`premiumMinor`* (number, minor units), `currency`* (text), `commissionMinor` (number).

**Edit — 3 fields:** `status` (select), `endAt` (date), `commissionMinor` (number).

#### States

Per §3.3, plus one AXIS-specific state that only this screen and Claims and Escrow can
produce:

**Approval required.** Creating a policy is gated: `resources.ts` registers
`approval: { create: "axis.bind", amountField: "premiumMinor" }`. The `axis.bind` policy
is dual-control above 250,000.00 minor and `never` auto-approvable below only in the
sense that the gate always runs — a bind is a contract with a customer, so it is gated
even when small.

What the user sees today: the create panel re-opens with their input intact, and above
it a red band containing **the literal text `axis.bind`**. That is it. The API returns
`{ title: "Approval required", detail: "axis.bind", code: "approval_required",
policy_key: "axis.bind", approval_id: "apr_01JW…" }` and the generic `Problem`
component renders `detail ?? title`, so the policy key wins and the human sentence is
discarded. The approval id is in the payload and is never shown. There is no link to
`/approvals`.

Compare with the distribution comparison screen, which handles the identical error with
a `GuardrailNotice` reading *"Approval required — Policy {policy} must approve this
selection before it stands"*, the approval id, and an **Open approvals** link. AXIS has
none of that.

#### AI surfaces

None.

#### Actions and consequences

- **Create is approval-gated (`axis.bind`).** A pending approval already exists for the
  subject means the next attempt fails immediately with the same 403. Approvals expire
  after 24 hours and must then be re-requested.
- The subject reference for a create gate is `policies:new:<sha256 of the submitted
  body>`, so re-submitting the *identical* form reuses the same approval, and changing
  one character raises a new one.
- Update is not gated. Setting `status: cancelled` from the edit select cancels a
  contract with no confirmation, no reason field and no approval, even though an
  `axis.cancel` approval policy exists in `packages/core/src/approvals.ts`.
- Nothing on this screen writes journal lines directly; commission entries are produced
  in `/distribution`.

#### Mobile

Web only.

#### RTL

Standard. `CDR-MOT-2601-778201` needs LTR isolation. Money and the two date columns
must keep Western/Arabic-Indic digits per the locale's `Intl` behaviour, not be
reversed. The `DatePicker` supports `calendar="islamic-umalqura"` for Hijri display in
`ar` — **AXIS never sets it**.

#### What is weak today

1. Binding a policy is the most consequential act in the module, and it is a 12-field
   grid inside a collapsed `<details>` labelled `+ New — Policies`.
2. The approval refusal shows the string `axis.bind` and nothing else.
3. Renewal is the reason `endAt` sorts ascending, but no row says "expires in 20 days".
   The seeded `CDR-MOT-2501-664118` ends inside the renewal window and looks like any
   other active policy.
4. Customer and provider are opaque ids on a screen whose whole purpose is answering a
   named customer's question.
5. Two JSON columns (`docsJson`, `paymentPlanJson`) occupy real estate and are
   unreadable.

---

### 4.6 Claims

#### Route + title

List `/axis/claims`; record `/axis/claims/:id` titled by `claimNo`, e.g.
**`GNX-CLM-2601-0042`**. API `/v1/axis/claims`.

#### Who sees it

- Read: `axis:claims:read` — `axis.agent`, `axis.lead`, `axis.admin`, `tenant.admin`,
  `platform.admin`.
- Create: `axis:claims:create` — `axis.agent`, `axis.lead`, `axis.admin`.
- Update: `axis:claims:update` — `axis.agent`, `axis.lead`, `axis.admin`.
- Approve (the deciding permission on a settlement, exercised in `/approvals`, not
  here): `axis:claims:approve` — `axis.lead`, `axis.admin`.
- No `remove`.

#### Purpose

Move a claim along, and record what was settled.

#### Layout skeleton — list

```
Operations
[Cases][Quotes][Documents][Tasks][Policies][Claims*][Escrow][Procedures][Process events]

[Status v] [Apply]  Clear

> + New — Claims

Claim number         Policy      Status        Claimed        Settled        Reported
GNX-CLM-2601-0042    pol_01JW…   ●Reported     AED 1,200.00   —              29 Jul 08:10
GNX-CLM-2601-0041    pol_01JW…   ●Assessing    AED 14,500.00  —              24 Jul 17:35
GNX-CLM-2512-0038    pol_01JW…   ●Approved     AED 6,800.00   —              18 Dec 11:20
GNX-CLM-2511-0031    pol_01JW…   ●Rejected     AED 23,100.00  —              02 Nov 09:05
GNX-CLM-2509-0019    pol_01JW…   ●Settled      AED 9,400.00   AED 8,400.00   14 Sep 13:45
GNX-CLM-2506-0007    pol_01JW…   ●Withdrawn    AED 650.00     —              03 Jun 10:00

6 shown
```

Those six rows are the seeded data and are the best demonstration set in the module:
one of every status, real amounts, and a deliberately null `settledMinor` on the
**Approved** row because that settlement is still waiting on an approval.

#### Every element

- **Status filter** — `Status`, 7 options: `All`, `Reported`, `Assessing`, `Approved`,
  `Rejected`, `Settled`, `Withdrawn`.
- Create panel `+ New — Claims`.
- No search.

#### Table columns

Default sort: `reportedAt` (descending, the API default) — newest first.

| # | Header | Field | Type | Align | Sortable | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Claim number (`claimNo`) | text | start | no | the link |
| 2 | Policy (`policyId`) | text | start | no | opaque id |
| 3 | Status (`status`) | text | start | no | **badge**: Settled/Approved green, Assessing blue, Rejected/Withdrawn red, Reported grey (unmapped) |
| 4 | Claimed (`amountMinor`) | money (`currency`) | **end** | no | |
| 5 | Settled (`settledMinor`) | money (`currency`) | **end** | no | `—` until a settlement clears its approval |
| 6 | Reported (`reportedAt`) | datetime | start | **yes** | |

`incidentAt`, `assessorRef` and `fnolJson` are captured or editable but are **not
columns**. The first notice of loss — the location, the third party, the police report
number, the garage, the excess — is invisible on the list and appears on the record only
as a 60-character truncated JSON cell.

#### Forms

**Create — 9 fields:** `claimNo`* , `policyId`*, `customerId`* (all text), `caseId`
(text), `incidentAt` (datetime-local), `reportedAt`* (datetime-local), `amountMinor`
(number, minor units), `currency`* (text), `fnolJson` (json textarea).

**Edit — 3 fields:** `status` (select, 6 options), `assessorRef` (text), `settledMinor`
(number, minor units). The spec carries an inline comment: *"Settling is consequential:
the API routes this through an approval (resources.ts, axis.claim_settlement) rather
than writing it directly."*

#### States

Per §3.3, plus **approval required** — and here the gate is broader than it looks.

`resources.ts` registers `approval: { update: "axis.claim_settlement", amountField:
"settledMinor" }`. The gate in `crud.ts` runs on **every** PATCH to a claim, not only
when `settledMinor` changes. So an agent who edits nothing but `assessorRef` gets the
same refusal. The red band reads **`axis.claim_settlement`**, nothing more.

`axis.claim_settlement` is `dualControl: "always"` and `neverAutoApprove: true`: the
approver must be a different person from the requester, no tenant policy can automate
it, and the decider needs `axis:claims:approve`. Seeded state proves both halves —
`GNX-CLM-2509-0019` carries an approved approval with the reason *"Assessor's report
agrees the estimate; settled net of the AED 1,000 excess"*, and `GNX-CLM-2512-0038` has
a pending one with `contextJson` `{ amountMinor, currency: "AED", dualControl: true }`.

#### AI surfaces

None.

#### Actions and consequences

| Action | Gate | Consequence |
| --- | --- | --- |
| Create a claim | none | ordinary write, audited `axis.claims.create` |
| Any PATCH (status, assessor, settled) | **`axis.claim_settlement`, dual control always, never auto-approvable** | 403 `approval_required`; a pending approval row is created as a side effect so the queue has something to show; the write does not land until an approval exists and is under 24 hours old |
| Rejecting the claim | same PATCH gate | the seeded rejection carries a `decision.reasonKey` and a full sentence about the named-driver clause and the complaint route — **none of which any AXIS screen can capture**; the edit form has no reason field |
| Delete | not possible | no `remove` permission declared |

Nothing here writes journal lines directly; the money movement is a ledger transaction
raised elsewhere.

#### Mobile

Web only. A first notice of loss is exactly the thing that should arrive from a phone,
and cannot.

#### RTL

Standard. `GNX-CLM-2601-0042` needs LTR isolation. Two money columns side by side
(Claimed / Settled) both align to the logical end and must not swap meaning when
mirrored — the header order flips with them.

#### What is weak today

1. Every edit to a claim, however trivial, is refused with the untranslated string
   `axis.claim_settlement`.
2. There is no place to type a rejection reason, and the seed proves the business needs
   one.
3. The first notice of loss — the actual story of the claim — is a truncated JSON blob.
4. `Claimed` and `Settled` sit next to each other with no delta, no excess, no ratio.
5. The record page shows `settledMinor` twice: once as a formatted money value in the
   `<dl>` and again as a raw minor-unit integer in the edit input directly below.

---

### 4.7 Escrow (`escrow-batches`)

#### Route + title

List `/axis/escrow-batches`, tab label **"Escrow"**; record
`/axis/escrow-batches/:id` titled by `period`, e.g. **`2025-12`**. API
`/v1/axis/escrow-batches`.

#### Who sees it

- Read: `axis:escrow:read` — `axis.agent`, `axis.lead`, `axis.admin`, `tenant.admin`,
  `platform.admin`.
- Update: `axis:escrow:reconcile` — **`axis.admin` and `platform.admin` only.** Not the
  lead. So for the two people who live in AXIS all day this screen is entirely
  read-only.
- No `create` at all — batches arrive from elsewhere. The `+ New` panel never renders
  for anyone.
- No `remove`.

#### Purpose

See whether the underwriter's remittance matches what was expected, and why it does not.

#### Layout skeleton — list

```
Operations
[Cases][Quotes][Documents][Tasks][Policies][Claims][Escrow*][Procedures][Process events]

[Status v] [Apply]  Clear

(no create panel — ever)

Period    Provider    Expected       Received       Status        Closed
2026-01   prv_falcon  AED 8,920.00   —              ●Open         —
2026-01   prv_cedar   AED 12,365.00  —              ●Open         —
2025-12   prv_gulf    AED 56,400.00  AED 31,200.00  ●Reconciling  —
2025-12   prv_falcon  AED 22,480.00  AED 22,295.00  ●Variance     —
2025-12   prv_cedar   AED 41,150.00  AED 41,150.00  ●Matched      —
2025-11   prv_cedar   AED 34,825.00  AED 34,825.00  ●Closed       01 Dec 16:20

6 shown
```

#### Table columns

| # | Header | Field | Type | Align | Sortable | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | Period (`period`) | text | start | **yes** | `2025-11`, `2025-12`, `2026-01`; the link |
| 2 | Provider (`providerId`) | text | start | no | opaque id |
| 3 | Expected (`expectedMinor`) | money (`currency`) | **end** | no | |
| 4 | Received (`receivedMinor`) | money (`currency`) | **end** | no | `—` on an open batch |
| 5 | Status (`status`) | text | start | no | **badge**: Matched green, Reconciling blue, Variance orange, Open grey, **Closed grey** |
| 6 | Closed (`closedAt`) | datetime | start | no | |

There is **no variance column**. The whole point of the screen — expected minus
received — is left to the reader's arithmetic. `varianceReason` is editable but is not
a column, so the seeded explanation (*"Falcon remitted AED 185.00 short: a mid-month
cancellation was refunded to the customer from the batch but the credit note has not
come back from the underwriter yet."*) never appears in the list and appears on the
record only if you scroll to the edit form — it is not even in the `<dl>`, because the
`<dl>` renders `columns`, not `editable`.

#### Forms

**No create form.** The spec declares no `fields`, so `module.tsx` renders no create
panel regardless of permission.

**Edit — 4 fields, `axis.admin` only:** `status` (select: Open, Reconciling, Matched,
Variance, Closed), `receivedMinor` (number, minor units), `varianceReason` (text),
`evidenceFileId` (text).

#### States

Per §3.3 plus **approval required**, with the same broad gate as Claims:
`approval: { update: "axis.escrow_release", amountField: "receivedMinor" }` fires on
**every** PATCH. `axis.escrow_release` is `dualControl: "always"`,
`neverAutoApprove: true`, decided by `axis:escrow:approve`. The red band reads
`axis.escrow_release`.

The seed models the states precisely: `2025-11 Cedar` is `closed` with its approval
recorded (reason *"Bank statement matches the batch to the fils; released to Cedar."*),
and `2025-12 Cedar` is `matched` with a release approval **still pending** — the money
is reconciled but has not moved. Nothing in the UI distinguishes "matched, awaiting
release approval" from "matched" — you would have to go to `/admin/approvals` to find
out.

#### AI surfaces

None.

#### Actions and consequences

- Every write is dual-control gated and never auto-approvable. This is client money.
- The one open task in the seed, `task.resolve_escrow_variance`, is two days overdue and
  points at the Falcon variance — but nothing links the task to the batch.
- Closing a batch is irreversible in practice (no un-close verb) though technically just
  another gated PATCH.

#### Mobile

Web only.

#### RTL

Standard. Period strings (`2025-12`) are LTR. Expected/Received are adjacent money
columns; both align to the logical end.

#### What is weak today

1. No variance figure, no variance reason, on a screen whose only job is variance.
2. The two people who use AXIS daily cannot edit anything here; the screen is a
   read-only wall for `axis.agent` and `axis.lead` alike.
3. `Closed` is grey and `Matched` is green, so the finished batch looks less resolved
   than the unfinished one.
4. A batch that is reconciled but whose release is still pending approval looks
   identical to one that is done.
5. No evidence: `evidenceFileId` is a text box for an opaque id, with no upload and no
   preview, on the screen that most needs a bank statement attached.

---

### 4.8 Procedures (`sops`)

#### Route + title

List `/axis/sops`, tab label **"Procedures"**; record `/axis/sops/:id` titled by `key`,
e.g. **`motor.bind`**. API `/v1/axis/sops`.

#### Who sees it

- Read: `axis:sops:read` — `axis.agent`, `axis.lead`, `axis.admin`, `tenant.admin`,
  `platform.admin`.
- Create / update / **remove**: `axis:sops:write` — `axis.lead`, `axis.admin`. An agent
  reads procedures and cannot change them, and sees no Live/Deleted switch.

#### Purpose

Check the current version of how a thing is done.

#### Layout skeleton — list

```
Operations
[Cases][Quotes][Documents][Tasks][Policies][Claims][Escrow][Procedures*][Process events]

[Status v] [Live records v] [Apply]  Clear
                ^ lead/admin only

> + New — Procedures                       (lead/admin only)

Key                    Version  Applies to  Status     Created
motor.bind                   2  motor       ●Active    05 Jan 09:00
motor.bind                   1  motor       ●Retired   01 Jun 09:00
motor.claim.fnol             1  motor       ●Active    01 Jun 09:00
kyc.individual               1  —           ●Active    01 Jun 09:00
renewal.outbound             1  motor       ●Draft     20 Jan 09:00
group.medical.census         1  health      ●Draft     20 Jan 09:00

6 shown
```

#### Table columns

| # | Header | Field | Type | Align | Sortable |
| --- | --- | --- | --- | --- | --- |
| 1 | Key (`key`) | text | start | no |
| 2 | Version (`version`) | number | **end** | no |
| 3 | Applies to (`appliesTo`) | text | start | no |
| 4 | Status (`status`) | text | start | no — **badge**: Active green, Draft grey, Retired grey (unmapped) |
| 5 | Created (`createdAt`) | datetime | start | **yes** |

`nameJson` and `stepsJson` are **not columns**. The name of the procedure and its steps
— the entire content — never appear on the list.

#### Forms

**Create — 5 fields:** `key`* (text), `version`* (number), `nameJson`* (json),
`stepsJson`* (json), `appliesTo` (text).

**Edit — 2 fields:** `status` (select: Draft, Active, Retired), `stepsJson` (json).

Steps in the data are structured and bilingual:
`{ key, en, ar, role, slaHours }` per step. The seeded `motor.bind` v2 has five steps
and adds `confirm_value` and `deliver_documents` over v1's three. All of that is authored
and read as raw JSON in a 6-row monospace textarea.

#### States

Per §3.3. Deleted view for `axis:sops:write` holders.

#### AI surfaces

None.

#### Actions and consequences

No approval gate. Promoting a draft to `active` is a plain select change; nothing
retires the previous version automatically, which is why `motor.bind` v1 and v2 both
exist as rows and only a human set v1 to `retired`.

#### Mobile

Web only.

#### RTL

Standard. `stepsJson` contains both `en` and `ar` strings and must render LTR as a
whole (it is a JSON document), even though the Arabic values inside it are RTL runs.
`Version` is numeric and aligns to the logical end.

#### What is weak today

1. A procedure's *content* — its name and its steps — is invisible until you open a
   JSON textarea.
2. Two versions of `motor.bind` sit adjacent with no visual grouping and no "current"
   marker beyond a grey/green chip.
3. `Retired` and `Draft` are both grey, so a retired procedure looks like a new one.
4. Steps carry `role` and `slaHours` — a real workflow definition — with no rendering.
5. Nothing links a procedure to the cases running under it.

---

### 4.9 Process events

#### Route + title

List `/axis/process-events`; record `/axis/process-events/:id` titled by `caseId`. API
`/v1/axis/process-events`.

#### Who sees it

- Read: `axis:metrics:read` — `axis.agent`, `axis.lead`, `axis.admin`, `tenant.admin`,
  **`north.exec`**, **`north.analyst`**, `platform.admin`.
- No create, no update, no remove. The resource is registered `immutable: true` in the
  API. The record page shows the `<dl>` and nothing else — no Edit form, no Delete
  button, no Actions section.
- `north.exec` and `north.analyst` hold `axis:metrics:read` and nothing else in AXIS, so
  this would be their only AXIS tab — but they lack `axis:cases:read`, so they get no
  Operations nav item and would have to know the URL.

#### Purpose

See what actually happened on a case, step by step, and how long each step took.

#### Layout skeleton — list

```
Operations
[Cases][Quotes][Documents][Tasks][Policies][Claims][Escrow][Procedures][Process events*]

(no filter row at all)

Case       Step                  Actor              Duration  Outcome  When
cas_01JW…  documents_delivered   agent:copilot           820  ok       12 Jan 09:20
cas_01JW…  policy_issued         system:cedar_api       1 240  ok      12 Jan 09:14
cas_01JW…  provider_bind_call    system:cedar_api       4 200  ok      12 Jan 09:12
cas_01JW…  provider_bind_call    system:cedar_api      30 000  timeout 12 Jan 09:11
cas_01JW…  underwriting_check    user:usr_…         1 560 000  ok      11 Jan 14:30
cas_01JW…  document_extracted    agent:copilot          3 400  retry   10 Jan 10:12
...
```

#### Table columns

Default sort: `ts` (descending, API default).

| # | Header | Field | Type | Align | Sortable |
| --- | --- | --- | --- | --- | --- |
| 1 | Case (`caseId`) | text | start | no |
| 2 | Step (`step`) | text | start | no |
| 3 | Actor (`actorRef`) | text | start | no |
| 4 | Duration (`durationMs`) | number | **end** | no |
| 5 | Outcome (`outcome`) | text | start | no — **plain text, not a badge** |
| 6 | When (`ts`) | datetime | start | **yes** |

`Duration` is raw milliseconds. The seeded values span `820` to `1_560_000` (26
minutes) in the same column, unformatted. `Outcome` carries `ok`, `retry` and `timeout`
and is not badged, so a timeout is the same grey as a success.

#### Forms

None. No create, no edit, no delete anywhere on this resource.

#### States

Per §3.3. Empty body still says "…or create the first one", which is impossible here.

#### AI surfaces

**None rendered, but this is the richest AI provenance in the module.** Twelve seeded
events include `agent:copilot` and `agent:quoting` as actors, a `document_extracted`
step that returned `retry` before succeeding, and a `provider_bind_call` that timed out
at 30 seconds before a 4.2-second success. That is a complete, inspectable account of
what the model and the integrations did — the "why" docs/15 asks for — presented as six
undifferentiated text columns.

#### Actions and consequences

Read-only, immutable, append-only. Nothing here can be changed by anyone including an
admin.

#### Mobile

Web only.

#### RTL

Standard. `step` and `actorRef` are Latin snake_case/colon tokens needing LTR
isolation. `durationMs` is numeric, logical-end aligned. This is the screen most likely
to want a horizontal timeline, which must mirror in `ar` — but the numbers inside it
must not.

#### What is weak today

1. It is an event *log* rendered as a flat table when the data is a per-case timeline.
2. `1560000` for 26 minutes.
3. A `timeout` and an `ok` look the same.
4. No filter by case, step or outcome — none are declared, so there is no filter row.
5. There is no way to reach this from the case it describes, and no way to reach the
   case from a row.

---

### 4.10 Case approvals

#### Route + title

List `/axis/case-approvals`; record `/axis/case-approvals/:id` titled by `caseId`. API
`/v1/axis/case-approvals`.

#### Who sees it

- Read: **`axis:cases:approve`** — `axis.lead`, `axis.admin`, `platform.admin` only.
  This is the only AXIS tab a `tenant.admin` cannot see (its blanket `axis:*:read` does
  not match a `:approve` permission), and the only one an `axis.agent` cannot see.
- No create, update or remove.

#### Purpose

See what was approved on cases and by what policy.

#### Layout skeleton — list

```
Operations
[Cases][Quotes][Documents][Tasks][Policies][Claims][Escrow][Procedures][Process events][Case approvals*]

(no filter row)

Case        Policy               Subject                       Decision    When
cas_01JW…   axis.escrow_release  escrow-batches:esc_01JW…      ●Approved   01 Dec 16:20
cas_01JW…   axis.claim_settle…   claims:clm_01JW…              ●Approved   20 Sep 10:15
cas_01JW…   axis.escrow_release  escrow-batches:esc_01JW…      ●Pending    05 Jan 09:00
cas_01JW…   axis.claim_settle…   claims:clm_01JW…              ●Pending    19 Dec 12:00
```

#### Table columns

| # | Header | Field | Type | Align | Sortable |
| --- | --- | --- | --- | --- | --- |
| 1 | Case (`caseId`) | text | start | no |
| 2 | Policy (`policyKey`) | text | start | no |
| 3 | Subject (`subjectRef`) | text | start | no |
| 4 | Decision (`decision`) | text | start | no — **badge**: Approved green, Pending orange, Rejected red |
| 5 | When (`ts`) | datetime | start | **yes** |

`Policy` here means *approval policy key* (`axis.bind`, `axis.claim_settlement`,
`axis.escrow_release`), not an insurance policy. The label table maps `policyKey:
"Policy"` and `policyId: "Policy"` — two different things with the same English word in
the same workspace.

`subjectRef` is `<resource path>:<row id>`, e.g. `escrow-batches:esc_01JW…`. It is the
only pointer back to what the approval is about, and it is not a link.

#### Forms

None.

#### States

Per §3.3.

#### AI surfaces

None.

#### Actions and consequences

**Read-only. You cannot decide an approval here.** The decision endpoint requires
`core:approvals:decide` (held by `axis.lead`, `axis.admin`) and the deciding permission
named on each policy (`axis:claims:approve`, `axis:escrow:approve`,
`axis:policies:create`). The dedicated screen for it is `/approvals`
(`apps/web/app/routes/approvals.tsx`), which AXIS does not link to from anywhere — AXIS
declares no `links`.

Rules a designer must respect if a decide affordance is ever added here:

- **Dual control**: for `axis.claim_settlement` and `axis.escrow_release` the decider
  must be a different actor from the requester. The API returns `400 "dual control: the
  approver must differ from the initiator"`.
- **A rejection needs a reason**: `400 "a rejection needs a reason"` if omitted.
- Approvals expire 24 hours after decision; after that the gate asks again.
- A second decision on a decided approval returns `409 already approved` / `409 already
  rejected`.

#### Mobile

Web only.

#### RTL

Standard. `subjectRef` and `policyKey` are LTR tokens.

#### What is weak today

1. A queue of pending approvals that cannot be acted on.
2. No link from a pending approval to the claim or batch it blocks, despite
   `subjectRef` containing exactly that address.
3. No amount, no requester, no reason — all of which exist in the approval row's
   `contextJson`, `requestedBy` and `reason` and are simply not columns here.
4. `Policy` is ambiguous against the Policies tab.
5. No filter by decision, so a lead scrolls a mixed list of decided and pending items.

---

## 5. Adjacent screens that people think are AXIS (and are not)

The brief for this module names "quote requests, comparative quotes from multiple
underwriters, customers, consents". None of those are in `/axis`. They are described
here so a redesign does not duplicate them, and so the seams between them are visible.

### 5.1 Quote requests and the comparison — `/distribution`

- **List** `/distribution/quote-requests`, `<h1>` `"Distribution"` (`nav.distribution`).
  Read `dist:quote_requests:read`, create `dist:quote_requests:create`. `axis.agent`
  and `axis.lead` both hold read and create.
- The record page carries the one `recordLink` in this area: a `secondary sm` button
  reading **"Compare"** that goes to `/distribution/quote-requests/:id/compare`.
- **`/distribution/quote-requests/:id/compare`** (`apps/web/app/routes/quote-compare.tsx`)
  is the only bespoke screen in the sales path and the only well-designed one. It is a
  **transposed** table: attributes are rows, underwriter quotes are columns,
  `min-w-[44rem]`, wrapped in a `role="region" tabIndex={0}` scroller with an
  `aria-label` so the horizontal scroll is keyboard-reachable. Per-column badges:
  state, `rationaleKey` (success), `bestValue` (info), `selected` (accent), expired
  (danger). Any attribute row whose columns disagree gets a **"Differs"** warning badge.
  A footer `Select` button per column, disabled when already selected, expired, or the
  request is `converted`.
- Its consequence copy, verbatim: *"Selecting records the customer's choice, writes it
  to the audit trail and closes this comparison as converted. Tenant policy may require
  an approval before it stands."*
- Its approval refusal is a `GuardrailNotice`: *"Approval required"* / *"Policy {policy}
  must approve this selection before it stands."* / *"Approval {id}"* / **Open
  approvals** → `/approvals`. **This is the pattern AXIS should adopt and does not.**
- Header actions: **"Share with customer"** (`dist:quote_requests:share`) and
  **"Re-shop the panel"** (`dist:quote_requests:create`).
- Offer cards on the same screen use `AgentBadge` (the ✦ plus a "why" panel listing
  `reasonJson` entries) and `ConfidenceMeter` at `score/100`, with Accept/Dismiss and
  the note *"Accepting records interest only — nothing is bought and no shop starts."*
  This is the reference implementation of the ambient AI grammar in this codebase.
- Seeded data: request `qr_…` fanned out to 4 underwriters, all 4 responded, best
  premium `AED 4,125.00` from Cedar; the four rows are Cedar 4,125.00 (`rationale.cheapest`,
  value 78), Falcon 4,480.00 (`rationale.best_value`, value 86), Cedar Plus 5,210.00
  (`rationale.widest_cover`, value 91), Gonxt own-paper 4,650.00 (value 74). Vehicle:
  2023 Toyota Land Cruiser, declared value AED 280,000.00, Dubai, driver 34, 9 years
  licensed, no claims in 3 years.
- Mobile: `/distribution` maps to `dist/quote-requests`, so quote requests **do** have a
  read-only mobile list and detail. The comparison does not.

### 5.2 Customers — `/admin/customers`

CORE resource, surfaced in the **Administration** workspace, not AXIS.
Read `core:customers:read` (held by `axis.agent` and `axis.lead`), but the `/admin` nav
item is gated on `core:users:read`, which neither holds — so an AXIS user has the
permission and no link.

Columns: `nameJson` (json) · `type` (Individual/Business) · `kycStatus` (badge:
None/Pending/Verified/Failed) · `tagsJson` · `riskFlagsJson` · `consentId` · `ltvCached`
(number) · `locale` · `updatedAt` · `createdAt`. Searchable. Create fields:
`nameJson`*, `type`, `emailsJson`, `phonesJson`, `locale`, `tagsJson`; edit adds
`kycStatus`.

A deliberate design decision worth preserving: emails and phones are **on the form,
never in columns**. The source comment reads *"Administration needs to find a customer
and see its state, not read its personal detail off a list (docs/12) — emails and
phones are on the form, where one record is open and the actor is accountable."*
Unmasking PII additionally requires `core:pii:view`, which `axis.lead` holds and
`axis.agent` does not.

### 5.3 Consents — `/admin/consents`

CORE resource, registered `immutable: true`. Read `core:consents:read`, create
`core:consents:create` (both held by `axis.agent`). **No update, no delete, ever** —
the source comment: *"Consent is evidence. It can be granted and withdrawn, never
edited."* A withdrawal is a new row that supersedes the previous one.

Columns: `customerId` · `source` (badge: Web/Whatsapp/Import/Agent/Portal) ·
`purposesJson` · `channelOptinsJson` · `evidenceRef` · `version` (number) · `expiry` ·
`ts` (sortable, default). Create fields: `customerId`*, `source`*, `purposesJson`*,
`channelOptinsJson`*, `ts`*, `evidenceRef`, `expiry`.

### 5.4 Approvals — `/approvals`

Its own top-level route, outside every workspace. This is where a gated AXIS write is
actually resolved, and no AXIS screen links to it.

---

## 6. Cross-cutting design problems, ranked

1. **Every AXIS screen is titled "Operations".** Ten lists and ten records share one
   `<h1>`; only a 32px tab pill distinguishes them. The record pages are titled by
   their first column, which for six of the ten resources is an opaque id
   (`caseId`, `policyId`) or a snake_case i18n key (`titleKey`).
2. **No value labels.** AXIS translates its column headers into Arabic and translates
   none of its enum values, so every status chip, filter option and select option in
   both locales is machine-humanised English.
3. **Approval refusals show a policy key.** `axis.bind`, `axis.claim_settlement`,
   `axis.escrow_release` are shown raw in a red band, with no sentence, no amount, no
   approval id and no route to the approvals queue — while a sibling screen in
   `/distribution` handles the identical error correctly with `GuardrailNotice`.
4. **Zero AI surfaces in a module full of AI output.** Extraction confidence, extraction
   model, extraction payload, risk score, agent-authored tasks, agent-actored process
   events — none carries a ✦, a confidence meter, or an inspectable "why". `AgentBadge`
   and `ConfidenceMeter` are already built and already used elsewhere.
5. **Every relationship is an opaque id typed by hand.** `customerId`, `providerId`,
   `caseId`, `policyId`, `fileId`, `channelId`, `escrowBatchId`, `ownerRef`,
   `assigneeRef`. No picker, no autocomplete, no resolved name, and no id is a link.
6. **Money is entered in minor units with no affordance.** A premium of AED 4,125.00 is
   typed as `412500` into a bare number input with no symbol, no hint and no formatter.
7. **Structured data is edited as raw JSON.** Checklists, coverage, first notice of loss,
   procedure steps, payment plans — all 6-row monospace textareas that throw an
   unhandled error on a syntax mistake.
8. **Time is inert.** SLA due dates, overdue tasks, expiring policies and 26-minute
   process steps are all rendered as plain absolute timestamps or raw milliseconds, with
   no urgency, no relative time and no colour.
9. **The document verify verb exists in the API and not in the UI**, so verification is
   performed through a status dropdown the API author explicitly designed against.
10. **No screen references another.** No case links to its documents, no approval links
    to its claim, no process event links to its case, no policy links to its escrow
    batch — even where the foreign key is sitting in a visible column.
11. **Mobile covers one of ten resources**, read-only, showing raw ids as titles and raw
    camelCase field names as labels.
12. **No loading state exists.** No skeleton, no spinner, no optimistic row — the only
    feedback during a write is `aria-busy` on the button that was pressed.
