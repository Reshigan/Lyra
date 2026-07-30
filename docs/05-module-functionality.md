# 05 — Module Functionality Reference (comprehensive)

This is the master functional breakdown. For each module: its **subsections**
(the navigable areas of the product), and within each — features, where AI
sits, the analytics & reporting it produces, and how it behaves **standalone
vs. integrated**. Two rules hold everywhere:

- **Standalone-complete:** every module runs on the Core spine alone
  (identity, RBAC, files, model gateway, events, audit, consent). Nothing in
  another module is a prerequisite.
- **Compose-on-contact:** when another module is present, defined
  **integration seams** light up automatically (no config, no rebuild). Each
  subsection notes its "solo" and "with X" behaviour. The seam catalogue is
  §0.4.

Depth markers used below: `AI` = model-driven capability · `AN` = analytics
surface · `RP` = report/exportable artifact · `ADM` = admin/config ·
`DEV` = developer/API surface · `∫` = integration seam.

---

## 0. Cross-cutting fabric (shared by all modules)

These are Core capabilities every module renders inside its own UI, so a
standalone module still has analytics, reporting, automation and governance.

### 0.1 Analytics fabric (Observatory Analytics)
- **Metric layer** (owned by NORTH when present, embedded-lite otherwise): every
  module publishes metrics to a shared semantic registry so a number means the
  same thing everywhere. `AN`
- **Explore**: pivot/segment/cohort builder over any module's read-models;
  saved explorations; compare-to-period, compare-to-cohort, compare-to-target.
- **Dashboards**: per-role default boards + user-built boards; tiles = stat,
  timeseries, funnel, distribution, table, map, breakdown; live via SSE with
  the twinkle refresh. `AN`
- **Anomaly & forecast primitives**: seasonal baselines, change-point
  detection, and simple forecasts available to any module's metrics. `AI` `AN`
- **Natural-language analytics**: ask a question in words → compiled to a
  visible, editable query (never a black box). `AI`
- **Warehouse-out**: scheduled Parquet to R2 / customer warehouse; BI
  connector (read-only) for Power BI / Looker / Metabase. `DEV`

### 0.2 Reporting fabric
- **Report Studio**: drag blocks (narrative, chart, table, KPI wall, image) →
  branded PDF / XLSX / CSV / PPTX; scheduled delivery (email, R2, webhook,
  Slack/Teams); snapshot versioning + distribution log with read receipts. `RP`
- **AI narrative**: any report can auto-write its executive summary from its
  own data, with the number-verification gate (docs/12) — no unverified figure
  ships. `AI` `RP`
- **Regulatory bundles**: one-click signed evidence exports (PDF + JSONL +
  hash manifest) — used by AXIS audit, ORBIT transcripts, compliance. `RP`

### 0.3 Shared operational capabilities (in every module)
- **Automations/Rules**: event → condition → action recipes (no-code), with
  simulate/dry-run, versioning, and guardrail floors that cannot be removed. `ADM`
- **Approvals engine**: consequential actions route to typed approval flows
  (dual-control, reason codes) keyed off the autonomy envelope. `ADM`
- **Notifications & inbox**: per-user, channel-aware (in-app, email, push,
  WhatsApp), quiet-hours aware.
- **Search (⌘K)**: entities + actions + docs, natural-language filters.
- **Audit & AI-audit**: append-only logs of every human and model action. `RP`
- **Import/Export**: CSV/XLSX wizards, bulk ops, API + webhooks. `DEV`
- **Module Admin console** and **Module Dev console** (per docs/09).
- **Lens personalization** (docs/15 §5): role-default workspace + learned layout.

### 0.4 Integration seam catalogue (how any module uses any other)
Every seam is an event contract + a read-view; absent partner = seam dormant,
UI shows the standalone path.
- **Identity/360 ∫** — Core `v_customer_360`; all modules read, ORBIT owns writes.
- **Case ∫** — AXIS cases can be opened by ORBIT, SIGNAL, SCOUT, NORTH actions.
- **Conversation ∫** — ORBIT conversations attachable to any module object.
- **Audience ∫** — SIGNAL audiences consumable by ORBIT journeys & SCOUT tests.
- **Quote/Bind ∫** — AXIS quoting callable by ORBIT (chat/partners) & SCOUT
  (experiment offers).
- **Signal ∫** — SCOUT ingests events from every module (quotes, chats, spend).
- **Metric ∫** — NORTH ingests every module's metrics; modules embed NORTH tiles.
- **Content ∫** — SIGNAL's creative/landing engine reused by SCOUT experiments
  and ORBIT journeys.
- **Consent ∫** — Core consent gates every outbound/profiling action, always.
- **Autonomy ∫** — shared envelope governs any module's AI actions.

---

## 1. LYRA AXIS — AI Operations

*"The factory that never sleeps."* Turns quote→bind→service→compliance into a
governed production line. Standalone buyer: insurers, brokers, TPAs, MGAs.

### Subsections
1. **Production Board** — the live work surface.
   - Kanban/table hybrid of all cases by stage; SLA heat; swimlanes by
     team/line/source; saved views; bulk actions; predictive "will-breach"
     flags 4h ahead. `AI` `AN`
   - Prioritisation agent orders the queue by value×risk×SLA. `AI`
   - Solo: intake via web forms, email, CSV, API. With ORBIT ∫: cases stream
     from conversations; with SIGNAL ∫: campaign-sourced leads tagged to spend.
2. **Case Room** — the unit of work.
   - Timeline (events+docs+messages), quote-comparison panel, copilot rail
     (draft, summarise, next-best-step, explain), approval strip, audit tab. `AI`
   - Quote-to-bind orchestration across the provider panel (API / portal-
     automation / email connectors); ranking by declared, auditable criteria. `AI`
   - With ORBIT ∫: reply to the customer in-thread; with SCOUT ∫: lost-quote
     reasons captured to whitespace signals.
3. **Document Intelligence** — extraction & verification.
   - OCR+LLM extraction (Emirates ID, mulkiya, trade licence, medical, census);
     confidence scoring; side-by-side verify UI; census normaliser with
     year-over-year diff. `AI`
   - Extraction template editor + accuracy dashboard per doc type/language. `AI` `AN` `ADM`
4. **Underwriting Assist** — decision support (never decisioning).
   - Risk-flag surfacing, missing-info detection, referral packaging to
     insurer underwriters; rules + model hints; full explainability. `AI`
   - With SCOUT ∫: pricing/coverage benchmarks inline.
5. **Policy & Servicing** — issuance and mid-term.
   - Schedule generation, endorsements, cancellations, MTAs, renewals-ops
     handoff; document delivery via customer channel; policy register. 
   - With ORBIT ∫: servicing requests arrive from chat; solo: web self-serve +
     email.
6. **Exceptions** — the only inbox.
   - Failed automations, erroring integrations, SLA-at-risk, low-confidence
     extractions; copilot-drafted resolutions; one queue, keyboard-first. `AI`
7. **Compliance Ops** — evidence by construction.
   - Approval policies (pricing overrides, discounts, refunds) with reason
     codes; disclosure & ranking-criteria logging; retention rules per line;
     **audit-on-demand** signed bundles. `RP` `ADM`
   - Client-money / escrow reconciliation workspace (statement import,
     auto-match, exception queue, CBUAE-ready evidence). `AI` `AN` `RP`
8. **Process Intelligence** — mining & optimisation.
   - Live process map (Sankey) of the pipeline; bottleneck, rework-loop and
     SLA-breach analytics; simulation of routing/SOP changes before rollout;
     capacity & staffing forecasts (Ramadan/visa peaks). `AI` `AN`
9. **Provider Network** — panel operations.
   - Connector health, quote latency & win-rate by provider, commission
     schedules, panel coverage gaps. `AN`
   - With SCOUT ∫: negotiation packs; with SIGNAL ∫: demand feeds to providers.
10. **AXIS Analytics** — the module's own reporting home.
    - Handling-minutes/policy, same-session issuance rate, straight-through
      rate, cost-per-case, exception rate, extraction accuracy, SLA hit rate,
      recon match rate, approval turnaround. Boards + scheduled reports. `AN` `RP`
    - With NORTH ∫: these roll up into the exec Brief automatically.
11. **AXIS Admin** — SOP builder, ranking-criteria editor, SLA policies,
    routing/queues, extraction templates, approval policies, connector setup,
    kill switch. `ADM`
12. **AXIS Developer** — case & document APIs, connector SDK (3 built-in
    types), extraction playground, webhook tester for `axis.*`, scoped keys,
    logs. `DEV`

**AI summary (AXIS):** quote-runner, doc-extractor, case-copilot, chaser,
issuer, SLA-sentinel, recon-matcher, prioritiser — all logged, all
envelope-governed, consequential steps approval-gated.

---

## 2. LYRA ORBIT — AI Customer & Partners

*"Every relationship, in orbit."* The always-on layer: agentic conversations,
self-defending renewals, embedded-insurance partner platform. Standalone
buyer: any consumer brand with a service book.

### Subsections
1. **Agent Console** — human+AI service.
   - Tri-pane (queue / conversation / customer 360 + copilot); streaming AI
     drafts as ghost text (Tab-accept); canned replies; handover with
     full-context summary; whisper-ask the AI; sentiment & language chips. `AI`
   - Channels: WhatsApp, web widget, email; voice (roadmap). RTL-native.
2. **Conversations & Inbox** — omnichannel history.
   - Unified threaded history across channels; redaction-aware transcript
     search; tagging & disposition; attach a conversation to any module object
     (case, campaign, whitespace) ∫.
3. **AI Agent Studio** — the brain behind the chat.
   - Persona & tone editor per tenant/brand; tool-enablement matrix (fetch
     policy, start quote ∫AXIS, endorsement, docs, renewal offer, FNOL
     guidance, callback, handover); knowledge base (RAG) manager; guardrail &
     disclosure config. `AI` `ADM`
   - Solo: tools limited to CX + KB; with AXIS ∫: quote/bind/servicing tools
     appear; with SIGNAL ∫: offer/creative tools appear.
4. **Renewals & Retention** — the cheapest growth.
   - Churn scoring per policy; strategy assignment (auto-requote / human /
     suppress); pre-expiry panel requote ∫AXIS; one-tap hosted renewal; save
     desk with objection cards + bounded price-match (approval-gated);
     win/loss reasoning. `AI` `AN`
   - Solo (no AXIS): renewal reminders + hosted forms + human desk; requote
     tool simply hidden.
5. **Journeys** — lifecycle orchestration.
   - Visual builder (triggers, waits, branches, messages, agent tasks,
     webhooks); consent & quiet-hours & frequency caps baked in as
     unremovable floors; simulate mode; versioning + diff; library (welcome,
     doc-chase, renewal 90/60/30, win-back, NPS, dunning). `AI` `ADM`
   - With SIGNAL ∫: journeys can target SIGNAL audiences and drop SIGNAL
     creative; with AXIS ∫: journey steps can open/advance cases.
6. **Partner & Embedded Platform** — B2B revenue.
   - Partner portal (brandable): onboarding wizard, keys, sandbox with mock
     quotes, docs, usage, revenue-share statements; embedded quote→bind ∫AXIS
     (webview + API modes); attribution; revshare ledger & settlement batches. `AN` `RP` `DEV`
7. **Customer 360 & Consent** — the relationship record.
   - Unified profile (identities, policies, cases, conversations, value,
     risk); consent history & channel opt-ins; preference centre; right-to-
     erasure trigger ∫Core. `AN`
8. **Quality & Coaching** — service excellence.
   - AI QA scores 100% of conversations (resolution, tone, compliance
     phrases); sampling to team-lead review; coaching plans; scorecards &
     calibration. `AI` `AN` `RP`
9. **Supervisor Wall** — live operations.
   - Volumes, wait times, AI-containment %, SLA, sentiment heat; barge/whisper
     into any conversation; staffing alerts (surge from SIGNAL launches ∫). `AN`
10. **ORBIT Analytics** — module reporting home.
    - Containment %, first-response & resolution times, CSAT/NPS, renewal
      retention vs control, save-rate, partner time-to-first-bind, revshare,
      consent-violation count (hard zero alarm). Boards + scheduled reports. `AN` `RP`
11. **ORBIT Admin** — channels/BSP config & templates, persona/tone, tool
    matrix, journey guardrail floors, QA rubric, handover routing, partner
    plans & revshare, kill switch. `ADM`
12. **ORBIT Developer** — conversation simulator (scripted Arabic personas),
    embedded-flow playground, webhook tester for `orbit.*`, transcript search
    API (redaction-aware), scoped keys. `DEV`

**AI summary (ORBIT):** CX agent, QA scorer, churn scorer, renewal runner,
save copilot, journey optimiser, partner sandbox mock — consent-gated,
envelope-governed, human handover always available.

---

## 3. LYRA SIGNAL — AI Marketing

*"Spend follows signal."* A closed-loop growth engine: compliant creative at
volume, value-based audiences, autonomous budget, and ownership of the AI
answer-engine channel. Standalone buyer: any growth/marketing team.

### Subsections
1. **Growth Cockpit** — the command surface.
   - CAC/LTV by channel×campaign×segment; money→binds Sankey; autopilot ledger
     with undo; pacing vs target; blended & marginal economics. `AN`
   - Solo: conversions via pixel/webhook; with AXIS ∫: true bind & premium
     attribution; with ORBIT ∫: retention-campaign outcomes.
2. **Creative Studio** — generative, governed.
   - Brief → multi-variant generation (ad copy, landing pages, emails,
     WhatsApp templates, video scripts) in Arabic + English natively; brand-kit
     enforcement; asset library with rights metadata & performance annotations;
     winning-pattern memory per tenant. `AI`
   - With ORBIT ∫: push approved creative into journeys; with SCOUT ∫: spin
     experiment landing pages.
3. **Compliance Pre-flight** — nothing ships unchecked.
   - Claims classifier tuned to CBUAE marketing/telemarketing rules + tenant
     legal phrases; hard-block list; human review lane; mandatory disclosures
     auto-appended per line; audit of every decision. `AI` `RP` `ADM`
4. **Audiences & Segments** — value-based targeting.
   - Rule-tree builder over the consent-aware spine; lookalike scoring via
     embeddings; bind-probability & predicted-LTV scoring; suppression lists
     always applied; size/reach estimator. `AI` `AN`
   - Audience ∫ shared with ORBIT journeys and SCOUT tests.
5. **Campaigns & Channels** — execution.
   - Campaign manager across paid (Google/Meta built-in; TikTok roadmap),
     owned (email, WhatsApp ∫ORBIT), and web; UTM schema; value-based bidding
     exports; launch calendar. `AN`
6. **Budget Autopilot** — autonomous allocation.
   - Daily marginal CAC/LTV reallocation within tenant bounds (beyond bounds →
     approval); every move logged with reasoning; anomaly guard auto-pauses on
     spend spike / tracking breakage; holdout management. `AI` `AN`
7. **SEO + AEO Command** — the next channel.
   - Answer-engine content units (schema.org, citations, freshness SLAs); AEO
     monitor sampling major AI assistants for citation share on target queries;
     technical SEO watcher (Core Web Vitals, index status, hreflang ar/en,
     cannibalisation). `AI` `AN`
8. **Experiments** — truth, not eyeballs.
   - Hypothesis→variant→metric registry; sequential-testing math; auto-
     conclusion with confidence; experiment library & learnings. `AI` `AN` `RP`
9. **Attribution & Journeys-to-Bind** — credit where due.
   - Server-side first-party event collection; touch stitching to bind events
     ∫AXIS; contribution ranges (no false precision); path analysis. `AI` `AN`
10. **SIGNAL Analytics** — module reporting home.
    - Blended/marginal CAC trend, creative test velocity, compliance flag rate
      & time-to-review, autopilot uplift vs holdout, AEO citation share,
      channel ROAS, cohort LTV curves. Boards + scheduled reports. `AN` `RP`
    - With NORTH ∫: growth economics feed the exec Brief.
11. **SIGNAL Admin** — brand kit & banned claims, channel OAuth, budget bounds
    & approval thresholds, disclosure templates, suppression sources, UTM
    schema, kill switch. `ADM`
12. **SIGNAL Developer** — first-party pixel/tag setup & debugger, catalog/feed
    endpoints, webhook tester for `signal.*`, ad-platform sandbox mocks,
    scoped keys. `DEV`

**AI summary (SIGNAL):** creative generator, compliance pre-flight, budget
autopilot, AEO monitor, SEO watcher, experiment analyst, audience scorer —
consent-gated, spend-bounded, everything reversible where the platform allows.

---

## 4. LYRA SCOUT — AI Products

*"Find the gap before it's priced."* Automated product & market intelligence
fusing external market exhaust with the tenant's own demand data. Standalone
buyer: product & strategy teams at insurers, banks, marketplaces.

### Subsections
1. **Radar** — the whitespace surface.
   - Quadrant/polar view of opportunities (demand × competition) with momentum
     trails; theme cards; drill to evidence; period compare. `AI` `AN`
2. **Signal Feed** — sensing.
   - Ingestion from internal (quote requests, funnel abandonment + reasons,
     lost-quote reasons ∫AXIS, conversation themes ∫ORBIT QA) and external
     (search-trend, app/review scraping, news/regulatory RSS, competitor page
     diffing) sources; embed + cluster weekly; momentum scoring. `AI` `AN`
   - Solo: external sources + CSV/API demand import; internal seams enrich when
     AXIS/ORBIT present.
3. **Whitespace Workbench** — from signal to decision.
   - Auto-drafted dossiers (description, evidence, demand estimate, competition
     score, regulatory flags for counsel); kanban lifecycle (candidate →
     validating → validated → parked); owner + decision log; seeded playbooks
     (EV motor, gig-worker, SME cyber, micro-travel, domestic-helper). `AI` `RP`
4. **Panel & Price Intelligence** — competitiveness.
   - Continuous benchmark from quote outcomes ∫AXIS: win-rate, price index vs
     panel median, coverage-term diffs (LLM-extracted from wordings), decline
     patterns by provider×line×segment; negotiation-pack generator. `AI` `AN` `RP`
5. **Competitor & Market Watch** — the outside view.
   - Tracked competitors, page/pricing diff alerts, product-launch detection,
     regulatory-change watch (flagged, never asserted as cleared). `AI` `AN`
6. **Product Experiments** — validate cheaply.
   - Test offers as hosted landing experiments (reuses Content ∫SIGNAL, own
     mini-engine if solo) with capped traffic and a mandatory "not yet
     available" honesty banner; qualified-demand funnels; results append to the
     dossier. `AI` `AN`
7. **Data Products** — insight-as-revenue.
   - Package anonymised, consent-based aggregates (demand curves, elasticity,
     coverage-gap maps) as provider subscriptions; k-anonymity floor (≥20,
     raise-only) enforced; delivery via API or scheduled report; subscriber
     management. `AI` `AN` `RP` `DEV`
8. **SCOUT Analytics** — module reporting home.
   - Whitespaces validated/quarter, signal-to-dossier lead time, bench coverage
     (% of quote volume benchmarked), negotiation packs used & commission
     delta, data-product ARR, experiment cycle time. Quarterly Radar report
     auto-assembled. `AN` `RP`
   - With NORTH ∫: market intelligence appears in the exec Brief.
9. **SCOUT Admin** — source manager (connectors, crawl politeness, robots
   compliance), momentum thresholds, k-anonymity floor, hypothesis library,
   export/consent policies, kill switch. `ADM`
10. **SCOUT Developer** — signal ingest API (custom feeds), connector SDK +
    test harness, embedding-search playground, webhook tester for `scout.*`,
    scoped keys. `DEV`

**AI summary (SCOUT):** harvester, clusterer, whitespace drafter, wording
differ, bench builder, experiment analyst — all evidence-linked, regulatory
items flagged for human/counsel, aggregates k-anonymised.

---

## 5. LYRA NORTH — AI Insights

*"The whole business, narrated."* Atheon-class executive intelligence: one
governed metric layer, a daily narrated brief, anomaly+driver analysis,
grounded simulations, board packs. Standalone buyer: any mid-to-large
enterprise — NORTH runs happily on imported (non-LYRA) data.

### Subsections
1. **Today** — the executive home.
   - The Brief as a typographic read (numbers first, ≤400 words, evidence
     links on every claim); metric ticker; anomaly cards; ask-NORTH bar;
     delivery to app, email, WhatsApp, mobile push. `AI` `AN`
2. **Metric Explorer** — the semantic layer.
   - Metric registry (owner, versioned SQL definition, target, sensitivity,
     lineage); chart canvas with definition-change annotations; compare/cohort
     tools; "one version of the numbers." `AN` `ADM`
   - Solo: connectors (warehouse read, CSV/Sheets, metrics push); integrated:
     every module's metrics auto-register ∫.
3. **Anomalies** — what changed and why.
   - Seasonal-aware detection; automated driver decomposition (by dimension,
     ranked correlations labelled as correlation); create-action button with
     owner/due-date; state tracking (new/explained/action). `AI` `AN`
4. **Scenarios & Simulation** — decisions before spend.
   - Ask-and-answer ("shift 20% budget to renewals?"); composes from registered
     model primitives (elasticities, funnel rates, cohort retention);
     range estimates with listed assumptions and confidence bands; saved,
     shareable, revisitable with actuals overlay. `AI` `AN`
5. **Board Room** — governance reporting.
   - Templates (exco weekly, board monthly/quarterly, investor update);
     auto-assembly from briefs + snapshots + decision log + module KPI
     sections; in-app editing; branded PDF render; distribution log + read
     receipts. `AI` `RP`
6. **Decision Log** — memory of choices.
   - Registry (context, options, chosen, owner, review date); review-date nags;
     auto-drafted outcome review from subsequent metric movement. `AI`
7. **Compliance Posture** — the assurance tile.
   - Live control signals (tenancy isolation tests, consent propagation,
     disclosure snapshots, AI-audit completeness, verification pass-rate,
     breach-drill status) assembled for tenant.compliance. `AN` `RP`
8. **Data & Connectors** — the inputs.
   - Warehouse creds + test query, CSV/Sheets schedules, metrics push API,
     brief webhook (Slack/Teams), the synthetic "Aldebaran" sandbox dataset. `DEV` `ADM`
9. **NORTH Analytics** — meta-reporting.
   - Exec daily-open rate, time-to-explanation for anomalies, % brief figures
     verified (must be 100%), scenario reuse, pack assembly time, decision-
     review timeliness. `AN` `RP`
10. **NORTH Admin** — metric-definition approvals, audience & sensitivity
    mapping (who sees which metrics), brief schedule & locales, targets,
    connector management, kill switch. `ADM`
11. **NORTH Developer** — connector setup, metrics push API, brief/anomaly
    webhooks, scenario-primitive registration, scoped keys. `DEV`

**AI summary (NORTH):** snapshotter, anomaly hunter, driver analyst, narrator
(with 100% numeric-verification gate), scenario engine, pack assembler —
grounded only in the metric layer, never inventing a number.

---

## 6. Standalone ↔ integrated matrix (quick reference)

| Capability that appears | Solo module | Lights up with… |
|---|---|---|
| Quote/bind inside chat | ORBIT (hidden) | AXIS ∫ |
| True bind attribution | SIGNAL (pixel proxy) | AXIS ∫ |
| Requote-on-renewal | ORBIT (reminders only) | AXIS ∫ |
| Campaign→staffing surge alerts | ORBIT / SIGNAL | both ∫ |
| Internal-demand whitespace | SCOUT (external only) | AXIS + ORBIT ∫ |
| Negotiation packs | SCOUT | AXIS quote data ∫ |
| Experiment landing pages | SCOUT (mini-engine) | SIGNAL content ∫ |
| Exec Brief with all KPIs | NORTH (imported data) | all modules ∫ |
| Journey uses value audience | ORBIT | SIGNAL ∫ |
| Creative reused in journeys/tests | SIGNAL | ORBIT + SCOUT ∫ |

Rule of thumb: **a module never blocks on an absent partner** — it shows the
standalone path and exposes the seam so the integrated path appears the moment
the partner is licensed. No migration, no rebuild (docs/16 seams).

## 7. Where the large analytics & AI concentrate (so nothing is missed)

- **Heaviest analytics:** NORTH (semantic layer, briefs, scenarios), SIGNAL
  (economics, attribution, experiments), SCOUT (market clustering, elasticity),
  AXIS (process mining, capacity forecasting), ORBIT (containment, retention,
  QA).
- **Heaviest AI generation:** SIGNAL (creative), ORBIT (conversations), NORTH
  (narratives), AXIS (extraction, copilots), SCOUT (dossiers).
- **Shared AI substrate:** model gateway (tiers, budgets, evals), guardrails
  (PII, policy, grounding), autonomy envelopes, memory (docs/16 H11) — so every
  module's AI is governed, measured, and reversible by the same machinery.
