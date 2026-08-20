# COMPLIANCE — UI design brief

Screen-by-screen description of what the COMPLIANCE workspace **actually renders
today**, for a designer with no repo access. Everything below was read out of the
code; nothing is aspirational. Where a screen is thin, the "Weak today" note says
so instead of inventing the fix.

**Ground rule inherited from the codebase:** this document names no authority, no
article, no penalty and no statutory deadline. Compliance copy in this product
comes from `docs/12` only, and `docs/12` states none of those things. Where the
product holds a target — the subject-request service target, the retention period
— it is stored as **tenant policy** and is designed as a tenant setting. Say
"this tenant's 30-day service target", never "the legal deadline".

---

## 0. Orientation (read this first)

1. COMPLIANCE is the workspace where regulated processes become **provable**:
   subject requests, disclosures shown, screenings performed, records deleted,
   deletions frozen, evidence handed over, incidents, rulepack outcomes, and the
   thresholds all of that runs against.
2. It is one workspace at `/compliance` with **ten resource tabs** and **one
   bespoke screen** with three variants at `/compliance/run/:kind`. Two screens
   outside the workspace do compliance work and are described here because
   nothing else describes them: the **approvals queue** at `/approvals`, where
   the erasure and legal-hold-release decisions are actually taken (§8), and the
   **public subject-request form** at `/portal/:tenantSlug/privacy`, which is how
   a data subject starts their own request without an account (§9). Two further
   screens the compliance officer holds permissions for — the AI audit log on the
   AI console and the platform audit trail in ADMIN — are summarised in §10 and
   described in full in `docs/ui/admin.md`.
3. Nine of the ten tabs are lists of things that already happened. Half are
   read-only in the API, because an audit trail you can edit is not an audit
   trail.
4. Three of those tabs — screenings, evidence bundles, retention runs — cannot be
   created by a form at all. They are the output of a run, and the run screen is
   the only way to produce one.
5. **Who lives here:** one persona, the compliance officer (role key
   `tenant.compliance`), who holds `compliance:*:*` and effectively owns every
   screen in this brief.
6. **Who visits:** `tenant.admin` reads everything and can change nothing;
   `finance.controller` can read and build evidence bundles and nothing else.
   The other eleven named roles hold no `compliance:*` permission at all and
   never see the workspace.
7. **Who hits the gate without ever opening this workspace:** everyone. A legal
   hold placed here stops a retention purge; a disclosure logged here is written
   by the surface that showed it; an incident opened here can pause agents.
8. **The three screens that matter most:** `/compliance/run/retention` (the only
   screen in the product that permanently deletes customer data),
   `/compliance/dsar-requests` (the officer's daily queue, and the only one with
   a clock on it), and `/compliance/run/screening` (which today must argue
   against its own result, because no screening provider is connected).
9. **The uncomfortable truths this design must carry, not hide:** the screening
   provider is a stub, evidence bundle downloads 404 for every seeded row, and
   the permanent-delete button has no approval behind it.
10. **No screen under `/compliance` renders AI.** No ghost text, no suggestion
    row, no ✦ on any of the ten tabs or the three run screens. But the sentence
    "there is no AI in compliance" is false at the workspace boundary: the
    approvals queue where compliance's own dual-control decisions land (§8)
    carries the ✦ marker on every agent-raised request, a "why this needs
    approval" panel and a link into the AI run behind it. §10 says where the
    absence is right and where it is now a gap.

---

## 1. Route inventory — everything that exists

| # | URL | File that renders it | Kind |
|---|-----|----------------------|------|
| 1 | `/compliance/run/screening` | `routes/compliance-run.tsx` | bespoke |
| 2 | `/compliance/run/evidence` | `routes/compliance-run.tsx` | bespoke |
| 3 | `/compliance/run/retention` | `routes/compliance-run.tsx` | bespoke |
| 4 | `/compliance` | `routes/module.tsx` | generic list, redirects to the first tab the actor can read |
| 5 | `/compliance/<tab>` ×10 | `routes/module.tsx` | generic list |
| 6 | `/compliance/<tab>/<id>` ×10 | `routes/record.tsx` | generic record |

Two adjacent routes, outside `/compliance` but part of the same job:

| # | URL | File that renders it | Kind |
|---|-----|----------------------|------|
| 7 | `/approvals` | `routes/approvals.tsx` | bespoke, workspace-wide (§8) |
| 8 | `/portal/:tenantSlug/privacy` | `routes/portal.$tenantSlug.privacy.tsx` | public, no session (§9) |

`/approvals` sits inside the signed-in shell but belongs to no workspace: it is
the queue of every pending approval in the product, compliance's two among them.
`/portal/:tenantSlug/privacy` is outside the shell entirely — no sidebar, no
account, a Turnstile challenge instead of a login.

The ten tabs, in the order the tab strip renders them:

`dsar-requests` · `erasure-log` · `disclosures` · `screenings` ·
`retention-runs` · `legal-holds` · `evidence-bundles` · `incidents` ·
`rulepack-applications` · `policy-thresholds`

Nav entry: label `nav.compliance` = **"Compliance"** (ar: الامتثال), icon key
`scale`, gated on `compliance:dsar:read`. `/compliance/run/:kind` is deliberately
absent from the nav — it is reached from the link strip at the top of the
workspace.

**Not in this workspace, but part of compliance:** the **consent ledger** is a
CORE resource surfaced in the ADMIN workspace at `/admin/consents`
(`core:consents:read` to read, `core:consents:create` to record, no update — a
migrated consent is a new row, never an edit). Do not design a consents tab into
`/compliance`; it does not exist here.

---

## 2. Who sees what

### 2.1 The permissions in play

| Permission | Grants |
|---|---|
| `compliance:dsar:read` | the nav entry, `dsar-requests`, `erasure-log` |
| `compliance:dsar:create` | the create panel on `dsar-requests` |
| `compliance:dsar:fulfil` | the edit form on a subject-request record |
| `compliance:disclosures:read` | `disclosures` |
| `compliance:screenings:read` | `screenings` |
| `compliance:screenings:run` | the "Run a screening" link and `/compliance/run/screening` |
| `compliance:retention:read` | `retention-runs` |
| `compliance:retention:run` | the "Run retention" link, `/compliance/run/retention`, **and the purge** |
| `compliance:legal_holds:read` | `legal-holds` |
| `compliance:legal_holds:write` | create, edit and release a hold |
| `compliance:evidence:read` | `evidence-bundles` and the bundle download |
| `compliance:evidence:export` | the "Export evidence" link and `/compliance/run/evidence` |
| `compliance:incidents:read` / `:write` | `incidents` list / create-edit-delete |
| `compliance:rulepacks:read` | `rulepack-applications` |
| `compliance:thresholds:read` / `:write` | `policy-thresholds` list / create-edit-delete |
| `compliance:erasure:execute` | decides the `compliance.erasure` approval — on `/approvals` (§8), not in this workspace |
| `compliance:rulepacks:apply` | held by the rule engine, not by a screen |

Two more permissions govern `/approvals`, and neither is a `compliance:*`:

| Permission | Grants |
|---|---|
| *(none)* | the **pending** half of `/approvals`. It reads `GET /v1/me/inbox`, the only endpoint that answers "what is waiting on *this* actor", so anyone with a session sees their own queue |
| `core:approvals:read` | the **decided** half — the Approved and Rejected views. Without it those two views render as if empty |
| `ai:runs:read` | the ✦ enrichment on a queue card: the agent badge and the "Open the run" link. Without it the card still renders, minus the AI provenance |

The permission that *decides* a given request is the one on its approval policy —
`compliance:erasure:execute` for an erasure, `compliance:legal_holds:write` for a
hold release. A request never appears in an actor's pending queue unless they
hold it.

### 2.2 The fourteen named roles against this workspace

| Role key | What they get |
|---|---|
| **tenant.compliance** | `compliance:*:*` — every tab, every run, every write. The only complete persona. |
| **tenant.admin** | `compliance:*:read` — all ten tabs, read-only. No create panel, no edit form, no delete, and **none of the three run links** (they are gated on `:run`/`:export`). |
| **finance.controller** | `compliance:evidence:read` + `compliance:evidence:export` only. No nav entry (that needs `compliance:dsar:read`). Typing `/compliance` lands on a 403 for `dsar-requests`, which the list loader catches and redirects to the first readable tab: `/compliance/evidence-bundles`. They see one tab, no tab strip (the strip only renders when more than one tab is visible), and one link: "Export evidence". |
| **finance.analyst** | nothing |
| **north.exec** | nothing |
| **north.analyst** | nothing |
| **axis.lead** | nothing |
| **axis.agent** | nothing |
| **orbit.agent** | nothing |
| **orbit.partners** | nothing |
| **orbit.retention** | nothing |
| **scout.lead** | nothing |
| **signal.lead** | nothing |
| **dev.admin** | nothing |

(`platform.admin` holds `*:*:*` and sees everything; it is not one of the
fourteen.)

### 2.3 What a denied user actually sees

The product's rule is **withholding is absence, not a disabled button.** Design
to it consistently:

- **No `compliance:dsar:read`** → the "Compliance" item is not in the sidebar.
  There is no greyed item, no lock icon, no tooltip.
- **A tab they cannot read** → not in the tab strip. If they hold only one
  readable tab, the tab strip does not render at all.
- **A run they cannot start** → the link is not in the "Reports and tools" strip.
- **A create/edit/delete they cannot perform** → the panel, the form and the
  button are absent, not disabled.
- **Direct URL to a run they cannot start** (`/compliance/run/retention` with no
  `compliance:retention:run`) → the header, the intro paragraph and then an
  `EmptyState`:
  - title: **"You cannot start this run"**
  - body: **"It needs a permission your role does not hold. An administrator can grant it."**
  - No form is rendered. There is no request-access affordance, and it is a dead
    end by design.
- **Direct URL to a list/record they cannot read** → the API 403s and the route
  error boundary renders `error.title` **"This did not load"**. The one exception
  is `/compliance` with no tab: a 403 there redirects to the first tab the actor
  can read.
- **Expired session** → 401, and the workspace layout redirects to `/login`.

---

## 3. The chassis every screen sits in

### 3.1 Shell

The shell is banded: a top bar, a day strip, then a split of rail and canvas.
Nothing in the chrome scrolls — the root does not scroll, only the canvas does,
so the bands hold still without being sticky.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ✧ Brand · Tenant   [⌘K search]        [posture] [theme] [✦] [KH tenant.comp ▾]│ --chrome-top 50px
├──────────────────────────────────────────────────────────────────────────────┤
│ Meridian — today's strip, scrubbable                                          │ day strip
├───────────────┬──────────────────────────────────────────────────────────────┤
│ ◔ SHIFT       │ ▁ 2px module hue                                             │
│   3 of 7      │ Compliance › Subject requests            (crumbs, below       │
│   4 left      │                                           module level only)  │
│   • Erasure   │                                                              │
│   • Hold rel. │                <main id="workspace">                          │
│ ── nav ────── │        max-w-[100rem], p-[--gutter-canvas]                    │
│ • Home        │                                                              │
│ • Ops         │                                                              │
│ ● Compliance  │                                                              │
│ • Admin       │                                                              │
│ --rail-width  │                                                              │
└───────────────┴──────────────────────────────────────────────────────────────┘
```

- **The frame is tokenised, not hand-numbered.** `--chrome-top` (50px),
  `--chrome-module` (38px, the floor of the small-screen nav strip),
  `--rail-width` (196px, widening to 252px from 1240px up), `--gutter` /
  `--gutter-canvas` / `--gutter-rail`, `--stack-gap` (16px between canvas
  blocks) and `--measure-canvas` (100rem, where the canvas stops widening).
  Design in those terms; a screen never sets its own frame numbers.
- **Top bar.** Tenant logo or mark plus the product name (`brand.name`, falling
  back to the tenant name — **never hard-code "LYRA"**); the tenant being served
  beside it when that is a different word; a ⌘K search palette whose destinations
  are the nav's own; then, pushed to the end: posture chips, a theme toggle, the
  companion-rail toggle (a ✦, shown only to actors who may have one), and an
  account pill carrying initials in the tenant accent and the **role key** — not
  the name — beside them. The name is in the tooltip and the menu label.
- **Meridian** is the day strip under the bar: today, before the work. It can be
  scrubbed back, which re-reads the shift and the counts as of that moment. It
  is chrome, not canvas.
- **The shift rail sits above the destinations, not instead of them.** A ring
  says how much of today is behind this actor ("3 of 7 cleared", "4 left"), and
  under it the pending approvals waiting on them, titled by their approval policy
  — the same words `/approvals` uses for the same request (§8). It renders
  nothing at all when the inbox could not be read: a rail saying "0 of 0" because
  a fetch failed is a lie, an absent block is not.
- **Primary navigation is always text-labelled**, never icon-only, grouped with
  uppercase group headings. Below `md` it becomes one horizontally scrollable
  strip under the header, labels intact, headings dropped. Do not redesign it
  into an off-canvas drawer.
- Before each nav label sits a **2px vertical bar in the module hue**, at full
  opacity on the active item, half on hover, invisible otherwise. It is
  decoration: the label is the item, never a bar or an icon on its own. AXIS,
  ORBIT, SIGNAL, SCOUT and NORTH own accents (`--module-axis`, `--module-orbit`,
  `--module-signal`, `--module-scout`, `--module-north`). **COMPLIANCE has no
  module accent** and falls back to the tenant `--accent`. If the design wants
  compliance to feel distinct, that is a new token and a product decision, not a
  CSS choice.
- Navigation runs through a view transition: the frame holds still and only the
  canvas changes. Browsers without the API navigate normally.
- **The canvas** opens with a 2px rule in the current workspace's hue, then
  breadcrumbs — but only below module level, where the path says more than the
  rail can. At `/compliance/dsar-requests` there are no crumbs; at
  `/compliance/dsar-requests/:id` there are.
- Skip link: `app.skipToContent` = "Skip to content", targeting `#workspace`.
- A toast host sits above every workspace so a screen can say what happened after
  the control that caused it scrolled away. **In-place `role="status"` notices
  stay the default**, and nothing AI-generated ever toasts for itself.
- **Opaque, not glass.** Blur is banned outright. Depth comes from the surface
  being one step lighter than the field behind it, plus a hairline border.

### 3.2 Tokens

Dark-first. Surfaces `--bg` / `--surface-1` / `--surface-2` / `--surface-3`,
borders `--border` / `--border-strong`, text `--text` / `--text-muted` /
`--text-subtle`. Status colours `--success`, `--danger`, `--warning`, `--info`,
each with a `-contrast` pair. Type scale is a fixed ladder: `text-11 12 13 14 16
18 22 24 28 36 48`.

Four font roles, and headings do **not** use the display face:

| Token | Family | Where it is used in this brief |
|---|---|---|
| `--font-serif` | Instrument Serif | **every h1 and every card/panel heading** |
| `--font-display` | Archivo | the brand wordmark in the top bar |
| `--font-ui` | Instrument Sans | body, labels, tables, buttons |
| `--font-mono` | IBM Plex Mono | hashes, identifiers, the account pill, counts |

`--font-arabic` (IBM Plex Sans Arabic) is the second family in the serif, display
and UI stacks and carries both headings and body in `ar` — **do not drop it**.
Tenant-overridable custom properties are the accent trio (`--accent`,
`--accent-hover`, `--accent-contrast`) and the display and UI faces, from an
approved set only.

### 3.3 The generic list screen (`routes/module.tsx`)

Every one of the ten tabs is this screen with different data.

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Compliance                                            (h1, serif 22)      │
│ ┌──────────────────────────────────────────────────────────────────────┐  │
│ │ Subject requests │ Erasure log │ Disclosures │ Screenings │ …        │  │ tab strip
│ └──────────────────────────────────────────────────────────────────────┘  │
│ Reports and tools:  [Run a screening] [Export evidence] [Run retention]   │ link strip
├───────────────────────────────────────────────────────────────────────────┤
│ [Search…]  [State ▾ All]  [Type ▾ All]        [Apply] [Clear]             │ filter bar
├───────────────────────────────────────────────────────────────────────────┤
│ ▸ New — Subject requests                                     (<details>)   │ create panel
├───────────────────────────────────────────────────────────────────────────┤
│ ┌───────────────────────────────────────────────────────────────────────┐ │
│ │ Subject     │ Type   │ Channel │ State  │ Due      │ Fulfilled │ …    │ │ sticky header
│ ├───────────────────────────────────────────────────────────────────────┤ │
│ │ rania.h…    │ access │ Portal  │ ●Fulf. │ 12 Jun   │ 09 Jun    │ …    │ │ compact rows
│ │ …                                                                     │ │
│ └───────────────────────────────────────────────────────────────────────┘ │
│ 24 shown                                        [Previous]  [Next]        │
└───────────────────────────────────────────────────────────────────────────┘
```

Fixed behaviours to design around:

- **h1** is the workspace label (`nav.compliance` → "Compliance") on every tab,
  set in `--font-serif` at `text-22`, not in the display face.
  The tab name is *not* in the heading — it is only in the tab strip and in the
  table's visually-hidden caption (`Compliance — Subject requests`).
- **Tab strip** renders only when more than one tab is visible.
- **Link strip** is labelled `common.reports` = "Reports and tools" and holds
  only the run links the actor may follow.
- **Filter bar** is a GET `<Form>`. Each declared filter is a `<Select>` whose
  first option is `common.all` = "All". Buttons: `common.apply` = "Apply",
  `common.clear` = "Clear". Search input appears only on `searchable`
  resources — **no compliance tab is searchable**, so there is no search box
  anywhere in this workspace.
- **Create panel** is a `<details>` element, collapsed by default, summary
  `"New — <tab label>"`, submit `common.create` = "Create". Renders only when the
  tab declares `create` *and* the actor holds it.
- **Table** is `density="compact"`, `stickyHeader`. The **first column is the
  link** into the record; there is no separate open button. Empty cells render an
  em-dash in `--text-subtle`. `json` columns render as monospace 11px truncated
  at 60 chars. `datetime` renders to the minute, `date` to the day, both
  locale-formatted. Numbers are `tabular-nums`.
- **Pager** is keyset, not numbered: footer shows `common.rows` = "{count} shown"
  with `common.previous` / `common.next`.
- **Empty state**: `common.empty.title` = "Nothing here yet" with
  `common.empty.body` = "No records match this view. Clear the filters, or create
  the first one." When filters are applied it is `common.empty.filtered` = "No
  records match these filters."
- **Deleted view** (`?deleted=1`) shows a banner: "You are looking at deleted
  records. They stay out of the live list until you restore them." with a back
  link "Back to live records". Reachable only by URL — there is no control that
  turns it on.
- **Loading**: there is no skeleton. React Router loads on the server; the
  previous screen stays until the new one is ready. Buttons show
  `common.working` = "Working…" while submitting.
- **Error**: an API problem renders a `Problem` alert above the table —
  `role="alert"`, `border-danger/40 bg-danger/10`, the problem title in display
  16 and the detail in ui 13 muted.

**Badge tones are shared across the whole product** and this matters enormously
in COMPLIANCE. The tone table maps a fixed vocabulary: `in_progress`→info,
`running`→info, `open`/`draft`/`closed`→neutral, `done`→success, `failed`/
`rejected`/`cancelled`→danger, `pending`/`blocked`/`high`→warning. **Any value
not in that table renders neutral grey.** §11 lists exactly which compliance
badges are grey today; several of them should not be.

### 3.4 The generic record screen (`routes/record.tsx`)

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Back to list                                                    (12px link)│
│ rania.haddad@example.ae                                  (h1, serif 22)    │
│ Subject requests · 01J8XR…MB4                        (12px, id monospace)  │
├───────────────────────────────────────────────────────────────────────────┤
│ ┌── <dl>, 1 / 2 / 3 columns responsive, surface-1, rounded-lg ───────────┐ │
│ │ Subject          Type            Channel                              │ │
│ │ rania.h…         access          Portal                               │ │
│ │ State            Due             Fulfilled                            │ │
│ │ ● Fulfilled      12 Jun 2026     09 Jun 2026                          │ │
│ │ …  + Created / Updated appended when present                          │ │
│ └───────────────────────────────────────────────────────────────────────┘ │
├───────────────────────────────────────────────────────────────────────────┤
│ Actions                                (only if the resource declares any) │
├───────────────────────────────────────────────────────────────────────────┤
│ Edit                                                                       │
│ [field] [field] [field] …                                    [Save changes]│
├───────────────────────────────────────────────────────────────────────────┤
│ [Delete]  (danger, sm)                                                     │
└───────────────────────────────────────────────────────────────────────────┘
```

- **The h1 is the first column's value.** For several compliance tabs that is a
  poor heading — see each screen's "Weak today".
- Field labels are sentence case, 12px, `--text-subtle`, sitting **above** the
  value. No uppercase micro-labels.
- The edit form is not a mode — it is a section on the same page. It renders only
  when the tab declares `update` and the actor holds it.
- **Delete** confirms with the browser's own `confirm()`:
  `common.deleteConfirm` = "Delete this record? It is retained for audit and can
  be restored by an administrator." There is no custom modal.
- **No COMPLIANCE resource declares any `actions`**, so the "Actions" section
  never renders in this workspace.

---

## 4. Screen 1 — `/compliance/run/screening`

**Route + title.** Path `/compliance/run/screening`. Page h1: **"Compliance
runs"** (label key `title`, ar: عمليات الامتثال), `--font-serif` at `text-22`.
Card and panel headings on all three variants are the same serif face at
`text-18`. This screen owns its own label table — it does not read the workspace
catalogue.

**Who sees it.** `compliance:screenings:run`. Of the fourteen roles: **only
`tenant.compliance`.** `tenant.admin` has read on screenings but not run, so the
link is absent and a direct URL gives them the denied `EmptyState`.

**Purpose.** Put a name or a customer on file to the configured screening
provider and record the answer together with the hash of the question that was
asked.

**Layout.**

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Compliance runs                                            (h1, serif 22)  │
│ [ Screening ] [ Evidence bundle ] [ Retention ]        (kind strip, h-8)    │
│ Puts a name or a customer on file to the configured screening provider     │
│ and records the answer with the hash of the question that was asked.       │  ~55%
│  ↑ after a run this paragraph is REPLACED by the run's own headline         │
├───────────────────────────────────────────────────────────────────────────┤
│ ┌ Name ──────────┐ ┌ Customer ─────┐ ┌ Screening type ┐                   │
│ │ w-64           │ │ w-56          │ │ w-52  Sanctions▾│  [Run screening]  │
│ └────────────────┘ └───────────────┘ └────────────────┘                   │
│  hint 12px muted    hint 12px muted                                        │
├───────────────────────────────────────────────────────────────────────────┤
│ ┌── role="note", warning/40 border, warning/10 fill ────────────────────┐  │
│ │ No screening provider is configured                                   │  │
│ │ This result was produced by the built-in stub, which consults no      │  │
│ │ watchlist. …                                                          │  │
│ └───────────────────────────────────────────────────────────────────────┘  │
│ ┌── Card: "Screening result" ───────────────────────────────────────────┐  │
│ │ Screening result   ● Clear                                            │  │
│ │ Subject            name:amina saleh     (shared Ref component, 12)    │  │
│ │ Provider           stub                                               │  │
│ │ Query hash         a3f1…9c2b                   (mono 12, break-all)   │  │
│ │                    The hash of the question that was asked. …         │  │
│ │ When               30 Jul 2026, 14:12                                 │  │
│ └───────────────────────────────────────────────────────────────────────┘  │
│ ┌── Table, caption "Matches", compact ──────────────────────────────────┐  │
│ │ List │ Matched name │ Match │ Note                                    │  │
│ └───────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
```

**Kind strip.** Renders only if the actor may start **more than one** of the
three runs. It is a labelled `<nav>`; `aria-current="page"` on the active one;
active is `bg-surface-2 text-text`, the others `text-subtle`. Labels:
"Screening" / "Evidence bundle" / "Retention".

**The intro paragraph is a result line, not a static blurb.** Before any run it
carries the screen's own description (`intro.<kind>`). **After a successful run
it is replaced** by a one-sentence headline for what just happened, in the same
place, same type, no animation. A run that came back with a problem leaves the
description standing. The seven headlines, verbatim, across all three variants:

| Run | Outcome | Headline |
|---|---|---|
| Screening | clear | "No matches. Clear to proceed." |
| Screening | hit | "A match was found. The subject is blocked." |
| Screening | inconclusive | "The result was inconclusive." |
| Evidence | ready | "Bundle built, {count} files." |
| Evidence | failed | "The archive could not be stored." |
| Retention | preview | "{count} rows would be deleted." |
| Retention | purge | "{count} rows deleted." |

Design consequence: the paragraph slot must hold both a two-line description and
a short sentence without the form below it jumping. And a screen reader gets the
result twice — once here, once in the card — so do not also make this an
`aria-live` region.

**Every element.**

| Element | Label (key) | Control | Behaviour |
|---|---|---|---|
| Name | "Name" (`field.subject`) | `<Input>` `name="subject"`, `maxLength=200`, width `w-64` | Free text. Hint: "The name to screen, as it is written on the document" |
| Customer | "Customer" (`field.customerId`) | **`<RefPicker>`** `name="customerId"`, `w-56`, `maxLength=200`, placeholder "Search by name" | Type-over-name box backed by a native `<datalist>` of the tenant's customers. What is typed is matched to a name and **the id is what the form posts**; anything the list has never heard of is posted as typed, so a pasted `cus_…` still works. Hint: "The customer on file, if the subject is one. **Overrides the name.**" |
| Screening type | "Screening type" (`field.kind`) | `<Select>` `name="kind"`, default `sanctions`, `w-52` | Options: Sanctions, Politically exposed person, Adverse media, Fraud |
| Submit | "Run screening" (`action.screening`) | primary `<Button>` | POSTs to `/v1/compliance/screenings/run`; shows "Working…" while in flight |

Fields are a single wrapping flex row, `items-end`, `gap-3` — the button sits on
the same baseline as the inputs.

**Where the customer list comes from, and how it degrades.** Only the screening
variant loads it: the loader fetches customers newest-first, capped at 100, and a
failure to read them is swallowed. When the list is empty — the fetch failed, or
the actor's role cannot read customers — the `<datalist>` is not attached at all
and the control silently becomes the plain text box it used to be. It still
accepts a pasted id. **Two consequences for design:** a customer outside the
most recent hundred cannot be found by typing their name, and there is no visible
difference between "the list loaded and this name is not in it" and "the list did
not load". Neither state is signalled today.

**Validation.** None client-side beyond `maxLength`. Nothing is `required`. The
API requires **at least one of** `name` or `customerId` and refuses a body
carrying `queryHash`, `result` or `provider` (400). Both empty → a server
problem, not an inline field error.

**The subject reference the server computes.** A name is normalised to
`name:<lowercased trimmed name>` (so `Amina Saleh` and `  amina  saleh ` are the
same subject), a customer to `customer:<id>`. `queryHash` is a sha256 over the
canonical question, so the same question asked with different whitespace or
casing produces an identical hash — that identity is what makes the row evidence.

**States.**

- *Empty / first load* — header, kind strip, intro, form. No result area at all.
- *Loading* — button label swaps to a loading state; the previous result stays on
  screen (results are keyed to the current run kind, so switching tabs clears
  them).
- *Result* — the stub note **always renders above the result card**, never below.
  This is deliberate: the one thing this screen must never imply is a "clear"
  nobody qualified. The intro paragraph has by now been replaced by the run's
  headline.
- *Subject* — rendered through the product's shared `Ref` component at 12px, the
  same treatment every prefixed reference gets elsewhere, not ad-hoc monospace.
- *Hit* — the result badge is `danger`, and a second `role="alert"` panel appears
  between the card and the matches table: **"Blocked"** / "A hit blocks the
  subject until a compliance officer records a disposition against the
  screening." Note what *does not* happen: no case is opened in AXIS, and
  `caseRef` stays null. A `compliance.screening.hit` event is emitted instead.
- *Inconclusive* — badge tone `warning`.
- *Clear* — badge tone `success`. The matches table renders its own empty state:
  title "Matches", body **"The provider returned no matches."**
- *Error* — `role="alert"` panel, title **"The run did not happen"**, body is the
  API problem's `detail` or `title`. Nothing on this screen ever claims a run
  that did not happen.
- *Permission denied* — the denied `EmptyState` described in §2.3.

**The stub is the design problem.** The only provider implementation is called
`stub`. It consults nothing. Every real name returns `clear`. Two magic strings
force other outcomes for testing: a subject containing `lyra-test-hit` returns
`hit`, `lyra-test-inconclusive` returns `inconclusive`. Every hit it manufactures
carries `stub: true` and the note "Produced locally by the built-in stub. No
watchlist was consulted." All seven seeded screening rows have `provider:
"stub"`. **The UI must never imply a real screening vendor**: no vendor logo, no
"verified against", no shield iconography, no green tick that reads as
clearance. The warning note is load-bearing and must not be collapsible,
dismissible or moved below the fold.

**AI surfaces.** None. No ✦. Correctly so — a stub result must not be dressed up
as an assessment, and there is no model in this path.

**Actions and consequences.** Running a screening is **not** irreversible: it
writes one immutable row and one audit entry. It cannot be undone (the row is
immutable) but it destroys nothing. No confirmation is asked for, and none is
needed.

**Mobile.** Web only. Expo has no run screen.

**RTL.** The kind strip, the field row and the table all mirror. The **query hash
must not mirror** — it is `break-all font-mono`; it needs `dir="ltr"` and
`text-align: start` so a hash never renders reversed or with its wrap points on
the wrong side. The same applies to `name:amina saleh` and `customer:cus_…`
subject references, which are ASCII identifiers, not prose.

**Weak today.**
1. The screen asks for a name and a customer id side by side, and only a hint
   sentence says the customer wins. That precedence should be a visible
   relationship (a radio pair, an either/or) not a footnote.
2. `identifiers` (passport, national id, date of birth) is accepted by the API
   and has **no input on this form**. A sanctions screening on a bare name is the
   weakest possible query, and the screen cannot express a stronger one.
3. A hit says a disposition is required but offers **no way to record one**. The
   officer must leave, find the row in `/compliance/screenings`, and there is no
   edit form there either — `screenings` declares no `update`. **The disposition
   this screen demands cannot be entered anywhere in the product.**
4. There is no history strip. Running the same screening twice gives no hint that
   you already ran it.

---

## 5. Screen 2 — `/compliance/run/evidence`

**Route + title.** `/compliance/run/evidence`, h1 "Compliance runs", kind tab
"Evidence bundle".

**Who sees it.** `compliance:evidence:export` — **`tenant.compliance` and
`finance.controller`**. For finance.controller this is one of only two compliance
screens they can reach, and they arrive at it from `/compliance/evidence-bundles`
because they have no nav entry.

**Purpose.** Gather the audit and AI-audit entries in scope into one archive,
hash every file in it, and record the hash of the archive that was handed over.

**Layout.**

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Compliance runs                                            (h1, serif 22)  │
│ [ Screening ] [ Evidence bundle ] [ Retention ]                            │
│ Gathers the audit and AI audit entries in scope into one archive, hashes   │
│ every file in it, and records the hash of the archive that was handed over.│
│  ↑ replaced after a run by "Bundle built, 4 files."                        │
├───────────────────────────────────────────────────────────────────────────┤
│ ┌Purpose─┐ ┌Subject──────┐ ┌From──┐ ┌To────┐ ┌Prepared for─┐              │
│ │w-48 ▾  │ │w-64         │ │w-44  │ │w-44  │ │w-56         │ [Build bundle]│
│ └────────┘ └─────────────┘ └──────┘ └──────┘ └─────────────┘              │
├───────────────────────────────────────────────────────────────────────────┤
│ ┌── Card: "Bundle" ─────────────────────────────────────────────────────┐  │
│ │ Bundle        ● Ready                                                 │  │
│ │ Bundle hash   7d4c…e10f     (mono, break-all)                         │  │
│ │               sha256 of the archive, manifest included. Quote it       │  │
│ │               with the bundle.                                        │  │
│ │ Purpose       regulator                                               │  │
│ │ Prepared for  (only when supplied)                                    │  │
│ │ When          30 Jul 2026, 14:20                                      │  │
│ └───────────────────────────────────────────────────────────────────────┘  │
│ [Download bundle]                                        (secondary)       │
│ ┌── Table, caption "Bundle", compact ───────────────────────────────────┐  │
│ │ File            │  Size  │ sha256                                     │  │
│ │ audit.jsonl     │ 41,208 │ 9ab3…                                      │  │
│ │ ai-audit.jsonl  │  8,112 │ 1c74…                                      │  │
│ │ summary.pdf     │  3,455 │ e0d2…                                      │  │
│ └───────────────────────────────────────────────────────────────────────┘  │
└───────────────────────────────────────────────────────────────────────────┘
```

**Fields.**

| Element | Label | Control | Notes |
|---|---|---|---|
| Purpose | "Purpose" | `<Select name="purpose">`, **default `regulator`**, `w-48` | Options: "Regulator request", "Audit", "Dispute", "Internal review" |
| Subject | "Subject" | `<Input name="subjectRef" maxLength=200>`, `w-64` | Hint: "Narrow to one subject reference, e.g. customer:cus_… . Leave blank for everything in the window." |
| From | "From" | `<DatePicker name="from">`, `w-44` | Date only. Sent as midnight UTC |
| To | "To" | `<DatePicker name="to">`, `w-44` | Date only. Sent as **end of day** (23:59:59.999 UTC) |
| Prepared for | "Prepared for" | `<Input name="deliveredTo" maxLength=200>`, `w-56` | Hint: "Who asked for the bundle. Recorded on the row; **nothing is sent from here**." |
| Submit | "Build bundle" | primary Button | POSTs `/v1/compliance/evidence-bundles/export` |

**Validation.** Nothing required; no client-side range check. A `to` earlier than
`from` is not caught in the browser. If purpose is somehow empty the action
substitutes `audit` — note the mismatch: the select shows "Regulator request" but
the fallback is `audit`. Keep the select's default and the fallback aligned in
any redesign.

**What the archive contains.** `audit.jsonl`, `ai-audit.jsonl`, `summary.pdf` and
`manifest.json`. The manifest lists every file with its size and sha256. The
`bundleHash` is the sha256 of the whole archive **including** the manifest.

**States.**

- *Ready* — badge `success`, "Ready". Download button renders, and the intro
  paragraph is replaced by "Bundle built, {count} files."
- *No files* — the file table carries its own empty state: **"No files were
  captured in this run."**
- *Failed* — badge `danger`, "Failed", headline "The archive could not be
  stored." Instead of the download button, a `role="alert"` line in `--danger`:
  **"The archive could not be stored, so there is nothing to hand over. Try
  again; if it repeats, the file store is unavailable."** The row is still
  written — a failed bundle is a record that an export was attempted.
- *Truncated* — a `role="status"` warning panel above the file table: **"This
  bundle hit the row ceiling and does not cover the whole window. Narrow the
  window and export again."** The ceiling is 5,000 rows.
- *Error* — the shared "The run did not happen" alert.
- *Denied* — the shared denied `EmptyState`.

**Download.** A plain `<a href="{API_ORIGIN}/v1/compliance/evidence-bundles/{id}/download" download>` styled as a secondary button. It goes straight to
the API — the archive is not copied through the web app. The endpoint requires
`compliance:evidence:read` and the downloaded bytes hash to the displayed
`bundleHash`.

**The download that 404s.** Every one of the five seeded bundles has `fileId:
null`, and every seeded subject request has `bundleFileId: null`. The API 404s a
download when there is no `fileId`. So: a **freshly built** bundle downloads
fine; **every historical row in the list does not.** Design a truthful state for
this — the record screen currently shows an empty `File` cell (an em-dash) and
offers no download at all, which is honest but silent. What is needed is an
explicit line on the evidence-bundle record along the lines of *"No archive is
stored for this bundle. Export it again to produce one."* That copy does not
exist yet and is a design deliverable, not a claim about the past.

**AI surfaces.** None. The summary PDF is rendered from structured rows, not
generated prose — there is no model in this path and no ✦ belongs here.

**Actions and consequences.** Building a bundle is additive: a new immutable row,
an archive in object storage, an audit entry. Not irreversible, no confirmation.
`approvedBy` is **always null** — nothing in the product ever sets it. Marking a
bundle `delivered` **has no API route at all**; the state exists in the filter and
in one seeded row and can never be reached by a user.

**Mobile.** Web only.

**RTL.** Mirror the field row, the card and the table. **Do not mirror**: the
bundle hash, every per-file sha256, the file paths (`audit.jsonl`), the size
column (numeric, keep it end-aligned in both directions with `tabular-nums`), or
a `subjectRef` like `customer:cus_…`.

**Weak today.**
1. The date window has no defaults and no presets. Every export starts from two
   empty date fields and the officer guesses.
2. No preview of scope before building. The count of rows in scope is only
   knowable after the archive exists, and the only signal that you got it wrong
   is the truncation warning.
3. "Prepared for" is free text with a hint saying nothing is sent. It reads like
   a delivery field and is a label.
4. There is no route from a subject request to "build the bundle for this
   request", even though `dsarRequests.bundleFileId` exists to hold the answer.
   The officer builds a bundle here and then hand-copies an id into the request's
   edit form.

---

## 6. Screen 3 — `/compliance/run/retention`

**This is the most consequential screen in the product.** It is the only place a
user permanently deletes customer data.

**Route + title.** `/compliance/run/retention`, h1 "Compliance runs", kind tab
"Retention".

**Who sees it.** `compliance:retention:run` — **only `tenant.compliance`.**

**Purpose.** Delete conversation messages older than this tenant's retention
period, after previewing what would go and what a legal hold is keeping.

**Layout — step one (preview).**

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Compliance runs                                            (h1, serif 22)  │
│ [ Screening ] [ Evidence bundle ] [ Retention ]                            │
│ Deletes conversation messages older than this tenant's retention period.   │
│ Preview first: the preview counts what would go and what a legal hold is   │
│ keeping.                                                                   │
│  ↑ replaced after a preview by "418 rows would be deleted.", and after a   │
│    purge by "418 rows deleted."                                            │
├───────────────────────────────────────────────────────────────────────────┤
│ ┌ Record class ──────────┐                                                 │
│ │ w-56  Conversation ▾   │   [Preview]                                     │
│ └────────────────────────┘                                                 │
└───────────────────────────────────────────────────────────────────────────┘
```

**Layout — step two (after a preview that found rows).**

```
│ ┌── Card: "Preview" ────────────────────────────────────────────────────┐  │
│ │ Table                  orbit_messages          (mono 12)              │  │
│ │ Cutoff                 30 Jul 2024                                    │  │
│ │                        Computed from this tenant's retention policy   │  │
│ │                        and the regulatory floor. It cannot be set here│  │
│ │ Retention period       24 months                                      │  │
│ │ Rows to delete         418                     (tabular-nums)         │  │
│ │ Rows kept by a legal hold   6                                         │  │
│ └───────────────────────────────────────────────────────────────────────┘  │
│ ┌── role="status", warning ─────────────────────────────────────────────┐  │
│ │ More rows are past the cutoff than one run covers. Run it again until │  │
│ │ nothing is left.                                                      │  │
│ └───────────────────────────────────────────────────────────────────────┘  │
│ ┌══ <Form>, danger/40 border, danger/10 fill ═══════════════════════════┐  │
│ ║ This deletes the rows                          (display 16)           ║  │
│ ║ Deletion is permanent and there is no second approval behind this     ║  │
│ ║ button. The count above is what will go.                              ║  │
│ ║ [Delete permanently]                           (danger Button)        ║  │
│ └═══════════════════════════════════════════════════════════════════════┘  │
```

**Fields.**

| Element | Label | Control | Notes |
|---|---|---|---|
| Record class | "Record class" (`field.policyKey`) | `<Select name="policyKey">`, default `messages`, `w-56` | **Exactly one option**: "Conversation messages". A select with one choice. |
| Submit (step 1) | "Preview" (`action.retention`) | primary Button | POSTs with `dryRun: true` |
| Submit (step 2) | "Delete permanently" (`action.purge`) | **danger** Button, in its own form | POSTs with `dryRun: false` |

**Only `messages` works.** The server's class table has one entry: `messages` →
table `orbit_messages`, floor 24 months. `policyKey: "files"` and `policyKey:
"consent"` are refused. Do not design a class picker that implies more.

**The cutoff cannot be chosen, and the screen must say why.** The browser never
sends a cutoff. The server computes it as `max(this tenant's configured
retention months, the class floor of 24 months)` — the floor wins whenever the
tenant tries to go shorter. A body carrying `cutoffAt` or `rowsAffected` is
rejected outright. The screen expresses this with a **read-only fact plus a
hint**, never a disabled input: "Cutoff · 30 Jul 2024" with "Computed from this
tenant's retention policy and the regulatory floor. It cannot be set here." Keep
that shape. A greyed-out date field would invite someone to try to enable it.

**The two-step is the safety mechanism and must not be collapsed.**

- Preview returns HTTP 200 with `dryRun: true`. It **deletes nothing**, writes
  **no** retention-run row, and records one `compliance.retention.plan` audit
  entry. The preview is safe to run repeatedly.
- The purge form renders **only** when `dryRun` was true *and* `rowsAffected > 0`.
  A preview that finds nothing offers no button at all.
- The purge form is a **separate `<Form>`** carrying a hidden `policyKey` copied
  from the result and a hidden `confirm=purge`. It is never a checkbox on the
  first form, so nobody presses delete having read a different number.
- The purge returns HTTP 201, deletes up to 500 rows in a batch, writes a
  `retentionRuns` row and a `compliance.retention.run` audit entry.
- After a purge the card retitles to **"Purge"** and the count relabels from
  "Rows to delete" to **"Rows deleted"**. The headline above says the same thing
  a third time.
- **The screen tells preview from purge by the presence of `dryRun`, not by its
  value.** A preview response says `dryRun: true`; a purge response omits the key
  entirely. There is no `dryRun: false` anywhere. Anything designed around a
  three-state control here would be designing against a state the server cannot
  produce.

**Legal holds win.** A hold whose `subjectRef` is `conversation:<id>` or
`customer:<id>` keeps its rows out of the delete, and the kept count is reported
separately as **"Rows kept by a legal hold"**. This is enforced server-side and
is verified by test. A hold outlives the cutoff — held rows are never deleted
however old they are.

**Batching.** `more: true` means more rows are past the cutoff than one run
covers, and shows: "More rows are past the cutoff than one run covers. Run it
again until nothing is left." The officer must press preview → delete → preview →
delete until it stops. There is no progress indicator and no total.

**States.** Empty (form only) · preview with rows · preview with zero rows (card,
no purge panel) · purged (card retitled "Purge") · `more` warning ·
error ("The run did not happen") · denied `EmptyState`.

**AI surfaces.** None, correctly. Nothing on this screen should be model-decided.

**Actions and consequences — irreversible.**

> **"Delete permanently" is the only irreversible action in this workspace.** It
> hard-deletes rows from `orbit_messages`. There is no soft-delete, no restore
> and no undo. The confirmation it gets today is: a red-bordered panel, a
> separate submit, the count stated immediately above, and the sentence
> **"Deletion is permanent and there is no second approval behind this button.
> The count above is what will go."**

There is **no browser `confirm()`** on this button (unlike record delete, which
has one), and — as the copy admits — **no approval gate**. The approvals registry
declares `compliance.erasure` (dual-control, never auto-approve) and
`compliance.legal_hold_release` (dual-control, never auto-approve). It declares
**no `compliance.retention_purge` key**. The permanent purge is therefore the one
consequential action in this module that a single person can complete alone. The
screen is honest about this, which is the right interim behaviour; the fix is a
policy key, not a UI change, and it is the single highest-priority gap in this
brief.

**Mobile.** Web only, and should stay that way.

**RTL.** The card, the panel and the button mirror. The table name
`orbit_messages` must not — it is an identifier in a monospace face. The counts
are `tabular-nums` and stay end-aligned. The danger panel's border and fill are
symmetric, so nothing about the warning depends on direction.

**Weak today.**
1. No approval gate (above). The screen's own copy is the mitigation.
2. A one-option select. It reads as a choice and is not one.
3. No indication of what "418 rows" *means* — which conversations, which
   customers, which date span. The preview counts and does not sample. An officer
   presses permanent-delete on an integer.
4. No visibility of which holds are doing the holding. "6 rows kept by a legal
   hold" does not say which hold, and there is no link to `/compliance/legal-holds`.
5. Batch looping is manual with no total, so the officer cannot tell whether they
   are two runs from done or two hundred.
6. `retentionMonths` renders only when the API returns it; when absent the row
   silently disappears and the cutoff loses its explanation.

---

## 7. Screens 4–13 — the ten resource tabs

All ten use the chassis in §3.3 and §3.4. Each entry below gives only what is
specific to it.

### 7.1 `dsar-requests` — "Subject requests"

- **Paths.** `/compliance/dsar-requests`, `/compliance/dsar-requests/:id`. This is
  the **default tab** for anyone with `compliance:dsar:read`.
- **Who.** read `compliance:dsar:read` (tenant.compliance, tenant.admin) · create
  `compliance:dsar:create` (tenant.compliance) · update `compliance:dsar:fulfil`
  (tenant.compliance). No delete.
- **Purpose.** The officer's queue of access, erasure, rectification,
  portability, objection and restriction requests, oldest due first.
- **Sort.** `dueAt` **ascending** — the only tab in the workspace sorted ascending,
  because it is a queue and the most-overdue is the most urgent.
- **Filters.** *State*: Received, Verifying, In progress, Awaiting legal,
  Fulfilled, Refused, Expired. *Type*: Access, Erasure, Rectification,
  Portability, Objection, Restriction.
- **Columns.**

| Header | Field | Type | Align | Notes |
|---|---|---|---|---|
| Subject | `subjectIdentifier` | text | start | **The link into the record.** Holds an email or a phone number, unmasked |
| Type | `type` | text | start | Raw value, no badge |
| Channel | `channel` | text | start | Raw value: portal, email, whatsapp, regulator |
| State | `state` | text **badge** | start | See tone note below |
| Due | `dueAt` | datetime, **sortable** | start | Locale datetime to the minute |
| Fulfilled | `fulfilledAt` | datetime | start | em-dash when null |
| Handled by | `handledBy` | text | start | A user id |

- **Create form** (`New — Subject requests`): Subject `text` **required** · Type
  `select` **required** (6 options) · Channel `select` **required** (4 options) ·
  Customer `text` optional · Due `datetime-local` **required** · Verification
  `text` optional. Required fields carry the native `required` attribute and the
  `Field` label marks them; error copy on failure is the API's problem detail in
  the `Problem` alert, not inline.
- **Edit form** (record screen): State `select` (7 options) · Handled by `text` ·
  Fulfilled `datetime-local` · Refusal reason `text` · Bundle file `text`.
  Everything the create form collects is **not** editable — the request as
  received is fixed; only the handling moves.
- **The due date is tenant policy, not a statutory clock.** `dueAt` is set from
  the tenant's own service target, stored as the threshold
  `compliance.dsar_service_target` = `{ days: 30, warnAtDays: 25, escalateTo:
  "tenant.compliance" }` on the `policy-thresholds` tab. Design it as a tenant
  setting: the target, the warn point and the escalation target are all editable
  by the tenant on that tab. **Do not label the due date as a legal deadline, do
  not name a regime, and do not add a "you are in breach" state.** "Past this
  tenant's service target" is the only claim available.
- **States.** Empty: "Nothing here yet" / "No records match this view. Clear the
  filters, or create the first one." Filtered-empty: "No records match these
  filters." Denied: the tab is simply absent.
- **AI surfaces.** None.
- **Actions and consequences.** Editing state to `fulfilled` records handling; it
  performs no erasure. **The erasure itself is not on this screen** — it runs
  behind `compliance:erasure:execute` and the `compliance.erasure` dual-control
  approval, and its output appears in the `erasure-log` tab. An erasure leaves a
  **tombstone**: rows are hard-deleted, a tombstone remains as evidence that the
  record existed and was erased, and rows the tenant must retain are counted
  separately with a stated reason. Nothing on this screen is irreversible.
- **Mobile.** This is the **one** compliance resource with mobile parity —
  `/compliance` maps to `compliance/dsar-requests` in the Expo nav table. See §12.
- **RTL.** Row order and the whole layout mirror. Email addresses and phone
  numbers in the Subject column must not — force `dir="ltr"` on the cell content
  while the cell itself stays start-aligned, or `+971501234567` renders with the
  plus on the wrong end.
- **Weak today.**
  1. **The queue has no clock on it.** `dueAt` is a plain date cell in the default
     text colour. Nothing is red, nothing is bold, nothing says "3 days left" or
     "past target". The threshold row already stores `warnAtDays: 25` and nothing
     reads it. For a screen whose whole purpose is a service target, this is the
     biggest gap in the workspace.
  2. **Every state badge is grey.** `fulfilled`, `refused`, `expired`,
     `received`, `verifying`, `awaiting_legal` are all outside the shared tone
     table, so a refused request and a fulfilled one look identical. Only
     `in_progress` gets colour (info blue).
  3. `subjectIdentifier` is raw PII in a table cell, in the h1 of the record
     screen, and in no masking map. There is no reveal control and no audit of
     viewing it, unlike core customers.
  4. `refusalReason` is a single-line `text` input for something that is by
     nature a paragraph.
  5. `bundleFileId` is a free-text field into which a human pastes an id
     generated by a different screen. It is null on all seeded rows.
  6. No link from a request to the erasure-log rows it produced, or to the
     evidence bundle prepared for it.

### 7.2 `erasure-log` — "Erasure log"

- **Paths.** `/compliance/erasure-log`, `/…/:id`.
- **Who.** read `compliance:dsar:read` only. **No create, no update, no delete —
  immutable in the API.** tenant.compliance and tenant.admin see an identical,
  entirely read-only screen.
- **Purpose.** What an erasure actually did, per table.
- **Sort.** `ts` descending.
- **Filters.** None.
- **Columns.** Request (`dsarId`, text, **the link**) · Table (`tableName`, text)
  · Rows erased (`rowsErased`, number, tabular) · Rows tombstoned
  (`rowsTombstoned`, number, tabular) · Retained reason (`retainedReason`, text) ·
  When (`ts`, datetime, sortable).
- **Forms.** None anywhere. The record screen is the `<dl>` and nothing else — no
  Actions section, no Edit section, no Delete button.
- **This is where the tombstone shows up.** A row reads: *n* rows erased, *m*
  rows tombstoned, and where something was kept, the reason in plain words. Two
  real seeded reasons, quoted exactly: "consent ledger tombstoned as evidence"
  and a financial-records retention reason stated as **the tenant's own retention
  policy**, not as a statutory period. Keep that framing.
- **AI surfaces.** None. Correct — this is a machine record of a deletion.
- **Mobile.** Web only.
- **RTL.** Mirrors. `tableName` (`orbit_messages`, `core_consents`) is an
  identifier and must not.
- **Weak today.**
  1. The h1 of the record is the `dsarId` — a raw ULID. The heading of the screen
     that proves an erasure is an opaque identifier.
  2. `dsarId` is not a link to the request it belongs to. It is text in a text
     column.
  3. Rows erased and rows tombstoned sit side by side with no visual difference
     between "gone" and "gone but proved", which is the entire distinction the
     table exists to record.
  4. No filter at all — not by table, not by request, not by date. A large
     erasure produces one row per table and they are found by scrolling.

### 7.3 `disclosures` — "Disclosures"

- **Who.** read `compliance:disclosures:read` (tenant.compliance, tenant.admin).
  **Immutable** — no writes anywhere.
- **Purpose.** The wording that was shown, when, to whom, in which language.
- **Sort.** `ts` descending. **Filters.** None.
- **Columns.** Key (`key`, **the link**) · Subject (`subjectRef`) · Customer
  (`customerId`) · Locale (`locale`) · Channel (`channel`) · Wording reference
  (`wordingRef`) · Acknowledged (`acknowledgedAt`, datetime) · When (`ts`,
  datetime, sortable) · Criteria (`criteriaJson`, json — deliberately last,
  because it is the one column wide enough to make the row unreadable).
- **What is in here.** Seven seeded rows with keys like `panel.data_sharing`,
  `quote.ranking_criteria` (one row per locale, en and ar),
  `commission.disclosure`, `ai.assistant_identity`,
  `claims.guidance_informational`, `telemarketing.optout`. Two of those are the
  UI-facing halves of platform rules: `ai.assistant_identity` is the record that
  an AI interlocutor identified itself as AI, and `quote.ranking_criteria` is the
  snapshot of the criteria shown alongside a ranking.
- **The `criteriaJson` column is the point of the tab and is rendered as
  truncated monospace JSON at 60 characters.** On the record screen it is the same
  truncated string, not a formatted object. The thing an auditor came to read is
  the thing this screen shows least well.
- **AI surfaces.** None on the screen. Note the inversion worth designing for:
  one row here *is the evidence that AI disclosed itself*, and the screen renders
  it as an unremarkable text key. No ✦ belongs on the row (the row is not
  AI-generated), but `ai.assistant_identity` deserves to be legible as what it is.
- **Mobile.** Web only.
- **RTL.** The list mirrors. Rows with `locale: "ar"` contain Arabic wording
  references; the `key` and `wordingRef` are ASCII identifiers and must not
  mirror. A screen listing both an `en` and an `ar` disclosure side by side is
  the normal case here, so per-cell direction matters more on this tab than
  anywhere else.
- **Weak today.**
  1. No filters. Not by key, not by locale, not by channel — on a table whose
     rows differ mainly by key and locale.
  2. `wordingRef` points at a wording version that the UI cannot resolve or
     display. You can see that version `v3` was shown and never see what `v3`
     said.
  3. `criteriaJson` truncated at 60 chars, in both the list *and* the record.
  4. The en/ar pair of the same disclosure appears as two unrelated rows.

### 7.4 `screenings` — "Screenings"

- **Who.** read `compliance:screenings:read` (tenant.compliance, tenant.admin).
  **No create** — a screening is the provider's answer and `queryHash` is computed
  from the question, never typed. Attempting the generic create returns 400
  naming the run endpoint. **No update, no delete.**
- **Purpose.** Every screening that was requested, its result, and what it
  matched on.
- **Sort.** `ts` descending. **Filters.** *Result*: Clear, Hit, Inconclusive.
  *Kind*: Sanctions, Politically exposed, Adverse media, Fraud.
- **Columns.** Subject (`subjectRef`, **the link**) · Kind · Provider (`provider`
  — **always the literal string `stub`**) · Result (badge) · Disposition ·
  Dispositioned by · Case reference · Blocked (boolean → "Yes"/"No") · When
  (datetime, sortable) · Hits (`hitsJson`, json, last).
- **The provider column reads `stub` on every row and the screen says nothing
  about what that means.** The run screen carries a whole warning panel; this
  list carries none. A person landing here from a link has no way to know the
  results are not watchlist checks. That is the single most important fix on this
  tab, and the copy already exists on the run screen and can be reused verbatim.
- **The disposition can be seen and never set.** Four seeded rows carry
  dispositions (`false_positive`, `escalated`, `confirmed`) and one row is
  `blocked: true` with **no disposition** — the subject `name:northline recovery
  services` is blocked and, in the shipped product, cannot be unblocked, because
  the tab declares no `update` and there is no disposition endpoint. Design must
  not imply an action that does not exist; the honest interim is to show the
  blocked state prominently and say what would clear it.
- **AI surfaces.** None. Correct.
- **Mobile.** Web only.
- **RTL.** Mirrors. `subjectRef` (`name:amina saleh`, `customer:cus_…`) and the
  `hitsJson` blob must not.
- **Weak today.**
  1. No stub warning on the list or the record (above).
  2. **The result badge is grey for every value.** `clear`, `hit` and
     `inconclusive` are all outside the shared tone table, so a hit renders in the
     same neutral chip as a clear — while the *run screen* renders the same hit in
     danger red. The two screens contradict each other.
  3. `blocked` renders as the word "Yes" in a plain cell. The most alarming fact
     in the table is its least visible.
  4. No disposition affordance anywhere (above).
  5. `hitsJson` truncated to 60 chars; the matches table that the run screen
     renders properly is not available for a historical row.

### 7.5 `retention-runs` — "Retention runs"

- **Who.** read `compliance:retention:read` (tenant.compliance, tenant.admin).
  **No create** — the row is what a purge did. No update, no delete.
- **Purpose.** The record of every purge: what class, which table, which cutoff,
  how many rows went, how many a hold kept.
- **Sort.** `startedAt` descending. **Filter.** *State*: Running, Done, Failed.
- **Columns.** Policy (`policyKey`, **the link** — always the literal `messages`)
  · Table (`tableName`) · Cutoff (`cutoffAt`, datetime) · Rows affected (number) ·
  Rows held (number) · State (badge) · Started (datetime, sortable).
- **Badge tones here actually work**: `running` → info, `done` → success,
  `failed` → danger. This is the only compliance tab whose badge column carries
  real meaning, and it is the one to copy from.
- **Note the asymmetry with the run screen.** A **preview** writes no row here at
  all — only a purge does. So this tab is a list of deletions, never of intentions.
  That is right, and the tab should read as a deletion log.
- **AI surfaces.** None.
- **Mobile.** Web only.
- **RTL.** Mirrors; `orbit_messages` and `messages` do not.
- **Weak today.**
  1. **The h1 of the record screen is the word "messages".** Every record in this
     tab has the same heading, because the first column is `policyKey` and there
     is only one class.
  2. A failed run carries an error string in the data that no column shows. The
     row says "Failed" and nothing else.
  3. `rowsHeld` names no hold. Same gap as the run screen.
  4. Nothing links a run to the audit entry or the actor that started it.

### 7.6 `legal-holds` — "Legal holds"

- **Who.** read `compliance:legal_holds:read` · create/update/**remove** all
  `compliance:legal_holds:write`. Both are held only by **tenant.compliance**;
  tenant.admin reads and cannot write.
- **Purpose.** Freeze deletion for a subject, and record who placed it and on
  whose authority.
- **Sort.** `createdAt` descending. **Filters.** None.
- **Columns.** Subject (`subjectRef`, **the link**) · Reason · Authority · Placed
  by · Released by · Released (datetime) · Created (datetime, sortable).
- **Create form** (`New — Legal holds`): Subject `text` **required** · Reason
  `textarea` (3 rows) **required** · Authority `text` optional. **`placedBy` is
  not a field** — the API stamps it from the session and rejects a body that
  carries it. Same rule to design around: never offer an input for "who did this".
- **Edit form**: the same three fields.
- **Subject reference shapes that actually work.** A hold only bites on the
  retention purge when its `subjectRef` is `conversation:<id>` or
  `customer:<id>`. The five seeded holds cover a customer, a case, a provider, a
  channel and a policy — **three of those five hold nothing**, because the purge
  only matches the two conversation/customer forms. The form is free text with no
  hint, no format help and no validation, so an officer can place a hold that
  silently protects nothing.
- **A hold outlives the cutoff.** However old a held row is, the purge skips it
  and counts it as held. Releasing the hold is what lets it go.
- **Actions and consequences — the release is gated.** Delete on this record runs
  through the `compliance.legal_hold_release` approval policy, which is
  **dual-control** and **never auto-approvable**: one person requests, a second
  decides, and no tenant allowlist can automate it. The UI today gives the
  standard delete affordance — a small danger "Delete" button with the browser
  `confirm()` "Delete this record? It is retained for audit and can be restored by
  an administrator." — and the approval happens behind it, in `/approvals` (§8). **The
  button's copy does not mention the approval at all**, which understates what
  pressing it does: it does not release the hold, it *asks* to.
- **AI surfaces.** None.
- **Mobile.** Web only.
- **RTL.** Mirrors. `conversation:cnv_…` / `customer:cus_…` must not.
- **Weak today.**
  1. `subjectRef` is unhinted free text where only two prefixes are load-bearing.
     This is a correctness bug wearing a design costume.
  2. The delete button says "Delete" and means "request a release, subject to a
     second approver". Wrong verb, wrong expectation.
  3. Released and live holds are in one undifferentiated list — `releasedAt` is a
     column, not a state, so there is no badge and no filter. A hold released last
     year sits between two live ones.
  4. Nothing shows what a hold is currently holding: no row count, no link to the
     conversation or customer, no "this hold kept 6 rows in the last run".
  5. `reason` is a textarea on input and a truncated single-line text cell on
     output.

### 7.7 `evidence-bundles` — "Evidence bundles"

- **Who.** read `compliance:evidence:read` — **tenant.compliance,
  tenant.admin and finance.controller**. This is finance.controller's landing
  screen for the whole workspace. **No create** (hashes are computed over the
  archive, so a typed hash describes nothing), no update, no delete: re-export
  rather than amend, so the hash still describes what was handed over.
- **Purpose.** Every bundle that was assembled, its hash, and what it covered.
- **Sort.** `createdAt` descending. **Filters.** *State*: Building, Ready,
  Delivered, Failed. *Purpose*: Regulator, Audit, Dispute, Internal.
- **Columns.** Purpose (**the link**) · State (badge) · Requested by · Approved by
  · Delivered to · Bundle hash · File (`fileId`) · Created (datetime, sortable) ·
  Scope (`scopeJson`, json) · Manifest (`manifestJson`, json).
- **`requestedBy` is an actor column** — stamped from the session, refused in a
  body. **`approvedBy` is always null**: nothing in the product sets it, and the
  column renders an em-dash on every row that will ever exist. **The `delivered`
  state is unreachable**: it is in the filter, it is on one seeded row, and no API
  route can set it.
- **`fileId` is null on every seeded row**, which is what makes those bundles
  undownloadable. The record screen shows an em-dash in the File cell and offers
  no download control at all. The truthful design is an explicit statement on the
  record — *no archive is stored for this bundle; export again to produce one* —
  rather than the current silence. That copy has to be written; it does not exist.
- **AI surfaces.** None.
- **Mobile.** Web only.
- **RTL.** Mirrors. Bundle hash, file id, and both JSON blobs must not.
- **Weak today.**
  1. **The h1 of the record is the purpose** — every regulator bundle is headed
     "regulator". Three seeded bundles share a heading.
  2. No download button on the record screen. The only download in the product is
     on the run screen, immediately after building — so a bundle you built
     yesterday cannot be fetched from the UI even when its archive exists.
  3. `bundleHash` is a 64-character hex string in a table cell, truncated at 80
     characters of plain text with no copy affordance, no monospace, and no
     wrapping treatment — unlike the run screen, which gets all three right.
  4. Two columns (`approvedBy`, and `state: delivered`) describe a workflow the
     product does not have. Either build it or stop showing it.
  5. `manifestJson` — the per-file hash list an auditor checks the archive
     against — is a 60-character truncated string.

### 7.8 `incidents` — "Incidents"

- **Who.** read `compliance:incidents:read` · create/update/remove
  `compliance:incidents:write` (tenant.compliance only; tenant.admin reads).
- **Purpose.** Log an incident, its severity, whether agents were paused, when it
  was notified, and how it ended.
- **Sort.** `createdAt` descending. **Filters.** *State*: Open, Mitigated,
  Resolved, Review. *Severity*: Level 1–4. *Kind*: Outage, Data, Model, Security,
  Regulatory.
- **Columns.** Title (**the link**) · Kind · Severity (badge) · State (badge) ·
  Agents paused (boolean) · Notified (datetime) · Created (datetime, sortable).
- **Create form**: Title `text` **required** · Kind `select` **required** (5
  options) · Severity `select` (4 options, not required) · Summary `textarea` ·
  Affected `textarea` monospace **JSON** (6 rows) · Notifiable `datetime-local`.
  `openedBy` is an actor column and is not a field — whoever files the incident is
  the person logged in, and that is not something you get to type.
- **Edit form**: State · Severity · Summary · Agents paused (checkbox) · Notified
  · Resolved · Review reference.
- **`agentsPaused` is a checkbox on an incident record, and it is a report, not a
  switch.** The kill switch itself lives in the AI/admin surfaces
  (`ai:killswitch:use`, which `tenant.compliance` holds). Ticking this box records
  that agents were paused; it does not pause them. Do not design it as a control.
- **Notification, honestly.** `notifiableAt` and `notifiedAt` are two nullable
  timestamps a human types. There is no timer, no countdown, and no statutory
  clock — and the product must not draw one. `docs/12` describes an incident
  runbook as a **process**, and the fields here are the record that the process
  ran, nothing more.
- **AI surfaces.** None. Note the gap: an incident of kind `model` is the one
  place in COMPLIANCE where AI behaviour is under review, and the screen has no
  link to the agent, the run, or the eval that is at issue.
- **Actions and consequences.** Delete is a **soft delete** with the standard
  `confirm()`: the record leaves the live list, is retained for audit, and can be
  restored by an administrator via `?deleted=1`. Not irreversible.
- **Mobile.** Web only.
- **RTL.** Mirrors. `affectedJson` and `postmortemRef` do not.
- **Weak today.**
  1. **Severity is a badge that is grey at every level.** `sev1` through `sev4`
     are outside the tone table, so a Level 1 incident and a Level 4 incident are
     visually identical. On an incident list, this is the worst instance of the
     grey-badge problem in the workspace.
  2. **State is grey at every value too** — `open`, `mitigated`, `resolved` and
     `postmortem` all render neutral.
  3. Severity is optional on create. An incident can exist with no level.
  4. `affectedJson` is a raw JSON textarea. The person filing an incident at 2am
     is hand-writing JSON.
  5. No timeline. Created, notified, resolved are three cells in a grid, not a
     sequence.

### 7.9 `rulepack-applications` — "Rulepack applications"

- **Who.** read `compliance:rulepacks:read` (tenant.compliance, tenant.admin).
  **Machine-written**: the rule engine writes a row as it applies a rule, under
  `compliance:rulepacks:apply`. No create — a hand-typed record of what a rule
  decided is not a record of what the rule decided.
- **Purpose.** Which rulepack version was in force for a decision, and what it
  decided.
- **Sort.** `ts` descending. **Filter.** *Outcome*: Pass, Fail, Not applicable.
- **Columns.** Subject (`subjectRef`, **the link**) · Rulepack (`rulepackId`) ·
  Rule (`ruleKey`) · Outcome (badge) · When (datetime, sortable).
- **What is in here.** Seven seeded rows; one is a `fail` on
  `telemarketing.quiet_hours` — the encoded guardrail that, per `docs/12`, cannot
  be configured below its floor. That row is the product proving a guardrail
  fired.
- **AI surfaces.** None.
- **Mobile.** Web only.
- **RTL.** Mirrors. `telemarketing.quiet_hours`, `rulepackId` and `subjectRef` do
  not — they are dotted machine keys.
- **Weak today.**
  1. **`pass` and `fail` both render grey.** The tone table contains `failed`, not
     `fail`, so the one column that says whether a rule was broken has no colour
     at all. A one-word vocabulary mismatch erases the entire signal.
  2. `ruleKey` is shown and never explained. There is no link to the rulepack, no
     rule text, no version note.
  3. No date filter on a tab that will grow faster than any other here.
  4. A failure is a dead end: no link to the subject it fired on, no way to
     acknowledge or annotate it.

### 7.10 `policy-thresholds` — "Thresholds"

- **Who.** read `compliance:thresholds:read` · create/update/remove
  `compliance:thresholds:write` (tenant.compliance; tenant.admin reads).
- **Purpose.** The versioned numbers the rest of compliance runs against —
  including the tenant's own subject-request service target.
- **Sort.** `effectiveFrom` descending. **Filters.** None.
- **Columns.** Key (text, **sortable**, **the link**) · Version (number) · Value
  (`valueJson`, json) · Dual control (boolean) · Effective from (date, sortable) ·
  Effective to (date) · Set by (text).
- **Create form**: Key `text` **required** · Version `number` **required** · Value
  `textarea` monospace JSON (6 rows) **required** · Effective from `date`
  **required** · Effective to `date` · Dual control checkbox. `setBy` is an actor
  column — who moved the limit is the session, not a name the mover picks.
- **Edit form**: **only** Effective to and Dual control. A threshold's key,
  version and value are immutable after creation, because "what was the limit in
  March" is an audit question: a new threshold is a new **version**, not an edit.
  Design the create panel as *supersede*, not *add*.
- **This is where the DSAR service target lives.** The seeded row:

  ```
  key             compliance.dsar_service_target
  version         1
  value           { "days": 30, "warnAtDays": 25, "escalateTo": "tenant.compliance" }
  dual control    No
  effective from  ~300 days ago
  effective to    —
  set by          (the compliance officer)
  ```

  **Say plainly, wherever this is surfaced: 30 days is this tenant's own service
  target.** It is a row in a table the tenant edits. It is not a statutory clock,
  and the product must never present it as one.
- **AI surfaces.** None. Correct — a threshold is a number a human set, and its
  provenance is the point.
- **Actions and consequences.** Delete is soft with the standard `confirm()`.
  `dualControl` is a flag recorded on the threshold; it does not itself gate this
  screen's writes.
- **Mobile.** Web only.
- **RTL.** Mirrors. The key (`compliance.dsar_service_target`) and the JSON value
  must not.
- **Weak today.**
  1. **The value — the whole content of the row — is a 60-character truncated
     monospace string** in the list *and* on the record. `{"days":30,"warnAtDays":25,…`
     is what an officer sees of the target they are supposed to manage.
  2. Superseding is manual: the officer must remember to set the old row's
     "Effective to" and to type the next version number by hand. Nothing validates
     that versions are sequential, that windows do not overlap, or that a key has
     exactly one row in force today.
  3. There is no "currently in force" view. The list is every version of every
     key, sorted by date, with no grouping by key and no filter.
  4. Nothing links a threshold to what consumes it. `compliance.dsar_service_target`
     drives the `dueAt` on every subject request and neither screen mentions the
     other.

---

## 8. The approvals queue — `/approvals`

This screen is not part of the COMPLIANCE workspace and carries no
`compliance:*` permission of its own. It is in this brief because **it is where
compliance's two gated actions are actually decided**. A designer who redraws the
erasure or legal-hold surfaces without knowing what this screen looks like will
design half a flow.

**Route + title.** Path `/approvals`, inside the signed-in shell (§3.1), so it
gets the chrome band, the Meridian scrubber and the module rail like any
workspace screen. It gets **no breadcrumb**: the trail is built from nav entries
and this screen has none, so the canvas opens straight on the h1 under the
module-hue rule. Page h1: **"Approvals"** (`--font-serif`,
`text-22`, `leading-[1.2]`), with a one-line lede under it in `--font-ui`
`text-13` muted. Like the run screens, this screen owns its own bilingual label
table rather than reading the workspace catalogue — but it resolves through the
shared vocabulary first, so words the whole platform already says (Apply, Clear,
Next, Approved) come out identical to everywhere else, and a tenant's domain pack
can rename them.

**How you get here.** There is **no nav-rail entry for `/approvals`**. The only
in-product link is the **shift rail** at the top of the module rail (§3.1): each
queued item there is a link to this screen. Everything else arrives by URL, by
the account menu, or from a screen that just raised a request.

### 8.1 The rule this screen exists to enforce

Any action tagged `consequential: true` needs a person before it takes effect.
A tenant may automate one **only** if two things are true at once: tenant policy
automates that policy key **and** the key is on the tenant's `auto_approve`
allowlist. A policy declared `neverAutoApprove` ignores the allowlist entirely —
no tenant setting can make it self-approve.

Both compliance policies are of that last kind:

| Policy key | Deciding permission | Approvers | Auto-approvable? |
|---|---|---|---|
| `compliance.erasure` | `compliance:erasure:execute` | dual control, always | **never** |
| `compliance.legal_hold_release` | `compliance:legal_holds:write` | dual control, always | **never** |

Both are registered under module `core`, not `compliance` — which is why the
**Area** field on a compliance card reads **"Shared services"**, not
"Compliance". That is the only place in this brief where a compliance action
names a different area, and it is worth knowing before you read it as a bug.

There is **no `compliance.retention_purge` key**. The permanent purge (§6) never
appears on this screen at all.

### 8.2 Who sees what

| Actor | Pending view | Approved / Rejected views |
|---|---|---|
| anyone with a session | their own queue | not offered |
| holder of `core:approvals:read` | their own queue | the whole tenant's decided rows |

The two halves come from two different endpoints and that difference is visible:

- **Pending** reads `GET /v1/me/inbox`, the only endpoint that answers "what is
  waiting on *this* actor". It keeps a request when the actor holds the policy's
  deciding permission **or** holds a delegation for it — so a delegate with no
  permission of their own still sees the row. No permission is needed to open the
  screen; an actor who can decide nothing simply has an empty queue.
- **Approved / Rejected** read the tenant-wide list and are gated on
  `core:approvals:read`. Without it those two options are **not rendered in the
  state dropdown at all** — an option that could only 403 is not offered.

For compliance specifically: of the fourteen roles in §2.2, the erasure and
legal-hold-release cards appear only for **`tenant.compliance`**, because those
are the two permissions the policies name.

### 8.3 Layout

```
┌───────────────────────────────────────────────────────────────────────────┐
│ Approvals                                                  (h1, serif 22)  │
│ 3 waiting on a decision.                            (lede, ui 13, muted)   │
│                                                                            │
│ ┌ State ─────────────┐                                                     │
│ │ Awaiting decision ▾│  [ Apply ]   Clear            (GET form, wraps)     │
│ └────────────────────┘                                                     │
│                                                     (status line, success) │
├───────────────────────────────────────────────────────────────────────────┤
│ ┌── Card (flat) ────────────────────────────────────────────────────────┐  │
│ │ Compliance erasure          ✦ Raised by an agent  ● Awaiting decision │  │
│ │ dsar-requests:dsr_01J8…                              (card description)│ │
│ │                                                                        │ │
│ │ Area              Shared services   Subject      dsar-requests:dsr_01J…│ │
│ │ Requested by      Amina Saleh       Amount       —                     │ │
│ │ Requested         14 Aug 2026 09:12 Authority expires  Set when decided│ │
│ │ Approvers         Two people: whoever raised this may not decide it.   │ │
│ │ ┌── "Why this needs approval" (surface-2, bordered) ────────────────┐  │ │
│ │ │ rows            412          scope          orbit_messages        │  │ │
│ │ │ requestedReason "subject asked for deletion"                      │  │ │
│ │ └───────────────────────────────────────────────────────────────────┘  │ │
│ │ Open the run — compliance.erasure-drafter                              │ │
│ │ ─────────────────────────────────────────────────────────────────────  │ │
│ │ Reason                                                                 │ │
│ │ ┌──────────────────────────────────────────────────────────────────┐   │ │
│ │ │ (textarea, 2 rows, max 2000)                                     │   │ │
│ │ └──────────────────────────────────────────────────────────────────┘   │ │
│ │ Required to reject, kept with the decision in the audit log.           │ │
│ │ [ Approve ]  [ Reject ]                                                │ │
│ └───────────────────────────────────────────────────────────────────────┘  │
│ … one card per request, `gap-4`, in a labelled list ("Requests")           │
├───────────────────────────────────────────────────────────────────────────┤
│ 3 rows                                                        [ Next ]     │
└───────────────────────────────────────────────────────────────────────────┘
```

### 8.4 The lede is a count, not a blurb

Same discipline as the run screens (§4). One sentence under the h1, and it is
always the truest thing the screen can say:

| Condition | Lede |
|---|---|
| the list could not be read | "This queue could not be read just now." |
| readable and empty | "Actions that need a person before they take effect. A decision is final and is written to the audit log." |
| pending, non-empty | "{count} waiting on a decision." |
| decided, non-empty | "{count} decisions marked {state}." |

Nothing is invented: the "could not read" case covers both "not my permission"
and "the API refused", because the queue has one honest thing to say either way.

### 8.5 The state filter

A `GET` form: one `<Select>` labelled **"State"**, an **Apply** button, and a
ghost **Clear** link that appears only once `state` or `cursor` is in the URL.
Options are "Awaiting decision" / "Approved" / "Rejected"; the last two are
filtered out entirely for an actor without `core:approvals:read`. The filter is a
navigation, not a fetch — the URL is the state, so a decided view is linkable and
back works.

### 8.6 The card

Flat elevation. Everything below is per request.

- **Title** — the policy key humanised, with its own module prefix stripped:
  `compliance.erasure` under module `core` keeps its prefix and reads
  **"Compliance erasure"**; `compliance.legal_hold_release` reads **"Compliance
  legal hold release"**. The shift rail titles the same request with the same
  words, deliberately.
- **Description** — the subject reference as text.
- **Badges, top-right** —
  - the single **✦** marker with the label "Raised by an agent", present when the
    request was raised by an agent identity **or** when an AI run is linked to it;
  - the decision state, dotted: Awaiting decision (**warning**), Approved
    (**success**), Rejected (**danger**). Unlike almost every compliance badge
    (§11), all three of these carry a real tone.
- **The `<dl>`** — two columns from `sm` up, `gap-x-8 gap-y-3`; term in
  `text-12` subtle, value `text-13`:

  | Term | Value |
  |---|---|
  | Area | the module as a person reads it ("Shared services" for both compliance policies) |
  | Subject | see below |
  | Requested by | the actor's **name**, resolved from a batch lookup, not the stored `kind:id` ref |
  | Amount | formatted money when the request carries one; a bare tabular number when an amount arrived with no currency anywhere (never dressed up as money); `—` when there is none. Compliance requests carry none. |
  | Requested | date + time, locale calendar, minute precision |
  | Authority expires | see §8.8 |
  | Approvers | "Two people: whoever raised this may not decide it." or "One approver." |
  | Decided by / Decided / Reason | present only once decided |

- **Subject, three ways.** A change to an existing row links to that row's record
  screen, in mono `text-12`, `break-all`. A request that would *create* the row
  has nothing to link to and says so: **"No record yet — approving this is what
  creates it."** A subject a hand-written engine named its own way is rendered as
  words rather than as a stored key, unlinked — a link that 404s is worse than no
  link.

### 8.7 "Why this needs approval" — the inspectable panel

A bordered `surface-2` block headed **"Why this needs approval"**, present
whenever the gate recorded any context beyond the four fields the card already
shows itself (amount, currency, dual-control flag, expiry). Inside: a two-column
`<dl>` of every remaining key the gate wrote — thresholds, row counts, the quoted
reason, what changed. Any key ending in `Minor` renders as money in the request's
currency; everything else renders as text, with objects serialised.

**This is the "why" the ambient AI grammar requires** and it is the only one on
this screen. Two things about it a designer should know:

- **The terms are raw keys.** `requestedReason`, `rowCount`, `scopeTable` appear
  as written by the gate, untranslated, in both locales. There is no label table
  behind this panel and there cannot be a complete one — the keys are whatever
  the policy chose to record.
- **It is not AI-specific.** A human-raised request with recorded context shows
  the same panel. The ✦ says who asked; this panel says why the rule fired.

**The run link.** When the request has an AI run behind it *and* the actor holds
`ai:runs:read`, one line follows the panel: **"Open the run — `<agentKey>`"**,
linking to `/admin/ai/console?run=<id>` — the AI console, which is where the
`ai_audit_log` is read (§10). Without that permission the ✦ still shows and the
link does not: the marker comes from who asked, the link from a lookup that may
be refused. A failure of that lookup costs the link and nothing else — never the
queue.

### 8.8 "Authority expires" — what the field actually means

`core_approvals` has **no expiry column**. What lapses is not the request but the
authority a decision grants: the gate re-asks once a decision is older than
**24 hours**.

- A **pending** request therefore shows **"Set when decided"** — no countdown,
  because a countdown here would be invented.
- A **decided** one shows *decided-at plus 24 hours*, unless the gate recorded an
  explicit expiry in its context, which wins.

For compliance this matters: an approved erasure that sits unexecuted for a day
must be asked for again.

### 8.9 Deciding

- **Dual control blocks the initiator.** When a request is pending, dual-control,
  and raised by the actor reading it, the whole decide form is **absent** and one
  `role="note"` line stands in its place: *"You raised this request, and this rule
  needs a second person to decide it."* The evidence above stays — they still need
  to read it to know who to chase. Withholding is absence, not a disabled button.
  Because both compliance policies are dual-control always, **every compliance
  officer who raises an erasure sees exactly this**, and a second
  `tenant.compliance` holder is required. A single-officer tenant cannot complete
  an erasure. That is the design, not a bug — but it must be said at onboarding,
  and nothing in the product says it today.
- **The form.** A "Reason" textarea (2 rows, 2000 characters) with the hint
  *"Required to reject, kept with the decision in the audit log."*, then
  **Approve** (primary) and **Reject** (danger).
- **Reason is optional to approve, required to reject.** The field is not marked
  `required`, because the rule is asymmetric. Pressing Reject with an empty reason
  shows the field error *"Say why you are rejecting this."* and posts nothing.
  The rule itself lives in the API; the client check is a courtesy, not a second
  copy that could drift.
- **Reject also confirms.** A confirm step carries *"Reject this request? A
  decision cannot be undone."* Approve has no confirm.
- **One at a time.** Only the pressed card's buttons show the loading state; every
  button on the screen disables while a decision is in flight. There is no bulk
  decide, because the API offers none — and a bulk decision the screen faked
  would be a decision nobody made.

**Announcement.** A single `role="status" aria-live="polite"` line under the
filter, in success colour, says either *"Approved. The action may now proceed."*
or *"Rejected. The action will not proceed."* — and only after the API has
confirmed. Nothing on this screen claims an outcome it has not been told.

### 8.10 Empty, degraded and error states

| Situation | What renders |
|---|---|
| pending, readable, zero rows | **the ShiftClear screen** (§8.11) — not an empty state |
| pending, unreadable | `EmptyState`, body *"The queue could not be read just now."* |
| decided view without `core:approvals:read` | `EmptyState`, body *"Decisions across the tenant are not yours to read, so this list stays empty."* |
| decided view, readable, zero rows | `EmptyState`, body *"No decisions in this state yet."* |
| a decision that was refused | the API's own problem message renders **inside the card it refused**, above the buttons |
| a decision on a row no longer in the list | the same problem, rendered once at the top of the screen |
| the session expired | not this screen's business — a 401 is rethrown and the layout sends the actor to sign in |

Below the list, always: a row count in `text-12` tabular, and a **Next** button
when the API returned a cursor. The decided views page at **25 rows**; the
pending view has no Next at all — the inbox answers with the newest **100**
pending requests in the tenant, filtered to the ones this actor can decide, and
that is the whole list. A tenant that ever exceeds it loses the oldest rows
silently.

### 8.11 "Shift clear" — the one empty list that is an achievement

A readable, empty **pending** queue does not get the ordinary empty state. It
gets a full-width composition, left-aligned, that reads as the end of a shift:

- a pulsing 6px accent dot beside the eyebrow **"SHIFT CLEAR"** (9.5px, uppercase,
  `tracking-[0.18em]`);
- a serif headline at **40px/1.22**, max 20 characters wide: **"Nothing is waiting
  on you."**;
- a 15.5px body at `leading-[1.7]`, max 62 characters: *"Every request that needed
  your decision has one. Anything raised from here — by a person or by an agent —
  lands on this screen the moment it is raised, and the rail keeps the count while
  you work elsewhere."*;
- a three-cell figure strip (hairline grid, mono 21px figures over 9.5px uppercase
  labels): **Decided today**, **Still waiting**, **Notices**. The strip renders
  only when those counts could be read — a rail that says "0 of 0" because a fetch
  failed is a lie, and an absent strip is not;
- a closing 13px muted line: *"A decision is final and is kept in the audit log, so
  an empty queue is a closed day, not a cleared one."*;
- and, for an actor with `core:approvals:read`, a secondary button **"See what you
  decided"** to the Approved view.

Figures are locale-formatted, so an Arabic page shows Eastern Arabic digits.

### 8.12 The same rows, read a second way

ADMIN's generic list carries an `approvals` tab on `/v1/core/approvals` — the raw
table, columns `policyKey / subjectRef / module / decision / reason / contextJson
/ requestedBy / requestedAt / decidedBy / decidedAt`, gated on
`core:approvals:read`, filterable by decision. It is a **read-only ledger of the
queue**: no decide affordance, references unresolved, context a truncated JSON
blob. Deciding happens here, on `/approvals`, where the context is rendered.

### 8.13 RTL, i18n and accessibility

- Both locales are fully populated for this screen. The only untranslated text is
  the **key column of the "why" panel** (§8.7) and the agent key on the run link —
  both machine identifiers.
- Mirrors: the filter bar, the card grids, the badge row, the button row, the
  ShiftClear composition, the footer row.
- Must **not** mirror: the subject reference, record ids and ULIDs, the agent key,
  and every value in the "why" panel that is an identifier or a table name. Each
  needs `dir="ltr"` on the content with the cell keeping `text-align: start`.
- The list is a labelled list ("Requests"); the card carries the record id in an
  `sr-only` line; the announcement is `role="status"`, the refusal `role="alert"`
  via the shared problem block, and the dual-control notice `role="note"`.

### 8.14 Weak today

1. **A single-officer tenant cannot complete an erasure or release a legal hold**,
   and nothing on any screen warns them before they try.
2. **The "why" panel's terms are raw keys** in both locales.
3. **The pending queue is ordered newest first**, so the request that has waited
   longest is the last one on the screen — and past 100 pending rows in the
   tenant, it is not on the screen at all. Nothing marks age beyond the raw
   "Requested" timestamp: a request raised an hour ago and one raised last week
   look identical.
4. **No way to reach this screen from the nav** unless the shift rail happens to
   have an item in it.

---

## 9. Public subject-request intake — `/portal/:tenantSlug/privacy`

The one compliance surface a **member of the public** can use. It has no session,
no shell, no rail, no Meridian — nothing but the tenant slug in the URL. It is the
front door of the queue described in §7.1, and a designer reading that section
without this one will think requests arrive only from staff.

**Route + title.** Path `/portal/:tenantSlug/privacy`. Document title
`"<Tenant> — privacy"`. Every colour on the page comes from the tenant's brand
tokens read from the public site endpoint; no LYRA string appears anywhere
(CLAUDE.md §5).

**Who sees it.** Anyone with the link. No permission, no account, no token.

**Layout.** A single centred column, `max-w-2xl`, `p-6`, on the tenant's own
background:

```
┌──────────────────────────────────────────────────────────┐
│ [tenant logo]  Your privacy rights          (h1 serif 22)│
│                Ask to see, correct, or delete the        │
│                personal data held about you. We will     │
│                confirm your identity before we act on    │
│                the request.                  (ui 13)     │
│                Back to products              (link 13)   │
├──────────────────────────────────────────────────────────┤
│ What would you like to do?                               │
│  ( ) See the data held about me            ← default     │
│  ( ) Delete my data                                      │
│  ( ) Correct something that is wrong                     │
│  ( ) Get a copy I can take elsewhere                     │
│  ( ) Object to how my data is used                       │
│  ( ) Restrict how my data is used                        │
│                                                          │
│ Email address you deal with us on          (required)    │
│ [                                        ]               │
│ Full name (optional)                                     │
│ [                                        ]               │
│ Anything that helps us find your records, or what needs  │
│ correcting (optional)                                    │
│ [                                        ] (4 rows)      │
│                                                          │
│ [ Turnstile widget — only if a site key is bound ]       │
│                                                          │
│ [ Send request ]                                         │
├──────────────────────────────────────────────────────────┤
│ Back to products                                         │
└──────────────────────────────────────────────────────────┘
```

**The six rights.** The radio group maps one-to-one onto the `type` column of the
subject-request queue (§7.1): `access`, `erasure`, `rectification`, `portability`,
`objection`, `restriction`. **`access` is preselected.** Every option is written
as an action in the first person, not as a legal term — the queue shows the legal
term, the portal shows the plain one, and the mapping is fixed.

**Fields.** Email is `type="email"`, `autocomplete="email"`, required. Name and
details are optional; details is capped at 2000 characters and name at 200. Both
optional fields are folded into a single note on the stored row (name prefixed
"Name given:"), so a designer should read them as *one* free-text hint, not two
structured columns.

### 9.1 The Turnstile challenge

- **It renders only when a site key is bound.** In local development, on-prem, CI,
  or any zone where the Cloudflare configuration has not been applied, the widget
  is simply **absent** — no placeholder, no explanatory text, no gap.
- The widget writes a hidden token into the form; the route forwards it with the
  submission. It follows the page locale and the viewer's colour scheme.
- **The server half is separate and fails closed.** With no secret bound, nothing
  is challenged. With a secret bound, a submission carrying no token is refused,
  and an unreachable or unhappy verification service refuses the submission rather
  than waving it through.
- **Order matters when switching it on**, and it is a visible-to-users detail: the
  secret is the half that refuses and the site key is the half that renders the
  widget. Secret first, and every one of these forms starts refusing.
- Rate limits sit in front of the challenge, not behind it: **3 requests per email
  address** and **10 per IP address**, both over a rolling **24 hours**.

### 9.2 Success

The form is **replaced** by a card headed **"Request received"** containing:

- a `role="status"` paragraph: *"Keep this reference. We will contact you on this
  email address to confirm your identity, then respond by {due}."*, with the due
  date formatted long in the page locale;
- and the reference itself, mono, under the label **"Reference"** — the request's
  own id, which is what staff will search on.

**About that date.** It is **30 days** out, and it is the **tenant's own service
target**, matching the stored threshold `compliance.dsar_service_target` (§7.10).
It is not a statutory deadline: `docs/12` states no statutory period, and this
product does not invent one. Any copy a designer adds here must not imply
otherwise.

The response is deliberately an *acceptance*, not a completion: what was accepted
is the request, not the outcome. Nothing is packaged or erased until a person
verifies the subject.

### 9.3 Errors

One `role="alert"` line above the form, in danger colour, from a fixed set:

| Cause | Message |
|---|---|
| rate limit hit | "Too many requests from this address — try again later." |
| challenge failed or missing | "The security check did not pass. Reload the page and try again." |
| a field the server rejected | "Check the highlighted fields and try again." |
| anything else | "Something went wrong. Please try again." |

The form keeps standing with its values; only the alert is added. There is no
per-field server error on this screen — the validation message names no field,
which is a real gap for the email format case.

### 9.4 What deliberately does not happen here

- **No identity verification.** The page collects no document, no ID number, no
  proof. `docs/12` names no verification method and the platform's identity-verifier
  seam has **no implementation**, so a request that verified nothing but claimed it
  had would be worse than one honest about the gap. The row lands with **no
  verification reference** in state **`received`**, and staff verify before anything
  is packaged or erased.
- **No account lookup is disclosed.** The intake tries to match the email to an
  existing customer, and a miss is neither an error nor mentioned. The response is
  **byte-identical** whether or not the address is known. Any design that
  distinguishes the two — a "we found your account" confirmation, a different
  success message, a slower path — turns this page into a customer-enumeration
  oracle. This is a hard constraint, not a preference.
- **No status lookup.** A subject holding a reference has nowhere to check
  progress; the reference is for quoting in email. A status page is **not yet
  built**.
- **No file upload, no attachments, no login.**

### 9.5 RTL, i18n and accessibility

- Both locales are fully populated, including every one of the six rights, every
  error and the success copy. This route carries its own table; there is no third
  locale.
- Direction comes from the document. The layout is a single column with logical
  spacing throughout, so it mirrors whole.
- Must **not** mirror: the reference code (mono) and the email address as typed.
- The radio group is a labelled group with a visible question above it; every field
  has a real `<label>`; the alert is `role="alert"` and the success paragraph
  `role="status"`; the submit button carries a loading label ("Sending…").
- **The Turnstile widget is third-party UI.** Its contrast, focus ring and language
  are not this design system's to control beyond the locale and theme hints passed
  to it. Do not draw it in a comp as though it were a Constellation component.

### 9.6 Weak today

1. **A rejected submission names no field.** "Check the highlighted fields" is
   shown while nothing is highlighted.
2. **A subject cannot check the status of their own request.**
3. **The success card is the only record the subject ever gets on-screen** — if
   they navigate away before copying the reference, it is gone. There is no
   "email me this reference" step. The intake publishes a
   `compliance.dsar-requests.created` event, but **nothing in the product
   subscribes to it today**, so no acknowledgement is sent by any channel.

---

## 10. AI surfaces, and the two audit trails compliance reads

### 10.1 Inside the workspace: no AI

**No screen under `/compliance` renders AI.** No ✦ marker on any of the ten tabs
or the three run screens, no ghost text, no quiet chip, no background draft, no
suggestion row. Nothing there is model-generated, so nothing there needs a "why"
panel, an inspect affordance or a kill switch on-screen.

Where its absence is **right**, and must stay right:

- **The screening result.** A stub answer must never look like a judgment, and a
  model must never manufacture one.
- **The retention purge.** Nothing model-decided may choose what gets deleted.
- **The evidence bundle.** The summary PDF is rendered from structured rows, not
  written. That is what makes the hash meaningful.
- **The erasure log and rulepack applications.** Machine records of what actually
  happened. Prose here would be a liability.

Where its absence is now a **gap**:

- **The subject-request queue** has no summarisation, no triage and — more
  basically — no urgency signal at all. Before adding AI here, add the clock.
- **The disclosures tab** cannot resolve a `wordingRef` to the wording that was
  shown. That is a data-linking problem, not a model problem.

If AI is ever added to a compliance surface, the platform rules apply without
exception: it maps to an existing ambient pattern or adds one via ADR; every
artifact carries the single ✦ marker and an inspectable "why"; AI identifies
itself as AI; there is a kill switch; and no AI output is ever the sole basis for
a consequential action here.

### 10.2 Where the ✦ does reach compliance work

The sentence "there is no AI in compliance" stops being true one screen out. On
**`/approvals`** (§8), a request an agent raised carries the single ✦ with the
label "Raised by an agent", the "Why this needs approval" panel, and — for an
actor with `ai:runs:read` — a link into the AI run behind it. Both compliance
policies are dual-control and never auto-approvable, so **an agent may raise an
erasure but no agent can complete one**: two named people decide, and that is the
whole point of the marker being there.

The workspace also holds the *record* of AI disclosure (`ai.assistant_identity`
in `disclosures`) and the *record* of agents being paused (`agentsPaused` on an
incident) — it observes AI governance without practising it.

### 10.3 The AI audit log — `/admin/ai/console`

The compliance officer holds `ai:audit:read`, `ai:runs:read`, `ai:agents:pause`
and `ai:killswitch:use`, so the AI console is a compliance surface even though it
lives under `/admin`. Its last card is the **AI audit log**, headed with the one
sentence that makes it safe to hand over whole:

> **"Content is never stored here — every row carries hashes only."**

- A compact table of the most recent **50** model calls: **When** (to the second),
  **Actor** (resolved to a name), **Module**, **Purpose** (humanised), **Model**,
  **Outcome** (a toned badge) and **Cost** (money, end-aligned).
- Every row is drawn in the **"sealed" row state** — the table's own visual
  vocabulary for a record nothing can edit.
- The **Model** cell is the evidence affordance: it opens a source panel headed
  **"Hashes"** carrying the input hash, the output hash, the provider and tier,
  the latency and the token counts. **Claim → source**: the row proves what
  happened by hash, never by content.
- **A reader without the permission gets no error and no empty table** — the card
  stands with one muted line, *"You do not have access to the AI audit log."* A
  section the actor may not read is absent, not broken.
- The console never loads prompt bodies or provider credentials at all. There is
  nothing on it to redact.

The same rows, unabridged, are also an ADMIN tab (`ai-audit-log`, gated on
`ai:audit:read`): the raw column set including subject reference, tool calls and
guardrail flags as JSON, filterable by tier and by outcome. Immutable in the API —
no create, no edit, no delete affordance is generated for it.

### 10.4 The platform audit trail — ADMIN's `audit-log` tab

Everything in this brief that changes state writes here, including every approval
decision (§8) and every subject request the public form creates (§9). The
compliance officer holds `core:audit:read` and `core:audit:export`.

- The surface is a generic list at `admin/audit-log`: columns **Action**,
  **Actor**, **Subject**, **IP**, **When**, sorted newest first.
- It is **hash-chained and append-only**, and the API refuses writes, so the list
  is generated with **no create button, no row menu and no delete** — an edit
  affordance here would be a defect, not a feature.
- **`core:audit:export` has no surface.** The permission exists and
  `tenant.compliance` holds it; nothing in the web app or the mobile app offers an
  export of the audit trail. Handing a regulator a file is **not yet built**.

---

## 11. The badge-tone problem (one consolidated finding)

Badge tones come from a single shared vocabulary. Compliance uses its own words
almost everywhere, so almost every compliance badge renders neutral grey:

| Tab | Column | Values | Rendered tone |
|---|---|---|---|
| dsar-requests | State | received, verifying, awaiting_legal, fulfilled, refused, expired | **all grey** |
| dsar-requests | State | in_progress | info |
| screenings | Result | clear, hit, inconclusive | **all grey** |
| retention-runs | State | running / done / failed | info / success / danger ✅ |
| evidence-bundles | State | building, ready, delivered | **grey** |
| evidence-bundles | State | failed | danger ✅ |
| incidents | Severity | sev1, sev2, sev3, sev4 | **all grey** |
| incidents | State | open, mitigated, resolved, postmortem | **all grey** |
| rulepack-applications | Outcome | pass, fail, not_applicable | **all grey** |

A screening `hit` renders red on the run screen and grey in the list. A Level 1
incident and a Level 4 incident are the same chip. A rule `fail` is the same chip
as a `pass`. This is a single mapping table away from being fixed, and it is the
cheapest large improvement available to this workspace.

---

## 12. Mobile

- **The Expo app has no compliance screens of its own.** It maps the
  `/compliance` nav item to exactly one collection: `compliance/dsar-requests`.
  Everything else in this brief is **web only**.
- What mobile renders for that one collection: a full-screen `FlatList` of cards.
  Each card is a tappable row (minimum 44pt target) with a title line and a
  subtitle line. A "Back" button sits above the heading — the stack draws no
  header, and an edge swipe is not a control every user can reach.
- **The card title is wrong for this resource.** Mobile picks a title from the
  first of `name, title, reference, subject, code, email, key, id` that the row
  has. A subject request has **none** of those — its identifier field is
  `subjectIdentifier` — so **every card is headed by its ULID**. The subtitle
  falls back to `state` or `type`, so a card reads roughly:
  `01J8XR…MB4` / `fulfilled`.
- The detail screen dumps **every field the API returns, in API order**, as
  label/value pairs with hairline separators. There is no per-resource layout, no
  badge, no formatting. Objects render as raw JSON.
- No create, no edit, no delete, no filters, no search, no run screens on mobile.
- Empty list: `list.empty`. Unmapped nav item: `nav.unavailable`. Errors render a
  notice with the request id and a "Retry" button.
- **Mobile parity note for any redesign:** the queue is the one thing an officer
  might genuinely want on a phone, and today it is a list of ULIDs. Fixing the
  title field list is a one-line change with a large payoff.

---

## 13. RTL and i18n

- Every string on every screen comes from a key. There are two locales today, `en`
  and `ar`, and **both are fully populated** for this workspace: every tab name,
  every column label and every enum value has an Arabic translation. Nothing in
  COMPLIANCE renders an untranslated key.
- Direction is a document-level `dir` attribute. Layout uses logical properties
  throughout (`ms-auto`, `border-e`, `text-start`) — there is no `margin-left`
  anywhere to flip.
- **What mirrors:** the sidebar side, the tab strip, the link strip, the filter
  bar, the table column order, the card and `<dl>` grids, the record back-link,
  every button row, the danger panels.
- **What must not mirror**, in every screen in this brief:
  - hashes (`bundleHash`, `queryHash`, per-file `sha256`)
  - identifiers and ULIDs (record ids, `dsarId`, `fileId`, `rulepackId`)
  - prefixed subject references (`name:…`, `customer:…`, `conversation:…`)
  - table names (`orbit_messages`, `core_consents`)
  - dotted machine keys (`compliance.dsar_service_target`,
    `telemarketing.quiet_hours`, `panel.data_sharing`)
  - file paths (`audit.jsonl`, `ai-audit.jsonl`, `summary.pdf`)
  - email addresses and phone numbers in the Subject column
  - every JSON blob
  Each needs `dir="ltr"` on the content while the cell keeps `text-align: start`.
- Numbers use `tabular-nums` and locale formatting; dates use the locale calendar.
  Keep numeric columns end-aligned in both directions.
- The font stacks carry `"IBM Plex Sans Arabic"` as the second family in both the
  display and UI roles. A tenant may override the typeface only from an approved
  list, and every entry on that list keeps the Arabic fallback. Do not propose a
  font that drops it.
- Accessibility floor: WCAG 2.2 AA. Every interactive element keyboard-reachable,
  visible focus ring (`outline-2 outline-offset-2` in the accent colour), body
  text contrast ≥ 4.5:1. Tables carry captions; the tab strip and link strip are
  labelled `<nav>` regions; alerts use `role="alert"` and status lines
  `role="status"`.

---

## 14. What is weak today — ranked

1. **The permanent purge has no approval gate.** The approvals registry has keys
   for erasure and legal-hold release, both dual-control, and **no key for the
   retention purge**. One person can permanently delete customer messages alone.
   The screen's own copy admits it. This is a policy gap, not a UI gap, but every
   design decision on that screen is downstream of it.
2. **The subject-request queue has no clock.** The tenant's target, its warn point
   and its escalation target are all stored and none of them are read. Due dates
   render as ordinary text.
3. **Almost every status badge is grey** (§11), including screening results and
   incident severity.
4. **Screening dispositions can be demanded and never recorded.** A hit blocks a
   subject, the UI says a disposition clears it, and no screen in the product can
   set one.
5. **The stub warning appears on exactly one screen.** The list and the record
   show `provider: stub` with no explanation.
6. **Evidence bundles cannot be downloaded after the fact**, and every historical
   row has no archive at all — with no copy anywhere saying so.
7. **Every JSON column is a 60-character truncated string** in both the list and
   the record: criteria, hits, manifest, scope, affected, and the threshold
   values. In six places, the truncated blob *is* the content of the row.
8. **Record headings are frequently meaningless**: "messages" for every retention
   run, "regulator" for every regulator bundle, a bare ULID for every erasure-log
   row.
9. **Legal-hold subject references are unhinted free text** where only two
   prefixes actually protect anything, and released holds are not distinguished
   from live ones.
10. **Two evidence-bundle affordances describe a workflow that does not exist**
    (`approvedBy`, always null; state `delivered`, unreachable).
11. **Nothing links to anything.** A request does not link to its erasure rows or
    its bundle; a retention run does not link to the holds that held it; a
    rulepack failure does not link to its subject; a threshold does not link to
    what consumes it. Ten tabs of related evidence, and every one is an island.
12. **Mobile shows the compliance queue as a list of ULIDs.**
13. **A tenant with one compliance officer cannot finish an erasure or release a
    legal hold.** Both policies are dual-control always and never auto-approvable,
    so the officer who raises the request is refused the decision on `/approvals`
    (§8.9). Nothing warns them before they raise it, and nothing on the erasure
    or legal-hold screens mentions the second approver at all.
14. **The public intake gives a subject a reference and nowhere to use it.** No
    status page, no acknowledgement on any channel — the created event has no
    subscriber (§9.6).
15. **A rejected public submission highlights no field** while telling the person
    to check the highlighted fields.
16. **The audit trail cannot be exported** from any screen, though
    `core:audit:export` exists and this role holds it (§10.4).
