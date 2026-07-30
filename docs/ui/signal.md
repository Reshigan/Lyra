# SIGNAL — UI design brief

Screen-by-screen description of what is **actually built today** in the SIGNAL
workspace of LYRA. Nothing here is aspirational. Every label, permission string,
column, error message and seeded value below was read out of the repository. If
a screen is thin, this document says so and says exactly why.

---

## 1. Orientation (read this first)

1. SIGNAL is the marketing and growth workspace. In the sidebar it is called
   **"Marketing"** (`nav.signal`), never "SIGNAL" — the module codename appears
   nowhere in the UI.
2. It holds eight things: **Audiences, Campaigns, Creatives, Experiments,
   Budget moves, Answer pages, Attribution, Spend.**
3. The people who live here: a **growth marketer** (`signal.marketer`) who
   builds audiences, campaigns, creatives and experiments; a **growth lead**
   (`signal.lead`) who additionally launches campaigns, publishes creatives,
   decides experiments and approves/reverses budget moves.
4. Two visitors: a **compliance officer** (`tenant.compliance`) who can only
   read and rule on creatives, and **executives/analysts** (`north.exec`,
   `north.analyst`) who can only read attribution and spend.
5. The unit of work is the **campaign**: an audience is who it reaches,
   creatives are what it says, experiments are what it has not decided yet.
6. **Budget moves, attribution and spend are a ledger, not a workspace** — the
   budget autopilot and the ad platforms write them; a human only reverses a
   budget move inside a 7-day window.
7. Money in SIGNAL is real money. A budget move above the tenant threshold
   (AED 50,000.00) needs a human approval before it takes effect.
8. The three screens that matter most: **Campaigns list** (`/signal/campaigns`),
   **Creative record** (`/signal/creatives/:id` — the compliance verdict), and
   **Budget moves list** (`/signal/budget-moves` — where money already moved).
9. Everything else supports those three. Attribution and Spend are evidence;
   Answer pages are an owned-content surface; Audiences are inputs.
10. There is **no bespoke code in SIGNAL at all.** Every screen below is
    generated. See §3.

---

## 2. Two hard constraints the design must respect

State both of these to anyone redesigning this module. They are product rules,
not preferences, and no amount of user demand changes them.

> **Hard product refusals, not settings: no fake engagement, no bulk unsolicited
> DMs, no multi-account manipulation. There is no UI for these and there must
> never be.**

Concretely, this means the redesign must not introduce: an engagement/likes/
followers panel, a "warm up accounts" flow, a bulk direct-message composer, a
list of connected personal accounts to rotate between, a follower-growth chart
that implies purchased reach, or any "boost engagement" affordance. These are
not toggles to be defaulted off. They must not exist as pixels. If a designer
asks "where does the DM blast live?", the answer is that it does not and will
not. The channels that exist in the seeded data are `google_search`,
`bing_search`, `meta`, `email` — paid platform channels and consented email,
nothing else.

> **No synthetic likeness of a real person without a stored consent record. The
> seeded video creative records `likeness: none — illustrated brand character`;
> show where a consent record would surface in the UI.**

Today that likeness declaration exists as a key inside `complianceNotesJson` on
one seeded creative:

```json
{
  "likeness": "none — illustrated brand character, no real person depicted or voiced",
  "submittedBy": "…",
  "submittedAt": 0
}
```

and the UI renders it as a 60-character-truncated monospace JSON blob in a
read-only `<dd>` on the creative record page. That is the current state and it
is inadequate. The consent store it *should* point at already exists: the
Administration workspace's **Consents** tab (`GET /v1/core/consents`, permission
`core:consents:read`, immutable, columns `customerId`, `source`, `purposesJson`,
`channelOptinsJson`, `evidenceRef`, `version`, `expiry`, `ts`). `signal.lead`
and `signal.marketer` both hold `core:consents:read` — but the Administration
nav entry is gated on `core:users:read`, which they do not hold, so they cannot
reach it. A redesign must surface, on any creative whose `kind` is
`video_script` or `social`, an explicit likeness row with one of exactly two
states — *no real person depicted* or *consent record `<evidenceRef>`, expires
`<date>`* — linking to the consent record. A creative that depicts a real person
with no linked consent record must not be publishable.

---

## 3. How every SIGNAL screen is built (say this plainly)

**SIGNAL has zero bespoke route files.** There is no campaign builder, no
creative previewer, no channel picker, no landing-page editor, no budget chart,
no attribution funnel diagram. Every one of the 17 SIGNAL screens is rendered by
exactly two generic files:

- `apps/web/app/routes/module.tsx` — every list screen
- `apps/web/app/routes/record.tsx` — every record screen

driven by one data file, `apps/web/app/modules/signal.ts` (a `WorkspaceSpec`:
path, an en+ar label table, and eight tab definitions), against one API
registration block in `apps/api/src/resources.ts` (generic CRUD over the Drizzle
tables in `packages/db/src/schema/signal.ts`).

Consequences a designer must internalise:

- Every list is the same list: `<h1>` + tab strip + filter bar + optional
  create disclosure + one table + a two-button pager.
- Every record is the same record: back link + `<h1>` + a `<dl>` of every
  column + an edit form of the editable fields + (rarely) a delete button.
- **JSON columns are raw textareas.** `budgetJson`, `channelsJson`,
  `definitionJson`, `variantsJson`, `resultJson`, `complianceNotesJson`,
  `citationsCheckJson` are all `<textarea rows=6 class="font-mono text-12">`
  containing literal JSON. A marketer edits a campaign budget by typing JSON.
- **`contentRef` is a plain text string**, e.g.
  `signal/creatives/motor-search/en-a.json`,
  `signal/creatives/renewal-nudge/ar-email.mjml`,
  `signal/creatives/summer-travel/en-script.md`. Nothing renders the creative.
  There is no preview, no thumbnail, no copy of the ad text on screen anywhere.
- Two schema columns are written but **never rendered at all**:
  `signal_campaigns.guardrailChecksJson` (frequency cap, quiet hours,
  suppression audience applied, brand-kit pass, banned-claims pass) and
  `signal_aeo_pages.citedByJson` (which answer engines cite the page).
  `signal_creatives.aiAuditId`, `signal_attribution_events.anonId` and
  `signal_attribution_events.creativeId` are likewise invisible.

Enumerating the concrete columns and fields anyway is the whole point of the
rest of this document.

---

## 4. Shared chrome (identical on all 17 screens)

**Route tree** (`apps/web/app/routes.ts`): all SIGNAL screens sit inside
`layout("routes/workspace.tsx")`, which also owns `/approvals`.

| Pattern | File | SIGNAL instances |
|---|---|---|
| `/:module` | `routes/module.tsx` | `/signal` |
| `/:module/:resource` | `routes/module.tsx` | 8 list screens |
| `/:module/:resource/:id` | `routes/record.tsx` | 8 record screens |

**Shell** (`apps/web/app/components/shell.tsx`):

```
┌──────────────────────────────────────────────────────────────────────────┐
│ [brand mark + tenant name]        Signed in as {name}  Settings  Sign out│ h-14, sticky
├────────────┬─────────────────────────────────────────────────────────────┤
│ ● Home     │                                                             │
│ ● Operations│                   main content                             │
│ ● Conversations│                (max-width container, gap-6 column)      │
│ ●▪ Marketing│                                                            │
│ ● Market   │                                                             │
│ ● Insight  │                                                             │
│ ● Ledger   │                                                             │
│ ● Analytics│                                                             │
│  md:w-60   │                                                             │
└────────────┴─────────────────────────────────────────────────────────────┘
```

- Sidebar `md:w-60`, always text-labelled (never icon-only); below `md` it
  collapses to a horizontally scrollable strip above the content.
- Each nav item shows a 1.5-unit `aria-hidden` accent dot before the label.
  SIGNAL's is `--module-signal: #ff7a45` (also `--chart-3`). This orange dot is
  the *only* module-colour signal on the whole workspace — headers, tabs,
  buttons and badges all use the tenant accent, not the module accent.
- Tenant branding overrides `--accent` / `--accent-hover` / `--accent-contrast`
  and `--font-display` / `--font-ui` from tenant config. Seeded tenant GONXT:
  accent `#5B8CFF`, hover `#7FA6FF`, contrast `#070b14`, font `space-grotesk`,
  locales `["en","ar"]`, currency `AED`, domain pack `insurance-retail`.
- Header strings: `header.signedInAs` "Signed in as {name}",
  `header.settings` "Settings", `header.signOut` "Sign out".

**Nav gating trap.** The sidebar entry is
`{ labelKey: "nav.signal", href: "/signal", icon: "megaphone", permission: "signal:campaigns:read" }`
(`apps/api/src/routes/me.ts`). It is gated on **campaigns read alone**. So
`tenant.compliance` (creatives only) and `north.exec` / `north.analyst`
(attribution + spend only) hold real SIGNAL read permissions **and have no way
to navigate to SIGNAL at all**. They must be given a URL by a colleague.

**Table** (`packages/ui/src/data.tsx`): wrapper
`overflow-auto rounded-lg border border-border`; `<caption>` is `sr-only` and
reads `"Marketing — {Tab}"`; `<th>` is `uppercase tracking-wider text-11
text-subtle`, `text-end` when numeric; sortable headers are `<button>`s showing
`↕` idle, `▲`/`▼` active, with `aria-sort`; compact density = `px-2.5 py-1.5`
cells; sticky header on.

**Cell rendering** (`apps/web/app/components/fields.tsx`):

- `null` / `undefined` / `""` → `<span class="text-subtle">—</span>`
- `money` → localised currency from the sibling `currency` column; **with no
  currency it degrades to a bare number** (the `Money` primitive refuses to
  invent one)
- `json` → `font-mono text-11 text-subtle`, **truncated at 60 characters**
- `text` → truncated at 80 characters
- `datetime` → `<DateTime precision="minute">` in the actor's locale
- `badge: true` → a tone-coloured chip

**Badge tones** — this matters, because most SIGNAL states fall through:

| Tone | Values that hit it in SIGNAL |
|---|---|
| success (green) | `live` |
| info (blue) | `running`, `review` |
| warning (amber) | `pending`, `blocked` |
| danger (red) | *(none in SIGNAL)* |
| neutral (grey) | `draft`, `open`, **and everything unmatched**: `scheduled`, `paused`, `ended`, `passed`, `flagged`, `human`, `ai`, `manual`, `hourly`, `daily`, `concluded`, `abandoned`, `published`, `stale`, `retired`, `impression`, `click`, `visit`, `lead`, `bind`, `api`, `import` |

So **`blocked` and `pending` share the same amber**, `passed` and `flagged` are
both the same grey, and a `bind` worth AED 4,480 is styled exactly like an
`impression`. This is the single biggest visual defect in the module.

**Empty state** (`EmptyState`): dashed border, `p-10`, centred, a thin-line
`ConstellationArt` SVG with one accent dot, `font-display text-16` title,
`text-13 text-subtle` body.

**Error alert** (`Problem`): `role="alert"`, `rounded-md border
border-danger/40 bg-danger/10 p-3`, one line of `text-13`, rendering
`problem.detail ?? problem.title`.

**Pagination**: keyset, forward-only. Footer row: `{count} shown` on the start
side, `Previous` (only when a cursor is set; it simply drops the cursor and
returns to page 1) and `Next` (only when the API returned one) on the end side.
Default page size 50.

**Route-level errors** (`root.tsx` ErrorBoundary): `<h1 class="font-display
text-28">This did not load</h1>`, then one of `error.notFound` /
`error.forbidden` / `error.unauthorized` / `error.generic`, the request id as
`Reference {id}` in `font-mono text-12 text-muted`, and a **Try again** button.

---

## 5. Who sees what (role × tab matrix)

Read permissions per tab. `signal.marketer` and `signal.lead` are the only roles
that see the whole workspace.

| Tab | read permission | marketer | lead | signal.admin | tenant.admin | tenant.compliance | north.exec / north.analyst |
|---|---|---|---|---|---|---|---|
| Audiences | `signal:audiences:read` | ✓ | ✓ | ✓ | ✓ (read) | — | — |
| Campaigns | `signal:campaigns:read` | ✓ | ✓ | ✓ | ✓ (read) | — | — |
| Creatives | `signal:creatives:read` | ✓ | ✓ | ✓ | ✓ (read) | ✓ | — |
| Experiments | `signal:experiments:read` | ✓ | ✓ | ✓ | ✓ (read) | — | — |
| Budget moves | `signal:budget_moves:read` | ✓ | ✓ | ✓ | ✓ (read) | — | — |
| Answer pages | `signal:aeo:read` | ✓ | ✓ | ✓ | ✓ (read) | — | — |
| Attribution | `signal:attribution:read` | ✓ | ✓ | ✓ | ✓ (read) | — | ✓ |
| Spend | `signal:spend:read` | ✓ | ✓ | ✓ | ✓ (read) | — | ✓ |

**Roles with no SIGNAL permission whatsoever** (`/signal` is a hard 403 for
them, and no nav entry appears): `axis.lead`, `axis.agent`, `orbit.agent`,
`orbit.partners`, `orbit.retention`, `scout.lead`, `finance.controller`,
`finance.analyst`, `dev.admin`.

Write permissions:

| Action | permission | who holds it |
|---|---|---|
| create/update audience | `signal:audiences:create` | marketer, lead, signal.admin |
| create campaign | `signal:campaigns:create` | marketer, lead, signal.admin |
| update campaign | `signal:campaigns:update` | marketer, lead, signal.admin |
| create creative | `signal:creatives:generate` | marketer, lead, signal.admin |
| update creative | `signal:creatives:approve` | lead, signal.admin, **tenant.compliance** |
| create experiment | `signal:experiments:create` | marketer, lead, signal.admin |
| update experiment | `signal:experiments:decide` | lead, signal.admin |
| update budget move (reverse) | `signal:budget_moves:approve` | lead, signal.admin |
| create/update/delete answer page | `signal:aeo:write` | marketer, lead, signal.admin |
| attribution, spend | read only for everyone | — |

**Withholding is absence, not disablement.** A tab the actor cannot read is not
in the tab strip. A create form they cannot submit is not rendered. An edit form
they cannot save is not rendered. There are no greyed-out buttons anywhere in
SIGNAL; keep it that way.

**Denied-user experience.** Two distinct outcomes:

- Actor holds *some* SIGNAL tab but not the first one: hitting bare `/signal`
  403s, and the loader silently `redirect`s them to their first readable tab.
  They never see an error.
- Actor holds *no* SIGNAL tab, or lands directly on a tab they cannot read
  (`/signal/campaigns` as a compliance officer): full-page error boundary —
  **"This did not load" / "Your roles do not include access to this area." /
  Reference {id} / Try again**.

---

## 6. The approval gate (what makes SIGNAL consequential)

`packages/core/src/approvals.ts` defines six SIGNAL policies:

| policy key | decide permission | dual control | threshold |
|---|---|---|---|
| `signal.budget_move` | `signal:budget_moves:approve` | never | — |
| `signal.campaign_launch` | `signal:campaigns:launch` | never | — |
| `signal.creative_publish` | `signal:creatives:approve` | never | — |
| **`signal.budget_commit`** | `signal:campaigns:launch` | above_threshold | `defaultThresholdMinor: 50_000_00` |
| `signal.boost` | `signal:campaigns:update` | — | — |
| `signal.creator_brief` | `signal:creatives:approve` | — | — |

The seeded tenant carries an explicit threshold row for `signal.budget_commit`:
`{"amountMinor": 5000000, "currency": "AED"}` — **AED 50,000.00**, dual control
off, effective from 120 days ago. Above that number a budget commitment needs
two people; the policy record is the only place that number lives today and it
is **never displayed in any SIGNAL screen**.

Which SIGNAL writes are wired to a gate (`apps/api/src/resources.ts`):

- `PATCH /v1/signal/campaigns/:id` → `signal.campaign_launch`, **no amount
  field**. The seeded tenant's `policy.autoApprove` contains
  `"signal.campaign_launch"`, so in the demo tenant campaign edits (including
  `state: "live"`) pass straight through and only write a
  `core.approval.auto` audit entry.
- `PATCH /v1/signal/creatives/:id` → `signal.creative_publish`. **Not
  auto-approved.** Every creative edit is gated.
- `PATCH /v1/signal/budget-moves/:id` → `signal.budget_move`,
  `amountField: "amountMinor"`. **Not auto-approved.**

**What the gate does to the UI.** `gate()` writes a `pending` approval row and
then throws HTTP 403 `approval_required` whose `detail` is the bare policy key.
Because `Problem` renders `problem.detail ?? problem.title`, the user's whole
feedback for a blocked save is a red bar reading, literally:

```
signal.creative_publish
```

No sentence, no link to the approval, no mention that a request was raised on
their behalf. The record stays as it was, their form values stay on screen. To
proceed they must navigate to `/approvals`, find the request, decide it, come
back and press Save again — within the 24-hour approval TTL
(`APPROVAL_TTL_MS`), after which the approval goes stale and a fresh one is
raised. A rejected request also blocks re-submission for 24 hours with the same
opaque red bar. **This is the highest-value fix in the module.**

---

## 7. `/signal` — workspace entry

**Route + title.** Path `/signal`. Rendered by `routes/module.tsx` with no
`:resource` param, so `tabOf(spec, undefined)` returns the **first** tab and the
screen is identical to `/signal/audiences` — except that the URL stays `/signal`
while every tab link points at `/signal/<key>`. Page title (`<h1>`) is
`t("nav.signal")` = **"Marketing"** on this and every SIGNAL screen.

**Who sees it.** Anyone with `signal:audiences:read` gets the Audiences list at
this URL. Anyone with another SIGNAL read but not that one is redirected to
their first readable tab (compliance officer → `/signal/creatives`; north roles
→ `/signal/attribution-events`). Anyone with no SIGNAL read gets the full-page
"Your roles do not include access to this area."

**Purpose.** There is no purpose — it is not a landing page, it is the first tab
wearing a shorter URL.

**What is weak today.** SIGNAL has no overview: no spend-to-date, no live
campaign count, no pending approvals badge, no "what changed since yesterday".
The most consequential module in the product opens on a list of audience
definitions. A redesign should give `/signal` a real dashboard —
month-to-date spend against `periodCapMinor`, campaigns by state, budget moves
awaiting a decision, creatives in `pending`/`flagged` — and leave the tab list
below it.

---

## 8. `/signal/audiences` — Audiences (list)

**Route + title.** `/signal/audiences`. `<h1>` "Marketing". Tab label
`audiences` → **"Audiences"** (ar: الجماهير). API `GET /v1/signal/audiences`.

**Who sees it.** `signal:audiences:read` — `signal.marketer`, `signal.lead`,
`signal.admin`, `tenant.admin` (read only). Denied users: full-page
`error.forbidden`.

**Purpose.** List every reachable segment, its cached size, how often it
refreshes, and which consent purposes it depends on.

**Layout skeleton.**

```
Marketing                                                          (24px display)
[Audiences] Campaigns  Creatives  Experiments  Budget moves  Answer pages …   (h-8 chips)

[ Refresh: All ▾ ]  [ Apply ]                                       (filter bar, gap-3)

  + New — Audiences                                                 (<details>, closed)

┌──────────────────────────────────────────────────────────────────────────┐
│ NAME ↕        │  SIZE │ REFRESH │ CONSENT PURPOSES │ LAST REFRESHED │ CREATED ↕│
│ Motor policy… │ 4,182 │ [Daily] │ marketing        │ 12 Jul, 03:00  │ 2 Apr    │
│ Renewals due… │ 1,247 │ [Daily] │ marketing        │ 12 Jul, 03:00  │ 2 Apr    │
│ …                                                                        │
└──────────────────────────────────────────────────────────────────────────┘
  6 shown                                                       [Previous][Next]
```

Roughly: header block ~120px, filter bar ~48px, create disclosure ~48px closed,
table fills the rest. Table is `overflow-auto`, so on narrow viewports it
scrolls horizontally inside its own border.

**Every element.**

| Element | Label / i18n key | Source | Behaviour |
|---|---|---|---|
| `<h1>` | `nav.signal` "Marketing" | shared catalogue | — |
| Tab strip | `<nav aria-label="Sections">` (`common.tabs`) | `visibleTabs(spec, permissions)` | Only readable tabs render. Current tab `bg-surface-2 font-medium text-text`, others `text-subtle hover:bg-surface-2` |
| Filter select | aria-label "Refresh" (`refreshPolicy`) | spec filter | Options: All (`common.all`), Manual, Hourly, Daily. Submits as `?refreshPolicy=` |
| Apply | `common.apply` "Apply" | — | `Button variant="secondary"`, shows loading spinner while navigating |
| Clear | `common.clear` "Clear" | — | Ghost link back to `/signal/audiences`; **rendered only when a filter or search is active** |
| Create disclosure | `+ New — Audiences` (`common.new`) | — | `<details>`; auto-opens when the last create failed |
| Row link | first cell (Name) | — | `<Link>` to `/signal/audiences/<id>` |
| Footer count | `common.rows` "{count} shown" | rows on this page | Not a total — 50 rows shows "50 shown" with more behind Next |

**Table columns.**

| # | Header (key) | Type | Align | Sortable | Notes |
|---|---|---|---|---|---|
| 1 | Name (`name`) | text | start | **yes** | Link into the record; truncated at 80 chars |
| 2 | Size (`sizeCached`) | number | **end** | no | Raw integer, no thousands formatting beyond locale. `null` renders "—" |
| 3 | Refresh (`refreshPolicy`) | text, **badge** | start | no | Manual / Hourly / Daily — all neutral grey |
| 4 | Consent purposes (`consentPurposes`) | text | start | no | Comma string, e.g. `marketing,profiling`, or `none` |
| 5 | Last refreshed (`lastRefreshedAt`) | datetime | start | no | Minute precision; "—" when never refreshed |
| 6 | Created (`createdAt`) | datetime | start | **yes** | — |

No default sort is declared, so the API's own default ordering applies until the
user clicks a sortable header (which sets `?sort=&order=` and drops the cursor).

**Forms — create (`+ New — Audiences`).** Grid `sm:grid-cols-2`, submit
`common.create` "Create".

| Field | Label | Input | Required | Default | Validation / error copy |
|---|---|---|---|---|---|
| `name` | Name | `<Input type="text">` | **yes** | empty | Server-side zod; failure renders the API's `detail` in the red `Problem` bar |
| `definitionJson` | Definition | `<Textarea rows=6 class="font-mono text-12">` | **yes** | empty | Must be valid JSON; a malformed body returns 400 with the zod message |
| `refreshPolicy` | Refresh | `<Select>` | no | first option | manual / hourly / daily |
| `consentPurposes` | Consent purposes | `<Input type="text">` | no | empty | Free text; **nothing validates that the purposes named here actually exist as consent purposes** |

There is no client-side validation beyond the browser's `required` attribute,
and no field-level error placement: every error is one line at the top.

**States.**

- *Empty (unfiltered)*: "Nothing here yet" / "No records match this view. Clear
  the filters, or create the first one."
- *Empty (filtered)*: "Nothing here yet" / "No records match these filters."
- *Loading*: no skeleton. The Apply button shows its loading state; the table
  keeps the previous rows until the navigation resolves.
- *Error*: full-page boundary (loader errors) or the red `Problem` bar (create
  errors).
- *Permission denied*: "Your roles do not include access to this area."

**AI surfaces.** None. No ✦ marker, no ghost text, no suggestion chip appears on
this screen. An audience definition is typed by hand as JSON.

**Actions and consequences.** Create and update only. No delete (the spec
declares no `remove`, and the table has no `deletedAt`). Nothing here is gated
by an approval. Changing `consentPurposes` or `definitionJson` silently changes
who a live campaign will reach on its next refresh — with no warning, no
preview, no size re-estimate.

**Mobile.** Not present. The Expo app maps `/signal` to
`signal/campaigns` only. Audiences are web only.

**RTL notes.** Tab strip, table column order and the filter bar all mirror.
Numbers stay LTR (`tabular-nums`). The `definitionJson` textarea must stay
**LTR with `dir="ltr"`** — JSON is code and mirrors into nonsense; today it
inherits page direction, which is a bug in Arabic. Consent purpose strings
(`marketing,profiling`) are ASCII tokens and should also stay LTR.

**What is weak today.** Six seeded audiences and one of them is
`"Do not contact — withdrawn consent, complaints, open claims"` (213 people),
which every other audience subtracts via `excludeAudienceId` inside
`definitionJson`. That suppression relationship — the single most important
safety property of the whole module — is invisible: it is buried in truncated
JSON. The list cannot answer "is the suppression list applied to this
audience?", "how big is this audience really" (`sizeCached` may be months old
and one row is `null` "never refreshed" with no visual distinction from a
freshly computed one), or "which campaigns use this audience".

---

## 9. `/signal/audiences/:id` — Audience (record)

**Route + title.** `/signal/audiences/<aud_…>`. `<h1>` is the **Name** value,
e.g. "Motor policyholders with no health cover". Subtitle:
`Audiences · aud_01J…` with the id in `font-mono`.

**Who sees it.** `signal:audiences:read` to view; the edit form appears only
with `signal:audiences:create`.

**Purpose.** Read one audience's definition and change how it refreshes.

**Layout skeleton.**

```
Back to list                                                        (12px, subtle)
Motor policyholders with no health cover                            (24px display)
Audiences · aud_01J8…                                               (12px mono id)

┌─ details ────────────────────────────────────────────────────────────────┐
│ Name              Size               Refresh                             │
│ Motor policyho…   4182               Daily                               │
│ Consent purposes  Last refreshed     Created                             │
│ marketing         12 Jul 2026 03:00  02 Apr 2026 09:14                   │
│ Updated                                                                  │
│ 12 Jul 2026 03:00                                                        │
└──────────────────────────────────────────────────────────────────────────┘   (3-col grid ≥lg, 2-col ≥sm, 1-col below)

┌─ Edit ───────────────────────────────────────────────────────────────────┐
│ Definition                          Refresh                              │
│ ┌───────────────────────────┐       [ Daily ▾ ]                          │
│ │ {"include":[…],           │       Consent purposes                     │
│ │  "excludeAudienceId":"…"} │       [ marketing            ]             │
│ └───────────────────────────┘                                            │
│ [ Save changes ]                                                         │
└──────────────────────────────────────────────────────────────────────────┘
```

**Every element.** Back link `common.back` "Back to list" → `/signal/audiences`.
`<dl>` renders **all six columns** plus `common.createdAt` "Created" and
`common.updatedAt` "Updated" when present; each is a `<dt>` in
`text-12 text-subtle` above a `<dd>` in `text-13 text-text`. No Actions section
(SIGNAL declares no record actions anywhere). No delete button.

**Forms — edit.** Heading `common.edit` "Edit", submit `common.save`
"Save changes", `PATCH /v1/signal/audiences/<id>`.

| Field | Label | Input | Prefilled from | Notes |
|---|---|---|---|---|
| `definitionJson` | Definition | Textarea rows=6, mono 12px | row value | Raw JSON, no formatter, no schema hint |
| `refreshPolicy` | Refresh | Select manual/hourly/daily | row value | — |
| `consentPurposes` | Consent purposes | text input | row value | — |

`name` is **not** editable — it is a create-only field. An audience cannot be
renamed through the UI.

**States.** Loading: no skeleton (the loader blocks the navigation). Save
failure: red `Problem` bar above the `<dl>`. Save success: **no confirmation at
all** — the action returns `{ problem: null, done: null }`, the page re-renders
with the same values, and nothing says "Saved". Not found / no permission:
full-page boundary.

**AI surfaces.** None.

**Actions and consequences.** Saving takes effect immediately on the next
refresh cycle; no approval, no audit surface on this screen. Not reversible
through the UI — there is no version history for a definition.

**Mobile.** Web only.

**RTL notes.** The `<dl>` grid mirrors. The JSON textarea and the mono id must
stay LTR.

**What is weak today.** The `<dl>` shows `sizeCached` as a bare integer with no
"as of" relationship to `lastRefreshedAt` next to it; a size computed three
months ago looks identical to one computed at 03:00 today. There is no
"Refresh now" button even though `refreshPolicy: manual` exists as a state,
which means a manual audience can only ever be refreshed by a background job
the UI never mentions.

---

## 10. `/signal/campaigns` — Campaigns (list)

**Route + title.** `/signal/campaigns`. Tab label **"Campaigns"** (ar: الحملات).
API `GET /v1/signal/campaigns`. Default sort `startAt desc`.

**Who sees it.** `signal:campaigns:read` — marketer, lead, signal.admin,
tenant.admin (read). This is also the permission that gates the **sidebar entry
for the whole module**.

**Purpose.** The spine of the module: every campaign, what it is for, whether it
is live, who owns it and when it runs.

**Layout skeleton.**

```
Marketing
Audiences [Campaigns] Creatives  Experiments  Budget moves  Answer pages  Attribution  Spend

[ Search…            ] [ State: All ▾ ] [ Objective: All ▾ ] [ Apply ] [ Clear ]
  ^ w-64, role="search"

  + New — Campaigns

┌──────────────────────────────────────────────────────────────────────────────┐
│ NAME              │OBJECTIVE│ STATE  │AUTONOMY│ OWNER      │ STARTS ↕│ ENDS   │
│ Motor — always-on │ acq     │[Live]  │[act]   │ user:gl…   │ 01 Jan  │ —      │
│ December brand…   │ acq     │[Paused]│[act_w…]│ user:gl…   │ 01 Dec  │ 31 Dec │
│ Health cross-sell │ xsell   │[Live]  │[act]   │ user:mk…   │ 15 Feb  │ —      │
└──────────────────────────────────────────────────────────────────────────────┘
  7 shown                                                          [Previous][Next]
```

**Every element.** As §8, plus: a search `<Input type="search" name="q"
class="w-64">` with placeholder and aria-label "Search" (`common.search`),
wrapped in `<Form method="get" role="search">`; the API searches the `name`
column only (`searchable: ["name"]`).

**Table columns.**

| # | Header (key) | Type | Align | Sortable | Notes |
|---|---|---|---|---|---|
| 1 | Name (`name`) | text | start | no | Link into the record. **Not sortable** despite being the primary column |
| 2 | Objective (`objective`) | text | start | no | Renders the **raw enum** `acq` / `renewal` / `xsell` — not a badge, so `optionLabel` never runs and the translated words "Acquisition" / "Renewal" / "Cross-sell" in the label table are unused here (they only appear in the filter select) |
| 3 | State (`state`) | text, **badge** | start | no | Draft (grey) / In review (**blue**) / Scheduled (grey) / Live (**green**) / Paused (grey) / Ended (grey) |
| 4 | Autonomy (`autonomyLevel`) | text, **badge** | start | no | Raw values `suggest` / `draft` / `act_with_approval` / `act` — **not in the label table**, so they render untranslated, and every one is grey |
| 5 | Owner (`ownerRef`) | text | start | no | Raw ref like `user:usr_01J…`; no name resolution |
| 6 | Starts (`startAt`) | datetime | start | **yes** | Default sort, descending |
| 7 | Ends (`endAt`) | datetime | start | no | "—" for open-ended |

**Filters.** State (`draft`, `review`, `scheduled`, `live`, `paused`, `ended`,
rendered via the label table as Draft / In review / Scheduled / Live / Paused /
Ended) and Objective (Acquisition / Renewal / Cross-sell). Both plus "All".

**Forms — create.**

| Field | Label | Input | Required | Notes |
|---|---|---|---|---|
| `name` | Name | text | **yes** | — |
| `objective` | Objective | select acq/renewal/xsell | **yes** | Shows translated labels |
| `audienceId` | Audience | **plain text input** | no | The user must paste an `aud_…` id. There is no picker, no lookup, no validation that it exists |
| `channelsJson` | Channels | JSON textarea | **yes** | Seeded shape: `["google_search","bing_search"]` |
| `budgetJson` | Budget | JSON textarea | **yes** | Seeded shape: `{"currency":"AED","period":"2026-01","dailyCapMinor":350000,"periodCapMinor":10850000,"upliftMinor":1500000,"autopilotBoundMinor":1000000}` |
| `ownerRef` | Owner | text | **yes** | Raw ref, typed |
| `startAt` | Starts | `datetime-local` | no | — |
| `endAt` | Ends | `datetime-local` | no | Nothing enforces `endAt > startAt` in the form |

**States.** Empty/loading/error/denied exactly as §8. There is one extra: the
create disclosure re-opens automatically when a create was rejected, so the
user's context is preserved with the red bar above it.

**AI surfaces.** None on this screen. Note the mismatch: campaigns carry an
`autonomyLevel` column with values up to `act` (autonomous spend within
`autopilotBoundMinor`), and the module's budget autopilot writes budget moves
under `system:signal.budget_autopilot` — but **no ✦ marker, no autonomy
explanation and no "why" is shown anywhere on the campaign surface**.

**Actions and consequences.** Create is not gated. Every `PATCH` — including
setting `state: "live"` — routes through the `signal.campaign_launch` policy;
in the seeded tenant that policy is on the `autoApprove` allowlist, so it
resolves instantly and writes a `core.approval.auto` audit entry. In a tenant
without that allowlist entry, changing state to live throws the opaque
`signal.campaign_launch` red bar (see §6). Going live is **not reversible** in
the sense that spend begins; the remedy is setting state back to `paused`.

**Mobile.** **This is the one SIGNAL screen that exists on mobile.** See §22.

**RTL notes.** Everything mirrors except: `ownerRef`, `audienceId`,
`channelsJson`, `budgetJson` and datetimes-as-typed, which are LTR data.

**What is weak today.** A campaign is money, and this screen shows no money at
all. `budgetJson` is not a column, so `dailyCapMinor`, `periodCapMinor`,
`upliftMinor`, `autopilotBoundMinor` and `releasedMinor` / `unspentMinor` are
invisible on the list — the user cannot see which campaign is capped at
AED 3,500/day or which one has AED 23,000 released. `guardrailChecksJson`
(frequency cap 2/week, quiet hours 20:00–08:00 Asia/Dubai, suppression audience
applied, brand-kit pass, banned-claims pass) is written by the system and
**never rendered anywhere in the product**. One seeded campaign sits in
`scheduled` purely because its Arabic email is unreviewed (`localesRequired:
["en","ar"]`), and nothing on screen explains why it has not gone live.

---

## 11. `/signal/campaigns/:id` — Campaign (record)

**Route + title.** `/signal/campaigns/<cmp_…>`. `<h1>` is the campaign **Name**.
Subtitle `Campaigns · cmp_01J…`.

**Who sees it.** `signal:campaigns:read`; edit form needs
`signal:campaigns:update`.

**Purpose.** Read a campaign's settings and change its state, budget, dates or
owner.

**Layout skeleton.**

```
Back to list
Motor — always-on search
Campaigns · cmp_01J8…

┌─ details (3-col ≥lg) ────────────────────────────────────────────────────┐
│ Name             Objective        State                                  │
│ Motor — always…  acq              [Live]                                 │
│ Autonomy         Owner            Starts                                 │
│ [act]            user:usr_01J…    01 Jan 2026 00:00                      │
│ Ends             Created          Updated                                │
│ —                12 Dec 2025      28 Jul 2026 03:00                      │
└──────────────────────────────────────────────────────────────────────────┘

┌─ Edit ───────────────────────────────────────────────────────────────────┐
│ State                       Budget                                       │
│ [ Live ▾ ]                  ┌────────────────────────────┐               │
│ Starts                      │ {"currency":"AED","period" │               │
│ [ 2026-01-01T00:00 ]        │ :"2026-01","dailyCapMinor" │               │
│ Ends                        │ :350000,…}                 │               │
│ [                    ]      └────────────────────────────┘               │
│ Owner                                                                    │
│ [ user:usr_01J…           ]                                              │
│ [ Save changes ]                                                         │
└──────────────────────────────────────────────────────────────────────────┘
```

**Every element.** `<dl>` over the seven list columns + Created + Updated.
Note what the record page **does not show**, because the spec's `columns` array
is the whole `<dl>`: `audienceId`, `channelsJson`, `budgetJson`,
`guardrailChecksJson`, `deletedAt`. So the budget is invisible in the details
block yet editable in the form below it — a user edits a value they were never
shown.

**Forms — edit** (`PATCH /v1/signal/campaigns/<id>`):

| Field | Label | Input | Notes |
|---|---|---|---|
| `state` | State | Select: Draft / In review / Scheduled / Live / Paused / Ended | **The launch control.** No confirmation dialog, no consequence copy |
| `budgetJson` | Budget | JSON textarea, mono 12px | Money edited as raw minor-unit integers |
| `startAt` | Starts | `datetime-local` | — |
| `endAt` | Ends | `datetime-local` | — |
| `ownerRef` | Owner | text | — |

**States.** Save failure → red bar. Save success → silent. Approval required
(non-auto-approve tenant) → red bar reading `signal.campaign_launch`.

**AI surfaces.** None here. The AI runs that touched this campaign do exist —
seeded `ai_run` rows with `agentKey: "creative"`, `purpose: "creative.variant"`,
`subjectRef: "campaigns:motor-jan"`, one `refused` with
`errorCode: "guardrail_block"` and confidence 40, one `cancelled` — but they are
only visible in the **Administration → AI** screens. Nothing links a campaign to
the AI work done on it.

**Actions and consequences.** Setting `state` to `live` starts spend. Setting it
to `paused` stops it. Neither is confirmed, neither is explained, and there is
no delete button (campaigns have a `deletedAt` column but the spec declares no
`remove`, so soft delete is unreachable from the UI).

**Mobile.** Read-only detail view exists — see §22.

**RTL notes.** Details grid and form grid mirror; the JSON textarea and
`ownerRef` must not.

**What is weak today.** The single most consequential control in the module —
the campaign state select — is an unlabelled-by-consequence dropdown sitting in
a generic two-column form between "Budget" and "Owner", with a "Save changes"
button. Launching a campaign should not look like editing a phone number.
Nothing shows spend to date against `periodCapMinor`, nothing shows which
creatives are attached or whether any are `blocked`, nothing shows the audience
name, nothing shows the guardrail check results.

---

## 12. `/signal/creatives` — Creatives (list)

**Route + title.** `/signal/creatives`. Tab label **"Creatives"** (ar: المواد
الإبداعية). API `GET /v1/signal/creatives`.

**Who sees it.** `signal:creatives:read` — marketer, lead, signal.admin,
tenant.admin (read), **`tenant.compliance`**. Create needs
`signal:creatives:generate` (marketer, lead, signal.admin — **not** compliance).
Update needs `signal:creatives:approve` (lead, signal.admin, **compliance**).
So the compliance officer sees the table and an edit form on the record page,
but no create disclosure. And, per §4, they have no sidebar link to get here.

**Purpose.** Every piece of content the tenant may publish, with its compliance
verdict.

**Layout skeleton.**

```
Marketing
Audiences  Campaigns [Creatives] Experiments  Budget moves  Answer pages  Attribution  Spend

[ Kind: All ▾ ] [ Compliance: All ▾ ] [ Apply ]

  + New — Creatives            (absent for tenant.compliance)

┌──────────────────────────────────────────────────────────────────────────────────────┐
│ CONTENT             │CAMPAIGN│KIND│LANG│VARIANT│COMPLIANCE│NOTES   │PERF    │MADE BY│CREATED ↕│
│ signal/creatives/m… │cmp_01J…│ ad │ en │ mot-a │[Passed]  │{"lane"…│{"impr"…│[AI]   │12 Dec   │
│ signal/creatives/m… │cmp_01J…│ ad │ en │ mot-b │[Flagged] │{"lane"…│{"impr"…│[AI]   │12 Dec   │
│ signal/creatives/…  │cmp_01J…│ ad │ ar │ mot-g │[Blocked] │{"lane"…│—       │[AI]   │14 Dec   │
└──────────────────────────────────────────────────────────────────────────────────────┘
  9 shown                                                                [Previous][Next]
```

Ten columns in a table that must fit an already-narrow content column: this
screen always scrolls horizontally on a laptop.

**Table columns.**

| # | Header (key) | Type | Align | Sortable | Notes |
|---|---|---|---|---|---|
| 1 | Content (`contentRef`) | text | start | no | Link into the record. A **file path string**, e.g. `signal/creatives/motor-search/en-a.json`. Truncated at 80 chars, so the distinguishing tail is often what gets cut |
| 2 | Campaign (`campaignId`) | text | start | no | Raw `cmp_…` id, no name, **no link** |
| 3 | Kind (`kind`) | text | start | no | Raw enum `ad` / `lp` / `email` / `social` / `video_script` — not a badge, so not translated in the cell |
| 4 | Language (`locale`) | text | start | no | `en` / `ar` |
| 5 | Variant group (`variantGroup`) | text | start | no | The A/B arm |
| 6 | Compliance (`complianceStatus`) | text, **badge** | start | no | Pending (**amber**) / Passed (grey) / Flagged (grey) / Blocked (**amber**) |
| 7 | Compliance notes (`complianceNotesJson`) | json | start | no | Mono 11px, **truncated at 60 chars** |
| 8 | Performance (`performanceJson`) | json | start | no | Mono 11px, truncated. Seeded shapes `{"impressions":…,"clicks":…,"ctrBps":…,"binds":…}` for ads, `{"visits":…,"quoteStarts":…,"quoteStartRateBps":…}` for landing pages |
| 9 | Made by (`generatedBy`) | text, **badge** | start | no | **Human** / **AI** — both neutral grey |
| 10 | Created (`createdAt`) | datetime | start | **yes** | — |

**Filters.** Kind (Ad / Landing page / Email / Social / Video script) and
Compliance (Pending / Passed / Flagged / Blocked), each plus All.

**Forms — create** (`signal:creatives:generate` only):

| Field | Label | Input | Required | Notes |
|---|---|---|---|---|
| `kind` | Kind | Select ad/lp/email/social/video_script | **yes** | — |
| `contentRef` | Content | text | **yes** | The path is typed by hand |
| `campaignId` | Campaign | text | no | Raw id, typed |
| `locale` | Language | text | no | Free text — nothing constrains it to the tenant's `["en","ar"]` |

Note that `variantGroup`, `complianceStatus` and `generatedBy` are **not**
create fields; the API sets them.

**States.** As §8. A compliance officer arriving from a pasted URL with only
`signal:creatives:read` sees the table with **no tab strip beyond one entry**
(the strip only renders when more than one tab is visible — for compliance,
exactly one is, so there is no tab strip at all and the screen looks like a
context-free table under the word "Marketing").

**AI surfaces.** The **only** trace of AI in the entire SIGNAL UI is the
`generatedBy` badge reading "AI" in neutral grey. There is **no ✦ marker**
anywhere in SIGNAL (`AGENT_MARK` appears only in `approvals.tsx`, `ai-run.tsx`,
`ai-console.tsx`, `ai-budget.tsx` and `packages/ui/src/ai.tsx`). Every seeded
creative has `aiAuditId: null` populated in the schema but never surfaced, so
even where the audit link exists there is no "why" to inspect. This violates
CLAUDE.md §11 in spirit: AI-generated artefacts carry no ✦ and no inspectable
rationale.

**Actions and consequences.** Create is ungated. **Every update is gated on
`signal.creative_publish`, which is not auto-approved** — so a compliance
officer marking a creative `passed` gets 403 and a red bar reading
`signal.creative_publish`, must go to `/approvals`, approve their own request
(dual control is `never` on this policy, so self-approval is permitted), and
come back. Two round trips through a different screen to record one verdict.

**Mobile.** Web only.

**RTL notes.** The table mirrors. `contentRef` paths, `campaignId`, `locale`
codes and the two JSON columns must stay LTR — today they do not, and an Arabic
compliance officer reads file paths with the slashes in the wrong order. The
Arabic-language creatives themselves are never displayed (only their paths), so
there is no bidirectional content rendering problem yet — there will be the
moment a preview is added.

**What is weak today.** This screen is where a regulator's question lands and it
cannot answer one. The seeded data holds a creative flagged with
`{"lane":"soft_flag","rule":"comparison_claim_requires_source","excerpt":"the
cheapest motor cover in the UAE"}` and one **blocked** with
`{"lane":"hard_block","rule":"no_guarantee_of_cover","excerpt":"قبول مضمون مهما
كان سجلك"}` decided by a named compliance officer. Both render as
`{"lane":"soft_fl…` in 11px grey. The rule that was broken, the offending
sentence, who decided and when — all present in the data, all invisible. And
`blocked` shares its amber with `pending`, so the one creative that must never
ship looks like the ones merely awaiting review.

---

## 13. `/signal/creatives/:id` — Creative (record) — **the compliance verdict screen**

**Route + title.** `/signal/creatives/<crv_…>`. `<h1>` is the **contentRef**,
i.e. a raw file path such as `signal/creatives/summer-travel/en-script.md`.
Subtitle `Creatives · crv_01J…`.

**Who sees it.** `signal:creatives:read`. The edit form requires
`signal:creatives:approve` — held by `signal.lead`, `signal.admin` and
`tenant.compliance`. A `signal.marketer` sees the record read-only: they can
create a creative but cannot change its status.

**Purpose.** Record the compliance verdict on one piece of content.

**Layout skeleton.**

```
Back to list
signal/creatives/summer-travel/en-script.md                        (24px display — a file path)
Creatives · crv_01J8…

┌─ details (3-col ≥lg) ────────────────────────────────────────────────────┐
│ Content             Campaign           Kind                              │
│ signal/creatives/…  cmp_01J8…          video_script                      │
│ Language            Variant group      Compliance                        │
│ en                  —                  [Pending]                         │
│ Compliance notes    Performance        Made by                           │
│ {"likeness":"none…  —                  [AI]                              │
│ Created             Updated                                              │
│ 20 Jul 2026 11:02   20 Jul 2026 11:02                                    │
└──────────────────────────────────────────────────────────────────────────┘

┌─ Edit ───────────────────────────────────────────────────────────────────┐
│ Compliance                  Compliance notes                             │
│ [ Pending ▾ ]               ┌────────────────────────────┐               │
│ Content                     │ {"likeness":"none — illus… │               │
│ [ signal/creatives/…      ] └────────────────────────────┘               │
│ [ Save changes ]                                                         │
└──────────────────────────────────────────────────────────────────────────┘
```

**Every element.** The `<dl>` covers all ten list columns plus Created and
Updated. Nothing else. No preview, no rendered content, no link to the campaign,
no link to the AI run that generated it, no approval history.

**Forms — edit** (`PATCH /v1/signal/creatives/<id>`):

| Field | Label | Input | Required | Notes |
|---|---|---|---|---|
| `complianceStatus` | Compliance | Select: Pending / Passed / Flagged / Blocked | no | The verdict |
| `complianceNotesJson` | Compliance notes | JSON textarea rows=6 mono | no | The reasoning — same submit as the verdict, deliberately |
| `contentRef` | Content | text | no | Repointing the content is possible **after** it passed compliance, with no re-review trigger |

**This is where the likeness constraint lives.** The seeded video script carries
`complianceNotesJson.likeness = "none — illustrated brand character, no real
person depicted or voiced"`. Today: a truncated grey blob in the details grid
and a raw JSON textarea in the form. **What the redesign must add**, and only
here:

- A dedicated **Likeness** row in the details block for `kind` in
  {`video_script`, `social`}, with two possible renderings:
  - *No real person depicted* — plain, with the declared text.
  - *Consent on file* — the consent record's `evidenceRef`, its `version`, its
    `expiry` date, and a link to `/admin/consents/<id>`.
- A third rendering that must be visually loud: **no likeness declaration at
  all** on a creative whose kind can depict a person. That state must block the
  `passed` option in the compliance select.
- The link target already exists (`GET /v1/core/consents`, `core:consents:read`,
  which `signal.lead` and `signal.marketer` both hold). The Administration nav
  entry that hides it is gated on `core:users:read`; the link from this screen
  is what makes the consent record reachable for the people who need it.

**States.** Loading: none. Save failure: red bar. **Save under the approval
gate: red bar reading `signal.creative_publish`** and the record unchanged.
Success: silent. Denied: full-page boundary.

**AI surfaces.** "Made by: AI" badge only. `aiAuditId` exists on the row and is
never rendered — so the "why did the model write this" trail is one column away
and unreachable.

**Actions and consequences.** Every save is gated (see §6). Marking a creative
`blocked` does not, by itself, stop a live campaign from serving it — there is
no visible enforcement link between `complianceStatus` and campaign state in the
UI. There is no delete.

**Mobile.** Web only.

**RTL notes.** `<h1>` is a file path and **must be forced LTR** even in Arabic —
today it inherits page direction and a path like
`signal/creatives/motor-lp/ar.mdx` renders with reversed segment order, which is
a live bug on the Arabic locale. The `complianceNotesJson` excerpt for the
blocked Arabic creative is genuine Arabic prose inside a JSON string inside a
mono textarea — bidirectional text inside code formatting, currently unhandled.

**What is weak today.** This screen decides whether content may be published and
it never shows the content. The reviewer sees a path, a truncated JSON note and
a dropdown. The verdict cannot be recorded in one action because of the approval
gate. There is no "why this needs approval", no diff against the previous
verdict, no record of who ruled last time.

---

## 14. `/signal/signal-experiments` — Experiments (list)

**Route + title.** `/signal/signal-experiments` — note the doubled module name
in the URL, which comes from the resource key `signal-experiments` (the table
name deconflicts against other modules' experiments). Tab label
**"Experiments"** (ar: التجارب). API `GET /v1/signal/signal-experiments`.

**Who sees it.** `signal:experiments:read` — marketer, lead, signal.admin,
tenant.admin (read). Create: `signal:experiments:create` (marketer, lead).
Update: `signal:experiments:decide` (**lead only**, plus signal.admin) — a
marketer can start an experiment but not conclude one.

**Purpose.** What the team is still deciding, and on what evidence.

**Layout skeleton.**

```
Marketing
… [Experiments] …

[ State: All ▾ ] [ Apply ]

  + New — Experiments

┌────────────────────────────────────────────────────────────────────────────────┐
│ HYPOTHESIS                       │CAMPAIGN│METRIC         │ MIN SAMPLE │STATE   │CONCLUDED│CREATED ↕│
│ An Arabic-first landing page wi… │cmp_01J…│quote_start_ra…│      4,000 │[Conclu]│14 Jun   │02 May   │
│ A discount-led headline beats a… │cmp_01J…│ctr            │      6,000 │[Conclu]│20 Jun   │10 May   │
│ A 45-day nudge outperforms a 30… │cmp_01J…│renewal_rate   │      2,500 │[Runni] │—        │01 Jul   │
└────────────────────────────────────────────────────────────────────────────────┘
  5 shown                                                              [Previous][Next]
```

**Table columns.**

| # | Header (key) | Type | Align | Sortable | Notes |
|---|---|---|---|---|---|
| 1 | Hypothesis (`hypothesis`) | text | start | no | Link into the record; a full sentence truncated at 80 chars — usually cut mid-claim |
| 2 | Campaign (`campaignId`) | text | start | no | Raw id, no link; `null` for the AEO experiment |
| 3 | Metric (`metric`) | text | start | no | Raw metric key, e.g. `quote_start_rate`, `ctr`, `renewal_rate` |
| 4 | Minimum sample (`minSample`) | number | **end** | no | — |
| 5 | State (`state`) | text, **badge** | start | no | Draft (grey) / Running (**blue**) / Concluded (grey) / Abandoned (grey) |
| 6 | Concluded (`concludedAt`) | datetime | start | no | "—" while running |
| 7 | Created (`createdAt`) | datetime | start | **yes** | — |

**Filter.** State: All / Draft / Running / Concluded / Abandoned.

**Forms — create.**

| Field | Label | Input | Required | Notes |
|---|---|---|---|---|
| `hypothesis` | Hypothesis | `<Textarea rows=3>` | **yes** | — |
| `campaignId` | Campaign | text | no | Raw id |
| `variantsJson` | Variants | JSON textarea rows=6 | **yes** | The A/B arms |
| `metric` | Metric | text | **yes** | Free text — nothing constrains it to metrics that exist |
| `minSample` | Minimum sample | `type="number" step=1` | no | Nothing enforces it before concluding |

**States.** As §8.

**AI surfaces.** None.

**Actions and consequences.** Concluding an experiment (`state: concluded` +
`resultJson`) is not gated by any approval. It is also not enforced against
`minSample` — a lead can conclude a two-visit experiment.

**Mobile.** Web only.

**RTL notes.** `hypothesis` is prose and mirrors correctly. `metric`,
`campaignId` and `variantsJson` are LTR data.

**What is weak today.** The result is where the value is and it is not a column:
`resultJson` never appears in the list. The seeded data holds
`+280 bps` with `probabilityToBeatControlBps: 9870` on the winning Arabic-first
landing page, `-50 bps` on the losing discount headline, and a genuinely
important abandonment reason — *"Only 38% of the audience holds a WhatsApp
opt-in…"* with `reachableShareBps: 3800`. None of it is visible until the record
page, and even there it is a truncated blob. A concluded experiment and an
abandoned one look identical (both grey).

---

## 15. `/signal/signal-experiments/:id` — Experiment (record)

**Route + title.** `/signal/signal-experiments/<exp_…>`. `<h1>` is the
**hypothesis sentence** — the only SIGNAL heading that reads like a sentence.
Subtitle `Experiments · exp_01J…`.

**Who sees it.** `signal:experiments:read`; edit form needs
`signal:experiments:decide` (lead / signal.admin only).

**Purpose.** Record the outcome of one experiment.

**Layout skeleton.**

```
Back to list
An Arabic-first landing page raises quote starts for Arabic-speaking visitors
Experiments · exp_01J8…

┌─ details ────────────────────────────────────────────────────────────────┐
│ Hypothesis          Campaign          Metric                             │
│ An Arabic-first la… cmp_01J8…         quote_start_rate                   │
│ Minimum sample      State             Concluded                          │
│ 4000                [Concluded]       14 Jun 2026 09:00                  │
│ Created             Updated                                              │
│ 02 May 2026         14 Jun 2026                                          │
└──────────────────────────────────────────────────────────────────────────┘

┌─ Edit ───────────────────────────────────────────────────────────────────┐
│ State                       Result                                       │
│ [ Concluded ▾ ]             ┌────────────────────────────┐               │
│ Concluded                   │ {"winner":"ar-first","upli │               │
│ [ 2026-06-14T09:00 ]        │ ftBps":280,…}              │               │
│                             └────────────────────────────┘               │
│ [ Save changes ]                                                         │
└──────────────────────────────────────────────────────────────────────────┘
```

**Every element.** `<dl>` over the seven list columns + Created + Updated.
`variantsJson` and `resultJson` are **not columns**, so the variants under test
and the result are absent from the details block — `resultJson` appears only as
an editable textarea below it.

**Forms — edit.**

| Field | Label | Input | Notes |
|---|---|---|---|
| `state` | State | Select Draft / Running / Concluded / Abandoned | — |
| `resultJson` | Result | JSON textarea rows=6 mono | Where uplift, confidence and reasoning are typed |
| `concludedAt` | Concluded | `datetime-local` | Set by hand; nothing sets it automatically when state becomes `concluded` |

**States.** Save failure → red bar; success → silent. No gate on this resource.

**AI surfaces.** None.

**Actions and consequences.** Concluding an experiment is the decision the whole
tab exists for and it carries no confirmation, no audit surface on screen, no
minimum-sample check.

**Mobile.** Web only.

**RTL notes.** The hypothesis heading mirrors correctly (it is prose). The JSON
textarea must stay LTR.

**What is weak today.** The three fields that constitute an experiment —
hypothesis, variants, result — are split across three different presentations:
one as a heading, one invisible, one as a raw textarea. There is no way to see
the two arms side by side, no way to see the metric's actual numbers, and no
link to the creatives that were the variants.

---

## 16. `/signal/budget-moves` — Budget moves (list)

**Route + title.** `/signal/budget-moves`. Tab label **"Budget moves"**
(ar: تحويلات الميزانية). API `GET /v1/signal/budget-moves`. Default sort
`ts desc`.

**Who sees it.** `signal:budget_moves:read` — marketer, lead, signal.admin,
tenant.admin (read). **No create** (the spec declares no `create` and no
`fields`, so no disclosure renders for anyone — the autopilot writes these
rows). Update requires `signal:budget_moves:approve` — **lead and signal.admin
only**; a marketer sees the ledger but can never touch it.

**Purpose.** The autopilot's ledger: every reallocation of money between
campaigns and channels, who authorised it, and how long it can be undone.

**Layout skeleton.**

```
Marketing
… [Budget moves] …

  (no filter bar at all — no search, no filters, no deleted toggle)

┌──────────────────────────────────────────────────────────────────────────────────────┐
│ REASON                    │FROM              │TO                │  AMOUNT │APPROVED BY│REVERSIBLE UNTIL│ WHEN ↕ │
│ Search converts at 2.1x … │signal_campaign:… │signal_campaign:… │AED 8,000│auto       │19 Jul 12:00    │12 Jul  │
│ Duplicated conversion pi… │signal_campaign:… │signal_campaign:… │AED 3,200│auto       │16 Jul 09:00    │09 Jul  │
│ Bound exceeded — release… │signal_campaign:… │signal_campaign:… │AED15,000│user:usr_…│—               │02 Jul  │
│ Autopilot proposes a shi… │signal_campaign:… │signal_campaign:… │AED24,000│pending    │—               │28 Jul  │
└──────────────────────────────────────────────────────────────────────────────────────┘
  6 shown                                                                    [Previous][Next]
```

**Table columns.**

| # | Header (key) | Type | Align | Sortable | Notes |
|---|---|---|---|---|---|
| 1 | Reason (`reason`) | text | start | no | Link into the record. A sentence, truncated at 80 chars |
| 2 | From (`fromRef`) | text | start | no | Raw ref like `signal_campaign:cmp_01J…#meta` — the `#` suffix is the channel |
| 3 | To (`toRef`) | text | start | no | Same shape, e.g. `…#google_search` |
| 4 | Amount (`amountMinor`) | **money**, currency from the sibling `currency` column | **end** | no | Renders as AED with correct minor-unit scaling |
| 5 | Approved by (`approvedBy`) | text | start | no | `.notNull()` in the schema. Seeded values are the literal strings `"auto"`, a `user:usr_…` ref, and — on the one waiting row — the literal string **`"pending"`** |
| 6 | Reversible until (`reversibleUntil`) | datetime | start | no | Always `ts + 7 days` in the seed |
| 7 | When (`ts`) | datetime | start | **yes** | Default sort, descending |

**Filters.** **None.** No search, no filter select, no deleted toggle — this is
the only SIGNAL list with no filter bar at all, so the entire `<Form
method="get">` block is absent and the table starts immediately under the tabs.
There is no way to find only the reversible moves, only the pending ones, or
only the ones over a threshold.

**Forms.** No create form (list). The record page has an edit form — see §17.

**States.** Empty: "Nothing here yet" / "No records match this view. Clear the
filters, or create the first one." — **wrong copy for this screen**, since there
are no filters to clear and nothing can be created here. Loading: none. Denied:
full-page boundary.

**AI surfaces.** None visible. Every seeded move was written by
`system:signal.budget_autopilot`; the pending ones raise approvals whose
`requestedBy` is that same system ref. Because `approvals.tsx` computes
`agentRaised = requestedBy.startsWith("agent:") || Boolean(runs[row.id])`, the
`system:` prefix does not match and **no ✦ appears even on the approvals
screen**. Money moved by an autonomous process is presented as if a person moved
it.

**Actions and consequences.** This screen is a record of **money that has
already moved**. The seeded ledger: AED 8,000 brand→search (auto); AED 3,200
auto and later **reversed** by the growth lead for a duplicated conversion pixel
(the reversal detail is nested inside `evidenceJson.reversal`, never rendered);
AED 2,500 travel remainder; AED 15,000 approved by the growth lead because it
exceeded `autopilotBoundMinor` (AED 10,000); AED 1,800 bing→google; and
**AED 24,000 sitting with `approvedBy: "pending"` and
`evidenceJson.requiresApproval: true`** waiting on `/approvals`. The only human
action available is a reversal, and it is only possible before
`reversibleUntil`. **A reversal is irreversible** — there is no un-reverse.

**Mobile.** Web only.

**RTL notes.** The amount column must stay end-aligned and the currency must
render per the Arabic locale (`AED ٨٬٠٠٠٫٠٠` vs `AED 8,000.00`) — the `Money`
primitive handles this. `fromRef` / `toRef` are LTR identifiers and must be
forced LTR; today they mirror and read as garbage in Arabic.

**What is weak today.** The row whose `approvedBy` is the literal string
`"pending"` is styled exactly like the rows that actually happened — same weight,
same colour, same position in a `ts`-sorted list. AED 24,000 waiting on a human
decision is indistinguishable from AED 8,000 already spent, and there is no link
from that row to the approval that would release it. The seven-day reversal
window is shown as a bare timestamp with no urgency treatment and no countdown;
a move with two hours left looks like one with six days. `fromRef`/`toRef` are
raw composite identifiers — the user cannot see that money moved *from December
brand on Meta to Motor always-on on Google Search* without decoding two id
strings. And `evidenceJson`, which holds the autopilot's actual reasoning and
any reversal record, is not a column at all.

---

## 17. `/signal/budget-moves/:id` — Budget move (record)

**Route + title.** `/signal/budget-moves/<bmv_…>`. `<h1>` is the **reason**
sentence. Subtitle `Budget moves · bmv_01J…`.

**Who sees it.** `signal:budget_moves:read`; edit form requires
`signal:budget_moves:approve` (lead / signal.admin).

**Purpose.** Read one move and, within the window, reverse it.

**Layout skeleton.**

```
Back to list
Search converts at 2.1x the blended rate; brand has surplus
Budget moves · bmv_01J8…

┌─ details ────────────────────────────────────────────────────────────────┐
│ Reason              From               To                                │
│ Search converts a…  signal_campaign:…  signal_campaign:…                 │
│ Amount              Approved by        Reversible until                  │
│ AED 8,000.00        auto               19 Jul 2026 12:00                 │
│ When                Created            Updated                           │
│ 12 Jul 2026 12:00   12 Jul 2026        12 Jul 2026                       │
└──────────────────────────────────────────────────────────────────────────┘

┌─ Edit ───────────────────────────────────────────────────────────────────┐
│ Reversed by                 Reversed                                     │
│ [                       ]   [                    ]                       │
│ [ Save changes ]                                                         │
└──────────────────────────────────────────────────────────────────────────┘
```

**Forms — edit** (`PATCH /v1/signal/budget-moves/<id>`):

| Field | Label | Input | Required | Notes |
|---|---|---|---|---|
| `reversedBy` | Reversed by | **plain text input** | no | The user types an actor ref by hand |
| `reversedAt` | Reversed | `datetime-local` | no | The user types the reversal time by hand |

That is the entire reversal mechanism: two free-text-ish fields and "Save
changes". Nothing validates that `reversedAt` is before `reversibleUntil`.
Nothing populates `reversedBy` with the signed-in actor. Nothing prevents
reversing an already-reversed move.

**States.** Save → gated on `signal.budget_move` with
`amountField: "amountMinor"`; since `amountMinor` is not among the editable
fields the gate sees no amount, so `needsDualControl` compares `0` against the
policy's threshold and dual control resolves to false. The save throws 403 and
renders a red bar reading `signal.budget_move`, with a pending approval created
behind the scenes. Success: silent. Denied: full-page boundary.

**AI surfaces.** None.

**Actions and consequences.** **A reversal is money moving back.** It is gated,
it is irreversible, and the UI presents it as two optional text fields under the
heading "Edit". `reversedBy` and `reversedAt` are also **not columns**, so after
a successful reversal the record page shows no evidence that it happened —
the two fields are write-only from the UI's point of view.

**Mobile.** Web only.

**RTL notes.** As §16: refs and the mono id stay LTR; the money value formats
per locale.

**What is weak today.** The most consequential write in the module is a pair of
blank inputs the user fills in about themselves. It should be a single
**Reverse this move** action with a required reason, the actor and timestamp set
server-side, a visible countdown to `reversibleUntil`, and a hard stop after the
window closes. Everything needed to build that already exists in the schema
(`reversibleUntil`, `evidenceJson.reversal`); only the UI is missing.

---

## 18. `/signal/aeo-pages` — Answer pages (list)

**Route + title.** `/signal/aeo-pages`. Tab label **"Answer pages"**
(ar: صفحات الإجابات). API `GET /v1/signal/aeo-pages`. AEO = answer-engine
optimisation: owned pages written to be cited by answer engines.

**Who sees it.** `signal:aeo:read`. Create / update / **delete** all require
`signal:aeo:write` (marketer, lead, signal.admin). This is the **only** SIGNAL
tab that declares `remove`.

**Purpose.** The tenant's owned answer content, its freshness and whether its
claims are sourced.

**Layout skeleton.**

```
Marketing
… [Answer pages] …

[ Status: All ▾ ] [ Records shown: Live records ▾ ] [ Apply ]

  + New — Answer pages

┌────────────────────────────────────────────────────────────────────────────────┐
│ QUERY CLUSTER                    │LANG│CONTENT                │STATUS   │LAST VERIFIED│UPDATED ↕│
│ best car insurance dubai         │ en │signal/aeo/best-car-…  │[Publis] │20 Jul       │20 Jul   │
│ تأمين السيارات في دبي            │ ar │signal/aeo/ar-motor-…  │[Publis] │20 Jul       │20 Jul   │
│ car insurance renewal grace per… │ en │signal/aeo/renewal-g…  │[Stale]  │02 Apr       │02 Apr   │
└────────────────────────────────────────────────────────────────────────────────┘
  6 shown                                                              [Previous][Next]
```

**Table columns.**

| # | Header (key) | Type | Align | Sortable | Notes |
|---|---|---|---|---|---|
| 1 | Query cluster (`queryCluster`) | text | start | no | Link into the record. The search intent, in English or Arabic |
| 2 | Language (`locale`) | text | start | no | `en` / `ar` |
| 3 | Content (`contentRef`) | text | start | no | Path string |
| 4 | Status (`status`) | text, **badge** | start | no | Draft (grey) / Published (grey) / Stale (grey) / Retired (grey) — **all four are the same grey** |
| 5 | Last verified (`freshness`) | datetime | start | no | — |
| 6 | Updated (`updatedAt`) | datetime | start | **yes** | — |

**Filters.** Status (All / Draft / Published / Stale / Retired) **and** the
deleted-records select, which appears because `canRestore` is true whenever the
actor holds `tab.remove`:

```
[ Records shown: Live records ▾ ]     options: "Live records" | "Deleted records"
```

**This select is broken.** `signal_aeo_pages` has **no `deletedAt` column**, so
`crud.ts` throws `badRequest("signal/aeo-pages has no soft delete")` on
`?deleted=1`. Selecting "Deleted records" and pressing Apply produces the
full-page error boundary: **"This did not load" / "The page could not be built.
Nothing was saved, and you can try again."** The `canRestore` heuristic infers
soft-deletability from the `remove` permission, which is wrong for this table.

**Forms — create.**

| Field | Label | Input | Required |
|---|---|---|---|
| `queryCluster` | Query cluster | text | **yes** |
| `contentRef` | Content | text | **yes** |
| `locale` | Language | text | no |

**States.** Empty / filtered-empty / loading / error as §8, plus the
deleted-view banner (`role="status"`, amber `border-warning/40 bg-warning/10`)
which **can never legitimately appear here** because the query that would show
it always 400s first.

**AI surfaces.** None, despite this being the most obviously AI-adjacent surface
in the module (content written to be cited by answer engines, with a machine
citation check).

**Actions and consequences.** Create, update and **delete**. The delete button
sits on the record page and is confirmed with `common.deleteConfirm`:

> "Delete this record? It is retained for audit and can be restored by an
> administrator."

**That sentence is false here.** With no `deletedAt` column, `crud.ts` executes
a real `DELETE`. The row is gone permanently, and the copy promised otherwise.
This is the most serious correctness bug in the SIGNAL UI.

**Mobile.** Web only.

**RTL notes.** `queryCluster` is genuine user-facing content in both scripts —
the seeded list mixes `best car insurance dubai` and `تأمين السيارات في دبي` in
the **same column**, so this cell needs per-cell direction handling
(`dir="auto"`), which it does not have today. In an Arabic UI the English
clusters mis-render and vice versa. `contentRef` stays LTR.

**What is weak today.** `citedByJson` — which answer engines actually cite this
page (the seeded top page is cited by ChatGPT and Perplexity) — is **not a
column and not in the editable list**, so the one metric that says whether the
whole AEO effort works is invisible. `citationsCheckJson` is editable but not
displayed as a column, and its content is exactly the claim-sourcing audit that
matters: the top page reads *9 claims / 9 sourced*; the stale page reads *7
claims / 6 sourced / 1 unverified with a note*. That single unverified claim on
a **published** page is the thing a compliance officer would want to see, and it
appears nowhere. Four statuses share one grey.

---

## 19. `/signal/aeo-pages/:id` — Answer page (record)

**Route + title.** `/signal/aeo-pages/<aeo_…>`. `<h1>` is the **query cluster**.
Subtitle `Answer pages · aeo_01J…`.

**Who sees it.** `signal:aeo:read`; edit and delete need `signal:aeo:write`.

**Purpose.** Publish, retire or re-verify one answer page.

**Layout skeleton.**

```
Back to list
car insurance renewal grace period uae
Answer pages · aeo_01J8…

┌─ details ────────────────────────────────────────────────────────────────┐
│ Query cluster       Language          Content                            │
│ car insurance ren…  en                signal/aeo/renewal-grace/en.mdx    │
│ Status              Last verified     Updated                            │
│ [Stale]             02 Apr 2026       02 Apr 2026                        │
│ Created                                                                  │
│ 14 Jan 2026                                                              │
└──────────────────────────────────────────────────────────────────────────┘

┌─ Edit ───────────────────────────────────────────────────────────────────┐
│ Status                      Content                                      │
│ [ Stale ▾ ]                 [ signal/aeo/renewal-grace/en.mdx        ]   │
│ Citation check                                                           │
│ ┌────────────────────────────┐                                           │
│ │ {"claims":7,"sourced":6,"u │                                           │
│ │ nverified":[{"claim":"…"}] │                                           │
│ └────────────────────────────┘                                           │
│ [ Save changes ]                                                         │
└──────────────────────────────────────────────────────────────────────────┘
────────────────────────────────────────────────────────────────────────────
[ Delete ]                                                    (danger, sm)
```

**Forms — edit.**

| Field | Label | Input | Notes |
|---|---|---|---|
| `status` | Status | Select Draft / Published / Stale / Retired | — |
| `contentRef` | Content | text | Path |
| `citationsCheckJson` | Citation check | JSON textarea rows=6 mono | Editable but not shown in the details block above |

**Delete.** `<Button variant="danger" size="sm">Delete</Button>` in its own form
below a `border-t` divider, guarded by a native `confirm()` with the
`common.deleteConfirm` text. On success it redirects to
`/signal/aeo-pages`. As established in §18, the deletion is **permanent** and
the confirm copy misstates it.

**States.** Save failure → red bar; success → silent. Delete failure → red bar.

**AI surfaces.** None.

**Actions and consequences.** Publishing is ungated (no approval policy on this
resource). Deleting is permanent and irreversible.

**Mobile.** Web only.

**RTL notes.** The `<h1>` may be Arabic or English depending on the row — needs
`dir="auto"`. The JSON textarea stays LTR.

**What is weak today.** Beyond the delete bug: the "Stale" status is set by hand
with no relationship to `freshness`, so a page can read "Published / last
verified four months ago" with nothing prompting a re-check. The unverified
claim inside `citationsCheckJson` is the reason the page is stale and it is only
legible by reading raw JSON in the edit textarea.

---

## 20. `/signal/attribution-events` — Attribution (list)

**Route + title.** `/signal/attribution-events`. Tab label **"Attribution"**
(ar: الإسناد). API `GET /v1/signal/attribution-events`. Default sort `ts desc`.

**Who sees it.** `signal:attribution:read` — marketer, lead, signal.admin,
tenant.admin (read), **`north.exec`, `north.analyst`**. Registered
`immutable: true` in the API: **no create, no update, no delete for anyone.**

**Purpose.** Every recorded touch on the path to a sale, as it landed.

**Layout skeleton.**

```
Marketing
… [Attribution] …            (for north roles: only two tabs render — Attribution, Spend)

[ Touch: All ▾ ] [ Apply ]

┌────────────────────────────────────────────────────────────────────────────────┐
│ SUBJECT                │CUSTOMER   │TOUCH        │CHANNEL       │CAMPAIGN │  VALUE│ WHEN ↕│
│ signal_creative:crv_…  │—          │[Impression] │google_search │cmp_01J… │      —│04 Jul │
│ signal_creative:crv_…  │—          │[Click]      │google_search │cmp_01J… │      —│04 Jul │
│ signal_aeo_page:aeo_…  │—          │[Visit]      │answer_engine │—        │      —│05 Jul │
│ dist_quote_request:q…  │cus_01J8…  │[Lead]       │google_search │cmp_01J… │      —│06 Jul │
│ axis_case:cas_01J8…    │cus_01J8…  │[Bind]       │google_search │cmp_01J… │AED4,480│08 Jul│
└────────────────────────────────────────────────────────────────────────────────┘
  8 shown                                                              [Previous][Next]
```

**Table columns.**

| # | Header (key) | Type | Align | Sortable | Notes |
|---|---|---|---|---|---|
| 1 | Subject (`subjectRef`) | text | start | no | Link into the record. A cross-module ref: `signal_creative:…`, `signal_aeo_page:…`, `dist_quote_request:…`, `axis_case:…`. **None of these are links to the referenced record** |
| 2 | Customer (`customerId`) | text | start | no | Raw id or "—" for anonymous pre-identification touches |
| 3 | Touch (`touchType`) | text, **badge** | start | no | Impression / Click / Visit / Lead / Bind — **all five neutral grey** |
| 4 | Channel (`channel`) | text | start | no | `google_search`, `bing_search`, `meta`, `email`, `answer_engine` |
| 5 | Campaign (`campaignId`) | text | start | no | Raw id; empty on the answer-engine visit |
| 6 | Value (`valueMinor`) | **money** from sibling `currency` | **end** | no | Only populated on `bind` |
| 7 | When (`ts`) | datetime | start | **yes** | Default sort, descending |

**Filter.** Touch: All / Impression / Click / Visit / Lead / Bind.

**Forms.** None — immutable resource, no create disclosure, no edit form on the
record page.

**States.** As §8; the empty-state copy again invites the user to "create the
first one" on a resource nobody can create.

**AI surfaces.** None.

**Actions and consequences.** Read only.

**Mobile.** Web only.

**RTL notes.** Every value in this table except the money column is an ASCII
identifier or snake_case token and must be forced LTR. The money column stays
end-aligned and locale-formatted.

**What is weak today.** The seeded data contains a **complete stitched journey**:
`anonId: "an_2f7c91b4"` sees an impression, clicks, visits, then visits an
answer page, is stitched to an identified customer, becomes a lead against a
real `dist_quote_request`, and binds for **AED 4,480**, pointing at a real
`axis_case`. That is the single most compelling story in the module's data, and
the UI presents it as seven unrelated grey rows sorted by time, mixed in with a
second journey (`an_84b0d2e1`) that stops at the visit. `anonId` — the column
that groups a journey — **is not displayed at all**. There is no grouping, no
funnel, no journey view, no filter by customer or by campaign, and the refs do
not link anywhere. An analyst cannot answer "what did this campaign produce"
without exporting the table.

---

## 21. `/signal/attribution-events/:id` — Attribution event (record)

**Route + title.** `/signal/attribution-events/<atr_…>`. `<h1>` is the
**subjectRef** string. Subtitle `Attribution · atr_01J…`.

**Who sees it.** `signal:attribution:read` (includes north roles).

**Purpose.** One touch, in full.

**Layout skeleton.**

```
Back to list
axis_case:cas_01J8…
Attribution · atr_01J8…

┌─ details ────────────────────────────────────────────────────────────────┐
│ Subject             Customer          Touch                              │
│ axis_case:cas_01J…  cus_01J8…         [Bind]                             │
│ Channel             Campaign          Value                              │
│ google_search       cmp_01J8…         AED 4,480.00                       │
│ When                Created                                              │
│ 08 Jul 2026 14:22   08 Jul 2026 14:22                                    │
└──────────────────────────────────────────────────────────────────────────┘
```

Nothing below the details block: no actions, no edit form, no delete.

**Every element.** Back link, heading, subtitle, one `<dl>` of seven columns
plus Created (and Updated if present). That is the whole screen.

**States.** Loading none; not-found / denied → full-page boundary.

**AI surfaces.** None.

**Actions and consequences.** None. Immutable.

**Mobile.** Web only.

**RTL notes.** Force LTR on every identifier; money formats per locale.

**What is weak today.** A read-only page with seven values and no links is
strictly worse than the row it came from — the user loses the surrounding
journey by opening it. `anonId` and `creativeId` exist on the row and are not
shown, so the record cannot even answer "which creative was this?".

---

## 22. `/signal/spend` and `/signal/spend/:id` — Spend

**Route + title.** `/signal/spend` and `/signal/spend/<spd_…>`. Tab label
**"Spend"** (ar: الإنفاق). API `GET /v1/signal/spend`. Default sort `day desc`.

**Who sees it.** `signal:spend:read` — marketer, lead, signal.admin,
tenant.admin (read), **`north.exec`, `north.analyst`**. No create, no update, no
delete anywhere.

**Purpose.** Actual money spent per channel per day, as reported by the ad
platforms.

**Layout skeleton (list).**

```
Marketing
… [Spend]

[ Source: All ▾ ] [ Apply ]

┌──────────────────────────────────────────────────────────────────────────────────────┐
│ DAY ↕      │CHANNEL      │CAMPAIGN │    AMOUNT│IMPRESSIONS│ CLICKS│CONVERSIONS│SOURCE  │ WHEN ↕│
│ 2026-01-05 │google_search│cmp_01J… │AED3,412.0│    182,400│  4,102│         38│[API]   │06 Jan │
│ 2026-01-04 │meta         │cmp_01J… │AED1,180.0│     96,300│  1,244│          9│[API]   │05 Jan │
│ 2026-01-01 │google_search│cmp_01J… │AED2,905.0│    150,110│  3,388│         31│[Import]│30 Jul │
└──────────────────────────────────────────────────────────────────────────────────────┘
  12 shown                                                                  [Previous][Next]
```

**Table columns.**

| # | Header (key) | Type | Align | Sortable | Notes |
|---|---|---|---|---|---|
| 1 | Day (`day`) | **text** | start | **yes** | An ISO date **string**, not a date type — so it renders raw as `2026-01-05` regardless of locale, and never localises |
| 2 | Channel (`channel`) | text | start | no | `google_search` / `bing_search` / `meta` / `email` |
| 3 | Campaign (`campaignId`) | text | start | no | Raw id, no link |
| 4 | Amount (`amountMinor`) | **money** from sibling `currency` | **end** | no | — |
| 5 | Impressions (`impressions`) | number | **end** | no | — |
| 6 | Clicks (`clicks`) | number | **end** | no | — |
| 7 | Conversions (`conversions`) | number | **end** | no | — |
| 8 | Source (`source`) | text, **badge** | start | no | API / Import / (manual) — all grey |
| 9 | When (`ts`) | datetime | start | **yes** | When the import landed, not the day it covers |

`signal_spend` carries `uniqueIndex(tenantId, campaignId, channel, day)` and has
**no `createdAt`/`updatedAt`**, so the record page's `<dl>` shows the nine
columns and nothing else.

**Filter.** Source: All / Manual / API / Import.

**Forms.** None anywhere.

**States.** As §8, including the inapplicable "create the first one" copy.

**AI surfaces.** None.

**Actions and consequences.** Read only.

**Record page.** `<h1>` is the **day string** (`2026-01-05`) — the least
identifying heading in the module, since several rows share a day. Subtitle
`Spend · spd_01J…`. A `<dl>` of the nine columns. No form, no actions.

**Mobile.** Web only.

**RTL notes.** All four numeric columns must stay end-aligned and LTR-numeric;
channel tokens and campaign ids force LTR; the `day` string is ISO and stays
LTR. Column order mirrors.

**What is weak today.** No totals row, no month-to-date, no comparison against
the campaign's `periodCapMinor`, no derived CPC or CPA even though clicks,
conversions and amount are all right there. The `day` vs `ts` distinction — the
whole reason both columns exist, per the spec's own comment — is invisible: the
seeded New Year's Day row was imported **twelve hours ago** (source `import`)
while every other row landed at 03:00 the morning after its day, and nothing on
screen flags that one figure was restated seven months late. The only difference
is a grey "Import" badge next to eleven grey "API" badges.

---

## 23. `/approvals` — where SIGNAL's gated actions land

Not a SIGNAL route, but SIGNAL's approvals surface here and no SIGNAL screen
links to it. Route `/approvals` (`apps/web/app/routes/approvals.tsx`), inside
the same workspace layout. This screen owns its **own** en+ar label table.

**Who sees it.** Pending items come from `GET /v1/me/inbox` — filtered to
policies whose `decide` permission the actor holds, so `signal.lead` sees
budget-move and creative-publish requests, and `tenant.compliance` sees
creative-publish requests. Decided history comes from
`GET /v1/core/approvals?decision=…&sort=requestedAt&order=desc&limit=25` and
requires `core:approvals:read`; without it the section shows *"Decisions across
the tenant are not yours to read, so this list stays empty."*

**Copy in use** (verbatim):

- Title: **"Approvals"**
- Intro: *"Actions that need a person before they take effect. A decision is
  final and is written to the audit log."*
- Section heading: *"Why this needs approval"*
- Dual control on: *"Two people: whoever raised this may not decide it."*
  Off: *"One approver."*
- Reason hint: *"Required to reject, kept with the decision in the audit log."*
- Reject confirm: *"Reject this request? A decision cannot be undone."*
- Empty pending: *"Nothing is waiting for your decision."*
- After approving (`role="status"`): *"Approved. The action may now proceed."*

**Layout skeleton.**

```
Approvals
Actions that need a person before they take effect. A decision is final and is
written to the audit log.

┌─ pending item ───────────────────────────────────────────────────────────┐
│ signal.budget_move                              [subject link]           │
│ Why this needs approval                                                  │
│   Amount            AED 24,000.00                                        │
│   From              signal_campaign:cmp_…#meta                           │
│   To                signal_campaign:cmp_…#google_search                  │
│   Bound             AED 10,000.00                                        │
│   One approver.                                                          │
│ [ Approve ]   Reason [                    ] [ Reject ]                   │
└──────────────────────────────────────────────────────────────────────────┘
```

**The "why" list.** `OWN_FIELD = {amountMinor, currency, dualControl,
expiresAt}` are rendered specially; **every other key in `contextJson` is
listed**. The seeded SIGNAL approvals carry
`{amountMinor, currency: "AED", dualControl: false, fromRef, toRef, boundMinor:
1_000_000}`, so the reviewer does see the from/to refs and the autopilot bound —
as raw refs.

**The ✦ marker.** `agentRaised = requestedBy.startsWith("agent:") ||
Boolean(runs[row.id])`. The seeded SIGNAL approvals are raised by
`system:signal.budget_autopilot`, which starts with `system:`, not `agent:`, and
has no linked `ai_run`. **So no ✦ appears on them.** An autonomous budget
reallocation is presented with no indication that a machine proposed it.

**Broken subject link.** `subjectOf("budget-moves:<id>")` resolves the resource
against `tab.api.endsWith("/" + resource)` and builds
`` `/${workspace.path}/${tab.key}/…` `` — but `workspace.path` is already
`"/signal"`, so the produced href is **`//signal/budget-moves/<id>`** with a
double slash, which the browser reads as a protocol-relative URL to the host
`signal`. The link out of an approval into the money it concerns does not work.

**What is weak today.** SIGNAL never links *to* this screen: the user who hits
the red `signal.creative_publish` bar has no path forward except knowing that
`/approvals` exists. And this screen's link back to SIGNAL is broken. The two
halves of every gated action are disconnected in both directions.

---

## 24. Mobile (Expo app)

`apps/mobile/src/nav.ts` maps `"/signal": "signal/campaigns"`. That is the
entire SIGNAL mobile surface.

**List** (`app/m/[nav]/index.tsx`): a `FlatList` fed by
`listRows(token, "signal/campaigns")` → `GET /v1/signal/campaigns?limit=50`.
Each row shows a title (the `name`) and a subtitle (the `state` value, raw). A
`nav.back` button at the top. While loading: the text `app.loading` "Loading".
On error: a `Notice` with the message and the request id.

**Record** (`app/m/[nav]/[id].tsx`): every field of the row, verbatim, in
declaration order, with object values `JSON.stringify`'d with two-space indent —
so `budgetJson` and `channelsJson` appear as multi-line raw JSON. **No edit, no
actions, no approvals, no delete.**

Everything else in SIGNAL — audiences, creatives, experiments, budget moves,
answer pages, attribution, spend — is **web only**. A growth lead cannot approve
a budget move from a phone; the approvals screen is web only too.

---

## 25. RTL and i18n rules for the whole module

- All labels come from i18n keys. Shared chrome uses `apps/web/app/i18n/en.ts`
  (`common.*`, `nav.*`, `error.*`). **Module vocabulary lives in
  `apps/web/app/modules/signal.ts`'s own `labels` table**, en + ar, per
  CLAUDE.md §14 — so the domain pack can rename "Campaigns" without touching
  code. A designer must not introduce hard-coded English strings, and must not
  introduce industry nouns ("policy", "premium", "insurer") into SIGNAL chrome.
- Layout must use logical properties only (`margin-inline-start`, `text-start`,
  `text-end`). The existing code already does.
- **What mirrors:** the sidebar, the tab strip, the filter bar, table column
  order, the details grid, form grids, button rows, the pager.
- **What must not mirror** (and today wrongly does, because nothing sets
  `dir="ltr"`): every `*Ref` and `*Id` value (`ownerRef`, `fromRef`, `toRef`,
  `subjectRef`, `campaignId`, `audienceId`, `customerId`), every `contentRef`
  file path, every mono record id in a subtitle, every JSON textarea and JSON
  cell, `locale` codes, `channel` and `source` tokens, the ISO `day` string, and
  metric keys like `quote_start_rate`.
- **What needs `dir="auto"` per value:** `queryCluster` on Answer pages (the
  seeded list genuinely mixes English and Arabic in one column) and any future
  rendered creative content.
- Numbers use `tabular-nums`; money renders through the `Money` primitive, which
  **refuses to render without a currency** and degrades to a bare number rather
  than guessing.
- Arabic labels already exist for all 8 tabs, all 55 column names and all 26
  enum values — see the `ar` block in `apps/web/app/modules/signal.ts`. Any new
  label needs both.

---

## 26. Accessibility notes (current state, to preserve)

- Tab strip is `<nav aria-label="Sections">` + `<ul>` + `<Link aria-current="page">`.
- Filter bar is `<Form method="get">`, with `role="search"` only where a search
  input exists (Campaigns). Every `Select` carries an `aria-label` from the
  label table.
- Tables have an `sr-only` `<caption>` reading `"Marketing — {Tab}"`; sortable
  headers are real `<button>`s with `aria-sort`.
- Every row's link target is the **first cell**, not the whole row — one
  predictable, keyboard-reachable target per row. Keep this.
- Errors use `role="alert"`; the deleted-view banner and the post-action
  confirmation use `role="status"`.
- Focus rings are `outline-2 outline-offset-2 outline-accent` throughout.
- Deletion confirms via native `confirm()`. Not a design pattern to keep, but do
  not replace it with something less blocking.

---

## 27. Summary of what is weak, in priority order

1. **The approval gate is invisible.** A blocked save shows one red line reading
   `signal.creative_publish` or `signal.budget_move`. No explanation, no link,
   no mention that a request was raised. Fix: an inline panel naming the policy
   in plain language, the threshold, who can decide, and a link to `/approvals`.
2. **`/signal/aeo-pages` delete is permanent while the confirm text promises
   restoration**, and the "Deleted records" filter it offers always errors.
3. **Money is invisible where money is decided.** Campaigns show no budget, no
   spend to date, no cap. Budget moves show refs instead of names. Spend has no
   totals.
4. **Badge tones are meaningless.** `blocked` = `pending` (amber);
   `passed` = `flagged` = `retired` = `bind` = `impression` (grey). Compliance
   states and touch types need distinct, semantically correct tones.
5. **JSON textareas for `budgetJson`, `channelsJson`, `definitionJson`,
   `variantsJson`, `resultJson`, `complianceNotesJson`, `citationsCheckJson`.**
   Seven structured objects edited as raw text by non-engineers.
6. **No ✦ anywhere in SIGNAL**, contrary to CLAUDE.md §11: AI-generated
   creatives carry only a grey "AI" badge, `aiAuditId` is never surfaced, and
   autopilot-raised approvals do not register as agent-raised.
7. **The likeness/consent record has no home** beyond a truncated JSON key
   (§2, §13).
8. **The attribution journey is shredded** into ungrouped rows; `anonId`, the
   column that stitches them, is not displayed.
9. **Cross-module refs are never links**: `campaignId`, `audienceId`,
   `subjectRef`, `ownerRef`, `customerId` are all dead text.
10. **Written-but-never-rendered data**: `guardrailChecksJson` (frequency caps,
    quiet hours, suppression applied, banned-claims pass), `citedByJson`,
    `evidenceJson`, `aiAuditId`, `anonId`, `creativeId`.
11. **Reversal of a budget move is two blank inputs** the user fills in about
    themselves, with no window enforcement.
12. **Compliance officers and executives cannot reach the screens they have
    permission for** — the nav entry is gated on `signal:campaigns:read`.
13. **No save confirmation anywhere.** A successful PATCH renders the same page
    with no message.
14. **Empty-state copy invites creation on read-only resources** (budget moves,
    attribution, spend).
15. **`/signal` has no overview** — it is the audiences list wearing a shorter
    URL.
