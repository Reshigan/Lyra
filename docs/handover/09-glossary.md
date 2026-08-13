# 09 — Glossary

**Audience:** everyone. Skim it once, then keep it open in a tab.

LYRA tickets mix two vocabularies. **Part A** is the platform's own invented
language — module names, seams, patterns, internal jargon. **Part B** is the
insurance and financial vocabulary the business speaks, which you will meet in
user tickets whether or not you have an insurance background.

Each part is alphabetised independently. Terms are cross-referenced with
*(see …)*.

A note on why the two parts are separate is in §3: LYRA deliberately keeps
industry nouns out of its code.

---

## Part A — LYRA platform vocabulary

### ✦ (the agent mark)

The single character that marks anything produced by AI, anywhere in the
product. Defined once, as `AGENT_MARK` in
[`packages/ui/src/ai.tsx`](../../packages/ui/src/ai.tsx). There is no other AI
badge, sparkle, robot icon or "AI" label in LYRA — if you see one, it is a bug.
Rendered `aria-hidden`, so screen readers get the accompanying text instead.

### Actor

Who or what is performing an action. Every request carries one, and every audit
row records it. Five kinds: `user`, `agent`, `partner`, `system`, `customer`.
Written in logs and audit trails as `kind:id` (for example `agent:renewals`).
`system` is the scheduler and queue consumer; `agent` is an AI agent acting
under an autonomy grant.

### Ambient AI grammar

The rule set for how AI appears in the interface
([`docs/15-experience-excellence.md`](../15-experience-excellence.md) §4). Its
principles: AI completes intent rather than interrupting it, presence scales
with stakes, everything is inspectable, everything is undoable at low autonomy,
and **silence is a feature**. AI never uses a modal or a toast for itself, and
never auto-sends outside an explicit autonomy policy.

Ten named patterns exist, and a new AI surface must use one of them or add one
by ADR:

1. **Ghost text** — a draft rendered as 40%-opacity continuation; Tab accepts,
   typing dismisses. Never auto-sends.
2. **Quiet chips** — one-line predictions with confidence dots
   (`likely to renew · ●●○`); hover reveals the evidence.
3. **Background drafts** — long work happens off-screen and arrives as a tray
   item, not a modal. Review-and-release.
4. **Forecast strip** — at most three stake-ranked items at the top of a
   workspace, each with one action and a dismiss that teaches the ranker.
5. **Whisper dots** — a 4px pulse on a rail glyph when that module's agent found
   something material. Never a numeric badge above 9, never red unless
   consequential.
6. **Semantic everything** — ⌘K and table filters accept natural language and
   **show the structured filter they compiled to**, so trust is earned.
7. **Explain-on-hover** — any AI-produced value answers "why?" within one hover:
   source fields, model tier, confidence, timestamp.
8. **Escalating presence** — informational is a chip, suggested is the forecast
   strip, consequential is an approval strip with full reasoning.
9. **The quiet ledger** — a per-user "what AI did for you today" digest, which
   doubles as the autonomy audit surface.
10. **Undo-first autonomy** — every automated action ships with a one-click
    reversal window where the domain allows; irreversible domains stay
    suggestion-only by design.

### Approval

A recorded human decision that must exist before a consequential action takes
effect. Stored in `core_approvals` (with a module-local mirror in
`axis_approvals` for case-scoped queries). An AI tool call that has a side
effect carries an approval id in `ai_tool_calls` — no side effect without one.
*(see Consequential action, Dual control, Delegation)*

### Autonomy ladder

How much an automated actor is allowed to do without a human. **There are two
ladders, not one** (ADR-0049), and confusing them is a common error:

| Ladder | Rungs | Applies to |
|---|---|---|
| Agent autonomy | `suggest` → `act_with_approval` → `act_within_limits` → `autonomous` | AI agents generally |
| SIGNAL campaign ladder | five rungs of its own | Marketing campaign automation only |

An **autonomy envelope** is the per-agent record of which rung it holds plus its
bounds. The `AutonomyEnvelope` interface is documented as a seam but **is not
implemented** (docs/27 F39) — behaviour today follows the code, not the
document.

### AXIS

The **Operations** module. Nav label: "Operations". The unit of work is a
*case*; AXIS also owns policies, claims, documents, tasks, complaints, SIU
referrals and bordereaux. Tables prefixed `axis_`.

### Cold open

The decorative animated overlay on first paint (ADR-0055). It is
`pointer-events: none` and `aria-hidden` — **it never blocks input**. If a user
says the app is unclickable during the intro, that is a real bug, not the cold
open working as designed.

### Consequential action

Any action tagged `consequential: true`: pricing, claims guidance, regulated
advice, an outbound send, a payment. It **requires an approval step** unless the
tenant's policy explicitly automates it *and* the action type is on that
tenant's `auto_approve` allowlist. This is
[`CLAUDE.md`](../../CLAUDE.md) rule 4 and it is not negotiable to make anything
else work.

### Constellation

**The design system** — the component library in
[`packages/ui`](../../packages/ui), specified by
[`docs/07-ui-design-system.md`](../07-ui-design-system.md). Buttons, tables,
forms, tokens, charts. Its current palette and typography ("Night Sky":
Archivo, Instrument Sans, Instrument Serif, IBM Plex Mono, all self-hosted) were
set by ADR-0026, which changed token *values* while keeping token *names*.

**Constellation is not the app shell, and it is not Horizon.** *(see Horizon)*

### Ctx

The request context object, built once per request by the API gateway and passed
to every handler. It is *everything a handler is allowed to know*: `db`,
`tenantId`, `actor`, `requestId`, `now`, `locale`, `policy`, `entitlements`,
`ip`, `ua`. Defined in
[`packages/core/src/context.ts`](../../packages/core/src/context.ts). `now` is a
single request-start clock, so all rows written by one request share a
timestamp.

### Delegation

A time-boxed "act on my behalf" grant, in `core_delegations`. An approval made
under one records its `delegation_id`. Expired delegations are retired on every
cron tick, because an admin screen that still shows an expired delegation as
active is lying about who holds authority.

### Depth markers

Short suffixes used in specs and screen names to indicate how deep a surface
goes: `AI`, `AN` (analytics), `RP` (reporting), `ADM` (admin), `DEV`, and `∫`
(the deepest/integrative level). You will see them in
[`docs/`](../) and in traceability rows, not in the UI.

### Domain pack

A **versioned configuration bundle, not code**, that adapts LYRA to an industry:
vocabulary, default journeys, enabled tools, metric registry entries, report
templates, rulepacks and a seeded demo dataset. Specified in
[`docs/21-editions-and-verticals.md`](../21-editions-and-verticals.md).

Nine packs ship in v1: `insurance_distribution`, `banking_products`, `telco`,
`retail_ecom`, `healthcare_services`, `real_estate`, `travel`, `education`,
`b2b_services`.

Rules: a pack may **rename and restrict**, but may **never weaken a compliance
floor** and never remove audit, consent or approval behaviour. Vocabulary
changes on a live tenant are safe; entity remapping needs a migration plan.
*(see §3)*

### Dual control

The policy that a decision needs two people. Expressed as the `DualControl` type
with three values: `never`, `above_threshold`, `always`. A companion
`neverAutoApprove` list names action types that can never be automated
regardless of policy. Thresholds are versioned in
`compliance_policy_thresholds`, because "what was the limit in March" is an
audit question.

### Edition

A commercial packaging of modules. Seven editions — Core, Bots, Ops, Social,
Radar, Insights and Suite — plus four bundles. What a tenant has bought is
enforced through `entitlements`, not through hidden menu items.
*(see Entitlements)*

### Entitlements

The per-tenant record of what is licensed and enabled, stored as
`entitlements_json` on `core_tenants` and carried on every `Ctx`. If a user
reports a missing feature, check entitlements before assuming a defect.

### Envelope

The fixed shape of every event on the bus:
`{id, ts, tenant_id, module, type, actor, subject, data, v: 1}`. Validated by a
zod schema in [`packages/core/src/events.ts`](../../packages/core/src/events.ts).
The same types are used for outbound webhooks, so an event contract change is a
webhook contract change. *(see Outbox / Inbox / DLQ)*

### Eval

An automated quality test for AI behaviour: a golden set of inputs with
thresholds, in [`packages/model-gateway/evals/`](../../packages/model-gateway/evals).
LYRA is built **eval-first** — the eval is written before the prompt, and a
prompt change that does not move a measured eval is a refactor. Evals run as a
blocking CI job; a regression blocks the release.

### Feature flag

A platform toggle in `core_feature_flags` — **the one table in LYRA with no
`tenant_id`** (ADR-0028), because a flag has to exist before any tenant does.

### Guardrail

A pre- or post-model check that blocks or scrubs content: PII, prompt injection,
compliance refusals, jailbreak attempts. Implemented in
`packages/model-gateway/src/guardrails.ts` and `scrub.ts`; trips are recorded in
`ai_guardrail_events`. **Six of the guardrail regexes are English-only**
(docs/27 F41).

### Horizon — two unrelated meanings

This is the most common vocabulary trap in the codebase.

1. **Horizon (the visual grammar layer)** — an editorial styling layer inside
   the design system, at
   [`packages/ui/src/horizon.tsx`](../../packages/ui/src/horizon.tsx). It
   provides seven "marks": the eyebrow, the lede, the figure, the hue bar, the
   hairline, the answer, and the provenance. **There is no "Horizon shell".**
   The application shell is just the shell,
   [`apps/web/app/components/shell.tsx`](../../apps/web/app/components/shell.tsx),
   and ADR-0052 records that there is no separate module switcher — the labelled
   rail is the switcher.
2. **Horizons H1–H12 (future capability seams)** — the twelve future
   capabilities in
   [`docs/16-future-horizons.md`](../16-future-horizons.md), each reserved as an
   interface or schema field so today's single case is never hard-coded.
   Examples: H1 mandates, H5 identity verification, H9 non-insurer providers,
   H11 agent memory, H12 rulepacks. *(see Seam)*

### Idempotency key

A caller-supplied `Idempotency-Key` header, honoured on **all** POSTs for 24
hours and stored in `core_idempotency_keys`. Every money-affecting transaction
also carries one internally. A retried request returns the original result
instead of doing the work twice.

### Impersonation

A platform-staff feature for reproducing a user's view. Implemented as a
**time-boxed session swap, not a new authority path** (ADR-0027) — the staff
member gets the target's session, and `can()` is unchanged. Every session is
recorded in `core_impersonation_sessions`.

### J-ID (journey identifier)

The stable identifier for a business journey, defined in
[`docs/06-roles-and-journeys.md`](../06-roles-and-journeys.md) §2 and used to tag
Playwright specs (`@journey:J-XX`) and product telemetry
(`analytics_journey_events`).

| Prefix | Audience | Examples |
|---|---|---|
| `J-C` | Consumer | J-C1 get covered, J-C2 get help on WhatsApp, J-C3 renew in one tap, J-C4 exercise privacy rights |
| `J-O` | Ops (AXIS) | J-O1 exception clearing, J-O2 group medical bid, J-O3 month-end reconciliation |
| `J-X` | CX and retention (ORBIT) | J-X1 handover catch, J-X2 save desk, J-X3 partner integration |
| `J-M` | Marketing (SIGNAL) | J-M1 campaign in a day, J-M2 budget morning, J-M3 own the answer box |
| `J-P` | Product (SCOUT) | J-P1 radar quarterly |
| `J-E` | Executive (NORTH) | J-E1 the 7am read |
| `J-A` | Admin | J-A1 new tenant in a day, J-A3 incident |
| `J-D` | Developer | J-D1 first API call |
| `J-CO` | Compliance | J-CO1 regulator request |

When a user describes a workflow, mapping it to a J-ID is the fastest way to
find both the spec and the test.

### Kill switch

The platform-wide agent pause (`packages/model-gateway/src/kill.ts`). Engaging
it stops AI activity across a tenant or the platform and records an incident in
`compliance_incidents`. Calls stopped this way appear in `ai_audit_log` with
outcome `killed`.

### LEDGER

The money subsystem and its workspace. **Not a module** — it is a workspace
alongside Distribution, Analytics, Compliance, Administration and Settings.
Governed by
[`docs/19-transactions-and-ledger.md`](../19-transactions-and-ledger.md). Tables
prefixed `ledger_`.

### Lens

Per-user, per-role customisation of what a screen shows
([`docs/15`](../15-experience-excellence.md) §5). Implemented in
[`packages/core/src/lens.ts`](../../packages/core/src/lens.ts), stored in
`core_lenses`, served from `/v1/me/lens*`. If two users of the same role see
different layouts, the Lens is the reason. Mobile Lens **reset** does not match
web (a known parity gap).

### Minor units

Money is always an integer count of the currency's smallest unit, in a `*_minor`
column, alongside a separate `currency` column. AED 12.34 is `1234` + `"AED"`.
**No floats, ever.** Rates are expressed in parts-per-million (`ppm`), so 12.5%
is `125_000`.

### Model gateway

[`packages/model-gateway`](../../packages/model-gateway) — the only sanctioned
path to any language model. Exposes a single `complete(req)`. Callers ask for a
**tier** (`fast`, `standard`, `reasoning`), never a model name; the gateway
resolves the model, enforces budget and guardrails, and writes `ai_audit_log`.
App code calling a provider SDK directly is a bug.
*(see Purpose, Tier, `ai_audit_log` in file 07 §2.1)*

### Module

One of exactly **five**: AXIS, ORBIT, SIGNAL, SCOUT, NORTH. Everything else
users call a "module" — Distribution, LEDGER, Analytics, Compliance,
Administration, Settings — is a **workspace**. Modules may not import each
other; they integrate through the event bus, and the only permitted shared
import is `packages/core`.

| Module | Nav label | Owns |
|---|---|---|
| AXIS | Operations | Cases, policies, claims, documents, tasks |
| ORBIT | Conversations | Customers, conversations, channels, renewals, partners |
| SIGNAL | Marketing | Campaigns, audiences, creatives, budget autopilot, attribution |
| SCOUT | Market | Market signals, clusters, whitespace, panel benchmarking |
| NORTH | Insight | Metrics, snapshots, briefings, anomalies, board packs |

### NORTH

The **Insight** module. Executive intelligence. Reads views and nightly
snapshots only, never module hot tables — which is why a NORTH figure can be up
to a day old, and why it can disagree with LEDGER (docs/27 F49). `north_metrics`
is the **semantic layer**: one definition of each metric, used everywhere.

### ORBIT

The **Conversations** module. Owns `core_customers` writes (every other module
reads the customer spine), plus conversations, channels, renewals, journeys and
distribution partners. Tables prefixed `orbit_`.

### Outbox / Inbox / DLQ

The event-delivery triple:

- **Outbox** (`core_event_outbox`) — an event row written in the *same database
  transaction* as the state change it describes, so an event can never exist for
  a change that rolled back.
- **Inbox** (`core_event_inbox`) — a `(event_id, consumer)` marker that makes
  each handler run exactly once.
- **DLQ** (`core_event_dlq`) — where an event lands after five failed attempts.
  Visible and replayable from admin; **never silently dropped**.

### Permission string

`module:resource:action`, for example `axis:cases:approve` or
`north:briefings:read`. Roles bundle permissions. There are 28 role keys, each
`<scope>.<role>` (for example `orbit.retention`, `platform.admin`). Every check
goes through `can(actor, perm, subject)` in
[`packages/core/src/rbac.ts`](../../packages/core/src/rbac.ts) — never an ad-hoc
check. Grants can be narrowed by `scope_json` (team scoping).

### `ponytail:` comment

A code comment marking a **deliberate** simplification and, where relevant, its
known ceiling and upgrade path. `// ponytail: global lock, per-account locks if
throughput matters`. When you find one, the simplification was a decision, not
an oversight — but the ceiling it names is real.

### Purpose

The declared reason for a model call (`packages/model-gateway/src/purposes.ts`).
Every gateway call carries tenant, module, **purpose**, and actor, and all four
land in `ai_audit_log`. Purpose is what makes "what is this tenant spending AI
budget on?" answerable.

### Rail

The persistent left-hand navigation. Always text-labelled, with no collapsed or
icon-only state (ADR-0011), and it *is* the module switcher (ADR-0052). Rail
glyphs carry whisper dots when a module's agent has found something.

### Rulepack

A versioned bundle of regulatory rules (seam H12), in `core_rulepacks`. Which
version was in force when a decision was made is recorded in
`compliance_rulepack_applications` — an audit needs the rules as they were, not
as they are.

### SCOUT

The **Market** module. Market signals in, whitespace out. Tables prefixed
`scout_`.

### Seam

A deliberately reserved interface, enum value or schema field that exists so a
future capability can be added without rewriting today's code
([`CLAUDE.md`](../../CLAUDE.md) rule 15,
[`docs/16-future-horizons.md`](../16-future-horizons.md)). Seams live in
[`packages/core/src/seams.ts`](../../packages/core/src/seams.ts) and are held to
contract tests tagged `@seam:Hx` (ADR-0018).

**Seams are load-bearing.** Implement against the seam — never hard-code the
single case that exists today. Removing or bypassing one requires an ADR.
Current seams include `Channel`/`ChannelAdapter`, `IdentityVerifier`,
`ScreeningProvider`, `SpeechProvider`, `DataInConnector`, `TimeseriesIngest`,
`ExtensionManifest` and `AutonomyEnvelope`. Several have **no implementation at
all** today — that is the point of a seam, but it also means the capability does
not exist. *(see file 07 §9)*

### SIGNAL

The **Marketing** module. Campaigns, audiences, creatives, budget autopilot and
attribution. Every automated budget move is a row in `signal_budget_moves` and
is reversible for seven days. **SIGNAL publishes to no ad network today**
(ADR-0015).

### Snapshotter

The nightly NORTH job (`apps/api/src/engines/north-snapshotter.ts`) that
materialises metric values into `north_snapshots` at approximately 02:00 UTC.
It computes each metric through a **typed registry**, never by executing a
stored SQL string (ADR-0024).

### Suggestion

An AI proposal a user can accept, edit or dismiss, in `ai_suggestions`. The
accept/edit/dismiss signal is the feedback loop that decides whether an ambient
pattern has earned its place on screen. Money-and-consent-bearing offers are
kept separately in `dist_next_best_offers`.

### Sweep

A scheduled per-tenant job on the cron tick — policy lifecycle, renewals,
routing, drafts, budgets, delegations. A sweep takes **at most `SWEEP_MAX` rows
per tick** (ADR-0050) so one tenant's backlog cannot starve the fleet; the
instalment sweep is the recorded exception. *(see file 07 §7)*

### Tenant

The unit of isolation and the customer of LYRA. One row in `core_tenants`,
carrying brand configuration, `policy_json` and `entitlements_json`. Every other
table carries `tenant_id`, and every query is scoped by `scoped(ctx, table)`.
The synthetic demo tenant is **Aldebaran Insurance**; the vendor organisation is
**goNXT**.

**Note:** `CLAUDE.md` and several specs refer to a helper `withTenant(db,
tenantId)`. **It does not exist** — the real helpers are `scoped`,
`scopedWithDeleted` and `assertTenant`. See file 07 §3.

### Tier

The abstraction callers use instead of a model name: `fast`, `standard`,
`reasoning`. Which model serves a tier depends on the deployment home and the
tenant's data-residency policy. *(see Model gateway, file 07 §8)*

### ULID

The identifier format for every primary key: a 26-character sortable string
stored in a `TEXT` column, generated by `id()` in
[`packages/db/src/ids.ts`](../../packages/db/src/ids.ts). Because ULIDs sort by
creation time, a higher id is a later row — useful when you have no timestamp to
hand.

### Workspace

A top-level area of the product that is **not** one of the five modules:
Distribution, LEDGER, Analytics, Compliance, Administration, Settings. The
distinction matters because module rules (no cross-module imports, event-bus
integration) apply to modules; workspaces are compositions over what modules and
`packages/core` own.

---

## Part B — Insurance and business vocabulary

You will meet these in tickets from users. LYRA's reference domain is insurance
distribution, so this is the vocabulary the demo tenant, the seeded data and
most module specifications speak.

### Binder / delegated authority

Written permission from an insurer for the distributor to underwrite and issue
policies on the insurer's behalf, within stated limits. A risk falling outside
those limits cannot be bound locally — it must be **referred**. LYRA records
these as `axis_referrals`. *(see Referral)*

### Bordereau (plural: bordereaux)

A periodic schedule sent between a distributor and an insurer listing every
policy written (a premium bordereau) or every claim handled (a claims
bordereau), with the money owed each way. Reconciling it is a monthly ritual.
LYRA has `axis_bordereaux` and `axis_bordereau_lines`; `raw_json` preserves each
inbound row verbatim so a disputed match can be re-checked against exactly what
the insurer sent. **Note:** the schema exists but the generation and
reconciliation code is not fully built out (docs/27).

### Cancellation

Ending a policy before its natural expiry, usually with a pro-rata or
short-rate premium refund. In LYRA this is a policy-version kind, not a delete —
`axis_policy_versions.kind = 'cancellation'`. Policies are delete-exempt
(ADR-0013); they change state.

### Claim

A demand for payment under a policy. Its money has three separate quantities
that people constantly confuse:

- **notified** (`amount_minor`) — what the claimant said it was worth
- **settled** (`settled_minor`) — what was agreed
- **incurred** — **never stored**; computed as `paid + reserve - recovered` by
  `incurred()` in [`packages/core/src/claims.ts`](../../packages/core/src/claims.ts)

### Clawback

Recovery of commission already paid, when the underlying policy is cancelled or
lapses inside a clawback window. In LYRA a clawback is a **new** entry pointing
at the entry it reverses — the original `dist_commission_entries` row is never
mutated.

### Client money

Premium held on behalf of a customer or an insurer that is **not** the
distributor's own money. It must be held separately and must never be used for
operating expenses. LYRA models this as an asset account `1010` against a
liability account `2010`, and runs `ledger_client_money_checks` with a
`CM-BREACH-FLAG`. A client-money breach is a regulatory event, not a bookkeeping
one — **escalate it, do not close the ticket**.

### Commission

The distributor's earnings on a sale. LYRA models three amounts on every sale
(`dist_commission_entries`): what the insurer owes us (gross), what we owe the
selling channel, and what we keep (net). Rates are effective-dated and
most-specific-wins; **rates are never edited** — a change closes one row and
opens another, so a dispute six months later can re-derive the rate that applied
on the sale date. Commission may be earned on issue or only on collection.
**LYRA supports flat rates only** — no tiers or sliding scales (docs/27).

### Complaint

A regulated expression of dissatisfaction, with a statutory response deadline.
In `axis_complaints`, `due_at` is the **regulatory** clock, not an internal SLA —
missing it is a compliance matter. States: received, investigating, awaiting
customer, resolved, escalated, closed.

### Deductible / excess

The first slice of a loss the policyholder bears themselves. Recovering it from
a third party appears in LYRA as a claim recovery.

### Double-entry journal

The accounting discipline underneath all LYRA money: every transaction posts a
**balanced batch** of journal lines where debits equal credits. Two properties
matter operationally:

- `ledger_journal_lines` are **immutable** — never updated, never deleted.
- A correction is a **new contra line**, never an edit.

Ledger invariants are enforced and **may not be relaxed to make a test pass**
([`CLAUDE.md`](../../CLAUDE.md) rule 12).

### DSAR (Data Subject Access Request)

A person exercising a data-protection right: access, rectification, objection or
erasure. SLA-tracked in `compliance_dsar_requests`, with a public intake form.
**Verification is staff-side** (ADR-0042) — a public request is recorded
*unverified* and a human must verify identity before anything is fulfilled.
Journey J-C4.

### Endorsement

A mid-term change to a policy — added driver, changed sum insured, corrected
address — usually with an additional or return premium. In LYRA, an endorsement
creates a new row in `axis_policy_versions`; the non-voided versions form a
contiguous, non-overlapping timeline with exactly one `effective` at a time.

### FNOL (First Notification of Loss)

The moment a customer first reports that something has happened. It opens the
claim and starts every downstream clock. LYRA has an FNOL triage eval suite
(`packages/model-gateway/evals/axis-fnol-triage`).

### Insurer / underwriter / provider

The party carrying the risk. LYRA calls them **providers** (`core_providers`)
because the same table also holds banks and financiers (horizon H9), and because
a tenant may underwrite its own products (`is_internal`). One provider's version
of a product — with its own pricing, eligibility and commission — is an
**offering** (`dist_offerings`).

### Lapse

A policy ending because premium was not paid. Distinct from cancellation
(a deliberate ending) and expiry (reaching the end of the term). LYRA moves
policies through these states on the clock via `sweepPolicyLifecycle`, not on a
user request.

### Line (of business)

The product category — motor, medical, travel, property. Used for commission
resolution, benchmarking and reporting. Support tickets often say "line" where a
consumer would say "type of insurance".

### NTU (Not Taken Up)

A quote that was accepted or issued but never paid for, so cover never began.
A distinct terminal state in LYRA, not a cancellation — the difference matters
for conversion metrics and for commission.

### Parametric

Cover that pays a fixed amount when a measurable trigger fires (rainfall below
a threshold, flight delayed beyond N hours), with no loss assessment. Reserved
in `core_products.structure` and `parametric_trigger_json` as a seam.
*(see Takaful)*

### PEP (Politically Exposed Person)

A person in a prominent public function, requiring enhanced due diligence.
Screened alongside sanctions. **LYRA's screening is a stub** — see below.

### Period close

Locking an accounting period so its figures stop moving. LYRA's `ledger_periods`
go `open → soft_closed → hard_closed`. After a hard close, a correction must be
a new entry in a later period — you cannot reach back.

### Policy

The contract of insurance. In LYRA, `axis_policies` is the **head row** — the
contract's identity and current headline figures — while `axis_policy_versions`
holds one row per priced state of that contract over time. Premium, start and
end on the head row are denormalisations of the currently effective version, and
are written only by the lifecycle endpoints. Policy states: `draft`, `bound`,
`active`, `lapsed`, `cancelled`, `expired`, `renewed`, `ntu`.

### Premium

The price of the cover. Held in minor units with a currency. Two limitations
you will hit: LYRA's premium accounting is **cash-basis only** — there is no
earned/unearned split (docs/27 F14) — and there is **no tax/fee split**, so a
premium is a single number (docs/27 F25).

### Recovery

Money coming back to the insurer or distributor after a claim has been paid:
subrogation (from the at-fault third party), salvage (from selling the damaged
item), the excess, or reinsurance. Held in `axis_claim_recoveries`; ADR-0033
adds account `1155` Recovery Receivable and `5450`.

### Reconciliation

Matching what our records say against what a counterparty's records say — the
insurer's statement, the bank's statement, the bordereau. In LYRA:
`ledger_recon_runs` and `ledger_recon_matches`, journey J-O3. **Two gaps to
know:** there is no bank-statement import (CAMT/MT940/OFX — docs/27 F16), and a
match decision currently posts no journal (docs/27 F19).

### Referral

A risk that falls outside the distributor's delegated authority and must be sent
to the insurer for a decision. `axis_referrals`. Not to be confused with a
*customer* referral in the marketing sense.

### Reinstatement

Bringing a lapsed or cancelled policy back into force, usually after the
outstanding premium is paid. A policy-version kind in LYRA.

### Renewal

Offering continuation of cover at the end of a term. LYRA holds **one renewal
row per policy per term** (`orbit_renewals`) — not one per policy — because a
policy renews every term and each term has its own outcome. Renewals are
generated by a nightly sweep and long work is handed to `RenewalWorkflow`.
Journey J-C3 ("renew in one tap"); ADR-0054 gives the retention desk permission
to bind its own renewal.

### Reserve

The insurer's current estimate of what an open claim will ultimately cost.
`axis_claim_reserves` is **append-only, enforced by database triggers**
(migration `0017`) — because a reserve you can edit in place cannot answer "what
did we think this was worth in March", which is exactly what reserve-adequacy
analysis and claims triangles are made of. `axis_claims.reserve_minor` holds the
sum of the latest movement per reserve head.

### Sanctions screening

Checking a person or entity against sanctions and PEP lists before transacting.
**In LYRA this is a stub** (ADR-0002): the stub matches only the literals
`lyra-test-hit` and `lyra-test-inconclusive`, and every hit it produces is
flagged `stub: true`. A real provider plugs into the `ScreeningProvider` seam.
Never tell a customer that a real screening has been performed.

### Settlement

Two related meanings, and tickets use both:

1. **Claim settlement** — the agreed amount paid to a claimant
   (`axis_claim_payments`; the unique index on `txn_id` makes paying a claim
   twice structurally impossible).
2. **Commercial settlement** — periodically paying a partner or insurer what
   they are owed (`ledger_settlements`). Because **LYRA has no PSP integration**,
   these rows carry `external_ref` and `paid_via`: the money moved somewhere
   else and LYRA records it.

### SIU (Special Investigations Unit)

The fraud investigation function. LYRA has both a lightweight flag
(`axis_claims.siu_state`) and a full investigation record
(`axis_siu_referrals`) with states open, investigating, substantiated,
unsubstantiated, closed. Do not discuss SIU status with a claimant.

### Subrogation

The insurer's right, after paying a claim, to pursue the party who caused the
loss. Recorded as a recovery. *(see Recovery)*

### Takaful

Sharia-compliant cooperative insurance, structurally different from conventional
insurance (participants contribute to a shared pool rather than paying premium
to a risk carrier). Reserved in `core_products.structure` and `takaful_json` as
a seam — the concept is modelled, the flows are not built.

### Whitespace

A product-or-market gap SCOUT has identified: something customers are asking for
that the panel does not cover, or a segment nobody is serving. Promoted
whitespaces feed the quarterly product review (journey J-P1).

---

## 3. Why the two vocabularies are kept apart

LYRA is built to sell outside insurance, so **industry nouns are never
hard-coded** in UI strings or system prompts
([`CLAUDE.md`](../../CLAUDE.md) rule 14). "Policy", "premium", "insurer" and
"claim" are not literals in the interface — they are resolved at label time from
the active **domain pack** through `labelsFor(spec, locale, pack?)` (ADR-0022).

The practical consequences for support:

- The same screen shows **"policy"** to an insurance tenant and **"order"** to a
  `retail_ecom` tenant. A screenshot from one tenant may not match another's
  wording, and that is correct behaviour.
- A ticket saying "the label is wrong" is usually a **domain-pack configuration**
  question, not a code defect.
- Column and table names in the database keep the insurance vocabulary
  (`axis_policies`, `premium_minor`) regardless of the tenant's pack. **The
  database speaks insurance; the interface speaks the tenant's language.**
- A domain pack may rename and restrict, but it may never weaken a compliance
  floor or remove audit, consent or approval behaviour.

Known limits: ADR-0022 defers bespoke labellers, **mobile i18n** and **prompt
vocabulary** — so the mobile app and AI system prompts do not yet get the full
substitution treatment.

Arabic terminology has its own reference:
[`docs/26-arabic-glossary.md`](../26-arabic-glossary.md). Note that no native
Arabic speaker has reviewed the `ar` catalogue yet (see file 08 §3.1).
