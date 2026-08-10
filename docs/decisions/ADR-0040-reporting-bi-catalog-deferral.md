# ADR-0040: Defer reporting/BI catalog expansion beyond v1 go-live

## Status

Accepted.

## Context

`docs/audits/2026-08-10-reporting-bi-catalog.md` catalogs the semantic
report engine (`engines/report.ts`'s `DATASETS` registry, 14 tenant-scoped,
PII-masked, permission-gated datasets today) and the analytics API surface
(`routes/analytics.ts`). It found three gaps:

1. ~17 schema tables/views have no `DATASETS` entry: `orbit_renewals`,
   `orbit_qa_scores`, `orbit_partners`/`orbit_partner_txns`,
   `axis_documents`, `axis_escrow_batches`, `axis_tasks`,
   `signal_creatives`, `signal_experiments`, `signal_aeo_pages`,
   `signal_attribution_events`, `scout_clusters`, `scout_panel_bench`,
   `scout_experiments`, `scout_data_products`,
   `north_metrics`/`north_snapshots`/`north_anomalies`/`north_scenarios`,
   plus a recon-specific view.
2. Schedule delivery beyond the in-app inbox (email, R2, webhook, Slack) is
   an unimplemented seam.
3. Almost no insight-pack (proactive/ambient-grammar, docs/15) UI surface
   exists anywhere. AXIS's SLA Sentinel
   (`engines/axis-sla-sentinel.ts`, §G.4) computes breach-probability today
   with no surface presenting it — the clearest computed-but-unsurfaced
   primitive in the codebase, and a close match for docs/15's own
   forecast-strip worked example.

None of these are named in any milestone's `**Accept:**` criteria in
`docs/14-roadmap.md`. The dataset registry today covers what M0-M6's
acceptance checklists actually exercise; the 17 missing entries are for
tables that exist for their own module's operation, not because a
milestone's canned-report acceptance test reads them.

## Decision

**Defer all three to post-v1 backlog.** Go-live does not block on them.

- Dataset registry expansion is additive and low-risk to add later —
  new `DATASETS` entries don't change existing report output, so there's
  no migration or compatibility cost to deferring.
- Schedule delivery beyond in-app inbox needs its own product decision
  (which channels, whose credentials, what retry/failure UX) before any
  engineering — same category of decision ADR-0035 declined to make
  speculatively for AXIS §G.6.
- Insight-pack UI is a design investment (docs/15 §4 pattern work), not a
  bugfix or a registry entry. SLA Sentinel is the natural first build
  target once that design work happens, but building a bespoke surface for
  one dataset ahead of the pattern would mean redoing it once the pattern
  exists.

None of the three has a consumer, a golden set (where AI-adjacent), or an
acceptance test demanding it today. Building them now would be speculative
engineering against docs/20's self-sufficiency principle, not scoped work.

## References

- `docs/audits/2026-08-10-reporting-bi-catalog.md` — full gap catalog.
- `docs/14-roadmap.md` — M0-M6 acceptance criteria, none of which name
  these gaps.
- `apps/api/src/engines/axis-sla-sentinel.ts` (§G.4) — the concrete
  computed-but-unsurfaced primitive cited as the first candidate once the
  insight-pack pattern exists.
- `docs/15-*` §4 — ambient AI grammar patterns an insight-pack surface must
  map to.
- ADR-0035 — same shape of deferral (infrastructure prerequisites, not a
  bugfix) for AXIS §G.6.
