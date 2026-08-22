# 29 — Global launch readiness (code-read, 2026-08-21)

An earlier pass at this question answered it for the Gulf: VAT at 5%, ZATCA,
Emirates ID, takaful, Arabic. That was the wrong shape of answer. LYRA is sold
as a platform a business runs *inside* (docs/20), and a platform cannot be
regionalised by adding one more market to a list — the question is whether the
seams that decide "which market is this" exist and are load-bearing, or whether
today's single market is a literal in a code path.

This register reads the code as written, not the docs as promised, and cites
file:line. It is a findings document, not a plan; each G-item needs an ADR or a
spec update before it becomes work.

**The recurring defect shape.** Every blocker below is one of three things:

1. **A market baked into a code default.** `analytics.ts` defaulted a
   schedule's zone to the string `"Asia/Dubai"`, so a South African broker's
   daily report fired on Gulf wall-clock. Closed by `e314a7d`, which made the
   zone tenant policy and left `apps/web/app/region.guard.test.ts` behind to
   fail the next one.
2. **A dead seam.** A column or parameter declared, unit-tested green by direct
   call, reachable by nobody. `ledger_tax_rules` is the expensive instance
   (G1); `tenants.region` is the dangerous one (G4). This repo has now paid for
   the caller-by-caller version of this bug five times (see CLAUDE.md).
3. **A shape that cannot express another regime.** Not a missing value — a
   missing dimension. European insurance tax is one (G1): the applied rate is a
   single ppm, and no number can say "exempt, and a premium tax applies
   instead". US sales tax is the starker one (G2): no entry in a
   `market → rate` table is right, because the answer is a function of
   destination, nexus and product class.

The first two are cheap and are engineering. The third is design, and is where
the calendar time goes.

---

## G0 — What is genuinely ready to leave the Gulf

Worth stating first, because it is more than expected and it changes the plan:

- **Money is already multi-currency at the shape level.** Every posting stamps
  its own `fxRatePpm` (`packages/db/src/schema/ledger.ts:29,123`), rates are
  dated and sourced (`ledger_fx_rates`, seeded with `cbuae` and `ecb` rows at
  `packages/core/src/seed/ledger.ts:1536-1544`), and amounts are integer minor
  units throughout. Nothing has to be unpicked to add a currency.
- **Tax and FX are parameters, not literals, in the engines.** A rate reaches a
  posting as `taxPpm` from rate-table config through
  `apps/api/src/engines/rating.ts:169` and `packages/ledger/src/recipes.ts:48` —
  no engine contains a rate. The gap in G1 is the *model* (a bare number cannot
  say "exempt"), not the plumbing, which means G1 is a widening rather than a
  rewrite.
- **Formatting is locale-correct.** All 45 non-test `Intl.NumberFormat` call
  sites pass a locale; dates go through `<DateTime>`; RTL already covers `ar|fa|he|ur`
  (`apps/web/app/i18n.ts:13`); a pseudo-locale exists for finding unlocalised
  strings (`i18n.ts:17`). Logical CSS properties are enforced.
- **Vocabulary is pack-driven.** Domain packs (docs/21) mean "policy",
  "premium" and "insurer" are not hard-coded, so the same code sells in a
  market that calls them something else — and `labelsFrom(LABELS)` is now
  actually threaded to its call sites (`91d1085`).
- **The privacy model is GDPR-shaped, not bolted on.**
  `compliance_dsar_requests.type` is
  `access|erasure|rectification|portability|objection|restriction`
  (`packages/db/src/schema/compliance.ts:15`) — that is Chapter III enumerated.
  There is a per-table `erasure_log`, `retention_runs`, `legal_holds`, and
  `incidents.notifiableAt` is described in the schema as "regulator clock"
  (`compliance.ts:160`), which is the 72-hour Art. 33 obligation modelled as a
  column. `core_consents` is immutable-append with purposes, channel opt-ins,
  source, evidence and expiry (`core.ts:159-175`).
- **AI governance has the artifacts most vendors are missing.** `ai_runs.purpose`
  (`ai.ts:57`), a 7-year `ai_audit_log` (`core.ts:261`), `guardrailEvents`
  (`ai.ts:194`), `evals` gated in CI, approval required for anything
  `consequential: true`, and an `AutonomyEnvelope` seam
  (`packages/core/src/seams.ts:45`).
- **SLOs are computed, not asserted.** `GET /v1/platform/slo` reads real
  success/total counts per module over a window
  (`apps/api/src/routes/platform.ts:227-273`).

The gap is not the platform's bones. It is that four specific paths still know
exactly one country, and two regimes need a dimension the schema does not have.

---

## G1 — P0: two sources of tax truth, and the reachable one is a bare number

There are two tax models in the tree. They disagree, and the wrong one wins.

**The rich one is unreachable.** `ledger_tax_rules`
(`packages/db/src/schema/ledger.ts:439`) has the shape a VAT regime needs:
`market`, `code`, `ratePpm`, `placeOfSupply`, `reverseCharge`, `exempt`,
`effectiveFrom`, `effectiveTo`. The seed populates it thoughtfully — four `AE`
rows including a zero-rated export (`placeOfSupply: "OUTSIDE"`), an import
reverse charge and an exempt life product, plus the Saudi 5%→15% move modelled
as a superseded row and a current one, so restating an old period uses the rate
that applied then (`packages/core/src/seed/ledger.ts:1547-1620`). Somebody who
knew VAT designed this.

Nothing reads it. Its only non-seed surfaces are the CRUD registration
(`apps/api/src/resources.ts:892`) and the admin form
(`apps/web/app/modules/ledger.ts:1204-1222`). Grep for readers and the results
are the schema, the seed, and the seed's own test — a textbook dead seam, and
the table's own comment claims the opposite: "Tax treatment comes from the
rulepack, never inferred at posting time" (`seed/ledger.ts:1546`).

**The reachable one is a bare ppm.** What actually posts is `taxPpm`, threaded
cleanly from rate tables and product config through the rating engine
(`apps/api/src/engines/rating.ts:100,169`), the ledger recipes
(`packages/ledger/src/recipes.ts:48`) and commission
(`packages/core/src/commission.ts:28,56`), seeded as `50_000 // 5% VAT`
(`packages/core/src/seed.ts:522,583,594`). The plumbing is good — the rate is
configuration, not a literal in an engine, and it is editable per product. What
it cannot carry is *treatment*: there is no way to say exempt, zero-rated,
reverse-charged, or "this rate changed on 1 July".

**Why that is P0 rather than P1, and specifically for Europe.** Insurance
premiums are VAT-**exempt** in the EU and the UK. The tax that applies instead
is Insurance Premium Tax, at rates unrelated to VAT and varying widely by
country and by class — 12% UK standard and 20% on some motor, ~19% in Germany,
0% on life almost everywhere. A single `taxPpm` on a rate table can hold a
number but cannot say which tax it is, so an EU tenant has two options and both
are wrong: set it to zero and issue premiums with no IPT, or set it and have
the ledger post IPT to `2200 Tax Payable`
(`packages/db/src/chart-of-accounts.ts`) as though it were recoverable VAT.
Neither survives an audit. The seeded `VAT-EXEMPT-LIFE` row shows the model
already knows the distinction exists; the posting path cannot express it.

**Fix at the seam.** One `taxFor(ctx, { market, code, at, placeOfSupply })`
in `packages/ledger`, returning rate *and* treatment, with `taxPpm` becoming
the fallback when no rule matches and the four call sites above routed through
it. The reverse-charge and exempt cases then need a second journal shape, not
just a different number — a reverse charge posts no output tax at all and an
exempt supply posts none while blocking input recovery. That is the real work,
and the seeded rows are already the test fixtures for it.

Also note only `AE` and `SA` are seeded — and `market: "SA"` is **Saudi
Arabia**, not South Africa. `ZA` does not exist in the rulepack.

Blocks: the first EU or UK customer. A GCC or ZA customer on a flat rate is
served correctly by the current path.

## G2 — P0: two tax regimes need a dimension the table does not have

`market + code + placeOfSupply` is a VAT/GST shape. Two large markets are not
that shape:

- **United States.** There is no VAT. Sales tax is destination-based per state,
  county and city, with economic-nexus thresholds per state that depend on the
  seller's own revenue and transaction counts — so the rate is a function of
  (buyer address, seller nexus footprint, product taxability class), not of a
  market code. Insurance premium is usually outside sales tax and inside a
  state **premium tax** with its own surplus-lines treatment. Neither fits a
  row in `ledger_tax_rules`.
- **Brazil.** Federal, state and municipal taxes on the same invoice
  (ISS/ICMS/PIS/COFINS), with municipal rules for services.

This is a schema decision, not a data-entry task: either `ledger_tax_rules`
grows a jurisdiction hierarchy and a taxability class, or a
`TaxEngine`/`TaxProvider` seam is added alongside it (`seams.ts` is the
established place) and the US/BR implementations call an external engine while
the VAT markets stay in-table. Recommend the seam: the in-table version is
correct and cheap for ~40 VAT/GST markets and should not be distorted to
express Illinois.

Blocks: US and Brazil entirely. Does not block EU/UK/GCC/India/ZA.

## G3 — P0: invoice numbering cannot satisfy any e-invoicing regime

`invoiceNumber()` is `INV-YYYYMMDD-<last6ofId>`
(`apps/api/src/engines/billing.ts:8`). That is a readable reference, not a
statutory series. Every mandatory e-invoicing regime requires a gapless
sequential number per legal entity per series, and most require more:

| Regime | Needs |
| --- | --- |
| EU (ViDA, from 2030) + Peppol today | UBL/CII XML, network transport, structured party identifiers |
| Italy SdI | Clearance *before* the invoice is valid — the state is in the send path |
| Saudi ZATCA phase 2 | Signed XML, cryptographic stamp, QR, clearance API |
| India GST | IRP registration returning an IRN + signed QR |
| Brazil NF-e/NFS-e | Municipal/state authorisation per document |

None of the pieces exist: no XML generation, no clearance step, no signing key
material, no per-entity series counter, no QR. There is also no legal-entity
concept to hang a series on (G5).

Blocks: the first invoice in IT, SA (phase 2 scope), IN, BR. Recoverable in the
EU/UK/GCC-general case where a PDF invoice is still lawful — but note ViDA makes
this a dated obligation, not an optional integration.

## G4 — P0: `tenants.region` is a residency promise nothing enforces

`tenants` carries `region` and `dbBinding`
(`packages/db/src/schema/core.ts:14`). Exactly one line in the product reads
either: `apps/api/src/routes/me.ts:67` returns `region` to the client. No query
router, no binding resolution, no test.

So the platform can *display* a residency commitment it does not keep. Under
GDPR that is the transfer question (Art. 44-49 and the Schrems II transfer
impact assessment); under India DPDP, PIPL and several Gulf sector rules it is a
hard localisation requirement. A tenant told "your data stays in the EU" whose
rows sit in the default D1 is a contractual breach and, if it is in a DPA, a
notifiable one.

Two acceptable outcomes, both requiring an ADR: make `dbBinding` load-bearing
in `withTenant` so the region actually routes, or delete both columns and stop
implying the capability. Shipping the current middle state is the worst of the
three.

Adjacent and missing: no subprocessor register table, no SCC/TIA record, no
per-purpose lawful basis field (`grep lawfulBasis` returns nothing across
`packages/`), and therefore no Art. 30 record of processing. `core_consents`
holds purposes per customer, which is consent-as-basis only — it cannot express
legitimate interest or contractual necessity, which is what most underwriting
processing actually runs on.

## G5 — P1: the tenant is the only boundary; there is no legal entity

`grep legalEntity|entityId|intercompany` across `packages/db/src/schema` returns
nothing. A multi-country business is a group of entities, and several
obligations attach to the entity rather than the tenant: the invoice series
(G3), the VAT registration, the statutory accounts, the insurance
authorisation (G6), the functional currency.

Compounding: `CHART_OF_ACCOUNTS` is a hard-coded TypeScript constant with
en/ar account names (`packages/db/src/chart-of-accounts.ts:19-72`). A French
tenant reports on the *plan comptable général*, a German one on SKR03/04, and
neither can map onto a constant compiled into `packages/db`. The seed's base
currency is likewise a literal, `const BASE = "AED"`
(`packages/core/src/seed/ledger.ts:41`).

Also absent: reporting-currency translation and the cumulative translation
adjustment, period-end revaluation, intercompany elimination, and any revenue
recognition treatment (IFRS 15 / ASC 606) distinct from cash. The ledger is a
correct double-entry engine; there is still no accounting department around it,
which docs/27 said in August and remains true at group level.

Blocks: the second legal entity. Does not block a single-entity pilot in any
market.

## G6 — P1: no authorisation register, and AXIS's core use case is EU high-risk

What exists is the complaints clock — `axis_complaints.dueAt` described as "the
regulatory clock, not an SLA", with a `regulatorRef`
(`packages/db/src/schema/axis.ts:538,562`). That is the right instinct.

What does not exist is any record of *what the tenant is allowed to do where*.
`markets` appears once in the whole codebase, on product eligibility:
`markets: ["AE"]` (`packages/core/src/seed.ts:545`). That single field is the
seam to build on — a licence/authorisation register per entity per market per
line of business, checked before a quote is bindable.

Per-market shapes needed on top: IDD demands-and-needs and product-oversight
records plus Solvency II reporting (EU); FCA consumer-duty outcome evidence
(UK); state-by-state licensing and surplus-lines eligibility (US, and note NAIC
is model law — the obligation is per state); IRDAI (India); SUSEP (Brazil).

**The EU AI Act item is the one to plan around, not react to.** Insurance
risk-assessment and pricing for life and health is Annex III high-risk. AXIS
does exactly that. LYRA already holds most of the evidence a conformity
assessment asks for — purpose-tagged runs, a 7-year audit log, evals with
thresholds in CI, guardrail events, approval gates on consequential actions,
an autonomy envelope. What is missing is thin by comparison: a risk
classification on each deployed agent, a technical-documentation artifact per
agent (Art. 11), a human-oversight record distinct from the approval row, and
consumer-facing AI disclosure inside ORBIT's outbound message bodies rather
than only as the UI's ✦ marker. That is a quarter of work on a platform that
was built for it, versus a rebuild for one that was not — worth saying out loud
in a sales conversation.

## G7 — P1: money can be recorded but not collected, anywhere

There is no PSP connector in the tree. `settlement.ts` is honest about it:
`PAID_VIA = ["bank_transfer", "psp", "other"]`, and the v1 control is a
human-confirmed bank/PSP reference — "No PSP connector exists here …
credential-gated, out of scope" (`apps/api/src/engines/settlement.ts:45-53`).
Claim payment method is `eft|cheque|card|insurer_direct`
(`apps/api/src/engines/axis-claims.ts:53`, defaulting to `eft` at
`packages/db/src/schema/axis.ts:408`). `ledger_payments` is written only by the
seed. A `mandates` resource exists (`resources.ts:139`) with no rail behind it.

So collection is out-of-band in every market equally — which means this is not
a *regionalisation* gap so much as a missing capability that regionalises
badly, because the rails are per-region and each carries its own regulatory
surface:

| Region | Rail | Regulatory surface |
| --- | --- | --- |
| EU | SEPA DD / SCT Inst | PSD2 strong customer authentication, mandate storage |
| UK | Bacs DD, Faster Payments | Service User Number, AUDDIS |
| US | ACH, RTP | Nacha authorisation rules |
| India | UPI, NACH | NPCI rules |
| Brazil | PIX | Central bank scheme |
| South Africa | DebiCheck debit order | Authenticated mandate |
| E/W Africa | Mobile money | Per-operator |

`ChannelAdapter` (`seams.ts:149`) is the pattern to copy: one `PaymentRail`
interface, one adapter per rail, mandate storage generic, and the recurring
`consequential: true` approval already covers the outbound leg. Do the seam
before the first adapter, or the first adapter becomes the seam.

## G8 — P2: adding a locale means rewriting copy, not translating it

`CATALOGUES = { en, ar }` (`apps/web/app/i18n.ts:8`). Adding a third is
mechanically easy and the RTL and formatting work is already done (G0). The
non-obvious cost is that **the product deliberately contains no pluralised
string.** Roughly eight call sites carry the same comment — "a count needs a
plural rule per locale" — and are written to avoid a count in the sentence
(`apps/web/app/routes/home.tsx:68`,
`apps/web/app/routes/axis-exceptions.tsx:92,294`,
`apps/web/app/routes/north-board.tsx:56`,
`apps/web/app/routes/axis-quote-desk.tsx:79`,
`apps/web/app/routes/north-anomalies.tsx:94`, and a test asserting it at
`north-board.test.ts:77`).

That was a defensible v1 choice — Arabic has six plural categories and getting
it wrong reads worse than omitting the number. It is not free: every
count-bearing sentence in the product is phrased around a hole, which caps how
natural the AI narration can sound, and the ambition in docs/15 is prose. The
fix is small and unblocks all of it: an `Intl.PluralRules`-backed `plural()`
helper in `packages/ui`, catalogues keyed by CLDR category, and the eight
comments deleted.

Also thin for a global launch: `core_users.phone` is a bare `text`
(`core.ts:29`) with no E.164 normalisation or country validation, and there is
no structured address anywhere — a Japanese or Brazilian address will not render
correctly from a single blob, and address is what a rating engine needs to be
structured.

## G9 — P2: follow-the-sun operations

The technical side is in place: computed SLOs (`platform.ts:252`), read-only
live e2e against production, `/health`. What a multi-country customer asks for
beyond that is organisational and mostly missing: a public status page, an
on-call rotation across time zones, localised trust artifacts (SOC 2 Type II,
ISO 27001 and 27701, a DPA in the local language, a published subprocessor
list, a recent penetration test), and support hours per region. None of it is
code; all of it is a procurement blocker, and the SOC 2 observation window is
long enough that starting it late sets the launch date.

---

## What this means for sequencing

Grouped by what a region actually needs to take its first paying customer:

**Any market outside the UAE, first invoice:** G5 to the extent of one legal
entity per tenant with its own invoice series and functional currency, and a
rulepack row for the local rate. A flat-rate VAT/GST market (GCC, ZA, most of
APAC) is otherwise served by the current path.

**EU/UK, first customer:** G1 in full — exempt-and-IPT is not a rate change,
it is a second journal shape — plus G4 (residency made real or the columns
deleted, plus lawful basis and ROPA), G6's AI Act documentation set, and G7 for
SEPA/Bacs. Peppol (G3) can trail; ViDA cannot be ignored past 2030.

**US, first customer:** G2 as a design task before anything else — plus the
state licensing matrix in G6 and ACH in G7. This is the most expensive region
and should not be first.

**India/Brazil:** G3 in full (IRN/NF-e are in the send path, not reporting) plus
G2 for Brazil.

**Everywhere:** G8's plural helper is a week and improves the product in the
two locales that already ship.

The honest summary: LYRA's bones are unusually well suited to a multi-country
launch — dated FX on every posting, locale-correct formatting, a GDPR-shaped
compliance model, and AI governance artifacts that the EU AI Act happens to
ask for. Three paths still know exactly one country (residency, invoice
numbering, collection) and are the dead-seam bug this repo already knows how to
fix. Three more need a dimension the current model lacks — tax *treatment* for
Europe, tax *jurisdiction* for the US, and a legal entity to hang a statutory
series on. Those three are design work, and they are what a launch date should
be built around.
