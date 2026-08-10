# Reporting & BI catalog — standard report and insight packs

Grounded in docs/05, docs/06, docs/03, docs/18, docs/19, `packages/core/src/rbac.ts`,
docs/15 §4, and a code read of `apps/api/src/engines/report.ts`,
`apps/api/src/routes/analytics.ts`, `apps/api/src/engines/axis-sla-sentinel.ts`,
`apps/web/app/modules/analytics.ts` and the module analytics routes.

## 0. What already exists (do not rebuild)

- **Semantic report engine** (`engines/report.ts`): a `DATASETS` registry of 14
  tenant-scoped, PII-masked, permission-gated datasets — `policies`, `quotes`,
  `quoteResponses`, `commissions`, `cases`, `transactions`, `aiSpend`,
  `conversations`, `campaigns`, `spend`, `signals`, `whitespaces`, `boardpacks`,
  `decisions`. `runReport()`, `feedRows()` (warehouse NDJSON, keyset cursor),
  `totalsOf()`.
- **Full API surface** (`routes/analytics.ts`, 1248 lines): saved reports CRUD,
  ad-hoc `/run`, `/reports/:id/run`, exports (xlsx/pdf/csv/json) with
  dual-control PII unmasking + watermarking, `/feed/:dataset`, cron
  `/schedules` (delivery is **in-app inbox only today** — the route comment
  says email/R2/webhook/Slack are "the same seam", not built), multi-tile
  `/dashboards`, `/saved-views`, `/unit-economics` (NFR-013), `/usage`.
- **UI**: `analytics-dashboard.tsx` (generic tile painter), `axis-analytics.tsx`,
  `orbit-analytics.tsx`, `signal-analytics.tsx`, `ledger-reports.tsx` are real,
  populated canned-analytics pages, not stubs. No `scout-analytics.tsx` /
  `north-analytics.tsx` route exists; SCOUT and NORTH have their own domain
  pages (`scout-radar.tsx`, `scout-panel.tsx`, `north-brief.tsx`) whose report
  depth wasn't inspected here.
- `TELEMETRY` (Cloudflare Analytics Engine, `mw.ts`) is infra request/latency
  telemetry only — a different thing from the tenant BI surface above.
- **SLA Sentinel** (`engines/axis-sla-sentinel.ts`, AXIS §G.4): computes
  `breachProbability` / `hoursToBreach` / `driver` per case. Code comment: an
  ambient, not-consequential, generation-only primitive with zero rendering
  surface — no chip, no strip, no consumer yet (ADR-0035 defers the agents
  that would act on it).

So the gap is not "no reporting infra." It is: (1) several schema tables have
no `DATASETS` entry and can't be queried through this engine yet, (2) schedule
delivery beyond in-app inbox is unbuilt, and (3) almost no *insight-pack*
(proactive narrative, ambient-grammar) surface exists anywhere — the stack
produces reports on request, not unprompted findings.

Ambient grammar tags used below (docs/15 §4): **ghost text**, **quiet chip**,
**background draft**, **forecast strip**, **whisper dot**, **explain-on-hover**,
**escalating presence**. `Consequential: Y` = CLAUDE.md rule 4 approval gate
applies (pricing/claims/regulated advice/outbound send/payment) unless the
tenant's `auto_approve` allowlist covers it.

---

## 1. AXIS (ops)

### (a) Standard reports
| Report | Backing entities / dataset | J-ID | Roles |
|---|---|---|---|
| SLA compliance & case aging | `axis_cases` (`cases` dataset) + `axis_process_events` — **gap**: cases dataset has no `closed_at`/`sla_due_at` column today (axis-analytics.tsx comment), so attainment is sampled, not exact | J-O1 | axis.lead, axis.admin, tenant.admin |
| Exception rate / agent productivity | `axis_cases`, `axis_tasks` (no dataset entry — **gap**) | J-O1 | axis.lead, axis.admin |
| Quote-to-bind funnel, same-session issuance | `quotes`, `quoteResponses`, `policies` datasets | J-C1, J-O2 | axis.agent, axis.lead, axis.admin |
| Group bid cycle time | `axis_quotes`, `axis_documents` (**gap**), `axis_tasks` (**gap**) | J-O2 | axis.lead, axis.admin |
| Month-end recon / bordereaux match rate | `transactions` dataset + `axis_escrow_batches` (**gap**) | J-O3 | axis.admin, finance.analyst, finance.controller |
| AI extraction accuracy / spend-per-case | `aiSpend` dataset, `ai_audit_log` | J-O1 | axis.admin, tenant.admin |
| Commission / earnings | `commissions` dataset | J-O2 | axis.lead, axis.admin, finance.analyst |

### (b) Insight packs
| Pack | Rendering | Consequential | J-ID | Roles |
|---|---|---|---|---|
| SLA-breach forecast (SLA Sentinel output) | **forecast strip** on the case (matches docs/15's own worked example, "breach in ~4h — reassign?") — currently unsurfaced | N (generation only today; reassignment action would be Y) | J-O1 | axis.agent, axis.lead, axis.admin |
| Exception-queue spike call-out | **quiet chip** | N | J-O1 | axis.lead, axis.admin |
| Recon exception explainer | **explain-on-hover** | N | J-O3 | axis.admin, finance.analyst, finance.controller |
| Census gap-chase draft ("gaps chased automatically", J-O2) | **background draft** in outbox | **Y** (outbound send) | J-O2 | axis.lead, axis.admin |

---

## 2. ORBIT (CX & retention)

### (a) Standard reports
| Report | Backing entities | J-ID | Roles |
|---|---|---|---|
| Containment %, first-response/resolution time, CSAT/NPS | `orbit_conversations`, `orbit_messages` (`conversations` dataset) | J-X1, J-C2 | orbit.agent, orbit.lead, orbit.admin |
| QA scorecard | `orbit_qa_scores` (**gap**, no dataset) | J-X1 | orbit.lead, orbit.admin |
| Renewal retention & save-rate | `orbit_renewals` (**gap**; `v_renewal_book` view exists per docs/03 and could back it) | J-C3, J-X2 | orbit.retention, orbit.lead, orbit.admin |
| Partner time-to-first-bind & revshare | `orbit_partners`, `orbit_partner_txns` (**gap**) | J-X3 | orbit.partners, orbit.admin |
| Consent-violation count | `core_consents`, `core_audit_log` | J-CO1 | tenant.compliance, orbit.admin |

### (b) Insight packs
| Pack | Rendering | Consequential | J-ID | Roles |
|---|---|---|---|---|
| Churn-risk save-desk list | **whisper dot** → list; discount action **escalates to ApprovalStrip** | Price-match itself: Y (approval-gated per J-X2 spec) | J-X2 | orbit.retention, orbit.lead |
| Handover summary at escalation | **background draft** (chat summary for the human console) | N | J-X1 | orbit.agent, orbit.lead |
| Partner certification stall alert | **quiet chip** | N | J-X3 | orbit.partners, orbit.admin |

---

## 3. SIGNAL (marketing)

### (a) Standard reports
| Report | Backing entities | J-ID | Roles |
|---|---|---|---|
| Blended/marginal CAC trend, channel ROAS | `signal_campaigns`, `signal_spend` (`campaigns`, `spend` datasets) | J-M1 | signal.marketer, signal.lead, signal.admin |
| Compliance flag rate & time-to-review | `signal_creatives` (**gap**) | J-M1 | signal.lead, signal.admin, tenant.compliance |
| Autopilot uplift vs. holdout | `signal_experiments` (**gap**) | J-M2 | signal.lead, signal.admin |
| AEO citation share trend | `signal_aeo_pages` (**gap**) | J-M3 | signal.marketer, signal.lead, signal.admin |
| Cohort LTV curves | `signal_attribution_events` + ledger (`v_cac_ltv` view per docs/03) | J-M1 | signal.lead, signal.admin, north.analyst |

### (b) Insight packs
| Pack | Rendering | Consequential | J-ID | Roles |
|---|---|---|---|---|
| Autopilot budget-move recommendation | **forecast strip** → **background draft** of the move | **Y** (spend action; matches J-M2 "approve/undo autopilot moves" exactly) | J-M2 | signal.lead, signal.admin |
| Creative compliance-flag explainer | **explain-on-hover** | N (the block itself is a separate consequential act already gated by `signal:creatives:approve`) | J-M1 | signal.lead, tenant.compliance |
| AEO citation-share drop | **quiet chip** | N | J-M3 | signal.marketer, signal.lead |

---

## 4. SCOUT (product)

### (a) Standard reports
| Report | Backing entities | J-ID | Roles |
|---|---|---|---|
| Whitespace pipeline (validated/quarter) | `scout_whitespaces` (dataset exists) | J-P1 | scout.pm, scout.lead, scout.admin |
| Signal-to-dossier lead time | `scout_signals` (dataset) + `scout_clusters` (**gap**) | J-P1 | scout.pm, scout.lead, scout.admin |
| Bench coverage % of quote volume | `scout_panel_bench` (**gap**) | J-P2 | scout.lead, scout.admin |
| Data-product ARR | `scout_data_products` (**gap**) + ledger | J-P2 | scout.lead, scout.admin, finance.analyst, provider.viewer (own products only) |
| Experiment cycle time | `scout_experiments` (**gap**) | J-P1 | scout.pm, scout.lead, scout.admin |

### (b) Insight packs
| Pack | Rendering | Consequential | J-ID | Roles |
|---|---|---|---|---|
| Whitespace promotion recommendation | **quiet chip** on radar | N (promotion is a deliberate `scout:whitespaces:promote` click) | J-P1 | scout.pm, scout.lead |
| Panel bench-alert | **quiet chip**; negotiation pack itself is a **background draft** | N | J-P2 | scout.lead, scout.admin |

---

## 5. NORTH (exec)

### (a) Standard reports
| Report | Backing entities | J-ID | Roles |
|---|---|---|---|
| 7am exec brief | `north_briefings` + `v_exec_daily` | J-E1 | north.exec, north.analyst, north.board, north.admin |
| Board pack | `north_boardpacks` (dataset exists) | J-E2 | north.exec/analyst/admin (write); north.board (read-only by design) |
| Decision log & review timeliness | `north_decisions` (dataset exists) | J-E1, J-E2 | north.exec, north.analyst, north.admin, north.board (read) |
| Scenario / what-if comparisons | `north_scenarios` (**gap**) | J-E3 | north.exec, north.analyst, north.admin |
| Cross-module KPI rollup | `north_metrics`, `north_snapshots` (**gap**) | J-E1 | north.exec, north.analyst, north.admin, north.board |

### (b) Insight packs
| Pack | Rendering | Consequential | J-ID | Roles |
|---|---|---|---|---|
| Anomaly call-out (`north_anomalies`) | **quiet chip**, escalates to **ApprovalStrip** only if the assigned action is itself consequential | Depends on assigned action | J-E1 | north.exec, north.analyst, north.admin |
| What-if scenario projection | **forecast strip** | N | J-E3 | north.exec, north.analyst, north.admin |

Note: docs/05's "% brief figures verified (must be 100%)" is a Report Studio
number-verification *gate*, not an insight pack — it constrains how NORTH's
narrative is generated, not what gets shown.

---

## 6. Cross-cutting: admin, finance, compliance

### (a) Standard reports
| Report | Backing entities / route | Roles |
|---|---|---|
| Unit economics / cost-per-outcome | existing `/unit-economics` route (NFR-013) | tenant.admin, north.exec/analyst/admin, finance.analyst, finance.controller |
| Storage/egress usage | existing `/usage` route | tenant.admin, platform.admin |
| AI spend & audit trail | `aiSpend` dataset, `ai_audit_log` | tenant.admin, tenant.compliance, module `.admin` roles (own module) |
| Ledger / revenue-line P&L (docs/18 §4 mapping) | `transactions` dataset (`ledger_txns`), `ledger-reports.tsx` | finance.analyst, finance.controller, tenant.admin |
| Reconciliation status board (docs/19 §6: insurer, PSP, client-money, partner, media, period close) | `ledger:recon:*` permission exists (axis.admin, finance.controller) but **no dedicated recon dataset** in `report.ts` — **gap** | finance.controller, axis.admin |
| Regulator export bundle | `core_audit_log`, `ai_audit_log` via `/exports` unmasked dual-control | tenant.compliance |
| Approvals ledger | `core_approvals` | tenant.admin, tenant.compliance, all `*.lead`/`*.admin` holding `core:approvals:decide` |

### (b) Insight packs
| Pack | Rendering | Consequential | Roles |
|---|---|---|---|
| Consent-violation hard-zero alarm | **escalating presence** (always visible, even at zero) | N (alarm itself); any resulting pause is an admin action, not auto-triggered | tenant.compliance, orbit.admin |
| Approval-queue aging | **quiet chip** | N | tenant.admin, module leads/admins |
| AI budget forecast (spend trending to cap) | **forecast strip** | N (nearing cap triggers human review, not auto-spend) | tenant.admin |

---

## Biggest catalog gaps (evidence-based, not speculative)

1. **DATASETS registry coverage.** `orbit_renewals`, `orbit_qa_scores`,
   `orbit_partners`/`orbit_partner_txns`, `axis_documents`,
   `axis_escrow_batches`, `axis_tasks`, `signal_creatives`,
   `signal_experiments`, `signal_aeo_pages`, `signal_attribution_events`,
   `scout_clusters`, `scout_panel_bench`, `scout_experiments`,
   `scout_data_products`, `north_metrics`/`north_snapshots`/`north_anomalies`/
   `north_scenarios`, and a recon-specific view all exist in the schema
   (docs/03) but have no entry in `engines/report.ts` `DATASETS` — they cannot
   be queried through `/run`, `/reports`, `/exports` or `/feed` today.
2. **Schedule delivery.** Only the in-app inbox channel is wired; email, R2
   hand-off, webhook and Slack are a documented seam with no implementation.
3. **Insight-pack rendering.** Almost nothing in this catalog's (b) column
   exists as UI today. `analytics-dashboard.tsx` paints requested tiles, not
   unprompted narrative. SLA Sentinel is the one computed-but-unsurfaced
   primitive found in code — the clearest first build target, and it already
   matches docs/15's own forecast-strip example almost verbatim.
4. **SCOUT/NORTH canned analytics pages** don't exist as named routes the way
   AXIS/ORBIT/SIGNAL/finance do; their domain pages weren't deep-read for
   report content, so this is flagged as unverified rather than a confirmed
   gap.
