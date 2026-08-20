# LYRA — UI design brief (spine)

This document is written for a designer working in Claude Design who has **no
access to this repository**. Everything a designer needs to redesign the product
without reading code is either in this file or in the per-module files under
`ui/` that this file indexes.

It describes **what is actually built today**, not the roadmap. Anything specced
but unbuilt is marked **not yet built**. Anything the code does not settle is
marked **not determined from code**. If a statement here disagrees with a
screenshot, the code is the authority and this file is the bug.

Source of truth for the facts below: `packages/ui/src/*` (the design system),
`apps/web/app/*` (the web client), `packages/core/src/rbac.ts` (roles),
`apps/api/src/routes/me.ts` (the navigation the server hands the client).

### The pack, and what each file owns

This file is the **spine**: everything cross-cutting, plus the index. The
per-screen detail lives in eight module briefs:

| Brief | Covers |
|---|---|
| [`ui/axis.md`](ui/axis.md) | AXIS / Operations, and the quote and offer surfaces that live under `/distribution` |
| [`ui/orbit.md`](ui/orbit.md) | ORBIT / Conversations, including the public portal surfaces |
| [`ui/signal.md`](ui/signal.md) | SIGNAL / Marketing |
| [`ui/scout.md`](ui/scout.md) | SCOUT / Market |
| [`ui/north.md`](ui/north.md) | NORTH / Insight, and the `/analytics` reporting surfaces |
| [`ui/ledger.md`](ui/ledger.md) | Ledger, settlement, and the commission surfaces under `/distribution` |
| [`ui/compliance.md`](ui/compliance.md) | Compliance |
| [`ui/admin.md`](ui/admin.md) | Administration, AI operations, approvals and settings |

**Two workspaces have no brief of their own.** `/distribution` and `/analytics`
are real, routed, permission-gated workspaces with their own nav entries, but
`ui/` holds no `distribution.md` and no `analytics.md`. Their screens are
described where they are used from — distribution's quote and offer screens in
the AXIS brief, its commission screens in the LEDGER brief, and analytics in the
NORTH brief — and everything else about them is only in §5 here. A designer
picking up either workspace should expect less depth than the other eight.

---

## 1. Product context

### What LYRA is

LYRA is a **multi-tenant platform for insurance aggregation and distribution**,
sold to brokers, aggregators and managing agents. One deployment serves many
tenants; a tenant sees only its own data, its own brand and only the modules its
edition licenses.

The business shape it encodes:

- A tenant sells **offerings** (products) sourced from **multiple providers**
  (underwriters). It does not carry the risk; it places it.
- A customer request becomes a **quote request**, which is fanned out to
  providers, which return **quote responses**. Someone compares them and places
  one.
- The tenant earns **commission**, which is booked, statemented, sometimes
  **clawed back**, and always reconciled against what the provider actually paid.
- Sales run through two channel shapes at once: **b2c** (direct to consumer, via
  marketing, public portals and self-serve journeys) and **b2b** (partners,
  brokers, embedded distribution with their own API keys and their own
  commission rates).
- Money is real. Every value-bearing change is a transaction with an idempotency
  key, a state machine, and balanced double-entry journal lines. Client money is
  held separately and checked for shortfall.
- AI is present everywhere but is never the decider. Agents draft, propose, rank
  and explain; a person approves anything consequential.

### The workspaces (what the user calls them)

The five product modules have internal code names and **different user-facing
nav labels**. The nav label is what the user sees; the code name never appears
in the UI.

| Path | Code name | Nav label (en) | Nav label (ar) | What it holds |
|---|---|---|---|---|
| `/axis` | AXIS | **Operations** | العمليات | Cases, quotes, documents, tasks, policies, claims, complaints, SIU referrals, escrow batches, SOPs |
| `/orbit` | ORBIT | **Conversations** | المحادثات | Conversations, messages, renewals, journeys, partners, handover notes, QA scores, channel connectors, teams, routing rules, SLA policies, agent presence |
| `/signal` | SIGNAL | **Marketing** | التسويق | Audiences, campaigns, creatives, experiments, budget moves, AEO pages, attribution, spend |
| `/scout` | SCOUT | **Market** | السوق | Market signals, clusters, whitespaces, panel bench, experiments, data products |
| `/north` | NORTH | **Insight** | الرؤى | Metrics, snapshots, briefings, anomalies, alerts, scenarios, board packs, decisions |
| `/distribution` | — | **Distribution** | التوزيع | Channels, offerings, commission rates, quote requests/responses, commission entries, next-best-offers |
| `/ledger` | — | **Ledger** | دفتر الأستاذ | Transactions, journals, accounts, periods, reconciliation, client money, invoices, payments, FX, tax, settlements |
| `/analytics` | — | **Analytics** | التحليلات | Dashboards, reports, runs, exports, schedules, saved views, unit economics |
| `/compliance` | — | **Compliance** | الامتثال | DSAR, erasure log, disclosures, screenings, retention, legal holds, evidence bundles, incidents |
| `/admin` | — | **Administration** | الإدارة | Tenants, users, roles, teams, customers, products, providers, API keys, webhooks, audit, and all AI operations |
| `/platform` | — | **Platform staff** | — | Vendor-only diagnostics, dead-letter queue, feature flags |
| `/settings` | — | **Settings** | الإعدادات | The signed-in person's own account, plus tenant brand and DSAR self-service |

Nav labels are deliberately de-jargonised: a new user reads "Operations", not
"AXIS". The code names survive only as accent colours (§3) and as directory
names.

`/platform` and `/settings` are not peers of the rest in the rail. `/platform`
appears only for vendor staff; `/settings` is not in the server's nav at all and
is reached from the account menu (§4.3).

### Who uses it

These are the **real role keys** from `packages/core/src/rbac.ts`. There are
**32**. A person can hold more than one. Permissions are `module:resource:verb`
strings with `*` wildcards; the UI hides what a role does not hold, and the API
re-checks independently.

**Platform staff (the vendor, outside any tenant):**

| Role key | Day job |
|---|---|
| `platform.admin` | Holds `*:*:*`. Everything, everywhere. Rarely used, heavily audited. |
| `platform.support` | Reads diagnostics, the dead-letter queue, the audit log and AI runs; can impersonate a tenant user to reproduce a problem. Changes nothing. |
| `platform.engineer` | Diagnostics, DLQ read **and replay**, feature flags. No customer data. |

**Tenant-wide:**

| Role key | Day job |
|---|---|
| `tenant.admin` | Runs the tenant. Full `core:*:*`, read across every module, full analytics, and the whole AI operator job: writes agents and prompts, sets AI budgets, runs evals, pulls the kill switch. Also manages distribution channels, offerings and rates. |
| `tenant.compliance` | Full `compliance:*:*`, plus audit read/export, PII view, consents, approvals decide, AI audit and the AI kill switch, creative approval, unmasked exports. Deliberately **cannot** author prompts or agents — it reviews, it does not write what it reviews. |

**Operations (AXIS):**

| Role key | Day job |
|---|---|
| `axis.agent` | Front-line. Creates and works cases, raises quotes, uploads and extracts documents, works the task list, opens claims. Can create customers and consents. Read-only on money. |
| `axis.lead` | Everything the agent does, plus assign and approve cases, approve quotes, verify documents, create/update/cancel policies, approve claims, write SOPs, view PII, decide approvals, run and export reports. |
| `axis.admin` | `axis:*:*` plus full customer/product/provider/file administration, reconciliation runs, and full distribution control. |

**Conversations (ORBIT):**

| Role key | Day job |
|---|---|
| `orbit.agent` | Answers conversations, sends messages, closes threads, writes handover notes. Can open an AXIS case from a conversation. |
| `orbit.lead` | Plus assign conversations, score QA, update renewals, write journeys, decide approvals, view PII, run reports. |
| `orbit.retention` | Renewals specialist. Updates renewals, replies, and can raise a fresh quote and surface an offer to save a customer. **The one cross-shell role** — it opens AXIS surfaces from inside ORBIT (§5.3). |
| `orbit.partners` | Partner manager. Creates, updates and certifies partners, issues test keys, reads commissions and channels. |
| `orbit.admin` | `orbit:*:*` plus customers, consents, files, approvals, analytics read. |

**Marketing (SIGNAL):**

| Role key | Day job |
|---|---|
| `signal.marketer` | Builds audiences, estimates reach, drafts campaigns, generates creatives, writes AEO pages, creates experiments. **Cannot launch.** |
| `signal.lead` | Launches and pauses campaigns, publishes creatives, decides experiments, approves and reverses budget moves, decides approvals. |
| `signal.admin` | `signal:*:*` plus approvals and analytics. |

**Market (SCOUT):**

| Role key | Day job |
|---|---|
| `scout.pm` | Reads signals and clusters, creates experiments, promotes whitespaces into product ideas. |
| `scout.lead` | Plus decides experiments, creates data products, decides approvals, exports. |
| `scout.admin` | `scout:*:*` plus products and providers. |

**Insight (NORTH):**

| Role key | Day job |
|---|---|
| `north.exec` | Reads the whole business, assigns anomalies, runs scenarios, records decisions, generates board packs. |
| `north.analyst` | Owns the semantic layer: writes metrics, generates briefings, runs scenarios, writes dashboards, reports and schedules. |
| `north.board` | **Read-only by design.** Briefings, board packs, snapshots, decisions, dashboards. Nothing else, ever. |
| `north.admin` | `north:*:*` plus full analytics and ledger read. |

**Finance — separated from operations on purpose, and separated from itself:**

| Role key | Day job |
|---|---|
| `finance.analyst` | Reads the whole ledger, runs reconciliation, drafts journals, creates invoices, reads commissions and rates. **Drafts but cannot post**, and cannot close. |
| `finance.controller` | `ledger:*:*` — posts, closes periods, reverses. Decides approvals, owns commissions, approves rates, pulls unmasked exports, exports compliance evidence. |
| `finance.director` | **The second seat, and only a second seat.** Approves and posts what the analyst drafted, and can originate none of it: no transaction creation, no journal drafting, no bank import. |

`finance.director` is the design's clearest statement about dual control, and it
is worth reading as written in `rbac.ts`: *"A tenant with a single finance seat
therefore cannot post a manual journal, force a close or reopen a period: that
is separation of duties as a property of the role graph, not a runtime check
that can be configured off."* The design consequence: a finance screen must never
assume the person reading it can also act on it, and the approve/post
affordances have to survive being **absent** for the very person who drafted the
thing on screen.

**Developers:**

| Role key | Day job |
|---|---|
| `dev.developer` | Sandbox, test keys, reads webhooks and dev consoles. |
| `dev.admin` | Plus live key issuance, full API key lifecycle, webhook writes. |

**External (outside the tenant's own identity — the only roles exempt from mandatory MFA):**

| Role key | Day job |
|---|---|
| `customer` | Holds **no permissions at all**. Lands on `/settings`. |
| `partner.developer` | Sandbox and test keys against the partner API; reads its own partner record. |
| `partner.manager` | Reads its own channel, offerings, commissions, quote requests, ledger transactions and reports. |
| `provider.viewer` | An underwriter's read-only seat: data products and panel bench only. |

Two consequences the design must respect:

1. **Every internal role requires a second factor at sign-in.** `requiresMfa()`
   returns true unless every role the account holds is `partner.*`, `provider.*`
   or `customer`. An account with no role at all is treated as staff and is
   forced to enrol.
2. **Where a person lands after sign-in depends on their roles.** The map is
   `tenant.* → /admin`, `platform.* → /platform`, `dev.* → /admin`,
   `customer → /settings`; a module role lands on its own workspace. The landing
   router only ever picks a path the server's nav actually offered **and** the
   client can route to, so it never sends anyone into a 403; with no match at
   all it falls back to `/settings`, which every actor can reach.

---

## 2. Hard constraints the design MUST honour

These are rules, not preferences. Each one is enforced somewhere in code or
test; breaking one is a defect, not a style disagreement.

### 2.1 Navigation always carries a visible text label

**Every navigation target renders a visible text label.** There is no
icon-only rail, no collapse toggle, no `compact` mode, and none may be added.

This **explicitly overrides `docs/07-ui-design-system.md` §3**, which describes a
rail "collapsible to icons". That was reversed by product decision, and the
reversal is written into the code three times over:

- `packages/ui/src/nav.tsx` carries a HARD RULE box: `label` is a required prop
  on every component in the file, icons are decorative (`aria-hidden`) and
  optional, and there is deliberately **no** `collapsed` / `iconOnly` /
  `compactRail` prop anywhere.
- `packages/ui/src/primitives.tsx` documents on `IconButton`: "Navigation never
  uses this — nav labels are always visible."
- `apps/web/app/components/shell.tsx` repeats the reason: an icon-only rail
  costs every sighted user a hover to read the nav, and costs a screen-reader
  user the label outright.

`packages/ui/src/ui.test.ts` **fails the build** if a nav label ever becomes
optional.

Note for the designer: the brand asset `assets/Lyra_Brand_UI_Showcase.html`
shows a 58px icon-only rail. That asset predates this rule and is wrong on this
one point. Everything else in it is still the visual bar.

### 2.2 Brand tokens, never brand strings

Name, logo and colours come from tenant config. **A hard-coded "LYRA" in a
user-facing surface is a bug.**

- The header renders `brand.logo.dark ?? brand.logo.light ?? brand.mark` as an
  image; if there is no logo it renders the constellation mark plus
  `brand.name ?? tenantName` as text.
- The document `<title>` is `brand.name ?? tenantName ?? ""` — never a literal.
- The login screen carries **no product name at all**, because there is no
  session yet and therefore no tenant brand to read.
- A tenant may override exactly **five** custom properties: `--accent`,
  `--accent-hover`, `--accent-contrast`, `--font-display`, `--font-ui`. Nothing
  else. Module identity accents (`--module-axis`, etc.) are product identity and
  are **not** tenant-overridable.
- The five allowed font values are a hard allow-list held as a `Map` — `archivo`,
  `instrument-sans`, `space-grotesk`, `inter`, `ibm-plex-sans-arabic` — and each
  stack keeps the Arabic fallback appended. A `Map` rather than an object so a
  key like `__proto__` cannot answer with something inherited.
- Contrast of a tenant's chosen accent against `--accent-contrast` is validated
  live at ≥ 4.5:1 in the brand editor, and Save is disabled when it fails.

Design implication: never draw a screen that only works with the default lime
accent. It must survive a tenant picking deep blue, and it must survive a wide
wordmark logo replacing a short one.

### 2.3 RTL and i18n from day one

Two locales ship today: **en** and **ar**. The document root is
`<html lang={locale} dir={dirFor(locale)} data-theme={theme}>` — `dir="rtl"` for
Arabic.

- **Logical CSS properties only.** `margin-inline-start`, never `margin-left`.
  `padding-inline-end`, `inset-inline-start`, `border-inline-start`,
  `text-align: start`. In Tailwind terms: `ps-/pe-/ms-/me-/start-/end-/border-s`,
  never `pl-/pr-/ml-/mr-/left-/right-/border-l`. `ui.test.ts` fails the build if
  a physical-direction utility appears in `packages/ui`.
- **Every screen must be designed in RTL too**, not mirrored as an afterthought.
  Tables flip: the identifier column moves to the right edge, numeric columns
  align to the *inline* end. The rail sits on the right. Progress bars fill from
  the right (they set `inlineSize`, not `width`). The Switch thumb translates
  `-x` under RTL. A sticky first column sticks to `start-0`, so it follows `dir`.
- **No literal strings in components.** Shell strings live in
  `apps/web/app/i18n/{en,ar}.ts`; each workspace owns its own label table so a
  domain pack can rename every noun in it. The design system carries its **own**
  small catalogue (`packages/ui/src/text.tsx`) so kit chrome — the AI chip, the
  money and date formatters, the table furniture — speaks the locale it is
  rendered in without every call site passing strings down.
- Locale, time zone and calendar are provided once at the document root
  (`UiTextProvider`, `UiTimeZoneProvider`, and `UiCalendarProvider` where a
  screen needs it), not per component. Time zone is pinned to UTC on the server
  and on the first client pass, then swapped to the reader's zone after mount —
  otherwise the two passes disagree and React drops the route to the error
  boundary.
- Arabic is served by IBM Plex Sans Arabic, which is present in every font stack
  as the second family, with `unicode-range` splits so Latin users never
  download it.

### 2.4 WCAG 2.2 AA

- Every interactive element is keyboard-reachable, in DOM order.
- Focus is always visible. There is a global `:focus-visible { outline: 2px
  solid var(--focus); outline-offset: 2px }` in the app stylesheet, so a control
  that forgets its focus ring still has one. Never `outline: none`.
- Body text contrast ≥ 4.5:1. This is why the **light** theme darkens the accent
  to `#3f6212` rather than reusing the dark theme's `--vega-500` lime: white on
  that lime measures 1.7:1 and fails AA at every size, while white on `#3f6212`
  measures 7.17:1. `packages/ui/src/contrast.test.ts` measures the pairs and
  fails the build; the Playwright suite runs axe with
  `wcag2a`, `wcag2aa` and `wcag22aa` tags on real screens.
- A "Skip to content" link is the first focusable element on every page and
  jumps to `#workspace`, which is `tabIndex={-1}` so it can receive focus.
- Every `Table` requires a `caption` prop — it is a TypeScript-required prop,
  not an option. It may be visually hidden but it must exist.
- Every `IconButton` requires a `label`. Every `Sparkline` requires a `label`.
- `prefers-reduced-motion: reduce` forces all animation and transition durations
  to 0.01ms, and disables the view transitions and the cold open outright.
- Withheld affordances are **absent, not disabled**. A button the user may not
  press is not rendered at all — no disabled controls to puzzle over, and no
  information leak about what other roles can do. The same rule governs whole
  regions: the client-money chip, the companion rail and a settings tab the
  actor cannot open are absent rather than empty.

### 2.5 Ambient AI grammar

From `docs/15-experience-excellence.md`. AI is atmosphere, not an interruption.

- AI renders as **ghost text, quiet chips and background drafts**.
- **AI never opens a modal.** `packages/ui/src/overlays.tsx` states it in its
  header: dialogs and drawers are for human-initiated work only.
- **AI never auto-sends** outside an explicit tenant autonomy policy.
- **Every AI artifact carries the single marker `✦`** — one glyph, never a
  robot icon, never a coloured "AI" pill of its own invention. The constant is
  `AGENT_MARK = "✦"` and it is the only AI marker in the product.
- **Every AI artifact has an inspectable "why".** The pattern is a dotted-underline
  `EvidenceLink`, an `AgentBadge` popover labelled "Why this was drafted", or the
  `Provenance` mark from the Horizon kit, all leading to the run that produced it
  (`/admin/ai/runs/:id`).
- Confidence is shown as a meter with a floor (default 0.7): success above the
  floor, warning within 0.2 below it, danger under that.
- Guardrails are notices, not errors. A blocked action renders a
  `GuardrailNotice` that **quotes the specific rule**, never a generic message.
- **No blur anywhere.** docs/15 §3 bans it outright, which is why the chrome
  bands are opaque surfaces rather than translucent overlays (§4).

### 2.6 Domain-pack vocabulary

Never hard-code an industry noun. "Policy", "premium", "insurer", "claim",
"underwriter" are **domain-pack strings**, not product strings. The same code
must sell outside insurance.

The shared `common.*` catalogue holds only vocabulary every workspace shares
("Save changes", "Back to list", "Created"). Any noun a module owns lives in
that module's own label table, where a domain pack can override it. There is one
resolver for that chain — a screen's own table, then the shared table, then
`common.*`, then the raw key — and a test fails the build if a route writes down
a word the platform already says.

Design implication: a label may be **longer or shorter in another pack than it
is in the mockup**, in either locale. Every label position must survive a noun
twice its drawn length; the rail truncates rather than wraps for exactly this
reason.

### 2.7 Latency and money doctrine (context for both)

- Skeletons over spinners above 400ms. No spinner larger than 20px. Narrative
  progress above 3s. The shell implements this globally: it holds still for the
  first 400ms of a navigation and only then draws the arriving screen's shape,
  because a skeleton that flashes reads as a fault.
- Keyset (cursor) pagination throughout: there is no total row count, so
  **never render "of N"** on a list. The footer says "{count} shown", offers
  Previous/Next, and carries a page-size control of `[25, 50, 100, 200]` held in
  the query string.
- Anything that changes money or contractual state is a transaction with an
  idempotency key. Forms that post money carry a one-time key minted at render
  ("This form carries a one-time key, so pressing twice posts once").
- One confirmation idiom: `ConfirmButton`, a submit button that asks in the
  kit's own `Dialog` before submitting. `window.confirm()` is gone from the
  product — it never translates, never mirrors under RTL, cannot carry the
  tenant's brand, and is suppressed outright inside some embedded webviews,
  which is where the guard on a consequential action would silently disappear.
  Where the figures matter more than the words, the ask is a **required
  checkbox with the figures still on screen** rather than an overlay that hides
  them.

---

## 3. The design system as built

The design system is called **Constellation** and lives in `packages/ui`. It is
React + Tailwind v4 (tokens as CSS custom properties) + Radix primitives. It is
**dark-first**: the dark values are the base, and light remaps the same semantic
layer.

Over the base sits **Horizon** (ADR-0031), the editorial grammar the product is
actually drawn in: bands of chrome rather than floating overlays, hairlines
rather than shadows, one serif sentence to say what a block means, every number
in tabular mono. §3.4 is that grammar; §3.1–3.3 are the substrate it is built on.

### 3.1 Token architecture

Three layers, in this order:

1. **Palette** — raw named colours. Never referenced by a component.
2. **Semantic** — `--bg`, `--surface-1`, `--text`, `--accent`, plus the Horizon
   ramps. Components reference only these.
3. **Tailwind wiring** — `@theme inline`, deliberately *inline* so a runtime
   tenant override of `--accent` takes effect without recompiling Tailwind.

#### Palette

| Token | Value | Role |
|---|---|---|
| `--ink-900` | `#0b0e13` | Deepest background |
| `--ink-800` | `#10141d` | Panel |
| `--ink-700` | `#161c28` | Raised panel |
| `--ink-600` | `#1c2432` | Border / floating panel |
| `--star-100` | `#edf1f7` | Brightest text |
| `--star-300` | `#aeb6c6` | Muted text |
| `--star-500` | `#8a94a6` | Subtle text — 6.32:1 on `--ink-900` |
| `--vega-500` | `#c8f163` | Lime — the default accent (dark) |
| `--vega-600` | `#dbff85` | Accent hover (dark) |
| `--vega-700` | `#4a6a0f` | Accent (light); `--vega-500` fails AA as text on light |
| `--vega-800` | `#3b560c` | Accent hover (light) |
| `--ion-500` | `#55d68c` | Green — success |
| `--flare-500` | `#f08a80` | Red — danger |
| `--photon-500` | `#6c9ef0` | Blue — info (same value as `--module-scout`, on purpose) |
| `--solar-500` | `#e8c266` | Amber — warning |
| `--comet-500` | `#f0764f` | Orange — SIGNAL identity |
| `--nebula-500` | `#a98be8` | Violet — NORTH identity |

#### Module identity accents (never tenant-overridable)

| Token | Value | Module |
|---|---|---|
| `--module-axis` | `#e8a33d` | Operations |
| `--module-orbit` | `#3fc9b4` | Conversations |
| `--module-signal` | `#f0764f` | Marketing |
| `--module-scout` | `#6c9ef0` | Market |
| `--module-north` | `#a98be8` | Insight |

`--chart-1` … `--chart-5` are those five, in that order. There is no separate
categorical chart palette.

These five are the one part of the semantic layer the light theme *re-maps*
rather than reuses, because the light mockup ships genuinely different hues:
`--module-axis: #b45309`, `--module-orbit: #00786a`, `--module-signal: #c2410c`,
`--module-scout: #1d4ed8`, `--module-north: #6d28d9`.

A module signs itself in exactly one way: a 2px bar of its hue (`HueBar`, §3.4),
resolved through `hueVar(module)`, which returns the neutral `--accent` for
surfaces belonging to no module — home, settings, the ledger.

#### Semantic tokens — dark (the base)

| Token | Value |
|---|---|
| `--bg` | `#06080b` |
| `--surface-1` | `#080b10` (chrome bands) |
| `--surface-2` | `#0a0d13` (the card) |
| `--surface-3` | `#161c28` |
| `--border` | `#131926` |
| `--border-strong` | `#1a2030` |
| `--border-strongest` | `#232b38` |
| `--text` | `#edf1f7` |
| `--text-muted` | `#aeb6c6` |
| `--text-subtle` | `#97a1b2` |
| `--accent` | `--vega-500` |
| `--accent-hover` | `--vega-600` |
| `--accent-contrast` | `#06080b` — **15.2:1** on `--vega-500` |
| `--focus` | `--accent` |
| `--success` / `--success-contrast` | `--ion-500` / `#06080b` |
| `--danger` / `--danger-contrast` | `--flare-500` / `#06080b` |
| `--warning` / `--warning-contrast` | `--solar-500` / `#06080b` |
| `--info` / `--info-contrast` | `--photon-500` / `#06080b` |

Every status fill in this palette is a bright pastel, so the app background
clears AA as text on all four (7.44:1 on the tightest, info) — one universal
dark-on-fill choice instead of four bespoke shades.

#### The Horizon ramps

Horizon adds a finer-grained set on top of the semantic layer, and it is what
the built screens actually reference. Text is a five-step ramp plus two
decoration-only steps:

| Token | Value | Use |
|---|---|---|
| `--tx0` | `#f4f7fc` | Headline |
| `--tx1` … `--tx3` | (descending) | Body, secondary, tertiary |
| `--tx4` | `#97a1b2` | Quietest text that is still text — **7.69:1**, the AA floor |
| `--tx5` | `#5e6879` | **Decoration only.** Rules, ticks, disabled marks. Never text. |
| `--tx6` | `#3f4959` | **Decoration only.** |
| `--steel` | `#8fa0bc` | Cool grey for machine values |

Surfaces are a matching ramp: `--s1 #080b10` (the chrome bands), `--s2 #0a0d13`
(the card), `--s2b`, `--s3`, `--s4 #161c28`, and `--track #101620` for the empty
half of a meter. Lines are `--line #131926` through `--line4 #2a3346`, four
weights of hairline where another system would reach for shadow.

Beyond those: `--accent-soft` / `--accent-line` / `--sel` (selection wash),
`--danger-soft`, `--warning-soft` / `--warning-line`, and a status triplet per
tone — `--ok-bg`, `--ok-bg2`, `--ok-line`, `--ok-tx`, `--ok-tx2`, the same for
`--warn-*`, plus `--bad-line #3a2020`, and module-scoped `--north-*` and
`--scout-*` sets. The sky layer that draws the ambient field has its own:
`--star-op 0.18`, `--neb-op 0.55`, `--sky1`, `--neb1`, `--neb2`, `--star`.
`--hatch` and `--heat-fg` are for density plots.

**Elevation is deliberately switched off.** `--elev: none` and `--elev2: none`
in the dark theme: depth in Horizon is a hairline and a surface step, never a
drop shadow. `--scrim`, `--shadow` and `--shadow2` remain for the overlay layer
only.

#### Semantic tokens — light

Applied by `@media (prefers-color-scheme: light)` **and** by
`:root[data-theme="light"]`, so the tenant/user toggle wins over the OS. The
theme is set as an attribute on `<html>` from the `lyra_theme` cookie, so the
first paint is already the right palette. The light theme re-maps the same
semantic and Horizon layers; nothing in a component knows which theme it is in.

| Token | Value | Note |
|---|---|---|
| `--bg` | `#ffffff` | |
| `--text` | `#0e1116` | |
| `--text-muted` | `#4e5866` | |
| `--text-subtle` | `#5d6775` | 5.67:1 on `--bg` |
| `--tx6` | `#6f7a88` | 4.36:1 — decoration only, so it does not need the text floor |
| `--accent` | `#3f6212` | dark olive; `--vega-500` on white fails AA |
| `--accent-hover` | `#33500e` | |
| `--accent-contrast` | `#ffffff` | **7.17:1** on `--accent` |
| `--success` | `#15803d` | |
| `--danger` | `#b91c1c` | |
| `--warning` | `#a16207` | white on it is 4.97:1 — the tightest margin |
| `--info` | `#1d4ed8` | |
| `--star-op` | `0` | the ambient star field is a dark-theme effect only |
| `--shadow-glow` | `0 0 0 1px #e6e9ee, 0 4px 14px #0f172a08` | |
| `--shadow-raised` | `0 0 0 1px #e6e9ee, 0 14px 40px #0f172a14` | |

#### Typography

Fonts are **self-hosted woff2 from `/fonts`** with `font-display: swap` and
Latin/Arabic `unicode-range` splits. No CDN — an on-prem deployment may be
air-gapped.

| Family | Weights | Use |
|---|---|---|
| Archivo | 100–900 | **Display**: headings, wordmark, big numbers |
| Instrument Sans | 400–700 | **UI and body** |
| Instrument Serif | 400 + italic | The lede — one serif sentence per block |
| IBM Plex Mono | 400 | Identifiers, machine values, references, every figure |
| IBM Plex Sans Arabic | 400/500/600/700 | Arabic range only, in every stack |
| Space Grotesk Variable | 300–700 | Retained as a tenant brand option only |
| Inter Variable | 100–900 | Retained as a tenant brand option only |

Space Grotesk and Inter are the **previous** display/UI pair (the Instrument
wave is ADR-0026). They are still shipped and still selectable by a tenant in
the brand editor, but the product's own voice is Archivo + Instrument Sans +
Instrument Serif.

Stacks:

```
--font-display: "Archivo", "IBM Plex Sans Arabic", system-ui, sans-serif;
--font-ui:      "Instrument Sans", "IBM Plex Sans Arabic", system-ui, sans-serif;
--font-serif:   "Instrument Serif", "IBM Plex Sans Arabic", Georgia, serif;
--font-mono:    "IBM Plex Mono", ui-monospace, monospace;
--font-arabic:  "IBM Plex Sans Arabic", "Instrument Sans", system-ui, sans-serif;
```

**Three voices, and the rule is which one a thing is:** Archivo for what a
block is called, Instrument Serif for what it means, IBM Plex Mono for what it
measures. Instrument Sans carries everything else. A screen that puts a figure
in the display face, or a sentence in mono, is off-grammar.

Type scale — nine steps, no others:

| Token | Value | Typical use |
|---|---|---|
| `--text-12` | `0.75rem` (12px) | Micro-labels, eyebrows, `<dt>`, timestamps, the status strip |
| `--text-13` | `0.8125rem` (13px) | Dense UI: table cells, form labels, rail items |
| `--text-14` | `0.875rem` (14px) | **Body default**, buttons |
| `--text-16` | `1rem` | Card titles, section headings |
| `--text-18` | `1.125rem` | |
| `--text-22` | `1.375rem` | |
| `--text-28` | `1.75rem` | Page-level display heading, big money figures |
| `--text-36` | `2.25rem` | Hero figures |
| `--text-48` | `3rem` | Rare — hero wall only |

`--leading-body: 1.5`, `--leading-display: 1.15`, `--tracking-wordmark: 0.03em`.
Weights: 400 / 500 / 600 / 700.

`.lyra-tabular { font-variant-numeric: tabular-nums }` — every numeric table
column and every money figure uses it.

#### The frame scale (chrome bands, rail, gutters, measures)

Horizon's layout is a set of fixed bands with their own tokens, which is why
§4's chrome heights are not arbitrary pixel values in a component:

| Token | Value | What it sizes |
|---|---|---|
| `--chrome-top` | `50px` | The top bar |
| `--chrome-module` | `38px` | The mobile nav strip |
| `--chrome-meridian` | `74px` | The day strip under the top bar |
| `--chrome-status` | `28px` | The status strip at the foot |
| `--rail-width` | `196px`, `252px` at ≥ 1240px | The labelled nav rail |
| `--companion-width` | `288px` | The AI companion rail |
| `--gutter` | `12px`, `16px` at ≥ 640px | Chrome band padding |
| `--gutter-canvas` | `16px`, `24px` at ≥ 640px | The work canvas |
| `--gutter-rail` | `12px` | Inside the rail |
| `--stack-gap` | `16px` | Between blocks on the canvas |
| `--measure-canvas` | `100rem` | Max width of the canvas |
| `--measure-prose` | `68ch` | Max width of running text |

#### Space, radius, elevation, motion

- `--space-base: 4px`. Everything is a multiple.
- Radii: `--radius-sm 2px`, `--radius-md 3px`, `--radius-lg 6px`,
  `--radius-orbit 999px` (pills, meters, the account pill). These are **much
  tighter than a conventional dashboard** — Horizon is drawn as an instrument,
  not a card deck. A 12px or 16px corner anywhere in a redesign is off-system.
- `--shadow-glow: 0 0 0 1px var(--ink-600), 0 8px 24px #000c`
- `--shadow-raised: 0 0 0 1px var(--ink-600), 0 24px 80px #000c`
  Both carry a 1px hairline *inside* the shadow. They exist for the overlay
  layer only; on the page, `--elev: none` (above) is the rule.
- `--duration-fast: 120ms`, `--duration-base: 180ms`, `--duration-slow: 240ms`.
  Easings: `--ease-out`, `--ease-observatory`, `--ease-settle`.
- Keyframes: `rise` (10px settle), `draw` (a stroke drawing itself), `drift`
  (60s ambient nebula), `twinkle` (the "agent is thinking" signal), `pulse`,
  `orbit-spin` (the only spinner), `fade`, `tick`. Animation tokens:
  `--animate-rise`, `--animate-draw` (900ms), `--animate-chart-draw` (400ms),
  `--animate-drift`, `--animate-fade`, `--animate-tick`.
- `prefers-reduced-motion: reduce` forces every duration to 0.01ms.

#### Density

A global data attribute, not a per-component prop.

| | default | `[data-density="compact"]` |
|---|---|---|
| `--control-height` | 40px | 32px |
| `--control-padding-block` | 8px | 4px |
| `--row-height` | 44px | 34px |

### 3.2 Component inventory

`packages/ui` exports eleven modules: `cn`, `primitives`, `overlays`, `data`,
`flow`, `format`, `nav`, `ai`, `text`, `horizon`, `post-card`. Every component
below is real, exported, and named exactly as written. Variants and sizes are
the complete set — there are no others.

**`primitives.tsx`**

| Component | Variants / props | Concrete styling |
|---|---|---|
| `Button` | variant: `primary` \| `secondary` \| `ghost` \| `danger` (default **secondary**); size: `sm` \| `md` \| `lg` (default **md**); `asChild`, `loading` | primary `bg-accent text-accent-contrast hover:bg-accent-hover`; secondary `bg-surface-2 text-text border border-border hover:bg-surface-3`; sm `h-8 px-3 text-13`, md `h-10 px-4 text-14`, lg `h-11 px-5 text-16`. `loading` sets `aria-busy` and blocks activation — it does **not** disable, so focus is not lost. |
| `IconButton` | requires `label` | Never used for navigation. |
| `Field` | `label`, `hint`, `error`, wraps any control via `useFieldControl` | label `text-13 font-medium text-muted`; hint `text-12 text-subtle`; error `text-12 text-danger` with `role="alert"`, wired by `aria-describedby`/`aria-invalid` |
| `Input` | size sm `h-8` / md `h-10` / lg `h-11`; optional `prefix` / `suffix` | prefix/suffix absolutely positioned at `start-3`/`end-3`, text inset `ps-9`/`pe-9` |
| `Textarea` | `min-h-24 p-3` | |
| `DatePicker` | native `<input type="date">` / `datetime-local`; `calendar?: "gregory" \| "islamic-umalqura"` applied via `lang="…-u-ca-…"` | Deliberately native — a JS calendar is 40KB the product does not need, and the OS picker is already localised and accessible |
| `Select` | Radix; `placeholder` defaults to `…`; chevron is a literal `▾`; helpers `toSelectValue` / `fromSelectValue` | content `bg-surface-2 shadow-glow`; an empty option uses sentinel `__lyra_select_empty` |
| `Checkbox` | `size-5`, check glyph `✓` | Also the product's chosen **confirmation** control where the figures must stay on screen |
| `RadioGroup` | | |
| `Switch` | track `h-5 w-9`, thumb `size-4` | `rtl:data-[state=checked]:-translate-x-4` |
| `Slider` | a range control for continuous settings (the doctrine page and the post-card composer use it) | |
| `Card` | variant `flat` \| `raised` \| `floating`; sub-parts Header / Description / Body | flat `bg-surface-1`, raised `bg-surface-2 shadow-glow`, floating `bg-surface-3 shadow-raised`; all `rounded-lg border border-border text-start`; header `px-5 py-4 font-display text-16 font-medium`, description `text-13 text-subtle`, body `p-5` |
| `PageHeader` | the title / lede / actions band at the top of a screen | The most-imported layout primitive in the app after `Card` |
| `Badge` (aliased `Tag`) | tone `neutral` \| `accent` \| `success` \| `danger` \| `warning` \| `info`; size sm / md; optional `dot` | tone renders as `border-X/40 bg-X/10 text-X` — a tinted outline, never a solid fill |
| `Avatar` | initials fallback; sm `size-6` / md `size-8` / lg `size-10` | |
| `Skeleton` | `animate-pulse rounded-md bg-surface-3/60` | |
| `Separator` | | |
| `Tabs` | underline style: `border-b-2`, active `border-accent text-text` | |
| `ProgressBar` | `h-1.5 rounded-orbit bg-surface-3`, fill tinted by tone | sets `style={{ inlineSize }}` so it fills from the correct edge in RTL |

**`data.tsx`** — the reason most screens exist.

| Component | Contract |
|---|---|
| `Table<T>` | `columns, rows, rowKey, caption` (**required**, may be `captionHidden`), `sort`, `onSortChange`, `density: "comfortable" \| "compact"`, `stickyHeader`, `rowState?: (row) => "sealed" \| "draft"`, `onRowActivate`, `empty`, `footer` |
| `Column<T>` | `key, header, render, sortable?, numeric?, width?, headerLabel?` — `numeric` aligns to the inline end and switches on tabular figures |
| `Pagination` | `hasPrevious, hasNext, onPrevious, onNext, rangeLabel, pageSize, pageSizes, onPageSizeChange, label`. **Keyset paging: there is no total, so it never renders "of N".** |
| `EmptyState` | `title, body, action`, plus `ConstellationArt`: a 120×80 thin-line SVG — path `M42 44 L72 36 L83 68 L53 76 Z` plus `M25 24 L42 44`, four `--text-muted` dots and one r=5 `--accent` dot. Container `rounded-lg border border-dashed border-border p-10 text-center` |
| `Stat` | `label, value, delta` (teal positive / red negative), `deltaSuffix, invertDelta, hint` |
| `Sparkline` | `values`, `label` (**required**), `tone`; 100×28 `<polyline vectorEffect="non-scaling-stroke">`. Deliberately not a chart library — it is 40 numbers |
| `LineChart` | a series with a scale a reader can name: high and low as formatted figures, gridlines, first and last x label, y floor at zero |
| `DonutChart` | share of a whole — a ring with a named legend (`DonutSlice`) |
| `KPIWall` | `grid gap-6 sm:grid-cols-2 lg:grid-cols-4` |
| `Timeline` | `<ol className="flex flex-col border-s border-border ps-5">`; dot `size-2 rounded-orbit` at `insetInlineStart: -26px`, `bg-warning` when pending else `bg-accent` |
| `AuditTrail` | a `Table` locked to `density="compact"` and `rowState={() => "sealed"}`; columns When / Actor / Action (`font-mono text-12`) / Target / Detail |

`LineChart` and `DonutChart` are the whole charting answer, and the ceiling is
written down: zoom, brushing, multi-series and dual axes are where a library
would earn its place (ADR-0053). A bar tile stays one labelled meter per row on
purpose — a horizontal bar carries its own name in a tile narrow enough to sit
three-across.

**`flow.tsx`** — how a thing moves and how it balances.

| Export | Contract |
|---|---|
| `FlowMachine`, `FlowStep`, `FlowStatus`, `FlowVisit`, `FlowPlan`, `flowPlan()` | The data shape: a declared state machine, which states have been visited, and the plan derived from the two |
| `StateFlow` | The machine as a drawn path — where this record has been, where it is, and which hops are legal next. Used on transaction, settlement, claim, case and policy |
| `PostingFlow`, `FlowLeg`, `FlowBalance` | The double-entry view: which accounts a posting touches and whether the legs balance |

**`nav.tsx`** — the labelled navigation kit. `LyraModule`, `NavItem`
(`min-h-10 gap-3 rounded-md px-3 py-2 font-ui text-14`, active `bg-surface-3
text-text` + `aria-current="page"`), `NavSection`, `NavRail` (does not collapse),
`ModuleSwitcher` (+`ModuleLink`), `Breadcrumbs` (+`Crumb`), `TopBar`.

`ModuleSwitcher` and `Breadcrumbs` are mounted in the product (§4). `NavRail`,
`NavItem`, `NavSection` and `TopBar` are **not** — the shells hand-roll their
own rail and header against the same tokens, because the rail carries a shift
summary and grouped headings the kit's `NavRail` does not model. That is a
divergence a redesign may want to close, not a bug.

**`ai.tsx`** — the ambient AI kit.

| Component | Contract |
|---|---|
| `AGENT_MARK` | `"✦"` — the single AI marker |
| `AgentBadge` | `{agent, why, size}` → an accent `Badge` reading `✦ Drafted by {agent}`; with `why`, wrapped in a Popover labelled "Why this was drafted" |
| `GhostText` | `{text, onAccept, onDiscard}` — an inline draft the user takes or dismisses |
| `ConfidenceMeter` | `{value: 0–1, label, floor = 0.7}`; success ≥ floor, warning ≥ floor − 0.2, danger below |
| `EvidenceLink` | dotted-underline accent link to the evidence/run behind an artifact |
| `GuardrailNotice` | `{title, reason, tone, action}`, `role="status"`, `rounded-md border p-4`, tone as `border-X/50 bg-X/8 text-X`. **Quotes the specific rule** |
| `BudgetMeter` | `{used, limit, label, unit, resetsAt, locale}` |
| `ApprovalStrip` | `{summary, consequence, requestedBy, onApprove, onReject, blockedReason}`, `role="region" aria-label="Pending approval"`, `rounded-lg border border-accent/40 bg-accent/8 p-4` |

All of these read their own words through the kit's text catalogue, so the chip
speaks the locale it is rendered in rather than shipping English chrome into an
Arabic sentence.

**`overlays.tsx`** — `Dialog`, `Drawer`, `Tooltip`, `Popover`, `Menu`
(+`MenuItem`), `useToast` / `ToastProvider`, `CommandBar` (⌘K) and
`groupCommandItems`. Header states the rule: AI never opens a modal; these are
for human-initiated work. Mounted in the product: `ToastProvider` wraps every
shell, `Menu` is the account pill, `CommandBar` is the search palette, `Dialog`
is `ConfirmButton`'s ask, `Popover` is the "why" behind an AI chip.

**`format.tsx`** — the money and time layer.

| Export | Contract |
|---|---|
| `Money` | minor units + ISO currency; AED/USD → 2 decimals, JPY → 0, KWD → 3, resolved by `Intl`, not a hand-written table |
| `MoneyField` | the input side of the same contract — a money control that posts minor units |
| `minorFromMajor`, `majorFromMinor`, `formatMoney` | the conversions, so no screen does its own arithmetic |
| `DateTime`, `formatDate`, `formatInstant`, `instantOf` | `DateTimePrecision = "day" \| "time" \| "minute" \| "second"`, optional `timeZone` |
| `Instant` | a point in time as the API sends it |
| `Ref`, `shortRef`, `isOpaqueRef` | machine identifiers, shortened and set in mono. **The most-imported formatter in the app** |
| `NoData` | the one way a value that does not exist is drawn, so an empty cell is never an accident |

**`horizon.tsx`** — see §3.4.

**`text.tsx`** — the kit's own i18n: `KIT_TEXT` / `KitKey`, `KitText`, `uiText`,
`UiTextProvider` / `useUiLocale`, `UiCalendarProvider` / `useUiCalendar`
(`CalendarPreference = "gregorian" | "islamic-umalqura" | "dual"`),
`UiTimeZoneProvider` / `useUiTimeZone`, `useUiText`.

**`post-card.ts`** — `postCardSvg`, `POST_RATIOS`, `PostRatio`, `PostCardInput`:
social post cards rendered as SVG, for SIGNAL's own production rather than a
third-party design tool (CLAUDE.md §13).

### 3.3 What the product actually leans on

Import counts across `apps/web/app`, most-used first. This is the real weighting
a redesign should optimise for:

```
EmptyState 90 · Button 90 · Badge 85 · Card 79 · DateTime 65 · Table 64
Field 67 · Money 47 · Input 47 · Select 46 · Stat 33 · GuardrailNotice 29
Ref 26 · Textarea 24 · KPIWall 20 · Checkbox 20 · EvidenceLink 17
AGENT_MARK 15 · PageHeader 12 · Panel 10 · MoneyField 9 · ConfidenceMeter 9
AgentBadge 8 · DatePicker 8 · ProgressBar 7 · Menu 6 · Breadcrumbs 6
ToastProvider 6 · StateFlow 6 · ModuleSwitcher 5 · Provenance 4 · GhostText 3
Sparkline 3 · BudgetMeter 3 · PostingFlow 3 · Skeleton 2 · Slider 2
LineChart 2 · AutoGrid 2 · Timeline 2 · ApprovalStrip 2 · postCardSvg 2
```

The product is, in practice, **tables, empty states, forms, money and status
badges**, with an AI chip and a guardrail notice never far away. Design
accordingly.

Genuinely unused today: `NavRail`, `NavItem`, `NavSection`, `TopBar`, `Drawer`,
`Tooltip`, `AuditTrail`, `Avatar`, `Switch`, `Tabs`, `Separator`, `IconButton`,
`Tag` (the alias — `Badge` is used directly), `Lede`, `Hairline`, `HueBar` as a
named import (the shells draw the hue bar inline), `AnswerBanner`, and
`groupCommandItems`. `Pagination` is used through the shared list footer rather
than imported per screen.

### 3.4 Horizon — the editorial grammar

`packages/ui/src/horizon.tsx` extracts the seven marks the design repeats on
every surface, so a screen composes them instead of re-deriving inline styles.

| Mark | What it is |
|---|---|
| **Eyebrow** | a small tracked-out uppercase label that says *what a block is* |
| **Lede** | one Instrument Serif sentence that says *what it means* |
| **Figure** | every number in mono, tabular, with its unit set quietly beside it (`FigureTone`, `FigureSize`) |
| **HueBar** | 2px of module colour — the only place a module signs itself |
| **Hairline** | a rule instead of a shadow |
| **AnswerBanner** | ✦, who it was answered for, and how long it took |
| **Provenance** | the "why" behind an AI artifact, inspectable in place |

Plus three layout helpers: `hueVar(module)` (the CSS variable a module signs
with, neutral `--accent` for module-less surfaces), `Panel` (the framed block
that carries an eyebrow, a lede and its content), and `AutoGrid` (a grid that
fits panels without a per-screen column count).

The grammar in one sentence: **a block announces itself in a tracked-out label,
explains itself in one serif sentence, and states itself in tabular mono.**

### 3.5 Motion, transitions and the field

Defined in `apps/web/app/app.css`, on top of the kit.

- **`.lyra-field`** — the ambient background of every signed-in surface: a dome
  radial gradient with `background-attachment: fixed`, a `::before` carrying two
  slowly drifting star layers at `--star-op`, and an `::after` carrying two
  still nebula glows at `--neb-op`. In light theme `--star-op` is `0`, so the
  field is a plain gradient.
- **`.lyra-enter`** and **`.lyra-stagger`** — arrival. `lyra-stagger > *` delays
  each child by 20ms up to the seventh; everything from the eighth on shares a
  160ms delay, so a long page does not cascade for a second and a half.
- **`.lyra-nav-progress`** — a 2px accent sweep at the top of the document
  whenever a navigation is in flight. It is the only global pending cue; every
  route still owns its own busy buttons.
- **`.lyra-cold-open`** — the first sitting only (ADR-0055): a veil holds, the
  constellation draws itself (lines 640ms, stars 440ms, Vega 600ms), the
  wordmark rises at 520ms, and the veil lifts off a workspace that was already
  there. `pointer-events: none`, `aria-hidden`, removed when its own animation
  ends, gated off under reduced motion and after the first sitting (marked in
  `sessionStorage`, not a cookie).
- **View transitions.** The chrome does not move between screens: the header,
  rail and status strip are named `lyra-chrome`, `lyra-rail` and `lyra-status`
  and their transition animation is `none`, while the workspace region
  cross-fades. All of it is disabled under reduced motion.

**The z-index ladder** (documented in `app.css`, and the only one):

```
-1  decorative background
10  sticky table header, in-panel tooltips
20  status footer, sticky first column
30  chrome header and module rail
40  overlay scrim
50  overlay content
55  route-transition bar
60  cold open veil
```

---

## 4. Global chrome

Everything below is `apps/web/app/root.tsx`, `apps/web/app/components/shell.tsx`
and `apps/web/app/app.css` as built.

There are **two chrome shapes**: the workspace shell (this section), and the
five **module shells** — AXIS, ORBIT, SIGNAL, SCOUT, NORTH — which reuse the
same header, account menu, breadcrumbs and skeleton but swap the rail for that
module's own destinations and sign the whole frame in that module's hue (§5.3).
Outside both sits the public portal, which has no session and no shell at all.

### 4.1 Structure

```
<html lang dir data-theme>
  <body class="min-h-screen bg-bg text-text antialiased">
    UiTextProvider → UiTimeZoneProvider
      ToastProvider
        <div class="lyra-field flex h-dvh flex-col overflow-hidden bg-bg text-text" style={brandStyle}>
          ColdOpen              (first sitting only, decorative)
          skip link → #workspace
          <header>              h-[--chrome-top]  (50px)   lyra-vt-chrome  z-30
          <Meridian>            h-[--chrome-meridian] (74px)  the day strip
          <div class="flex min-h-0 flex-1 flex-col md:flex-row">
            mobile nav strip    min-h-[--chrome-module] (38px)  md:hidden
            <nav>               w-[--rail-width]  lyra-vt-rail   (md and up)
              <ShiftRail>
              grouped nav
            <main id="workspace" tabindex="-1">   lyra-vt-workspace lyra-stagger
              hue bar · Breadcrumbs · children (or PageSkeleton)
            <Companion>         w-[--companion-width]  (opt-in, permission-gated)
          <footer>              h-[--chrome-status] (28px)  lyra-vt-status  z-20
```

**The document does not scroll.** The root is `h-dvh` with
`overflow-hidden`; the rail and the canvas each scroll on their own. That is the
single biggest structural difference from a conventional dashboard: the chrome
is a set of **fixed bands**, not sticky elements riding a scrolling page, which
is why nothing needs a blur or a shadow to separate itself from content passing
underneath (§2.5 — docs/15 bans blur outright).

`brandStyle(brand)` writes **only five** custom properties onto that root div:
`--accent`, `--accent-hover`, `--accent-contrast`, `--font-display`,
`--font-ui`. The tenant picks one font and it covers both roles; the allowed
values are the five-key `Map` in §2.2.

### 4.2 Skip link

First focusable element. `sr-only` until focused, then a positioned pill on
`--surface-2`. Label: `app.skipToContent` = "Skip to content". Target
`#workspace`, which is `tabIndex={-1}`.

### 4.3 The top bar (50px)

`lyra-vt-chrome z-30 flex h-[var(--chrome-top)] shrink-0 items-center gap-2
border-b border-border bg-surface-1 px-[var(--gutter)] sm:gap-3`

Opaque, non-sticky (it is a band, not an overlay), no blur. Contents in inline
order:

1. **Lockup** — a `NavLink` to `/`. Either `<img class="h-6 w-auto">` from
   `brand.logo.dark ?? brand.logo.light ?? brand.mark`, or the
   `ConstellationMark` (Lyra the harp: four charted stars with Vega set apart in
   the tenant accent, `aria-hidden`) beside the product name in the display face
   at `tracking-[0.15em]`.
2. **Hairline divider, then the served tenant name** — `sm:inline` only, and
   **suppressed entirely when the tenant name equals the product name**, so a
   single-tenant deployment does not read "Acme · Acme".
3. **`SearchPalette`** — the ⌘K command bar (ADR-0031). It folds the design's
   separate "Where" overlay into one palette: nav destinations filtered
   client-side, record matches fetched from the web app's own `/search` loader
   (not the API — the session cookie is deliberately unreadable by script).
4. **Right cluster** (`ms-auto flex shrink-0 items-center gap-1`):
   - **`PostureChips`** — two facts, not decoration: how much client money the
     tenant is holding, and whether this month's ledger period is still open.
     Each chip is a link to where the number is explained. `lg:` and up.
     **Absent, not empty**, for an actor without `ledger:client_money:read`.
   - **`ThemeToggle`** — flips the `data-theme` attribute and the `lyra_theme`
     cookie together. Nothing else in the app reads a theme; every surface is
     tokens and the two palettes are two token blocks.
   - **Companion toggle** — a `✦` button, `lg:` and up, rendered only for an
     actor holding `ai:runs:read`.
   - **Account pill** — the trigger for the kit's `Menu`.
     `rounded-orbit border border-border`, a 24px initials avatar in
     `bg-accent text-accent-contrast font-mono`, then **the role key** (not the
     person's name), then `▾`. The role key is deliberate: the thing that
     changes what the screen does is which seat you are in.

The account menu carries the actor's other profiles (each labelled by role key,
the active one disabled, shortcut column reading "viewing" / "view as"), then
Settings, then Sign out with `tone: "danger"`.

### 4.4 Meridian — the day strip (74px)

Part of the chrome, under the top bar (ADR-0061). One line for today, ticked by
the hour, with a dot where each thing landed and a playhead that can be dragged.

- Left of now is **replay** — the shift as it stood at that hour. Right of now
  is the rest of the day, which nothing has landed in yet.
- Dragging the playhead changes which moment the shift rail answers for. It
  never fabricates figures for a time that has not happened.
- It takes the module hue of the current path, so the strip is coloured by where
  you are.
- Everything positioned from local time renders only after mount: the server
  formats in UTC, so a dot placed from local hours during SSR is a hydration
  mismatch, which React 19 answers by throwing the route to the error boundary.

### 4.5 Primary navigation

`aria-label` = `nav.primary` = "Primary". The items come from the API — `/v1/me`
returns nav items with a `labelKey` — and are filtered twice: by permission on
the server, and by `isRouted()` on the client so an item this build cannot route
to is never rendered.

**The nav is grouped.** One ungated item, then three permission-gated headings.
A heading whose children were all filtered out is dropped entirely.

| Group | Item | Href | Permission |
|---|---|---|---|
| — | Home | `/` | (none) |
| `nav.group.modules` | Operations | `/axis` | `axis:cases:read` |
| | Conversations | `/orbit` | `orbit:conversations:read` |
| | Marketing | `/signal` | `signal:campaigns:read` |
| | Market | `/scout` | `scout:signals:read` |
| | Insight | `/north` | `north:metrics:read` |
| `nav.group.records` | Distribution | `/distribution` | `dist:quote_requests:read` |
| | Ledger | `/ledger` | `ledger:txns:read` |
| | Analytics | `/analytics` | `analytics:reports:read` |
| | Compliance | `/compliance` | `compliance:dsar:read` |
| `nav.group.platform` | Administration | `/admin` | `core:users:read` |
| | Platform staff | `/platform` | `admin:diagnostics:read` |

**`/settings` is not in this list.** It is reached from the account menu. A
designer redrawing the rail should not add it back.

**Rail structure** (`md` and up):

```
lyra-vt-rail hidden md:flex md:w-[var(--rail-width)] md:shrink-0 md:flex-col
md:gap-0.5 md:overflow-y-auto md:border-e md:border-border
md:p-[var(--gutter-rail)]
```

- **`ShiftRail` sits on top of the nav, not instead of it.** It is what today
  asks of this actor, in the order it arrived, over a ring saying how much of it
  is behind them. It renders **nothing at all** when the inbox could not be read
  — a rail that says "0 of 0" because a fetch failed is a lie, and an absent
  block is not.
- Then the group headings: `mb-1 mt-4 px-3 font-ui text-12 font-medium uppercase
  tracking-[0.14em] text-subtle first:mt-0`.
- 196px wide, rising to 252px at ≥ 1240px.

**Item rendering** (`NavItemLink`):

- top level `py-2 text-13`; nested child `py-1.5 text-12`
- active `bg-surface-2 font-medium text-text`; idle `text-muted
  hover:bg-surface-2 hover:text-text`
- the marker is a **vertical hue tick**, `h-4 w-0.5 shrink-0 rounded-orbit`,
  coloured by the module hue: `opacity-100` when active, `opacity-0` idle and
  `group-hover:opacity-50`. It is a tick beside the label, not a dot in front of
  it, and it is the same 2px module signature as `HueBar`.
- the label is always `<span class="truncate">` — long tenant or domain-pack
  labels ellipsize rather than wrap (§2.6).
- `item.icon` is carried through as a `data-icon` attribute so a later icon pass
  can **decorate** the label. It never replaces it.
- every item navigates with `viewTransition` on.

**Below `md`:** the rail becomes a horizontally scrollable strip under the
Meridian, `min-h-[var(--chrome-module)] … overflow-x-auto border-b border-border
bg-surface-1 p-2 md:hidden`. **The group headings are dropped** at this size —
the strip is a flat list of destinations. Not an off-canvas drawer, not a
hamburger: the labels stay on screen, nothing has to be opened to find out where
you are, and it needs no state.

### 4.6 The canvas

```
<main key={pathname} id="workspace" tabIndex={-1}
  class="lyra-vt-workspace lyra-stagger mx-auto flex min-h-0 min-w-0 w-full
         max-w-[var(--measure-canvas)] flex-1 flex-col gap-[var(--stack-gap)]
         overflow-y-auto overflow-x-hidden p-[var(--gutter-canvas)]">
```

Max width `100rem`, 16px padding rising to 24px, `--stack-gap` between blocks.
`min-w-0` is load-bearing: it lets wide tables scroll inside the region instead
of stretching the page. `key={pathname}` restarts the stagger on every screen.

It opens with two things before the screen's own content:

1. A `h-0.5 w-full shrink-0 rounded-full` **module hue bar** — the canvas's own
   signature of where you are.
2. **`Breadcrumbs`**, but only below module level. At `/ledger` there is no
   crumb (the rail already says it); at `/ledger/journal-lines/abc123` there is.
   Crumbs are built from the nav ancestors plus the path segments, with opaque
   identifiers shortened (`shortRef`) and everything else humanised.

Then either the screen, or **`PageSkeleton`** if the navigation has been
settling for more than 400ms: a `role="status" aria-busy aria-live="polite"`
region with an sr-only label, a title/lede pair and a five-line card. Under
400ms the shell holds still, because a skeleton that flashes reads as a fault.

### 4.7 The companion rail (288px, opt-in)

Mounted only for an actor holding `ai:runs:read`, and only when toggled open.
It is what the agents have been doing, footed by the envelope that says how far
they may go on their own (`suggest` → `act_with_approval` → `act_within_limits`
→ `autonomous`). **Read-only by construction**: `/admin/ai/console` is where an
agent is paused or its autonomy changed, and this rail links there rather than
growing a second set of controls beside the work. It opens closed and loads on
first open (ADR-0059).

### 4.8 The status strip (28px)

`lyra-vt-status z-20 hidden h-[var(--chrome-status)] shrink-0 items-center gap-2
border-t border-border bg-surface-1 px-[var(--gutter)] font-mono text-12
text-subtle sm:flex`

Product name `/` current nav item, all `aria-hidden` (the same words are already
announced by the rail's `aria-current`), and at the inline end a link to
**`/design`** — the design doctrine. Hidden below `sm`.

### 4.9 Error boundary

Not a stack trace. The formula is **what happened → what we did → what you can
do, plus a copyable reference**.

One panel, two homes: the **root** boundary renders it on a bare page (nothing
has loaded, so there is no shell to render it in), and the **workspace** boundary
renders it inside the shell — losing the rail and the header on a mistyped URL
reads as a crash.

- `h1 font-display text-28` — the headline depends on the failure: "This did not
  load" for a real error, but a 403 and a 404 get their own, because "did not
  load" is untrue of a refusal (nothing failed; the door is not theirs) and
  untrue of an address that never held anything.
- `p text-14 leading-body` — one sentence: the page could not be built and
  nothing was saved / there is nothing at this address / your roles do not
  include this area / your session has ended.
- `p font-mono text-12` `dir="ltr"` — "Reference {id}", the id the API logged
  the failure under.
- One link, `text-accent underline underline-offset-4`. **"Try again" for a
  transient failure; "back to home" for a 403 or 404**, because the roles will
  not change on a reload and there is still nothing at the address. It is a
  plain `<a>` on purpose: the boundary may be rendering because the router could
  not build the tree, and a client navigation would land straight back in it.

### 4.10 Wireframes

**Desktop, ≥ 1240px, LTR**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [skip to content]  (visible only on focus)                                   │
├──────────────────────────────────────────────────────────────────────────────┤
│ ✦ Acme Insure │ Acme Ltd    [⌘K search…]     [AED 1.2M held][Aug open] ☾ ✦ (SA axis.lead ▾)│  50px
├──────────────────────────────────────────────────────────────────────────────┤
│ ▏06 ▏08 ▏10 ●▏12 ▏14 ●● ▏16 ▏18 ▏20 ▏22 │ now ─────────────────────────────  │  74px Meridian
├──────────────┬─────────────────────────────────────────────┬─────────────────┤
│ 252px rail   │  main #workspace  max-w-[100rem]  p-24       │  companion 288  │
│ (own scroll) │  ▔▔▔▔▔▔▔ module hue bar                      │  (opt-in)       │
│ ┌──────────┐ │  Ledger › Journal lines › JL-8F2A            │  ✦ 4 runs today │
│ │ ◍ 7 of 12│ │                                              │  · reconcile    │
│ │ shift    │ │  MOVEMENTS THIS PERIOD          ← Eyebrow    │  · draft renewal│
│ └──────────┘ │  Every posting that touched 1010, in the     │                 │
│ MODULES      │  order the bank saw them.        ← Lede      │  Envelope:      │
│ ▎Operations  │  ┌────────────────────────────────────────┐  │  act_with_      │
│  Conversation│  │ 1,204,880.00 AED   ← Figure (mono)     │  │  approval       │
│  Marketing   │  └────────────────────────────────────────┘  │                 │
│  Market      │  ────────────────────────  ← Hairline        │  Open console → │
│  Insight     │  ┌────────────────────────────────────────┐  │                 │
│ RECORDS      │  │ Table: caption required, keyset footer │  │                 │
│  Distribution│  │ "128 shown"   [Prev] [Next]  [25 ▾]    │  │                 │
│  Ledger      │  └────────────────────────────────────────┘  │                 │
│  Analytics   │                                              │                 │
│  Compliance  │                                              │                 │
│ PLATFORM     │                                              │                 │
│  Administra… │                                              │                 │
├──────────────┴─────────────────────────────────────────────┴─────────────────┤
│ Acme Insure / Ledger                                          Design doctrine │  28px
└──────────────────────────────────────────────────────────────────────────────┘
   ▎ = h-4 w-0.5 module-hue tick, aria-hidden. Label always present.
   Nothing on this page scrolls except the rail, the canvas and the companion.
```

**Tablet, 768–1023px, LTR** — same bands. The rail is 196px and still labelled;
the companion and the posture chips are gone (they are `lg:` and up); the
content grid drops to two columns and `KPIWall` from four to two.

```
┌────────────────────────────────────────────────────────────┐
│ ✦ Acme Insure   [⌘K search…]                ☾ (SA lead ▾)  │
├────────────────────────────────────────────────────────────┤
│ ▏06 ▏09 ●▏12 ▏15 ●●▏18 ▏21 │ now                           │
├──────────────┬─────────────────────────────────────────────┤
│ 196px  ◍ 7/12│  ┌──────────────────┬──────────────────┐    │
│ MODULES      │  │ Waiting on you 3 │ Unread       12  │    │
│ ▎Operations  │  ├──────────────────┼──────────────────┤    │
│  Conversation│  │ Revenue   48,200 │ Units     1,204  │    │
│  Marketing   │  └──────────────────┴──────────────────┘    │
│ RECORDS      │  ┌─────────────────────────────────────┐    │
│  Ledger      │  │ Decisions waiting on you            │    │
│  …           │  └─────────────────────────────────────┘    │
├──────────────┴─────────────────────────────────────────────┤
│ Acme Insure / Home                          Design doctrine │
└────────────────────────────────────────────────────────────┘
```

**Mobile, < 768px, LTR** — the rail becomes a scrolling strip; group headings
are dropped; the status strip is hidden. No hamburger, no drawer, no state.

```
┌──────────────────────────────────┐
│ ✦ Acme        [⌘K]  ☾ (SA ▾)     │  50px — tenant name hidden below sm
├──────────────────────────────────┤
│ ▏06 ▏10 ●▏14 ▏18 ●▏22 │ now      │  74px
├──────────────────────────────────┤
│ Home  Operations  Conversat… →→→ │  38px strip, overflow-x-auto, no headings
├──────────────────────────────────┤
│ ▔▔▔ hue bar                      │
│  main  p-16  (the only scroller) │
│  ┌────────────────────────────┐  │
│  │ Waiting on you          3  │  │  KPIWall single column
│  ├────────────────────────────┤  │
│  │ Unread                 12  │  │
│  └────────────────────────────┘  │
│  ┌────────────────────────────┐  │
│  │ Decisions waiting on you   │  │
│  │  Approve a claim settlement│  │
│  │      [Approve]  [Reject]   │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘   (no status strip below sm)
```

**Desktop, RTL (`dir="rtl"`)** — the entire inline axis mirrors. The rail is on
the right with `border-inline-start`; the hue tick precedes the label on the
right; numeric table columns align left (the inline end); the account pill,
posture chips and the doctrine link all reverse. The Meridian's playhead runs
right-to-left with it.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│(▾ axis.lead سارة) ✦ ☾ [أغسطس مفتوح][1.2M درهم محتفظ به]  […⌘K بحث] │ Acme ✦ │
├──────────────────────────────────────────────────────────────────────────────┤
│  ─────────────────────────── الآن │ ▏22 ▏20 ▏18 ●● ▏16 ▏14 ●▏12 ▏10 ▏08 ▏06 │
├─────────────────┬─────────────────────────────────────────────┬──────────────┤
│  companion 288  │            main #workspace  p-24            │  252px rail  │
│                 │                      module hue bar ▔▔▔▔▔▔▔ │ (own scroll) │
│                 │             JL-8F2A ‹ قيود اليومية ‹ الدفتر │ ┌──────────┐ │
│                 │                                             │ │ 7 من 12 ◍│ │
│                 │  Eyebrow →              الحركات لهذه الفترة │ └──────────┘ │
│                 │  Lede    →   كل قيد مسّ الحساب 1010، بترتيب │ الوحدات      │
│                 │              ما رآه البنك.                  │  العمليات ▕  │
│                 │  ┌────────────────────────────────────────┐ │  المحادثات   │
│                 │  │ Figure →        1,204,880.00 AED       │ │  التسويق     │
│                 │  └────────────────────────────────────────┘ │ السجلات      │
│                 │  ──────────────────────────  ← Hairline     │  التوزيع     │
│                 │  ┌────────────────────────────────────────┐ │  الدفتر      │
│                 │  │ [▾ 25]  [التالي] [السابق]   معروض 128  │ │  التحليلات   │
│                 │  └────────────────────────────────────────┘ │  الامتثال    │
├─────────────────┴─────────────────────────────────────────────┴──────────────┤
│ مبادئ التصميم                                          الدفتر / Acme Insure  │
└──────────────────────────────────────────────────────────────────────────────┘
   Figures stay LTR inside an RTL line — a money amount is not mirrored.
```

**Mobile, RTL** — the nav strip scrolls right-to-left; the first item sits at
the right edge.

```
┌──────────────────────────────────┐
│     (▾ سارة) ☾  [⌘K]      Acme ✦ │
├──────────────────────────────────┤
│      الآن │ ▏22 ●▏18 ▏14● ▏10 ▏06│
├──────────────────────────────────┤
│ ←←← …المحادثات  العمليات  الرئيسية│
├──────────────────────────────────┤
│                    p-16  main    │
│               مرحبًا بعودتك، سارة │
└──────────────────────────────────┘
```

---

## 5. Screen index

**109 routable screens** across **6 layouts**, plus **7 public portal routes**
that sit outside every layout. Three kinds:

**Generic screens.** A module is *data*: `apps/web/app/modules/<name>.ts`
declares tabs (resources), each with columns, filters, create/edit fields,
permissions, declared actions and an optional record link. Two route files
render all of them — `/:module/:resource` is a filtered, sorted, cursor-paged
list; `/:module/:resource/:id` is a record read and edited in the same place.
Adding a module adds a spec file, not a screen. **Ten module specs declare 130
resource tabs between them** (the counts are in §5.2), and those 130 tabs are
served by exactly three route files.

**Bespoke screens.** Anything genuinely its own thing gets a static path, which
React Router ranks above the dynamic `:module` segment — no extra ceremony
needed to make a static route win.

**Module shells.** AXIS, ORBIT, SIGNAL, SCOUT and NORTH each own a layout with
their own rail (§5.3).

### 5.1 Every route

| Path | Module | Title | Primary role | Detail |
|---|---|---|---|---|
| `/login` | — | Sign in (password → TOTP → enrol → recovery) | everyone | §6.1; single-card, no product name |
| `/logout` | — | (action only, no UI) | everyone | — |
| `/portal/:tenantSlug` | — | Public comparison storefront | no session | see [ORBIT](ui/orbit.md) |
| `/portal/:tenantSlug/privacy` | — | Public DSAR intake | no session | see [COMPLIANCE](ui/compliance.md) |
| `/portal/:tenantSlug/register` | — | Public self-registration (creates a pending customer, grants no access) | no session | see [ORBIT](ui/orbit.md) |
| `/portal/:tenantSlug/quotes/:id` | — | Public quote comparison, one-time token in the link | no session | see [AXIS](ui/axis.md) |
| `/portal/:tenantSlug/partners` | — | Public partner sign-up | no session | see [ORBIT](ui/orbit.md) |
| `/portal/:tenantSlug/renewals/:id` | — | Public renewal decision | no session | see [ORBIT](ui/orbit.md) |
| `/portal/:tenantSlug/feedback/:id` | — | Public feedback capture | no session | see [ORBIT](ui/orbit.md) |
| `/` | — | Home dashboard | everyone | §6.2 |
| `/settings` `/settings/:tab` | — | Settings — five tabs behind a tab bar | everyone | see [ADMIN](ui/admin.md) |
| `/approvals` | — | Approvals queue | any role holding `core:approvals:decide` | see [ADMIN](ui/admin.md) |
| `/design` | — | **The design doctrine** — the design system explaining itself | every role | §5.4 |
| `/search` | — | (loader only, no UI) — feeds the ⌘K palette | everyone | §4.3 |
| `/search/results` | — | Full search results | everyone | §4.3 |
| `/companion` | — | (loader only, no UI) — feeds the companion rail | `ai:runs:read` | §4.7 |
| `/onboarding/:kind/:ref` | — | Onboarding checklist — partners, channels or staff | `tenant.admin` / `orbit.partners` | see [ADMIN](ui/admin.md) |
| `/platform` | — | Platform staff: diagnostics, DLQ, feature flags | `platform.*` | see [ADMIN](ui/admin.md) |
| `/axis` `/axis/:resource` `/axis/:resource/:id` | AXIS | Operations — **13 tabs** | `axis.agent` / `axis.lead` | see [AXIS](ui/axis.md) |
| `/axis/*` (19 shell routes) | AXIS | Exceptions, board, quote desk, doc intelligence, process map, analytics, admin, dev, claims desk, FNOL intake, renewal desk, referral desk, policy/claim/case/document detail and actions | `axis.*` | see [AXIS](ui/axis.md) |
| `/orbit` `/orbit/:resource` `/orbit/:resource/:id` | ORBIT | Conversations — **15 tabs** | `orbit.agent` / `orbit.lead` | see [ORBIT](ui/orbit.md) |
| `/orbit/*` (10 shell routes) | ORBIT | Console, supervisor, save desk, pipeline, quality, analytics, admin, dev, conversation thread, journey builder | `orbit.*` | see [ORBIT](ui/orbit.md) |
| `/signal` `/signal/:resource` `/signal/:resource/:id` | SIGNAL | Marketing — **8 tabs** | `signal.marketer` / `signal.lead` | see [SIGNAL](ui/signal.md) |
| `/signal/*` (10 shell routes) | SIGNAL | Cockpit, studio, audience value, answer engines, experiments, budget, analytics, admin, dev, creative image | `signal.*` | see [SIGNAL](ui/signal.md) |
| `/scout` `/scout/:resource` `/scout/:resource/:id` | SCOUT | Market — **6 tabs** | `scout.pm` / `scout.lead` | see [SCOUT](ui/scout.md) |
| `/scout/*` (9 shell routes) | SCOUT | Radar, panel, pricing, experiments, analytics, data products, admin, dev, whitespace detail | `scout.*` | see [SCOUT](ui/scout.md) |
| `/north` `/north/:resource` `/north/:resource/:id` | NORTH | Insight — **8 tabs** | `north.exec` / `north.analyst` / `north.board` | see [NORTH](ui/north.md) |
| `/north/*` (9 shell routes) | NORTH | Brief, explorer, anomalies, what-if, board, decisions, admin, dev, board-pack file | `north.*` | see [NORTH](ui/north.md) |
| `/distribution` `/distribution/:resource` `/distribution/:resource/:id` | Distribution | **7 tabs**: channels, offerings, commission-rates, quote-requests, quote-responses, commission-entries, next-best-offers | `tenant.admin` / `axis.lead` / `finance.controller` | quote & offer surfaces see [AXIS](ui/axis.md); commission surfaces see [LEDGER](ui/ledger.md); **no brief of its own** |
| `/distribution/quote-requests/:id/compare` | Distribution | Quote comparison (records are the columns) | `axis.agent` / `axis.lead` | see [AXIS](ui/axis.md) |
| `/distribution/next-best-offers/suggest` | Distribution | Next-best-offer, ranked | `axis.agent` / `orbit.retention` | see [AXIS](ui/axis.md) |
| `/distribution/commission-entries/statement` | Distribution | Commission statement | `finance.analyst` / `partner.manager` | see [LEDGER](ui/ledger.md) |
| `/distribution/commission-entries/:id/clawback` | Distribution | Commission clawback (destructive, checkbox-confirmed) | `finance.controller` | see [LEDGER](ui/ledger.md) |
| `/distribution/channels/:id/detail` | Distribution | One channel | `tenant.admin` | see [LEDGER](ui/ledger.md) |
| `/ledger` `/ledger/:resource` `/ledger/:resource/:id` | Ledger | **20 tabs**: txns, txn-transitions, saga-steps, accounts, journal-batches, journal-lines, account-balances, periods, recon-runs, recon-matches, client-money-checks, subscriptions, invoices, revenue-schedules, usage-meters, payments, payment-plans, fx-rates, tax-rules, settlements | `finance.analyst` / `finance.controller` / `finance.director` | see [LEDGER](ui/ledger.md) |
| `/ledger/transactions` | Ledger | Open a transaction (type catalogue) | `finance.controller` | see [LEDGER](ui/ledger.md) |
| `/ledger/transactions/:id` | Ledger | One transaction: `StateFlow`, journal lines, approvals, audit | `finance.controller` | see [LEDGER](ui/ledger.md) |
| `/ledger/journal` | Ledger | Manual journal entry | `finance.analyst` drafts / `finance.director` posts | see [LEDGER](ui/ledger.md) |
| `/ledger/money-map` | Ledger | Where the money sits and moves | `finance.analyst` | see [LEDGER](ui/ledger.md) |
| `/ledger/reports/:report` | Ledger | Six reports: trial-balance, pnl, balance-sheet, aged, commission, client-money | `finance.analyst` | see [LEDGER](ui/ledger.md) |
| `/ledger/statement` | Ledger | Account statement + drift check | `finance.analyst` | see [LEDGER](ui/ledger.md) |
| `/ledger/period-close` | Ledger | Soft close / hard close / reopen | `finance.controller` / `finance.director` | see [LEDGER](ui/ledger.md) |
| `/ledger/year-end` | Ledger | Year-end close | `finance.controller` / `finance.director` | see [LEDGER](ui/ledger.md) |
| `/ledger/recon` | Ledger | Reconciliation: import, match, AI-proposed matches | `finance.analyst` | see [LEDGER](ui/ledger.md) |
| `/ledger/settlement` | Ledger | Settlement runs | `finance.controller` | see [LEDGER](ui/ledger.md) |
| `/ledger/settlements/:id` | Ledger | One settlement: `StateFlow` + `PostingFlow` | `finance.controller` | see [LEDGER](ui/ledger.md) |
| `/analytics` `/analytics/:resource` `/analytics/:resource/:id` | Analytics | **8 tabs**: dashboards, reports, report-runs, exports, schedules, saved-views, unit-economics, journey-events | `north.analyst` | see [NORTH](ui/north.md); **no brief of its own** |
| `/analytics/report/:id` | Analytics | Report builder + run (runtime columns, PII gate) | `north.analyst` | see [NORTH](ui/north.md) |
| `/analytics/dashboard/:id` | Analytics | Dashboard tiles | `north.exec` / `north.board` | see [NORTH](ui/north.md) |
| `/compliance` `/compliance/:resource` `/compliance/:resource/:id` | Compliance | **10 tabs**: dsar-requests, erasure-log, disclosures, screenings, retention-runs, legal-holds, evidence-bundles, incidents, rulepack-applications, policy-thresholds | `tenant.compliance` | see [COMPLIANCE](ui/compliance.md) |
| `/compliance/run/:kind` | Compliance | Run screening / evidence bundle / retention purge | `tenant.compliance` | see [COMPLIANCE](ui/compliance.md) |
| `/admin` `/admin/:resource` `/admin/:resource/:id` | Admin | **35 tabs** (§5.2) | `tenant.admin` | see [ADMIN](ui/admin.md) |
| `/admin/customers/:id/360` | Admin | Customer 360 | `tenant.admin` / `axis.lead` | see [ADMIN](ui/admin.md) |
| `/admin/products/:id/detail` | Admin | One product | `tenant.admin` | see [ADMIN](ui/admin.md) |
| `/admin/permissions` | Admin | The role→permission matrix | `tenant.admin` | see [ADMIN](ui/admin.md) |
| `/admin/security` | Admin | Tenant security posture | `tenant.admin` | see [ADMIN](ui/admin.md) |
| `/admin/developer` | Admin | Developer console: keys, webhooks, sandbox | `dev.developer` / `dev.admin` | see [ADMIN](ui/admin.md) |
| `/admin/staff` `/admin/staff/:id` | Admin | Staff directory and one staff member | `tenant.admin` | see [ADMIN](ui/admin.md) |
| `/admin/cost-explorer` | Admin | What the platform costs this tenant | `tenant.admin` | see [ADMIN](ui/admin.md) |
| `/admin/ai/console` | Admin | AI console: budgets, spend, agents, runs, guardrails, sealed audit | `tenant.admin` | see [ADMIN](ui/admin.md) |
| `/admin/ai/budget` | Admin | AI spending ceilings | `tenant.admin` | see [ADMIN](ui/admin.md) |
| `/admin/ai/runs/:id` | Admin | One agent run — the "why" behind an artifact | `tenant.admin` / `tenant.compliance` | see [ADMIN](ui/admin.md) |

Routes reachable only from inside another screen are declared as such **with a
written reason**, and a test fails the build if any other route lacks a `nav.*`
label key — so a new workspace cannot ship unlabelled. Examples of the written
reasons: `/approvals` is reached from the "Decisions waiting on you" panel;
every `/portal/*` route is public, session-less and shell-less, reached from a
tenant's own marketing link or a one-time token.

### 5.2 The 130 generic tabs

Ten module specs. These are the resource keys as the code declares them; the
per-module briefs describe their columns, filters and actions.

| Spec | Tabs | Resources |
|---|---|---|
| `axis` | 13 | cases, quotes, documents, tasks, policies, claims, complaints, siu-referrals, escrow-batches, sops, case-approvals, process-events, ops-policies |
| `orbit` | 15 | conversations, messages, renewals, journeys, journey-runs, partners, partner-txns, handover-notes, qa-scores, channel-connectors, teams, team-members, routing-rules, sla-policies, agent-presence |
| `signal` | 8 | audiences, campaigns, creatives, signal-experiments, budget-moves, aeo-pages, attribution-events, spend |
| `scout` | 6 | signals, clusters, whitespaces, panel-bench, scout-experiments, data-products |
| `north` | 8 | metrics, snapshots, briefings, anomalies, alerts, scenarios, boardpacks, decisions |
| `distribution` | 7 | channels, offerings, commission-rates, quote-requests, quote-responses, commission-entries, next-best-offers |
| `ledger` | 20 | (listed in §5.1) |
| `analytics` | 8 | dashboards, reports, report-runs, exports, schedules, saved-views, unit-economics, journey-events |
| `compliance` | 10 | dsar-requests, erasure-log, disclosures, screenings, retention-runs, legal-holds, evidence-bundles, incidents, rulepack-applications, policy-thresholds |
| `admin` | 35 | tenants, users, roles, user-roles, teams, customers, consents, products, providers, files, approvals, mandates, identity-verifications, memories, lenses, rulepacks, api-keys, identity-providers, webhooks, webhook-deliveries, notifications, audit-log, event-dlq, message-templates, locale-overrides, agents, prompts, runs, tool-calls, suggestions, budgets, evals, knowledge-sources, guardrail-events, ai-audit-log |

A tab may also declare **actions** — a named button, its permission, its confirm
prompt, its fields and their hints, in both locales — which the generic record
screen renders. A test fails the build if a declared action names a permission
that does not exist, posts anywhere but an `{id}` path, or is missing either
locale.

### 5.3 The five module shells

AXIS, ORBIT, SIGNAL, SCOUT and NORTH each get their own layout route rather than
the workspace shell. Same header, same account menu, same breadcrumbs, same
skeleton; different rail and one module hue throughout.

- The rail is a **compile-time list of that module's destinations**, not the
  server nav — AXIS declares 11, ORBIT 8, SIGNAL 9, SCOUT 8, NORTH 8 (the label
  keys are `nav.axis/*`, `nav.orbit/*` and so on). The detail and action routes
  in the same shell (a policy endorsement, a claim, a whitespace) are opened
  from a list, not from the rail.
- Each shell mounts `ModuleSwitcher` — this is the one place the module switcher
  appears; the workspace rail *is* the switcher and is not mounted twice
  (ADR-0052).
- Entry is gated twice: the whole block is **omitted from the route table at
  build time** if the deployment does not license the module (`LYRA_MODULES`),
  and the layout loader throws **403** if the session's available shells do not
  include it.
- **One documented exception (ADR-0054):** `orbit.retention` is granted the AXIS
  shell as well, because saving a renewal means raising a fresh quote, and
  sending a retention specialist into a 403 to do their own job is the bug.

### 5.4 `/design` — the doctrine

The design system explaining itself, and the design-system playground the
project's definition of done has always asked for. Readable by **every role** —
the doctrine is how the product behaves, not a staff tool.

It carries the four rules the platform is built to (each numbered in a module
hue), the palette it inherits, the three type voices, and live examples of the
pieces that are hardest to describe in prose: `StateFlow` and `PostingFlow`, the
hero wall and its drill-down, the whitespace commentary chip and its ghost text,
the draft tray, and the post-card composer.

**Every swatch prints `var(--token)`, never a hex** — a tenant that re-sets
`--accent` must see its own colour on this page, not the product's.

### 5.5 Start here — the 15 highest-traffic screens

If only fifteen screens can be redesigned, these are the ones. Roughly in order
of how often a real user sees them:

1. **`/:module/:resource` — the generic list.** The single most-seen screen in
   the product. Every module, every tab. Fixing it fixes 130 screens.
2. **`/:module/:resource/:id` — the generic record.** Same argument.
3. **`/` — home dashboard.** Every user, every session, first thing.
4. **`/login`** — every user, every session, and the only screen with no brand.
5. **`/orbit/conversations/:id/thread`** — the front-line agent lives here all
   day, and it is the richest AI surface in the product.
6. **`/approvals`** — the human-in-the-loop chokepoint for the whole platform.
7. **`/distribution/quote-requests/:id/compare`** — the core commercial act;
   the whole aggregator proposition in one screen.
8. **`/ledger/transactions/:id`** — where money state actually changes.
9. **`/settings`** — five tabs, and the only place a tenant edits its own brand.
10. **`/admin/ai/console`** — the AI operator's home, and the product's public
    face for "how do I keep the agents in check".
11. **`/ledger/reports/:report`** — six reports finance opens daily.
12. **`/analytics/report/:id`** — the report builder and its results table.
13. **`/ledger/recon`** — reconciliation, and the only screen with AI *proposals*
    on money.
14. **`/axis/board`** and **`/orbit/console`** — the two module shells a
    front-line user sits in all day.
15. **`/analytics/dashboard/:id`** — the read-only surface `north.board` sees.

---

## 6. Key flows

Decision points and approval gates are called out. **The gate wire shape is
always the same**: the API answers HTTP 403 with `code: "approval_required"`,
carrying `{policyKey, approvalId}`. The UI must render this as a
`GuardrailNotice` — an explanation with a way forward — **never as an error**.
The action is paused, not failed.

### 6.1 Sign in

```
/login  ──password──▶  ┌ credentials wrong? stay, "That email and password do not match."
                       ├ email in >1 tenant? ask for workspace slug, resubmit
                       ├ SSO configured?  second submit (formNoValidate) → discovery → IdP
                       └ ok ▼
        ──totp──────▶  six-digit code
                       │
                       └ no factor enrolled yet, and role requires MFA ▼
        ──enrol─────▶  setup key shown as selectable monospace text (no QR by design)
                       │
        ──recovery──▶  10 single-use codes, shown once, "I have saved them"
                       ▼
        landingFor(roles, nav)  ──▶  /admin | /platform | /settings | /{module}
                                     (only ever a path the nav offered — never a 403)
```

Demo deployments additionally offer one-click persona buttons, fetched from
`/v1/auth/demo/personas`; that endpoint 404s in production and the buttons
disappear.

### 6.2 The daily loop (any operations role)

```
/  home
├─ hero wall              ──▶  the figure drills to exactly the rows behind it
├─ "Decisions waiting on you"  ──▶  /approvals            [GATE]
├─ "Your recent activity"      ──▶  the record it names
├─ "Where the work is"         ──▶  the module's list
├─ "Recent agent work"         ──▶  /admin/ai/console  → /admin/ai/runs/:id
└─ "Your workspaces"           ──▶  /{module}
```

Each panel independently resolves to one of three states: **ok**, **denied**
(renders nothing at all — no empty box, no "you can't see this"), or **error**
(renders a failure card). A user with narrow permissions sees a shorter page,
not a page full of locks.

**A hero figure is a door.** Clicking it lists exactly the rows it counted — the
same array through the same predicate, never a second query — because a hero
that says 412 and opens a list of 380 has taught the reader to distrust every
figure on the platform. A figure with no rows behind it (a rate, a median, a
scalar off a config) is plain text with no link, because a closed door is absent
rather than disabled and a door that was never there is too.

### 6.3 Quote to placement — the core commercial flow

```
/orbit/conversations/:id/thread   customer asks
        │  agent opens a case
        ▼
/axis/cases/:id/detail            the work item
        │
        ▼
/distribution/quote-requests      create request  →  fanned out to providers
        │
        ▼
/distribution/quote-requests/:id/compare
        │   the transposed table: each provider response is a COLUMN,
        │   with the row-label column and the header row both sticky
        │   AI ranks, carries ✦ and a ConfidenceMeter, and its "why" is one
        │   interaction away
        ├─ share    →  send the comparison to the customer (or the public
        │              /portal/:tenantSlug/quotes/:id link)
        ├─ shop     →  go back to more providers
        ├─ offer    →  surface a next-best-offer
        └─ select   →  place with one provider          [GATE: consequential]
                        │
                        ├ 403 approval_required  →  GuardrailNotice
                        │                            quoting the rule → /approvals
                        └ ok ▼
/axis/policies/:id/detail         the contract exists
        │
        ▼
/distribution/commission-entries  commission booked
        │
        ▼
/ledger/transactions/:id          journal lines, balanced
```

### 6.4 Approval — the human-in-the-loop gate itself

```
any consequential action
        │
        ▼  API returns 403 approval_required {policyKey, approvalId}
GuardrailNotice on the originating screen, quoting the rule
        │
        ▼
/approvals
├─ one Card per request
├─ ✦ Badge "Raised by an agent" when an agent raised it
├─ "Why this needs approval" — the machine context behind the decision,
│    rendered as sentences, not enum keys
├─ 24h TTL: a request older than that is shown as expired
├─ DUAL CONTROL: if you raised it, both buttons are replaced by
│    "You raised this request, and this rule needs a second person to decide it."
├─ [Approve]  → the paused action resumes
└─ [Reject]   → ConfirmButton asks, then the action is abandoned
```

Approval policies that exist today include `axis.claim_settlement` (claim
settlement amount), `signal.campaign_launch` (spending money on media), the
ledger transaction policies, and the AI autonomy raise.

### 6.5 Money: open, post, close

```
/ledger/transactions        pick a transaction TYPE from the catalogue
        │                   (each row shows its code, its kind badges,
        │                    and the approval policy it will trip)
        │                   one input per recipe argument — money in a money
        │                   field — off the field list the API publishes
        ▼
open → the transaction exists in state `draft`
        │  form carries a one-time idempotency key: pressing twice posts once
        ▼
/ledger/transactions/:id
        ├─ the details terms
        ├─ journal lines as a PostingFlow
        │    └ if unbalanced: role="alert" "This batch does not balance",
        │      with the delta in the display face, bold, danger
        ├─ Move state  → StateFlow; next legal states only               [GATE]
        ├─ Reverse     → danger, ConfirmButton                           [GATE]
        ├─ Timeline of transitions
        └─ approvals + audit sections
        ▼
/ledger/recon               match against what the provider actually paid
        ├─ import the statement as the counterparty exported it
        │    (reference, amount, our reference, date, description; commas or
        │     tabs, header row optional) — parsed server-side, rows shown back
        │     before the run starts
        ├─ auto-match
        ├─ optional: "Let the assistant propose matches for the leftovers"
        │    "Proposals are never posted. Each one still needs a person to
        │     confirm it."  →  ✦ Badge + confidence per row
        └─ per-row confirm
        ▼
/ledger/period-close
        ├─ Soft close (secondary)   → reversible                         [GATE]
        ├─ Hard close (danger)      → irreversible                       [GATE]
        └─ Reopen    (ghost)        → only from soft-closed              [GATE]
        ▼
/ledger/year-end            the annual roll
        ▼
/ledger/reports/:report     trial balance must foot; client money must not be short
```

Dual control runs through all of it: `finance.analyst` drafts, `finance.director`
posts, and neither can do the other's half. A tenant with one finance seat
**cannot post a manual journal at all** — that is the role graph, not a setting.

### 6.6 Campaign launch (SIGNAL)

```
/signal/audiences        build, estimate reach
        ▼
/signal/creatives        ✦ generate  →  drafts, each with an inspectable why
        ▼                (compliance may need to approve creatives)
/signal/campaigns        draft
        ▼
launch                                                               [GATE]
        │  signal.marketer does NOT hold signal:campaigns:launch —
        │  the button is ABSENT, not disabled
        │  signal.lead holds it, and still trips signal.campaign_launch
        ▼
/signal/attribution-events + /signal/spend      immutable, read-only
```

### 6.7 Compliance run

```
/compliance/dsar-requests        a subject asks
   (or the public /portal/:tenantSlug/privacy intake, no session)
        ▼
/compliance/run/screening        run a screening
/compliance/run/evidence         build an evidence bundle
/compliance/run/retention        purge under a retention rule   ← DESTRUCTIVE
        │  runs DRY by default and shows what it would destroy;
        │  the destructive run is a second form carrying confirm=purge,
        │  so the figures stay on screen while the actor commits to them
        ▼
/compliance/erasure-log          what was erased, sealed
```

### 6.8 AI oversight

```
anywhere an artifact carries ✦
        └─ EvidenceLink / Provenance / "Why this was drafted"
                ▼
/admin/ai/runs/:id        inputs, tool calls, output, cost, evidence
        └─ if state = awaiting_approval → ApprovalStrip right there
                ▼
companion rail            what the agents did today + the autonomy envelope
        └─ read-only; it links to the console rather than duplicating it
                ▼
/admin/ai/console         all runs, all agents, guardrail events, sealed AI audit
        ├─ pause an agent            (reason required)
        ├─ raise autonomy            (confirm required)              [GATE]
        │    the ladder is one ladder: suggest · act with approval ·
        │    act within limits · act on its own
        └─ kill switch
                ▼
/admin/ai/budget          set the ceiling
        └─ checkbox: "I understand this changes what the agents may spend,
           and that raising it is recorded against my name."
```

---

## 7. What needs design work most

The sixteen defects this brief originally catalogued have all been closed; the
record of them lives in git history rather than here. What follows is what a
designer picking the product up today should still weigh.

### Open

**1. `/distribution` and `/analytics` have no design brief.** Both are routed,
permission-gated workspaces with nav entries of their own — 7 and 8 generic tabs
plus six bespoke screens between them — and neither has a file in `ui/`. Their
screens are described only where another module happens to use them. This is a
gap in the documentation, not in the product, and it is the first thing to close
before redesigning either.

**2. The kit's navigation components are shipped and bypassed.** `NavRail`,
`NavItem`, `NavSection` and `TopBar` exist in `packages/ui/src/nav.tsx` and are
imported by nothing: the workspace shell and the five module shells hand-roll
their own rail and header against the same tokens, because the real rail carries
a shift summary and grouped headings the kit does not model. Either the kit
grows to match the shells or those exports should go; today a designer reading
`nav.tsx` is reading a rail the product does not use.

**3. Two Horizon marks are drawn but not adopted.** `Lede`, `Hairline`,
`HueBar` and `AnswerBanner` are exported from `horizon.tsx`; the shells and most
screens draw the hue bar and the rule inline instead. The grammar is right; the
adoption is partial.

### Weighed, not defects

- **Charting has a deliberate ceiling** (ADR-0053). `LineChart` and `DonutChart`
  are the two shapes a tile needs; zoom, brushing, multi-series and dual axes are
  where a library would earn its place, and that day has not come. A redesign
  that assumes a full charting vocabulary is designing something the product has
  chosen not to build.
- **Icons are decorative and mostly absent.** Every nav item carries an `icon`
  through to a `data-icon` attribute, and nothing renders it yet. An icon pass is
  available; an icon pass that *replaces* a label is not (§2.1).
- **Density has a compact mode nothing switches.** `[data-density="compact"]` is
  implemented in tokens and honoured by controls and table rows; no surface in
  the product sets it. Not determined from code whether a control for it is
  intended.

---

## Appendix — the visual quality bar

`assets/Lyra_Brand_UI_Showcase.html` is the reference for how finished this
should look. It is the same structure rendered at a level the product is still
reaching for. Two things in it are stale: its accent is the earlier amber
generation (`#FFB020`), not the shipped `--vega-500` lime, and its wordmark is
set in Space Grotesk rather than Archivo. Read every "amber" below as "whatever
`--accent` currently resolves to" — the showcase is a composition reference, and
§3 is the palette and the typography of record.

Sections: *01 The mark* (a 60px wordmark, 0.03em tracking, with a 30×3.6px
accent tick rotated −45°), *02 SIGNAL Social Studio*, *03 Launch Cockpit*, *04
Ledger Explorer & Money Map*, *05 Mobile*, plus *The Brief* and *Approvals*.

Useful specifics from it: a 1280px wrap with `56px 32px 90px` padding; `h1` at
`clamp(34px, 4.6vw, 54px)`; a lede at 16.5px capped to 66 characters; an eyebrow
at 12px / 3px letter-spacing / accent / uppercase; an AI chip at 11px with a
`rgba(…, .35)` border and a 999px radius; evidence links as accent with a dotted
bottom border; a guardrail gate as a teal `rgba(55,211,178,.4)` border on a `.07`
teal wash; sealed journal rows tinted ink-800 with a 3px teal inline-start marker
and draft rows ink-700 with a star-500 marker; and an Arabic panel demonstrating
`direction: rtl` in IBM Plex Sans Arabic.

Three things in it are **not** to be copied: its 58px icon-only rail (§2.1), its
Google Fonts CDN links (the real product self-hosts, because an on-prem
deployment may be air-gapped), and its large corner radii — the shipped system
is 2 / 3 / 6px (§3.1).
