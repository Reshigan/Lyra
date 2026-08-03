# ADR-0024: NORTH Snapshotter computes metrics via a typed registry, not by executing `definition_sql_ref`

## Status

Accepted. Two metric formulas flagged to the user, unresolved (see below).

## Context

`north_snapshots` had no writer at all outside `packages/core/src/seed.ts`
(demo fixtures). `engines/narrator.ts` (the Daily Brief) and
`engines/north-boardpack.ts` both correctly *read* snapshots but nothing
*produced* them from live data, so in any tenant not running the seed script
NORTH's entire semantic layer — the Daily Brief, board packs, the Metric
Explorer — is permanently empty. docs/modules/north.md §2.2/§3 names this the
`Snapshotter` agent, nightly-triggered.

`north_metrics.definitionSqlRef` looks executable but is not: seed values are
human-readable shorthand (`"axis_policies / dist_quote_requests WHERE state =
'complete'"`, `"dist_quote_responses.latency_ms, p95"`), not parseable SQL —
there is no consistent grammar across the ~12 seeded metrics. Building a
generic executor would mean designing and validating a query DSL against
tenant-supplied strings with no spec for what that DSL is, which is exactly
the kind of speculative infrastructure the build should not invent
unilaterally.

## Decision

`apps/api/src/engines/north-snapshotter.ts` computes each metric via a
hand-written, typed function keyed by `metric.key`, reading only from
core views/tables the way `definitionSqlRef` documents. This mirrors the
existing `sweepRenewals`/`churnScore` precedent (`engines/renewals.ts`): a
named, testable function per business concept, not a generic interpreter.

Metrics without a registered compute function are skipped (logged), not
guessed — a tenant-defined custom metric needs a code change to add its
function, same as any other typed business rule in this codebase. This is a
real scope limit, not a bug: it is the trade-off for not building an
unspecified SQL DSL.

Registered so far (period = current UTC day for `grain: "day"`, current UTC
month-to-date for `grain: "month"`, rewritten every tick — matching the
seed's own "open month is rewritten every night" comment):

| key | formula |
|---|---|
| `policies_issued` | `COUNT(axis_policies)` created in period |
| `quote_to_bind_rate` | `COUNT(axis_policies created)` / `COUNT(dist_quote_requests WHERE state='complete' created)` |
| `panel_response_rate` | `SUM(responded_count) / SUM(fanout_count)` over `dist_quote_requests` created in period |
| `quote_latency_p95` | p95 of `dist_quote_responses.latency_ms` for responses created in period |
| `gwp` | `SUM(axis_policies.premium_minor)` for policies created in period |
| `net_commission` | `SUM(axis_policies.commission_minor)` for policies created in period |
| `active_policies` | `COUNT(axis_policies WHERE status='active')` as of now (point-in-time gauge) |
| `cac_per_policy` | `SUM(signal_spend.amount_minor)` in period / `policies_issued` in period |
| `broker_channel_share` | premium on policies sold through a `dist_channels.kind='b2b'` channel / total premium, period |
| `ai_cost_per_case` | `SUM(ai_audit_log.cost_micro) / 10_000` (micro→minor) / `COUNT(axis_cases created)`, period |

Anomaly detection (`Anomaly Hunter`, post-snapshot per docs §3) is a
same-file follow-on pass: each freshly written snapshot is compared to the
immediately preceding period for the same metric/dims; a move past a
per-unit threshold (±15% for count/money/duration, ±500bps for
percent/ratio) inserts a `north_anomalies` row at `state: "new"`. This is the
simplest seasonal-naive baseline consistent with §2.3's "per-metric baselines
(seasonal-aware)" — a real seasonal model (holiday calendars, day-of-week
decomposition) is future work, not invented here.

Both run from the existing nightly tick in `apps/api/src/index.ts`
(`isBackupWindow`-gated, same idiom as `backupTenant`/`nudgeApiKeyRotation`),
per-tenant, wrapped in the same try/catch-per-tenant the sibling nightly jobs
already use.

## Flagged, not resolved

Two formulas above are judgment calls a domain owner should confirm, not
facts derivable from the schema:

1. **`loss_ratio`** is *not* implemented. Standard definition is claims
   incurred / premium earned, but `axis_claims` has both `amount_minor`
   (claimed) and `settled_minor` (paid out), and "premium earned" for a
   period is actuarially distinct from "premium written" (`gwp` here uses
   written, i.e. policy creation date, not an earned/unearned split). Picking
   one silently would ship a regulatory-adjacent number with an
   undocumented basis. Flagged for the docs/12-compliance owner.
2. **`renewal_retention_rate`** is *not* implemented for the same reason:
   `orbit_renewals` rows decide `accepted`/`lost` on `decidedAt`, but whether
   the denominator should be "renewals decided in period" (cohort at
   decision time) or "renewals whose expiry fell in period" (cohort at
   expiry) changes the number, and docs/modules/orbit.md doesn't specify
   which. Flagged for the ORBIT module owner.

Both metric rows remain registered in `north_metrics` (so Metric Explorer
still lists them) but simply accumulate no snapshots until a compute function
is added — visible as a gap in the UI, not a silently wrong number, which is
the safer failure mode under docs/modules/north.md §2.2's "never ship
unverified numbers" principle applied one layer down from the Narrator to the
metric layer itself.

## References

- `apps/api/src/engines/north-snapshotter.ts` — `runSnapshotter`, `detectAnomalies`.
- `apps/api/src/engines/renewals.ts` — the named-function-per-metric precedent this follows.
- `apps/api/src/index.ts` — nightly tick wiring.
- `docs/modules/north.md` §2.1, §2.2, §2.3, §3.
- `packages/core/src/seed.ts` — the metric registry and demo snapshot fixtures this replaces for real tenants.
