# 20 — Content Production & Social Engine (SIGNAL, self-sufficient)

**Mandate: the business must run its marketing inside Lyra.** No Hootsuite, no
Buffer, no Sprout, no Canva, no Later, no Semrush, no Mailchimp, no third-party
social suite. Lyra produces the content, governs it, schedules it, publishes it,
listens to the response, buys the media, measures the outcome, and — when other
modules are present — sources the *idea* from real market evidence.

## 1. The honest boundary (read this first)

We replace **management and production tooling**. We do not replace the
**channels themselves**:

- To publish on a social platform you must call *that platform's* API (Meta
  Graph, TikTok Content Posting, LinkedIn Marketing, X, YouTube Data, Snapchat,
  Pinterest). That is a distribution channel, exactly like an insurer API — not
  an external tool running your business.
- To buy paid media you transact on the ad network. Lyra plans, creates,
  budgets, optimises and reconciles; the auction happens at the network.
- Some platforms restrict automation by policy (see §9). Where direct publishing
  is not permitted or not yet approved for the tenant's app, Lyra degrades to
  **assisted publish**: the finished asset, caption, hashtags and checklist are
  handed to a human with a deep link — explicitly labelled, never silent.

Everything else — ideation, briefs, copy, imagery, video, voice, localisation,
approvals, scheduling, calendars, DAM, listening triage, creator management,
reporting — is native.

## 2. Subsections (the SIGNAL navigable areas added by this document)

### 2.1 Content Intelligence (what to say, and why now)
- Brief generator seeded by evidence: search demand, audience gaps, seasonal
  patterns, competitor moves, regulatory changes.
- `[∫SCOUT]` Whitespace → campaign chain: a validated whitespace produces a
  launch brief automatically with its evidence attached.
- `[∫ORBIT]` Voice-of-customer mining: real objections and questions from
  conversations become content angles (consent- and privacy-filtered).
- `[∫AXIS]` Product truth: coverage terms, prices and eligibility pulled from
  the live product record so creative can never contradict the product.
- Standalone: manual product/offer entry, uploaded market notes, connected
  search-trend feeds.
- Editorial strategy board: pillars, cadence targets, share-of-voice goals.

### 2.2 Copy Studio
- Long-form (articles, guides, landing pages), short-form (ads, captions,
  subject lines), conversational (WhatsApp templates), technical (product
  disclosures).
- Arabic and English authored natively with separate prompt lineages, plus
  dialect register selection (MSA for formal, Gulf/Egyptian/Levantine for social)
  and Arabizi handling for youth segments.
- Brand voice model per tenant (tone, banned words, reading level, emoji policy);
  claim library with substantiation links so no unsupported claim can ship.
- Variant matrix: angle × audience × platform × length, generated as a grid.

### 2.3 Visual Studio
- Brand-locked template system (grids, safe areas, logo placement, type scale)
  so every output is on-system by construction.
- Generative imagery with brand-consistent style presets; product/lifestyle
  composition; background removal and extension; localisation of on-image text
  including RTL typesetting.
- Asset variants auto-derived for every required aspect ratio (1:1, 4:5, 9:16,
  16:9, 1.91:1) with per-platform safe-area validation.
- Hard rules: no real person's likeness without a consent record; no scraped
  third-party imagery; generated-content provenance stored on every asset.

### 2.4 Video Studio
- Script → storyboard → shot list → assembly, with stock/generated/uploaded
  footage; captions burned and as sidecar files; per-platform cut-downs
  (hook-first 6s, 15s, 30s, 60s).
- Voiceover synthesis in ar/en with dialect and gender options; music from
  tenant-licensed or platform-licensed libraries only, with the licence
  reference stored on the asset (§8).
- Automatic subtitle translation with human review lane for Arabic.

### 2.5 Asset Library (DAM)
- Versioning, rights and licence metadata, usage log (where each asset ran),
  expiry (licence or claim expiry), performance annotations, archival policy.
- Every asset carries: creator (human/AI), model/prompt version, approvals,
  compliance decision, and the transactions that used it.

### 2.6 Localisation & Cultural Review
- Market packs (UAE, KSA, EG to start) with sensitivity rules, calendar
  awareness (Ramadan, Eid, National Days, school terms), imagery guidance.
- Mandatory human review lane for Arabic creative before first publish; approval
  recorded per market.

### 2.7 Compliance Pre-flight (unbypassable)
- Claims classifier against the market rulepack (financial-promotion rules,
  telemarketing constraints, prize/competition rules) plus tenant legal phrases.
- Mandatory disclosures auto-appended by product line and channel format.
- AI-content disclosure applied where a platform's policy requires it.
- Hard-block list vs soft-flag lane; every decision audited; publish is
  physically impossible without a pass token (`PUBLISH` transaction rejects).

### 2.8 Publishing & Calendar
- Unified calendar (month/week/day) with channel lanes, embargoes, blackout
  windows, and per-market timezones.
- Per-platform adaptation engine: caption length, hashtag conventions, mention
  handling, link treatment (link-in-bio, story stickers), thread/carousel
  composition, first-comment strategy, alt text (accessibility, not optional).
- Queue with retry, rate-limit awareness, partial-failure surfacing per channel;
  every attempt is a `PUBLISH` transaction with the platform's returned id.
- Approval routing before scheduling; scheduled items are diffable and
  cancellable up to cut-off.
- Evergreen recycling with freshness checks; UGC/creator content re-share with
  rights confirmation.

### 2.9 Social Inbox, Listening & Community
- Comments, mentions, DMs and reviews pulled where the platform permits, into a
  single triage queue with sentiment, intent and language detection.
- `[∫ORBIT]` Service-intent messages become conversations with full customer
  context and the same AI agent; standalone mode provides an internal inbox with
  templates and assignment.
- Listening: brand, competitor, category and campaign monitors; share-of-voice;
  emerging-topic alerts that feed §2.1 (and SCOUT when present).
- Moderation: policy-based hiding/escalation, crisis detection with a defined
  escalation path, complaint routing to compliance where regulated.

### 2.10 Creator & Influencer Operations
- Discovery and vetting (audience quality, brand-safety review), brief issuance,
  contracting terms, deliverable tracking, disclosure compliance
  (`#ad`/paid-partnership labels verified before payout).
- `CREATOR-BRIEF` → `CREATOR-VERIFY` → `CREATOR-PAYOUT` transaction chain with
  performance and cost-per-outcome reporting.

### 2.11 Paid Media (in-house buying)
- Campaign build, audience push, creative rotation, bid/budget strategy per
  network; value-based signals from the spine.
- Budget autopilot (docs/05 §6.4) governs allocation; `MEDIA-COMMIT`,
  `MEDIA-SPEND`, `BOOST`, `BUDGET-MOVE` transactions record every movement and
  reconcile to network invoices.
- Brand-safety and placement exclusions managed centrally.

### 2.12 Owned Channels
- Web/blog CMS with the same brand system and compliance lane; landing-page
  engine; email and SMS/push composition with consent-gated audiences and
  quiet-hours enforcement; WhatsApp template management.

### 2.13 SEO & AEO Content Operations
- Query-cluster planning, brief-to-publish workflow, internal linking, schema
  markup, freshness SLAs; answer-engine citation monitoring and content units
  structured for citation.

### 2.14 Launch Orchestration (the chain that makes this a system)
```
whitespace evidence → product definition → pricing & terms → compliance pack
   → content set (copy/visual/video, ar+en) → channel plan → paid plan
   → launch gate (approvals) → publish + campaign live → measurement → decision
```
- Each stage is a gate with an owner, a checklist and a status; the launch record
  keeps every artifact and every approval in one place.
- `[∫SCOUT]` stage 1 is automatic; `[∫AXIS]` stage 2–3 read the real product;
  `[∫NORTH]` stage 9 measures against the metric layer. Standalone: every stage
  works with manual inputs.

### 2.15 SIGNAL Analytics (unified)
- Organic + paid + owned in one model: reach, engagement quality, CTR, CAC,
  bound outcomes `[∫AXIS]`, retention influence `[∫ORBIT]`, creator ROI,
  share-of-voice, content-pillar performance, asset-level lifetime value.
- Cohort and incrementality views (holdouts, geo splits) rather than
  last-click flattery; contribution ranges with method disclosed.

## 3. AI agents in this engine

| Agent | Role | Tier | Consequential |
|---|---|---|---|
| Brief Composer | turns evidence into briefs | reasoning | no |
| Copywriter | drafts all copy forms, ar/en | standard | no |
| Art Director | composes visuals within brand templates | standard | no |
| Video Editor | assembles cuts from script/storyboard | standard | no |
| Localiser | adapts market/dialect, flags sensitivity | standard | no |
| Compliance Screener | blocks/flags creative | fast | blocks publish |
| Scheduler | optimal timing per channel/audience | fast | no |
| Community Triager | classifies and routes inbound | fast | replies within policy |
| Listening Analyst | topics, sentiment, SOV, crisis signals | standard | no |
| Media Optimiser | budget/bid moves within envelope | reasoning | within bounds |
| Launch Conductor | drives gates, chases owners | standard | no |

## 4. Standalone vs integrated (explicit)

| Capability | SIGNAL alone | With other modules |
|---|---|---|
| Idea source | manual + external trend feeds | `[∫SCOUT]` evidenced whitespace |
| Product facts in creative | manually entered offer sheet | `[∫AXIS]` live product record |
| Audience definition | uploaded/CRM-synced lists, site behaviour | `[∫ORBIT]` full customer 360 + consent |
| Conversion truth | pixel + webhook conversions | `[∫AXIS]` bound policies & premium |
| Service replies to comments | internal inbox + templates | `[∫ORBIT]` same agent, full context |
| Retention campaigns | generic lifecycle lists | `[∫ORBIT]` churn scores, renewal book |
| Executive reporting | SIGNAL analytics + scheduled reports | `[∫NORTH]` in the daily brief |

## 5. UI (detail in docs/22 §2–3)

Social Studio composer with **live per-platform previews** side by side, an
asset rail, the variant matrix, and a compliance chip that must go green before
the schedule button is even enabled. Calendar with channel lanes and drag
rescheduling. Launch Cockpit as a horizontal gate rail. Inbox as a triage
queue with keyboard-first disposition.

## 6. Data model additions
`signal_briefs`, `signal_assets` (+`asset_versions`, `asset_rights`),
`signal_posts` (+`post_targets` per channel with platform ids and results),
`signal_calendar_slots`, `signal_channels` (auth, scopes, limits, health),
`signal_inbox_items`, `signal_listening_monitors`, `signal_topics`,
`signal_creators` (+`creator_briefs`, `deliverables`), `signal_launches`
(+`launch_gates`), `signal_pillars`. All tenant-scoped per docs/03.

## 7. Events
`signal.brief.created` · `signal.asset.approved` · `signal.post.scheduled` ·
`signal.post.published` · `signal.post.failed` · `signal.inbox.received` ·
`signal.listening.alert` · `signal.creator.deliverable_verified` ·
`signal.launch.gate_passed` · `signal.launch.live`.

## 8. Rights, authenticity and platform-policy discipline
- Music, fonts, stock and footage: tenant-licensed or platform-licensed only,
  with the licence reference stored on the asset. No scraping.
- No synthetic likeness of real people without a stored consent record; no
  political-issue advertising without explicit tenant authorisation and market
  legality confirmation.
- No inauthentic behaviour: no fake engagement, no bulk unsolicited DMs, no
  multi-account manipulation. These are hard product refusals, not settings.
- Platform terms of service are treated as compliance rules in the rulepack;
  a channel connector must declare the permissions it uses and the policy limits
  it respects.

## 9. Channel reality matrix (v1 targets; verify current platform policy at build)

| Channel | Publish | Read/engage | Ads | Notes |
|---|---|---|---|---|
| Facebook Pages | API | comments, DMs | API | business asset + review required |
| Instagram (Business/Creator) | API (feed, reels, stories subject to type) | comments, DMs | API | personal accounts unsupported by design |
| TikTok | Content Posting API (app audit required) | comments (limited) | Ads API | direct-post vs upload-to-inbox modes |
| X | API (tiered pricing) | mentions/DMs per tier | Ads API | cost/tier is a tenant decision |
| LinkedIn | Page posts API | comments | Ads API | personal-profile posting restricted |
| YouTube | Data API upload | comments | Ads API | quota management required |
| Snapchat | limited organic | — | Ads API | primarily paid |
| Pinterest | API | — | Ads API | optional v1.1 |
| WhatsApp | templates/broadcast via BSP | inbound | — | consent-gated, opt-in only |
| Telegram | Bot API | inbound | — | optional |
| Google Business Profile | API | reviews | — | local/branch presence |
| Email / SMS / Push | native | replies | — | consent + quiet hours enforced |

Every connector reports its own health and permission state; when a capability
is unavailable the UI shows the degraded path (assisted publish) explicitly.
