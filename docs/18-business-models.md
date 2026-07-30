# 18 — Business Models: YallaCompare Today, Tomorrow, and the Generic Case

Lyra is built to run the business model YallaCompare has now, the models it is
moving toward, and the models a completely different company (a retailer, a
telco, a bank) would run on the same spine. Every revenue line below maps to
modules, to transaction types in `docs/19`, and to ledger accounts — so
"business model" is not strategy prose, it is wired.

Figures are deliberately absent: shapes and mechanics are what the platform
must support. Actual rates, splits and volumes are tenant configuration.

## 1. YallaCompare current model (what must work on day one)

| # | Revenue line | How it earns | Modules | Transaction types |
|---|---|---|---|---|
| C1 | **Insurance commission — motor** | Percentage of premium placed with a panel insurer; renewal commission on retention | AXIS, ORBIT | `BIND`, `CMSN-ACCR`, `CMSN-SETL`, `RENEW` |
| C2 | **Insurance commission — health (individual)** | Commission on placed individual medical | AXIS, ORBIT | as C1 |
| C3 | **Group & SME medical brokerage** | Commission and/or advisory fee on group schemes; census-driven, human-led | AXIS, SCOUT | `BIND-GROUP`, `FEE-BROK`, `ENDORSE` |
| C4 | **Travel, home, life and niche lines** | Commission on lower-volume lines | AXIS | as C1 |
| C5 | **Banking product referrals** | Cost-per-lead / cost-per-approved-account for cards, loans, accounts | SIGNAL, ORBIT | `REFERRAL-QUAL`, `REFERRAL-SETL` |
| C6 | **Affinity & embedded partnerships** | Revenue share with auto, telco-rewards and mobility partners distributing cover | ORBIT | `PARTNER-BIND`, `RSHARE-ACCR`, `RSHARE-SETL` |
| C7 | **Sponsored placement / advertising** | Paid visibility, subject to mandatory disclosure and declared ranking criteria | SIGNAL, AXIS | `AD-PLACEMENT`, `DISCLOSURE-PRESENT` |
| C8 | **Multi-market operation** | Same lines run in additional MENA markets under local rulepacks | all | market-scoped variants of the above |

**Cost structure the platform must attack:** assisted (call-centre) closing
minutes per policy, paid acquisition per bound policy, manual document handling,
manual reconciliation, and management reporting lag. Each maps to an AXIS,
SIGNAL, or NORTH capability with a measured target in `docs/17`.

## 2. YallaCompare future model (what the platform must not need rebuilding for)

| # | Revenue line | Mechanic | Modules | Transaction types | Seam |
|---|---|---|---|---|---|
| F1 | **Embedded insurance-as-a-service** | Quote-and-bind APIs inside partner apps; per-bind revenue share | ORBIT, AXIS | `PARTNER-QUOTE`, `PARTNER-BIND`, `RSHARE-*` | — |
| F2 | **Whitelabel platform licensing** | License Lyra modules to insurers/banks/telcos: platform fee + seats + usage | all | `SUB-INVOICE`, `SUB-RECOG`, `USAGE-METER`, `OVERAGE` | H10 |
| F3 | **Data & insight products** | Consented, k-anonymised demand/elasticity/coverage-gap subscriptions for insurers | SCOUT | `DPROD-SUB`, `DPROD-DELIVER`, `DPROD-RECOG` | — |
| F4 | **Premium financing / pay-monthly** | Financier funds premium; we earn financing commission and service the plan | AXIS, ORBIT | `PLAN-CREATE`, `PLAN-INSTALMENT`, `FIN-CMSN`, `DUNNING` | H9 |
| F5 | **Usage-based & telematics products** | Behavioural inputs price the risk; partner data feeds; declared inputs only | SCOUT, AXIS | `TELEM-INGEST`, `UBI-REPRICE` | H6 |
| F6 | **Parametric micro-cover** | Index-triggered products (flight delay, weather, device) with fast payout | SCOUT, AXIS | `PARAM-TRIGGER`, `PAYOUT-INSTRUCT` | H7 |
| F7 | **Takaful-native lines** | Wakala-fee structures, surplus rules, Shariah review lane | AXIS, ORBIT | `BIND` with `structure=takaful`, `SURPLUS-DIST` | H8 |
| F8 | **Subscription memberships** | Bundled recurring services (roadside, teleconsult, wellness) sold alongside cover | ORBIT, AXIS | `MEMB-SUB`, `MEMB-RECOG`, `MEMB-CANCEL` | — |
| F9 | **Claims concierge & service fees** | Fee-based assistance (guidance and orchestration only, never adjudication) | ORBIT, AXIS | `FEE-SERVICE`, `FNOL-REGISTER` | — |
| F10 | **Agentic commerce channel** | Customers' own AI agents transact against signed machine-readable offers under mandates | ORBIT, AXIS | `MANDATE-REGISTER`, `AGENT-QUOTE`, `AGENT-BIND` | H1 |
| F11 | **Extension marketplace** | Third-party tools/connectors distributed with revenue share | DEV platform | `EXT-INSTALL`, `EXT-RSHARE` | H10 |
| F12 | **Renewal-book economics** | Retention as an asset: portfolio value, book transfer, cohort valuation | ORBIT, NORTH | `RENEW`, `BOOK-VALUATION` | — |
| F13 | **Open-finance-enabled personalisation** | Consented bank/insurance data improves offers and affordability | ORBIT, SIGNAL | `DATAIN-CONSENT`, `DATAIN-PULL` | H4 |
| F14 | **Regional scale via rulepacks** | New markets as versioned regulatory data, not forks | all | market-scoped | H12 |

## 3. The generic case (any company, any industry)

The same spine sells outside insurance because the platform's primitives are
industry-neutral. Domain packs (`docs/21`) alias the vocabulary; nothing in the
core assumes a policy.

| Primitive | Insurance | Retail / e-commerce | Telco | Bank | Healthcare | Real estate |
|---|---|---|---|---|---|---|
| Contract object | Policy | Order / subscription | Plan / line | Product / account | Care plan / episode | Lease / mandate |
| Case | Quote-to-bind | Order-to-fulfil | Activation / fault | Application | Referral / auth | Listing-to-let |
| Renewal | Policy renewal | Replenishment | Contract renewal | Rollover | Follow-up | Lease renewal |
| Panel | Insurer panel | Supplier catalogue | Device/tariff mix | Lender panel | Provider network | Landlord panel |
| Commission | Insurer commission | Merchant margin | Dealer commission | Referral fee | Fee-for-service | Agency fee |
| Whitespace | Coverage gap | Assortment gap | Bundle gap | Product gap | Service gap | Segment gap |

**Standalone monetisation shapes** (all supported by `docs/19` billing
transactions): per-seat, per-conversation, per-case, per-published-post,
per-1k-AI-tokens, per-bind, per-report, flat platform fee, and success fee tied
to a verified metric (the goNXT equity model runs on this last one, verified in
NORTH).

## 4. Revenue-line → ledger mapping (summary; detail in docs/19 §5)

| Revenue line group | Income accounts | Key receivable/liability |
|---|---|---|
| Commissions (C1–C4, F7) | `4000` new, `4010` renewal | `1100` Commission Receivable |
| Brokerage & service fees (C3, F9) | `4020`, `4090` | `1160` Trade Receivable |
| Referrals (C5) | `4030` | `1160` |
| Partner / embedded (C6, F1) | `4000` gross with `5400` share out | `1100`, `2100` Partner Payable |
| Advertising (C7) | `4070` | `1160` |
| Platform licensing (F2) | `4040` subscription, `4050` usage | `2300` Deferred Revenue |
| Data products (F3) | `4060` | `2300` |
| Financing (F4) | `4080` | `1150` Financier Receivable |
| Memberships (F8) | `4045` | `2300` |
| Marketplace (F11) | `4075` | `2100` |

## 5. What this implies for the build (non-negotiables)

1. **Commission-only and premium-collecting models must both work**, because
   YallaCompare operates the first and the regulated broker future may require
   the second — client-money segregation is therefore core, not optional.
2. **Recurring revenue needs deferred-revenue accounting** from day one, or the
   whitelabel and data-product models cannot be reported honestly.
3. **Revenue share must be computed at transaction level**, not spreadsheet
   level, or embedded partnerships do not scale past a handful of partners.
4. **Every model above must be measurable in NORTH** with the same metric
   definitions finance uses — one version of the numbers, including revenue.
5. **Success-fee billing requires verified metrics**, so the metric layer is a
   commercial dependency, not just a reporting nicety.
