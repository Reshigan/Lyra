# 21 — Editions, Packaging & Vertical Domain Packs

One codebase must sell five different ways: as the full suite to a comparison
platform like YallaCompare, and as a single standalone product to a company that
only wants (say) conversational automation. This document defines the editions,
the entitlement mechanics, and the domain-pack layer that makes the platform
industry-neutral without forking.

## 1. Editions

| Edition | Contains | Sold to | Headline promise |
|---|---|---|---|
| **Lyra Core** | spine: identity, RBAC, tenancy, consent, files, events, model gateway, ledger, analytics & reporting fabric, admin, dev portal | included in every edition | governed AI infrastructure |
| **Lyra Bots** | ORBIT | any company wanting conversational automation & service | "every conversation handled, in any language, 24/7" |
| **Lyra Ops** | AXIS | regulated/document-heavy back offices | "the back office as a production line" |
| **Lyra Social** | SIGNAL (incl. docs/20 engine) | marketing teams replacing a stack of tools | "run all marketing in one place" |
| **Lyra Radar** | SCOUT | product & strategy teams | "see the gap before it is priced" |
| **Lyra Insights** | NORTH | executives, boards, investors | "the whole business, narrated daily" |
| **Lyra Suite** | all five | aggregators, brokers, insurers, banks, telcos | the operating system |

**Bundles** (pre-priced combinations, still just entitlements): *Growth* =
Social + Radar · *Service* = Bots + Ops · *Command* = Insights + Radar ·
*Distribution* = Ops + Bots (the YallaCompare starting core).

## 2. Entitlement mechanics (how standalone actually works)

- `entitlements_json` on the tenant lists licensed modules, seat counts, usage
  allowances and feature flags. The gateway enforces; the UI reads the same
  object, so an unlicensed module is not merely hidden — its routes 403.
- **Seams dormant, not broken.** Integration-tagged capabilities (`[∫X]`) check
  entitlement at render and at call time. When absent, the UI shows the
  standalone path plus a single, non-nagging note explaining what the integrated
  path would add. Never an error, never a dead button, never a silent no-op.
- **No data migration on upgrade.** Because seams and schema fields already
  exist (docs/16), licensing an additional module lights up integrated behaviour
  on the next request. Upgrading is a billing event, not a project.
- **Downgrade is safe.** Removing an entitlement stops new integrated behaviour
  and retains historical records read-only, with an explicit banner.
- Trials: time-boxed entitlement with automatic reversion and data retention
  policy stated up front.

## 3. Domain packs (industry neutrality without forks)

A domain pack is versioned configuration — no code — that maps Lyra's
primitives onto an industry's language and rules.

```
domain_pack:
  key: retail_ecom
  vocabulary:            # UI + AI vocabulary
    contract: "order"
    contract_plural: "orders"
    case: "order issue"
    renewal: "replenishment"
    panel: "supplier catalogue"
    commission: "margin"
  entities:              # aliasing onto core objects
    policy -> order
    provider -> supplier
    premium -> order_value
  journeys: [welcome, abandoned_cart, delivery_issue, winback, review_request]
  metrics: [aov, repeat_rate, cac, contribution_margin, nps]
  rulepacks: [consumer_protection_ae, marketing_ae]
  tools_enabled: [order_lookup, returns_initiate, delivery_track, ...]
  compliance_floors: {quiet_hours, frequency_caps, disclosure_templates}
```

Shipped packs (v1): **insurance_distribution** (the YallaCompare reference),
**banking_products**, **telco**, **retail_ecom**, **healthcare_services**,
**real_estate**, **travel**, **education**, **b2b_services**. Each includes
default journeys, tool set, metric registry entries, report templates and a
seeded demo dataset so a standalone demo takes minutes.

Rules: a domain pack may rename and restrict, **never** weaken a compliance
floor, and never remove audit, consent or approval behaviour. Packs are
versioned and diffable; switching packs on a live tenant requires a migration
plan (vocabulary changes are safe, entity remapping is not).

## 4. Standalone reference: "Lyra Bots" (the worked example)

A company with no insurance concepts licenses ORBIT + Core with the
`retail_ecom` pack and gets:

- Channels (web widget, WhatsApp, IG/FB DMs via SIGNAL-free direct connector,
  email), agentic conversations with tool calls into *their* systems via the
  connector framework, human handover console, supervisor wall.
- Bot Builder: flows, persona, tools, knowledge base, test console with scripted
  personas, staged deploy (draft → sandbox → live) and one-click rollback.
- Their own admin (channels, personas, guardrails, QA rubric) and dev console
  (keys, simulator, webhooks, logs).
- Full analytics and scheduled reports; ledger-backed billing on
  per-conversation or per-seat metering (`USAGE-METER`).
- Zero insurance vocabulary anywhere in UI or AI output.
- Upgrade path: license Lyra Social and the same bot starts answering social
  comments with campaign context; license Lyra Insights and the same metrics
  appear in an executive brief.

Equivalent standalone stories are documented per edition in the go-to-market
appendix (`docs/21a`, to be written with commercial).

## 5. Deployment shapes

| Shape | Who | Notes |
|---|---|---|
| Multi-tenant SaaS | most tenants | fastest onboarding, shared spine |
| Dedicated database | enterprise/regulated | same schema, isolated store |
| Single-tenant cloud | data-sensitive | separate account/namespace |
| On-prem / private cloud (docs/11) | banks, insurers, government | Docker stack + internal model |
| Air-gapped | highest sensitivity | offline images, weights, licence file |

Whitelabel applies to every shape: brand tokens, domain, email identity, and
optionally a branded mobile build.

## 6. Pricing shapes (mechanics, not rates)

Platform fee + seats + usage + optional success fee. Metered units by edition:
Bots = conversations/resolutions; Ops = cases/documents; Social = posts +
managed ad spend + assets; Radar = monitored sources + dossiers; Insights =
briefed executives + connected sources; plus AI tokens across all. Every unit is
a `USAGE-METER` transaction (docs/19 §4.5), so invoices are reconstructible from
the ledger rather than estimated. Success fees require a NORTH-verified metric
snapshot — the mechanism the goNXT equity model depends on.

## 7. Build obligations this creates

1. Vocabulary must come from the domain pack at render and prompt time; no
   hard-coded domain nouns in UI strings or system prompts (lint + review).
2. Every module's demo dataset must exist per shipped pack.
3. Entitlement checks are tested per module for both the licensed and unlicensed
   paths (the "seam dormant" behaviour is a test, not a hope).
4. A packaging matrix test asserts every edition boots, seeds, and passes its
   own smoke journeys with all other modules disabled.
