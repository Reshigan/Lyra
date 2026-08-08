# ADR-0034: AXIS task 15 metric formula judgment calls

## Status

Accepted.

## Context

docs/specs/gap-axis-design.md §F lists 13 metrics for the NORTH Snapshotter
(ADR-0024) to compute. Several formulas leave a basis unspecified — the same
kind of ambiguity ADR-0024 flagged for `loss_ratio` and
`renewal_retention_rate` rather than guess silently. §F's own text plus the
existing schema (no ADR needed, no spec change) resolves most of them; this
ADR records which basis was picked and why, so a reviewer can see the
alternative that was rejected.

## Decisions

1. **`renewal_retention_rate` → `renewal_retention`.** §F names the metric
   `renewal_retention`; the old seed row (`renewal_retention_rate`, flagged
   unimplemented in ADR-0024) is renamed to match, not kept as a second
   metric. One metric, one key.

2. **`loss_ratio` reserve basis: current/live `reserveMinor`, not a
   point-in-time snapshot.** `axis_claims.reserveMinor` is a live mutable
   column, not a ledger of reserve-at-date. Computing "reserve as it stood
   during the accident period" would need reserve history, which doesn't
   exist. Using the current value means a claim's contribution to a past
   period's loss ratio can drift as the claim develops — an accepted
   limitation of the schema as it stands today, not a new one this ADR
   introduces. Flagged here so a reader doesn't mistake current-value drift
   for a bug.

3. **`renewal_retention`'s "bound" = `createdAt`.** §F's numerator is
   "policies with `renewedFromPolicyId` set, bound in period." `axis_policies`
   has no separate bind timestamp distinct from row creation, so "bound" is
   read as `createdAt`. Same basis `gwp`/`policies_issued` already use
   elsewhere in ADR-0024's registry for "issued," so this is consistent with
   existing precedent, not a new interpretation invented for this metric.

4. **`expense_ratio`'s signed-sum via ledger `side`.** `ledger_journal_lines`
   stores `amountMinor` always positive with `side: debit|credit` carrying
   the sign (per the schema comment). Summing `5xxx` account lines for the
   period requires signing each row (`+amount` for debit, `-amount` for
   credit) before summing, done via a SQL `CASE` rather than pulling rows
   into JS — keeps the aggregation in the DB, consistent with every other
   compute function in `north-snapshotter.ts`.

5. **`combined_ratio` reads `loss_ratio`/`expense_ratio`'s own snapshots,
   not source tables.** §F defines it as their sum. Re-deriving both from
   scratch would duplicate their query logic and risk drifting from the
   registered numbers Metric Explorer shows for them. Reading the
   `north_snapshots` rows those two metrics just wrote in the same tick means
   `combined_ratio` is always exactly what a user would get by adding the two
   displayed numbers. This requires `combined_ratio` to run after both in the
   same tick — enforced by sorting `runSnapshotter`'s metrics array so
   `combined_ratio` is always last.

6. **`claims_leakage` remains unregistered.** See ADR-0024 "Flagged, not
   resolved" — no schema field holds an "assessed should have paid" figure,
   so there's nothing to compute. Not addressed by this ADR; still open.

## References

- `apps/api/src/engines/north-snapshotter.ts` — the 12 new compute functions.
- ADR-0024 — the typed-registry decision this extends.
- `docs/specs/gap-axis-design.md` §F — the metric formula table.
