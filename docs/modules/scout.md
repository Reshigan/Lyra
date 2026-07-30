# Module Spec — LYRA SCOUT (AI Products)

"Find the gap before it's priced." SCOUT is automated product intelligence:
it fuses market exhaust (search, reviews, news, regulation) with the tenant's
own demand data (quotes, abandonment, lost reasons) to surface whitespaces,
benchmark the provider panel, and validate new products with live experiments.
Standalone-sellable to product & strategy teams at insurers, banks,
marketplaces.

## 1. Personas

Head of Product · Product Manager · Panel/Provider Manager · Strategy Analyst ·
SCOUT Module Admin · Developer (data feeds).

## 2. Capabilities

### 2.1 Signal ingestion & clustering
- Sources: internal (quote requests, funnel abandonment with reasons, lost-
  quote reasons from AXIS, conversation themes from ORBIT QA summaries),
  external (search-trend connectors, app/review scraping via Browser
  Rendering, news/regulatory RSS, competitor page monitors with diff alerts).
- Everything embedded (Vectorize) and clustered weekly; clusters get momentum
  scores (volume × growth × novelty) and human-readable theme cards.

### 2.2 Whitespace radar
- Candidate whitespaces auto-drafted from clusters: description, evidence
  links, demand estimate (triangulated), competition score, regulatory notes
  (flagged for counsel — never asserted as cleared).
- Kanban lifecycle: candidate → validating → validated → parked, with owner
  and decision log; quarterly Radar report auto-assembled (feeds NORTH).
- v1 seeded playbooks: EV motor cover, gig-worker packages, SME cyber,
  micro-travel, domestic-helper insurance — as template hypotheses to test,
  not conclusions.

### 2.3 Panel & price intelligence
- Continuous benchmark from AXIS quote outcomes: win rate, price index vs
  panel median, coverage-term diffs (LLM-extracted from policy wordings),
  decline patterns per provider×line×segment.
- Negotiation packs: one-click evidence bundle for provider meetings
  ("your win rate fell 9pts in 30–40 age band at +8% price index").

### 2.4 Product experiment engine
- Launch a test offer as a hosted landing experiment (reuses SIGNAL's page
  engine + a capped traffic plan); measures qualified demand (quote starts,
  waitlist, deposits where legal) — with a mandatory "not yet available"
  honesty banner template; results auto-append to the whitespace card.

### 2.5 Data products (insight-as-revenue)
- Package anonymised, consent-based aggregates (demand curves, elasticity,
  coverage-gap maps) as subscriptions for providers; k-anonymity threshold
  enforced (suppress cells < k=20); delivery via API or scheduled report;
  consent basis recorded per product (`scout_data_products.consent_basis`).

## 3. Agents & automations

| Agent | Trigger | Tier | Consequential? |
|---|---|---|---|
| Harvester | schedules per source | fast | no |
| Clusterer | weekly | standard | no |
| Whitespace Drafter | cluster momentum > θ | reasoning | no (drafts) |
| Wording Differ | new policy doc | standard | no |
| Bench Builder | nightly | fast | no |
| Experiment Analyst | traffic threshold | reasoning | no (recommends) |

## 4. Screens

1. **Radar** — polar/quadrant visual of whitespaces (demand × competition),
   theme cards, momentum sparkline; click-through to evidence.
2. **Whitespace Card** — the dossier: evidence, estimates, regulatory flags,
   experiment results, decision log, promote/park actions.
3. **Panel Bench** — provider×line matrix (win rate, price index, coverage
   diffs), trend drill, negotiation-pack export.
4. **Experiments** — live tests with demand funnels and spend caps.
5. **Data Products** — catalogue, subscribers, k-anonymity monitor, delivery
   logs.
6. **SCOUT Admin** — source manager (add/enable connectors, crawl politeness
   settings, robots compliance), momentum thresholds, k-anonymity floor,
   template hypotheses library, export policies.
7. **SCOUT Dev** — feed API keys (ingest custom signals), connector SDK docs
   + test harness, webhook tester, embedding-search playground.

Mobile: Radar view, whitespace approvals (promote/park), bench alerts
("Provider X win rate dropped 10pts").

## 5. Self-contained toolset

Connector framework + built-ins (RSS, sitemap-diff, review sources, CSV/API
ingest) · clustering + scoring · dossier builder · experiment pages (bundled
mini page-engine if SIGNAL absent) · report scheduler · k-anon aggregator.
Standalone with core spine; internal-demand features light up only when
AXIS/ORBIT present.

## 6. Data / API / Events

Tables `scout_*` · routes `/v1/scout/*` · emits `scout.whitespace.promoted`,
`scout.bench.updated`; consumes `axis.quote.added` (win/loss),
`orbit.conversation.closed` (theme summaries).

## 7. KPIs

Whitespaces validated/quarter · signal-to-dossier lead time · bench coverage
(% of quote volume benchmarked) · negotiation packs used & commission delta ·
data-product ARR · experiment cycle time.

## 8. Acceptance criteria (v1)

- Cold start: from tenant's 12-month quote export alone, produce a first Radar
  with ≥ 5 evidenced whitespace candidates.
- Wording differ catches a seeded coverage-term change between two policy PDFs.
- k-anonymity: any aggregate with a cell < 20 is suppressed (unit test).
- One negotiation pack generated end-to-end and rendered to PDF.
