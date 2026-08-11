# LYRA — UI design brief (spine)

This document is written for a designer working in Claude Design who has **no
access to this repository**. Everything a designer needs to redesign the product
without reading code is either in this file or in the per-module files under
`ui/` that this file indexes.

It describes **what is actually built today**, not the roadmap. Anything specced
but unbuilt is marked **not yet built**. If a statement here disagrees with a
screenshot, the code is the authority and this file is the bug.

Source of truth for the facts below: `packages/ui/src/*` (design system),
`apps/web/app/*` (the web client), `packages/core/src/rbac.ts` (roles).

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
  marketing and self-serve journeys) and **b2b** (partners, brokers, embedded
  distribution with their own API keys and their own commission rates).
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
| `/axis` | AXIS | **Operations** | العمليات | Cases, quotes, documents, tasks, policies, claims, escrow batches, SOPs |
| `/orbit` | ORBIT | **Conversations** | المحادثات | Conversations, messages, renewals, journeys, partners, handover notes, QA scores |
| `/signal` | SIGNAL | **Marketing** | التسويق | Audiences, campaigns, creatives, experiments, budget moves, AEO pages, attribution, spend |
| `/scout` | SCOUT | **Market** | السوق | Market signals, clusters, whitespaces, panel bench, experiments, data products |
| `/north` | NORTH | **Insight** | الرؤى | Metrics, snapshots, briefings, anomalies, scenarios, board packs, decisions |
| `/distribution` | — | **Distribution** | التوزيع | Channels, offerings, commission rates, quote requests/responses, commission entries, next-best-offers |
| `/ledger` | — | **Ledger** | دفتر الأستاذ | Transactions, journals, accounts, periods, reconciliation, client money, invoices, payments, FX, tax |
| `/analytics` | — | **Analytics** | التحليلات | Dashboards, reports, runs, exports, schedules, saved views, unit economics |
| `/compliance` | — | **Compliance** | الامتثال | DSAR, erasure log, disclosures, screenings, retention, legal holds, evidence bundles, incidents |
| `/admin` | — | **Administration** | الإدارة | Tenants, users, roles, teams, customers, products, providers, API keys, webhooks, audit, and all AI operations |
| `/settings` | — | **Settings** | الإعدادات | The signed-in person's own account, plus tenant brand and DSAR self-service |

Nav labels are deliberately de-jargonised: a new user reads "Operations", not
"AXIS". The code names survive only as accent colours (§3) and as directory
names.

### Who uses it

These are the **real role keys** from `packages/core/src/rbac.ts`. There are 28.
A person can hold more than one. Permissions are `module:resource:verb` strings
with `*` wildcards; the UI hides what a role does not hold, and the API re-checks
independently.

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
| `orbit.retention` | Renewals specialist. Updates renewals, replies, and can raise a fresh quote and surface an offer to save a customer. |
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

**Finance — separated from operations on purpose:**

| Role key | Day job |
|---|---|
| `finance.analyst` | Reads the whole ledger, runs reconciliation, creates invoices, reads commissions and rates. Cannot post or close. |
| `finance.controller` | `ledger:*:*` — posts, closes periods, reverses. Decides approvals, owns commissions, approves rates, pulls unmasked exports, exports compliance evidence. |

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
2. **Where a person lands after sign-in depends on their roles.** `tenant.*`,
   `platform.*` and `dev.*` land on `/admin`; `customer` lands on `/settings`;
   a module role lands on its own workspace. The landing router never sends
   anyone into a 403.

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
  image; if there is no logo it renders `brand.name ?? tenantName` as text.
- The document `<title>` is `brand.name ?? tenantName ?? ""` — never a literal.
- The login screen carries **no product name at all**, because there is no
  session yet and therefore no tenant brand to read.
- A tenant may override exactly **five** custom properties: `--accent`,
  `--accent-hover`, `--accent-contrast`, `--font-display`, `--font-ui`. Nothing
  else. Module identity accents (`--module-axis`, etc.) are product identity and
  are **not** tenant-overridable.
- Contrast of a tenant's chosen accent against `--accent-contrast` is validated
  live at ≥ 4.5:1 in the brand editor, and Save is disabled when it fails.

Design implication: never draw a screen that only works with the default lime
accent. It must survive a tenant picking deep blue, and it must survive a wide
wordmark logo replacing a short one.

### 2.3 RTL and i18n from day one

Two locales ship today: **en** and **ar**. The document root is
`<html lang={locale} dir={dirFor(locale)}>` — `dir="rtl"` for Arabic.

- **Logical CSS properties only.** `margin-inline-start`, never `margin-left`.
  `padding-inline-end`, `inset-inline-start`, `border-inline-start`,
  `text-align: start`. In Tailwind terms: `ps-/pe-/ms-/me-/start-/end-/border-s`,
  never `pl-/pr-/ml-/mr-/left-/right-/border-l`. `ui.test.ts` fails the build if
  a physical-direction utility appears in `packages/ui`.
- **Every screen must be designed in RTL too**, not mirrored as an afterthought.
  Tables flip: the identifier column moves to the right edge, numeric columns
  align to the *inline* end. The nav sits on the right. Progress bars fill from
  the right (they set `inlineSize`, not `width`). The Switch thumb translates
  `-x` under RTL.
- **No literal strings in components.** Shell strings live in
  `apps/web/app/i18n/{en,ar}.ts`; each workspace owns its own label table so a
  domain pack can rename every noun in it.
- Arabic is served by IBM Plex Sans Arabic, which is present in every font stack
  as the second family, with `unicode-range` splits so Latin users never
  download it.

### 2.4 WCAG 2.2 AA

- Every interactive element is keyboard-reachable, in DOM order.
- Focus is always visible: `outline outline-2 outline-offset-2 outline-accent`
  via `focus-visible`. Never `outline: none`.
- Body text contrast ≥ 4.5:1. This is why the **light** theme darkens the accent
  to `#3f6212` rather than reusing the dark theme's `--vega-500` lime: white on
  that lime measures 1.7:1 and fails AA at every size, while white on `#3f6212`
  measures 7.17:1.
- A "Skip to content" link is the first focusable element on every page and
  jumps to `#workspace`, which is `tabIndex={-1}` so it can receive focus.
- Every `Table` requires a `caption` prop — it is a TypeScript-required prop,
  not an option. It may be visually hidden but it must exist.
- Every `IconButton` requires a `label`.
- Every `Sparkline` requires a `label`.
- `prefers-reduced-motion: reduce` forces all animation and transition durations
  to 0.01ms.
- Withheld affordances are **absent, not disabled**. A button the user may not
  press is not rendered at all — no disabled controls to puzzle over, and no
  information leak about what other roles can do.

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
  `EvidenceLink` or a popover labelled "Why this was drafted", leading to the
  run that produced it (`/admin/ai/runs/:id`).
- Confidence is shown as a meter with a floor (default 0.7): success above the
  floor, warning within 0.2 below it, danger under that.
- Guardrails are notices, not errors. A blocked action renders a
  `GuardrailNotice` that **quotes the specific rule**, never a generic message.

### 2.6 Domain-pack vocabulary

Never hard-code an industry noun. "Policy", "premium", "insurer", "claim",
"underwriter" are **domain-pack strings**, not product strings. The same code
must sell outside insurance.

This is visible in the built product: the home dashboard's approvals panel
deliberately renders the machine `policyKey` rather than an English sentence,
because writing "Approve this premium change" would weld the product to
insurance. (It reads badly today — see §7 — but the constraint is right and the
fix is a domain-pack lookup, not an English literal.)

The shared `common.*` catalogue holds only vocabulary every workspace shares
("Save changes", "Back to list", "Created"). Any noun a module owns lives in
that module's own label table, where a domain pack can override it.

### 2.7 Latency and money doctrine (context for both)

- Skeletons over spinners above 400ms. No spinner larger than 20px. Narrative
  progress above 3s.
- Keyset (cursor) pagination throughout: there is no total row count, so
  **never render "of N"** on a list. The footer says "{count} shown" and offers
  Previous/Next.
- Anything that changes money or contractual state is a transaction with an
  idempotency key. Forms that post money carry a one-time key minted at render
  ("This form carries a one-time key, so pressing twice posts once").

---

## 3. The design system as built

The design system is called **Constellation** and lives in `packages/ui`. It is
React + Tailwind v4 (tokens as CSS custom properties) + Radix primitives. It is
**dark-first**: the dark values are the base, and light remaps the same semantic
layer.

### 3.1 Token architecture

Three layers, in this order:

1. **Palette** — raw named colours. Never referenced by a component.
2. **Semantic** — `--bg`, `--surface-1`, `--text`, `--accent`… Components
   reference only these.
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

#### Semantic tokens — dark (the base)

| Token | Value |
|---|---|
| `--bg` | `#06080b` |
| `--surface-1` | `#080b10` |
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

#### Semantic tokens — light

Applied by `@media (prefers-color-scheme: light)` **and** by
`:root[data-theme="light"]`, so the tenant/user toggle wins over the OS.

| Token | Value | Note |
|---|---|---|
| `--bg` | `#ffffff` | |
| `--text` | `#0e1116` | |
| `--text-muted` | `#4e5866` | |
| `--text-subtle` | `#5d6775` | 5.67:1 on `--bg` |
| `--accent` | `#3f6212` | dark olive; `--vega-500` on white fails AA |
| `--accent-hover` | `#33500e` | |
| `--accent-contrast` | `#ffffff` | **7.17:1** on `--accent` |
| `--success` | `#15803d` | |
| `--danger` | `#b91c1c` | |
| `--warning` | `#a16207` | white on it is 4.97:1 — the tightest margin |
| `--info` | `#1d4ed8` | |
| `--shadow-glow` | `0 0 0 1px #e6e9ee, 0 4px 14px #0f172a08` | |
| `--shadow-raised` | `0 0 0 1px #e6e9ee, 0 14px 40px #0f172a14` | |

#### Typography

Fonts are **self-hosted woff2 from `/fonts`** with `font-display: swap` and
Latin/Arabic `unicode-range` splits. No CDN — an on-prem deployment may be
air-gapped.

| Family | Weights | Use |
|---|---|---|
| Space Grotesk Variable | 300–700 | Display: headings, wordmark, big numbers |
| Inter Variable | 100–900 | UI and body |
| IBM Plex Mono | 400 | Identifiers, machine values, references |
| IBM Plex Sans Arabic | 400/500/600/700 | Arabic range only, in every stack |

Stacks:

```
--font-display: "Space Grotesk", "IBM Plex Sans Arabic", system-ui, sans-serif;
--font-ui:      "Inter", "IBM Plex Sans Arabic", system-ui, sans-serif;
--font-mono:    "IBM Plex Mono", ui-monospace, monospace;
--font-arabic:  "IBM Plex Sans Arabic", "Inter", system-ui, sans-serif;
```

Only `inter-latin-wght-normal.woff2` and `space-grotesk-latin-wght-normal.woff2`
are `<link rel=preload>`ed. Arabic and mono load on demand.

Type scale — nine steps, no others:

| Token | Value | Typical use |
|---|---|---|
| `--text-12` | `0.75rem` (12px) | Micro-labels, `<dt>`, timestamps, footers |
| `--text-13` | `0.8125rem` (13px) | Dense UI: table cells, form labels, nav items |
| `--text-14` | `0.875rem` (14px) | **Body default**, buttons |
| `--text-16` | `1rem` | Card titles, section headings |
| `--text-18` | `1.125rem` | |
| `--text-22` | `1.375rem` | |
| `--text-28` | `1.75rem` | Page-level display heading, big money figures |
| `--text-36` | `2.25rem` | |
| `--text-48` | `3rem` | Rare — marketing/hero only |

`--leading-body: 1.5`, `--leading-display: 1.15`, `--tracking-wordmark: 0.03em`.
Weights: 400 / 500 / 600 / 700.

`.lyra-tabular { font-variant-numeric: tabular-nums }` — every numeric table
column and every money figure uses it.

#### Space, radius, elevation, motion

- `--space-base: 4px`. Everything is a multiple.
- Radii: `--radius-sm 6px` (inputs, badges), `--radius-md 10px` (buttons,
  notices), `--radius-lg 16px` (cards, panels), `--radius-orbit 999px` (pills,
  progress bars, the ⌘K search pill).
- `--shadow-glow: 0 0 0 1px var(--ink-600), 0 8px 24px #0009`
- `--shadow-raised: 0 0 0 1px var(--ink-600), 0 16px 40px #000b`
  Note both carry a 1px hairline *inside* the shadow — elevation in this system
  is a ring plus a shadow, never a shadow alone.
- `--duration-fast: 150ms`, `--duration-slow: 250ms`,
  `--ease-out: cubic-bezier(0.2, 0.8, 0.2, 1)`.
- `@keyframes twinkle` (opacity .85→1, 2.6s, infinite) — the ambient
  "agent is thinking" signal. `@keyframes orbit-spin` (1.1s linear) — the only
  spinner.

#### Density

A global data attribute, not a per-component prop.

| | default | `[data-density="compact"]` |
|---|---|---|
| `--control-height` | 40px | 32px |
| `--control-padding-block` | 8px | 4px |
| `--row-height` | 44px | 34px |

### 3.2 Primitive inventory

Every component below is real, exported, and named exactly as written. Variants
and sizes are the complete set — there are no others.

**`primitives.tsx`**

| Component | Variants / props | Concrete styling |
|---|---|---|
| `Button` | variant: `primary` \| `secondary` \| `ghost` \| `danger` (default **secondary**); size: `sm` \| `md` \| `lg` (default **md**); `asChild`, `loading` | primary `bg-accent text-accent-contrast hover:bg-accent-hover`; secondary `bg-surface-2 text-text border border-border hover:bg-surface-3`; sm `h-8 px-3 text-13`, md `h-10 px-4 text-14`, lg `h-11 px-5 text-16`. `loading` sets `aria-busy` and blocks activation — it does **not** disable, so focus is not lost. |
| `IconButton` | requires `label` | Never used for navigation. |
| `Field` | `label`, `hint`, `error`, wraps any control via `useFieldControl` | label `text-13 font-medium text-muted`; hint `text-12 text-subtle`; error `text-12 text-danger` with `role="alert"`, wired by `aria-describedby`/`aria-invalid` |
| `Input` | size sm `h-8` / md `h-10` / lg `h-11`; optional `prefix` / `suffix` | prefix/suffix absolutely positioned at `start-3`/`end-3`, text inset `ps-9`/`pe-9` |
| `Textarea` | `min-h-24 p-3` | |
| `DatePicker` | native `<input type="date">` / `datetime-local`; `calendar?: "gregory" \| "islamic-umalqura"` applied via `lang="…-u-ca-…"` | Deliberately native — a JS calendar is 40KB the product does not need, and the OS picker is already localised and accessible |
| `Select` | Radix; `placeholder` defaults to `…`; chevron is a literal `▾` | content `bg-surface-2 shadow-glow`; an empty option uses sentinel `__lyra_select_empty` |
| `Checkbox` | `size-5`, check glyph `✓` | Also the product's chosen **confirmation** control for money-destructive actions |
| `RadioGroup` | | |
| `Switch` | track `h-5 w-9`, thumb `size-4` | `rtl:data-[state=checked]:-translate-x-4` |
| `Card` | variant `flat` \| `raised` \| `floating`; sub-parts Header / Description / Body | flat `bg-surface-1`, raised `bg-surface-2 shadow-glow`, floating `bg-surface-3 shadow-raised`; all `rounded-lg border border-border text-start`; header `px-5 py-4 font-display text-16 font-medium`, description `text-13 text-subtle`, body `p-5` |
| `Badge` (aliased `Tag`) | tone `neutral` \| `accent` \| `success` \| `danger` \| `warning` \| `info`; size sm `px-2 py-0.5 text-11` / md `px-2.5 py-1 text-12`; optional `dot` | tone renders as `border-X/40 bg-X/10 text-X` — a tinted outline, never a solid fill |
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
| `Pagination` | `hasPrevious, hasNext, onPrevious, onNext, rangeLabel, pageSize, pageSizes = [25, 50, 100], onPageSizeChange, label`. **Keyset paging: there is no total, so it never renders "of N".** |
| `EmptyState` | `title, body, action`, plus `ConstellationArt`: a 120×80 thin-line SVG — path `M42 44 L72 36 L83 68 L53 76 Z` plus `M25 24 L42 44`, four `--text-muted` dots and one r=5 `--accent` dot. Container `rounded-lg border border-dashed border-border p-10 text-center` |
| `Stat` | `label, value, delta` (teal positive / red negative), `deltaSuffix, invertDelta, hint` |
| `Sparkline` | `values`, `label` (**required**), `tone`; 100×28 `<polyline vectorEffect="non-scaling-stroke">`. Deliberately not a chart library — it is 40 numbers |
| `KPIWall` | `grid gap-6 sm:grid-cols-2 lg:grid-cols-4` |
| `Timeline` | `<ol className="flex flex-col border-s border-border ps-5">`; dot `size-2 rounded-orbit` at `insetInlineStart: -26px`, `bg-warning` when pending else `bg-accent` |
| `AuditTrail` | a `Table` locked to `density="compact"` and `rowState={() => "sealed"}`; columns When / Actor / Action (`font-mono text-12`) / Target / Detail |

**`nav.tsx`** — the labelled navigation kit. `LyraModule`, `moduleAccent()`,
`NavItem` (`min-h-10 gap-3 rounded-md px-3 py-2 font-ui text-14`, active
`bg-surface-3 text-text` + `aria-current="page"`), `NavSection` (heading
`px-3 py-2 font-ui text-11 uppercase tracking-wider text-subtle`), `NavRail`
(does not collapse), `ModuleSwitcher`, `Breadcrumbs`, `TopBar` (`brandName`,
`brandMark`, a `⌘K` search pill styled `rounded-orbit border border-border
bg-surface-2 px-3 py-1.5 font-ui text-13 text-subtle`, an actions slot and an
`Avatar`).

> **Not yet built / not yet used:** the web app does **not** import any of
> `nav.tsx`. The shell hand-rolls its own header and sidebar. `ModuleSwitcher`,
> `Breadcrumbs` and the `⌘K` search pill exist in the design system and appear
> nowhere in the product. See §4 and §7.

**`ai.tsx`** — the ambient AI kit.

| Component | Contract |
|---|---|
| `AGENT_MARK` | `"✦"` — the single AI marker |
| `AgentBadge` | `{agent, why, size}` → an accent `Badge` reading `✦ Drafted by {agent}`; with `why`, wrapped in a Popover labelled "Why this was drafted" |
| `GhostText` | `{text, onAccept, onDiscard}` — an inline draft the user takes or dismisses |
| `ConfidenceMeter` | `{value: 0–1, label = "Model confidence", floor = 0.7}`; success ≥ floor, warning ≥ floor − 0.2, danger below |
| `EvidenceLink` | dotted-underline accent link to the evidence/run behind an artifact |
| `GuardrailNotice` | `{title, reason, tone, action}`, `role="status"`, `rounded-md border p-4`, tone as `border-X/50 bg-X/8 text-X`. **Quotes the specific rule** |
| `BudgetMeter` | `{used, limit, label = "AI budget", unit = "tokens", resetsAt, locale}` |
| `ApprovalStrip` | `{summary, consequence, requestedBy, onApprove, onReject, blockedReason}`, `role="region" aria-label="Pending approval"`, `rounded-lg border border-accent/40 bg-accent/8 p-4` |

> **Defect to fix in design:** `AgentBadge` and `ConfidenceMeter` hard-code
> English strings ("Drafted by…", "AI-generated", "Model confidence"). They stay
> English under the Arabic locale. See §7.

**`overlays.tsx`** — `Dialog`, `Drawer`, `Tooltip`, `Popover`, `Menu`,
`useToast` / `ToastProvider`, `CommandBar` (⌘K). Header states the rule: AI never
opens a modal; these are for human-initiated work.

> **Not yet built / not yet used:** none of `Dialog`, `Drawer`, `Toast`,
> `Tooltip`, `Menu`, `Popover` or `CommandBar` is used anywhere in the web app.
> Confirmation today is the browser's native `confirm()` dialog or a required
> checkbox. There is no toast host mounted. See §7.

**`format.tsx`** — `Money` (minor units + ISO currency; AED/USD → 2 decimals,
JPY → 0, KWD → 3, resolved by `Intl`, not a hand-written table) and `DateTime`
(`precision: "day" | "minute" | "second"`, optional `timeZone`).

### 3.3 What the product actually uses

Import counts across `apps/web` — this is the real weighting a redesign should
optimise for:

```
EmptyState 20 · DateTime 17 · Button 16 · Table 15 · Money 15 · Field 15
Input 13 · Card 13 · Select 12 · Badge 12 · Textarea 8 · GuardrailNotice 6
Form 5 · EvidenceLink 5 · ConfidenceMeter 5 · Checkbox 5 · Link 4 · Stat 3
Timeline 2 · Sparkline 2 · ProgressBar 2 · KPIWall 2 · DatePicker 2
AgentBadge 2 · GhostText 1
```

**Zero uses:** every overlay, every `nav.tsx` export, `AuditTrail`, `Pagination`,
`Avatar`, `Switch`, `RadioGroup`, `Tabs`, `Skeleton`, `Separator`, `IconButton`,
`Tag`, `BudgetMeter` (outside the two AI screens), `ApprovalStrip` (outside
`/admin/ai/runs/:id`).

The product is, in practice, **tables, empty states, forms and money**. Design
accordingly.

---

## 4. Global chrome

Everything below is `apps/web/app/components/shell.tsx` and `root.tsx` as built.

### 4.1 Structure

```
<html lang={locale} dir={ltr|rtl}>
  <body class="min-h-screen bg-bg text-text antialiased">
    <div class="min-h-screen bg-bg text-text" style={brandStyle(brand)}>
      skip link  →  #workspace
      <header>   sticky, h-14
      <div class="flex">
        <nav aria-label="Primary">
        <main id="workspace" tabindex="-1">
```

`brandStyle(brand)` writes **only five** custom properties onto that root div:
`--accent`, `--accent-hover`, `--accent-contrast`, `--font-display`,
`--font-ui`. The tenant picks one font, and it covers both roles. The allowed
font values are a hard `Map` of exactly `space-grotesk`, `inter`,
`ibm-plex-sans-arabic` — each stack keeps the Arabic fallback appended.

### 4.2 Skip link

First focusable element. `sr-only` until focused, then
`focus:not-sr-only focus:absolute focus:z-50 focus:m-2 focus:rounded-md
focus:bg-surface-2 focus:px-3 focus:py-2 focus:text-13`. Label:
`app.skipToContent` = "Skip to content". Target `#workspace`.

### 4.3 Header

`sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-border
bg-surface-1/95 px-4 backdrop-blur-sm`

Contents, in inline order:

1. **Brand slot** — a `NavLink` to `/`, `font-display text-14 tracking-wide`.
   Renders `<img class="h-6 w-auto">` from `brand.logo.dark ?? brand.logo.light
   ?? brand.mark`; if there is no logo, the text `brand.name ?? tenantName`.
2. **Spacer** — the right cluster is `ms-auto flex items-center gap-1`.
3. **"Signed in as {name}"** — `me-2 hidden sm:inline`, `text-12 text-muted`.
   Hidden below the `sm` breakpoint.
4. **Settings** — a `NavLink` to `/settings`.
5. **Sign out** — a `<Form method="post" action="/logout">` with a submit button.
   A form, not a link, because signing out is a state change.

All three right-hand controls share `rounded-md px-2.5 py-1.5 font-ui text-12`.

> **Not yet built:** there is **no user menu** — no avatar, no dropdown, no
> account switcher. There are two flat links and a name. There is **no
> breadcrumb**, **no module switcher**, **no global search / ⌘K**, and **no
> toast host**. All four exist in the design system and none is mounted.

### 4.4 Primary navigation

`aria-label` = `nav.primary` = "Primary". The item list comes from the API
(`/v1/me` returns nav items with a `labelKey`), filtered through `isRouted()` so
an item the client cannot route to is never rendered.

**Every item is a text label.** The label keys and their English strings:

| Href | Label key | en | ar |
|---|---|---|---|
| `/` | `nav.home` | Home | الرئيسية |
| `/axis` | `nav.axis` | Operations | العمليات |
| `/orbit` | `nav.orbit` | Conversations | المحادثات |
| `/signal` | `nav.signal` | Marketing | التسويق |
| `/scout` | `nav.scout` | Market | السوق |
| `/north` | `nav.north` | Insight | الرؤى |
| `/distribution` | `nav.distribution` | Distribution | التوزيع |
| `/ledger` | `nav.ledger` | Ledger | دفتر الأستاذ |
| `/analytics` | `nav.analytics` | Analytics | التحليلات |
| `/compliance` | `nav.compliance` | Compliance | الامتثال |
| `/admin` | `nav.admin` | Administration | الإدارة |
| `/settings` | `nav.settings` | Settings | الإعدادات |

A user sees only the items their roles reach; an unlicensed module is not in the
list at all.

**Item rendering** (`NavItemLink`):

```
group flex shrink-0 items-center gap-2 rounded-md px-3 text-start font-ui
transition-colors duration-150
focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2
focus-visible:outline-accent
```

- top level: `py-2 text-13`; nested child: `py-1.5 text-12`
- active: `bg-surface-2 font-medium text-text`
- idle: `text-muted hover:bg-surface-2 hover:text-text`
- a `size-1.5 shrink-0 rounded-full` `aria-hidden` dot precedes the label,
  coloured by `MODULE_ACCENT` (`/axis /orbit /signal /scout /north` map to their
  `--module-*`; everything else uses `var(--accent)`). Opacity: nested 0,
  active 100, idle 30, hover 60.
- the label is `<span class="truncate">` — long tenant/domain-pack labels
  ellipsize rather than wrap.
- `item.icon` is carried through as a data attribute so a later icon pass can
  **decorate** the label. It never replaces it.

**Nested children** render as `<ul class="hidden md:mb-1 md:mt-0.5 md:flex
md:flex-col md:gap-0.5 md:ps-5">` — desktop only. On small screens the second
level is not shown at all.

**Responsive behaviour** — this is the important bit and it is unusual:

- **≥ md:** `md:sticky md:top-14 md:h-[calc(100vh-3.5rem)] md:w-60 md:flex-col
  md:gap-0.5 md:overflow-y-auto md:border-b-0 md:border-e md:p-3` — a 240px
  sticky, independently scrolling, permanently-labelled sidebar on the inline
  start edge.
- **< md:** `flex shrink-0 gap-1 overflow-x-auto border-b border-border
  bg-surface-1 p-2` — the nav becomes a **horizontally scrollable strip under
  the header**. Not an off-canvas drawer, not a hamburger. The stated reason:
  the labels stay on screen, nothing has to be opened to find out where you are,
  and it needs no state.

### 4.5 Main region

`id="workspace" tabIndex={-1} class="mx-auto min-w-0 w-full max-w-[100rem]
flex-1 p-4 sm:p-6"` — max width 1600px, 16px padding rising to 24px at `sm`.
`min-w-0` is load-bearing: it lets wide tables scroll inside the region instead
of stretching the page.

### 4.6 Error boundary

Not a stack trace. The formula is **what happened → what we did → what you can
do, plus a copyable reference**.

`<main class="mx-auto flex min-h-screen max-w-prose flex-col justify-center
gap-4 p-8">`

- `h1 font-display text-28` — "This did not load"
- `p text-muted` — one of: "The page could not be built. Nothing was saved, and
  you can try again." / "There is nothing at this address." / "Your roles do not
  include access to this area." / "Your session has ended. Sign in to continue."
- `p font-mono text-12 text-muted` — "Reference {id}"
- retry `<a class="text-accent underline underline-offset-4">` — "Try again"

### 4.7 Wireframes

**Desktop, ≥ 1024px, LTR**

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ [skip to content]  (visible only on focus)                                   │
├──────────────────────────────────────────────────────────────────────────────┤
│ ▣ Acme Insure          h-14 sticky        Signed in as Sara ·Settings·Sign out│
├──────────────┬───────────────────────────────────────────────────────────────┤
│ w-60  sticky │  main #workspace   max-w-[100rem]  p-6                         │
│ border-e     │                                                                │
│              │  ┌──────────────────────────────────────────────────────────┐  │
│ ● Home       │  │ Welcome back, Sara                     font-display 28   │  │
│ ● Operations │  └──────────────────────────────────────────────────────────┘  │
│ ●Conversation│  ┌────────────┬────────────┬────────────┬────────────┐         │
│ ● Marketing  │  │ Waiting on │ Unread     │ Revenue    │ Units      │  KPIWall│
│ ● Market     │  │ you     3  │        12  │ 48,200 AED │ 1,204  ~~~ │         │
│ ● Insight    │  └────────────┴────────────┴────────────┴────────────┘         │
│ ● Distributn │  ┌──────────────────────────────────────────────────────────┐  │
│ ● Ledger     │  │ Decisions waiting on you                                 │  │
│ ● Analytics  │  │  · axis.claim_settlement          [Approve] [Reject]     │  │
│ ● Compliance │  │  · ledger.period_close            [Approve] [Reject]     │  │
│ ● Administra…│  │  Open the full queue →                                   │  │
│ ● Settings   │  └──────────────────────────────────────────────────────────┘  │
│              │  ┌───────────────────────────────┬──────────────────────────┐  │
│  (own scroll)│  │ Your recent activity (2 cols) │ Notifications            │  │
│              │  └───────────────────────────────┴──────────────────────────┘  │
└──────────────┴───────────────────────────────────────────────────────────────┘
   ● = size-1.5 module-accent dot, aria-hidden. Label always present.
```

**Tablet, 768–1023px, LTR** — same structure, sidebar still 240px and still
labelled; the content grid drops from 3 columns to 2, `KPIWall` from 4 to 2.

```
┌────────────────────────────────────────────────────────────┐
│ ▣ Acme Insure                    Signed in as Sara ·⚙·Out  │
├──────────────┬─────────────────────────────────────────────┤
│ ● Home       │  ┌──────────────────┬──────────────────┐    │
│ ● Operations │  │ Waiting on you 3 │ Unread       12  │    │
│ ●Conversation│  ├──────────────────┼──────────────────┤    │
│ ● Marketing  │  │ Revenue   48,200 │ Units     1,204  │    │
│ ● Market     │  └──────────────────┴──────────────────┘    │
│ ● Insight    │  ┌─────────────────────────────────────┐    │
│ ● …          │  │ Decisions waiting on you            │    │
└──────────────┴─────────────────────────────────────────────┘
```

**Mobile, < 768px, LTR** — the sidebar becomes a scrolling strip. No hamburger,
no drawer, no state.

```
┌──────────────────────────────────┐
│ ▣ Acme            ⚙  Sign out    │  h-14, "Signed in as" hidden below sm
├──────────────────────────────────┤
│ ●Home ●Operations ●Conversa… →→→ │  overflow-x-auto strip, p-2, gap-1
├──────────────────────────────────┤
│  main  p-4                       │
│  Welcome back, Sara              │
│  ┌────────────────────────────┐  │
│  │ Waiting on you          3  │  │  KPIWall single column
│  ├────────────────────────────┤  │
│  │ Unread                 12  │  │
│  └────────────────────────────┘  │
│  ┌────────────────────────────┐  │
│  │ Decisions waiting on you   │  │
│  │  · axis.claim_settlement   │  │
│  │      [Approve]  [Reject]   │  │
│  └────────────────────────────┘  │
└──────────────────────────────────┘
```

**Desktop, RTL (`dir="rtl"`)** — the entire axis mirrors. The sidebar is on the
right with `border-inline-start`; the accent dot precedes the label on the
right; numeric table columns align left (the inline end); the module dot,
"Signed in as", and the sign-out control all reverse.

```
┌──────────────────────────────────────────────────────────────────────────────┐
│مسجّل الدخول: سارة · الإعدادات · تسجيل الخروج                    Acme Insure ▣ │
├───────────────────────────────────────────────────────────────┬──────────────┤
│                         main #workspace  p-6                  │ w-60  sticky │
│                                                               │  border-s    │
│  ┌──────────────────────────────────────────────────────────┐ │              │
│  │                                    مرحبًا بعودتك، سارة   │ │      الرئيسية ●│
│  └──────────────────────────────────────────────────────────┘ │      العمليات ●│
│  ┌────────────┬────────────┬────────────┬────────────┐        │     المحادثات ●│
│  │      1,204 │ 48,200 AED │         12 │          3 │        │      التسويق ●│
│  └────────────┴────────────┴────────────┴────────────┘        │        السوق ●│
│  ┌──────────────────────────────────────────────────────────┐ │       الرؤى ●│
│  │                              القرارات التي تنتظر قرارك   │ │      التوزيع ●│
│  │     [رفض] [موافقة]          axis.claim_settlement ·      │ │ دفتر الأستاذ ●│
│  └──────────────────────────────────────────────────────────┘ │    التحليلات ●│
└───────────────────────────────────────────────────────────────┴──────────────┘
```

**Mobile, RTL** — the nav strip scrolls right-to-left; the first item sits at
the right edge.

```
┌──────────────────────────────────┐
│    تسجيل الخروج  ⚙        Acme ▣ │
├──────────────────────────────────┤
│ ←←← …المحادثات● العمليات● الرئيسية●│
├──────────────────────────────────┤
│                    p-4  main     │
│               مرحبًا بعودتك، سارة │
└──────────────────────────────────┘
```

---

## 5. Screen index

Two kinds of screen live behind the session.

**Generic screens.** A module is *data*: `apps/web/app/modules/<name>.ts`
declares tabs (resources), each with columns, filters, create/edit fields,
permissions and an optional record link. Two route files render all of them —
`/:module/:resource` is a filtered, sorted, cursor-paged list; `/:module/:resource/:id`
is a record read and edited in the same place. Adding a module adds a spec file,
not a screen.

**Bespoke screens.** Anything genuinely its own thing gets a static path, which
React Router ranks above the dynamic `:module` segment.

### 5.1 Every route

| Path | Module | Title | Primary role | Detail |
|---|---|---|---|---|
| `/login` | — | Sign in (password → TOTP → enrol → recovery) | everyone | §6.1 below; single-card, no product name |
| `/logout` | — | (action only, no UI) | everyone | — |
| `/` | — | Home dashboard | everyone | §6 below |
| `/settings` | — | Settings — 9 panels | everyone | see [ADMIN](ui/admin.md) |
| `/approvals` | — | Approvals queue | any role holding `core:approvals:decide` | see [ADMIN](ui/admin.md) |
| `/axis` `/axis/:resource` `/axis/:resource/:id` | AXIS | Operations — cases, quotes, documents, tasks, policies, claims, escrow-batches, sops, case-approvals, process-events | `axis.agent` / `axis.lead` | see [AXIS](ui/axis.md) |
| `/orbit` `/orbit/:resource` `/orbit/:resource/:id` | ORBIT | Conversations — conversations, messages, renewals, journeys, journey-runs, partners, partner-txns, handover-notes, qa-scores | `orbit.agent` / `orbit.lead` | see [ORBIT](ui/orbit.md) |
| `/orbit/conversations/:id/thread` | ORBIT | Conversation thread | `orbit.agent` | see [ORBIT](ui/orbit.md) |
| `/signal` `/signal/:resource` `/signal/:resource/:id` | SIGNAL | Marketing — audiences, campaigns, creatives, signal-experiments, budget-moves, aeo-pages, attribution-events, spend | `signal.marketer` / `signal.lead` | see [SIGNAL](ui/signal.md) |
| `/scout` `/scout/:resource` `/scout/:resource/:id` | SCOUT | Market — signals, clusters, whitespaces, panel-bench, scout-experiments, data-products | `scout.pm` / `scout.lead` | see [SCOUT](ui/scout.md) |
| `/north` `/north/:resource` `/north/:resource/:id` | NORTH | Insight — metrics, snapshots, briefings, anomalies, scenarios, boardpacks, decisions | `north.exec` / `north.analyst` / `north.board` | see [NORTH](ui/north.md) |
| `/distribution` `/distribution/:resource` `/distribution/:resource/:id` | Distribution | Channels, offerings, commission-rates, quote-requests, quote-responses, commission-entries, next-best-offers | `tenant.admin` / `axis.lead` / `finance.controller` | quote & offer surfaces see [AXIS](ui/axis.md); commission surfaces see [LEDGER](ui/ledger.md) |
| `/distribution/quote-requests/:id/compare` | Distribution | Quote comparison (records are the columns) | `axis.agent` / `axis.lead` | see [AXIS](ui/axis.md) |
| `/distribution/next-best-offers/suggest` | Distribution | Next-best-offer, ranked | `axis.agent` / `orbit.retention` | see [AXIS](ui/axis.md) |
| `/distribution/commission-entries/statement` | Distribution | Commission statement | `finance.analyst` / `partner.manager` | see [LEDGER](ui/ledger.md) |
| `/distribution/commission-entries/:id/clawback` | Distribution | Commission clawback (destructive, checkbox-confirmed) | `finance.controller` | see [LEDGER](ui/ledger.md) |
| `/ledger` `/ledger/:resource` `/ledger/:resource/:id` | Ledger | 20 tabs: txns, txn-transitions, saga-steps, accounts, journal-batches, journal-lines, account-balances, periods, recon-runs, recon-matches, client-money-checks, subscriptions, invoices, revenue-schedules, usage-meters, payments, payment-plans, fx-rates, tax-rules, settlements | `finance.analyst` / `finance.controller` | see [LEDGER](ui/ledger.md) |
| `/ledger/transactions` | Ledger | Open a transaction (type catalogue) | `finance.controller` | see [LEDGER](ui/ledger.md) |
| `/ledger/transactions/:id` | Ledger | One transaction: state machine, journal lines, approvals, audit | `finance.controller` | see [LEDGER](ui/ledger.md) |
| `/ledger/reports/:report` | Ledger | Six reports: trial-balance, pnl, balance-sheet, aged, commission, client-money | `finance.analyst` | see [LEDGER](ui/ledger.md) |
| `/ledger/statement` | Ledger | Account statement + drift check | `finance.analyst` | see [LEDGER](ui/ledger.md) |
| `/ledger/period-close` | Ledger | Soft close / hard close / reopen | `finance.controller` | see [LEDGER](ui/ledger.md) |
| `/ledger/recon` | Ledger | Reconciliation: import, match, AI-proposed matches | `finance.analyst` | see [LEDGER](ui/ledger.md) |
| `/analytics` `/analytics/:resource` `/analytics/:resource/:id` | Analytics | dashboards, reports, report-runs, exports, schedules, saved-views, unit-economics, journey-events | `north.analyst` | see [NORTH](ui/north.md) |
| `/analytics/report/:id` | Analytics | Report builder + run (runtime columns, PII gate) | `north.analyst` | see [NORTH](ui/north.md) |
| `/analytics/dashboard/:id` | Analytics | Dashboard tiles | `north.exec` / `north.board` | see [NORTH](ui/north.md) |
| `/compliance` `/compliance/:resource` `/compliance/:resource/:id` | Compliance | dsar-requests, erasure-log, disclosures, screenings, retention-runs, legal-holds, evidence-bundles, incidents, rulepack-applications, policy-thresholds | `tenant.compliance` | see [COMPLIANCE](ui/compliance.md) |
| `/compliance/run/:kind` | Compliance | Run screening / evidence bundle / retention purge | `tenant.compliance` | see [COMPLIANCE](ui/compliance.md) |
| `/admin` `/admin/:resource` `/admin/:resource/:id` | Admin | 33 tabs: tenants, users, roles, user-roles, teams, customers, consents, products, providers, files, approvals, mandates, identity-verifications, memories, lenses, rulepacks, api-keys, identity-providers, webhooks, webhook-deliveries, notifications, audit-log, event-dlq, agents, prompts, runs, tool-calls, suggestions, budgets, evals, knowledge-sources, guardrail-events, ai-audit-log | `tenant.admin` | see [ADMIN](ui/admin.md) |
| `/admin/ai/console` | Admin | AI console: budgets, spend, agents, runs, guardrails, sealed audit | `tenant.admin` | see [ADMIN](ui/admin.md) |
| `/admin/ai/budget` | Admin | AI spending ceilings | `tenant.admin` | see [ADMIN](ui/admin.md) |
| `/admin/ai/runs/:id` | Admin | One agent run — the "why" behind an artifact | `tenant.admin` / `tenant.compliance` | see [ADMIN](ui/admin.md) |

Routes reachable only from inside another screen (never in the nav) are declared
as such with a written reason — e.g. `/approvals` is reached from the
"Decisions waiting on you" panel on the home dashboard.

### 5.2 Start here — the 15 highest-traffic screens

If only fifteen screens can be redesigned, these are the ones. Roughly in order
of how often a real user sees them:

1. **`/:module/:resource` — the generic list.** The single most-seen screen in
   the product. Every module, every tab. Fixing it fixes ~150 screens.
2. **`/:module/:resource/:id` — the generic record.** Same argument.
3. **`/` — home dashboard.** Every user, every session, first thing.
4. **`/login`** — every user, every session, and the only screen with no brand.
5. **`/orbit/conversations/:id/thread`** — the front-line agent lives here all
   day, and it is the richest AI surface in the product.
6. **`/approvals`** — the human-in-the-loop chokepoint for the whole platform.
7. **`/distribution/quote-requests/:id/compare`** — the core commercial act;
   the whole aggregator proposition in one screen.
8. **`/ledger/transactions/:id`** — where money state actually changes.
9. **`/settings`** — 9 panels, largest single file in the app, and the only
   place a tenant edits its own brand.
10. **`/admin/ai/console`** — the AI operator's home, and the product's public
    face for "how do I keep the agents in check".
11. **`/ledger/reports/:report`** — six reports finance opens daily.
12. **`/analytics/report/:id`** — the report builder and its results table.
13. **`/ledger/recon`** — reconciliation, and the only screen with AI *proposals*
    on money.
14. **`/compliance/run/:kind`** — three destructive runs behind one route.
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
        landingFor(roles)  ──▶  /admin | /settings | /{module}   (never a 403)
```

Demo deployments additionally offer one-click persona buttons, fetched from
`/v1/auth/demo/personas`; that endpoint 404s in production and the buttons
disappear.

### 6.2 The daily loop (any operations role)

```
/  home
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

### 6.3 Quote to placement — the core commercial flow

```
/orbit/conversations/:id/thread   customer asks
        │  agent opens a case
        ▼
/axis/cases/:id                   the work item
        │
        ▼
/distribution/quote-requests      create request  →  fanned out to providers
        │
        ▼
/distribution/quote-requests/:id/compare
        │   the transposed table: each provider response is a COLUMN
        │   AI ranks and shows a ConfidenceMeter
        ├─ share    →  send the comparison to the customer
        ├─ shop     →  go back to more providers
        ├─ offer    →  surface a next-best-offer
        └─ select   →  place with one provider          [GATE: consequential]
                        │
                        ├ 403 approval_required  →  GuardrailNotice
                        │                            "quote.placement needs a
                        │                             second person"  → /approvals
                        └ ok ▼
/axis/policies/:id                the contract exists
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
├─ "Why this needs approval" — the machine context behind the decision
├─ 24h TTL: a request older than that is shown as expired
├─ DUAL CONTROL: if you raised it, both buttons are replaced by
│    "You raised this request, and this rule needs a second person to decide it."
├─ [Approve]  → the paused action resumes
└─ [Reject]   → native confirm(), then the action is abandoned
```

Approval policies that exist today include `axis.claim_settlement` (claim
settlement amount), `signal.campaign_launch` (spending money on media), the
ledger transaction policies, and the AI autonomy raise.

### 6.5 Money: open, post, close

```
/ledger/transactions        pick a transaction TYPE from the catalogue
        │                   (each row shows its code, its kind badges,
        │                    and the approval policy it will trip)
        ▼
open → the transaction exists in state `draft`
        │  form carries a one-time idempotency key: pressing twice posts once
        ▼
/ledger/transactions/:id
        ├─ 12-term details
        ├─ journal lines table
        │    └ if unbalanced: role="alert" "This batch does not balance",
        │      with the delta shown in font-display 28 bold danger
        ├─ Move state  → next legal states only (13-state machine)   [GATE]
        ├─ Reverse     → danger, native confirm()                    [GATE]
        ├─ Timeline of transitions
        └─ approvals + audit sections
        ▼
/ledger/recon               match against what the provider actually paid
        ├─ import statement lines
        ├─ auto-match
        ├─ optional: "Let the assistant propose matches for the leftovers"
        │    "Proposals are never posted. Each one still needs a person to
        │     confirm it."  →  ✦ Badge "Assistant" + confidence % per row
        └─ per-row confirm
        ▼
/ledger/period-close
        ├─ Soft close (secondary)   → reversible                     [GATE]
        ├─ Hard close (danger)      → irreversible                   [GATE]
        └─ Reopen    (ghost)        → only from soft-closed          [GATE]
        ▼
/ledger/reports/:report     trial balance must foot; client money must not be short
```

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
        ▼
/compliance/run/screening        run a screening
/compliance/run/evidence         build an evidence bundle
/compliance/run/retention        purge under a retention rule   ← DESTRUCTIVE
        │
        └ today this has NO confirmation of any kind and NO approval gate.
          See §7 item 1.
        ▼
/compliance/erasure-log          what was erased, sealed
```

### 6.8 AI oversight

```
anywhere an artifact carries ✦
        └─ EvidenceLink / "Why this was drafted"
                ▼
/admin/ai/runs/:id        inputs, tool calls, output, cost, evidence
        └─ if state = awaiting_approval → ApprovalStrip right there
                ▼
/admin/ai/console         all runs, all agents, guardrail events, sealed AI audit
        ├─ pause an agent            (reason required)
        ├─ raise autonomy            (confirm required)              [GATE]
        └─ kill switch
                ▼
/admin/ai/budget          set the ceiling
        └─ checkbox: "I understand this changes what the agents may spend,
           and that raising it is recorded against my name."
```

---

## 7. What needs design work most

Prioritised. Each item names the specific defect, not a vague dissatisfaction.

### P0 — correctness and safety

**1. ~~The retention purge has no confirmation at all.~~** *Closed.* The purge
runs dry by default and shows what it would destroy; the destructive run is a
second form carrying `confirm=purge`, so the figures stay on screen while the
actor commits to them.

**The defect as found:**
`/compliance/run/retention` permanently destroys customer data. It has no
`confirm()`, no confirmation checkbox, and no approval gate. Every other
destructive act in the product asks at least once. This is the single worst gap
found. It needs the same treatment as the commission clawback: figures on
screen, a required checkbox, and an approval policy behind it.

**2. ~~There are five different confirmation idioms for consequential
actions.~~** *Closed.* There is one idiom — `ConfirmButton` in
`components/confirm.tsx` — and `window.confirm()` survives nowhere but that
file's own comment explaining why it is gone.

**The defect as found:**
The product cannot decide how it asks "are you sure":

| Idiom | Where |
|---|---|
| Browser-native `confirm()` | generic record delete; approvals reject; settings API-key revoke; open transaction ×1; transaction reverse ×1; period close ×4; reconciliation ×3 |
| Required `Checkbox` primitive | commission clawback; AI budget ceiling |
| Raw `<input type="checkbox" required>` (not the primitive) | AI console autonomy raise |
| Nothing | compliance retention purge |
| Nothing (declared but never rendered) | `ActionSpec.confirm` |

Native `confirm()` is the worst of these: it is unstyled, unlocalisable (the OS
picks the button words, in the OS language, so an Arabic user gets English
buttons or vice versa), not RTL-aware, blocks the main thread, and hides the
figures the user is confirming behind a system dialog. Pick **one** pattern.
The product already argues for the right one in `commission-clawback.tsx`: *"A
checkbox, not a modal: the figures stay on screen while the actor confirms
them."* Make that the rule and remove `confirm()` everywhere.

**3. ~~Machine strings leak to users in at least six places.~~** *Closed.*
`humanise()` is reached on every path listed below, the JSON dumps are rendered
fields, and an unlabelled analytics tile key reads as words.

**The defect as found:** Each renders a raw
enum key, permission string or JSON blob where a sentence belongs:

- `/approvals` — "Why this needs approval" renders raw machine context keys as
  the definition terms.
- `/` home — approval summaries render the raw `policyKey`
  (`axis.claim_settlement`). The constraint driving this is right (§2.6); the
  fix is a domain-pack lookup, not an English literal.
- `/settings` — the API-key scope picker labels its checkboxes with raw
  permission strings (`core:api_keys:revoke`); the DSAR State column renders the
  raw machine word.
- `/orbit/conversations/:id/thread` — `EvidenceLink` opens a raw
  `<pre>{JSON.stringify(...)}</pre>`.
- `/admin/ai/runs/:id` — tool arguments as a raw `<pre>` JSON dump.
- `/ledger/transactions` and `/ledger/recon` — a raw `<Textarea>` for JSON
  arguments and statement lines, hand-typed.
- `/analytics/dashboard/:id` — an unknown tile type renders **the raw tile key**
  as an `<h2>`.

The helper to fix most of this already exists (`humanise()` turns
`pending_settlement` into "Pending settlement") — it is just not reached in
these paths.

### P1 — chrome that was designed and never mounted

**4. ~~The shell is missing five pieces the design system already ships.~~**

**The defect as found:** There is **no toast host**, **no command bar / global search (⌘K)**, **no
breadcrumb**, **no module switcher** and **no user menu** — the account controls
are two flat text links and a name. Every one of these exists in
`packages/ui` and is imported by nothing. Symptoms today: a successful save is
announced by an inline green band that only appears if you happen to still be
looking at that part of the page; there is no way to search across the product;
and on a three-level path (`/ledger/journal-lines/abc123`) there is no
indication of where you are beyond the nav highlight.

> **Closed.** All five are settled. ⌘K is the header's `SearchPalette`
> (ADR-0031). The breadcrumb is `crumbsFor` in `shell.tsx`, below module level
> only (docs/07 §3). The user menu is the account pill, now the trigger for the
> kit's `Menu` carrying Settings and Sign out. The toast host wraps the shell,
> with in-place notices kept as the default (ADR-0051). The module switcher is
> the labelled rail itself and is not mounted twice (ADR-0052).

**5. ~~Nothing in the product uses `Skeleton`.~~** *Closed.* The wait that
actually exists is navigation: loaders run on the server, so a slow screen was a
page that did not change. The shell now draws the arriving screen's shape once a
navigation has held for 400ms — under that it holds still, because a skeleton
that flashes reads as a fault. The copilot answer keeps its own shape-specific
skeleton, which is the pattern for any screen whose wait is one region rather
than the whole page.

**The defect as found:** The latency doctrine calls for
skeletons over spinners above 400ms. Zero screens do this. Loading states are
either instant (server-rendered) or nothing.

**6. ~~`Pagination` is shipped and unused.~~** *Closed.* Lists route through
the shared footer and the page-size control is reachable: `[25, 50, 100, 200]`
in `module.tsx`, carried in the query string.

**The defect as found:** Every list hand-rolls a footer with
"{count} shown" and Previous/Next. Consistent enough, but the page-size control
(`[25, 50, 100]`) is unreachable anywhere in the product.

### P2 — the ambient AI grammar is inconsistently applied

**7. ~~Two AI surfaces are missing the marker or the why.~~** *Closed.* The
comparison screen carries the single ✦ with its "why" one interaction away and
labels the ranking as the model's answer.

**The defect as found:**
`/distribution/quote-requests/:id/compare` shows a `ConfidenceMeter` but carries
**no ✦ marker and no why-link** — the user sees a model's confidence in a ranking
they cannot inspect. The next-best-offer screen ranks by model score with the
comment "the order is the model's answer" but does not label it as such.

**8. ~~`AgentBadge`, `GhostText` and `ConfidenceMeter` hard-code English.~~**
*Closed.* The kit's AI chrome reads its words through `useUiText()`, so the chip
speaks the locale it is rendered in.

**The defect as found:**
"Drafted by {agent}", "AI-generated", "Model confidence", "Why this was drafted"
are literals inside `packages/ui/src/ai.tsx`. They stay English under `dir="rtl"`
and the Arabic locale, producing an LTR English chip inside an RTL Arabic
sentence. This breaks §2.3 in the most visible possible place. The affected
screens' own code even notes it: the AI components "ship their own English
chrome".

**9. ~~Autonomy levels disagree between two screens.~~** *Closed.* An agent has
one ladder — `AGENT_AUTONOMY`: suggest, act with approval, act within limits,
act on its own (`packages/db/src/json.ts`, ADR-0049) — and the `/admin/agents`
tab now offers exactly that, labelled in both locales. It had been offering the
*campaign* ladder (`suggest | draft | act_with_approval | act |
act_and_report`), which the agents API rejects: three of the five rungs a user
could pick were words the platform would not accept. The campaign ladder still
belongs to campaigns, where the budget screen sets it.

**The defect as found:**

### P3 — screens that are structurally weak

**10. ~~`/settings` is nine unrelated panels on one 1,726-line page.~~**
*Closed.* Settings is five addressable screens behind a tab bar — profile,
sign-in & access, brand, regional, your data — served by `/settings/:tab`
(`/settings` still lands on profile). The brand editor is its own screen at
`/settings/brand` rather than the seventh panel down, and a tab the actor
lacks the permission for is not shown at all: `/settings/brand` without
`core:tenants:update` falls back to profile instead of 404ing.

**11. ~~`/distribution/quote-requests/:id/compare` cannot be read on a
laptop.~~** *Closed.* The row-label column is `sticky start-0` (logical, so the
sticky edge follows `dir`), and the header row sticks with it — scrolling to the
fourth provider keeps the labels.

**The defect as found:**
It is a transposed table (records are columns) inside a `tabIndex={0}` sideways
scroll region with **no sticky first column and no sticky header**. Scrolling
right to reach the fourth provider loses the row labels entirely, so the user is
reading a column of numbers with no idea what they measure. This is the core
commercial screen in the product.

**12. ~~There is no charting.~~** *Closed* (ADR-0053). Not by adding a library:
`packages/ui` draws the two shapes a tile actually needs. `LineChart` is the
series with a scale a reader can name — the high and the low as formatted
figures, gridlines, the first and last x label, and a y floor at zero so a
series is as tall as it is. `DonutChart` is share of a whole, a ring with a
named legend, which is the question a row of meters against the largest row
cannot answer. A bar tile stays one labelled meter per row on purpose: a
horizontal bar carries its own name in a tile narrow enough to sit
three-across. The ceiling is written down — zoom, brushing, multi-series and
dual axes are where a library would earn its place.

**The defect as found:** `/analytics/dashboard/:id` degrades every tile
type by hand: a number becomes a `Stat`, a line becomes a 100×28 `Sparkline`, a
bar or donut becomes a list of `ProgressBar`s capped at 8 rows, and anything else
becomes a table. The code says so plainly: *"no charting library — none is
installed."* For a product whose NORTH module is named "Insight" and whose board
role is read-only dashboards, this is the widest gap between promise and screen.
Decide whether the answer is a chart library or a deliberate, well-designed
no-chart language — the current state is neither.

**13. ~~Empty states are inconsistent per screen.~~** *Closed.* Every table
named below now carries an `empty`: the transaction-type catalogue says a type
must be published before anything can be opened, the compliance manifest and
evidence tables have theirs, and `/ledger/period-close` distinguishes "no period
selected" from "you cannot read periods" instead of telling a permitted user
they lack access. The approvals section was already an `EmptyState`, not a raw
`<p>`.

**The defect as found:** `EmptyState` is the most-used
component in the product (20 imports) and yet several tables ship without an
`empty` prop at all (the transaction-type catalogue, the compliance manifest),
falling back to a bare blank; the transaction approvals section uses a raw
`<p>`; and `/ledger/period-close` reuses the **denied** copy for the "no period
selected" case, telling a permitted user they lack access.

**14. ~~Bespoke screens do not share the label catalogue.~~** *Closed.* There
is one resolver — `labelsFrom` in `detail-kit.tsx` — and every bespoke route
now goes through it: its own table first, then the shared table, then the
platform's `common.*` words, then the key. The seventeen hand-rolled copies of
that chain are gone, and with them 136 local labels that only restated a word
the platform already said (`approvalTitle` in fourteen files, the settlement
and commission state names, the document types). `labels.shared.test.ts` fails
the build if a route writes one of them down again, so the Arabic can no longer
drift screen by screen. A local entry still wins where a screen genuinely means
something else — "Back to the register", "You cannot read roles", a desk's own
empty-state — which is what the override chain is for.

**15. ~~`ActionSpec` is fully built and used by nothing.~~** *Closed.* The
mechanism is wired: AXIS documents verify and extract, AXIS policies do the
three lifecycle hops the API owns (not taken up, lapse, reinstate), and an
analytics schedule pauses and resumes. Policies lost `status` from `editable`
in the same change — every hop out of `active` moves money, and a PATCH wrote
the word without the journal lines behind it (docs/19). `spec.actions.test.ts`
holds the line: every declared action names a real permission, posts to a
`{id}` path, and says its button, its confirm prompt, its fields and their
hints in both locales. The remaining state changes still belong to their
bespoke desks — a claim's transition is a screen, not a button — which is what
the seam is for.

**16. ~~Two secondary money surfaces expose raw JSON to finance users.~~**
*Closed.* `/ledger/transactions` now renders one input per recipe argument —
money in a money field — off the field list `GET /txn-types` publishes.
`/ledger/recon` takes the statement as the counterparty exported it (reference,
amount, our reference, date, description; commas or tabs, header row optional),
parses it server-side and shows the rows it read back before the run starts.
Neither screen asks a controller to write JSON.

---

## Appendix — the visual quality bar

`assets/Lyra_Brand_UI_Showcase.html` is the reference for how finished this
should look. It is the same type and the same structure, rendered at a level the
product has not reached. One thing in it is stale: its accent is the earlier
amber generation (`#FFB020`), not the shipped `--vega-500` lime. Read every
"amber" below as "whatever `--accent` currently resolves to" — the showcase is a
composition reference, and the palette above is the palette of record. Sections: *01 The mark* (a Space Grotesk 500 60px
wordmark, 0.03em tracking, with a 30×3.6px amber tick rotated −45°), *02 SIGNAL
Social Studio*, *03 Launch Cockpit*, *04 Ledger Explorer & Money Map*, *05
Mobile*, plus *The Brief* and *Approvals*.

Useful specifics from it: a 1280px wrap with `56px 32px 90px` padding; `h1` at
`clamp(34px, 4.6vw, 54px)`; a lede at 16.5px capped to 66 characters; an eyebrow
at 12px / 3px letter-spacing / amber / uppercase; an AI chip at 11px amber with
a `rgba(255,176,32,.35)` border and a 999px radius; evidence links as amber with
a dotted amber-600 bottom border; a guardrail gate as a teal `rgba(55,211,178,.4)`
border on a `.07` teal wash; sealed journal rows tinted ink-800 with a 3px teal
inline-start marker and draft rows ink-700 with a star-500 marker; and an Arabic
panel demonstrating `direction: rtl` in IBM Plex Sans Arabic.

Two things in it are **not** to be copied: its 58px icon-only rail (see §2.1)
and its Google Fonts CDN links (the real product self-hosts, because an on-prem
deployment may be air-gapped).
