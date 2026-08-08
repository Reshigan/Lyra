# ADR-0024: NORTH Snapshotter computes metrics via a typed registry, not by executing `definition_sql_ref`

## Status

Accepted. `loss_ratio` and `renewal_retention` (renamed from
`renewal_retention_rate`) are now implemented — see ADR-0034 for the
judgment calls made. `claims_leakage` remains unregistered; that flag still
stands (see below).

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

Extended for docs/specs/gap-axis-design.md §F (AXIS task 15); see ADR-0034
for the formulas and judgment calls:

| key | formula |
|---|---|
| `gross_written_premium` | `SUM(premium_minor + tax_minor + fees_minor)` over `axis_policy_versions` effective in period, non-voided |
| `net_written_premium` | as above, `premium_minor` only |
| `loss_ratio` | `(paid + reserve − recovered) / earned_premium`, bp |
| `expense_ratio` | `SUM` of ledger `5xxx` account movements / earned premium, bp |
| `combined_ratio` | `loss_ratio + expense_ratio`, read from the same run's snapshots |
| `renewal_retention` | `COUNT(renewed)` / `COUNT(prior terms expiring)` in period, bp |
| `quote_hit_rate` | `COUNT(ledger_txns type='BIND')` / `COUNT(dist_quote_requests created)`, bp |
| `avg_handling_time_claims` | median `closed_at − reported_at` over `axis_claims` closed in period |
| `avg_handling_time_cases` | median `closed_at − created_at` over `axis_cases` closed in period |
| `reserve_adequacy` | `SUM(reserve at report+30d)` / `SUM(final paid)` over claims closed in period, bp |
| `sla_breach_rate` | `COUNT(closed past sla_due_at)` / `COUNT(closed)` over cases + claims, bp |
| `open_claim_count` | `COUNT(axis_claims WHERE closed_at IS NULL AND status NOT IN (withdrawn, rejected))`, point-in-time |
| `outstanding_reserve` | `SUM(axis_claims.reserve_minor)`, point-in-time |

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

`loss_ratio` and `renewal_retention_rate` (renamed `renewal_retention`) are
now implemented; ADR-0034 records the judgment calls made picking a basis
for each. One metric remains unresolved:

1. **`claims_leakage`** is *not* implemented. §F defines it as
   `paid − assessed_should_have_paid`, but no schema field anywhere holds an
   "assessed should have paid" figure — `axis_claims` has `paidMinor` and
   `reserveMinor`, neither of which is that. Computing it would mean
   inventing a number with no data source. Flagged for the domain owner: this
   needs either a new field capturing assessor sign-off amount, or a
   different formula.

The metric row is not registered in `north_metrics` at all (unlike the two
now-resolved items above, which stayed registered-but-empty while
unimplemented) — there is no SQL basis to point a definition row at, so
adding one would just be a broken Metric Explorer entry. It can be added once
the schema gap is resolved.

## References

- `apps/api/src/engines/north-snapshotter.ts` — `runSnapshotter`, `detectAnomalies`.
- `apps/api/src/engines/renewals.ts` — the named-function-per-metric precedent this follows.
- `apps/api/src/index.ts` — nightly tick wiring.
- `docs/modules/north.md` §2.1, §2.2, §2.3, §3.
- `packages/core/src/seed.ts` — the metric registry and demo snapshot fixtures this replaces for real tenants.
