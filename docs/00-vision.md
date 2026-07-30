# 00 — Vision & Product Strategy

## The one-paragraph pitch

Financial-services distributors (aggregators, brokers, banks, embedded partners)
run on three expensive things: human minutes per transaction, paid acquisition,
and lagging management information. LYRA replaces all three with governed AI:
an operations factory (AXIS), an always-on customer & partner layer (ORBIT), a
self-optimising growth engine (SIGNAL), a market-sensing product radar (SCOUT),
and a narrated executive brain (NORTH) — on one data spine, sellable together as
an operating system or separately as products, under any brand.

## Design principles

1. **Observatory metaphor.** The platform watches everything (data spine), and
   each module is an instrument pointed at one domain. UI language: sky, signal,
   constellation, horizon. Never gimmicky — the metaphor guides naming and
   iconography, not copywriting on every button.
2. **Standalone-first modules.** Each module must demo, sell, deploy and bill on
   its own. Shared core is invisible plumbing, not a prerequisite purchase.
3. **Whitelabel is a config, not a fork.** Tenant = brand + domain + policy +
   entitlements. Zero code per new tenant.
4. **Human-governed AI.** Agents draft, humans decide on consequential actions.
   Every model action is explainable, logged, and attributable.
5. **Two homes, one behaviour.** Cloud (Cloudflare) and on-prem (Docker + internal
   LLM) run the same code paths; capability flags degrade gracefully (e.g. smaller
   context window on-prem).
6. **Compliance as product.** PDPL consent, CBUAE broker controls, audit-on-demand
   are features with UI, not paperwork.

## Who buys what (commercial shapes)

- **Aggregator/broker (e.g. YallaCompare):** full OS. Value: cost-per-policy down,
  retention up, exec visibility.
- **Insurer:** AXIS (ops factory) + SCOUT (market intelligence) standalone.
- **Bank/telco/super-app:** ORBIT embedded APIs + SIGNAL.
- **Any enterprise:** NORTH standalone (Atheon-class exec intelligence).
- **Whitelabel partner:** any module under their mark; per-tenant billing:
  platform fee + usage (AI tokens, seats, API calls) + success fees where agreed.

## Success metrics (platform-level North Stars)

- Handling time per policy (AXIS): −40–60% vs baseline
- Renewal retention (ORBIT): +10–15pts
- Blended CAC (SIGNAL): −25–40%
- Validated new products/year (SCOUT): 2–3
- Exec brief engagement (NORTH): daily open rate > 70% of licensed execs
- Platform: time-to-new-tenant < 1 day; uptime 99.9%; zero cross-tenant incidents

## Out of scope (v1)

- Claims adjudication (we guide FNOL, we do not decide claims)
- Direct payment processing (integrate PSPs; never store PANs)
- Core policy administration for insurers (we orchestrate, not replace PAS)
- Consumer lending decisioning
