# ADMIN — UI design brief

A screen-by-screen description of what the ADMIN / platform module **actually
renders today**, at the level of detail a designer needs to redesign it without
opening the repository. Every label, permission string, column name and piece of
error copy below was read out of the source. Where something is missing, broken
or awkward, it says so under **What is weak today** rather than being quietly
improved.

---

## 1. Orientation (read this first)

1. ADMIN is where a tenant configures itself: who exists, what they may do, what
   the platform is allowed to talk to, and what it did about it.
2. It is one nav entry, **"Administration"** (`nav.admin`), sitting near the
   bottom of the sidebar. The API only offers it to an actor holding
   `core:users:read`.
3. Behind that one entry are **33 resource tabs**, four bespoke screens, and the
   `/settings` screen, which is where a person's own account lives and where a
   tenant administrator finds three tenant-wide panels.
4. Two people live here. A **tenant administrator** (`tenant.admin`) during
   setup week: creating people, assigning roles, setting the brand, capping AI
   spend. A **developer administrator** (`dev.admin`) later: API keys, webhooks,
   sign-in providers.
5. A third visits often and changes nothing: **`tenant.compliance`**, who reads
   the audit log, reads AI runs, and can pause an agent but never author one.
6. The three screens that matter most, in order:
   **`/settings`** (the API key is revealed exactly once, there and nowhere
   else), **`/admin/ai/console`** (pause an agent, see what it cost, see what it
   was allowed to do), and **`/admin/roles` + `/admin/user-roles`** (the
   permission model, which is today two JSON textareas and two raw id fields).
7. All 33 tabs are rendered by **one generic list screen and one generic
   record screen**. They are not bespoke pages. Redesigning the chassis
   redesigns 66 screens at once.
8. Nothing in ADMIN is a modal. Creation is a native `<details>` disclosure,
   confirmation is `window.confirm()` or a required checkbox, and AI never
   interrupts (docs/15).
9. Mobile shows **one** ADMIN screen: the list of people. Everything else is web
   only.
10. The brand is data. Product name, logo and accent colours come from tenant
    config. A hard-coded "LYRA" in any user-facing surface is a bug; `/settings`
    → *Tenant appearance* is where a tenant overrides them.

---

## 2. How this brief is organised

The ADMIN workspace is declared as data (a `WorkspaceSpec`): a path, a label
catalogue in English and Arabic, a list of resource tabs, and two links out to
bespoke screens. Two route files render all of it.

| Route | File | What it is |
|---|---|---|
| `/login` | `routes/login.tsx` | Bespoke. Four steps in one card. |
| `/logout` | `routes/logout.tsx` | Action only, no UI. |
| `/admin` and `/admin/:resource` | `routes/module.tsx` | **The list chassis.** Renders all 33 tabs. |
| `/admin/:resource/:id` | `routes/record.tsx` | **The record chassis.** Renders all 33 record screens. |
| `/admin/ai/console` | `routes/ai-console.tsx` | Bespoke. The AI control plane. |
| `/admin/ai/budget` | `routes/ai-budget.tsx` | Bespoke. Spending ceilings. |
| `/admin/ai/runs/:id` | `routes/ai-run.tsx` | Bespoke. One agent run, opened. |
| `/settings` | `routes/settings.tsx` | Bespoke. Eight panels. |

So: sections 4–9 give the full 13-part entry for each *route*. Section 10 is the
tab-by-tab reference — for each of the 33 tabs, the parts that actually differ
(permissions, columns, forms, filters, weaknesses). Section 11 is the RBAC
deep-dive and the permission-matrix design. Section 12 lists what is not built.

Static routes rank above the dynamic `:module` segment in the route table, so
`/admin/ai/console` wins the match over `/admin/:resource` without extra work.
This also means **`ai` can never be a tab key** under `/admin`.

---

## 3. Design vocabulary in use

### Tokens (`packages/ui/src/tokens.css`)

Dark is the **default** theme; `:root[data-theme="light"]` remaps.

**Palette.** Deep Field `--ink-900 #070b14` (page background), `--ink-800
#0c1322`, `--ink-700 #131c31`, `--ink-600 #1c2842`; `--star-100 #f4f7fc` (body
text), `--star-300 #aeb9cf` (subtle), `--star-500 #5e6b87` (muted); accent
`--vega-500 #ffb020` (light theme uses `--vega-600 #d98e0b` at 7.33:1 against
ink, because `#ffffff` on `#ffb020` was 2.68:1); `--ion-500 #37d3b2` success,
`--flare-500 #ff5d5d` danger, `--photon-500 #6e9bff` info, `--comet-500 #ff7a45`,
`--nebula-500 #c08bff`.

**Module identity.** axis `#ffb020`, orbit `#37d3b2`, signal `#ff7a45`, scout
`#6e9bff`, north `#c08bff`; `--chart-1..5` alias these. **ADMIN has no module
colour** — it falls back to `var(--accent)`. That is deliberate and it is also
why the admin sidebar dot looks like every other non-module entry.

**Type.** `--font-display` Space Grotesk, `--font-ui` Inter, `--font-mono` IBM
Plex Mono, `--font-arabic` IBM Plex Sans Arabic. **Every stack keeps the Arabic
fallback** — dropping it regresses RTL rendering to a font with no Arabic
coverage. Scale `--text-12` (0.75rem) … `--text-48` (3rem). `--leading-body 1.5`,
`--leading-display 1.15`, `--tracking-wordmark 0.03em`.

**Geometry.** Radii 6 / 10 / 16 / 999px. `--control-height: 40px` (hit target
≥ 40px), `--row-height: 44px`; the compact density block drops them to 32px /
34px, which is what every admin table uses. `--duration-fast 150ms`,
`--duration-slow 250ms`, `--ease-out cubic-bezier(0.2, 0.8, 0.2, 1)`.

**Semantic.** `--success / --danger / --warning / --info` each with a
`-contrast` pair; `--focus: var(--accent)`.

### Primitives (`packages/ui/src/primitives.tsx` and siblings)

`Button` (`primary | secondary | ghost | danger`, sizes `sm | md | lg`),
`IconButton`, `Field`, `Input` (supports `prefix` / `suffix`), `Textarea`,
`DatePicker`, `Select`, `Checkbox`, `RadioGroup`, `Switch`, `Card`, `Badge`
(tones `neutral | accent | success | danger | warning | info`), `Avatar`,
`Skeleton`, `Separator`, `Tabs`, `ProgressBar`, `Table` (+ `Column`),
`EmptyState`, `DateTime`, `Money`, and the AI set: `AGENT_MARK` (the ✦
character), `EvidenceLink`, `GuardrailNotice`, `ApprovalStrip`,
`ConfidenceMeter`, `BudgetMeter`.

### Brand overrides

Exactly five custom properties are overridable per tenant: `--accent`,
`--accent-hover`, `--accent-contrast`, `--font-display`, `--font-ui`. One
typeface covers both roles. The font is looked up in a `Map` with three entries
(`space-grotesk`, `inter`, `ibm-plex-sans-arabic`) — never interpolated into
CSS, so a hostile value cannot escape.

---

## 4. `/login` — Sign in

### Route + title
Path `/login`. Document title = `auth.signIn` → **"Sign in"**. No layout, no
shell — this route sits outside the workspace layout.

### Who sees it
Everyone, signed in or not. There is no permission. **There is no product name
on this screen**: there is no session yet, so there is no tenant brand to read
one from, and a literal would be exactly the hard-coded string the brand tokens
exist to prevent. The card carries only the step heading.

### Purpose
Establish a session — by password, by federated provider, or (in a demo
deployment only) by picking a seeded persona — and clear the second factor.

### Layout skeleton

```
┌──────────────────────── viewport, min-h-screen, centred ────────────────────┐
│                                                                             │
│              ┌──────────── Card, max-w-md (28rem) ────────────┐             │
│              │ h1  Sign in                          (22px)    │             │
│              │ p   Enter your work email and password…(13px)  │             │
│              │                                                │             │
│              │ ┌── role="alert" danger box (only on error) ─┐ │             │
│              │ │ translated message                         │ │             │
│              │ │ Details: <API's own detail>       (12px)   │ │             │
│              │ │ Reference abc123                  (mono 12)│ │             │
│              │ └────────────────────────────────────────────┘ │             │
│              │                                                │             │
│              │ ── Demo sign-in ────────── (non-production) ── │             │
│              │ h2  Demo sign-in                               │             │
│              │ p   This is a demo workspace. Pick a person…   │             │
│              │ [ Ayesha Khan            tenant.admin      ]   │  ← one full-│
│              │ [ Daniel Cole            axis.lead         ]   │    width btn│
│              │ [ Fatima Noor            tenant.compliance ]   │    per      │
│              │                                                │    persona  │
│              │ ── main form ──────────────────────────────── │             │
│              │ Email        [_____________________________]   │             │
│              │ Password     [_____________________________]   │             │
│              │ (Workspace   [_____________________________])  │ ← only when │
│              │                                                │   ambiguous │
│              │ [        Continue        ] (primary, full)     │             │
│              │ ────────────────────────────────────────────── │             │
│              │ h2  Organisation sign-in              (13px)   │             │
│              │ p   If your company signs you in…     (12px)   │             │
│              │ [ Continue with your organisation ]            │             │
│              └────────────────────────────────────────────────┘             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Every element

The card renders one of **four steps**. The step survives a failed submit — a
bad TOTP code must not drop the user back to a password form the session has
already passed.

| Step | Heading (key) | Intro (key) | Submit label (key) |
|---|---|---|---|
| `password` | Sign in (`auth.signIn`) | Enter your work email and password to continue. (`auth.intro`) | Continue (`auth.continue`) |
| `totp` | Two-step verification (`auth.totp.title`) | Enter the six-digit code from your authenticator app. (`auth.totp.intro`) | Verify (`auth.totp.verify`) |
| `enrol` | Set up two-step verification (`auth.enrol.title`) | Your role requires a second step at sign-in. Add this account to an authenticator app, then enter the code it shows. (`auth.enrol.intro`) | Confirm (`auth.enrol.confirm`) |
| `recovery` | Save your recovery codes (`auth.recovery.title`) | Each code signs you in once if you lose your phone. This is the only time they are shown — store them somewhere safe. (`auth.recovery.intro`) | I have saved them (`auth.recovery.continue`) |

While submitting, the button reads **"Working…"** (`auth.working`).

**Demo personas.** Rendered only on the `password` step, and only when the
loader found any. The loader calls `GET /v1/auth/demo/personas` inside a
try/catch; **production answers 404 and the list is empty, so the section never
renders**. A network failure also yields an empty list — an unreachable API must
not take the password form down with it. Each persona is a full-width submit
button with `justify-between`: the person's name at the start, their role key in
**mono 12px muted** at the end (`tenant.admin`, `axis.lead`…). The role is the
point of the persona — it says which permissions the demo lands in.

**SSO.** Not a second form. It is a second submit button (`name="intent"
value="sso"`) inside the same form as the password fields, carrying
`formNoValidate` so the required password below does not block it. The email
already typed above is the address it discovers on. Discovery hits
`GET /v1/auth/sso/discover?email=…`; an empty `{}` answer is the ordinary case,
not an error.

### Table columns
None. There are no tables on this screen.

### Forms

**Password step**
| Field | Type | Attributes | Required | Default |
|---|---|---|---|---|
| Email (`auth.email`) | `email` | `autoComplete="email"`, `autoFocus` unless the workspace prompt is showing | yes | empty |
| Password (`auth.password`) | `password` | `autoComplete="current-password"` | yes | empty |
| Workspace (`auth.tenantSlug`) | text | `autoComplete="organization"`, `autoFocus` | yes, **when shown** | empty |

The Workspace field appears **only** after the API answers 400 with a detail
matching `/tenantslug/i`. Its hint: *"Your email belongs to more than one
workspace. Enter which one to open."* (`auth.tenantSlug.hint`). Focus follows
the thing the user still has to answer — after a workspace prompt the email is
already right, so `autoFocus` moves off it.

**TOTP step.** One field, "Verification code" (`auth.totp.code`):
`inputMode="text"`, `autoComplete="one-time-code"`, `pattern="[0-9A-Za-z-]*"`,
`maxLength={9}`, required, autofocused. Nine characters and letters allowed
**because this field takes either factor** — six digits from the authenticator,
or a recovery code shaped `XXXX-XXXX`. Numeric-only would silently truncate the
code a locked-out user is here to type. Below it, in 12px muted: *"Lost the
device? Enter one of your recovery codes instead."*

**Enrolment step.** Above the field: the label "Setup key"
(`auth.enrol.secret`), then the secret rendered as `select-all break-all` mono
14px on `bg-surface-2` with `tracking-wide`, then the hint *"Paste this key into
your authenticator app, or open the link below on this device."*
(`auth.enrol.secretHint`), then — if the API returned one — an underlined link
**"Open in authenticator app"** pointing at the `otpauth:` URI. The code field
here is `inputMode="numeric"`, `pattern="[0-9]*"`, `maxLength={8}`, required.
The secret and URI ride hidden inputs through a failed confirm: a rejected code
must not cost the user their setup key, because re-enrolling is a refusal.

There is **no QR code**. A QR needs an encoder dependency; the key is selectable
text instead.

**Recovery step.** No inputs. A `grid-cols-2` list of `select-all` mono 14px
codes on `bg-surface-2`, and the submit button, which just navigates on.

### States

| State | What renders |
|---|---|
| Loading / submitting | Button label swaps to "Working…"; persona and SSO buttons become `disabled`. |
| Wrong credentials (401) | *"That email and password do not match. Check both and try again."* |
| Rate limited (429) | *"Too many attempts. Wait a few minutes, then try again."* |
| Account locked (403) | *"This account cannot sign in. An administrator can restore it."* |
| Bad TOTP / enrol code | *"That code was not accepted. Codes expire quickly — try the current one."* |
| Anything else | *"Sign-in could not be completed. Nothing was changed; you can try again."* |
| SSO, no email typed | *"Enter your work email address first."* |
| SSO, address not federated | *"That address does not use organisation sign-in. Use your password below."* |
| SSO start failed | *"Organisation sign-in could not be started. You can sign in with a password below."* |

Every error box also shows, when the API supplied them: **`Details: <detail>`**
in 12px muted (the API's own words — translated copy says what to do, this says
what actually happened, and support needs both) and **`Reference <id>`** in mono
12px.

Empty state: not applicable. Permission denied: not applicable.

### AI surfaces
None. Sign-in has no AI.

### Actions and consequences
Signing in is reversible. **Confirming enrolment is not** — the recovery codes
are shown once and there is no route that reads them back. Nothing here is
dual-control. The session cookie is set server-side and relayed verbatim, so it
stays `HttpOnly` and script never holds a credential. The `next` parameter is
sanitised: only same-origin paths, never `//`.

### Mobile
`apps/mobile/app/login.tsx` renders the same four steps with the same label
keys. Differences that matter: **no demo personas and no SSO button** on mobile.
The TOTP field is `keyboardType="number-pad"` with `maxLength={9}` (long enough
for a pasted `XXXX-XXXX` recovery code); the enrol field is `maxLength={8}`.
Enrolment is fetched on landing via `useEffect`, because a screen that asks for
a code before showing the key it comes from is a dead end. There is an extra
**restore-session error notice with a Retry button** — retyping a password fixes
nothing when the network is the problem.

### RTL notes
The card centres, so nothing needs mirroring at the container level. **Must not
mirror:** the setup key, the recovery codes, the `otpauth:` link, the persona
role keys — all are `dir="ltr"` content and must render LTR inside an RTL page.
The persona button's `justify-between` correctly flips (name at the start,
role at the end) because it uses flex, not fixed sides.

### What is weak today
- The four steps share one 28rem card with no progress indication. A user who
  lands on `enrol` has no idea a fourth step (recovery codes) is coming, and the
  copy does not warn them.
- The demo persona list is unstyled beyond the button — no avatar, no
  description of what that persona will see. The role key is developer
  vocabulary shown to a demo audience.
- SSO is below the password form and reads as an afterthought. A federated
  organisation's people will type a password that will never work first.
- The error box stacks three messages (translated, detail, request id) with no
  hierarchy.
- No "forgot password" affordance exists anywhere on this screen.

---

## 5. `/logout`

Action-only route. The shell header renders a `<Form method="post"
action="/logout">` with a single submit labelled **"Sign out"**
(`header.signOut`). No confirmation, no UI of its own. It is the only
destructive-looking control in the header and it is one click.

---

## 6. The list chassis — `/admin` and `/admin/:resource`

**This one screen is 33 screens.** Read it once; section 10 then only has to
say what each tab puts in it.

### Route + title
Path `/admin` (falls through to the first tab) or `/admin/:resource`, e.g.
`/admin/users`, `/admin/api-keys`, `/admin/event-dlq`. The `<h1>` is the
**workspace** name — **"Administration"** (`nav.admin`) — not the tab name. The
tab name appears only in the tab strip and in the table's caption.

### Who sees it
The nav entry is offered when the actor holds **`core:users:read`** (that is the
gate the API's `/v1/me` nav table applies to `/admin`).

Each tab has its own `read` permission and **a tab the actor cannot read is not
rendered at all** — withholding is absence, not a disabled control.

`/admin` with no resource lands on the first declared tab (`tenants`, gated on
`core:tenants:read`), which is not always a tab the actor may read. When the API
answers 403 and no resource was named, the loader **redirects to the first tab
the actor does hold** rather than telling them the whole workspace is closed. A
compliance officer's first readable admin tab may be the fifth.

If the actor holds `core:users:read` but the named resource 403s, they get the
route error boundary: **"Your roles do not include access to this area."**
(`error.forbidden`).

### Purpose
List the rows of one resource, filter them, page through them, and — where the
actor holds the create permission — add one.

### Layout skeleton

```
┌─ shell header (h-14, sticky) ───────────────────────────────────────────────┐
│ [logo/name]                          Signed in as Ayesha  Settings  Sign out│
├──────────────┬──────────────────────────────────────────────────────────────┤
│ sidebar      │ main  (max-w-[100rem], p-4 / sm:p-6, gap-6)                  │
│ md:w-60      │                                                              │
│ · Home       │ h1  Administration                              (24px)       │
│ · Operations │                                                              │
│ · …          │ nav "Sections"  (wraps; 33 pills at 32px tall)              │
│ · Admin  ◄   │ [Organisations][People][Roles][Role assignments][Teams]…     │
│ · Settings   │                                                              │
│              │ nav "Reports and tools"   AI console   Spending ceilings     │
│              │                                                              │
│              │ ┌ filter bar (flex-wrap, items-end, gap-3) ────────────────┐ │
│              │ │ [search 16rem] [Status ▾] [Sign-in method ▾] [Live ▾]    │ │
│              │ │ [Apply] [Clear]                                          │ │
│              │ └──────────────────────────────────────────────────────────┘ │
│              │                                                              │
│              │ (danger alert — API objection, if any)                       │
│              │ (accent reveal box — minted secret, if any)                  │
│              │                                                              │
│              │ ▸ +  New — People              ← <details>, closed by default│
│              │                                                              │
│              │ ┌ Table, density=compact, sticky header ───────────────────┐ │
│              │ │ Name    Email ▲   Status  Sign-in  Two-factor  Last seen │ │
│              │ │ Ayesha  a@…       Active  Password  Yes        2 Jul…    │ │
│              │ │ …                                                        │ │
│              │ ├──────────────────────────────────────────────────────────┤ │
│              │ │ 24 shown                          [Previous]  [Next]     │ │
│              │ └──────────────────────────────────────────────────────────┘ │
└──────────────┴──────────────────────────────────────────────────────────────┘
```

### Every element

**Shell header.** `sticky top-0 z-30`, 56px tall. First child is a skip link
(`sr-only focus:not-sr-only`) reading **"Skip to content"**. Then the brand: a
`NavLink` to `/` rendering the tenant's logo as `<img alt={productName}>` if one
is configured, otherwise the product name as text. `productName` is
`brand.name ?? tenantName`; the logo is `brand.logo.dark ?? brand.logo.light ??
brand.logo.mark`. **Never a literal.** Then, pushed to the far end with `ms-auto`
(a logical property, so it flips in RTL): **"Signed in as {name}"**
(`header.signedInAs`, hidden below the `sm` breakpoint), a **Settings** NavLink,
and the sign-out form.

**Sidebar.** `md:w-60`, sticky under the header, `md:border-e`. **Always
text-labelled, never an icon rail** — an icon-only rail costs every user a hover
to read the nav and costs a screen-reader user the label outright. Each item is
a 6px `aria-hidden` dot in the module accent (opacity 100 when current, 30 when
idle, 60 on hover) followed by `<span className="truncate">` holding the label.
Below `md`, the sidebar becomes a **horizontally scrollable strip under the
header**, not an off-canvas drawer. The shell only renders nav items whose href
actually has a route.

**Tab strip.** `<nav aria-label="Sections">` (`common.tabs`), a wrapping `<ul>`
of pills: 32px tall, `rounded-md`, 13px. Current tab: `bg-surface-2`,
`font-medium`, full-strength text, `aria-current="page"`. Others: subtle text,
`hover:bg-surface-2`. Focus ring is a 2px accent outline at 2px offset. The
strip renders only when more than one tab is visible.

**Link strip.** `<nav aria-label="Reports and tools">` (`common.reports`),
12px subtle underline-on-hover links. ADMIN declares two:
**"AI console"** → `/admin/ai/console` (needs `ai:runs:read`) and
**"Spending ceilings"** → `/admin/ai/budget` (needs `ai:budgets:read`). A link
the actor cannot open is not offered.

**Filter bar.** A `method="get"` form, rendered only if the tab declares
`search`, `filters`, or the actor can restore. It carries `role="search"` when
the tab is searchable.
- Search: `<input type="search" name="q">`, 16rem wide, `aria-label` and
  placeholder both **"Search"** (`common.search`).
- One `<Select>` per declared filter. `aria-label` and placeholder are the
  filter's own label. First option is always **"All"** (`common.all`); the rest
  are the declared values, run through the label resolver (`<name>.<value>` →
  `<value>` → humanised, so `pending_settlement` becomes "Pending settlement"
  rather than showing a raw key).
- Deleted/live select, when the actor holds the tab's `remove` permission:
  `aria-label` **"Records shown"**, options **"Live records"** / **"Deleted
  records"**.
- **[Apply]** secondary button. **[Clear]** ghost link, rendered only when a
  filter or search term is actually set.

**Deleted-view banner.** When viewing deleted rows, a `role="status"` warning
band above everything: *"You are looking at deleted records. They stay out of
the live list until you restore them."* with a **"Back to live records"** link
at the far end.

**Create panel.** Rendered only when the tab declares `fields` **and** the actor
holds `create` **and** the deleted view is off. A native `<details>` on a bordered
`bg-surface-1` card. The summary is a `+` glyph that rotates 45° when open, then
`New — {tab label}`. It is **closed by default and re-opened automatically when
the last create attempt was rejected**, so the actor's objection and their form
stay together. Inside: a `grid gap-4 sm:grid-cols-2` of fields and a primary
**Create** button. There is no modal.

**Reveal box.** An accent-bordered `bg-surface-2` block that appears **only in
the render immediately after a create that minted a secret**. Heading **"Copy
this now — it is shown once"** (`common.reveal.title`), body *"The server keeps
no readable copy. Store it where it belongs before you leave this page; if you
lose it, the only remedy is a new record."* (`common.reveal.body`), then the
value as `role="status"` `break-all` mono 13px `<code>` — **selectable text, not
an input**: nothing here should look editable, and a screen reader should read
it as the value it is. It survives exactly one render; a reload or a second
create clears it. In ADMIN only the **webhooks** tab uses this.

**Problem alert.** A `role="alert"` danger-bordered block above the table
carrying the API's `detail` (falling back to `title`). It sits where the actor
typed, not after a screen of rows.

**Table.** `density="compact"` (32px controls, 34px rows), `stickyHeader`. The
caption is `Administration — {tab label}` (plus `— Deleted records` in the
deleted view). **The first column of each row is a link into the record** —
one predictable keyboard target per row beats a whole-row click nobody can
reach. In the deleted view the first cell stays plain text, because a deleted
row has no record page to open. Sortable columns render a sort control that
rewrites `?sort=&order=` and drops the cursor.

**Footer.** `{count} shown` (`common.rows`) in 12px tabular-nums subtle at the
start; **[Previous]** and **[Next]** secondary `sm` buttons at the end.
**Previous returns to the top of this view** (it drops the cursor and keeps the
filters) — paging is forward-only keyset paging, not page numbers.

### Table columns
Per tab. See section 10. Column headers come from the workspace catalogue;
`money` and `number` columns are right-aligned (`numeric`), `badge: true`
columns render as a chip instead of text, `datetime` columns render through
`DateTime`, `json` columns render their serialised value.

### Forms
Create only, per tab. Field types are `text | textarea | number | money |
select | date | datetime | boolean | json`. Submission rules that a designer
must know because they are visible in behaviour:
- **An empty string means "not supplied", not "set to empty."** Clearing a value
  requires `null`, which only the JSON editor can express.
- An unchecked checkbox submits `false`, not nothing.
- A `date` field is read as UTC midnight; the platform stores epoch
  milliseconds.
- A `json` field is `JSON.parse`d — **a syntax error throws** (see weaknesses).

There is no client-side validation beyond `required` on the inputs the spec
marks required. Everything else is the API's answer.

### States

| State | Copy |
|---|---|
| Empty, unfiltered | **"Nothing here yet"** / *"No records match this view. Clear the filters, or create the first one."* |
| Empty, filtered | **"Nothing here yet"** / *"No records match these filters."* |
| Empty, deleted view | **"Deleted records"** / *"Nothing has been deleted here."* |
| Loading | No skeleton. Buttons take a `loading` state; the table is server-rendered. |
| API rejected a write | Danger `role="alert"` above the table with the API's detail. |
| Permission denied on a named resource | Route error boundary: **"Your roles do not include access to this area."** |
| Session expired | **"Your session has ended. Sign in to continue."** |
| Bad address | **"There is nothing at this address."** |

### AI surfaces
None in the chassis itself. The two link-strip entries point at the AI screens.

### Actions and consequences
- **Create** — POST. Reversible for most resources; irreversible in effect for
  `webhooks` (the signing secret is shown once) and `consents` (immutable —
  the API refuses PATCH and DELETE, so a correction is a new row).
- **Delete** — soft delete on resources that support it, hard on others. Guarded
  by `window.confirm()` on the record screen only. **The list screen's restore
  button has no confirmation** (restoring is not destructive).
- **Restore** — POST `/{id}/restore`, gated on the same permission as delete.
- Nothing in the chassis is dual-control. Approval gating happens in the API.

### Mobile
The workspace list chassis does not exist on mobile. `apps/mobile` maps `/admin`
to exactly one collection, `core/users`, rendered as a `FlatList`. There is no
tab strip, no filter bar, no create panel, no paging controls beyond the list.
A quiet **Back** button sits in the list header because the stack draws no
header, and an edge swipe is not a control a screen-reader or switch-control
user can reach.

### RTL notes
**Mirrors:** the sidebar (via `border-e` and `ms-auto`), the tab strip order,
table column order, the footer's count/pager split, the create panel's `+`
alignment.
**Must not mirror:** anything in `font-mono` that is an identifier — ids,
`prefix` values, `r2Key`, IP addresses, hashes, `agentKey`, permission strings.
These need `dir="ltr"` inside RTL text. Numbers use `tabular-nums` and stay
LTR-ordered.
The `+` disclosure glyph rotating 45° is direction-neutral and is fine.

### What is weak today
- **33 tabs in one wrapping pill strip.** On a laptop this is three or four
  rows of pills above every list. There is no grouping, no search over tabs, no
  overflow menu. The spec already groups them in source (who / record /
  governance / connections / AI) and the UI throws that grouping away.
- **The `<h1>` says "Administration" on all 33 screens.** The tab name is only
  in a pill and a visually-hidden caption, so the browser tab title, the heading
  and any screen-reader landmark announcement are identical for "People" and
  "Dead letters".
- **Sidebar labels truncate with no `title` attribute.** A long tenant-renamed
  nav label is unreadable and unrecoverable.
- **JSON columns are rendered raw in table cells.** `permissionsJson`,
  `scopeJson`, `envelopeJson`, `nameJson`, `toolsJson` all print serialised JSON
  into a compact 34px row. This is the single ugliest thing in the module.
- **A malformed JSON field throws rather than showing an error.** `JSON.parse`
  is not guarded in the form-to-body conversion.
- Paging is forward-only. "Previous" means "back to the first page", which is
  not what the word means to a user.
- The reveal box has **no copy button** — the value must be selected by hand.
- Search is offered on only 7 of the 33 tabs, and the ones that most need it
  (audit log, AI audit log, runs) have none.

---

## 7. The record chassis — `/admin/:resource/:id`

### Route + title
Path `/admin/:resource/:id`. The `<h1>` is **the value of the row's first
column** — a person's name, a webhook URL, a role key — falling back to the id.
Beneath it, in 12px subtle: `{tab label} · <span class="font-mono">{id}</span>`.

### Who sees it
Reaching the record requires the same `read` permission as the tab. The **Edit**
form renders only when the tab declares an `update` permission, the actor holds
it, and the resource has editable fields. The **Delete** button renders only when
the actor holds the `remove` permission. Declared actions render only for actors
holding each action's own permission. Everything withheld is **absent, not
disabled**. The API re-checks all of it.

### Purpose
Read one record's fields and change the ones this resource lets you change.

### Layout skeleton

```
┌─ main ──────────────────────────────────────────────────────────────────────┐
│ Back to list                                             (12px subtle link) │
│ Ayesha Khan                                                          (24px) │
│ People · 01J8Z…4KQ                                    (12px, id in mono)    │
│ [ Open this run ]                        ← only if the tab declares a link  │
│                                                                             │
│ (danger alert)                                                              │
│ (success line: role="status", success-tinted)                               │
│                                                                             │
│ ┌ <dl> rounded-lg border bg-surface-1 p-4 ────────────────────────────────┐ │
│ │  sm:2 cols / lg:3 cols, gap-x-8 gap-y-4                                 │ │
│ │  Name              Email             Status                             │ │
│ │  Ayesha Khan       a@example.com     Active                             │ │
│ │  Sign-in method    Two-factor        Last seen                          │ │
│ │  Password          Yes               2 Jul 2026, 09:14                  │ │
│ │  Created           Updated                                              │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│ ┌ Actions ──────────────────────────────── (only if any are visible) ─────┐ │
│ │ [Pause]  [Resume]   ┌ an action with fields takes its own full row ────┐│ │
│ │                     │ Reason [__________]  [Clawback]                  ││ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│ ┌ Edit ───────────────────────────────────────────────────────────────────┐ │
│ │ grid gap-4 sm:grid-cols-2 of editable fields                            │ │
│ │ [ Save changes ]                                                        │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│ ────────────────────────────────────────────────────────────────────────    │
│ [ Delete ]  (danger, sm)                                                    │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Every element

- **"Back to list"** (`common.back`) — 12px subtle, underline on hover.
- The `<dl>` shows **every column the list shows**, plus `Created`
  (`common.createdAt`) and `Updated` (`common.updatedAt`) when the row carries
  them. Term in plain sentence case, 12px subtle, above its value in 13px —
  an uppercase tracked micro-label is decoration that costs legibility, and
  these labels are read far more often than the heading.
- **Record link** — a secondary `sm` button, rendered only when the tab declares
  one. In ADMIN, only `runs` does: **"Open this run"** → `/admin/ai/runs/{id}`.
- **Actions section** — heading **"Actions"** (`common.actions`) on a bordered
  card. Each action is **its own form**, so the fields it collects submit with it
  and nothing else on the screen goes along for the ride. A bare button sits
  inline; an action that collects input takes a full row. Action fields are
  fresh input the endpoint asks for — a reason, a note — and **nothing is
  pre-filled from the row**. A declared action is its own endpoint, not a PATCH
  wearing a different hat.
- **Edit form** — heading **"Edit"** (`common.edit`), a two-column grid, primary
  **"Save changes"** (`common.save`). **The form is the record**: there is no
  separate view/edit mode, because a screen that shows values and a screen that
  changes them drift apart the moment a column is added to the spec.
- **Delete** — a danger `sm` button above a top border, guarded by
  `window.confirm()` with *"Delete this record? It is retained for audit and can
  be restored by an administrator."* (`common.deleteConfirm`). On success it
  redirects to the list.

### Table columns
None. The record screen renders a description list, not a table.

### Forms
Per tab. The `editable` list is often **narrower than the create list** and
sometimes contains fields create does not offer — that asymmetry is deliberate
and is documented per tab in section 10. Example: a customer's `kycStatus` is a
state they move through, not one they are created in, so it is editable and
absent from create.

### States

| State | What renders |
|---|---|
| Loaded | The `<dl>`. Always. |
| Action succeeded | A `role="status"` line in success tint, using `{actionLabelKey}.done` from the workspace catalogue, falling back to **"Saved"**. |
| API rejected | The danger `Problem` alert, above the `<dl>`. |
| Read-only actor | Edit form, Delete button and Actions section are simply absent. |
| Not found / 404 | **"There is nothing at this address."** |
| Deleted record | The record loader reads the live scope, so a deleted row **404s** — which is why the list keeps its first cell unlinked in the deleted view. |

### AI surfaces
None, except that `runs` links out to the bespoke run screen.

### Actions and consequences
- **Save changes** — PATCH, reversible.
- **Delete** — soft where supported, confirmed once. The copy correctly promises
  audit retention and administrator restore.
- **Declared actions** — POST to their own endpoint; those marked `confirm` get
  a `window.confirm()` whose text comes from `{labelKey}.confirm`. **ADMIN
  declares no actions on any tab today** — every state change here is a PATCH or
  a bespoke screen.

### Mobile
Record detail exists for `core/users` only, as the second screen of the mobile
admin stack. No edit form, no delete, no actions.

### RTL notes
The `<dl>` grid flows correctly. **Must not mirror:** the mono id in the
subtitle, and any `json`, hash or key value in a `<dd>`.

### What is weak today
- **Two nearly identical bordered cards** ("Actions", "Edit") plus a third
  bordered `<dl>` above them. Three boxes of the same weight, no visual
  hierarchy telling you which one is dangerous.
- **The delete confirmation is `window.confirm()`** — an OS dialog with the
  browser's own buttons, unbrandable, unstylable, and untranslatable beyond the
  message string.
- **A 3-column `<dl>` of 18 fields** (the `runs` record has 18 columns) is a wall.
  No grouping, no progressive disclosure.
- JSON values print raw into `<dd>`, same problem as the list.
- The success line and the error alert sit in different places (one above the
  `<dl>`, one above it too) with different tones but the same weight.

---

## 8. The AI control plane

These three screens are the reason ADMIN owns AI at all: an agent is a member of
staff with an autonomy envelope and a budget, and the same people govern both.

---

### 8.1 `/admin/ai/console` — AI console

#### Route + title
Path `/admin/ai/console`. `<h1>` is **`✦ AI console`** — the agent mark
(`AGENT_MARK`) then the title. Subline: *"What the agents are doing, what it
costs, and what they were allowed to do."*

#### Who sees it
The link is offered to holders of **`ai:runs:read`**. The screen itself does not
gate as a whole. Instead each of its six loader calls **swallows 403 and 404 to
`null`** — a section the actor may not read is absent, not an error. So the
screen composes itself out of whatever the actor can see:

| Section | Needs | Denied copy |
|---|---|---|
| Budget meters | `ai:budgets:read` | *"You do not have access to budget figures."* |
| Spend by module and purpose | `ai:audit:read` | (section omitted) |
| Agents | `ai:agents:read` | *"You do not have access to the agent roster."* |
| Pause / Resume controls | `ai:agents:pause` (pause) / `ai:agents:write` (resume, autonomy) | *"Your roles do not include changing agents."* |
| Recent runs | `ai:runs:read` | *"You do not have access to agent runs."* |
| Guardrail events | `ai:audit:read` | (defaults to an empty list) |
| AI audit log | `ai:audit:read` | *"You do not have access to the AI audit log."* |

Roles that reach it: `tenant.admin` (everything including autonomy changes),
`tenant.compliance` (everything **except** authoring — it reads, audits and
pauses, and must not also be the party that reviews what it wrote),
`platform.admin`, `north.admin`, and any module `.admin` role for its
`ai:suggestions:read` slice only (which is not enough to open the console).

#### Purpose
See what the agents are doing and stop them.

#### Layout skeleton

```
┌─ main ──────────────────────────────────────────────────────────────────────┐
│ ✦ AI console                                                        (24px)  │
│ What the agents are doing, what it costs, and what they were allowed to do. │
│                                                                             │
│ ┌ GuardrailNotice (danger if over, warning at ≥80% used) ─────────────────┐ │
│ │ The daily token limit is spent. Agent runs are refused until the window │ │
│ │ resets or the cap is raised.                                            │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│ ┌ Card ───────────────────────────────────────────────────────────────────┐ │
│ │  sm:grid-cols-2                                                         │ │
│ │  Tokens                        │  $ 12.40                               │ │
│ │  ▓▓▓▓▓▓▓▓▓░░░░░░  62%          │  ▓▓▓▓▓▓▓▓▓▓▓▓░░  81%                   │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│ ┌ Card  Spend by module and purpose        Last 30 days ──────────────────┐ │
│ │ Module   Purpose        Calls   Tokens   Errors   Cost                  │ │
│ │ axis     triage         1 204   482 913  0        $3.11                 │ │
│ │ orbit    draft_reply      812   301 447  [3]      $2.02                 │ │
│ │ ────────────────────────────────────────────────────────────            │ │
│ │ Totals                  2 016   784 360  3        $5.13                 │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│ ┌ AgentCard ──────────────────────────────────────────────────────────────┐ │
│ │ ✦ Case triage  axis.triage                             [Active]         │ │
│ │ Module: axis · Tier: fast                                               │ │
│ │  Autonomy      [Acts with approval]   Level confirmed by the API        │ │
│ │  Updated       2 Jul 2026, 09:14                                        │ │
│ │  Module        axis            Tier   fast                              │ │
│ │  Prompt reference   axis.triage.v4                                      │ │
│ │  Tools allowed  [search] [read_case] [draft_note]                       │ │
│ │ ─────────────────────────────────────────────────────────────────────── │ │
│ │  Reason [_______________________________]        [ Pause agent ]        │ │
│ │  Change autonomy  [Acts within limits ▾]                                │ │
│ │  Reason [_______________________________]                               │ │
│ │  ☐ I understand this widens what the agent may do without asking, and   │ │
│ │    that it is recorded against my name.                    (warning)    │ │
│ │                                                  [ Change autonomy ]    │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│  … one card per agent …                                                     │
│                                                                             │
│ ┌ Card  Recent runs ──────────────────────────────────────────────────────┐ │
│ │ Started  Agent            Asked by  Purpose  State  Latency  Cost       │ │
│ │ 09:14    ✦ axis.triage    ayesha    triage   [OK]   1 204 ms $0.004     │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│ ┌ Card  Guardrail events ─────────────────────────────────────────────────┐ │
│ │ When  Rule           Severity  Detail       Run     Subject             │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│ ┌ Card  AI audit log ─────────────────────────────────────────────────────┐ │
│ │ Content is never stored here — every row carries hashes only.           │ │
│ │ When  Actor  Module  Purpose  Model ✦  Outcome  Cost      (rows sealed) │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Every element

**Budget notices** (top of screen, before anything else):
- Tokens exhausted: *"The daily token limit is spent. Agent runs are refused
  until the window resets or the cap is raised."*
- Cost exhausted: the same sentence about the cost ceiling.
- Stopped by a person: *"This budget was stopped by an administrator."*
- At ≥80% used, a **warning**-toned notice instead: **"Approaching the budget
  cap"** with the reason line **"Used so far today:"**.

**Budget card.** Two `BudgetMeter`s side by side above `sm`. The cost meter has
the amount rendered through `<Money>` above the bar; the currency is USD and the
platform stores micro-units (1 major unit = 1,000,000 micro).

**Spend table.** Columns: `Module`, `Purpose`, `Calls`, `Tokens`, `Errors`,
`Cost`. Errors render as a **danger Badge** when non-zero and as plain text
otherwise. A footer row carries the totals. Window label: **"Last 30 days"**.

**AgentCard** — one per registered agent. Title: `✦ {localised name}` then the
agent key in mono. Description falls back to `Module: {module} · Tier: {tier}`
when the agent has no localised description. The status Badge (**Active /
Paused / Retired**) sits in the card's actions slot, top-right.

Body is a `<dl>` of term/detail pairs:
- **Autonomy** — an accent Badge reading one of **Suggests only / Acts with
  approval / Acts within limits / Autonomous**, annotated **"Level confirmed by
  the API"**. Only ever the level the API last confirmed — a *requested* level is
  not a level.
- **Updated** — a `DateTime`.
- **Module**, **Tier**.
- **Prompt reference** — the reference in `<code>`, **never the prompt body**.
  The system text lives in `ai_prompts.body` and this screen does not load it.
- **Tools allowed** — one Badge per tool.
- **Paused because** / **Paused by** — only when paused.

Then, if a change is awaiting approval, an info notice: **"Autonomy change is
waiting for approval"** / *"The level shown above is the one the API still
holds. It changes only once the approval is granted."*

Then, above a top border, the controls:
- **Paused agent + `ai:agents:write`** → a secondary **"Resume agent"** button.
- **Active agent + `ai:agents:pause`** → a required `<Textarea>` (`name="reason"`,
  `minLength={3}`, `maxLength={500}`, `rows={2}`) and a **danger "Pause agent"**
  button. *This is the killswitch, reachable in one submit.*
- **`ai:agents:write`** → the autonomy form (below).
- **Neither** → the line *"Your roles do not include changing agents."*

**Autonomy form.** A `<Select>` of the four levels; a required reason
`<Textarea>`; and — **only when the chosen level is higher than the current
one** — a `required` checkbox whose label, in warning tone, reads: *"I understand
this widens what the agent may do without asking, and that it is recorded
against my name."* The submit button is `disabled` while the selection equals the
current level, and its variant **flips to danger** when the change is a raise.
A required checkbox is the confirmation — it blocks the submit in the browser
with no dialog, which is also what docs/15 wants (never a modal) — and the
server re-checks it. If the checkbox is missing server-side, the screen answers
*"A raise in autonomy needs the confirmation ticked."*

**Recent runs table.** Columns: `Started`, `Agent`, `Asked by`, `Purpose`,
`State`, `Latency`, `Cost`. The Agent cell is an **`EvidenceLink`** — `✦` plus
the mono agent key — which opens a "Why this ran" popover. State is a Badge:
**Running / Awaiting approval / Succeeded / Refused / Failed / Cancelled /
Stopped by budget**. Latency is suffixed **"ms"**.

**Guardrail events table.** `When`, `Rule` (mono), `Severity` Badge
(**Information / Warning / Blocked**), `Detail`, `Run` (mono), `Subject`.

**AI audit log table.** A note under the title: *"Content is never stored here —
every row carries hashes only."* Rows are drawn in a **`sealed`** row state.
Columns: `When`, `Actor`, `Module`, `Purpose`, `Model`, `Outcome`, `Cost`. The
Model cell is an `EvidenceLink` revealing the input and output hashes, the
provider and tier, latency and token counts. Outcome Badge: **OK / Refused /
Error / Budget exceeded**.

#### Table columns
See above — four tables, all read-only, none sortable, none filterable, all
capped by a fixed row limit set in the file.

#### Forms

| Form | Fields | Validation | Server re-check |
|---|---|---|---|
| Pause | `reason` textarea | `required minLength={3} maxLength={500}` **in the browser only** | **None.** The value is passed straight through. |
| Resume | none | — | — |
| Autonomy | `autonomyLevel` select, `reason` textarea (required), `confirm` checkbox (required **only when raising**) | browser `required` | Level validated against the four known values; the confirm checkbox is re-checked when the change is a raise. |

#### States

| State | Copy |
|---|---|
| No budget access | *"You do not have access to budget figures."* |
| No agent roster access | *"You do not have access to the agent roster."* |
| No run access | *"You do not have access to agent runs."* |
| No AI audit access | *"You do not have access to the AI audit log."* |
| Can read agents but not change them | *"Your roles do not include changing agents."* |
| Change queued for approval | **"Autonomy change is waiting for approval"** + the explanatory reason line. |
| API objection | The shared danger `Problem` alert. |

There is no dedicated loading state; the screen is server-rendered.

#### AI surfaces — in detail

This screen **is** the AI control plane. Four levers exist:

1. **Pause an agent.** One textarea and one danger button, no dialog, no second
   step. It takes effect immediately at the API. The reason is stored and shown
   back on the card as **"Paused because"** with **"Paused by"**.
2. **Resume an agent.** A secondary button, no reason, no confirmation. Asymmetric
   with pause on purpose — restarting is the safe direction.
3. **Change autonomy.** Four levels, ordered. Lowering is a plain submit.
   **Raising** turns the button red, requires a typed reason and a ticked
   acknowledgement, is re-checked server-side, and is then **approval-gated at
   the API**: a 202 carrying an approval reference does not change the level, it
   queues it. The browser control only stops an accidental raise from ever
   reaching the gate.
4. **The budget kill switch** lives on the sibling screen (§8.2) — the console
   shows the meter and the over-budget notice, and links there.

Every AI artifact on the screen carries the single **✦** mark and an inspectable
"why" one interaction away: the agent cell in the runs table, the model cell in
the audit table, the agent card title. There is no auto-refresh, no streaming,
no modal, and nothing on this screen sends anything.

#### Actions and consequences

| Action | Reversible? | Confirmation | Dual control |
|---|---|---|---|
| Pause agent | Yes (Resume) | None beyond the required reason | No |
| Resume agent | Yes (Pause) | None | No |
| Lower autonomy | Yes | Required reason | No |
| **Raise autonomy** | Yes, but the window between raise and lower is real | Required reason **and** required acknowledgement | **Yes — approval-gated at the API** |

Everything here is written to `ai_audit_log` with tenant, module, purpose and
actor.

#### Mobile
Web only. There is no AI console on mobile.

#### RTL notes
**Mirrors:** card layout, the `<dl>` pairs, the meters (fill direction follows
the writing direction), table column order, the actions row.
**Must not mirror:** the agent key, the prompt reference, tool names, rule
names, run ids, model names, and every hash in the audit popover. All are
`dir="ltr"` identifiers.
The **✦** mark is direction-neutral and must stay adjacent to its artifact on
both sides.

#### What is weak today
- **The pause reason is not validated server-side.** `minLength={3}` lives only
  in the markup. Any client that skips the browser can pause an agent with an
  empty reason, and the stored reason is what the compliance reader later sees.
- **Two different confirmation patterns for the same idea.** The console's
  autonomy checkbox is `required` in markup **and** re-checked server-side; the
  budget screen's confirm checkbox is **not** `required` and is refused
  server-side. A user meets both in one session.
- **The autonomy enum does not match the rest of the product.** This screen (and
  the run screen) use `suggest | act_with_approval | act_within_limits |
  autonomous`. The generic `/admin/agents` tab offers `suggest | draft |
  act_with_approval | act | act_and_report`. Three of five values do not
  overlap, so a level set from the generic tab renders here as a raw string
  through the label fallback.
- Agent cards are an unbounded vertical stack. With twenty agents the runs table
  is far below the fold, and there is no filter, no search, no collapse.
- The four tables have fixed row limits with **no "see all" link** — the reader
  cannot tell whether they are looking at everything.
- No time-range control anywhere except the fixed "Last 30 days" on spend.

---

### 8.2 `/admin/ai/budget` — Spending ceilings

#### Route + title
Path `/admin/ai/budget`. `<h1>` **`✦ Spending ceilings`**. Intro: *"What the
agents are allowed to spend today, and the control that changes it. A ceiling of
zero means no ceiling."*

#### Who sees it
The link needs **`ai:budgets:read`**. Changing a ceiling needs
**`ai:budgets:write`**. Both are held by `tenant.admin` and `platform.admin`.
`tenant.compliance` holds **neither** — budgets belong to the tenant's AI
operator, not to the party that reviews it.

Denied readers: *"You do not have permission to read AI budgets, so the figures
on this screen are hidden. Ask a tenant administrator for AI budget access."*
Read-only actors get the figures plus a notice titled **"Read-only"**: *"Changing
an AI spending ceiling needs the ai:budgets:write permission, which your roles do
not carry. The figures above stay visible."*

#### Purpose
The control the console lacks: set today's token and cost ceilings, per module
or tenant-wide.

*Context that explains the screen's existence:* `POST /v1/ai/budget/limits` had
no caller anywhere in the product, so a tenant could watch the meter fill and do
nothing about it. The console is the operating view; this screen is the control.

#### Layout skeleton

```
┌─ main ──────────────────────────────────────────────────────────────────────┐
│ ✦ Spending ceilings                                                 (24px)  │
│ What the agents are allowed to spend today, and the control that changes it.│
│ A ceiling of zero means no ceiling.                                         │
│                                                                             │
│ ┌ GuardrailNotice warning ────────────────────────────────────────────────┐ │
│ │ Spending is uncapped                                                    │ │
│ │ Both ceilings are zero for at least one module, which the gateway reads  │ │
│ │ as unlimited. Agent runs will not be stopped by budget.                 │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│ ┌ info notice (after an approval-gated raise) ────────────────────────────┐ │
│ │ Waiting for approval — …takes effect once someone else approves it.     │ │
│ │ Open approvals →                                                        │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│ ┌ grid  lg:[ 1fr | 21rem ]  items-start ──────────────────────────────────┐ │
│ │ ┌ Card  Today's ceilings ─────────────┐  ┌ aside sticky top-6 ────────┐ │ │
│ │ │ All modules            [No ceiling] │  │ Card  Set a ceiling        │ │ │
│ │ │            [Change this ceiling]    │  │ Applies to today's window. │ │ │
│ │ │  Tokens ▓▓▓▓▓░░░░░  48%             │  │ Leave a field blank to     │ │ │
│ │ │  Cost   ▓▓▓░░░░░░░  27%             │  │ keep the ceiling it has.   │ │ │
│ │ │  Spent $4.02 / $15.00               │  │                            │ │ │
│ │ │ ─────────────────────────────────── │  │ Applies to  [All modules ▾]│ │ │
│ │ │ axis                    [Stopped]   │  │ A module ceiling is metered│ │ │
│ │ │            [Change this ceiling]    │  │ separately from the tenant-│ │ │
│ │ │  Tokens ▓▓▓▓▓▓▓▓▓▓ 100%             │  │ wide one.                  │ │ │
│ │ │  …                                  │  │ Daily token ceiling [____] │ │ │
│ │ └─────────────────────────────────────┘  │ Zero removes the ceiling.  │ │ │
│ │                                          │ Daily cost ceiling [__] USD│ │ │
│ │                                          │ ☐ I understand this changes│ │ │
│ │                                          │   what the agents may spend│ │ │
│ │                                          │ [ Set ceiling ]            │ │ │
│ │                                          └────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│ ┌ Card  What the spend bought ────────────────────────────────────────────┐ │
│ │ Suggestions shown in the last 30 days, and how often people kept them.  │ │
│ │ Surface        Asked by  Shown  Accepted  Edited  Dismissed  Kept       │ │
│ │ ✦ ghost_text   axis      1 204  611       180     413        ▓▓▓▓░ 65%  │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Every element

**Left column — "Today's ceilings".** One of three things:
1. The denied line, or
2. an `EmptyState`: **"No budget has been set"** / *"Nothing has been metered for
   this tenant yet, so there is no window to show. Setting a ceiling creates
   today's window."*, or
3. a divided `<ul>`, one `<li>` per metered module. Each row carries: the module
   label (or **"All modules"**), a **danger "Stopped"** Badge or a **warning "No
   ceiling"** Badge where applicable, a **ghost "Change this ceiling"** button
   that aims the form at that module, and two `BudgetMeter`s — tokens, then cost
   with a `<Money>` line beneath reading **"Spent"** `X / Y`.

**Right column — the form**, in a `lg:sticky lg:top-6` aside. Title **"Set a
ceiling"**, intro *"Applies to today's window. Leave a field blank to keep the
ceiling it already has."*

**Bottom — "What the spend bought"**, a table with the window line *"Suggestions
shown in the last 30 days, and how often people kept them."* Columns: `Surface`
(an `EvidenceLink` — `✦` plus the mono surface name — opening a popover **"How
this is counted"** whose body reads *"An edited suggestion counts as kept: the
reader took the shape and changed the words."*), `Asked by`, `Shown`,
`Accepted`, `Edited`, `Dismissed`, and **`Kept`**, which is a `ProgressBar`
toned success at ≥50%, accent at ≥20%, neutral below, followed by a 10-character
right-aligned tabular-nums percentage. Denied readers get *"You do not have
permission to read suggestion outcomes."*

#### Table columns
`Surface` (text + evidence popover) · `Asked by` (text) · `Shown` (number,
right) · `Accepted` (number, right) · `Edited` (number, right) · `Dismissed`
(number, right) · `Kept` (bar + percentage, right). Not sortable, not
filterable.

#### Forms

| Field | Label / key | Type | Validation | Default | Hint |
|---|---|---|---|---|---|
| `module` | **Applies to** (`form.module`) | select | — | `*` (**All modules**) | *"A module ceiling is metered separately from the tenant-wide one."* |
| `tokensLimit` | **Daily token ceiling** | `number`, `min=0`, `step=1`, `inputMode="numeric"` | server: must be a number ≥ 0 | the selected module's current ceiling | *"Zero removes the ceiling."* |
| `costLimit` | **Daily cost ceiling** | `number`, `min=0`, `step=0.01`, `inputMode="decimal"`, suffix **USD** | server: must be a number ≥ 0 | current ceiling, to 2dp | *"In whole currency, to two decimal places. Zero removes the ceiling."* |
| `confirm` | *"I understand this changes what the agents may spend, and that raising it is recorded against my name."* | checkbox | **not `required` in the browser** — the server refuses instead | unchecked | — |

Submit: **"Set ceiling"**. Success line, `role="status"`: **"Ceiling updated."**

Choosing a different module **remounts both number inputs**, reseeding them with
that module's current ceiling. That is why picking a module in the select
visibly replaces what you had typed.

Problem copy:
- `confirm_required` → *"Tick the confirmation before changing a ceiling."*
- `invalid_amount` → *"A ceiling must be a number that is zero or more."*
- `nothing_to_set` → *"Set at least one of the two ceilings."*
- `bad_intent` → *"That form did not carry a recognised action."*

#### States

| State | Copy |
|---|---|
| Nothing metered yet | **"No budget has been set"** + the body above. |
| Both ceilings zero somewhere | **"Spending is uncapped"** warning + *"Both ceilings are zero for at least one module, which the gateway reads as unlimited. Agent runs will not be stopped by budget."* |
| Raise queued | **"Waiting for approval"** + *"Raising an AI spending ceiling is approval-gated. The request has been recorded and takes effect once someone else approves it."* + an **"Open approvals"** link. |
| Cannot read budgets | *"You do not have permission to read AI budgets, so the figures on this screen are hidden. Ask a tenant administrator for AI budget access."* |
| Cannot write budgets | **"Read-only"** + *"Changing an AI spending ceiling needs the ai:budgets:write permission, which your roles do not carry. The figures above stay visible."* |
| Saved | **"Ceiling updated."** |

#### AI surfaces — in detail
The whole screen is one. Two things a designer must not lose:
- **"A ceiling of zero means no ceiling."** This is counter-intuitive and it is
  said three times (intro, both field hints) because it is the single most
  dangerous misreading available on this screen. The **"Spending is uncapped"**
  warning exists because someone will still get it wrong.
- **Raising a ceiling is approval-gated**; lowering is not. The screen does not
  visually distinguish the two before you submit — you find out from the notice
  afterwards.

#### Actions and consequences

| Action | Reversible? | Confirmation | Dual control |
|---|---|---|---|
| Lower a ceiling | Yes | Checkbox (server-enforced) | No |
| **Raise a ceiling** | Yes | Checkbox (server-enforced) | **Yes — approval-gated** |
| Set a ceiling to zero | Yes, but it silently means *unlimited* | Checkbox | No |

#### Mobile
Web only.

#### RTL notes
The two-column grid collapses to one below `lg`, so RTL only affects order at
desktop width — the aside moves to the start side. **Meters fill from the start
edge and must flip.** **Must not mirror:** the module keys, the `USD` suffix
position relative to the number (the suffix is a logical `suffix` slot and does
flip; the numeral itself stays LTR), the surface names in the acceptance table.

#### What is weak today
- **Zero means unlimited.** The most dangerous value in the module is the one a
  new administrator will type when they mean "stop spending".
- **The confirm checkbox is not `required`** in the browser, unlike the
  console's. The user submits, waits for a round trip, and is told to tick it.
- Nothing distinguishes a raise from a lower before submit. The console turns
  its button red for a raise; this screen does not.
- The module select silently discards typed values on change (by design, but
  with no warning).
- There is no history: you cannot see who last changed a ceiling or when, from
  this screen.
- The acceptance table is on the budget screen rather than the console, which
  splits "what AI costs" from "what AI does" across two routes.

---

### 8.3 `/admin/ai/runs/:id` — one agent run

#### Route + title
Path `/admin/ai/runs/:id`. `<h1>` is the run's purpose, with the state Badge
beside it and the latency (`{n} ms`) beneath. Reached from the `runs` record
screen's **"Open this run"** button and from the console's runs table.

#### Who sees it
**`ai:runs:read`**. Held by `tenant.admin`, `tenant.compliance`,
`platform.admin`, `platform.support`, and the module admin roles for their own
module.

#### Purpose
The "why" that docs/15 requires behind every AI artifact: what was asked, what
the agent was allowed to do at the time, which tools it reached for, what it
cost, and the audit hash that proves the answer was not edited.

#### Layout skeleton

```
┌─ main ──────────────────────────────────────────────────────────────────────┐
│ All agent runs                                          (12px subtle link)  │
│ draft_reply                                    [Succeeded]          (24px)  │
│ 1 204 ms                                                                    │
│                                                                             │
│ (GuardrailNotice "Stopped by budget" → Open spending ceilings)              │
│ (GuardrailNotice "This run did not produce an answer")                      │
│ (ApprovalStrip  — waiting for a decision)                                   │
│                                                                             │
│ ┌ grid  lg:[ 1fr | aside ] ───────────────────────────────────────────────┐ │
│ │ ┌ Card  Tools it reached for ─────────┐  ┌ Card  Why this ran ────────┐ │ │
│ │ │ Step Tool        Cons.  Outcome Took│  │ Asked for    draft_reply   │ │ │
│ │ │ 1    ✦ search_kb  —     [Ok]  84 ms │  │ Asked by     orbit         │ │ │
│ │ │ 2    ✦ send_email [Con] [Blk] 12 ms │  │ Started by   user          │ │ │
│ │ └─────────────────────────────────────┘  │ Autonomy at the time       │ │ │
│ │ ┌ Card  The model call behind it ─────┐  │              Act w/ approv.│ │ │
│ │ │ Model      claude-…    Provider …   │  │ On behalf of user:01J…     │ │ │
│ │ │ Tier       standard    Outcome [Ok] │  │ About        conv:01J…     │ │ │
│ │ │ Tokens in and out  1 204 / 318      │  │ Ended        09:14         │ │ │
│ │ │ Cost       $0.004                   │  │ Input fingerprint  a91f…   │ │ │
│ │ │ Input fingerprint   a91f…           │  │ Guardrails that fired  …   │ │ │
│ │ │ Output fingerprint  77c2…           │  │ Reasoning retained  Yes    │ │ │
│ │ │ [Open the audit entry]              │  │ ConfidenceMeter ▓▓▓▓░ 0.82 │ │ │
│ │ └─────────────────────────────────────┘  └────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

#### Every element

**Back link:** **"All agent runs"** → `/admin/runs`.

**"Tools it reached for"** table. Columns: **Step** (`seq`, numeric),
**Tool** (an `EvidenceLink` whose source label is **"Arguments"**, revealing
**"Argument fingerprint"** and **"Result fingerprint"**), **Consequential** (a
**warning** Badge when true, otherwise blank), **Outcome** (Badge: Ok / Error /
Blocked / Refused / Awaiting approval / Over budget), **Took** (`{n} ms`, or an
em dash), **Approval** (a reference when the step was gated).
Empty: **"No tools were used"** / *"The agent answered from the prompt and its
context alone."*

**"The model call behind it"** card. Pairs: **Model** (mono), **Provider**,
**Tier**, **Outcome** (Badge), **Tokens in and out**, **Cost** (`Money`),
**Input fingerprint**, **Output fingerprint**; and in the card's actions slot a
link **"Open the audit entry"** → `/admin/ai-audit-log/{id}`.
Empty: **"No audit entry is linked"** / *"This run has not recorded an output
reference, which happens while it is still running or when it was refused before
a model was called."*

**"Why this ran"** aside — sticky. Pairs: **Asked for** (purpose), **Asked by**
(module), **Started by** (trigger), **Autonomy at the time**, **On behalf of**
(`actorRef`, `break-all`), **About** (`subjectRef`), **Ended**, **Input
fingerprint**, **Guardrails that fired** (comma-joined), **Reasoning retained**
(Yes), then a **`ConfidenceMeter`** labelled **"Model confidence"**.

#### Table columns
As listed above for the tools table. It is the only table on the screen.

#### Forms
**None.** This screen is entirely read-only. There is no re-run, no cancel, no
approve.

#### States

| State | Copy |
|---|---|
| Stopped by budget | **"Stopped by budget"** / *"The daily ceiling was already spent when this run asked for a model, so it was refused before any tokens were bought."* + link **"Open spending ceilings"**. |
| Failed / refused / cancelled | **"This run did not produce an answer"** / *"The run ended in this state and nothing was written on the back of it."* |
| Awaiting approval | An `ApprovalStrip`: *"This run is waiting for a decision before it can finish."* / *"The agent reached a step it is not allowed to take on its own at its current autonomy level."* / *"Decide it on the approvals screen, where the full request is shown."* |
| No tools | The empty state above. |
| No audit entry | The empty state above. |
| Not found / forbidden | The shared route error boundary. |

#### AI surfaces — in detail
This screen is the terminal "why". Every fingerprint here is a hash, never
content — which is what makes the audit safe to hand to a regulator whole. The
`✦` mark appears on each tool row's evidence link. Nothing on this screen can
change anything, deliberately: the decision surface is the approvals screen, and
the control surface is the console.

#### Actions and consequences
None. Two outbound links (spending ceilings, the audit entry) and one back link.

#### Mobile
Web only.

#### RTL notes
**Must not mirror:** every fingerprint, the model name, tool names, `actorRef`
and `subjectRef` (both are `kind:id` strings), the agent key. **Mirrors:** the
two-column split, the pair layout, the confidence meter's fill.

#### What is weak today
- The screen shows fingerprints and calls them "fingerprints", but offers no way
  to verify one — there is no compare, no copy, no chain view.
- **Reasoning retained** renders as just "Yes" with no way to reach the retained
  reasoning.
- `actorRef` and `subjectRef` are raw `kind:id` strings with no resolution to a
  name and no link.
- The approval strip tells you to go to the approvals screen but does not link
  to the specific approval.

---

## 9. `/settings` — Account

The other half of ADMIN. It is not under `/admin`, it has its own nav entry, and
it holds the single highest-stakes interaction in the module.

### Route + title
Path `/settings`. `<h1>` **"Account"** (`settings.title`). Intro: *"Your profile,
sign-in and sessions."*

### Who sees it
Everyone with a session. **Nothing about the person themselves is gated** — an
actor always has standing over their own record. Three tenant-level panels are
gated:

| Panel | Permission |
|---|---|
| API keys (list) | `core:api_keys:read` |
| Issue a key | `core:api_keys:create` |
| Revoke column | `core:api_keys:revoke` |
| Tenant appearance | `core:tenants:update` |
| Your data (DSAR) | `compliance:dsar:create` |

Every one of these fetches **tolerates a refusal**: a settings screen that 500s
because one panel is out of reach is worse than a settings screen with one panel
missing. When any tenant panel is visible, the line **"Settings for the whole
tenant, because you administer it."** (`settings.tenantIntro`) is shown above it.

### Purpose
Your own account; and, for whoever administers the tenant, the parts of the
tenant that are settings rather than records.

### Layout skeleton

Panels are stacked `<section aria-labelledby>` cards: `rounded-lg border
border-border p-4`, `flex flex-col gap-4`. Order is fixed:

```
┌─ main ──────────────────────────────────────────────────────────────────────┐
│ Account                                                             (24px)  │
│ Your profile, sign-in and sessions.                                         │
│                                                                             │
│ ┌ Profile ────────────────────────────────────────────────────────────────┐ │
│ │ Name [__________]   Email address [a@ex.com] (Changed by an admin…)     │ │
│ │ Language [English ▾]  Changes the language and reading direction of      │ │
│ │                       every screen.                    [ Save changes ] │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│ ┌ Password ───────────────────────────────────────────────────────────────┐ │
│ │ Changing your password ends every session, including this one — you     │ │
│ │ will be asked to sign in again.                                         │ │
│ │ Current [____] New [____] Confirm [____]      [ Update password ]       │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│ ┌ Two-step sign-in ───────────────────────────────────────────────────────┐ │
│ │ [ Set up two-step sign-in ]        Turn off two-step sign-in            │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│ ┌ Where you are signed in ────────────────────────────────────────────────┐ │
│ │ Device                    IP address   Signed in   Expires   State      │ │
│ │ Mozilla/5.0 (Macintosh…)  198.51.100.4 2 Jul 09:0 9 Jul 09:0 [Active]   │ │
│ │                                                        [ End session ]  │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│ ┌ API keys ─────────────────────────────── (core:api_keys:read only) ─────┐ │
│ │ Keys that call the platform on your tenant's behalf.                    │ │
│ │ ┌ Your new key ────────────────────────────────── (once, after mint) ─┐ │ │
│ │ │ Copy it now and store it somewhere safe — this is the only time it  │ │ │
│ │ │ is shown. If you lose it, revoke the key and issue another.         │ │ │
│ │ │ qvk_test_XXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXXX      (mono, 13px)     │ │ │
│ │ └─────────────────────────────────────────────────────────────────────┘ │ │
│ │ Name    Prefix          Mode   Last used  Expires    State  Revoke      │ │
│ │ CI bot  qvk_test_a1b2c3 [Test] 2 Jul      No expiry  Active [Revoke]    │ │
│ │ ── Issue a key ───────────────────────── (core:api_keys:create only) ── │ │
│ │ What is it for [__________]   Mode [Test ▾]                             │ │
│ │ ┌ fieldset: What this key may do ───────────────────────────────────┐   │ │
│ │ │ ▸ core (31)                                                       │   │ │
│ │ │ ▸ axis (37)                                                       │   │ │
│ │ │ ▾ ai (12)                                                         │   │ │
│ │ │    ☐ ai:agents:read     ☐ ai:agents:write                         │   │ │
│ │ │    ☐ ai:agents:pause    ☐ ai:budgets:read     …                   │   │ │
│ │ └───────────────────────────────────────────────────────────────────┘   │ │
│ │                                                       [ Issue key ]     │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│ ┌ Notifications ──────────────────────────────────────────────────────────┐ │
│ │ Unread only. Reading one here clears it everywhere.                     │ │
│ │ · Approval requested                        [ Mark as read ]            │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│                                                                             │
│ Settings for the whole tenant, because you administer it.                   │
│ ┌ Tenant appearance ────────────────────── (core:tenants:update only) ────┐ │
│ │ Product name [_______]      Typeface [Platform default ▾]               │ │
│ │ Logo (light) [___] Logo (dark) [___] Square mark [___]                  │ │
│ │ Accent [#ffb020] Accent, hovered [#d98e0b] Text on the accent [#070b14] │ │
│ │                                          ┌ Preview ─────────────┐       │ │
│ │                                          │ Acme Insurance       │       │ │
│ │                                          │ [ Primary action ]   │       │ │
│ │                                          └──────────────────────┘       │ │
│ │ [ Save changes ]                                                        │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
│ ┌ Your data ────────────────────────────── (compliance:dsar:create only) ─┐ │
│ │ Subject of the request [_____]  What you are asking for [A copy… ▾]     │ │
│ │ Erasure is carried out only after a second approver signs it off…       │ │
│ │ [ Raise the request ]                                                   │ │
│ └─────────────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Every element, panel by panel

**Profile.** Name (text). Email address — **read-only**, hint *"Changed by an
administrator, not here."* Language — a select over the shipped catalogues (en,
ar), hint *"Changes the language and reading direction of every screen."*
Deliberately absent, because the API has no surface for them: **timezone** (there
is no column) and **notification preferences** (there is no preferences table;
the inbox is read/unread and nothing else).

**Password.** Intro: *"Changing your password ends every session, including this
one — you will be asked to sign in again."* Three fields: Current password, New
password (hint *"At least 12 characters."*), Confirm new password. Client
errors: *"The two new passwords do not match."* and *"The new password must
differ from the current one."* Submit: **"Update password"**.

**Two-step sign-in.** Intro: *"An authenticator app generates a six-digit code
that is asked for after your password."* Whether it is on is **not readable from
here**, so the panel says so — *"Whether this account uses two-step sign-in is
not readable from here, so both actions are offered."* — and offers both **"Set
up two-step sign-in"** and **"Turn off two-step sign-in"**.
Enrolment shows a **Setup key** (hint: *"Type this into your authenticator app,
or open the link below on the device that holds it. It is shown once."*), a
**Setup link**, and a **Six-digit code** field (*"The code your authenticator
shows right now."*) with **"Confirm and turn on"**. Then **"Your recovery
codes"**: *"Each code signs you in once if you lose the authenticator. Save them
now — they are never shown again."*
Turning off: *"Confirm with a current code. Roles that require two-step sign-in
cannot turn it off."*, buttons **"Turn off"** and **"Leave it on"**. Results:
**"Two-step sign-in is now on."** / **"…now off."**

**Where you are signed in.** A table captioned *"Sessions for this account"*.
Columns below. The device cell **wraps rather than truncates** — the user agent
is long and unparsed, and wrapping beats a truncation that hides the one word
telling two browsers apart. **No row claims to be the current one**, because
`/v1/me/sessions` reports no such flag. Result: **"That session has been
ended."** Empty: *"No sessions recorded."* Failure: *"Your sessions could not be
read just now."*

**API keys.** Intro: *"Keys that call the platform on your tenant's behalf."*
See the table and the form below. Empty: *"No keys have been issued."* Failure:
*"Keys could not be read just now."*

**Notifications.** Intro: *"Unread only. Reading one here clears it
everywhere."* Each row is the notification's title (rendered from an i18n key
plus params — the API never sends display text) and a **"Mark as read"** button.
That button deliberately carries **no `aria-label`**: an accessible name that
does not contain the visible one fails WCAG 2.5.3, and the row is the context.
Empty: *"Nothing unread."* Failure: *"Your inbox could not be read just now."*

**Tenant appearance.** Intro: *"The product name, logo and accent every screen in
this tenant renders with. Leave a field empty to keep the platform default."*
Fields below. To the side, an `aria-hidden` **Preview** box on `bg-surface-2`:
the product name in display type, and a 36px pill reading **"Primary action"**
painted with the accent and contrast colours currently typed. *Not decoration:
this is the pair the contrast rule is about, drawn the way a button will draw
it.* Result: *"Appearance saved. It applies on the next screen you open."*

**Your data (DSAR).** Intro: *"Ask for a copy of the personal data held about
you, or ask for it to be erased. A request is logged and answered by the
compliance team."* Under the erasure option: *"Erasure is carried out only after
a second approver signs it off, and records under a legal hold are kept."*
Submit **"Raise the request"**; result *"Request raised. It is answered by the
date shown below."*; the table below is captioned *"Requests about you"* with
columns State / Answer due / Raised. Empty: *"You have raised no requests."*
The due date is set by the client to **30 days out** — a subject request is
answered within one month, and `due_at` is NOT NULL with no default.

### Table columns

**Sessions**
| Column | Header | Type | Alignment | Sort |
|---|---|---|---|---|
| `ua` | Device | text, **wraps**, max 24rem, 12px | start | no |
| `ip` | IP address | mono 12px | start | no |
| `createdAt` | Signed in | datetime, minute precision | start | no |
| `expiresAt` | Expires | datetime, minute precision | start | no |
| `state` | State | Badge — **Active** / **Ended** | start | no |
| — | (actions) | **End session** button | end | — |

Unknown `ua` or `ip` renders **"Unknown"**.

**API keys**
| Column | Header | Type | Notes |
|---|---|---|---|
| `name` | Name | text | what the issuer typed |
| `prefix` | Prefix | mono | `qvk_live_` or `qvk_test_` + 8 characters |
| `mode` | Mode | Badge | **Test** / **Live** |
| `lastUsedAt` | Last used | datetime | **"Never"** when null |
| `expiresAt` | Expires | datetime | **"No expiry"** when null |
| `state` | State | Badge | **Active** / **Revoked** |
| — | Revoke | button | **column appended only when the actor holds `core:api_keys:revoke`** |

**DSAR**
`State` (Badge) · `Answer due` (datetime) · `Raised` (datetime).

### Forms

**Issue a key** — the highest-stakes form in the module.

| Field | Label | Type | Validation | Default |
|---|---|---|---|---|
| `name` | **What is it for** | text | `required`, `maxLength={120}` | empty |
| `mode` | **Mode** | select | — | **test** |
| `scopes` | **What this key may do** | checkbox group | none | none checked |

Hints: *"The name is how you will recognise it in the list above."* ·
*"A test key is the safe default; a live key acts on real records."* ·
*"Choose as few as the job needs. A key with no permissions can sign in and
nothing else."*

The scope picker is a `<fieldset>` whose legend is **"What this key may do"**.
Permissions are grouped by their **first segment** into one native `<details>`
per module, summary `` `${module} (${count})` ``, and inside each, a
`sm:grid-cols-2` of checkboxes **whose visible labels are the raw permission
strings** (`core:api_keys:read`, `ai:agents:pause`, …). Rationale in source:
`core:api_keys:read` reads as "core / api keys / read" — the module is the only
grouping the permission string offers, and it is the one an operator thinks in.
It is prefix grouping, not a curated taxonomy. `<details>` because the list runs
to hundreds for an administrator; native disclosure is keyboard-reachable and
focusable with no script.

**You can only grant what you hold.** The grantable list is the actor's own
permission list, and it is empty unless they hold `core:api_keys:create`. When
empty: *"You hold no permissions that could be granted to a key."*

**Tenant appearance**

| Field | Label | Type | Validation | Max |
|---|---|---|---|---|
| `name` | Product name | text | — | 80 |
| `font` | Typeface | select | one of `space-grotesk`, `inter`, `ibm-plex-sans-arabic`, or **"Platform default"** | — |
| `logoLight` | Logo for light backgrounds | `url` | browser URL validation | 2000 |
| `logoDark` | Logo for dark backgrounds | `url` | same | 2000 |
| `logoMark` | Square mark | `url` | same | 2000 |
| `accent` | Accent | text | `pattern="#?[0-9a-fA-F]{6}"` | 7 |
| `accentHover` | Accent, hovered | text | same | 7 |
| `accentContrast` | Text on the accent | text | same | 7 |

Hints: *"Replaces the tenant name in the header and the browser tab."* ·
*"A URL the browser can load."* · *"Six-digit hex, for example the value your
brand guide gives."* · *"Applies to headings and body text alike."*

**The contrast gate is live and it disables the submit button.** Accent and
"text on the accent" are controlled inputs; their ratio is computed on every
keystroke against the WCAG 2.2 AA threshold of 4.5:1. Below it, the Accent field
shows the error *"Text on the accent must reach a contrast ratio of {ratio}:1.
This pair reaches {actual}:1."* and **Save changes is disabled**. Bad hex format:
*"Use a six-digit hex value beginning with a hash."*

**DSAR**

| Field | Label | Type | Options |
|---|---|---|---|
| `subject` | Subject of the request | text | — |
| `type` | What you are asking for | select | **A copy of my data** / **My data in a portable format** / **A correction to my data** / **Erasure of my data** |

### States

Covered per panel above. Cross-cutting: every panel's failure copy is *"X could
not be read just now."* — a soft, retryable phrasing, never an error page.
Unknown form intent: *"That action is not one this screen offers."*

### AI surfaces
None. `/settings` has no AI.

### Actions and consequences

| Action | Reversible? | Confirmation | Notes |
|---|---|---|---|
| Save profile | Yes | none | Changing language changes reading direction on the next screen. |
| Update password | **Ends every session including this one** | none beyond the intro copy | The user is signed out. |
| Enrol MFA | Yes (turn off) | none | **Recovery codes are shown once and never again.** |
| Turn off MFA | Yes | requires a current code | Roles that require MFA cannot turn it off. |
| End a session | **Irreversible for that session** | none | |
| **Issue a key** | The key exists until revoked | none | **The plaintext is shown once and never again.** |
| **Revoke a key** | **Irreversible** | `window.confirm()` — *"Revoke this key? Anything using it stops working immediately."* | Result: *"That key has been revoked."* |
| Save appearance | Yes | none | Blocked while contrast fails. |
| Raise a DSAR | Logged, not cancellable from here | none | Erasure is **dual-control at the API** — a second approver signs it off. |

### Mobile
Web only. There is no settings screen in the Expo app.

### RTL notes
**Mirrors:** panel layout, the two-/three-column field grids, the brand preview's
position beside the colour fields, the sessions table order.
**Must not mirror:**
- **The minted key** and its `qvk_` prefix — mono, `break-all`, LTR.
- The **prefix** column.
- The **setup key** and the **recovery codes**.
- The **permission strings** in the scope picker — every checkbox label is an
  LTR identifier sitting inside RTL prose. This is the worst RTL surface in the
  module and it needs `dir="ltr"` per label plus start-aligned text.
- Hex colour values (`#ffb020`).
- The user-agent string in the sessions table.

### What is weak today — including the one-time reveal

**The one-time reveal is the highest-stakes interaction in ADMIN and it is
currently four DOM nodes.**

What happens: the actor submits *Issue a key*; the API generates the secret,
stores only its SHA-256 hash, and returns the plaintext **once** in the create
response. The web action renders it from that result — **never from a loader,
never from a cookie**, because either would mean the secret is re-readable after
the one moment it exists. The list's `prefix` column (`qvk_live_` / `qvk_test_`
plus 8 characters) is the public handle: enough to recognise the key, useless to
replay. **The hash never comes back on a read path.**

What the user sees: an accent-bordered `bg-surface-2` block with a 14px heading
**"Your new key"**, a `max-w-prose` 12px subtle paragraph — *"Copy it now and
store it somewhere safe — this is the only time it is shown. If you lose it,
revoke the key and issue another."* — and then the value as `role="status"`
`break-all` mono 13px `<code>`. Selectable text, not an input: nothing here
should look editable, and a screen reader should read it as the value it is.

Design problems with that moment, in severity order:
1. **No copy button.** The single action the moment exists for requires a manual
   drag-select across a wrapped 40-character string.
2. **No confirmation that it was copied.** Nothing stops the user navigating
   away. There is no "I have saved it" gate, unlike the recovery-codes step on
   `/login`, which does have one.
3. **It renders above the keys table but inside the same panel**, so on a tenant
   with twenty keys it can appear below the fold after a scroll-restoring
   submit.
4. **It looks like the webhook reveal box and the MFA secret box but is styled
   by three separate pieces of code** with three different headings
   (*"Your new key"*, *"Copy this now — it is shown once"*, *"Setup key"*).
   Three one-time-secret moments, three visual treatments.
5. `role="status"` is polite — a screen-reader user may hear the key announced
   in the middle of other output, or not at all if focus moved.

Other weaknesses on this screen:
- **The scope picker shows raw permission strings to a human.** Hundreds of
  them, in `<details>` groups named after code prefixes (`core`, `dist`, `axis`,
  `ai`, `admin`). There is no search, no "select all read", no preset, no
  description of what any one of them does.
- **MFA state is unknown**, so the panel offers to both turn it on and turn it
  off, and the user has to know which applies.
- **No session says "this is you."** Ending the wrong one signs you out with no
  warning.
- The password panel warns that it ends every session, but there is no
  confirmation step — one click and you are out.
- The brand preview is `aria-hidden`, so a screen-reader user gets the contrast
  *error message* but never the preview it refers to.
- Eight stacked panels with identical borders and no in-page navigation. On a
  `tenant.admin` account this screen is very long.

---

## 10. The 33 tabs

All rendered by the chassis in §6 and §7. For each: the tab label, its API path,
permissions, columns, filters, and forms. **"Create" and "Delete" only exist
when a permission is listed for them.**

Roles that pass each `read` are given as the notable ones; `platform.admin`
holds `*:*:*` and passes everything.

### Group A — People and access

#### 1. Organisations (`/admin/tenants`)
- **API** `/v1/core/tenants` · **read** `core:tenants:read` · **update**
  `core:tenants:update` · no create, no delete.
- **Who** `tenant.admin` (via `core:*:*`), `platform.admin`.
- **Purpose** Edit the tenant you are signed in to. *Creating a tenant is a
  platform act, not a tenant act.*
- **Columns** Name (text) · Slug (text) · Plan (text) · Region (text) · Status
  (**badge**) · Created (datetime, sortable).
- **Filters** Status: active / suspended / closed → **Active / Suspended /
  Closed**.
- **Editable** Name · Plan · Region · Status (select) · **Brand** (json) ·
  **Policy** (json) · **Entitlements** (json).
- **Weak** Brand is editable here as raw JSON *and* through the far better
  `/settings` → Tenant appearance form. Two doors to the same data, one of them
  a textarea. Setting Status to `closed` on your own tenant from a list screen
  has no confirmation.

#### 2. People (`/admin/users`)
- **API** `/v1/core/users` · **read** `core:users:read` · **create**
  `core:users:create` · **update** `core:users:update` · **delete**
  `core:users:delete` · **searchable**.
- **Who** `tenant.admin`, `platform.admin`. This permission is also the gate on
  the whole `/admin` nav entry.
- **Columns** Name · Email (sortable) · Status (**badge**) · Sign-in method ·
  Two-factor (boolean) · Last seen (datetime, sortable) · Created (datetime,
  sortable).
- **Filters** Status: invited / active / suspended → **Invited / Active /
  Suspended**. Sign-in method: password / oidc / saml → **Password / OpenID
  Connect / SAML**.
- **Create** Name* · Email* · Phone · Language · Sign-in method (select) ·
  External identifier.
- **Edit** Name · Phone · Language · Status (select).
- **Note** *Credentials never travel through a CRUD body*, so no password,
  secret or recovery column appears on either form. Email is create-only.
- **Weak** Creating a person does not assign them a role — that is a separate
  tab, with a raw id. The invite flow is invisible: there is no "resend invite",
  no indication of whether an invited person ever arrived.

#### 3. Roles (`/admin/roles`)
- **API** `/v1/core/roles` · **read** `core:roles:read` · **create / update /
  delete** all `core:roles:update`.
- **Who** `tenant.admin`, `platform.admin`.
- **Columns** Key (text, sortable) · Name (text) · **Permissions (json)** ·
  Built in (boolean) · Created (datetime, sortable).
- **Create** Key* · Name* · **Permissions (json)***.
- **Edit** Name · Permissions (json).
- **Weak** **This is the RBAC screen, and it is a JSON textarea.** See §11.

#### 4. Role assignments (`/admin/user-roles`)
- **API** `/v1/core/user-roles` · **read** `core:roles:read` · **create /
  delete** `core:roles:assign` · **no update** — an assignment is granted or
  revoked, never amended.
- **Columns** Person (text) · Role (text) · Scope (json) · Created (datetime,
  sortable).
- **Create** Person* (**raw id text input**) · Role* (**raw id text input**) ·
  Scope (json).
- **Weak** **There is no user-lookup endpoint**, so "Person" is a text field into
  which you type an opaque identifier. Same for "Role". The two columns show the
  same opaque ids back. Assigning a role therefore requires opening the People
  tab in another window, copying an id, opening the Roles tab, copying another
  id, and pasting both. The scope object (`teams`, `productLines`, `modules`) —
  the entire ABAC model — is a JSON textarea with no hint of its shape.

#### 5. Teams (`/admin/teams`)
- **API** `/v1/core/teams` · **read** `core:teams:read` · **create / update /
  delete** `core:teams:write` · **searchable**.
- **Columns** Name (sortable) · Module scope (text) · Created (sortable).
- **Create / Edit** Name* · Module scope.
- **Weak** Teams have no membership surface anywhere in the product. You can
  create a team and never put anybody in it from the UI; membership only exists
  as a `teams` array inside a role assignment's `scopeJson`.

### Group B — Customers and records

#### 6. Customers (`/admin/customers`)
- **API** `/v1/core/customers` · **read** `core:customers:read` · **create**
  `core:customers:create` · **update** `core:customers:update` · **delete**
  `core:customers:delete` · **searchable** · default sort `updatedAt`.
- **Who** `tenant.admin`, `tenant.compliance` (read), the module admin roles.
- **Columns** Name (json) · Type · Verification (**badge**) · Tags (json) ·
  Risk flags (json) · Consent · Lifetime value (number) · Language · Updated
  (sortable) · Created (sortable).
- **Filters** Type: person / business → **Individual / Business**. Verification:
  none / pending / verified / failed → **None / Pending / Verified / Failed**.
- **Create** Name (json)* · Type (select) · Email addresses (json) · Phone
  numbers (json) · Language · Tags (json).
- **Edit** Name · Emails · Phones · Language · **Verification (select)** · Tags.
- **Note** *Administration needs to find a customer and see its state, not read
  its personal detail off a list.* Emails and phones are on the form, where one
  record is open and the actor is accountable — **never in columns**. Verification
  is a state a customer moves through, so it is editable and absent from create.
- **Weak** A person's name is a JSON blob in the first column — which is also the
  link into the record, so the clickable target is `{"first":"Ayesha",…}`.

#### 7. Consents (`/admin/consents`)
- **API** `/v1/core/consents` · **read** `core:consents:read` · **create**
  `core:consents:create` · **no update, no delete** — the API refuses PATCH and
  DELETE. Default sort `ts`.
- **Columns** Customer · Source (**badge**) · Purposes (json) · Channel opt-ins
  (json) · Evidence reference · Version (number) · Expires · When (sortable).
- **Filters** Source: web / whatsapp / import / agent / portal → **Web /
  WhatsApp / Import / Agent / Portal**.
- **Create** Customer* · Source* (select) · Purposes (json)* · Channel opt-ins
  (json)* · When (datetime)* · Evidence reference · Expires.
- **Note** Evidence: granted at the point of capture and superseded by a later
  row, never edited. Recording a migrated consent is a new row.
- **Weak** Three required JSON fields on one create form, with no schema hint.

#### 8. Products (`/admin/products`)
- **API** `/v1/core/products` · **read** `core:products:read` · **create /
  update / delete** `core:products:write` · **searchable**.
- **Columns** Name (json) · Product line (sortable) · Provider · Structure ·
  Status (**badge**) · Created (sortable).
- **Filters** Product line: motor / health / travel / home / life / sme / card /
  loan / account → **Motor / Health / Travel / Home / Life / Small business /
  Card / Loan / Account**. Structure: conventional / takaful / parametric →
  **Conventional / Takaful / Parametric**.
- **Create** Name (json)* · Product line* (select) · Provider · Terms reference ·
  Structure (select) · Pricing inputs (json).
- **Edit** Name · Status · Provider · Terms reference · Pricing inputs.
- **Weak** Provider is a raw id. Status is a free-text field on edit but a badge
  in the list, so it has no option list and will accept anything.

#### 9. Providers (`/admin/providers`)
- **API** `/v1/core/providers` · **read** `core:providers:read` · **create /
  update / delete** `core:providers:write` · **searchable**.
- **Columns** Name · Kind · In-house (boolean) · Lines (json) · Currency · Panel
  status (**badge**, sortable) · Created (sortable).
- **Filters** Kind: insurer / bank / financier → **Insurer / Bank / Financier**.
- **Create** Name* · Kind* (select) · In-house (boolean) · Lines (json) ·
  Currency · Commission (json) · Settlement terms (json).
- **Edit** Name · Panel status · Lines · Currency · Commission · Settlement
  terms.
- **Note** *Quote endpoints carry credentials by reference only*, so no
  credential column appears on either form.
- **Weak** Same free-text-status-rendered-as-badge problem as Products.

#### 10. Files (`/admin/files`)
- **API** `/v1/core/files` · **read** `core:files:read` · **delete**
  `core:files:delete` · **no create, no update** · **searchable**.
- **Columns** Storage key · Kind · Subject · Content type · Size (number) ·
  Personal data (**badge**) · Created (sortable).
- **Filters** Personal data: none / low / high → **None / Low / High**.
- **Note in source** *Upload is a signed-URL flow, not a form: this tab is the
  register and the delete affordance.*
- **Weak** **There is no upload route and no signed-URL route wired to this
  tab.** You can see files and delete them; you cannot add one, and you cannot
  download one — there is no link on `r2Key`, which is rendered as raw text.
  Size is a raw byte count, unformatted.

### Group C — Governance

#### 11. Approvals (`/admin/approvals`)
- **API** `/v1/core/approvals` · **read** `core:approvals:read` · **read-only**.
  Default sort `requestedAt`.
- **Who** `tenant.admin`, `tenant.compliance`, the module lead/admin roles,
  `finance.controller`.
- **Columns** Policy · Subject · Module · Decision (**badge**) · Reason ·
  Context (json) · Requested by · Requested (sortable) · Decided by · Decided
  (sortable).
- **Filters** Decision: pending / approved / rejected → **Pending / Approved /
  Rejected**.
- **Note** *The queue is read here; deciding happens on the record that raised
  it, which is where the context lives.*
- **Weak** There is a separate top-level `/approvals` route in the product. This
  tab duplicates it with no cross-link and no way to act. A reader who filters to
  "Pending" has found a list of things they cannot do anything about from here.

#### 12. Mandates (`/admin/mandates`)
- **API** `/v1/core/mandates` · **read** `core:settings:read` · **create /
  update / delete** `core:settings:update`.
- **Columns** Principal · Agent identity · **Spend cap (money**, currency read
  from the sibling `currency` column) · Status (**badge**) · Verification
  reference · Expires · Created (sortable).
- **Create** Principal* · Agent identity* · **Scope (json)*** · Spend cap
  (money) · Currency · Verification reference · Expires.
- **Edit** Status · Spend cap · Expires · Scope (json).
- **Note** A future-horizon seam: the delegated authority an agent acts under.
  The principal names it; the cap, scope and expiry bound it.
- **Weak** A spend cap for an autonomous agent is set here, in a generic list
  form, with no relationship shown to the AI budget screen that caps the same
  agents' spend by a different mechanism.

#### 13. Identity checks (`/admin/identity-verifications`)
- **API** `/v1/core/identity-verifications` · **read** `core:customers:read` ·
  **read-only**.
- **Columns** Subject · Method · Evidence level (**badge**) · Provider reference
  · Expires · Created (sortable).
- **Weak** Gated on `core:customers:read`, so anyone who can see customers can
  see their identity evidence level — a wider audience than the data warrants.

#### 14. Memory (`/admin/memories`)
- **API** `/v1/core/memories` · **read** `core:settings:read` · **create /
  update / delete** `core:settings:update`.
- **Columns** Subject · Kind · Provenance · Sensitivity (**badge**) · Expires ·
  Created (sortable).
- **Create** Subject* · Kind* · Content (json)* · Provenance* · Sensitivity ·
  Purposes (json) · Expires.
- **Edit** Sensitivity · Purposes · Expires.
- **Note** *Erasure reaches in here: a memory is deletable and purpose-bound,
  never an unbounded profile* — so provenance and purpose are named at write
  time.
- **Weak** The thing that makes memory legible — its content — is a required JSON
  field on create and **not editable afterwards**, and it is not a column, so
  once written you cannot read a memory's content anywhere in the UI.

#### 15. Lenses (`/admin/lenses`)
- **API** `/v1/core/lenses` · **read** `core:settings:read` · **create / update /
  delete** `core:settings:update`.
- **Columns** Person · Lens (json) · Updated (sortable).
- **Create** Person* · Lens (json)*. **Edit** Lens (json).
- **Weak** Three columns, two of which are an opaque id and a JSON blob. Nothing
  on this screen explains what a lens is.

#### 16. Rule packs (`/admin/rulepacks`)
- **API** `/v1/core/rulepacks` · **read** `compliance:rulepacks:read` · **create
  / update** `compliance:rulepacks:apply` · **no delete**. Default sort
  `effectiveAt`.
- **Who** `tenant.compliance` (via `compliance:*:*`), `platform.admin`.
- **Columns** Market · Version · Effective (sortable) · Created (sortable).
- **Create** Market* · Version* · Effective (datetime)* · Rules (json)*.
- **Edit** Effective · Rules (json).
- **Note** *Regulation as data: a pack is pasted in whole and dated, never
  authored rule by rule in a browser.* There is no delete — a pack that stopped
  applying is superseded by a later `effectiveAt`.
- **Weak** The rules themselves are not a column, so the list is four almost
  contentless fields. There is no diff between versions and no indication of
  which pack is currently in force.

#### 17. Audit log (`/admin/audit-log`)
- **API** `/v1/core/audit-log` · **read** `core:audit:read` · **read-only by
  construction**. Default sort `ts`.
- **Who** `tenant.admin`, `tenant.compliance`, `platform.support`.
- **Columns** Action · Actor · Subject · IP address · When (sortable).
- **Note** Hash-chained and append-only: readable, exportable, never writable —
  *an edit affordance here would be a defect, not a feature.*
- **Weak** **No search and no filters at all.** Five columns, forward-only
  paging, and the busiest table in the tenant. `core:audit:export` exists as a
  permission and there is **no export button anywhere on this screen**. The hash
  chain that makes the log trustworthy is invisible — no column, no verify
  action.

#### 18. Dead letters (`/admin/event-dlq`)
- **API** `/v1/core/event-dlq` · **read** `admin:dlq:read` · **read-only**.
- **Who** `platform.support`, `platform.engineer`, `platform.admin`. **Not
  `tenant.admin`** — this is a platform-staff surface that happens to live in the
  tenant's admin workspace.
- **Columns** Type · Consumer · Error · Event envelope (json) · Attempts
  (number) · Replayed · Created (sortable).
- **Weak** **`admin:dlq:replay` exists as a permission and `platform.engineer`
  holds it, but there is no replay button.** The one action this screen exists to
  enable is not on it. The envelope is a raw JSON blob in a compact table cell.

#### 19. Notifications (`/admin/notifications`)
- **API** `/v1/core/notifications` · **read** `core:notifications:read` ·
  **read-only**.
- **Columns** Title · Kind · Person · Subject · Read · Created (sortable).
- **Weak** "Title" is an **i18n key**, not text — the API never sends display
  text — so this column renders raw keys like `approvals.requested`. The
  `/settings` notifications panel resolves the same keys properly. Two surfaces
  over one table, one of which shows the user a key.

### Group D — Connections

#### 20. API keys (`/admin/api-keys`)
- **API** `/v1/core/api-keys` · **read** `core:api_keys:read` · **revoke** (as
  delete) `core:api_keys:revoke` · **no create here**.
- **Who** `dev.admin`, `tenant.admin`, `platform.admin`.
- **Columns** Name · **Prefix** · Mode (**badge**) · Scopes (json) · Last used
  (sortable) · Expires · Revoked · Created (sortable).
- **Filters** Mode: test / live → **Test / Live**.
- **Note in source** *The key itself is shown once, at issue, and stored only as
  a hash. What remains here is the prefix — enough to recognise it, useless to
  replay.*
- **Weak** **Minting happens on `/settings`, not here.** The tab named "API keys"
  in the workspace called "Administration" cannot issue one. A `dev.admin`
  looking for the key form will find this tab first and it will not have it.
  Scopes render as a raw JSON array.

#### 21. Sign-in providers (`/admin/identity-providers`)
- **API** `/v1/core/identity-providers` · **read**
  `core:identity_providers:read` · **create / update / delete**
  `core:identity_providers:write` · **searchable**.
- **Who** `tenant.admin`, `platform.admin`. **Not `dev.admin`.**
- **Columns** Name · Kind · Email domain · Issuer · Enabled (boolean) · Asserts
  two-factor (boolean) · Created (sortable).
- **Filters** Kind: oidc / saml → **OpenID Connect / SAML**.
- **Create** Name* · Kind* (select) · Email domain* · Issuer* · Client
  identifier · Discovery URL · Default role.
- **Edit** the same, plus **Enabled** and **Asserts two-factor** (booleans).
- **Note** *The client secret is a wrangler secret named by the row, never a
  value in it* — so it is not on this form.
- **Weak** Creating a provider here does not make it work; the secret must be
  bound out of band and **nothing on the screen says so**. "Default role" is a
  free-text role key with no validation and no picker — a typo silently grants
  nothing. There is no test-connection affordance, so the first time you find out
  the configuration is wrong is when a real person cannot sign in.

#### 22. Webhooks (`/admin/webhooks`)
- **API** `/v1/core/webhooks` · **read** `core:webhooks:read` · **create /
  update / delete** `core:webhooks:write` · **reveals `secret` on create**.
- **Who** `tenant.admin`, `platform.admin`. **`dev.developer` can read**
  (`core:webhooks:read`) but not write.
- **Columns** Endpoint · Event types (json) · Status (**badge**) · Created
  (sortable).
- **Create** Endpoint* · Event types (json)*. **Edit** Endpoint · Event types ·
  Status.
- **The signing secret.** Generated server-side and returned **once**, in the
  create response, and rendered by the chassis reveal box: **"Copy this now — it
  is shown once"** / *"The server keeps no readable copy…"*. It is never a
  column and never a field.
  **Design note the designer must know:** unlike the API key, **the webhook
  signing secret is stored in plaintext by design** — both sides HMAC with the
  same shared secret, so the server must be able to reproduce it. The UI copy
  ("The server keeps no readable copy") is therefore *the chassis's generic
  reveal copy*, and it is **not literally true for this resource**. A redesign
  should either give webhooks their own honest copy or add a "reveal secret"
  affordance, which the storage model already permits.
- **Weak, and it is the worst RBAC bug in the module:** **`dev.admin` holds
  `core:webhooks:write` but not `core:webhooks:read`**, and the tab is gated on
  `read`. The role built for integrations **cannot open the integrations tab at
  all.** Also: event types is a required JSON array with no picker, despite the
  set of event types being a known, finite list.

#### 23. Webhook deliveries (`/admin/webhook-deliveries`)
- **API** `/v1/core/webhook-deliveries` · **read** `core:webhooks:read` ·
  **read-only**.
- **Columns** Webhook · Event · Status (**badge**) · Response (number) · Error ·
  Attempts (number) · Next attempt · Created (sortable).
- **Filters** Status: pending / delivered / failed / dead → **Pending /
  Delivered / Failed / Given up**.
- **Weak** No redeliver action. A row in "Given up" is a dead end. Webhook and
  Event are opaque ids with no links.

### Group E — AI administration

These eight tabs are the raw data behind the three bespoke AI screens.

#### 24. Agents (`/admin/agents`)
- **API** `/v1/ai/agents` · **read** `ai:agents:read` · **create / update /
  delete** `ai:agents:write`. Default sort `updatedAt`.
- **Who** `tenant.admin`, `tenant.compliance` (read), `platform.admin`.
- **Columns** Key · Module · Autonomy (**badge**) · Tier (**badge**) · Status
  (**badge**) · Prompt · Updated (sortable).
- **Filters** Status: active / paused / retired → **Active / Paused / Retired**.
  Tier: fast / standard / reasoning → **Fast / Standard / Reasoning**.
- **Create** Key* · Module* · Name (json)* · Description (json) · **Autonomy
  (select: suggest / draft / act_with_approval / act / act_and_report)** · Tier
  (select) · Tools (json) · Guardrails (json) · Prompt.
- **Edit** Status (select) · Autonomy (select, same five) · Tier · Tools ·
  Guardrails · Prompt · **Pause reason**.
- **Note** *Registering an agent is hiring one: a name, the module it works in,
  the tools it may reach for and the autonomy it acts under.*
- **Weak** **The autonomy enum here does not match the AI console's.** This tab
  offers `suggest | draft | act_with_approval | act | act_and_report`; the
  console and run screen use `suggest | act_with_approval | act_within_limits |
  autonomous`. A tenant can set `act_and_report` here and the console will render
  the raw string. Worse: **this tab lets an actor change autonomy with a plain
  PATCH**, bypassing the console's confirmation, its raise detection and — since
  the approval gate lives on the console's dedicated endpoint — potentially the
  approval itself. Also: **"Pause reason" is a freely editable text column here**,
  so the reason recorded by the killswitch can be rewritten afterwards.

#### 25. Prompts (`/admin/prompts`)
- **API** `/v1/ai/prompts` · **read** `ai:prompts:read` · **create / update /
  delete** `ai:prompts:write`.
- **Who** `tenant.admin`, `platform.admin`. **Not `tenant.compliance`** — it
  reads, audits and pauses, and must not also be the party that authors what it
  reviews.
- **Columns** Key · Version (number) · Language · Status (**badge**) · Author ·
  Created (sortable).
- **Filters** Status: draft / active / retired → **Draft / Active / Retired**.
- **Create** Key* · Version (number)* · Language* · **Body (textarea)*** ·
  Variables (json).
- **Edit** Body · Variables · Status (select).
- **Note** Versioned, per locale, and published through an approval — never
  inlined in code.
- **Weak** The body is a plain textarea with no size hint, no variable
  validation, no preview, and no diff against the previous version. Publishing —
  the approval-gated act — is done by setting a select to "Active", which does
  not look like publishing.

#### 26. Agent runs (`/admin/runs`)
- **API** `/v1/ai/runs` · **read** `ai:runs:read` · **read-only**. Default sort
  `startedAt`. **Record link:** *"Open this run"* → `/admin/ai/runs/{id}`.
- **Columns** (18) Agent · Module · Purpose · State (**badge**) · Trigger ·
  Autonomy (**badge**) · Actor · Subject · Confidence (number) · Evidence (json)
  · Approval · Tokens in · Tokens out · Cost (number) · Latency · Error code ·
  Started (sortable) · Ended (sortable).
- **Filters** State: running / awaiting_approval / succeeded / refused / failed /
  cancelled / budget_stopped → **Running / Awaiting approval / Succeeded /
  Refused / Failed / Cancelled / Stopped by budget**. Trigger: user / event /
  schedule / api → **Person / Event / Schedule / API**.
- **Weak** **Eighteen columns in a compact table.** This is by far the widest
  table in the product and it will horizontally scroll on any screen. Cost is a
  raw micro-unit integer here (the bespoke screens format it as money).

#### 27. Tool calls (`/admin/tool-calls`)
- **API** `/v1/ai/tool-calls` · **read** `ai:runs:read` · **read-only**. Sort
  `ts`.
- **Columns** Tool · Run · Sequence (number) · Consequential (boolean) · Outcome
  (**badge**) · Duration (number) · When (sortable).
- **Filters** Outcome: ok / error / blocked / awaiting_approval → **Ok / Error /
  Blocked / Awaiting approval**.
- **Weak** No link from a tool call to its run, even though `runId` is a column
  and the run screen exists.

#### 28. Suggestions (`/admin/suggestions`)
- **API** `/v1/ai/suggestions` · **read** `ai:suggestions:read` · **update**
  gated on `ai:suggestions:read` (deliberately the read permission). Sort
  `shownAt`.
- **Columns** Surface (**badge**) · Module · Person · Outcome (**badge**) · Edit
  distance (number) · Shown (sortable) · Resolved.
- **Filters** Surface: ghost_text / chip / draft / forecast / filter → **Ghost
  text / Chip / Draft / Forecast / Filter**. Outcome: shown / accepted / edited /
  dismissed / expired → **Shown / Accepted / Edited / Dismissed / Expired**.
- **Edit** Outcome (select) · Edit distance (number) — and nothing else. *The
  surface itself resolves a suggestion through its own endpoint; correcting a
  stuck row by hand is the only reason to edit here.*
- **Note** *The receipt for the ambient grammar: a surface that is dismissed more
  than it is accepted has not earned its place.*
- **Weak** Update is gated on the **read** permission, so anyone who can see the
  acceptance data can rewrite it — and the acceptance data is what the budget
  screen's "Kept" percentage is computed from.

#### 29. AI budgets (`/admin/budgets`)
- **API** `/v1/ai/budgets` · **read** `ai:budgets:read` · **update**
  `ai:budgets:write` · **no create, no delete**. Sort `day`.
- **Columns** Day (text, sortable) · Module · Tokens used (number) · Token limit
  (number) · Cost used (number) · Cost limit (number) · Stopped · Updated
  (sortable).
- **Edit** Token limit · Cost limit.
- **Note in source** *Rows are opened by the runtime; the only human act is
  moving a ceiling, and raising one goes through the approval gate. Create and
  delete stay off deliberately: only update is approval-gated, so a
  delete-and-recreate pair would be an ungated ceiling raise that also erases the
  day's spend.*
- **Weak** This is the same control as `/admin/ai/budget`, without the
  confirmation checkbox, without the "zero means no ceiling" warning, without
  the meters and without the approval explanation. Two doors, one of them
  unguarded-looking. Cost figures are raw micro-units.

#### 30. Evals (`/admin/evals`)
- **API** `/v1/ai/evals` · **read** `ai:evals:read` · **create** `ai:evals:run`
  · **no update, no delete**. Sort `ts`.
- **Who** read: `tenant.compliance`, `tenant.admin`; run: `tenant.admin`.
- **Columns** Suite · Case · Agent · Model · Score (number) · Threshold (number)
  · Passed (boolean) · Detail (json) · Commit · When (sortable).
- **Create** Suite* · Case* · Agent* · Model* · Score* · Threshold* · Passed
  (boolean)* · When (datetime)* · Detail (json) · Commit.
- **Note** *Eval-first is the law; this is the scoreboard, and the golden set
  that produced it lives in the model-gateway package. Rows are posted by the
  runner — the form is the manual path for a suite run outside CI, and a result
  is never edited once recorded.*
- **Weak** The "create" form is a nine-field manual result-entry form — a human
  typing eval results by hand into the system of record for eval results. It
  should be a "run this suite" button. Passed/score/threshold are three columns
  that could be one visual.

#### 31. Knowledge (`/admin/knowledge-sources`)
- **API** `/v1/ai/knowledge-sources` · **read** `ai:prompts:read` · **create /
  update / delete** `ai:prompts:write`.
- **Columns** Name · Kind (**badge**) · Language · Personal data (**badge**) ·
  Chunks (number) · Status (**badge**) · Last indexed (sortable).
- **Filters** Kind: policy_wording / sop / faq / product / regulatory / web →
  **Policy wording / Procedure / FAQ / Product / Regulatory / Web**. Status:
  pending / indexing / ready / failed / stale → **Pending / Indexing / Ready /
  Failed / Stale**.
- **Create** Name* · Kind* (select) · Location · File · Language · Personal data
  (select).
- **Edit** Name · Location · Language · Personal data · **Status (select)**.
- **Weak** Status is machine-owned (indexing progress) but hand-editable, so a
  person can mark a failed source "Ready". "File" is a raw file id, and the files
  tab has no upload, so the only way to attach one is to know an id from
  elsewhere. No reindex action despite `stale` being a state.

#### 32. Guardrails (`/admin/guardrail-events`)
- **API** `/v1/ai/guardrail-events` · **read** `ai:audit:read` · **read-only**.
  Sort `ts`.
- **Columns** Rule · Severity (**badge**) · Detail · Run · Subject · When
  (sortable).
- **Filters** Severity: info / warn / block → **Information / Warning / Block**.
- **Weak** No link to the run. The console shows the same five columns, so this
  tab adds only the severity filter.

#### 33. AI audit log (`/admin/ai-audit-log`)
- **API** `/v1/ai/ai-audit-log` · **read** `ai:audit:read` · **read-only**. Sort
  `ts`.
- **Columns** (15) Module · Purpose · Model · Provider · Tier (**badge**) ·
  Outcome (**badge**) · Actor · Subject · Tool calls (json) · Guardrail flags
  (json) · Tokens in · Tokens out · Cost · Latency · When (sortable).
- **Filters** Tier: fast / standard / reasoning. Outcome: ok / refused / error /
  budget_exceeded → **Ok / Refused / Error / Budget exceeded**.
- **Note** *Every model call the gateway made, hashes only — which is what makes
  it safe to hand an auditor whole.*
- **Weak** Fifteen columns, two of them JSON. The hashes that are the point of
  the table are **not columns** — they are only visible via the console's
  evidence popover and the run screen. So the table that exists to be
  audit-grade does not show the audit evidence.

*(The 33 keys, in spec order:
tenants, users, roles, user-roles, teams, customers, consents, products,
providers, files, approvals, mandates, identity-verifications, memories, lenses,
rulepacks, api-keys, identity-providers, webhooks, webhook-deliveries,
notifications, audit-log, event-dlq, agents, prompts, runs, tool-calls,
suggestions, budgets, evals, knowledge-sources, guardrail-events,
ai-audit-log.)*

---

## 11. RBAC — the deepest part of the brief

### 11.1 The model, exactly

A permission is a three-segment string: **`module:resource:action`**. Any
segment may be `*`. A grant matches a wanted permission when every segment is
either identical or `*`. There is exactly one authorization function in the
platform, and a tenant mismatch is denied before permissions are even consulted.

There are **255 distinct permissions** in the catalogue (256 array entries — one
is declared twice). Anything not in the catalogue cannot be granted. A wildcard
string is a valid grant if it expands to at least one real permission.

**Size the matrix against these.** Permissions per module prefix, which is the
grouping every UI in the product uses:

| Prefix | Count | | Prefix | Count |
|---|---:|---|---|---:|
| `core` | 47 | | `ledger` | 23 |
| `axis` | 31 | | `compliance` | 19 |
| `dist` | 23 | | `north` | 15 |
| `orbit` | 23 | | `ai` | 13 |
| `signal` | 23 | | `scout` | 13 |
| `analytics` | 12 | | `admin` | 9 |
| `dev` | 4 | | | |

`core` alone is 47 rows, which is why the tree has to collapse by default and
why `core:*:*` is the wildcard every large role reaches for.

A grant also carries an optional **scope** (ABAC), with three keys:
- `teams` — the team ids the grant is limited to. Empty or absent means
  tenant-wide.
- `productLines` — motor, health, …
- `modules` — the modules the grant is limited to.

Two rules a designer must not design away:
1. **Scope is never merged across roles.** A team-scoped AXIS lead must not
   inherit the unscoped reach of a second role. Each grant is evaluated with its
   own scope.
2. **Scope fails closed.** A team-scoped grant cannot act on a subject with no
   team.

There is a helper that turns a wildcard bundle into the concrete list it covers.
**This is the primitive a permission matrix should be built on** — it is exactly
the difference between "granted" (`core:*:*` appears in the role) and "inherited"
(`core:users:delete` is covered by it).

### 11.2 The 31 roles, and what each can do

The brief that commissioned this document said 15. The code declares **31 role
keys — 27 internal and 4 external.** Every tenant is provisioned with all of
them except the three `platform.*` roles, which live outside tenants.

#### Platform staff (3) — outside the tenant

| Role | What it can do |
|---|---|
| **`platform.admin`** | `*:*:*`. Everything, everywhere. The only unrestricted role. |
| **`platform.support`** | Read diagnostics and the dead-letter queue; **impersonate a tenant user**; read the core audit log, AI runs and suggestions. No writes anywhere. |
| **`platform.engineer`** | Read diagnostics and the DLQ, **replay from the DLQ**, and write feature flags. Nothing else. |

#### Tenant governance (2)

| Role | What it can do |
|---|---|
| **`tenant.admin`** | All of `core` (`core:*:*`). Read-only across axis, orbit, signal, scout, north, ledger and compliance. All of analytics. In AI: write agents, **read and write budgets**, write prompts, run evals, use the kill switch. Read billing. In distribution: read everything, write channels, write and publish offerings, write rates. |
| **`tenant.compliance`** | Read **and export** the audit log; read consents, customers and approvals; **view PII**; **decide approvals**; all of `compliance:*:*`. In AI: read the audit log, runs, suggestions and agents; **pause agents**; **use the kill switch**; read evals. Read and approve SIGNAL creatives. Analytics exports including **unmasked**. Read AXIS policies, distribution quote requests, ledger client money and journals. |

The split between these two is deliberate and is stated in the source:
budgets, prompts and evals belong to *the tenant's AI operator*.
`tenant.compliance` deliberately does **not** get them — it reads, audits and
pauses, and must not also be the party that authors what it reviews.

#### AXIS — operations (3)

- **`axis.agent`** — every AXIS read, plus create/update cases, create and
  compare quotes, upload and extract documents, write tasks, create and update
  claims. In core: create/read/update customers, create consents, read/create
  files, search, notifications. Reads ledger transactions and distribution
  offerings/quote requests/offers.
- **`axis.lead`** — everything the agent has, plus assign and approve cases,
  approve quotes, verify documents, create/update/cancel policies, approve
  claims, write SOPs, **view PII**, **decide approvals**, analytics reports,
  exports and saved views, and distribution share/commissions/offer-override.
- **`axis.admin`** — `axis:*:*`, all of core customers/products/providers/files,
  view PII, read and decide approvals, ledger transaction and reconciliation
  reads plus run reconciliation, all analytics reads, and all of the
  distribution channel/offering/quote-request/offer surface.

#### ORBIT — customer experience (5)

- **`orbit.agent`** — ORBIT reads, reply and send, close conversations, handover.
- **`orbit.lead`** — plus assign, QA scoring, renewals update, journeys write,
  view PII, decide approvals.
- **`orbit.retention`** — renewals-focused: renewals read/update, quote create
  and compare, distribution offers.
- **`orbit.partners`** — partners create/update/certify, **issue test partner
  keys**, write distribution channels.
- **`orbit.admin`** — `orbit:*:*` plus all core customers, view PII, all
  consents, all files.

#### SIGNAL — growth (3)

- **`signal.marketer`** — SIGNAL reads, create campaigns and audiences, estimate
  audiences, generate creatives, create experiments.
- **`signal.lead`** — plus **launch and pause campaigns**, publish creatives,
  decide experiments, approve and reverse budget moves, decide approvals.
- **`signal.admin`** — `signal:*:*`.

#### SCOUT — market intelligence (3)

- **`scout.pm`** — SCOUT reads, ingest signals, promote whitespaces, create
  experiments.
- **`scout.lead`** — plus decide experiments, create data products, decide
  approvals.
- **`scout.admin`** — `scout:*:*`, plus all core products and providers.

#### NORTH — executive (4)

- **`north.exec`** — assign anomalies, run scenarios, write decisions, generate
  board packs, cross-module reads, analytics exports and saved views.
- **`north.analyst`** — write metrics, generate briefings, write analytics
  dashboards and reports, schedules.
- **`north.board`** — **exactly five permissions**: read briefings, board packs,
  snapshots, decisions, and analytics dashboards. The source says: *"Read-only by
  design — never grant write here."*
- **`north.admin`** — `north:*:*`, all analytics, ledger journal and transaction
  reads.

#### Finance (2) — *money movement is separated from operations by design*

- **`finance.analyst`** — every ledger read, invoke ledger AI, run
  reconciliation, create invoices, analytics, distribution reads.
- **`finance.controller`** — `ledger:*:*`, read and **decide approvals**, all
  distribution commissions, read and **approve rates**, read channels, all
  analytics reads plus run reports and create/download/**unmask** exports, read
  and export compliance evidence.

#### Developer (2)

- **`dev.developer`** — read consoles, use the sandbox, issue **test** keys, read
  webhooks.
- **`dev.admin`** — read consoles, use the sandbox, issue test **and live** keys,
  read/create/revoke API keys, **write webhooks**.

#### External (4) — these do **not** require MFA

- **`customer`** — no permissions at all.
- **`partner.developer`** — sandbox, issue test keys, read ORBIT partners.
- **`partner.manager`** — read ORBIT partners, read ledger transactions, read
  analytics reports, four distribution reads.
- **`provider.viewer`** — read SCOUT data products and the panel benchmark.

**MFA rule.** Every role is treated as staff and required to enrol **unless every
one of the actor's role keys starts with `partner.`, `provider.` or is
`customer`.** An account with **no role at all is treated as staff**: failing
closed here costs one enrolment; failing open costs an unprotected admin.

### 11.3 The two RBAC screens as they exist today

**`/admin/roles`.** A five-column table (Key, Name, Permissions, Built in,
Created) where the Permissions column is a serialised JSON array printed into a
34px compact row. `platform.admin`'s value is `["*:*:*"]` and fits;
`tenant.admin`'s is 24 strings and does not. Creating a role means typing a JSON
array into a textarea. Editing one means the same. There is no validation
feedback beyond the API's answer, no autocomplete over the 255 known
permissions, no wildcard expansion, no preview of what the role would actually
be able to do, and no indication anywhere that `system: true` roles exist and
should probably not be edited.

**`/admin/user-roles`.** Four columns (Person, Role, Scope, Created), all of them
opaque. Creating an assignment is two raw id fields and a JSON scope. There is
**no user-lookup endpoint**, which is why. Revoking is a delete.

Between them, these two screens are the entire access-control UI of a
multi-tenant platform, and neither of them ever shows a permission in words.

### 11.4 Designing the permission matrix

This is a design brief, so here is the surface to build.

**Shape.** Roles across, permissions down. 31 × 255 is 7,905 cells — too many to
show at once and too few to justify pagination. The permission namespace is
already a three-level tree, so use it:

```
                              tenant.  tenant.   axis.   axis.   dev.
                              admin    compliance agent  admin   admin
core                            ●        ◐          ◐      ◐       ◐
  ├ tenants                     ●        ○          ○      ○       ○
  │   read                      ✓granted ·          ·      ·       ·
  │   update                    ✓inherit ·          ·      ·       ·
  ├ users                       ●        ○          ○      ○       ○
  ├ customers                   ●        ◐          ◐      ●       ○
  └ api_keys                    ●        ○          ○      ○       ●
axis                            ◐        ◐          ◐      ●       ○
orbit                           ◐        ○          ○      ○       ○
ai                              ◐        ◐          ○      ○       ○
  ├ agents                      ●        ◐          ○      ○       ○
  │   read                      ✓inherit ✓granted   ·      ·       ·
  │   write                     ✓granted ·          ·      ·       ·
  │   pause                     ✓inherit ✓granted   ·      ·       ·
```

- **Row groups collapse at three levels**: module → resource → action. Collapsed
  rows show a **fill glyph** — `●` all, `◐` some, `○` none — computed from the
  expansion, not from the literal bundle.
- **Only expanded action rows show cell state.** This keeps the default view to
  ~11 module rows.

**Granted vs inherited — the central distinction.**
A role's stored bundle contains wildcards. The concrete permission set is the
expansion of that bundle. So each cell has three states, not two:

| State | Meaning | Suggested treatment |
|---|---|---|
| **Granted** | The exact string is in the role's bundle. | Solid accent check. |
| **Inherited** | Covered by a wildcard in the bundle (`core:*:*` covers `core:users:delete`). | Hollow check in accent, plus the covering pattern on hover/focus: *"via `core:*:*`"*. |
| **Absent** | Not covered. | A muted middle dot, never an empty cell — an empty cell reads as "not loaded". |

The distinction matters because **editing works on the bundle, not the
expansion**. Un-ticking an inherited cell is not a small edit; it means breaking
`core:*:*` into the 46 explicit strings that remain. The UI must say so before
it does it:

> *"`core:users:delete` is granted by the pattern `core:*:*`. Removing it
> replaces that pattern with the 46 permissions it still covers."*

That is the single most important sentence this screen needs and it does not
exist today.

**Readability at 255 rows.**
- Sticky first column (the permission path) **and** sticky header (the role
  keys). Role keys are LTR identifiers; rotate them 90° only as a last resort —
  a two-line wrapped label at 12px is more readable than rotated text and does
  not break in RTL.
- Freeze at most **6 role columns** at a time with a role picker above the
  matrix; more than six and the cell grid becomes unreadable at any zoom.
- Give the module row a **module accent** where one exists (axis amber, orbit
  teal, signal orange, scout blue, north violet); core, ai, admin, compliance,
  analytics, dev and ledger have none and should take the neutral border.
- Search over permission strings, filtered live, with the tree auto-expanding to
  matches.
- A **"differences only"** toggle that hides every row where all shown roles
  agree. On a real tenant this collapses the matrix to a few dozen rows and is
  the view a reviewer actually wants.

**Diffing two roles.** A dedicated two-column mode:

```
┌ Compare roles ──────────────────────────────────────────────────────────────┐
│ [ axis.lead ▾ ]   vs   [ axis.admin ▾ ]        [ Differences only ✓ ]        │
│                                                                             │
│ Only in axis.admin                                     (37)                 │
│   axis:cases:delete            ← via axis:*:*                               │
│   axis:escrow:approve          ← via axis:*:*                               │
│   core:products:write          ← via core:products:*                        │
│   …                                                                         │
│ Only in axis.lead                                       (2)                 │
│   analytics:saved_views:write                                               │
│   dist:offers:override                                                      │
│ In both                                                (84)  [ show ]       │
└─────────────────────────────────────────────────────────────────────────────┘
```

Three buckets, counted, with the covering pattern shown for every inherited
entry. Sorted by module, then resource, then action — never alphabetically
across modules, because a reviewer reads by module.

**Editing.** Keep the JSON as an escape hatch (it is the actual stored shape and
a power user will want it), but put it behind a disclosure labelled *"Edit as
JSON"*, and make the matrix the primary editor. Validate against the 255-entry
catalogue on the client: an unknown permission string is a typo, and the API
will reject the whole save for it.

**Scope.** The ABAC scope belongs on the **assignment**, not the role, and it is
three optional arrays (`teams`, `productLines`, `modules`). Design it as three
multi-selects on the assignment form, with the fail-closed rule stated in words:

> *"A team-scoped grant cannot act on anything that has no team."*

**What the assignment screen needs that does not exist.** A user picker. There is
no user-lookup endpoint today, so this is a genuine API dependency, not a design
choice — flag it as such in any redesign. Until one exists, the honest design is
to make the People tab's record screen the place assignments are made, since that
screen already has the person's id in hand.

**Roles nobody should edit.** `system: true` roles are the 31 shipped bundles.
The list shows the flag as a bare boolean column called "Built in". A redesign
should lock them, offer **"Duplicate to a custom role"** instead of Edit, and say
why.

---

## 12. Not built yet — flag these as gaps, not as design work

From the traceability records, these ADMIN specs are **not started**. A designer
should not assume any screen exists for them:

- **ADM-004 … ADM-013** — the tenant-lifecycle and platform-operations set.
- **ADM-020 … ADM-022** — the remaining platform-administration set.

Two drift notes worth knowing:
- **ADM-006** is recorded as not started, but the `/settings` **Tenant
  appearance** panel already ships with a live preview and a real WCAG contrast
  gate. The tracking is behind the code.
- **ADM-023** (DLQ replay) is implemented in the API — the permission exists and
  `platform.engineer` holds it — but **there is no UI affordance anywhere**.

Missing capabilities that are not tracked as specs but are visible holes in the
UI:
- No file upload and no signed-URL download on the files tab.
- No audit-log export button, despite `core:audit:export`.
- No webhook redelivery.
- No user picker anywhere.
- No "resend invite" for an invited person.
- No test-connection for a sign-in provider.
- No reindex for a stale knowledge source.

---

## 13. Cross-cutting notes

### Mobile, definitively
The Expo app maps each nav href to exactly one API collection. `/admin` maps to
`core/users`. **That is the whole of ADMIN on mobile**: a list of people and a
record detail. Not the other 29 tabs, not the AI console, not the budget screen,
not the run detail, not `/settings`. Mobile sign-in has no demo personas and no
SSO button. The mobile shell has no header, which is why the list draws its own
back button — an edge swipe is not a control a screen-reader or switch-control
user can reach.

### RTL, definitively
The platform ships `en` and `ar` from day one and uses **logical CSS properties
only** (`margin-inline-start`, `border-e`, `ms-auto`). Every font stack keeps the
IBM Plex Sans Arabic fallback.

**These must stay LTR inside RTL pages**, everywhere they appear:
identifiers and ids · `prefix` values (`qvk_live_…`) · the minted API key · the
webhook signing secret · MFA setup keys and recovery codes · hashes and
fingerprints · IP addresses · user-agent strings · hex colours · agent keys ·
prompt references · tool names · rule names · model names · **permission
strings** · JSON blobs · `r2Key` values · URLs.

**These must mirror**: sidebar side, header trailing group, table column order,
meter fill direction, progress bars, the aside/main split on the budget and run
screens, disclosure indentation.

The **✦** mark is direction-neutral and must remain adjacent to the artifact it
marks on both sides.

### Accessibility baseline in force
WCAG 2.2 AA. Focus is a 2px accent outline at 2px offset, visible on everything
interactive. Hit targets are ≥ 40px at default density (32px in compact tables —
worth challenging in a redesign). The skip link is the first focusable element on
every workspace page and targets `#workspace`, which is `tabIndex={-1}`. Tabs use
`aria-current="page"`, not ARIA tab roles, because they are links. Buttons never
carry an `aria-label` that omits their visible text (WCAG 2.5.3). Decorative
elements — the nav dot, the brand preview, the disclosure `+` — are
`aria-hidden`. Live regions: `role="status"` for successes and reveals,
`role="alert"` for API objections.

### Copy voice
Plain, second person, no exclamation marks, no jargon, and it always says what
happens next. Compare: *"Changing your password ends every session, including
this one — you will be asked to sign in again."* Every empty state names the
recovery action. Every denial names the missing permission or the person to ask.
A redesign should preserve this register exactly; it is the strongest thing in
the module.

---

## 14. The defect list, in one place

Ordered by how much design work they imply.

1. **`dev.admin` cannot open the webhooks tab.** It holds
   `core:webhooks:write` but not `core:webhooks:read`, and the tab gates on
   `read`. The integration role is locked out of the integration surface.
2. **The autonomy enum is inconsistent.** `/admin/agents` offers `suggest,
   draft, act_with_approval, act, act_and_report`; the console and run screen
   use `suggest, act_with_approval, act_within_limits, autonomous`. Three of
   five values do not overlap.
3. **The generic agents tab bypasses the console's autonomy safeguards** — a
   plain PATCH with no confirmation, no raise detection and no approval prompt.
   It also lets the pause reason be rewritten after the fact.
4. **The pause reason is validated in the browser only.** `minLength={3}` is
   markup; the server passes the value straight through.
5. **Two confirm patterns for the same idea.** Console: `required` in markup +
   server re-check. Budget: not `required`, server refusal only.
6. **The one-time key reveal has no copy button and no acknowledgement gate**,
   and it is one of three differently-styled one-time-secret moments in the
   product.
7. **The webhook reveal box tells the user the server keeps no readable copy.**
   For webhooks that is false by design — the signing secret is stored in
   plaintext because both sides HMAC with it.
8. **Role assignment is two raw id text fields**, because there is no user-lookup
   endpoint.
9. **The RBAC model is edited as JSON textareas.** 255 permissions, 31 roles, no
   matrix, no expansion, no diff, no validation.
10. **JSON blobs are rendered raw in compact table cells** across at least 14
    tabs, including customer names and role permissions.
11. **A malformed JSON field throws** rather than showing a field error.
12. **The audit log has no search, no filters and no export button** despite
    `core:audit:export` existing.
13. **The DLQ has no replay button** despite `admin:dlq:replay` existing and
    being held by `platform.engineer`.
14. **The files tab has no upload and no download.**
15. **Suggestions can be edited by anyone who can read them** — the update gate
    is the read permission, and suggestions feed the acceptance metrics.
16. **Sidebar nav labels truncate with no `title` attribute.**
17. **33 tab pills in one wrapping strip**, ungrouped, with the same `<h1>`
    ("Administration") on all of them.
18. **`/admin/runs` has 18 columns**; `/admin/ai-audit-log` has 15, and neither
    shows the hashes that make the audit meaningful.
19. **`window.confirm()` is the destructive-action pattern** — unstylable,
    unbrandable, and used for record deletion and key revocation alike.
20. **Forward-only paging labelled "Previous"/"Next"**, where Previous means
    "first page".
21. **Two doors to the same control** in three places: brand (JSON on the tenants
    tab vs the form in settings), AI budgets (raw tab vs the ceilings screen),
    approvals (admin tab vs the top-level route).
22. **MFA state is unreadable**, so the settings panel offers both turning it on
    and turning it off.
23. **`dist:ai:invoke` is declared twice in the permission catalogue.** Harmless
    at runtime, but any UI that counts or lists permissions will show 256 where
    255 exist.
